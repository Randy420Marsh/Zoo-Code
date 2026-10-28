import { useCallback, useEffect, useRef, useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useQueryClient } from "@tanstack/react-query"

import {
	allRouterModelsProvider,
	geminiDefaultModelId,
	geminiModels,
	providerIdentifiers,
	RouterModelsMessageType,
	type ExtensionMessage,
	type ProviderSettings,
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

type GeminiProps = {
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

export const Gemini = ({ apiConfiguration, setApiConfigurationField, simplifySettings }: GeminiProps) => {
	const { t } = useAppTranslation()
	const { routerModels } = useExtensionState()
	const queryClient = useQueryClient()
	const [refreshStatus, setRefreshStatus] = useState(RefreshStatus.Idle)
	const [refreshError, setRefreshError] = useState<string | undefined>()
	const geminiErrorJustReceived = useRef(false)

	const [googleGeminiBaseUrlSelected, setGoogleGeminiBaseUrlSelected] = useState(
		!!apiConfiguration?.googleGeminiBaseUrl,
	)

	useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (message.type === RouterModelsMessageType.singleRouterModelFetchResponse && !message.success) {
				const providerName = message.values?.provider as RouterName
				if (providerName === providerIdentifiers.gemini && refreshStatus === RefreshStatus.Loading) {
					geminiErrorJustReceived.current = true
					setRefreshStatus(RefreshStatus.Error)
					setRefreshError(message.error)
				}
			} else if (message.type === RouterModelsMessageType.routerModels) {
				if (refreshStatus === RefreshStatus.Loading) {
					if (!geminiErrorJustReceived.current) {
						setRefreshStatus(RefreshStatus.Success)
						void queryClient.invalidateQueries({
							queryKey: [RouterModelsMessageType.routerModels, providerIdentifiers.gemini],
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
		geminiErrorJustReceived.current = false
		setRefreshStatus(RefreshStatus.Loading)
		setRefreshError(undefined)

		const key = apiConfiguration.geminiApiKey
		if (!key) {
			setRefreshStatus(RefreshStatus.Error)
			setRefreshError(t("settings:providers.refreshModels.missingConfig"))
			return
		}

		vscode.postMessage({
			type: RouterModelsMessageType.requestRouterModels,
			values: {
				provider: providerIdentifiers.gemini,
				geminiApiKey: key,
				googleGeminiBaseUrl: apiConfiguration.googleGeminiBaseUrl,
				refresh: true,
			},
		})
	}, [apiConfiguration.geminiApiKey, apiConfiguration.googleGeminiBaseUrl, t])

	const live = routerModels?.[providerIdentifiers.gemini]
	const allModels = live && Object.keys(live).length > 0 ? { ...geminiModels, ...live } : { ...geminiModels }
	const models = Object.fromEntries(
		Object.entries(allModels).filter(([modelId]) => {
			const lower = modelId.toLowerCase()
			const isImageModel =
				lower.includes("-image") || lower.startsWith("gemini-nano-banana") || lower.startsWith("imagen-")
			const isVideoModel = lower.startsWith("veo-") || lower.includes("-video")
			const isAudioModel = lower.endsWith("-tts") || lower.includes("-transcribe")
			if (!isImageModel && !isVideoModel && !isAudioModel) {
				return true
			}
			return (
				(isImageModel && apiConfiguration.geminiAllowImageGeneration === true) ||
				(isVideoModel && apiConfiguration.geminiAllowVideoGeneration === true) ||
				(isAudioModel && apiConfiguration.geminiAllowAudioGeneration === true)
			)
		}),
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.geminiApiKey || ""}
				type="password"
				onInput={handleInputChange("geminiApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.geminiApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.geminiApiKey && (
				<VSCodeButtonLink href="https://ai.google.dev/" appearance="secondary">
					{t("settings:providers.getGeminiApiKey")}
				</VSCodeButtonLink>
			)}

			<div>
				<Checkbox
					data-testid="checkbox-custom-base-url"
					checked={googleGeminiBaseUrlSelected}
					onChange={(checked: boolean) => {
						setGoogleGeminiBaseUrlSelected(checked)
						if (!checked) {
							setApiConfigurationField("googleGeminiBaseUrl", "")
						}
					}}>
					{t("settings:providers.useCustomBaseUrl")}
				</Checkbox>
				{googleGeminiBaseUrlSelected && (
					<VSCodeTextField
						value={apiConfiguration?.googleGeminiBaseUrl || ""}
						type="url"
						onInput={handleInputChange("googleGeminiBaseUrl")}
						placeholder={t("settings:defaults.geminiUrl")}
						className="w-full mt-1"
					/>
				)}
			</div>

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={geminiDefaultModelId}
				models={models}
				modelIdKey="apiModelId"
				serviceName="Google Gemini"
				serviceUrl="https://ai.google.dev"
				simplifySettings={simplifySettings}
				onModelChange={(modelId) =>
					handleModelChangeSideEffects(providerIdentifiers.gemini, modelId, setApiConfigurationField)
				}
			/>

			{!simplifySettings && (
				<>
					<div className="space-y-3">
						<div>
							<Checkbox
								checked={apiConfiguration.geminiStreaming !== false}
								onChange={handleInputChange("geminiStreaming", noTransform)}>
								{t("settings:providers.geminiStreaming")}
							</Checkbox>
							<div className="text-sm text-vscode-descriptionForeground ml-6">
								{t("settings:providers.geminiStreamingDescription")}
							</div>
						</div>
						<Checkbox
							checked={apiConfiguration.geminiAllowImageInput !== false}
							onChange={handleInputChange("geminiAllowImageInput", noTransform)}>
							{t("settings:providers.geminiAllowImageInput")}
						</Checkbox>
						<Checkbox
							checked={apiConfiguration.geminiAllowVideoInput !== false}
							onChange={handleInputChange("geminiAllowVideoInput", noTransform)}>
							{t("settings:providers.geminiAllowVideoInput")}
						</Checkbox>
						<Checkbox
							checked={apiConfiguration.geminiAllowAudioInput !== false}
							onChange={handleInputChange("geminiAllowAudioInput", noTransform)}>
							{t("settings:providers.geminiAllowAudioInput")}
						</Checkbox>
						<div>
							<Checkbox
								checked={apiConfiguration.geminiAllowImageGeneration === true}
								onChange={handleInputChange("geminiAllowImageGeneration", noTransform)}>
								{t("settings:providers.geminiAllowImageGeneration")}
							</Checkbox>
							<div className="text-sm text-vscode-descriptionForeground ml-6">
								{t("settings:providers.geminiAllowImageGenerationDescription")}
							</div>
						</div>
						<Checkbox
							checked={apiConfiguration.geminiAllowVideoGeneration === true}
							onChange={handleInputChange("geminiAllowVideoGeneration", noTransform)}>
							{t("settings:providers.geminiAllowVideoGeneration")}
						</Checkbox>
						<Checkbox
							checked={apiConfiguration.geminiAllowAudioGeneration === true}
							onChange={handleInputChange("geminiAllowAudioGeneration", noTransform)}>
							{t("settings:providers.geminiAllowAudioGeneration")}
						</Checkbox>
					</div>

					<Button
						variant="outline"
						onClick={handleRefreshModels}
						disabled={refreshStatus === RefreshStatus.Loading || !apiConfiguration.geminiApiKey}>
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
						<div className="text-sm text-vscode-foreground">
							{t("settings:providers.refreshModels.success")}
						</div>
					)}
					{refreshStatus === RefreshStatus.Error && (
						<div className="text-sm text-vscode-errorForeground">
							{refreshError || t("settings:providers.refreshModels.error")}
						</div>
					)}
				</>
			)}
		</>
	)
}
