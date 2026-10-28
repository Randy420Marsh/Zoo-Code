import { v7 as uuidv7 } from "uuid"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type ModelInfo,
	type ModelRecord,
	type XAIModelId,
	xaiDefaultModelId,
	xaiModels,
	ApiProviderError,
	providerIdentifiers,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import type { ApiHandlerOptions, GetModelsOptions } from "../../shared/api"

import { ApiStream, type ApiStreamUsageChunk } from "../transform/stream"
import { convertToResponsesApiInput } from "../transform/responses-api-input"
import { processResponsesApiStream, createUsageNormalizer } from "../transform/responses-api-stream"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS, NOT_PROVIDED } from "./constants"
import { BaseProvider } from "./base-provider"
import {
	bridgeExternalAbortSignal,
	createAbortError,
	hasUsableTimeout,
	toSdkTimeoutMs,
	isRequestAborted,
} from "./utils/abort-signal"
import type {
	SingleCompletionHandler,
	ApiHandlerCreateMessageMetadata,
	CompletePromptOptions,
	ModelCacheScope,
} from "../index"
import { handleOpenAIError } from "./utils/error-handler"
import { isMcpTool } from "../../utils/mcp-name"
import { getModelsFromCache } from "./fetchers/modelCache"
import { getXaiModels } from "./fetchers/xai"

const XAI_DEFAULT_TEMPERATURE = 0

/** A Responses API output item (message, reasoning, function_call, ...). */
interface ResponsesOutputItem {
	type?: string
	encrypted_content?: string
	id?: string
	/** Required on replay. Replacing a non-empty summary is a modification of the blob item. */
	summary?: unknown[]
	/** Must not be replayed as JSON null; see reasoningItemForResponsesApi. */
	content?: unknown
}

/** Shape of the Responses API object returned when `stream` is false. */
interface NonStreamedResponses {
	output?: ResponsesOutputItem[]
	usage?: unknown
}

