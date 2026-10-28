import axios from "axios"

import {
	type OpenAiCompatibleServerInfo,
	type ReasoningEffortExtended,
	reasoningEffortsExtended,
} from "@roo-code/types"

export type { OpenAiCompatibleServerInfo }

type PropsResponse = {
	chat_template?: unknown
	chat_template_caps?: Record<string, unknown>
	/** Accepted effort levels, reported by newer llama.cpp builds. */
	reasoning_efforts?: unknown
}

const PROPS_TIMEOUT_MS = 2_000
const CACHE_TTL_MS = 10 * 60 * 1_000

type CacheEntry = { expiresAt: number; value: OpenAiCompatibleServerInfo | undefined }

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<OpenAiCompatibleServerInfo | undefined>>()

/**
 * `/props` lives at the server root, so the OpenAI API version segment users put in
 * their base URL has to come back off.
 */
export const getPropsUrl = (baseUrl?: string): string | undefined => {
	const trimmed = baseUrl?.trim().replace(/\/+$/, "")

	if (!trimmed || !URL.canParse(trimmed)) {
		return undefined
	}

	return `${trimmed.replace(/\/v\d+$/, "")}/props`
}

const isKnownEffort = (value: string): value is ReasoningEffortExtended =>
	(reasoningEffortsExtended as readonly string[]).includes(value)

const toLadderOrder = (efforts: Iterable<ReasoningEffortExtended>): ReasoningEffortExtended[] => {
	const found = new Set(efforts)
	return reasoningEffortsExtended.filter((effort) => found.has(effort))
}

/**
 * Reads the accepted effort levels out of a Jinja chat template.
 *
 * Templates gate the level one of two ways - a membership test against a tuple/list
 * (`reasoning_effort not in ('xhigh', 'medium', 'low')`) or a chain of equality
 * comparisons (`reasoning_effort == "high"`). Both are matched; anything that isn't a
 * level we know about is discarded, and a single hit is treated as inconclusive so a
 * stray comparison can't narrow the list down to one entry.
 */
export const parseReasoningEffortsFromTemplate = (template: string): ReasoningEffortExtended[] | undefined => {
	const efforts = new Set<ReasoningEffortExtended>()

	const membership = /reasoning_effort[^\n]{0,80}?\bin\s*[([]([^)\]]*)[)\]]/g
	for (const match of template.matchAll(membership)) {
		for (const literal of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
			const value = literal[1].trim().toLowerCase()
			if (isKnownEffort(value)) {
				efforts.add(value)
			}
		}
	}

	const equality = /reasoning_effort\s*[=!]=\s*['"]([^'"]+)['"]/g
	for (const match of template.matchAll(equality)) {
		const value = match[1].trim().toLowerCase()
		if (isKnownEffort(value)) {
			efforts.add(value)
		}
	}

	return efforts.size > 1 ? toLadderOrder(efforts) : undefined
}

export const parseDefaultReasoningEffortFromTemplate = (template: string): ReasoningEffortExtended | undefined => {
	const match = template.match(/reasoning_effort\s*\|\s*default\(\s*['"]([^'"]+)['"]/)
	const value = match?.[1]?.trim().toLowerCase()
	return value && isKnownEffort(value) ? value : undefined
}

const parseProps = (data: PropsResponse): OpenAiCompatibleServerInfo => {
	const template = typeof data.chat_template === "string" ? data.chat_template : ""
	const caps = data.chat_template_caps ?? {}

	// Prefer the levels the server probed itself; fall back to reading the template.
	const reported = Array.isArray(data.reasoning_efforts)
		? toLadderOrder(data.reasoning_efforts.filter((e): e is ReasoningEffortExtended => isKnownEffort(String(e))))
		: undefined

	return {
		reasoningEfforts: reported?.length ? reported : parseReasoningEffortsFromTemplate(template),
		defaultReasoningEffort: parseDefaultReasoningEffortFromTemplate(template),
		supportsEnableThinking: caps.supports_enable_thinking === true || template.includes("enable_thinking"),
		supportsReasoningEffort: caps.supports_reasoning_effort === true || template.includes("reasoning_effort"),
	}
}

const fetchServerInfo = async (
	propsUrl: string,
	apiKey?: string,
	headers?: Record<string, string>,
): Promise<OpenAiCompatibleServerInfo | undefined> => {
	try {
		const response = await axios.get<PropsResponse>(propsUrl, {
			timeout: PROPS_TIMEOUT_MS,
			headers: {
				...(headers ?? {}),
				...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
			},
		})

		if (!response.data || typeof response.data !== "object") {
			return undefined
		}

		return parseProps(response.data)
	} catch (_error) {
		// Any endpoint that isn't llama.cpp-style simply has no `/props`; callers
		// fall back to their defaults rather than surfacing an error.
		return undefined
	}
}

/**
 * Cached `/props` lookup for an OpenAI-compatible base URL. Negative results are cached
 * too, so a plain OpenAI endpoint is probed once rather than on every request.
 */
export const getOpenAiCompatibleServerInfo = async (
	baseUrl?: string,
	apiKey?: string,
	headers?: Record<string, string>,
): Promise<OpenAiCompatibleServerInfo | undefined> => {
	const propsUrl = getPropsUrl(baseUrl)

	if (!propsUrl) {
		return undefined
	}

	const cached = cache.get(propsUrl)

	if (cached && cached.expiresAt > Date.now()) {
		return cached.value
	}

	const pending = inFlight.get(propsUrl)

	if (pending) {
		return pending
	}

	const request = fetchServerInfo(propsUrl, apiKey, headers)
		.then((value) => {
			cache.set(propsUrl, { expiresAt: Date.now() + CACHE_TTL_MS, value })
			return value
		})
		.finally(() => {
			inFlight.delete(propsUrl)
		})

	inFlight.set(propsUrl, request)

	return request
}

export const clearOpenAiCompatibleServerInfoCache = () => {
	cache.clear()
	inFlight.clear()
}
