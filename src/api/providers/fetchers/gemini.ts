import { z } from "zod"

import {
	type ModelInfo,
	type ModelRecord,
	geminiDefaultModelId,
	geminiModels,
	providerIdentifiers,
} from "@roo-code/types"
import { getCachedLlmsModelDescriptions } from "./providerLlmsCache"

import { DEFAULT_HEADERS } from "../constants"
import { throwIfAborted } from "../utils/abort-signal"

const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"
const GEMINI_MODELS_TIMEOUT_MS = 15_000

const geminiNativeModelSchema = z.object({
	name: z.string().min(1),
	version: z.string().optional(),
	displayName: z.string().optional(),
	description: z.string().optional(),
	inputTokenLimit: z.number().positive().optional(),
	outputTokenLimit: z.number().positive().optional(),
	supportedGenerationMethods: z.array(z.string()).optional(),
	temperature: z.number().optional(),
	maxTemperature: z.number().optional(),
	thinking: z.boolean().optional(),
})

const openAiStyleGeminiModelSchema = z.object({
	id: z.string().min(1),
	displayName: z.string().optional(),
	description: z.string().optional(),
	context_length: z.number().positive().optional(),
	max_completion_tokens: z.number().positive().optional(),
	inputTokenLimit: z.number().positive().optional(),
	outputTokenLimit: z.number().positive().optional(),
})

const geminiModelsResponseSchema = z.union([
	z.object({ models: z.array(geminiNativeModelSchema) }),
	z.object({ data: z.array(openAiStyleGeminiModelSchema) }),
])

export type GeminiNativeApiModel = z.infer<typeof geminiNativeModelSchema>
export type GeminiOpenAiApiModel = z.infer<typeof openAiStyleGeminiModelSchema>

