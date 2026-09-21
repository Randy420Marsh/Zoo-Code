import { Anthropic } from "@anthropic-ai/sdk"
import { Tiktoken } from "tiktoken/lite"
import o200kBase from "tiktoken/encoders/o200k_base"

/**
 * Default multiplier applied to tiktoken counts to compensate for the fact that
 * the o200k_base BPE is not the model's own tokenizer. The local estimate feeds
 * budgeting decisions (condense chunk packing, auto-condense threshold math,
 * provider usage fallbacks), so a constant 50% inflation systematically biases
 * them. Providers whose server reports exact usage set this to 1.0 (via
 * `tokenFudgeFactor`) to keep their local estimates unbiased.
 */
export const DEFAULT_TIKTOKEN_FUDGE_FACTOR = 1.5

let encoder: Tiktoken | null = null

/**
 * Serializes a tool_use block to text for token counting.
 * Approximates how the API sees the tool call.
 */
function serializeToolUse(block: Anthropic.Messages.ToolUseBlockParam): string {
	const parts = [`Tool: ${block.name}`]
	if (block.input !== undefined) {
		try {
			parts.push(`Arguments: ${JSON.stringify(block.input)}`)
		} catch {
			parts.push(`Arguments: [serialization error]`)
		}
	}
	return parts.join("\n")
}

/**
 * Serializes a tool_result block to text for token counting.
 * Handles both string content and array content.
 */
function serializeToolResult(block: Anthropic.Messages.ToolResultBlockParam): string {
	const parts = [`Tool Result (${block.tool_use_id})`]

	if (block.is_error) {
		parts.push(`[Error]`)
	}

	const content = block.content
	if (typeof content === "string") {
		parts.push(content)
	} else if (Array.isArray(content)) {
		// Handle array of content blocks recursively
		for (const item of content) {
			if (item.type === "text") {
				parts.push(item.text || "")
			} else if (item.type === "image") {
				parts.push("[Image content]")
			} else {
				parts.push(`[Unsupported content block: ${String((item as { type?: unknown }).type)}]`)
			}
		}
	}

	return parts.join("\n")
}

export type TiktokenOptions = {
	/**
	 * Multiplier applied to the raw tiktoken count. Defaults to
	 * {@link DEFAULT_TIKTOKEN_FUDGE_FACTOR}. Pass 1.0 for providers whose
	 * server reports exact usage, so budgeting estimates (condense chunk
	 * packing, auto-condense thresholds) are not systematically inflated.
	 */
	fudgeFactor?: number
}

export async function tiktoken(
	content: Anthropic.Messages.ContentBlockParam[],
	options?: TiktokenOptions,
): Promise<number> {
	const fudgeFactor = options?.fudgeFactor ?? DEFAULT_TIKTOKEN_FUDGE_FACTOR
	if (content.length === 0) {
		return 0
	}

	let totalTokens = 0

	// Lazily create and cache the encoder if it doesn't exist.
	if (!encoder) {
		encoder = new Tiktoken(o200kBase.bpe_ranks, o200kBase.special_tokens, o200kBase.pat_str)
	}

	// Process each content block using the cached encoder.
	for (const block of content) {
		if (block.type === "text") {
			const text = block.text || ""

			if (text.length > 0) {
				const tokens = encoder.encode(text, undefined, [])
				totalTokens += tokens.length
			}
		} else if (block.type === "image") {
			// For images, calculate based on data size.
			const imageSource = block.source

			if (imageSource && typeof imageSource === "object" && "data" in imageSource) {
				const base64Data = imageSource.data as string
				totalTokens += Math.ceil(Math.sqrt(base64Data.length))
			} else {
				totalTokens += 300 // Conservative estimate for unknown images
			}
		} else if (block.type === "tool_use") {
			// Serialize tool_use block to text and count tokens
			const serialized = serializeToolUse(block as Anthropic.Messages.ToolUseBlockParam)
			if (serialized.length > 0) {
				const tokens = encoder.encode(serialized, undefined, [])
				totalTokens += tokens.length
			}
		} else if (block.type === "tool_result") {
			// Serialize tool_result block to text and count tokens
			const serialized = serializeToolResult(block as Anthropic.Messages.ToolResultBlockParam)
			if (serialized.length > 0) {
				const tokens = encoder.encode(serialized, undefined, [])
				totalTokens += tokens.length
			}
		}
	}

	// Apply the fudge factor to account for the fact that tiktoken is not
	// accurate for foreign tokenizers (the encoder is o200k_base, not the
	// target model's BPE). The result feeds budgeting decisions, so its bias
	// is a real behavior change, not just an estimate error.
	return Math.ceil(totalTokens * fudgeFactor)
}
