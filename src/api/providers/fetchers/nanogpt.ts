import axios from "axios"
import { z } from "zod"

import { NANOGPT_BASE_URL, nanoGptDefaultModelInfo, type ModelInfo, type ModelRecord } from "@roo-code/types"

import { throwIfAborted } from "../utils/abort-signal"

const nanoGptReasoningEfforts: NonNullable<ModelInfo["supportsReasoningEffort"]> = ["low", "medium", "high"]
const nanoGptReasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
const nanoGptAstraModelIds = new Set(["openai/gpt-6-astra", "openai/gpt-6-astra-pro"])

const nanoGptPricingSchema = z
	.object({
		prompt: z.number().nonnegative().nullish(),
		completion: z.number().nonnegative().nullish(),
		cacheReadInputPer1kTokens: z.number().nonnegative().nullish(),
		cacheWriteInputPer1kTokens: z.number().nonnegative().nullish(),
	})
	.nullish()

const nanoGptModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().nullish(),
	description: z.string().nullish(),
	context_length: z.number().nonnegative().nullish(),
	max_output_tokens: z.number().nonnegative().nullish(),
	reasoning_efforts: z.array(nanoGptReasoningEffortSchema).nullish(),
	capabilities: z
		.object({
			vision: z.boolean().nullish(),
			tool_calling: z.boolean().nullish(),
			reasoning: z.boolean().nullish(),
		})
		.nullish(),
	pricing: nanoGptPricingSchema,
})

export type NanoGptModel = z.infer<typeof nanoGptModelSchema>

function getSafeErrorMessage(error: unknown, apiKey?: string): string {
	const message = error instanceof Error ? error.message : String(error)
	return apiKey ? message.replaceAll(apiKey, "[REDACTED]") : message
}

const nanoGptModelsResponseSchema = z.object({
	data: z.array(z.unknown()),
})

export const parseNanoGptModel = (model: NanoGptModel): ModelInfo => ({
	contextWindow:
		model.context_length && model.context_length > 0 ? model.context_length : nanoGptDefaultModelInfo.contextWindow,
	maxTokens:
		model.max_output_tokens && model.max_output_tokens > 0
			? model.max_output_tokens
			: nanoGptDefaultModelInfo.maxTokens,
	supportsPromptCache: false,
	...(model.capabilities?.vision != null ? { supportsImages: model.capabilities.vision } : {}),
	...(model.capabilities?.reasoning != null
		? {
				supportsReasoningEffort: model.capabilities.reasoning
					? (model.reasoning_efforts ?? [...nanoGptReasoningEfforts])
					: false,
			}
		: {}),
	...(model.name != null ? { displayName: model.name } : {}),
	...(model.description != null ? { description: model.description } : {}),
	...(model.pricing?.prompt != null ? { inputPrice: model.pricing.prompt } : {}),
	...(model.pricing?.completion != null ? { outputPrice: model.pricing.completion } : {}),
	...(model.pricing?.cacheReadInputPer1kTokens != null
		? { cacheReadsPrice: model.pricing.cacheReadInputPer1kTokens * 1_000 }
		: {}),
	...(model.pricing?.cacheWriteInputPer1kTokens != null
		? { cacheWritesPrice: model.pricing.cacheWriteInputPer1kTokens * 1_000 }
		: {}),
	...(nanoGptAstraModelIds.has(model.id)
		? {
				supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"] as const,
				requiredReasoningEffort: true,
				reasoningEffort: "medium" as const,
				supportsTemperature: false,
			}
		: {}),
})

/** Fetches NanoGPT's public detailed catalog, optionally scoped by a Bearer key. */
export async function getNanoGptModels(apiKey?: string, opts?: { signal?: AbortSignal }): Promise<ModelRecord> {
	try {
		const response = await axios.get(`${NANOGPT_BASE_URL}/models?detailed=true`, {
			headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
			signal: opts?.signal,
		})
		const responseResult = nanoGptModelsResponseSchema.safeParse(response.data)
		if (!responseResult.success) {
			console.warn("NanoGPT models response did not match the expected top-level schema")
			return {}
		}

		const models: ModelRecord = {}
		for (const rawModel of responseResult.data.data) {
			const modelResult = nanoGptModelSchema.safeParse(rawModel)
			if (!modelResult.success) {
				console.warn("Skipping invalid NanoGPT model entry")
				continue
			}

			// NanoGPT can route to non-agentic models. An explicit false is authoritative;
			// an omitted capability remains unknown and therefore eligible.
			if (modelResult.data.capabilities?.tool_calling === false) {
				continue
			}

			models[modelResult.data.id] = parseNanoGptModel(modelResult.data)
		}

		return models
	} catch (error) {
		// Surface cancellation as a rejection: logging and returning here would
		// present an aborted fetch to callers as a successful (empty) catalog.
		throwIfAborted(opts?.signal)

		console.error(`Error fetching NanoGPT models: ${getSafeErrorMessage(error, apiKey)}`)
		return {}
	}
}
