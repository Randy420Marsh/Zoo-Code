// npx vitest src/components/mcp/__tests__/McpServerCreationToggle.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"

import McpServerCreationToggle from "../McpServerCreationToggle"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const contextSetEnableMcpServerCreation = vi.fn()
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		enableMcpServerCreation: true,
		setEnableMcpServerCreation: contextSetEnableMcpServerCreation,
	}),
}))

const getCheckbox = () => screen.getByRole("checkbox")

describe("McpServerCreationToggle - Save/Discard contract", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// Controlled (inside SettingsView) must buffer, not persist before Save.
	it("buffers via the setter prop without persisting before Save when controlled", () => {
		const setEnableMcpServerCreation = vi.fn()
		render(
			<McpServerCreationToggle
				enableMcpServerCreation={true}
				setEnableMcpServerCreation={setEnableMcpServerCreation}
			/>,
		)

		fireEvent.click(getCheckbox())

		expect(setEnableMcpServerCreation).toHaveBeenCalledWith(false)
		expect(vscode.postMessage).not.toHaveBeenCalled()
		// Must not touch live extension state either.
		expect(contextSetEnableMcpServerCreation).not.toHaveBeenCalled()
	})

	it("persists immediately via live state when used uncontrolled", () => {
		render(<McpServerCreationToggle />)

		fireEvent.click(getCheckbox())

		expect(contextSetEnableMcpServerCreation).toHaveBeenCalledWith(false)
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: { enableMcpServerCreation: false },
		})
	})
})
