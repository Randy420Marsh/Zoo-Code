#!/usr/bin/env node

// Scans the files the VSIX would ship for telemetry senders, analytics hosts and
// community/social links. Run it after a build (`pnpm bundle` or `pnpm vsix`):
//
//   pnpm privacy:audit
//
// The file list comes from `vsce ls --no-dependencies`, the same .vscodeignore
// evaluation `vsce package` uses, so the audit covers exactly what is packaged
// (bundled extension, webview assets, source maps, README, marketplace data)
// without opening the .vsix archive itself.
//
// Markdown docs (README, the upstream CHANGELOG history) are prose a user reads,
// not code that runs, so matches there are printed as notes and do not fail the
// audit. Every other packaged text file (js, source maps, json, css, html) fails.
//
// Exit codes: 0 clean, 1 findings, 2 missing build or vsce failure.

import { spawnSync } from "child_process"
import { readFileSync, statSync } from "fs"
import { createRequire } from "module"
import path from "path"
import { fileURLToPath } from "url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const extensionDir = path.join(repoRoot, "src")

const FORBIDDEN = [
	["PostHog", /posthog/i],
	["cloud event endpoint", /\/api\/events\b/],
	["Discord invite", /discord\.gg\/|discord\.com\/invite/i],
	["Reddit", /reddit\.com/i],
	["X / Twitter", /https?:\/\/(www\.)?(x|twitter)\.com\b/i],
	["Sentry", /ingest(\.[a-z]+)?\.sentry\.io|@sentry\//i],
	[
		"Application Insights",
		/dc\.services\.visualstudio\.com|applicationinsights\.azure\.com|@vscode\/extension-telemetry/i,
	],
	["Mixpanel", /api(-js)?\.mixpanel\.com/i],
	["Segment", /api\.segment\.io|cdn\.segment\.com/i],
	["Amplitude", /api2?\.amplitude\.com|api\.eu\.amplitude\.com/i],
	["Datadog", /datadoghq\.(com|eu)/i],
	["Bugsnag", /(notify|sessions)\.bugsnag\.com/i],
	["Rollbar", /api\.rollbar\.com/i],
]

// Intentional references that must never be reported. The README links the
// upstream project on purpose.
const ALLOWED = [/github\.com\/Zoo-Code-Org\b[^\s"')\]]*/gi]

const BINARY_FILE = /\.(wasm|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp3|wav|ogg|node)$/i
const DOC_FILE = /\.md$/i
const MAX_FINDINGS_PER_RULE = 5

function packagedFiles() {
	const require = createRequire(path.join(extensionDir, "package.json"))
	const vscePackageJson = require.resolve("@vscode/vsce/package.json")
	const vsceBin = path.join(
		path.dirname(vscePackageJson),
		JSON.parse(readFileSync(vscePackageJson, "utf-8")).bin.vsce,
	)

	const result = spawnSync(process.execPath, [vsceBin, "ls", "--no-dependencies"], {
		cwd: extensionDir,
		encoding: "utf-8",
	})
	if (result.error || result.status !== 0) {
		console.error("vsce ls failed:", result.error?.message ?? result.stderr)
		process.exit(2)
	}
	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
}

function snippet(content, index, length) {
	const start = Math.max(0, index - 40)
	const end = Math.min(content.length, index + length + 40)
	return content.slice(start, end).replace(/\s+/g, " ")
}

function scan(relativePath) {
	const content = ALLOWED.reduce(
		(text, allowed) => text.replace(allowed, (match) => " ".repeat(match.length)),
		readFileSync(path.join(extensionDir, relativePath), "utf-8"),
	)
	const findings = []
	for (const [label, pattern] of FORBIDDEN) {
		const matches = [...content.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))]
		for (const match of matches.slice(0, MAX_FINDINGS_PER_RULE)) {
			const line = content.slice(0, match.index).split("\n").length
			findings.push(`${relativePath}:${line}  [${label}]  …${snippet(content, match.index, match[0].length)}…`)
		}
		if (matches.length > MAX_FINDINGS_PER_RULE) {
			findings.push(`${relativePath}  [${label}]  …and ${matches.length - MAX_FINDINGS_PER_RULE} more`)
		}
	}
	return findings
}

const files = packagedFiles()

const missing = ["dist/extension.js", "webview-ui/build/assets/"].filter(
	(required) => !files.some((file) => file.startsWith(required)),
)
if (missing.length > 0) {
	console.error(`Build output missing from the package (${missing.join(", ")}). Run \`pnpm bundle\` first.`)
	process.exit(2)
}

const textFiles = files.filter((file) => !BINARY_FILE.test(file))
const findings = textFiles.filter((file) => !DOC_FILE.test(file)).flatMap(scan)
const notes = textFiles.filter((file) => DOC_FILE.test(file)).flatMap(scan)
const scannedBytes = textFiles.reduce((total, file) => total + statSync(path.join(extensionDir, file)).size, 0)

console.log(
	`privacy audit: scanned ${textFiles.length} of ${files.length} packaged files (${(scannedBytes / 1024 / 1024).toFixed(1)} MB of text)`,
)

if (notes.length > 0) {
	console.log(`\n${notes.length} note(s) in shipped docs (prose, not code; does not fail the audit):\n`)
	for (const note of notes) console.log(`  ${note}`)
}

if (findings.length > 0) {
	console.error(`\n${findings.length} finding(s):\n`)
	for (const finding of findings) console.error(`  ${finding}`)
	process.exit(1)
}

console.log("privacy audit: clean — no telemetry, analytics or social endpoints in the packaged extension")
