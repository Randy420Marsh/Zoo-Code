# Zoo Code (Randy420Marsh fork)

> An unofficial, privacy-hardened fork of [Zoo Code](https://github.com/Zoo-Code-Org/Zoo-Code)
> maintained at **[Randy420Marsh/Zoo-Code](https://github.com/Randy420Marsh/Zoo-Code)**.
>
> This fork is not affiliated with, endorsed by, or maintained by the Zoo Code
> team. It is distributed only as a locally built VSIX and is not published to
> the VS Code Marketplace or Open VSX.

## What this fork changes

- **No telemetry, at all.** The PostHog senders, the cloud telemetry client,
  the telemetry opt-in banner and the telemetry setting have been removed from
  the code. Nothing is sent on startup, during use, or on crash; there is no
  setting to turn it back on.
- **No social or community links** in the extension UI (no Discord, Reddit or X).
- **Privacy checks:** `pnpm privacy:audit` (run after `pnpm vsix`) scans every
  file the VSIX packages, including bundled JS and source maps, for telemetry
  SDKs, analytics hosts and social links. The privacy test suite
  (`src/__tests__/privacy.spec.ts`, part of `pnpm test`) checks manifests,
  the lockfile and source for telemetry packages and senders.
- **Build tools opted out:** Turborepo runs through `scripts/turbo.mjs` with
  `TURBO_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1`; CI workflows set the same,
  and e2e VS Code instances launch with telemetry and crash reporting disabled.
- **Multimodal & Provider Enhancements (xAI, Google Gemini, OpenRouter):**
  - Live model catalogs for xAI (`/v1/models`), Google Gemini (`/v1beta/models`), and OpenRouter (`/api/v1/models`), plus cached provider `llms.txt` ground-of-truth indexes (`pnpm check:provider-llms`).
  - Dynamic **Image, Video, and Audio** input/generation modality toggles across xAI, Google Gemini, and OpenRouter.
  - Prompt caching & sticky session routing (`session_id` on OpenRouter, `x-grok-conv-id` and encrypted reasoning compaction-blob preservation on xAI).
  - Cross-provider media generation fallback so local models (e.g., via LM Studio or Ollama) can invoke external image/media tools when enabled in Experimental Settings.
- **Webview & Task Reliability:** Automatic dead-renderer detection and recovery via heartbeat watchdog, safe background command handling, and multi-turn tool call / diff reliability improvements.
- Repository, issue and attribution links point to this fork.

Network traffic that remains is what you initiate: requests to the model
providers you configure and to the MCP servers you add. The Marketplace listing
is bundled with the extension and makes no network request. See
[PRIVACY.md](PRIVACY.md).

## What Zoo Code can do

- Generate code from natural language descriptions and specs
- Adapt with Modes: Code, Architect, Ask, Debug, and Custom Modes
- Refactor and debug existing code
- Write and update documentation
- Answer questions about your codebase
- Automate repetitive tasks
- Use MCP servers

Upstream documentation (still applicable to most features):
[docs.zoocode.dev](https://docs.zoocode.dev) —
[Using Modes](https://docs.zoocode.dev/basic-usage/using-modes) •
[Custom Modes](https://docs.zoocode.dev/advanced-usage/custom-modes)

## Issues

Report problems with this fork at
[Randy420Marsh/Zoo-Code/issues](https://github.com/Randy420Marsh/Zoo-Code/issues).

---

## Build from source

```sh
git clone https://github.com/Randy420Marsh/Zoo-Code.git
cd Zoo-Code
pnpm install
pnpm vsix
pnpm privacy:audit
```

A `.vsix` file is written to `bin/`. The filename includes the `version` field
from [`src/package.json`](src/package.json) (currently `3.94.6`):

```text
bin/zoo-code-3.94.6.vsix
```

List what was built:

```sh
ls -lh bin/zoo-code-*.vsix
```

`pnpm privacy:audit` scans that file and fails if anything in it would send
telemetry.

Build tool telemetry is turned off by the `pnpm` scripts themselves, so the
steps above need no extra setup. Run Turborepo only through these scripts. A
direct `turbo` or `npx turbo` call bypasses `scripts/turbo.mjs` and, with it,
the opt-out. If you do call it directly, set the variables yourself first:

```sh
export TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 TURBO_NO_UPDATE_NOTIFIER=1
```

`pnpm install` downloads the ripgrep binary from GitHub. This is a download,
not a report; see [PRIVACY.md](PRIVACY.md#build-tools).

Install it with the editor CLI that is actually on your `PATH`. VSCodium's
command is `codium`. `code` is the VS Code CLI; it is not installed with
VSCodium, and `code --install-extension` fails with `command not found`.

```sh
codium --install-extension bin/zoo-code-3.94.6.vsix --force
```

Quit the editor completely and reopen it. Reload Window often leaves the old
extension host running.

The repo installer uninstalls the previous copy first. It defaults to `code`,
so on VSCodium pass the CLI:

```sh
node scripts/install-vsix.js -y --editor=codium
```

Because the extension ID is unchanged (`ZooCodeOrganization.zoo-code`), turn off
auto-update for this extension so a Marketplace / Open VSX release does not
replace this build.

### API Keys, Modality Toggles & Cross-Provider Media Generation

Zoo Code supports dynamic **Image, Video, and Audio** modality toggles on **xAI**, **Google Gemini**, and **OpenRouter**, as well as an **Experimental Image Generation** fallback toggle so local models (e.g. on LM Studio / Ollama) can invoke external media tools when an API key is present.

- **Where to set API keys** (resolved in priority order):
  1. **Active Provider Profile** (`Settings → Providers` → `xAI API Key`, `Gemini API Key`, or `OpenRouter API Key`) or **Experimental Image Generation** (`Settings → Experimental → Image Generation`).
  2. **Saved Provider Profiles** in Zoo Code (`ProviderSettingsManager` — automatically used for cross-provider calls when your active chat profile is `Local`).
  3. **Environment Variables**: `XAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), and `OPENROUTER_API_KEY`.
- **Dynamic Prompt & Tool Gating**: Media tools (`generate_image`) and media-specific `CAPABILITIES` instructions are only injected into the model prompt when enabled in Settings; when toggled off, they are completely hidden from the model, keeping your Global Modes (`custom_modes.yaml`) and Project Modes (`.roomodes`) clean and user-editable.
- Full guide: [`docs/wiki/API_KEYS_AND_MEDIA_GENERATION.md`](./docs/wiki/API_KEYS_AND_MEDIA_GENERATION.md). See [`CHANGELOG.md`](./CHANGELOG.md) for the release history of this fork.

### Development mode (F5)

Press `F5` (or **Run** → **Start Debugging**) in VS Code to open a new window
with the extension loaded. Webview and core extension changes hot reload.

---

## Disclaimer

**Please note** that this fork does **not** make any representations or
warranties regarding any code, models, or other tools provided or made available
in connection with it, any associated third-party tools, or any resulting
outputs. You assume **all risks** associated with the use of any such tools or
outputs; such tools are provided on an **"AS IS"** and **"AS AVAILABLE"** basis.
Such risks may include, without limitation, intellectual property infringement,
cyber vulnerabilities or attacks, bias, inaccuracies, errors, defects, viruses,
downtime, property loss or damage, and/or personal injury. You are solely
responsible for your use of any such tools or outputs (including, without
limitation, the legality, appropriateness, and results thereof).

---

## License

[Apache 2.0](./LICENSE). Original work © 2026 Zoo Code; modifications © 2026
Randy420Marsh. Zoo Code is itself derived from Roo Code.
