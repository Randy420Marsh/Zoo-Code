import { describe, expect, test } from "vitest"

import { type ModelInfo, type ProviderSettings, providerIdentifiers } from "@roo-code/types"

import {
	buildReasoningEffortUpdate,
	canDisableThinking,
	getReasoningEffortOptions,
	getSelectedReasoningEffort,
	isReasoningEffortEnabled,
	supportsReasoningEffortSelection,
} from "../reasoning"

const openAiCompatible = (overrides: Partial<ProviderSettings> = {}): ProviderSettings => ({
	apiProvider: providerIdentifiers.openai,
	openAiModelId: "local-model",
	...overrides,
})

describe("supportsReasoningEffortSelection", () => {
	test("is always available for OpenAI Compatible endpoints", () => {
		expect(supportsReasoningEffortSelection({ apiConfiguration: openAiCompatible(), modelInfo: undefined })).toBe(
			true,
		)
	})

	test("follows the model capability for other providers", () => {
		const apiConfiguration: ProviderSettings = { apiProvider: providerIdentifiers.anthropic }

		expect(
			supportsReasoningEffortSelection({
				apiConfiguration,
				modelInfo: { contextWindow: 1, supportsPromptCache: false, supportsReasoningEffort: true },
			}),
		).toBe(true)

		expect(
			supportsReasoningEffortSelection({
				apiConfiguration,
				modelInfo: { contextWindow: 1, supportsPromptCache: false },
			}),
		).toBe(false)
	})

	test("ignores a capability array that only contains the disable sentinel", () => {
		expect(
			supportsReasoningEffortSelection({
				apiConfiguration: { apiProvider: providerIdentifiers.anthropic },
				modelInfo: { contextWindow: 1, supportsPromptCache: false, supportsReasoningEffort: ["disable"] },
			}),
		).toBe(false)
	})
})

describe("getReasoningEffortOptions", () => {
	test("offers the extended ladder for OpenAI Compatible endpoints", () => {
		expect(getReasoningEffortOptions({ apiConfiguration: openAiCompatible() })).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		])
	})

	test("respects an explicit capability array and drops the disable sentinel", () => {
		const modelInfo: ModelInfo = {
			contextWindow: 1,
			supportsPromptCache: false,
			supportsReasoningEffort: ["disable", "low", "medium", "xhigh"],
		}

		expect(getReasoningEffortOptions({ apiConfiguration: openAiCompatible(), modelInfo })).toEqual([
			"low",
			"medium",
			"xhigh",
		])
	})
})

describe("getSelectedReasoningEffort", () => {
	test("reads the level from the custom model info for OpenAI Compatible", () => {
		const apiConfiguration = openAiCompatible({
			openAiCustomModelInfo: { contextWindow: 1, supportsPromptCache: false, reasoningEffort: "xhigh" },
		})

		expect(getSelectedReasoningEffort({ apiConfiguration })).toBe("xhigh")
	})

	test("falls back to an offered level when the stored one is unsupported", () => {
		const modelInfo: ModelInfo = {
			contextWindow: 1,
			supportsPromptCache: false,
			supportsReasoningEffort: ["low", "medium", "xhigh"],
			reasoningEffort: "xhigh",
		}

		const apiConfiguration = openAiCompatible({
			openAiCustomModelInfo: { ...modelInfo, reasoningEffort: "high" },
		})

		expect(getSelectedReasoningEffort({ apiConfiguration, modelInfo })).toBe("xhigh")
	})

	test("shows the level the request steps down to when the template has no default", () => {
		const apiConfiguration = openAiCompatible({
			openAiCustomModelInfo: { contextWindow: 1, supportsPromptCache: false, reasoningEffort: "xhigh" },
		})

		expect(
			getSelectedReasoningEffort({
				apiConfiguration,
				serverInfo: {
					reasoningEfforts: ["low", "medium"],
					supportsEnableThinking: true,
					supportsReasoningEffort: true,
				},
			}),
		).toBe("medium")
	})

	test("treats the disable sentinel as no selection", () => {
		expect(
			getSelectedReasoningEffort({
				apiConfiguration: { apiProvider: providerIdentifiers.anthropic, reasoningEffort: "disable" },
				modelInfo: { contextWindow: 1, supportsPromptCache: false, supportsReasoningEffort: true },
			}),
		).toBe("low")
	})
})