function normalizeModelId(rawName: string): string {
	return rawName.trim().replace(/^models\//, "")
}

function resolveModelsEndpoint(baseUrl?: string): string {
	const raw = (baseUrl || GEMINI_DEFAULT_BASE_URL).trim().replace(/\/+$/, "")
	const base = raw.length > 0 ? raw : GEMINI_DEFAULT_BASE_URL
	if (base.endsWith("/v1")) {
		return `${base}/models`
	}
	if (base.endsWith("/v1beta")) {
		return `${base}/models?pageSize=1000`
	}
	return `${base}/v1beta/models?pageSize=1000`
}

function knownStaticInfo(modelId: string): ModelInfo | undefined {
	if (Object.hasOwn(geminiModels, modelId)) {
		return geminiModels[modelId as keyof typeof geminiModels]
	}
	return undefined
}

function defaultStructuralInfo(): ModelInfo {
	const fallback = geminiModels[geminiDefaultModelId]
	return {
		...fallback,
		inputPrice: undefined,
		outputPrice: undefined,
		cacheReadsPrice: undefined,
		cacheWritesPrice: undefined,
		tiers: undefined,
	}
}

export function mapGeminiApiModel(entry: {
	id: string
	displayName?: string
	description?: string
	inputTokenLimit?: number
	outputTokenLimit?: number
	temperature?: number
	thinking?: boolean
}): ModelInfo {
	const id = normalizeModelId(entry.id)
	const known = knownStaticInfo(id)
	const base = known ? { ...known } : defaultStructuralInfo()

	const lowerId = id.toLowerCase()
	const isImageGen = lowerId.includes("-image") || lowerId.includes("nano-banana") || lowerId.startsWith("imagen-")
	const isVideoGen = lowerId.startsWith("veo-") || lowerId.startsWith("gemini-omni-")
	const isTts = lowerId.includes("-tts")
	const isTranscribe = lowerId.includes("-transcribe")
	const isAudioGen =
		isTts || lowerId.includes("native-audio") || lowerId.startsWith("gemini-omni-") || lowerId.startsWith("lyria-")

	const supportsImages = known?.supportsImages ?? (!isVideoGen && !isTts && !isTranscribe)
	const supportsVideoInput = known?.supportsVideoInput ?? (!isImageGen && !isVideoGen && !isTts && !isTranscribe)
	const supportsAudioInput = known?.supportsAudioInput ?? (!isImageGen && !isVideoGen && !isTts)
	const supportsImageGeneration = known?.supportsImageGeneration ?? isImageGen
	const supportsVideoGeneration = known?.supportsVideoGeneration ?? isVideoGen
	const supportsAudioGeneration = known?.supportsAudioGeneration ?? isAudioGen

	return {
		...base,
		maxTokens: entry.outputTokenLimit ?? base.maxTokens ?? 65_536,
		contextWindow: entry.inputTokenLimit ?? base.contextWindow ?? 1_048_576,
		supportsImages,
		supportsVideoInput,
		supportsAudioInput,
		supportsImageGeneration,
		supportsVideoGeneration,
		supportsAudioGeneration,
		supportsPromptCache: base.supportsPromptCache ?? (!isImageGen && !isVideoGen && !isTts),
		...(entry.temperature !== undefined && known?.defaultTemperature === undefined
			? { defaultTemperature: entry.temperature }
			: {}),
		displayName: entry.displayName ?? base.displayName ?? id,
		description:
			entry.description ?? base.description ?? getCachedLlmsModelDescriptions(providerIdentifiers.gemini)[id],
	}
}

export async function getGeminiModels(
	apiKey?: string,
	baseUrl?: string,
	opts?: { signal?: AbortSignal },
): Promise<ModelRecord> {
	const resolvedKey = apiKey || process.env.GEMINI_API_KEY
	if (!resolvedKey) {
		throw new Error("Gemini API key is required to fetch models")
	}

	const controller = new AbortController()
	const timeout = setTimeout(
		() => controller.abort(new Error("Gemini models request timed out")),
		GEMINI_MODELS_TIMEOUT_MS,
	)
	const signal = opts?.signal
		? typeof AbortSignal.any === "function"
			? AbortSignal.any([opts.signal, controller.signal])
			: controller.signal
		: controller.signal

	try {
		const url = resolveModelsEndpoint(baseUrl)
		const isOpenAiEndpoint = url.endsWith("/v1/models")
		const headers: Record<string, string> = {
			Accept: "application/json",
			"x-goog-api-key": resolvedKey,
			...(isOpenAiEndpoint ? { Authorization: `Bearer ${resolvedKey}` } : {}),
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
			const error = new Error(`Gemini models request failed: HTTP ${response.status} ${response.statusText}`)
			;(error as Error & { status?: number; body?: string }).status = response.status
			;(error as Error & { status?: number; body?: string }).body = body
			throw error
		}

		const json = await response.json()
		const parsed = geminiModelsResponseSchema.parse(json)

		const models: ModelRecord = Object.create(null)
		if ("models" in parsed) {
			for (const entry of parsed.models) {
				if (
					entry.supportedGenerationMethods &&
					entry.supportedGenerationMethods.length > 0 &&
					!entry.supportedGenerationMethods.includes("generateContent") &&
					!entry.supportedGenerationMethods.includes("predict") &&
					!entry.supportedGenerationMethods.includes("bidiGenerateContent")
				) {
					continue
				}
				const id = normalizeModelId(entry.name)
				models[id] = mapGeminiApiModel({
					id,
					displayName: entry.displayName,
					description: entry.description,
					inputTokenLimit: entry.inputTokenLimit,
					outputTokenLimit: entry.outputTokenLimit,
					temperature: entry.temperature,
					thinking: entry.thinking,
				})
			}
		} else {
			for (const entry of parsed.data) {
				const id = normalizeModelId(entry.id)
				models[id] = mapGeminiApiModel({
					id,
					displayName: entry.displayName,
					description: entry.description,
					inputTokenLimit: entry.inputTokenLimit ?? entry.context_length,
					outputTokenLimit: entry.outputTokenLimit ?? entry.max_completion_tokens,
				})
			}
		}

		return models
	} finally {
		clearTimeout(timeout)
	}
}
