import { render, screen, fireEvent } from "@/utils/test-utils"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { type OpenAiCompatibleServerInfo, type ProviderSettings, providerIdentifiers } from "@roo-code/types"

import { vscode } from "@/utils/vscode"

import { ReasoningSelector } from "../ReasoningSelector"

vi.mock("@/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/components/ui/hooks/useRooPortal", () => ({
	useRooPortal: () => document.body,
}))

const setApiConfiguration = vi.fn()

let apiConfiguration: ProviderSettings = {}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration,
		currentApiConfigName: "local",
		setApiConfiguration,
	}),
}))

let serverInfo: OpenAiCompatibleServerInfo | null = null

vi.mock("@/components/ui/hooks/useOpenAiCompatibleServerInfo", () => ({
	useOpenAiCompatibleServerInfo: () => ({ data: serverInfo }),
}))

vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: (config?: ProviderSettings) => ({
		id: config?.openAiModelId ?? "",
		info: config?.openAiCustomModelInfo,
	}),
}))

const openAiCompatible = (overrides: Partial<ProviderSettings> = {}): ProviderSettings => ({
	apiProvider: providerIdentifiers.openai,
	openAiModelId: "Qwen3.8-27B",
	...overrides,
})

describe("ReasoningSelector", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		serverInfo = null
		apiConfiguration = openAiCompatible({
			openAiCustomModelInfo: { contextWindow: 128_000, supportsPromptCache: false, reasoningEffort: "high" },
		})
	})

	test("renders nothing when the model has no effort-based reasoning", () => {
		apiConfiguration = { apiProvider: providerIdentifiers.anthropic }

		const { container } = render(<ReasoningSelector />)

		expect(container).toBeEmptyDOMElement()
	})

	test("shows the level the next request would send", () => {
		render(<ReasoningSelector />)

		expect(screen.getByTestId("reasoning-selector-trigger")).toHaveTextContent(
			"settings:providers.reasoningEffort.high",
		)
	})

	test("shows the off label when reasoning is disabled", () => {
		apiConfiguration = openAiCompatible({
			enableReasoningEffort: false,
			openAiCustomModelInfo: { contextWindow: 128_000, supportsPromptCache: false, reasoningEffort: "high" },
		})

		render(<ReasoningSelector />)

		expect(screen.getByTestId("reasoning-selector-trigger")).toHaveTextContent("chat:reasoning.off")
	})

	test("persists a level a picky endpoint accepts", () => {
		render(<ReasoningSelector />)

		fireEvent.click(screen.getByTestId("reasoning-selector-trigger"))
		fireEvent.click(screen.getByTestId("reasoning-selector-option-xhigh"))

		const expected = {
			...apiConfiguration,
			enableReasoningEffort: true,
			openAiCustomModelInfo: {
				contextWindow: 128_000,
				supportsPromptCache: false,
				reasoningEffort: "xhigh",
			},
		}

		expect(setApiConfiguration).toHaveBeenCalledWith(expected)
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "upsertApiConfiguration",
			text: "local",
			apiConfiguration: expected,
		})
	})

	test("turns reasoning off from the toggle", () => {
		render(<ReasoningSelector />)

		fireEvent.click(screen.getByTestId("reasoning-selector-trigger"))
		fireEvent.click(screen.getByTestId("reasoning-selector-toggle"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "upsertApiConfiguration",
			text: "local",
			apiConfiguration: { ...apiConfiguration, enableReasoningEffort: false },
		})
	})

	test("offers only the levels the endpoint's template accepts", () => {
		serverInfo = {
			reasoningEfforts: ["low", "medium", "xhigh"],
			defaultReasoningEffort: "xhigh",
			supportsEnableThinking: true,
			supportsReasoningEffort: true,
		}

		render(<ReasoningSelector />)
		fireEvent.click(screen.getByTestId("reasoning-selector-trigger"))

		expect(screen.getByTestId("reasoning-selector-option-xhigh")).toBeInTheDocument()
		expect(screen.queryByTestId("reasoning-selector-option-high")).not.toBeInTheDocument()
		expect(screen.queryByTestId("reasoning-selector-option-max")).not.toBeInTheDocument()
	})

	test("says so when the endpoint cannot actually stop thinking", () => {
		serverInfo = {
			reasoningEfforts: ["low", "medium", "xhigh"],
			defaultReasoningEffort: "xhigh",
			supportsEnableThinking: false,
			supportsReasoningEffort: true,
		}

		render(<ReasoningSelector />)
		fireEvent.click(screen.getByTestId("reasoning-selector-trigger"))

		expect(screen.getByText("chat:reasoning.cannotDisable")).toBeInTheDocument()
	})

	test("hides itself when the endpoint's template ignores reasoning", () => {
		serverInfo = { supportsEnableThinking: false, supportsReasoningEffort: false }

		const { container } = render(<ReasoningSelector />)

		expect(container).toBeEmptyDOMElement()
	})
})