export class XAIHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private readonly providerName = "xAI"
	/** Live catalog from /v1/models (and cache); never silently rewrite the requested model id. */
	private models: ModelRecord = { ...xaiModels }
	/** Per-handler conversation id for xAI prompt-cache routing (x-grok-conv-id / prompt_cache_key). */
	private readonly convId: string
	/** Complete output array of the last response; reasoning items carry encrypted_content. */
	private lastResponseOutput: NonStreamedResponses["output"]

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.convId = uuidv7()

		const apiKey = this.options.xaiApiKey ?? NOT_PROVIDED

		this.client = new OpenAI({
			baseURL: "https://api.x.ai/v1",
			apiKey: apiKey,
			defaultHeaders: DEFAULT_HEADERS,
			timeout: this.timeoutMs,
		})

		// Do not fetch on construct. Modality flags come from the last manual Refresh models
		// cache (getModelsFromCache). A new request must not hit /v1/models.
		this.models = {
			...xaiModels,
			...(getModelsFromCache({ provider: providerIdentifiers.xai, apiKey: this.options.xaiApiKey }, this) ?? {}),
		}
	}

	override getModelCacheScope(): ModelCacheScope {
		return { urlScoped: false, keyScoped: true, authScoped: false }
	}

	async fetchModels(options: GetModelsOptions, signal?: AbortSignal): Promise<ModelRecord> {
		const fetchOpts: [] | [{ signal: AbortSignal }] = signal ? [{ signal }] : []
		return getXaiModels(options.apiKey, options.baseUrl, ...fetchOpts)
	}

	/**
	 * Resolve ModelInfo for the exact requested id.
	 * - Prefer live / cached dynamic entry.
	 * - Else static catalog entry.
	 * - Else structural defaults WITHOUT rewriting the id (no silent grok-4.5 fallback).
	 */
	private resolveModelInfo(modelId: string): ModelInfo {
		const live = this.models[modelId]
		if (live) {
			return live
		}
		const known = xaiModels[modelId as XAIModelId]
		if (known) {
			return known
		}
		const fallback = xaiModels[xaiDefaultModelId]
		return {
			...fallback,
			maxTokens: fallback.maxTokens ?? 65_536,
			// Unknown id: do not bill at default rates; vision off until live catalog says otherwise.
			supportsImages: false,
			inputPrice: undefined,
			outputPrice: undefined,
			cacheReadsPrice: undefined,
			cacheWritesPrice: undefined,
			description: `xAI model ${modelId} (not in local catalog; send as-is to the API).`,
		}
	}

	override getModel() {
		// Preserve the user-selected model id exactly. Never substitute xaiDefaultModelId
		// when the id is absent from the static map — that caused silent grok-4.5 fallbacks
		// and disabled image/reasoning UI for newer models like grok-4.7.
		const id = this.options.apiModelId?.trim() || xaiDefaultModelId
		const baseInfo = this.resolveModelInfo(id)
		// An unset xaiAllow* toggle leaves the catalog flag untouched (previously
		// working configurations keep working); an explicit toggle overrides it.
		// This mirrors the webview gating in useSelectedModel and keeps image
		// attachment in sync with the UI.
		const info: ModelInfo = { ...baseInfo }
		if (this.options.xaiAllowImageInput === false) {
			info.supportsImages = false
		}
		if (this.options.xaiAllowVideoInput === false) {
			info.supportsVideoInput = false
		}
		if (this.options.xaiAllowAudioInput === false) {
			info.supportsAudioInput = false
		}
		if (this.options.xaiAllowImageGeneration !== undefined) {
			info.supportsImageGeneration = this.options.xaiAllowImageGeneration === true
		}
		if (this.options.xaiAllowVideoGeneration !== undefined) {
			info.supportsVideoGeneration = this.options.xaiAllowVideoGeneration === true
		}
		if (this.options.xaiAllowAudioGeneration !== undefined) {
			info.supportsAudioGeneration = this.options.xaiAllowAudioGeneration === true
		}
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: XAI_DEFAULT_TEMPERATURE,
		})
		return { id, info, ...params }
	}

	/**
	 * Convert tools from OpenAI Chat Completions format to Responses API format.
	 * Chat Completions: { type: "function", function: { name, description, parameters } }
	 * Responses API: { type: "function", name, description, parameters }
	 *
	 * Uses base provider's convertToolSchemaForOpenAI() for schema hardening
	 * (additionalProperties: false, ensureAllRequired) and handles MCP tools.
	 */
	private mapResponseTools(tools?: any[]): any[] | undefined {
		const converted = this.convertToolsForOpenAI(tools)
		if (!converted?.length) {
			return undefined
		}
		return converted
			.filter((tool) => tool?.type === "function")
			.map((tool) => {
				const isMcp = isMcpTool(tool.function.name)
				return {
					type: "function",
					name: tool.function.name,
					description: tool.function.description,
					parameters: isMcp
						? tool.function.parameters
						: this.convertToolSchemaForOpenAI(tool.function.parameters),
					strict: !isMcp,
				}
			})
	}

	/**
	 * Pass the stream through, retaining the final output array when
	 * response.completed arrives so reasoning items with encrypted_content
	 * survive for the next turn of the conversation.
	 */
	private async *captureCompletedEvents(stream: AsyncIterable<unknown>): AsyncGenerator<unknown> {
		for await (const event of stream) {
			const completed = event as { type?: string; response?: { output?: unknown } }
			const output = completed.response?.output
			if (completed.type === "response.completed" && Array.isArray(output)) {
				this.lastResponseOutput = output
			}
			yield event
		}
	}

	/**
	 * Re-expose a non-streamed Responses API response as ApiStream chunks
	 * (text, reasoning, tool_call, usage), matching what
	 * processResponsesApiStream emits in streaming mode.
	 */
	private async *convertNonStreamedResponse(
		response: NonStreamedResponses,
		normalizeUsage: (usage: unknown) => ApiStreamUsageChunk | undefined,
	): ApiStream {
		const output: unknown[] = response.output ?? []
		for (const raw of output) {
			const item = raw as {
				type?: string
				content?: unknown[]
				summary?: unknown[]
				call_id?: string
				tool_call_id?: string
				id?: string
				name?: string
				arguments?: unknown
				input?: unknown
			}
			switch (item?.type) {
				case "message": {
					const parts: unknown[] = Array.isArray(item.content) ? item.content : []
					for (const rawPart of parts) {
						const part = rawPart as { type?: string; text?: unknown }
						if (part?.type === "output_text" && typeof part.text === "string") {
							yield { type: "text", text: part.text }
						}
					}
					break
				}
				case "reasoning": {
					const summaries: unknown[] = Array.isArray(item.summary) ? item.summary : []
					for (const rawSummary of summaries) {
						const summary = rawSummary as { type?: string; text?: unknown }
						if (summary?.type === "summary_text" && typeof summary.text === "string") {
							yield { type: "reasoning", text: summary.text }
						}
					}
					break
				}
				case "function_call":
				case "tool_call": {
					const callId = item.call_id || item.tool_call_id || item.id
					const name = item.name
					const argsRaw = item.arguments ?? item.input
					const args = typeof argsRaw === "string" ? argsRaw : argsRaw != null ? JSON.stringify(argsRaw) : ""
					if (callId && name) {
						yield { type: "tool_call", id: callId, name, arguments: args }
					}
					break
				}
			}
		}
		const usage = normalizeUsage(response.usage)
		if (usage) {
			yield usage
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const model = this.getModel()

		// Convert directly from Anthropic format to Responses API input format
		const input = convertToResponsesApiInput(messages)
		const responseTools = this.mapResponseTools(metadata?.tools)

		// Bridge the external abort signal from request metadata into a per-request
		// controller so the SDK call is cancelled when the owning request is aborted
		// (or when the signal is already aborted). Without an external signal the
		// client-level timeout configured in the constructor remains the only
		// cancellation mechanism, preserving the existing behavior.
		const externalAbortSignal = metadata?.abortSignal
		const { signal: abortSignal, dispose: removeExternalAbortListener } =
			bridgeExternalAbortSignal(externalAbortSignal)

		// Build request options
		const requestBody: Record<string, any> = {
			model: model.id,
			instructions: systemPrompt,
			input: input,
			// xAI supports SSE streaming for all text-output models. The chat loop
			// expects a stream, so the toggle defaults on; false returns one
			// complete response that we re-expose as ApiStream chunks.
			stream: this.options.xaiStreaming !== false,
			store: false, // Don't store responses server-side for privacy
			include: ["reasoning.encrypted_content"],
			// Responses API sticky routing. Same value as the x-grok-conv-id header so
			// a task resumed on a new handler still lands on the server that holds
			// its cache. One-shot calls without a taskId use the handler id.
			prompt_cache_key: metadata?.taskId || this.convId,
		}

		if (model.maxTokens) {
			requestBody.max_output_tokens = model.maxTokens
		}

		if (model.temperature !== undefined) {
			requestBody.temperature = model.temperature
		}

		if (responseTools) {
			requestBody.tools = responseTools
			// Cast tool_choice since metadata uses Chat Completions types but Responses API has its own type
			requestBody.tool_choice = (metadata?.tool_choice ?? "auto") as any
			requestBody.parallel_tool_calls = metadata?.parallelToolCalls ?? true
		}

		// Pass reasoning effort for models that support it (e.g., grok-4.5, grok-3-mini).
		// The xAI Responses API uses `reasoning: { effort }` format (not `reasoning_effort`
		// which is the Chat Completions format), so we convert from the OpenAI params shape.
		if (model.reasoning) {
			requestBody.reasoning = { effort: model.reasoning.reasoning_effort }
		}

		const streaming = requestBody.stream
		const normalizeUsage = createUsageNormalizer()
		// xAI stores cache entries per server. The header is what the docs require
		// for sticky routing; prompt_cache_key is the Responses-body equivalent.
		// Both must be the task id, or a resumed task lands on a different server.
		const cacheKey = metadata?.taskId || this.convId
		const requestOptions: OpenAI.RequestOptions = {
			headers: { "x-grok-conv-id": cacheKey },
			...(abortSignal ? { signal: abortSignal } : {}),
		}
		try {
			let response: unknown
			try {
				response = await this.client.responses.create(requestBody as any, requestOptions)
			} catch (error) {
				// Normalize cancellations to the contract error: the OpenAI SDK's
				// APIUserAbortError carries name "Error" and message "Request was
				// aborted.", so rethrowing it raw would leak a non-conforming shape to
				// the caller's AbortError guard.
				if (isRequestAborted(error, abortSignal)) {
					throw createAbortError(this.providerName)
				}
				const errorMessage = error instanceof Error ? error.message : String(error)
				const apiError = new ApiProviderError(errorMessage, this.providerName, model.id, "createMessage")
				TelemetryService.instance.captureException(apiError)
				throw handleOpenAIError(error, this.providerName)
			}

			try {
				if (streaming) {
					// Tee response.completed so the final output array (reasoning
					// items carry encrypted_content) is retained for
					// getEncryptedContent() on later turns.
					yield* processResponsesApiStream(
						this.captureCompletedEvents(response as AsyncIterable<any>),
						normalizeUsage,
					)
				} else {
					// Non-streamed: the complete response carries the full output
					// array, so capture it for encrypted reasoning continuity.
					const complete = response as NonStreamedResponses
					this.lastResponseOutput = complete.output
					yield* this.convertNonStreamedResponse(complete, normalizeUsage)
				}
			} catch (error) {
				// An abort landing after responses.create resolved surfaces here as
				// the SDK's APIUserAbortError thrown from stream iteration (name
				// "Error", message "Request was aborted."), outside the create
				// catch above. Normalize it to the contract AbortError too, so
				// callers never classify a cancellation as a provider failure.
				if (isRequestAborted(error, abortSignal)) {
					throw createAbortError(this.providerName)
				}
				throw error
			}
		} finally {
			// Release the listener once the stream is consumed, whether the
			// request completed, failed, or the generator was closed early.
			removeExternalAbortListener?.()
		}
	}

	async completePrompt(prompt: string, options?: CompletePromptOptions): Promise<string> {
		const model = this.getModel()

		try {
			// Build request options with abortSignal and/or timeout handling
			const requestOptions: OpenAI.RequestOptions = {}
			if (options?.abortSignal) {
				requestOptions.signal = options.abortSignal
			}
			const timeoutMs = options?.timeoutMs
			// Only a usable finite positive timeout may be forwarded: the SDKs treat
			// timeout: 0 as an immediate abort and throw on negative/non-finite values.
			// Fractional delays are rounded up, matching mergeAbortSignalAndTimeout.
			if (hasUsableTimeout(timeoutMs)) {
				requestOptions.timeout = toSdkTimeoutMs(timeoutMs)
			}

			requestOptions.headers = { "x-grok-conv-id": this.convId }
			const response = await this.client.responses.create(
				{
					model: model.id,
					input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
					store: false,
					prompt_cache_key: this.convId,
				},
				requestOptions,
			)

			// Retain the complete output array for encrypted reasoning continuity.
			const complete = response as unknown as NonStreamedResponses
			this.lastResponseOutput = complete.output

			// output_text is a convenience field on the Responses API response
			return response.output_text || ""
		} catch (error) {
			// Normalize cancellations to the contract error: the OpenAI SDK's
			// APIUserAbortError carries name "Error" and message "Request was
			// aborted.", so rethrowing it raw would leak a non-conforming shape to
			// the caller's AbortError guard.
			if (isRequestAborted(error, options?.abortSignal)) {
				throw createAbortError(this.providerName)
			}
			const errorMessage = error instanceof Error ? error.message : String(error)
			const apiError = new ApiProviderError(errorMessage, this.providerName, model.id, "completePrompt")
			TelemetryService.instance.captureException(apiError)
			throw handleOpenAIError(error, this.providerName)
		}
	}

	/**
	 * Extracts encrypted_content and id from the first reasoning item in the last
	 * response's output array. This is the minimal data needed for stateless API
	 * continuity: xAI reasoning models must receive the prior reasoning content
	 * back to keep the cached chain valid.
	 */
	getEncryptedContent(): { encrypted_content: string; id?: string; summary?: unknown[] } | undefined {
		if (!this.lastResponseOutput) {
			return undefined
		}

		const reasoningItem = this.lastResponseOutput.find(
			(item: ResponsesOutputItem) => item?.type === "reasoning" && item?.encrypted_content,
		)

		if (!reasoningItem?.encrypted_content) {
			return undefined
		}

		return {
			encrypted_content: reasoningItem.encrypted_content,
			...(reasoningItem.id ? { id: reasoningItem.id } : {}),
			// Keep the provider's summary. Substituting [] is a modification of the
			// item xAI decodes the compaction blob from. content is intentionally
			// omitted: a null content key is itself a 400.
			...(Array.isArray(reasoningItem.summary) ? { summary: reasoningItem.summary } : {}),
		}
	}
}
