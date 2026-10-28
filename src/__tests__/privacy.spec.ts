// npx vitest run __tests__/privacy.spec.ts
//
// Repository-level privacy guarantees: no telemetry SDKs, no analytics senders,
// and build/test tooling opted out of usage reporting. The built artifacts are
// checked separately by `pnpm privacy:audit` (scripts/privacy-audit.mjs).

import * as fs from "fs"
import * as path from "path"

const repoRoot = path.resolve(__dirname, "../..")

const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), "utf-8")

const subdirs = (relativeDir: string) =>
	fs
		.readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.posix.join(relativeDir, entry.name))

const workspaceManifests = () =>
	[".", "src", "webview-ui", ...subdirs("packages"), ...subdirs("apps")]
		.map((dir) => path.posix.join(dir, "package.json"))
		.filter((manifest) => fs.existsSync(path.join(repoRoot, manifest)))

const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", ".turbo", "__tests__", "__mocks__"])
const SOURCE_FILE = /\.(ts|tsx|js|mjs|cjs)$/
const TEST_FILE = /\.(spec|test)\.(ts|tsx|js|mjs)$/

const sourceFiles = (relativeDir: string): string[] => {
	const absoluteDir = path.join(repoRoot, relativeDir)
	if (!fs.existsSync(absoluteDir)) return []
	return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
		const relativePath = path.posix.join(relativeDir, entry.name)
		if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(relativePath)
		return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [relativePath] : []
	})
}

// Telemetry, analytics and crash-reporting SDKs that must never be a dependency.
const TELEMETRY_PACKAGE =
	/^(posthog[\w-]*|@sentry\/[\w-]+|applicationinsights|@vscode\/extension-telemetry|mixpanel[\w-]*|@segment\/[\w-]+|analytics-node|@amplitude\/[\w-]+|amplitude-js|@datadog\/[\w-]+|dd-trace|@bugsnag\/[\w-]+|rollbar)$/

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const

describe("privacy", () => {
	describe("dependencies", () => {
		it("finds the workspace manifests", () => {
			expect(workspaceManifests()).toEqual(
				expect.arrayContaining(["package.json", "src/package.json", "webview-ui/package.json"]),
			)
		})

		it.each(workspaceManifests())("%s declares no telemetry SDK", (manifest) => {
			const pkg: Record<string, unknown> = JSON.parse(read(manifest))
			const declared = DEPENDENCY_FIELDS.flatMap((field) => Object.keys((pkg[field] as object | undefined) ?? {}))
			expect(declared.filter((name) => TELEMETRY_PACKAGE.test(name))).toEqual([])
		})

		it("lockfile resolves no telemetry SDK, directly or transitively", () => {
			const resolved = read("pnpm-lock.yaml")
				.split(/\r?\n/)
				.map((line) => /^\s+'?((?:@[\w.-]+\/)?[\w.-]+)@/.exec(line)?.[1])
				.filter((name): name is string => name !== undefined && TELEMETRY_PACKAGE.test(name))
			expect([...new Set(resolved)]).toEqual([])
		})
	})

	describe("source", () => {
		const scannedFiles = () =>
			[
				"src",
				"webview-ui/src",
				...subdirs("packages").map((dir) => `${dir}/src`),
				...subdirs("apps").map((dir) => `${dir}/src`),
			].flatMap(sourceFiles)

		it("scans a meaningful amount of source", () => {
			expect(scannedFiles().length).toBeGreaterThan(500)
		})

		it("contains no analytics imports, hosts or event endpoints", () => {
			const forbidden = [
				/(from\s+|require\(\s*|import\(\s*)["']posthog/,
				/i\.posthog\.com/,
				/\/api\/events\b/,
				/sentry\.io\/api/,
				/dc\.services\.visualstudio\.com/,
			]
			const offenders = scannedFiles().flatMap((file) => {
				const content = read(file)
				return forbidden.filter((pattern) => pattern.test(content)).map((pattern) => `${file}: ${pattern}`)
			})
			expect(offenders).toEqual([])
		})

		it("has no PostHog client or cloud event retry queue", () => {
			expect(fs.existsSync(path.join(repoRoot, "packages/telemetry/src/PostHogTelemetryClient.ts"))).toBe(false)
			expect(fs.existsSync(path.join(repoRoot, "packages/telemetry/src/BaseTelemetryClient.ts"))).toBe(false)
			expect(fs.existsSync(path.join(repoRoot, "packages/cloud/src/retry-queue"))).toBe(false)
		})
	})

	describe("build and test tooling", () => {
		it("routes every root turbo script through the telemetry-disabling wrapper", () => {
			const scripts: Record<string, string> = JSON.parse(read("package.json")).scripts
			const turboScripts = Object.entries(scripts).filter(([, command]) => /\bturbo(\.mjs)?\b/.test(command))
			expect(turboScripts.length).toBeGreaterThan(0)
			for (const [name, command] of turboScripts) {
				expect(command, name).toMatch(/^node scripts\/turbo\.mjs /)
			}
		})

		it("never invokes turbo directly from a package script", () => {
			const bareTurbo = /(^|[\s;&|])(npx\s+|pnpm\s+(exec\s+)?)?turbo\s/
			const offenders = workspaceManifests().flatMap((manifest) => {
				const scripts: Record<string, string> = JSON.parse(read(manifest)).scripts ?? {}
				return Object.entries(scripts)
					.filter(([, command]) => bareTurbo.test(command))
					.map(([name]) => `${manifest}#${name}`)
			})
			expect(offenders).toEqual([])
		})

		it("wrapper disables turbo telemetry and update checks", () => {
			const wrapper = read("scripts/turbo.mjs")
			expect(wrapper).toContain("TURBO_TELEMETRY_DISABLED")
			expect(wrapper).toContain("DO_NOT_TRACK")
			expect(wrapper).toContain("TURBO_NO_UPDATE_NOTIFIER")
		})

		it("every workflow that runs pnpm opts build tools out of telemetry", () => {
			const workflowDir = ".github/workflows"
			const offenders = fs
				.readdirSync(path.join(repoRoot, workflowDir))
				.filter((file) => /\.ya?ml$/.test(file))
				.filter((file) => /\bpnpm\b/.test(read(`${workflowDir}/${file}`)))
				.filter((file) => {
					const workflow = read(`${workflowDir}/${file}`)
					return !/TURBO_TELEMETRY_DISABLED:\s*"1"/.test(workflow) || !/DO_NOT_TRACK:\s*"1"/.test(workflow)
				})
			expect(offenders).toEqual([])
		})

		it("launches VS Code for e2e runs with telemetry and crash reporting disabled", () => {
			const launchArgs = read("apps/vscode-e2e/src/privacyLaunchArgs.ts")
			expect(launchArgs).toContain('"--disable-telemetry"')
			expect(launchArgs).toContain('"--disable-crash-reporter"')

			const launchSites = [
				"apps/vscode-e2e/src/runTest.ts",
				"apps/vscode-e2e/src/restart/vscodeCoordinator.ts",
				"apps/vscode-e2e/src/theme-fixtures/generate.ts",
				"apps/vscode-e2e/src/visual/electron.visual.ts",
			]
			for (const site of launchSites) {
				expect(read(site), site).toContain("...PRIVACY_LAUNCH_ARGS")
			}
		})
	})
})
