import { useQuery } from "@tanstack/react-query"

import {
	type ExtensionMessage,
	type OpenAiCompatibleServerInfo,
	OpenAiCompatibleServerInfoMessageType,
} from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

const REQUEST_TIMEOUT_MS = 10_000

const requestServerInfo = (baseUrl: string, apiKey?: string) =>
	new Promise<OpenAiCompatibleServerInfo | null>((resolve, reject) => {
		const cleanup = () => window.removeEventListener("message", handler)

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("OpenAI Compatible server info request timed out"))
		}, REQUEST_TIMEOUT_MS)

		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === OpenAiCompatibleServerInfoMessageType.openAiCompatibleServerInfo) {
				clearTimeout(timeout)
				cleanup()
				// An endpoint without `/props` reports nothing; null keeps that cached as a
				// real answer rather than an error React Query would retry.
				resolve(message.openAiCompatibleServerInfo ?? null)
			}
		}

		window.addEventListener("message", handler)

		vscode.postMessage({
			type: OpenAiCompatibleServerInfoMessageType.requestOpenAiCompatibleServerInfo,
			values: { baseUrl, apiKey },
		})
	})

/**
 * What the OpenAI-compatible endpoint at `baseUrl` says about its chat template.
 *
 * Used to narrow the reasoning levels on offer to the ones the server's template
 * actually accepts - a level it doesn't know about comes back as a provider error.
 */
export const useOpenAiCompatibleServerInfo = (baseUrl?: string, apiKey?: string, enabled = true) =>
	useQuery({
		queryKey: ["openAiCompatibleServerInfo", baseUrl],
		queryFn: () => requestServerInfo(baseUrl!, apiKey),
		enabled: enabled && !!baseUrl,
		staleTime: 5 * 60 * 1_000,
		retry: false,
	})
