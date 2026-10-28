import { useCallback, useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	type RouterModels,
	openRouterDefaultModelId,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { getOpenRouterAuthUrl } from "@src/oauth/urls"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform, noTransform } from "../transforms"

import { ModelPicker } from "../ModelPicker"
import { OpenRouterBalanceDisplay } from "./OpenRouterBalanceDisplay"

type OpenRouterProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	selectedModelId: string
	uriScheme: string | undefined
	simplifySettings?: boolean
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const OpenRouter = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	uriScheme,
	simplifySettings,
	organizationAllowList,
	modelValidationError,
}: OpenRouterProps) => {
	const { t } = useAppTranslation()

	const [openRouterBaseUrlSelected, setOpenRouterBaseUrlSelected] = useState(!!apiConfiguration?.openRouterBaseUrl)

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

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.openRouterApiKey || ""}
				type="password"
				onInput={handleInputChange("openRouterApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<div className="flex justify-between items-center mb-1">
					<label className="block font-medium">{t("settings:providers.openRouterApiKey")}</label>
					{apiConfiguration?.openRouterApiKey && (
						<OpenRouterBalanceDisplay
							apiKey={apiConfiguration.openRouterApiKey}
							baseUrl={apiConfiguration.openRouterBaseUrl}
						/>
					)}
				</div>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.openRouterApiKey && (
				<VSCodeButtonLink href={getOpenRouterAuthUrl(uriScheme)} style={{ width: "100%" }} appearance="primary">
					{t("settings:providers.getOpenRouterApiKey")}
				</VSCodeButtonLink>
			)}
			{!simplifySettings && (
				<div>
					<Checkbox
						checked={openRouterBaseUrlSelected}
						onChange={(checked: boolean) => {
							setOpenRouterBaseUrlSelected(checked)

							if (!checked) {
								setApiConfigurationField("openRouterBaseUrl", "")
							}
						}}>
						{t("settings:providers.useCustomBaseUrl")}
					</Checkbox>
					{openRouterBaseUrlSelected && (
						<VSCodeTextField
							value={apiConfiguration?.openRouterBaseUrl || ""}
							type="url"
							onInput={handleInputChange("openRouterBaseUrl")}
							placeholder="Default: https://openrouter.ai/api/v1"
							className="w-full mt-1"
						/>
					)}
				</div>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={openRouterDefaultModelId}
				models={routerModels?.openrouter ?? {}}
				modelIdKey="openRouterModelId"
				serviceName="OpenRouter"
				serviceUrl="https://openrouter.ai/models"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
				simplifySettings={simplifySettings}
			/>
			{!simplifySettings && (
				<div className="space-y-3">
					<div>
						<Checkbox
							checked={apiConfiguration.openRouterStreaming !== false}
							onChange={handleInputChange("openRouterStreaming", noTransform)}>
							{t("settings:providers.openRouterStreaming")}
						</Checkbox>
						<div className="text-sm text-vscode-descriptionForeground ml-6">
							{t("settings:providers.openRouterStreamingDescription")}
						</div>
					</div>
					<Checkbox
						checked={apiConfiguration.openRouterAllowImageInput !== false}
						onChange={handleInputChange("openRouterAllowImageInput", noTransform)}>
						{t("settings:providers.openRouterAllowImageInput")}
					</Checkbox>
					<Checkbox
						checked={apiConfiguration.openRouterAllowVideoInput !== false}
						onChange={handleInputChange("openRouterAllowVideoInput", noTransform)}>
						{t("settings:providers.openRouterAllowVideoInput")}
					</Checkbox>
					<Checkbox
						checked={apiConfiguration.openRouterAllowAudioInput !== false}
						onChange={handleInputChange("openRouterAllowAudioInput", noTransform)}>
						{t("settings:providers.openRouterAllowAudioInput")}
					</Checkbox>
					<Checkbox
						checked={apiConfiguration.openRouterAllowImageGeneration === true}
						onChange={handleInputChange("openRouterAllowImageGeneration", noTransform)}>
						{t("settings:providers.openRouterAllowImageGeneration")}
					</Checkbox>
					<Checkbox
						checked={apiConfiguration.openRouterAllowVideoGeneration === true}
						onChange={handleInputChange("openRouterAllowVideoGeneration", noTransform)}>
						{t("settings:providers.openRouterAllowVideoGeneration")}
					</Checkbox>
					<Checkbox
						checked={apiConfiguration.openRouterAllowAudioGeneration === true}
						onChange={handleInputChange("openRouterAllowAudioGeneration", noTransform)}>
						{t("settings:providers.openRouterAllowAudioGeneration")}
					</Checkbox>
				</div>
			)}
		</>
	)
}
