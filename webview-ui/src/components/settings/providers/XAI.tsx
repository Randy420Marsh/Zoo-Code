import { useCallback, useEffect, useRef, useState } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useQueryClient } from "@tanstack/react-query"
import { Checkbox } from "vscrui"

import {
	allRouterModelsProvider,
	providerIdentifiers,
	type ProviderSettings,
	type ExtensionMessage,
	RouterModelsMessageType,
	xaiDefaultModelId,
	xaiModels,
} from "@roo-code/types"

import { RouterName } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { vscode } from "@src/utils/vscode"
import { Button } from "@src/components/ui"

import { ModelPicker } from "../ModelPicker"
import { handleModelChangeSideEffects } from "../utils/providerModelConfig"
import { inputEventTransform, noTransform } from "../transforms"

type XAIProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
}

enum RefreshStatus {
	Idle = "idle",
	Loading = "loading",
	Success = "success",
	Error = "error",
}

export const XAI = ({ apiConfiguration, setApiConfigurationField, simplifySettings }: XAIProps) => {
	const { t } = useAppTranslation()
	const { routerModels } = useExtensionState()
	const queryClient = useQueryClient()
	const [refreshStatus, setRefreshStatus] = useState(RefreshStatus.Idle)
	const [refreshError, setRefreshError] = useState<string | undefined>()
	const xaiErrorJustReceived = useRef(false)

	useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (message.type === RouterModelsMessageType.singleRouterModelFetchResponse && !message.success) {
				const providerName = message.values?.provider as RouterName
				if (providerName === providerIdentifiers.xai && refreshStatus === RefreshStatus.Loading) {
					xaiErrorJustReceived.current = true
					setRefreshStatus(RefreshStatus.Error)
					setRefreshError(message.error)
				}
			} else if (message.type === RouterModelsMessageType.routerModels) {
				if (refreshStatus === RefreshStatus.Loading) {
					if (!xaiErrorJustReceived.current) {
						setRefreshStatus(RefreshStatus.Success)
						void queryClient.invalidateQueries({
							queryKey: [RouterModelsMessageType.routerModels, providerIdentifiers.xai],
						})
						void queryClient.invalidateQueries({
							queryKey: [RouterModelsMessageType.routerModels, allRouterModelsProvider],
						})
					}
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [refreshStatus, queryClient])

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const handleRefreshModels = useCallback(() => {
		xaiErrorJustReceived.current = false
		setRefreshStatus(RefreshStatus.Loading)
		setRefreshError(undefined)

		const key = apiConfiguration.xaiApiKey
		if (!key) {
			setRefreshStatus(RefreshStatus.Error)
			setRefreshError(t("settings:providers.refreshModels.missingConfig"))
			return
		}

		vscode.postMessage({
			type: RouterModelsMessageType.requestRouterModels,
			values: {
				provider: providerIdentifiers.xai,
				xaiApiKey: key,
				refresh: true,
			},
		})
	}, [apiConfiguration.xaiApiKey, t])

	// Prefer live catalog; fall back to static so the picker is never empty offline.
	// Generation models (grok-imagine-*, grok-voice*) are kept in the live catalog so
	// the refresh can report their capabilities, but the chat picker only offers them
	// when the matching generation toggle is on.
	const live = routerModels?.[providerIdentifiers.xai]
	const allModels = live && Object.keys(live).length > 0 ? { ...xaiModels, ...live } : { ...xaiModels }
	const models = Object.fromEntries(
		Object.entries(allModels).filter(([modelId]) => {
			const isImageModel = modelId.startsWith("grok-imagine-image")
			const isVideoModel = modelId.startsWith("grok-imagine-video")
			const isAudioModel = modelId.startsWith("grok-voice")
			if (!isImageModel && !isVideoModel && !isAudioModel) {
				return true
			}
			return (
				(isImageModel && apiConfiguration.xaiAllowImageGeneration === true) ||
				(isVideoModel && apiConfiguration.xaiAllowVideoGeneration === true) ||
				(isAudioModel && apiConfiguration.xaiAllowAudioGeneration === true)
			)
		}),
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.xaiApiKey || ""}
				type="password"
				onInput={handleInputChange("xaiApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.xaiApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.xaiApiKey && (
				<VSCodeButtonLink href="https://console.x.ai/" appearance="secondary">
					{t("settings:providers.getXaiApiKey")}
				</VSCodeButtonLink>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={xaiDefaultModelId}
				models={models}
				modelIdKey="apiModelId"
				serviceName="xAI"
				serviceUrl="https://docs.x.ai/developers/models"
				simplifySettings={simplifySettings}
				onModelChange={(modelId) =>
					handleModelChangeSideEffects(providerIdentifiers.xai, modelId, setApiConfigurationField)
				}
			/>
			<div className="space-y-3">
				<div>
					<Checkbox
						checked={apiConfiguration.xaiStreaming !== false}
						onChange={handleInputChange("xaiStreaming", noTransform)}>
						{t("settings:providers.xaiStreaming")}
					</Checkbox>
					<div className="text-sm text-vscode-descriptionForeground ml-6">
						{t("settings:providers.xaiStreamingDescription")}
					</div>
				</div>
				<Checkbox
					checked={apiConfiguration.xaiAllowImageInput !== false}
					onChange={handleInputChange("xaiAllowImageInput", noTransform)}>
					{t("settings:providers.xaiAllowImageInput")}
				</Checkbox>
				<Checkbox
					checked={apiConfiguration.xaiAllowVideoInput !== false}
					onChange={handleInputChange("xaiAllowVideoInput", noTransform)}>
					{t("settings:providers.xaiAllowVideoInput")}
				</Checkbox>
				<Checkbox
					checked={apiConfiguration.xaiAllowAudioInput !== false}
					onChange={handleInputChange("xaiAllowAudioInput", noTransform)}>
					{t("settings:providers.xaiAllowAudioInput")}
				</Checkbox>
				<div>
					<Checkbox
						checked={apiConfiguration.xaiAllowImageGeneration === true}
						onChange={handleInputChange("xaiAllowImageGeneration", noTransform)}>
						{t("settings:providers.xaiAllowImageGeneration")}
					</Checkbox>
					<div className="text-sm text-vscode-descriptionForeground ml-6">
						{t("settings:providers.xaiAllowImageGenerationDescription")}
					</div>
				</div>
				<Checkbox
					checked={apiConfiguration.xaiAllowVideoGeneration === true}
					onChange={handleInputChange("xaiAllowVideoGeneration", noTransform)}>
					{t("settings:providers.xaiAllowVideoGeneration")}
				</Checkbox>
				<Checkbox
					checked={apiConfiguration.xaiAllowAudioGeneration === true}
					onChange={handleInputChange("xaiAllowAudioGeneration", noTransform)}>
					{t("settings:providers.xaiAllowAudioGeneration")}
				</Checkbox>
			</div>
			<Button
				variant="outline"
				onClick={handleRefreshModels}
				disabled={refreshStatus === RefreshStatus.Loading || !apiConfiguration.xaiApiKey}>
				<div className="flex items-center gap-2">
					{refreshStatus === RefreshStatus.Loading ? (
						<span className="codicon codicon-loading codicon-modifier-spin" />
					) : (
						<span className="codicon codicon-refresh" />
					)}
					{t("settings:providers.refreshModels.label")}
				</div>
			</Button>
			{refreshStatus === RefreshStatus.Loading && (
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.refreshModels.loading")}
				</div>
			)}
			{refreshStatus === RefreshStatus.Success && (
				<div className="text-sm text-vscode-foreground">{t("settings:providers.refreshModels.success")}</div>
			)}
			{refreshStatus === RefreshStatus.Error && (
				<div className="text-sm text-vscode-errorForeground">
					{refreshError || t("settings:providers.refreshModels.error")}
				</div>
			)}
		</>
	)
}
