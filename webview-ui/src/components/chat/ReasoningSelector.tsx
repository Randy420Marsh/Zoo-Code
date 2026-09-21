import { useCallback, useMemo, useState } from "react"
import { Check, Lightbulb, LightbulbOff, Settings } from "lucide-react"

import { type ProviderSettings, type ReasoningEffortExtended, providerIdentifiers } from "@roo-code/types"

import { cn } from "@/lib/utils"
import { enabledSelectorTriggerClassName, selectorTriggerClassName } from "@/components/ui/selectorTriggerStyles"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { useOpenAiCompatibleServerInfo } from "@/components/ui/hooks/useOpenAiCompatibleServerInfo"
import { Popover, PopoverContent, PopoverTrigger, StandardTooltip, ToggleSwitch } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import {
	buildReasoningEffortUpdate,
	canDisableThinking,
	getReasoningEffortOptions,
	getSelectedReasoningEffort,
	isReasoningEffortEnabled,
	supportsReasoningEffortSelection,
} from "@/utils/reasoning"

interface ReasoningSelectorProps {
	disabled?: boolean
	triggerClassName?: string
}

/**
 * Chat footer control for the reasoning level of the active provider profile.
 *
 * Writes straight through to the profile (the settings view is the same store), so a
 * level a given endpoint rejects can be changed without leaving the chat.
 */
export const ReasoningSelector = ({ disabled = false, triggerClassName = "" }: ReasoningSelectorProps) => {
	const [open, setOpen] = useState(false)
	const portalContainer = useRooPortal("roo-portal")
	const { t } = useAppTranslation()

	const { apiConfiguration, currentApiConfigName, setApiConfiguration } = useExtensionState()
	const { info: modelInfo } = useSelectedModel(apiConfiguration)

	// Custom endpoints don't advertise their levels through the OpenAI API, but a
	// llama.cpp-style server describes its chat template on `/props`.
	const { data: serverInfo } = useOpenAiCompatibleServerInfo(
		apiConfiguration?.openAiBaseUrl,
		apiConfiguration?.openAiApiKey,
		apiConfiguration?.apiProvider === providerIdentifiers.openai,
	)

	const context = useMemo(
		() => ({ apiConfiguration, modelInfo, serverInfo }),
		[apiConfiguration, modelInfo, serverInfo],
	)

	const isSupported = supportsReasoningEffortSelection(context)
	const isRequired = !!modelInfo?.requiredReasoningEffort
	const isEnabled = isReasoningEffortEnabled(context)
	const options = useMemo(() => getReasoningEffortOptions(context), [context])
	const selectedEffort = getSelectedReasoningEffort(context)

	const persist = useCallback(
		(update: Partial<ProviderSettings>) => {
			const updated = { ...apiConfiguration, ...update }
			// Optimistic so the trigger label doesn't wait on the state round trip.
			setApiConfiguration(updated)
			vscode.postMessage({
				type: "upsertApiConfiguration",
				text: currentApiConfigName,
				apiConfiguration: updated,
			})
		},
		[apiConfiguration, currentApiConfigName, setApiConfiguration],
	)

	const handleToggle = useCallback(() => {
		if (isRequired) {
			return
		}

		persist(buildReasoningEffortUpdate({ ...context, enabled: !isEnabled, effort: selectedEffort }))
	}, [context, isEnabled, isRequired, persist, selectedEffort])

	const handleSelectEffort = useCallback(
		(effort: ReasoningEffortExtended) => {
			// Picking a level implies turning reasoning on.
			persist(buildReasoningEffortUpdate({ ...context, enabled: true, effort }))
			setOpen(false)
		},
		[context, persist],
	)

	const handleOpenSettings = useCallback(() => {
		window.postMessage({ type: "action", action: "settingsButtonClicked", values: { section: "providers" } })
		setOpen(false)
	}, [])

	if (!isSupported) {
		return null
	}

	const effortLabel = selectedEffort ? t(`settings:providers.reasoningEffort.${selectedEffort}`) : ""
	const triggerLabel = isEnabled && effortLabel ? effortLabel : t("chat:reasoning.off")

	return (
		<Popover open={open} onOpenChange={setOpen} data-testid="reasoning-selector-root">
			<StandardTooltip
				content={
					isEnabled && effortLabel
						? t("chat:reasoning.tooltipStatus", { effort: effortLabel })
						: t("chat:reasoning.tooltipOff")
				}>
				<PopoverTrigger
					disabled={disabled}
					data-testid="reasoning-selector-trigger"
					className={cn(
						"inline-flex items-center gap-1.5 relative whitespace-nowrap px-1.5 py-1 text-xs",
						selectorTriggerClassName,
						"max-[300px]:shrink-0",
						disabled ? "opacity-50 cursor-not-allowed" : enabledSelectorTriggerClassName,
						!isEnabled && "opacity-60",
						triggerClassName,
					)}>
					{isEnabled ? (
						<Lightbulb className="size-3 flex-shrink-0" />
					) : (
						<LightbulbOff className="size-3 flex-shrink-0" />
					)}
					<span className="hidden min-[300px]:inline truncate min-w-0">{triggerLabel}</span>
				</PopoverTrigger>
			</StandardTooltip>
			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-0 overflow-hidden w-[min(280px,calc(100vw-2rem))]"
				onOpenAutoFocus={(e) => e.preventDefault()}>
				<div className="flex flex-col w-full">
					<div className="p-3 border-b border-vscode-dropdown-border">
						<div className="flex items-center justify-between gap-2">
							<h4 className="m-0 font-bold text-base text-vscode-foreground">
								{t("chat:reasoning.title")}
							</h4>
							<div className="flex items-center gap-2">
								<ToggleSwitch
									checked={isEnabled}
									onChange={handleToggle}
									disabled={isRequired}
									aria-label={t("chat:reasoning.toggleAriaLabel")}
									data-testid="reasoning-selector-toggle"
								/>
								<Settings
									className="inline size-4 cursor-pointer"
									onClick={handleOpenSettings}
									data-testid="reasoning-selector-settings"
								/>
							</div>
						</div>
						<p className="m-0 mt-2 text-xs text-vscode-descriptionForeground">
							{isRequired
								? t("chat:reasoning.required")
								: canDisableThinking(context) === false
									? t("chat:reasoning.cannotDisable")
									: t("chat:reasoning.description")}
						</p>
					</div>
					<div className="flex flex-col p-1" data-testid="reasoning-selector-options">
						{options.map((effort) => {
							const isCurrent = isEnabled && effort === selectedEffort

							return (
								<button
									key={effort}
									type="button"
									onClick={() => handleSelectEffort(effort)}
									data-testid={`reasoning-selector-option-${effort}`}
									className={cn(
										"flex items-center justify-between gap-2 w-full px-2 py-1.5 text-left text-sm",
										"bg-transparent border-none rounded-sm cursor-pointer",
										"text-vscode-foreground hover:bg-vscode-list-hoverBackground",
										"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
										isCurrent &&
											"bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground",
										!isEnabled && "opacity-60",
									)}>
									<span className="truncate">
										{t(`settings:providers.reasoningEffort.${effort}`)}
									</span>
									{isCurrent && <Check className="size-3 flex-shrink-0" />}
								</button>
							)
						})}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