describe("isReasoningEffortEnabled", () => {
	test("honors the explicit off switch", () => {
		const apiConfiguration = openAiCompatible({
			enableReasoningEffort: false,
			openAiCustomModelInfo: { contextWindow: 1, supportsPromptCache: false, reasoningEffort: "high" },
		})

		expect(isReasoningEffortEnabled({ apiConfiguration })).toBe(false)
	})

	test("is on when a level is stored and no choice was made yet", () => {
		const apiConfiguration = openAiCompatible({
			openAiCustomModelInfo: { contextWindow: 1, supportsPromptCache: false, reasoningEffort: "high" },
		})

		expect(isReasoningEffortEnabled({ apiConfiguration })).toBe(true)
	})

	test("is always on when the model requires reasoning", () => {
		expect(
			isReasoningEffortEnabled({
				apiConfiguration: { apiProvider: providerIdentifiers.anthropic, enableReasoningEffort: false },
				modelInfo: { contextWindow: 1, supportsPromptCache: false, requiredReasoningEffort: true },
			}),
		).toBe(true)
	})
})

describe("buildReasoningEffortUpdate", () => {
	test("writes the level to the custom model info for OpenAI Compatible", () => {
		const apiConfiguration = openAiCompatible({
			openAiCustomModelInfo: { contextWindow: 128_000, supportsPromptCache: false, reasoningEffort: "high" },
		})

		const update = buildReasoningEffortUpdate({ apiConfiguration, enabled: true, effort: "xhigh" })

		expect(update).toEqual({
			enableReasoningEffort: true,
			openAiCustomModelInfo: { contextWindow: 128_000, supportsPromptCache: false, reasoningEffort: "xhigh" },
		})
		// The profile-level field would shadow the custom model info in `getModelParams`.
		expect(update).not.toHaveProperty("reasoningEffort")
	})

	test("turns OpenAI Compatible reasoning off without discarding the chosen level", () => {
		const openAiCustomModelInfo = {
			contextWindow: 128_000,
			supportsPromptCache: false,
			reasoningEffort: "xhigh" as const,
		}

		const update = buildReasoningEffortUpdate({
			apiConfiguration: openAiCompatible({ openAiCustomModelInfo }),
			enabled: false,
		})

		expect(update).toEqual({ enableReasoningEffort: false })
	})

	test("uses the disable sentinel for other providers", () => {
		const update = buildReasoningEffortUpdate({
			apiConfiguration: { apiProvider: providerIdentifiers.gemini },
			enabled: false,
		})

		expect(update).toEqual({ enableReasoningEffort: false, reasoningEffort: "disable" })
	})

	test("writes the profile-level field for other providers", () => {
		const update = buildReasoningEffortUpdate({
			apiConfiguration: { apiProvider: providerIdentifiers.anthropic },
			enabled: true,
			effort: "medium",
		})

		expect(update).toEqual({ enableReasoningEffort: true, reasoningEffort: "medium" })
	})
})

describe("detected server capabilities", () => {
	const llamaCppServer = {
		reasoningEfforts: ["low", "medium", "xhigh"] as const,
		defaultReasoningEffort: "xhigh" as const,
		supportsEnableThinking: true,
		supportsReasoningEffort: true,
	}

	const serverInfo = { ...llamaCppServer, reasoningEfforts: [...llamaCppServer.reasoningEfforts] }

	test("narrow the offered levels to the ones the template accepts", () => {
		expect(getReasoningEffortOptions({ apiConfiguration: openAiCompatible(), serverInfo })).toEqual([
			"low",
			"medium",
			"xhigh",
		])
	})

	test("replace a stored level the template would reject", () => {
		const apiConfiguration = openAiCompatible({
			openAiCustomModelInfo: { contextWindow: 1, supportsPromptCache: false, reasoningEffort: "high" },
		})

		expect(getSelectedReasoningEffort({ apiConfiguration, serverInfo })).toBe("xhigh")
	})

	test("hide the control when the template ignores reasoning entirely", () => {
		expect(
			supportsReasoningEffortSelection({
				apiConfiguration: openAiCompatible(),
				serverInfo: { supportsEnableThinking: false, supportsReasoningEffort: false },
			}),
		).toBe(false)
	})

	test("report reasoning as on when the template thinks by default", () => {
		expect(isReasoningEffortEnabled({ apiConfiguration: openAiCompatible(), serverInfo })).toBe(true)
	})

	test("know whether off really means off", () => {
		expect(canDisableThinking({ apiConfiguration: openAiCompatible(), serverInfo })).toBe(true)

		expect(
			canDisableThinking({
				apiConfiguration: openAiCompatible(),
				serverInfo: { ...serverInfo, supportsEnableThinking: false },
			}),
		).toBe(false)

		// Nothing detected yet - the control makes no claim either way.
		expect(canDisableThinking({ apiConfiguration: openAiCompatible() })).toBeUndefined()
	})
})
