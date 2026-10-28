// npx vitest run api/providers/__tests__/openai.enable-thinking.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { openAiModelInfoSaneDefaults } from "@roo-code/types"

import { OpenAiHandler } from "../openai"
import { makeApiHandlerOptions } from "../../../test-utils/api"
import { asyncStreamFrom, collectStream } from "../../../test-utils/stream"
import { getOpenAiCompatibleServerInfo } from "../fetchers/openai-compatible-props"

vitest.mock("../utils/timeout-config", () => ({
	getApiRequestTimeout: vitest.fn().mockReturnValue(300_000),
}))

vitest.mock("../fetchers/openai-compatible-props", () => ({
	getOpenAiCompatibleServerInfo: vitest.fn(),
}))

const mockCreate = vitest.fn()

vitest.mock("openai", () => {
	const mockConstructor = vitest.fn().mockImplementation(function () {
		return { chat: { completions: { create: mockCreate } } }
	})

	return { __esModule: true, default: mockConstructor, AzureOpenAI: vitest.fn() }
})

const mockedServerInfo = vi.mocked(getOpenAiCompatibleServerInfo)

const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

const options = (overrides: Record<string, unknown> = {}) =>
	makeApiHandlerOptions({
		openAiApiKey: "local",
		openAiModelId: "Qwen3.8-27B",
		openAiBaseUrl: "http://127.0.0.1:8080/v1",
		...overrides,
	})

const thinkingServer = {
	reasoningEfforts: ["low", "medium", "xhigh"] as const,
	defaultReasoningEffort: "xhigh" as const,
	supportsEnableThinking: true,
	supportsReasoningEffort: true,
}

describe("OpenAiHandler thinking switch", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		mockCreate.mockImplementation(async () =>
			asyncStreamFrom([{ choices: [{ delta: { content: "ok" }, index: 0 }], usage: null }]),
		)
	})

	it("tells a llama.cpp-style endpoint to stop thinking when reasoning is off", async () => {
		mockedServerInfo.mockResolvedValue({
			...thinkingServer,
			reasoningEfforts: [...thinkingServer.reasoningEfforts],
		})

		const handler = new OpenAiHandler(options({ enableReasoningEffort: false }))
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockedServerInfo).toHaveBeenCalledWith("http://127.0.0.1:8080/v1", "local", undefined)
		expect(mockCreate.mock.calls[0][0]).toMatchObject({ chat_template_kwargs: { enable_thinking: false } })
	})

	it("leaves the body alone for an endpoint whose template has no thinking switch", async () => {
		mockedServerInfo.mockResolvedValue({ supportsEnableThinking: false, supportsReasoningEffort: false })

		const handler = new OpenAiHandler(options({ enableReasoningEffort: false }))
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("chat_template_kwargs")
	})

	it("leaves the body alone when /props is unavailable", async () => {
		mockedServerInfo.mockResolvedValue(undefined)

		const handler = new OpenAiHandler(options({ enableReasoningEffort: false }))
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("chat_template_kwargs")
	})

	it("does not probe the endpoint when there is no level to send and nothing to switch off", async () => {
		const handler = new OpenAiHandler(options({ enableReasoningEffort: true }))
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockedServerInfo).not.toHaveBeenCalled()
		expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("chat_template_kwargs")
		expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("reasoning_effort")
	})

	it("sends the level from the custom model info, not one left on the profile", async () => {
		mockedServerInfo.mockResolvedValue(undefined)

		const handler = new OpenAiHandler(
			options({
				enableReasoningEffort: true,
				// Left behind by another provider on the same profile.
				reasoningEffort: "high",
				openAiCustomModelInfo: { ...openAiModelInfoSaneDefaults, reasoningEffort: "xhigh" },
			}),
		)
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockCreate.mock.calls[0][0]).toMatchObject({ reasoning_effort: "xhigh" })
	})

	it("falls back to the template default for a level the template would raise on", async () => {
		mockedServerInfo.mockResolvedValue({
			...thinkingServer,
			reasoningEfforts: [...thinkingServer.reasoningEfforts],
		})

		const handler = new OpenAiHandler(
			options({
				enableReasoningEffort: true,
				openAiCustomModelInfo: { ...openAiModelInfoSaneDefaults, reasoningEffort: "high" },
			}),
		)
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockCreate.mock.calls[0][0]).toMatchObject({ reasoning_effort: "xhigh" })
	})

	it("steps down to the closest supported level when the template has no default", async () => {
		mockedServerInfo.mockResolvedValue({
			...thinkingServer,
			reasoningEfforts: ["low", "medium"],
			defaultReasoningEffort: undefined,
		})

		const handler = new OpenAiHandler(
			options({
				enableReasoningEffort: true,
				openAiCustomModelInfo: { ...openAiModelInfoSaneDefaults, reasoningEffort: "xhigh" },
			}),
		)
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockCreate.mock.calls[0][0]).toMatchObject({ reasoning_effort: "medium" })
	})

	it("leaves the level alone for an endpoint that does not describe its template", async () => {
		mockedServerInfo.mockResolvedValue(undefined)

		const handler = new OpenAiHandler(
			options({
				enableReasoningEffort: true,
				openAiCustomModelInfo: { ...openAiModelInfoSaneDefaults, reasoningEffort: "high" },
			}),
		)
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockCreate.mock.calls[0][0]).toMatchObject({ reasoning_effort: "high" })
	})

	it("sends the level on the non-streaming path too", async () => {
		mockedServerInfo.mockResolvedValue({
			...thinkingServer,
			reasoningEfforts: [...thinkingServer.reasoningEfforts],
		})
		mockCreate.mockResolvedValue({
			id: "test-completion",
			choices: [
				{ message: { role: "assistant", content: "ok", refusal: null }, finish_reason: "stop", index: 0 },
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		})

		const handler = new OpenAiHandler(
			options({
				enableReasoningEffort: true,
				openAiStreamingEnabled: false,
				openAiCustomModelInfo: { ...openAiModelInfoSaneDefaults, reasoningEffort: "medium" },
			}),
		)
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockCreate.mock.calls[0][0]).toMatchObject({ reasoning_effort: "medium" })
	})

	it("lets an explicit extra body win over the automatic switch", async () => {
		mockedServerInfo.mockResolvedValue({
			...thinkingServer,
			reasoningEfforts: [...thinkingServer.reasoningEfforts],
		})

		const handler = new OpenAiHandler(
			options({
				enableReasoningEffort: false,
				openAiExtraBody: '{"chat_template_kwargs":{"enable_thinking":true,"custom":1}}',
			}),
		)
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockCreate.mock.calls[0][0]).toMatchObject({
			chat_template_kwargs: { enable_thinking: true, custom: 1 },
		})
	})

	it("also switches thinking off on the non-streaming path", async () => {
		mockedServerInfo.mockResolvedValue({
			...thinkingServer,
			reasoningEfforts: [...thinkingServer.reasoningEfforts],
		})
		mockCreate.mockResolvedValue({
			id: "test-completion",
			choices: [
				{ message: { role: "assistant", content: "ok", refusal: null }, finish_reason: "stop", index: 0 },
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		})

		const handler = new OpenAiHandler(options({ enableReasoningEffort: false, openAiStreamingEnabled: false }))
		await collectStream(handler.createMessage("You are helpful", messages))

		expect(mockCreate.mock.calls[0][0]).toMatchObject({ chat_template_kwargs: { enable_thinking: false } })
	})
})
