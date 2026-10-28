# Privacy — Zoo Code (Randy420Marsh fork)

**Last Updated: October 16th, 2026**

This fork of Zoo Code ([Randy420Marsh/Zoo-Code](https://github.com/Randy420Marsh/Zoo-Code))
collects **no telemetry**. Below is where data goes when you use it, and where
it does not.

## Where your data goes (and where it doesn't)

- **Telemetry, analytics and crash reports: none.** The PostHog senders, the
  cloud telemetry client, the telemetry banner and the telemetry setting have
  been removed from the code. No usage events, error reports, machine IDs or
  crash data are sent, on startup, during use, or when something fails. There
  is no setting that turns telemetry on.
- **Code & files:** The extension reads files on your machine when needed for
  AI-assisted features. When you send a request, relevant files and context are
  transmitted to the AI model provider **you** configured (for example a local
  llama.cpp server, OpenAI, Anthropic or OpenRouter). Providers handle that data
  under their own policies. If you select Zoo Code Cloud / Zoo Gateway as the
  provider, requests go through the upstream Zoo Code servers.
- **Commands:** Commands run in your local environment. Their output may be
  included in context sent to your chosen model provider.
- **API keys & credentials:** Stored locally in VS Code secret storage and sent
  only to the provider they belong to.
- **Marketplace:** The Marketplace view (modes and MCP listings) is read from
  files bundled inside the extension (`assets/marketplace/*.yml`); opening it
  makes no network request. Installing an MCP server from it only writes the
  server entry to your MCP settings. Whatever that server then downloads or
  contacts when it starts (for example an `npx` package) is up to the server.
- **Provider attribution headers:** Some providers (for example OpenRouter)
  receive `HTTP-Referer: https://github.com/Randy420Marsh/Zoo-Code` and
  `X-Title: Zoo Code` headers, which identify the client application, not you.

## Your choices

- Run models locally to keep prompts and code off third-party servers.
- Uninstall the extension to stop all of its network activity.

## Verification

- `pnpm privacy:audit`, run after `pnpm vsix`, scans every file the VSIX
  packages (bundled extension, webview assets, source maps, bundled data) for
  telemetry SDKs, analytics and crash-reporting hosts, and social links. Any
  match in code or data fails the audit. Matches in shipped Markdown, such as
  the upstream CHANGELOG history, are listed as notes.
- The privacy test suite, `src/__tests__/privacy.spec.ts`, runs with
  `pnpm test`. It checks that no workspace manifest or lockfile entry is a
  telemetry SDK and that source contains no telemetry sender. It also checks
  that build-tool telemetry stays disabled.

## Build tools

Building from source does not report usage. Turborepo runs through
`scripts/turbo.mjs` with `TURBO_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1` and
`TURBO_NO_UPDATE_NOTIFIER=1`, and the CI workflows set the same variables. The
VS Code instances the e2e tests launch start with telemetry and the crash
reporter disabled. `pnpm install` still downloads the ripgrep binary from
GitHub in the `@vscode/ripgrep` postinstall step.

## Contact

Open an issue at
[Randy420Marsh/Zoo-Code/issues](https://github.com/Randy420Marsh/Zoo-Code/issues).
