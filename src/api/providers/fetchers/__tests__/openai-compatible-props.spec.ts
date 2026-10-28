// npx vitest run api/providers/fetchers/__tests__/openai-compatible-props.spec.ts

import axios from "axios"

import {
	clearOpenAiCompatibleServerInfoCache,
	getOpenAiCompatibleServerInfo,
	getPropsUrl,
	parseDefaultReasoningEffortFromTemplate,
	parseReasoningEffortsFromTemplate,
} from "../openai-compatible-props"

vi.mock("axios")

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> }

// Trimmed from a live llama.cpp `/props` response (Qwen3-style template).
const membershipTemplate = `
{%- set reasoning_instructions = '' %}
{%- if enable_thinking is undefined or enable_thinking is true %}
    {%- set resolved_reasoning_effort = reasoning_effort|default('xhigh') %}
    {%- if resolved_reasoning_effort not in ('xhigh', 'medium', 'low') %}
        {{- raise_exception('Unexpected reasoning effort ' ~ reasoning_effort ~ '. Supported types are xhigh (default), medium, and low.') }}
    {%- endif %}
{%- endif %}
`

// gpt-oss-style templates branch per level instead of testing membership.
const equalityTemplate = `
{%- if reasoning_effort == "high" %}
{{- "Reasoning: high" }}
{%- elif reasoning_effort == "medium" %}
{{- "Reasoning: medium" }}
{%- elif reasoning_effort == "low" %}
{{- "Reasoning: low" }}
{%- endif %}
`

describe("getPropsUrl", () => {
	it("drops the API version segment because /props lives at the server root", () => {
		expect(getPropsUrl("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080/props")
		expect(getPropsUrl("http://127.0.0.1:8080/v1/")).toBe("http://127.0.0.1:8080/props")
		expect(getPropsUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080/props")
	})

	it("returns undefined for an unusable base URL", () => {
		expect(getPropsUrl(undefined)).toBeUndefined()
		expect(getPropsUrl("   ")).toBeUndefined()
		expect(getPropsUrl("not a url")).toBeUndefined()
	})
})

describe("parseReasoningEffortsFromTemplate", () => {
	it("reads the levels out of a membership test", () => {
		expect(parseReasoningEffortsFromTemplate(membershipTemplate)).toEqual(["low", "medium", "xhigh"])
	})

	it("reads the levels out of equality branches", () => {
		expect(parseReasoningEffortsFromTemplate(equalityTemplate)).toEqual(["low", "medium", "high"])
	})

	it("ignores values that aren't known effort levels", () => {
		expect(parseReasoningEffortsFromTemplate("{%- if reasoning_effort in ('low', 'turbo', 'medium') %}")).toEqual([
			"low",
			"medium",
		])
	})

	it("treats a lone comparison as inconclusive", () => {
		expect(parseReasoningEffortsFromTemplate('{%- if reasoning_effort == "high" %}')).toBeUndefined()
	})

	it("returns undefined when the template says nothing about effort", () => {
		expect(parseReasoningEffortsFromTemplate("{%- for message in messages %}")).toBeUndefined()
	})
})

describe("parseDefaultReasoningEffortFromTemplate", () => {
	it("reads the default filter", () => {
		expect(parseDefaultReasoningEffortFromTemplate(membershipTemplate)).toBe("xhigh")
	})

	it("returns undefined when there is no default", () => {
		expect(parseDefaultReasoningEffortFromTemplate(equalityTemplate)).toBeUndefined()
	})
})

describe("getOpenAiCompatibleServerInfo", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		clearOpenAiCompatibleServerInfoCache()
	})

	it("describes a llama.cpp server from its chat template", async () => {
		mockedAxios.get = vi.fn().mockResolvedValue({
			data: {
				chat_template: membershipTemplate,
				chat_template_caps: { supports_reasoning_effort: true },
			},
		})

		const info = await getOpenAiCompatibleServerInfo("http://127.0.0.1:8080/v1")

		expect(mockedAxios.get).toHaveBeenCalledWith("http://127.0.0.1:8080/props", expect.anything())
		expect(info).toEqual({
			reasoningEfforts: ["low", "medium", "xhigh"],
			defaultReasoningEffort: "xhigh",
			supportsEnableThinking: true,
			supportsReasoningEffort: true,
		})
	})

	it("sends the API key when the endpoint requires one", async () => {
		mockedAxios.get = vi.fn().mockResolvedValue({ data: { chat_template: membershipTemplate } })

		await getOpenAiCompatibleServerInfo("http://127.0.0.1:8080/v1", "sk-local")

		expect(mockedAxios.get).toHaveBeenCalledWith(
			"http://127.0.0.1:8080/props",
			expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer sk-local" }) }),
		)
	})

	it("prefers the levels the server reports over template parsing", async () => {
		mockedAxios.get = vi.fn().mockResolvedValue({
			data: {
				chat_template: membershipTemplate,
				chat_template_caps: { supports_reasoning_effort: true },
				reasoning_efforts: ["xhigh", "medium", "low"],
			},
		})

		const info = await getOpenAiCompatibleServerInfo("http://127.0.0.1:8080/v1")

		expect(info?.reasoningEfforts).toEqual(["low", "medium", "xhigh"])
	})

	it("returns undefined for an endpoint without /props, and caches that", async () => {
		mockedAxios.get = vi.fn().mockRejectedValue(new Error("404"))

		expect(await getOpenAiCompatibleServerInfo("https://api.openai.com/v1")).toBeUndefined()
		expect(await getOpenAiCompatibleServerInfo("https://api.openai.com/v1")).toBeUndefined()
		expect(mockedAxios.get).toHaveBeenCalledTimes(1)
	})

	it("shares one request between concurrent callers", async () => {
		mockedAxios.get = vi.fn().mockResolvedValue({ data: { chat_template: membershipTemplate } })

		const [first, second] = await Promise.all([
			getOpenAiCompatibleServerInfo("http://127.0.0.1:8080/v1"),
			getOpenAiCompatibleServerInfo("http://127.0.0.1:8080/v1"),
		])

		expect(mockedAxios.get).toHaveBeenCalledTimes(1)
		expect(first).toEqual(second)
	})

	it("does not reach out when the base URL is unusable", async () => {
		mockedAxios.get = vi.fn()

		expect(await getOpenAiCompatibleServerInfo(undefined)).toBeUndefined()
		expect(mockedAxios.get).not.toHaveBeenCalled()
	})
})
