import { z } from "zod"

import {
	type ModelInfo,
	type ModelRecord,
	type ReasoningEffortExtended,
	xaiDefaultModelId,
	xaiModels,
} from "@roo-code/types"

import { DEFAULT_HEADERS } from "../constants"
import { throwIfAborted } from "../utils/abort-signal"

/** xAI documents prices as integer micro-units where 10_000 == $1.00 per 1M tokens. */
const XAI_PRICE_PER_MILLION_DIVISOR = 10_000

const XAI_DEFAULT_BASE_URL = "https://api.x.ai/v1"
const XAI_MODELS_TIMEOUT_MS = 15_000

/** Chat/completions models only — skip Imagine image/video generation endpoints. */
const XAI_NON_CHAT_MODEL_PREFIXES = ["grok-imagine-"] as const

const xaiReasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "disable"])

const xaiModelSchema = z.object({
	id: z.string().min(1),
	object: z.string().optional(),
	owned_by: z.string().optional(),
	created: z.number().optional(),
	aliases: z.array(z.string()).optional(),
	context_length: z.number().positive().optional(),
	prompt_text_token_price: z.number().nonnegative().optional(),
	cached_prompt_text_token_price: z.number().nonnegative().optional(),
	prompt_image_token_price: z.number().nonnegative().nullish(),
	completion_text_token_price: z.number().nonnegative().optional(),
	prompt_text_token_price_long_context: z.number().nonnegative().optional(),
	cached_prompt_text_token_price_long_context: z.number().nonnegative().optional(),
	completion_text_token_price_long_context: z.number().nonnegative().optional(),
	long_context_threshold: z.number().positive().optional(),
	capabilities: z
		.object({
			reasoning_effort: z.array(xaiReasoningEffortSchema).optional(),
			default_reasoning_effort: xaiReasoningEffortSchema.optional(),
		})
		.optional(),
})

const xaiModelsResponseSchema = z.object({
	data: z.array(xaiModelSchema),
})

export type XaiApiModel = z.infer<typeof xaiModelSchema>

export function isXaiChatModelId(modelId: string): boolean {
	return !XAI_NON_CHAT_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix))
}

export function xaiPriceToDollarsPerMillion(price: number | undefined): number | undefined {
	if (price === undefined || !Number.isFinite(price) || price < 0) {
		return undefined
	}
	return price / XAI_PRICE_PER_MILLION_DIVISOR
}

function normalizeBaseUrl(baseUrl?: string): string {
	const raw = (baseUrl || XAI_DEFAULT_BASE_URL).trim().replace(/\/+$/, "")
	return raw.length > 0 ? raw : XAI_DEFAULT_BASE_URL
}

function knownStaticInfo(modelId: string): ModelInfo | undefined {
	return xaiModels[modelId as keyof typeof xaiModels]
}

function defaultStructuralInfo(): ModelInfo {
	const fallback = xaiModels[xaiDefaultModelId]
	return {
		...fallback,
		// Unknown dynamic IDs must not inherit default pricing (would mis-report cost).
		inputPrice: undefined,
		outputPrice: undefined,
		cacheReadsPrice: undefined,
		cacheWritesPrice: undefined,
		maxTokens: fallback.maxTokens ?? 65_536,
	}
}

/**
 * Map one xAI /v1/models (or /v1/models/{id}) entry to ModelInfo.
 * Prefer live API fields; fill gaps from the static catalog when the ID is known.
 */
