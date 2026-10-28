import { ApiMessage } from "../../core/task-persistence/apiMessages"

import { ApiHandler } from "../index"

/* Removes image blocks from messages if they are not supported by the Api Handler */
export function maybeRemoveImageBlocks(messages: ApiMessage[], apiHandler: ApiHandler): ApiMessage[] {
	// Check model capability ONCE instead of for every message
	const supportsImages = apiHandler.getModel().info.supportsImages

	return messages.map((message) => {
		// Handle array content (could contain image blocks).
		let { content } = message
		if (Array.isArray(content)) {
			if (!supportsImages) {
				// Convert image blocks to text descriptions.
				content = content.map((block) => {
					if (block.type === "image") {
						// Convert image blocks to text descriptions.
						// Note: We can't access the actual image content/url due to API limitations,
						// but we can indicate that an image was present in the conversation.
						return {
							type: "text",
							text: "[Referenced image in conversation]",
						}
					}
					return block
				})
			}
		}
		return { ...message, content }
	})
}

/**
 * Forcibly strips ALL image blocks from messages, replacing them with a short
 * text placeholder. Unlike maybeRemoveImageBlocks (which only strips when the
 * model lacks vision support), this is used as an emergency escape hatch when
 * the context window has overflowed: the image payloads (often hundreds of KB
 * of base64) are what push the request over the limit, and they must be
 * removed so that condensation/truncation can actually run and produce a
 * smaller summary.
 *
 * @param messages - The conversation messages
 * @param placeholder - Text to replace each image block with
 * @returns New messages array with all image blocks replaced by text
 */
export function stripAllImageBlocks(
	messages: ApiMessage[],
	placeholder: string = "[Image removed to recover context]",
): ApiMessage[] {
	return messages.map((message) => {
		let { content } = message
		if (Array.isArray(content) && content.some((block) => block.type === "image")) {
			content = content.map((block) => {
				if (block.type === "image") {
					return { type: "text", text: placeholder }
				}
				return block
			})
		}
		return { ...message, content }
	})
}
