import { FormEvent } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

interface McpServerCreationToggleProps {
	enableMcpServerCreation?: boolean
	setEnableMcpServerCreation?: (value: boolean) => void
}

const McpServerCreationToggle = ({
	enableMcpServerCreation: propsEnabled,
	setEnableMcpServerCreation: propsSetEnabled,
}: McpServerCreationToggleProps = {}) => {
	const { enableMcpServerCreation: contextEnabled, setEnableMcpServerCreation: contextSetEnabled } =
		useExtensionState()
	const { t } = useAppTranslation()

	// When rendered inside SettingsView the value is buffered in `cachedState` and
	// only persisted on Save. Fall back to live extension state when used uncontrolled.
	const enableMcpServerCreation = propsEnabled ?? contextEnabled

	const handleChange = (e: Event | FormEvent<HTMLElement>) => {
		const target = ("target" in e ? e.target : null) as HTMLInputElement | null

		if (!target) {
			return
		}

		if (propsSetEnabled) {
			propsSetEnabled(target.checked)
		} else {
			contextSetEnabled(target.checked)
			vscode.postMessage({
				type: "updateSettings",
				updatedSettings: { enableMcpServerCreation: target.checked },
			})
		}
	}

	return (
		<div style={{ marginBottom: "20px" }}>
			<VSCodeCheckbox checked={enableMcpServerCreation} onChange={handleChange}>
				<span style={{ fontWeight: "500" }}>{t("mcp:enableServerCreation.title")}</span>
			</VSCodeCheckbox>
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("mcp:enableServerCreation.description")}
			</p>
		</div>
	)
}

export default McpServerCreationToggle
