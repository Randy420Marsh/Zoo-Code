import { execa, ExecaError } from "execa"
import psTree from "ps-tree"
import process from "process"

function killPid(pid: number): void {
	if (!Number.isInteger(pid) || pid <= 0) {
		return
	}
	// Process-group kill stops pnpm/tsx children that survive a single SIGKILL.
	try {
		process.kill(-pid, "SIGKILL")
	} catch {
		try {
			process.kill(pid, "SIGKILL")
		} catch (error) {
			console.warn(
				`[ExecaTerminalProcess#abort] Failed to kill PID ${pid}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}

function killSubprocess(subprocess: ReturnType<typeof execa> | undefined): void {
	if (!subprocess) {
		return
	}
	try {
		subprocess.kill("SIGKILL")
	} catch (error) {
		console.warn(
			`[ExecaTerminalProcess#abort] Failed to kill subprocess: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

import type { RooTerminal } from "./types"
import { BaseTerminal } from "./BaseTerminal"
import { BaseTerminalProcess } from "./BaseTerminalProcess"
import { getShell } from "../../utils/shell"
import { getUtf8LocaleEnv } from "./localeEnv"

export class ExecaTerminalProcess extends BaseTerminalProcess {
	private terminalRef: WeakRef<RooTerminal>
	private aborted = false
	private pid?: number
	/** Shell pid from execa. Never replaced by the child-pid display update. */
	private shellPid?: number
	private subprocess?: ReturnType<typeof execa>
	private pidUpdatePromise?: Promise<void>

	constructor(terminal: RooTerminal) {
		super()

		this.terminalRef = new WeakRef(terminal)

		this.once("completed", () => {
			this.terminal.busy = false
		})
	}

	public get terminal(): RooTerminal {
		const terminal = this.terminalRef.deref()

		if (!terminal) {
			throw new Error("Unable to dereference terminal")
		}

		return terminal
	}

	public override async run(command: string) {
		this.command = command

		try {
			this.isHot = true

			this.subprocess = execa({
				shell: BaseTerminal.getExecaShellPath() || getShell(),
				cwd: this.terminal.getCurrentWorkingDirectory(),
				all: true,
				// Ignore stdin to ensure non-interactive mode and prevent hanging
				stdin: "ignore",
				env: {
					...process.env,
					// Keep the host locale when it already is UTF-8 (e.g. en_AU.UTF-8), otherwise
					// fall back to en_US.UTF-8 so tools such as Ruby and CocoaPods still emit UTF-8.
					...getUtf8LocaleEnv(),
				},
			})`${command}`

			this.pid = this.subprocess.pid
			this.shellPid = this.subprocess.pid

			// When using shell: true, the PID is for the shell, not the actual command
			// Find the actual command PID after a small delay
			if (this.pid) {
				this.pidUpdatePromise = new Promise<void>((resolve) => {
					setTimeout(() => {
						psTree(this.pid!, (err, children) => {
							if (!err && children.length > 0) {
								// Update PID to the first child (the actual command)
								const actualPid = parseInt(children[0].PID)
								if (!isNaN(actualPid)) {
									this.pid = actualPid
								}
							}
							resolve()
						})
					}, 100)
				})
			}

			const rawStream = this.subprocess.iterable({ from: "all", preserveNewlines: true })

			// Wrap the stream to ensure all chunks are strings (execa can return Uint8Array)
			const stream = (async function* () {
				for await (const chunk of rawStream) {
					yield typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
				}
			})()

			this.terminal.setActiveStream(stream, this.pid)

			for await (const line of stream) {
				if (this.aborted) {
					break
				}

				this.fullOutput += line

				const now = Date.now()

				if (this.isListening && (now - this.lastEmitTime_ms > 500 || this.lastEmitTime_ms === 0)) {
					this.emitRemainingBufferIfListening()
					this.lastEmitTime_ms = now
				}

				this.startHotTimer(line)
			}

			if (this.aborted) {
				let timeoutId: NodeJS.Timeout | undefined

				const kill = new Promise<void>((resolve) => {
					console.log(`[ExecaTerminalProcess#run] SIGKILL -> ${this.pid}`)

					timeoutId = setTimeout(() => {
						try {
							this.subprocess?.kill("SIGKILL")
						} catch {
							// The process may already be gone.
						}

						resolve()
					}, 5_000)
				})

				try {
					await Promise.race([this.subprocess, kill])
				} catch (error) {
					console.log(
						`[ExecaTerminalProcess#run] subprocess termination error: ${error instanceof Error ? error.message : String(error)}`,
					)
				}

				if (timeoutId) {
					clearTimeout(timeoutId)
				}
			}

			this.emit("shell_execution_complete", { exitCode: 0 })
		} catch (error) {
			if (error instanceof ExecaError) {
				console.error(`[ExecaTerminalProcess#run] shell execution error: ${error.message}`)
				this.emit("shell_execution_complete", { exitCode: error.exitCode ?? 0, signalName: error.signal })
			} else {
				console.error(
					`[ExecaTerminalProcess#run] shell execution error: ${error instanceof Error ? error.message : String(error)}`,
				)

				this.emit("shell_execution_complete", { exitCode: 1 })
			}
			this.subprocess = undefined
		}

		this.terminal.setActiveStream(undefined)
		this.emitRemainingBufferIfListening()
		this.stopHotTimer()
		this.emit("completed", this.fullOutput)
		this.emit("continue")
		this.subprocess = undefined
	}

	public override continue() {
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	public override abort() {
		this.aborted = true

		const performKill = () => {
			const rootPid = this.shellPid ?? this.pid
			// Collect the tree before any kill. Killing the leaf first orphans
			// the rest, and psTree on a dead pid misses them.
			const killCollected = (pids: number[]) => {
				for (const pid of pids) {
					killPid(pid)
				}
			}
			if (!rootPid) {
				killSubprocess(this.subprocess)
				return
			}
			psTree(rootPid, (err, children) => {
				const pids = new Set<number>([rootPid])
				if (!err) {
					for (const child of children) {
						const childPid = parseInt(child.PID, 10)
						if (!Number.isNaN(childPid)) {
							pids.add(childPid)
						}
					}
				}
				killSubprocess(this.subprocess)
				killCollected([...pids])
			})
		}

		if (this.pidUpdatePromise) {
			this.pidUpdatePromise.then(performKill).catch(() => performKill())
		} else {
			performKill()
		}
	}

	public override hasUnretrievedOutput() {
		return this.lastRetrievedIndex < this.fullOutput.length
	}

	public override getUnretrievedOutput() {
		const output = this.fullOutput.slice(this.lastRetrievedIndex)
		let index = output.lastIndexOf("\n")

		if (index === -1) {
			return ""
		}

		index++
		this.lastRetrievedIndex += index

		// console.log(
		// 	`[ExecaTerminalProcess#getUnretrievedOutput] fullOutput.length=${this.fullOutput.length} lastRetrievedIndex=${this.lastRetrievedIndex}`,
		// 	output.slice(0, index),
		// )

		return output.slice(0, index)
	}

	private emitRemainingBufferIfListening() {
		if (!this.isListening) {
			return
		}

		const output = this.getUnretrievedOutput()

		if (output !== "") {
			this.emit("line", output)
		}
	}
}