export function mapXaiApiModel(model: XaiApiModel): ModelInfo {
	const known = knownStaticInfo(model.id)
	const base = known ? { ...known } : defaultStructuralInfo()

	const inputPrice = xaiPriceToDollarsPerMillion(model.prompt_text_token_price) ?? base.inputPrice
	const outputPrice = xaiPriceToDollarsPerMillion(model.completion_text_token_price) ?? base.outputPrice
	const cacheReadsPrice = xaiPriceToDollarsPerMillion(model.cached_prompt_text_token_price) ?? base.cacheReadsPrice
	// xAI list endpoint does not separate cache-write pricing; keep static when present.
	const cacheWritesPrice = base.cacheWritesPrice ?? cacheReadsPrice

	const reasoningEfforts = model.capabilities?.reasoning_effort
	const defaultEffort = model.capabilities?.default_reasoning_effort

	const supportsReasoningEffort: ModelInfo["supportsReasoningEffort"] = reasoningEfforts?.length
		? (reasoningEfforts as ReasoningEffortExtended[])
		: base.supportsReasoningEffort

	const reasoningEffort =
		defaultEffort && supportsReasoningEffort && Array.isArray(supportsReasoningEffort)
			? supportsReasoningEffort.includes(defaultEffort as ReasoningEffortExtended)
				? (defaultEffort as ReasoningEffortExtended)
				: base.reasoningEffort
			: base.reasoningEffort

	// Image input: list payload sets prompt_image_token_price on vision chat models.
	// grok-4.7 docs: text and image input, text output. Video/audio input are not reported.
	const supportsImages =
		model.prompt_image_token_price != null
			? true
			: known?.supportsImages !== undefined
				? known.supportsImages
				: false
	const supportsImageGeneration = model.id.startsWith("grok-imagine-image")
	const supportsVideoGeneration = model.id.startsWith("grok-imagine-video")
	const supportsAudioGeneration = model.id.startsWith("grok-voice")

	const aliasNote =
		model.aliases && model.aliases.length > 0 ? ` Aliases: ${model.aliases.slice(0, 6).join(", ")}.` : ""

	return {
		...base,
		contextWindow: model.context_length ?? base.contextWindow,
		supportsImages,
		supportsVideoInput: false,
		supportsAudioInput: false,
		supportsImageGeneration,
		supportsVideoGeneration,
		supportsAudioGeneration,
		supportsPromptCache: base.supportsPromptCache ?? true,
		inputPrice,
		outputPrice,
		cacheReadsPrice,
		cacheWritesPrice,
		supportsReasoningEffort,
		reasoningEffort,
		description:
			base.description ??
			`xAI model ${model.id} (${model.context_length ?? "unknown"} context).${aliasNote}`.trim(),
		displayName: model.id,
	}
}

async function fetchXaiJson(url: string, apiKey: string, signal?: AbortSignal): Promise<unknown> {
	const headers: Record<string, string> = {
		Accept: "application/json",
		"Content-Type": "application/json",
		Authorization: `Bearer ${apiKey}`,
		...DEFAULT_HEADERS,
	}

	const response = await fetch(url, { headers, signal })

	if (!response.ok) {
		throwIfAborted(signal)
		let body = ""
		try {
			body = await response.text()
		} catch {
			body = "(unable to read response body)"
		}
		const error = new Error(`xAI models request failed: HTTP ${response.status} ${response.statusText}`)
		;(error as Error & { status?: number; body?: string }).status = response.status
		;(error as Error & { status?: number; body?: string }).body = body
		throw error
	}

	return response.json()
}

/**
 * GET https://api.x.ai/v1/models/{id} — single-model details (same shape as list entries).
 */
export async function getXaiModelDetails(
	modelId: string,
	apiKey: string,
	baseUrl?: string,
	opts?: { signal?: AbortSignal },
): Promise<ModelInfo> {
	if (!apiKey) {
		throw new Error("xAI API key is required to fetch model details")
	}
	if (!modelId?.trim()) {
		throw new Error("xAI model id is required")
	}

	const controller = new AbortController()
	const timeout = setTimeout(
		() => controller.abort(new Error("xAI model details request timed out")),
		XAI_MODELS_TIMEOUT_MS,
	)
	const signal = opts?.signal
		? typeof AbortSignal.any === "function"
			? AbortSignal.any([opts.signal, controller.signal])
			: controller.signal
		: controller.signal

	try {
		const url = `${normalizeBaseUrl(baseUrl)}/models/${encodeURIComponent(modelId.trim())}`
		const json = await fetchXaiJson(url, apiKey, signal)
		const parsed = xaiModelSchema.parse(json)
		return mapXaiApiModel(parsed)
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * GET https://api.x.ai/v1/models — live chat model catalog.
 * Merges API fields with the static xaiModels fallback for known IDs.
 * Filters out Imagine image/video generation models.
 */
export async function getXaiModels(
	apiKey?: string,
	baseUrl?: string,
	opts?: { signal?: AbortSignal },
): Promise<ModelRecord> {
	if (!apiKey) {
		throw new Error("xAI API key is required to fetch models")
	}

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(new Error("xAI models request timed out")), XAI_MODELS_TIMEOUT_MS)
	const signal = opts?.signal
		? typeof AbortSignal.any === "function"
			? AbortSignal.any([opts.signal, controller.signal])
			: controller.signal
		: controller.signal

	try {
		const url = `${normalizeBaseUrl(baseUrl)}/models`
		const json = await fetchXaiJson(url, apiKey, signal)
		const parsed = xaiModelsResponseSchema.parse(json)

		const models: ModelRecord = Object.create(null)
		for (const entry of parsed.data) {
			// Keep generation models in the refresh cache so toggles can read reported support.
			// The chat picker filters them out unless the matching generation toggle is on.
			models[entry.id] = mapXaiApiModel(entry)
		}

		return models
	} finally {
		clearTimeout(timeout)
	}
}
