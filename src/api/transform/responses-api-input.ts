import { Anthropic } from "@anthropic-ai/sdk"

/**
 * Wire shape xAI decodes a compaction blob from. OpenAI's Responses schema
 * requires `type`, `id`, and `summary` on a reasoning item
 * (openai/resources/responses ResponseReasoningItem). xAI returns 400
 * "Could not decode the compaction blob" when `summary` is omitted, when a
 * present `id` is omitted, or when `content` is JSON null (the key must be
 * absent, not null). Verified live against grok-4.7 for the summary/id cases;
 * content:null is the same error (openai/codex#47733).
 */
function reasoningItemForResponsesApi(item: {
	encrypted_content: string
	id?: string
	summary?: unknown
	content?: unknown
}): { type: "reasoning"; encrypted_content: string; summary: unknown[]; id?: string; content?: unknown[] } {
	return {
		type: "reasoning",
		encrypted_content: item.encrypted_content,
		summary: Array.isArray(item.summary) ? item.summary : [],
		...(typeof item.id === "string" && item.id.length > 0 ? { id: item.id } : {}),
		// Pass a real content array through unchanged. Never emit content: null.
		...(Array.isArray(item.content) ? { content: item.content } : {}),
	}
}

/**
 * Converts Anthropic-format messages to the OpenAI Responses API input format.
 *
 * Key differences from Chat Completions format:
 * - Content parts use { type: "input_text" } instead of { type: "text" }
 * - Images use { type: "input_image" } instead of { type: "image_url" }
 * - Tool results use { type: "function_call_output", call_id } instead of { role: "tool", tool_call_id }
 * - Tool uses become { type: "function_call", call_id, name, arguments } items
 * - System prompt goes via the `instructions` parameter, not as a message
 *
 * @param messages - Array of Anthropic MessageParam objects
 * @returns Array of Responses API input items
 */
export function convertToResponsesApiInput(messages: Anthropic.Messages.MessageParam[]): any[] {
	const input: any[] = []

	for (const message of messages) {
		// Standalone reasoning items (e.g. xAI/OpenAI encrypted reasoning) must be
		// sent back unchanged so the model keeps its reasoning across turns. xAI
		// decodes the compaction blob from the full item shape: dropping even an
		// empty `summary` (or a present `id`) yields 400 "Could not decode the
		// compaction blob" — verified live against grok-4.7.
		const item = message as unknown as {
			type?: string
			encrypted_content?: string
			id?: string
			summary?: unknown
			content?: unknown
		}
		if (
			item.type === "reasoning" &&
			typeof item.encrypted_content === "string" &&
			item.encrypted_content.length > 0
		) {
			input.push(
				reasoningItemForResponsesApi({
					encrypted_content: item.encrypted_content,
					id: item.id,
					summary: item.summary,
					content: item.content,
				}),
			)
			continue
		}

		if (typeof message.content === "string") {
			if (message.role === "assistant") {
				// Assistant messages use output_text in the Responses API format
				input.push({
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: message.content }],
				})
			} else {
				input.push({
					role: message.role,
					content: [{ type: "input_text", text: message.content }],
				})
			}
			continue
		}

		if (message.role === "assistant") {
			for (const part of message.content) {
				switch (part.type) {
					case "text":
						input.push({
							type: "message",
							role: "assistant",
							content: [{ type: "output_text", text: part.text }],
						})
						break
					case "tool_use":
						input.push({
							type: "function_call",
							call_id: part.id,
							name: part.name,
							arguments: typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {}),
						})
						break
					case "reasoning" as typeof part.type: {
						// xAI caches from the start of the input. Dropping the encrypted
						// reasoning item (the form Task stores on assistant content) changes
						// that prefix, so the next turn misses the cache and cannot continue
						// the reasoning chain. Same wire shape as a standalone item: summary
						// is required even when empty, and content: null is not legal.
						const reasoning = part as {
							type?: string
							encrypted_content?: string
							id?: string
							summary?: unknown
							content?: unknown
						}
						if (typeof reasoning.encrypted_content === "string" && reasoning.encrypted_content.length > 0) {
							input.push(
								reasoningItemForResponsesApi({
									encrypted_content: reasoning.encrypted_content,
									id: reasoning.id,
									summary: reasoning.summary,
									content: reasoning.content,
								}),
							)
						}
						break
					}
					case "thinking":
						// Include reasoning if it has content
						if ((part as any).thinking && (part as any).thinking.trim().length > 0) {
							input.push({
								type: "message",
								role: "assistant",
								content: [{ type: "output_text", text: `[Thinking] ${(part as any).thinking}` }],
							})
						}
						break
				}
			}
		} else {
			// User messages
			const contentParts: any[] = []
			for (const part of message.content) {
				switch (part.type) {
					case "text":
						contentParts.push({ type: "input_text", text: part.text })
						break
					case "image":
						if (part.source.type === "base64") {
							contentParts.push({
								type: "input_image",
								detail: "auto",
								image_url: `data:${part.source.media_type};base64,${part.source.data}`,
							})
						}
						break
					case "tool_result": {
						// Flush any pending user content before the tool result
						if (contentParts.length > 0) {
							input.push({ role: "user", content: [...contentParts] })
							contentParts.length = 0
						}
						// Convert tool result content
						let output: string
						if (typeof part.content === "string") {
							output = part.content || "(empty)"
						} else if (Array.isArray(part.content)) {
							output =
								part.content
									.filter((c): c is Anthropic.TextBlockParam => c.type === "text")
									.map((c) => c.text)
									.join("\n") || "(empty)"
						} else {
							output = "(empty)"
						}
						input.push({
							type: "function_call_output",
							call_id: part.tool_use_id,
							output,
						})
						break
					}
				}
			}
			// Flush remaining user content
			if (contentParts.length > 0) {
				input.push({ role: "user", content: contentParts })
			}
		}
	}

	return input
}
