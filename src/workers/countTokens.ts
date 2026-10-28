import workerpool from "workerpool"

import { Anthropic } from "@anthropic-ai/sdk"

import { tiktoken } from "../utils/tiktoken"

import { type CountTokensResult } from "./types"

async function countTokens(
	content: Anthropic.Messages.ContentBlockParam[],
	options?: { fudgeFactor?: number },
): Promise<CountTokensResult> {
	try {
		const count = await tiktoken(content, { fudgeFactor: options?.fudgeFactor })
		return { success: true, count }
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		}
	}
}

workerpool.worker({ countTokens })
