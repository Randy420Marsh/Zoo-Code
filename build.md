# Building and installing Zoo Code locally

How to rebuild this extension from source and install it into your editor.

## TL;DR

```powershell
pnpm vsix
codium --install-extension bin\zoo-code-3.82.0.vsix --force
```

Then fully quit and reopen the editor. Substitute `code` for `codium` if you run
upstream VS Code, and bump the filename when `version` in `src/package.json` changes.

## Prerequisites

| Tool       | Required                                         | Notes                                                                         |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Node       | `22.23.1` per `.nvmrc` and both `engines` blocks | Builds have succeeded on 20.x and 24.x too; the pin is advisory, not enforced |
| pnpm       | `10.8.1`                                         | Declared as `packageManager` in the root `package.json`                       |
| Editor CLI | `code`, `codium`, `cursor`, …                    | Needed only for the install step                                              |

### Getting pnpm

The repo pins pnpm via the `packageManager` field, so Corepack can provision the
exact version with no global install:

```powershell
corepack enable pnpm
pnpm -v   # 10.8.1
```

Corepack ships with Node, reads the pin, and downloads the matching pnpm on first use.

> **Gotcha: pnpm disappears after switching Node versions.**
> With nvm-windows, `C:\nvm4w\nodejs` is a symlink to whichever version is active,
> and globally installed binaries live _inside_ each version's folder. Running
> `nvm use <other-version>` therefore takes the `pnpm` shim with it, and you get:
>
> ```
> 'pnpm' is not recognized as an internal or external command
> ```
>
> Fix by re-running `corepack enable pnpm` under the new version (it must be run
> once per Node version), or by switching back with `nvm use`. Note that `nvm use`
> on Windows needs an **elevated** shell, since it rewrites a symlink.

## Build

```powershell
pnpm vsix
```

This is a Turbo task defined in `src/turbo.json`. It runs `bundle` first, then packages:

1. **`bundle`** — `node esbuild.mjs`, which builds the extension host bundle and
   shells out to Vite for the webview UI.
2. **`vsce package --no-dependencies --out ../bin`** — wraps the result into a VSIX.

Artifacts produced:

| Path                          | What it is                                      |
| ----------------------------- | ----------------------------------------------- |
| `bin/zoo-code-<version>.vsix` | The installable package, ~34 MB                 |
| `src/dist/extension.js`       | Extension host bundle, ~15 MB                   |
| `src/webview-ui/build/`       | Webview assets (377 JS chunks plus source maps) |

A warm build takes well under a minute; the webview step alone reports around
8–16 seconds.

### Reading the output

`pnpm vsix` prints several thousand lines. These are all **normal** and do not
indicate failure:

- A long table of `../src/webview-ui/build/assets/*.js` chunks with sizes.
- `(!) Some chunks are larger than 500 kB after minification.` — expected;
  the webview bundles Shiki grammars and Mermaid.
- `[SOURCEMAP_BROKEN] Sourcemap is likely to be incorrect: a plugin
(@tailwindcss/vite:generate:build) ... didn't generate a sourcemap` — cosmetic.
- `[PLUGIN_TIMINGS] Your build spent significant time in plugins: wasm (86%)`.
- Hundreds of `Source map found for …` / `Updated source map for …` lines from the
  post-build source map step, including a handful of `No source map found for …`.

The line that actually matters is `✓ built in 8.02s`. Verify success by checking
that the VSIX timestamp is current:

```powershell
Get-ChildItem bin\*.vsix | Select-Object Name, Length, LastWriteTime
```

### Full clean rebuild

Only needed when dependencies change or you suspect stale output:

```powershell
pnpm install:vsix
```

That chains `pnpm install --frozen-lockfile` → `pnpm clean` → `pnpm vsix` →
`node scripts/install-vsix.js`, which also handles the install. It prompts for
your editor command; pass it up front to skip the prompt:

```powershell
node scripts/install-vsix.js -y --editor=codium
```

Note that `pnpm clean` deletes `bin/`, so any previously built VSIX is removed.

## Install

```powershell
codium --install-extension bin\zoo-code-3.82.0.vsix --force
```

**`--force` is required for local rebuilds.** The version in `src/package.json`
does not change between builds, so the editor sees a VSIX whose version matches
what is already installed and skips the install silently. `--force` overwrites it.

The repo's own installer sidesteps this by uninstalling first:

```powershell
node scripts/install-vsix.js -y --editor=codium
```

Its default editor is `code`, so pass `--editor=` if you run anything else.

After installing, **fully quit and reopen** the editor. "Reload Window" often
leaves the old extension host process alive.

### Verifying the install took

Compare the installed bundle against what you just built — same size and
timestamp means the new build is live:

```powershell
Get-Item "$env:USERPROFILE\.vscode-oss\extensions\zoocodeorganization.zoo-code-3.82.0\dist\extension.js",
         "src\dist\extension.js" | Select-Object FullName, Length, LastWriteTime
```

Extension directories by editor:

| Editor   | Extensions directory                   |
| -------- | -------------------------------------- |
| VSCodium | `%USERPROFILE%\.vscode-oss\extensions` |
| VS Code  | `%USERPROFILE%\.vscode\extensions`     |

## Fast iteration

When you only want to see a code change run, skip packaging entirely:

```powershell
pnpm bundle
```

Then press <kbd>F5</kbd> to launch the Extension Development Host, or restart an
existing one. Reserve the VSIX path for when you want the build installed into
your real editor profile.

## Known side effect: Turbo self-upgrades

Running the build may leave uncommitted changes in the repo:

```
 M package.json          turbo 2.10.0 -> 2.10.12
 M pnpm-lock.yaml
 M turbo.json            $schema -> https://v2-10-12.turborepo.dev/schema.json
 M src/turbo.json
 M packages/core/turbo.json
 M webview-ui/turbo.json
```

Turbo migrates its own version and rewrites the `$schema` URLs in every
`turbo.json`. This is benign, but check `git status` after a build so it does not
ride along in an unrelated commit.
