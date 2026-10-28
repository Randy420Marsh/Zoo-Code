#!/usr/bin/env node

// Runs turbo with its anonymous usage telemetry and npm update check turned off.
//
// turbo enables telemetry by default (`turbo telemetry status` reports "Enabled"
// on a fresh machine) and reports to Vercel on every run. Every root script goes
// through this wrapper so lint, test, build and vsix runs, including the husky
// hooks and CI, never send it, whatever the machine-wide turbo setting is.

import { spawnSync } from "child_process"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const turboBin = require.resolve("turbo/bin/turbo")

const result = spawnSync(process.execPath, [turboBin, ...process.argv.slice(2)], {
	stdio: "inherit",
	env: {
		...process.env,
		TURBO_TELEMETRY_DISABLED: "1",
		DO_NOT_TRACK: "1",
		TURBO_NO_UPDATE_NOTIFIER: "1",
	},
})

if (result.error) {
	console.error(result.error.message)
	process.exit(1)
}

process.exit(result.status ?? 1)
