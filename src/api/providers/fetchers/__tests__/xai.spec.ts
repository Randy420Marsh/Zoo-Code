import { xaiDefaultModelId, xaiModels } from "@roo-code/types"

import { getXaiModelDetails, getXaiModels, isXaiChatModelId, mapXaiApiModel, xaiPriceToDollarsPerMillion } from "../xai"

describe("xai fetcher helpers", () => {
	it("converts xAI micro-unit prices to $/1M tokens", () => {
		expect(xaiPriceToDollarsPerMillion(20_000)).toBe(2)
		expect(xaiPriceToDollarsPerMillion(12_500)).toBe(1.25)
		expect(xaiPriceToDollarsPerMillion(60_000)).toBe(6)
		expect(xaiPriceToDollarsPerMillion(5_000)).toBe(0.5)
		expect(xaiPriceToDollarsPerMillion(undefined)).toBeUndefined()
	})

	it("classifies Imagine generation models as non-chat", () => {
		expect(isXaiChatModelId("grok-4.7")).toBe(true)
		expect(isXaiChatModelId("grok-build-0.1")).toBe(true)
		expect(isXaiChatModelId("grok-imagine-image-2.0")).toBe(false)
		expect(isXaiChatModelId("grok-imagine-video-1.5")).toBe(false)
	})

	it("maps list entries with image price and reasoning capabilities", () => {
		const info = mapXaiApiModel({
			id: "grok-4.7",
			context_length: 500_000,
			prompt_text_token_price: 20_000,
			cached_prompt_text_token_price: 5_000,
			prompt_image_token_price: 20_000,
			completion_text_token_price: 60_000,
			capabilities: {
				reasoning_effort: ["low", "medium", "high", "xhigh"],
				default_reasoning_effort: "high",
			},
		})

		expect(info.contextWindow).toBe(500_000)
		expect(info.supportsImages).toBe(true)
		expect(info.inputPrice).toBe(2)
		expect(info.outputPrice).toBe(6)
		expect(info.cacheReadsPrice).toBe(0.5)
		expect(info.supportsReasoningEffort).toEqual(["low", "medium", "high", "xhigh"])
		expect(info.reasoningEffort).toBe("high")
		// Static catalog still supplies maxTokens / tool prefs for known IDs.
		expect(info.maxTokens).toBe(xaiModels["grok-4.7"].maxTokens)
	})

	it("treats missing image price as no vision for unknown IDs", () => {
		const info = mapXaiApiModel({
			id: "grok-future-unknown",
			context_length: 128_000,
			prompt_text_token_price: 1_000,
			completion_text_token_price: 2_000,
		})
		expect(info.supportsImages).toBe(false)
		expect(info.inputPrice).toBe(0.1)
		expect(info.outputPrice).toBe(0.2)
		expect(info.contextWindow).toBe(128_000)
	})

	it("reports generation support from the model id prefix", () => {
		expect(mapXaiApiModel({ id: "grok-imagine-image-2.0" }).supportsImageGeneration).toBe(true)
		expect(mapXaiApiModel({ id: "grok-imagine-video-1.5" }).supportsVideoGeneration).toBe(true)
		expect(mapXaiApiModel({ id: "grok-voice-2" }).supportsAudioGeneration).toBe(true)
		expect(mapXaiApiModel({ id: "grok-4.7" }).supportsImageGeneration).toBe(false)
	})
})

describe("getXaiModels", () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
		vi.restoreAllMocks()
	})

	it("requires an API key", async () => {
		await expect(getXaiModels(undefined)).rejects.toThrow(/API key is required/i)
	})

	it("fetches /v1/models with bearer auth and keeps generation models for the cache", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				data: [
					{
						id: "grok-4.7",
						context_length: 500_000,
						prompt_text_token_price: 20_000,
						cached_prompt_text_token_price: 5_000,
						prompt_image_token_price: 20_000,
						completion_text_token_price: 60_000,
						capabilities: {
							reasoning_effort: ["low", "medium", "high", "xhigh"],
							default_reasoning_effort: "high",
						},
					},
					{
						id: "grok-imagine-image-2.0",
						context_length: 64_000,
					},
					{
						id: "grok-4.3",
						context_length: 1_000_000,
						prompt_text_token_price: 12_500,
						prompt_image_token_price: 12_500,
						completion_text_token_price: 25_000,
						capabilities: {
							reasoning_effort: ["none", "low", "medium", "high", "xhigh"],
							default_reasoning_effort: "low",
						},
					},
				],
			}),
		}) as unknown as typeof fetch

		const models = await getXaiModels("test-key")

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://api.x.ai/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-key",
				}),
			}),
		)
		expect(Object.keys(models).sort()).toEqual(["grok-4.3", "grok-4.7", "grok-imagine-image-2.0"])
		expect(models["grok-4.7"].supportsImages).toBe(true)
		expect(models["grok-4.7"].inputPrice).toBe(2)
		expect(models["grok-4.3"].reasoningEffort).toBe("low")
		// Generation models stay in the cache so the xaiAllow*Generation toggles can
		// read their reported support; the chat picker filters them out.
		expect(models["grok-imagine-image-2.0"].supportsImageGeneration).toBe(true)
	})

	it("normalizes a trailing slash on baseUrl", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ data: [] }),
		}) as unknown as typeof fetch

		await getXaiModels("test-key", "https://api.x.ai/v1/")

		expect(globalThis.fetch).toHaveBeenCalledWith("https://api.x.ai/v1/models", expect.any(Object))
	})

	it("throws on non-OK responses", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			text: vi.fn().mockResolvedValue("nope"),
		}) as unknown as typeof fetch

		await expect(getXaiModels("bad-key")).rejects.toThrow(/HTTP 401/)
	})

	it("throws on unexpected payload shape", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ data: "not-an-array" }),
		}) as unknown as typeof fetch

		await expect(getXaiModels("test-key")).rejects.toThrow()
	})
})

describe("getXaiModelDetails", () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
		vi.restoreAllMocks()
	})

	it("GETs /v1/models/{id}", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				id: xaiDefaultModelId,
				context_length: 500_000,
				prompt_text_token_price: 20_000,
				cached_prompt_text_token_price: 5_000,
				prompt_image_token_price: 20_000,
				completion_text_token_price: 60_000,
				capabilities: {
					reasoning_effort: ["low", "medium", "high", "xhigh"],
					default_reasoning_effort: "high",
				},
			}),
		}) as unknown as typeof fetch

		const info = await getXaiModelDetails(xaiDefaultModelId, "test-key")

		expect(globalThis.fetch).toHaveBeenCalledWith(
			`https://api.x.ai/v1/models/${xaiDefaultModelId}`,
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
			}),
		)
		expect(info.supportsImages).toBe(true)
		expect(info.inputPrice).toBe(2)
		expect(info.contextWindow).toBe(500_000)
	})
})
