import {
	type ModelInfo,
	type OpenAiCompatibleServerInfo,
	type ProviderSettings,
	type ReasoningEffortExtended,
	openAiModelInfoSaneDefaults,
	providerIdentifiers,
	reasoningEfforts,
	resolveReasoningEffortForServer,
} from "@roo-code/types"

/**
 * Effort ladder offered for OpenAI Compatible endpoints.
 *
 * Custom endpoints don't advertise which levels they accept, so we offer the
 * superset. Servers are free to reject a level they don't implement (llama.cpp
 * chat templates, for example, raise on an unexpected `reasoning_effort`), which
 * is why the selection is user-visible rather than inferred.
 */
export const openAiCompatibleReasoningEfforts = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const satisfies readonly ReasoningEffortExtended[]

const isOpenAiCompatible = (provider?: ProviderSettings["apiProvider"]) => provider === providerIdentifiers.openai

type ReasoningContext = {
	apiConfiguration?: ProviderSettings
	modelInfo?: ModelInfo
	/**
	 * What the endpoint reported about its own chat template, when it has a `/props`
	 * to report it (llama.cpp does). `null` means "asked, nothing to report".
	 */
	serverInfo?: OpenAiCompatibleServerInfo | null
}

const getProvider = (apiConfiguration?: ProviderSettings) => apiConfiguration?.apiProvider

/**
 * Whether an effort-based reasoning control should be offered for the selected model.
 *
 * Budget-based reasoning (thinking tokens) and binary reasoning are configured in
 * the settings view and are intentionally out of scope here.
 */
export const supportsReasoningEffortSelection = ({
	apiConfiguration,
	modelInfo,
	serverInfo,
}: ReasoningContext): boolean => {
	if (isOpenAiCompatible(getProvider(apiConfiguration))) {
		// A server that told us its template ignores reasoning has nothing to offer.
		return serverInfo ? serverInfo.supportsReasoningEffort || serverInfo.supportsEnableThinking : true
	}

	const supports = modelInfo?.supportsReasoningEffort

	if (supports === true) {
		return true
	}

	if (Array.isArray(supports)) {
		return supports.some((effort) => effort !== "disable")
	}

	return !!modelInfo?.reasoningEffort
}

/**
 * Effort levels to offer for the selected model. An explicit capability array always
 * wins so a model that only accepts a subset never shows levels it would reject.
 */
export const getReasoningEffortOptions = ({
	apiConfiguration,
	modelInfo,
	serverInfo,
}: ReasoningContext): ReasoningEffortExtended[] => {
	// Levels read off the live template are ground truth: anything else would offer a
	// level the server rejects outright.
	if (serverInfo?.reasoningEfforts?.length) {
		return [...serverInfo.reasoningEfforts]
	}

	const supports = modelInfo?.supportsReasoningEffort

	if (Array.isArray(supports)) {
		return supports.filter((effort): effort is ReasoningEffortExtended => effort !== "disable")
	}

	if (isOpenAiCompatible(getProvider(apiConfiguration))) {
		return [...openAiCompatibleReasoningEfforts]
	}

	return [...reasoningEfforts]
}

/**
 * The effort the next request would use.
 *
 * OpenAI Compatible keeps the level on the custom model info (that's where the
 * settings view writes it, and what `getModelParams` reads for that provider);
 * every other provider keeps it on the profile itself.
 */
export const getSelectedReasoningEffort = ({
	apiConfiguration,
	modelInfo,
	serverInfo,
}: ReasoningContext): ReasoningEffortExtended | undefined => {
	const stored = isOpenAiCompatible(getProvider(apiConfiguration))
		? apiConfiguration?.openAiCustomModelInfo?.reasoningEffort
		: apiConfiguration?.reasoningEffort

	const effort = stored === "disable" ? undefined : stored

	const options = getReasoningEffortOptions({ apiConfiguration, modelInfo, serverInfo })
	const fallback = serverInfo?.defaultReasoningEffort ?? modelInfo?.reasoningEffort

	if (effort && options.includes(effort)) {
		return effort
	}

	// A level carried over from another model may not exist on this one; fall back to
	// the model's own default before the first offered level.
	if (fallback && options.includes(fallback)) {
		return fallback
	}

	// Same resolution the request builder applies, so the label matches what the
	// endpoint is actually asked for.
	return resolveReasoningEffortForServer(effort, serverInfo) ?? effort ?? fallback ?? options[0]
}

const hasReasoningTurnedOff = (apiConfiguration?: ProviderSettings) =>
	isOpenAiCompatible(getProvider(apiConfiguration))
		? !apiConfiguration?.openAiCustomModelInfo?.reasoningEffort
		: apiConfiguration?.reasoningEffort === "disable"

export const isReasoningEffortEnabled = ({ apiConfiguration, modelInfo, serverInfo }: ReasoningContext): boolean => {
	if (modelInfo?.requiredReasoningEffort) {
		return true
	}

	if (apiConfiguration?.enableReasoningEffort !== undefined) {
		return apiConfiguration.enableReasoningEffort
	}

	// No explicit choice yet: mirror the request builder, which sends a level
	// whenever one is stored and the "disable" sentinel isn't set. A template that
	// reasons by default keeps reasoning even with nothing stored.
	return !hasReasoningTurnedOff(apiConfiguration) || !!serverInfo?.defaultReasoningEffort
}

/**
 * Profile fields to persist for a reasoning change, routed to the field the selected
 * provider actually reads.
 */
export const buildReasoningEffortUpdate = ({
	apiConfiguration,
	enabled,
	effort,
}: ReasoningContext & { enabled: boolean; effort?: ReasoningEffortExtended }): Partial<ProviderSettings> => {
	if (isOpenAiCompatible(getProvider(apiConfiguration))) {
		// This provider reads the level off the custom model info (that's where the
		// settings view writes it too), so the profile-level field is left untouched -
		// the handler now prefers the custom info, and writing both would only leave two
		// places to disagree.
		// `enableReasoningEffort: false` alone is enough to drop `reasoning_effort`
		// from the request, which keeps the chosen level for the next toggle-on.
		if (!enabled) {
			return { enableReasoningEffort: false }
		}

		const openAiCustomModelInfo = apiConfiguration?.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults

		return {
			enableReasoningEffort: true,
			...(effort ? { openAiCustomModelInfo: { ...openAiCustomModelInfo, reasoningEffort: effort } } : {}),
		}
	}

	// Gemini deliberately ignores `enableReasoningEffort`, so turning reasoning off
	// has to go through the "disable" sentinel as well. That discards the previously
	// selected level; toggling back on falls back to the model default.
	if (!enabled) {
		return { enableReasoningEffort: false, reasoningEffort: "disable" }
	}

	return { enableReasoningEffort: true, ...(effort ? { reasoningEffort: effort } : {}) }
}

/**
 * Whether turning reasoning off actually stops the model thinking.
 *
 * Omitting `reasoning_effort` is not the same as asking for no reasoning: a template
 * with its own default (llama.cpp's Qwen3 template defaults to `xhigh`) keeps thinking
 * unless it is told `enable_thinking: false`.
 */
export const canDisableThinking = ({ apiConfiguration, serverInfo }: ReasoningContext): boolean | undefined => {
	if (!isOpenAiCompatible(getProvider(apiConfiguration)) || !serverInfo) {
		return undefined
	}

	return serverInfo.supportsEnableThinking || !serverInfo.defaultReasoningEffort
}
