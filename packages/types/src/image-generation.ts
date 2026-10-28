import { providerIdentifiers } from "./provider-identifiers.js"

/**
 * Image generation model constants
 */

/**
 * API method used for image generation
 */
export type ImageGenerationApiMethod = "chat_completions" | "images_api" | "gemini_generate_content"

export interface ImageGenerationModel {
	value: string
	label: string
	provider: ImageGenerationProvider
	apiMethod?: ImageGenerationApiMethod
}

export const IMAGE_GENERATION_MODELS: ImageGenerationModel[] = [
	// OpenRouter models
	{
		value: "google/gemini-nano-banana-2.1",
		label: "Gemini Nano Banana 2.1",
		provider: providerIdentifiers.openrouter,
	},
	{
		value: "google/gemini-2.5-flash-image",
		label: "Gemini 2.5 Flash Image",
		provider: providerIdentifiers.openrouter,
	},
	{
		value: "google/gemini-3-pro-image-preview",
		label: "Gemini 3 Pro Image Preview",
		provider: providerIdentifiers.openrouter,
	},
	{
		value: "google/gemini-3-pro-image",
		label: "Gemini 3 Pro Image (Nano Banana Pro)",
		provider: providerIdentifiers.openrouter,
	},
	{
		value: "google/gemini-3.1-flash-image",
		label: "Gemini 3.1 Flash Image (Nano Banana 2)",
		provider: providerIdentifiers.openrouter,
	},
	{
		value: "google/gemini-3.1-flash-lite-image",
		label: "Gemini 3.1 Flash Lite Image (Nano Banana 2 Lite)",
		provider: providerIdentifiers.openrouter,
	},
	{ value: "openai/gpt-5.4-image-2", label: "GPT-5.4 Image 2", provider: providerIdentifiers.openrouter },
	{ value: "openai/gpt-image-2", label: "GPT Image 2", provider: providerIdentifiers.openrouter },
	{ value: "openai/gpt-5-image", label: "GPT-5 Image", provider: providerIdentifiers.openrouter },
	{ value: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini", provider: providerIdentifiers.openrouter },
	{
		value: "x-ai/grok-imagine-image-2.0",
		label: "xAI Grok Imagine Image 2.0",
		provider: providerIdentifiers.openrouter,
	},
	{
		value: "black-forest-labs/flux-3-image",
		label: "Black Forest Labs FLUX 3 Image",
		provider: providerIdentifiers.openrouter,
	},
	{
		value: "black-forest-labs/flux-3-image-klein",
		label: "Black Forest Labs FLUX 3 Image Klein",
		provider: providerIdentifiers.openrouter,
	},
	{
		value: "black-forest-labs/flux.2-flex",
		label: "Black Forest Labs FLUX.2 Flex",
		provider: providerIdentifiers.openrouter,
	},
	{
		value: "black-forest-labs/flux.2-pro",
		label: "Black Forest Labs FLUX.2 Pro",
		provider: providerIdentifiers.openrouter,
	},
	// xAI models
	{
		value: "grok-imagine-image-2.0",
		label: "Grok Imagine Image 2.0",
		provider: providerIdentifiers.xai,
		apiMethod: "images_api",
	},
	// Google Gemini models (Gemini API with GEMINI_API_KEY)
	{
		value: "gemini-nano-banana-2.1",
		label: "Gemini Nano Banana 2.1",
		provider: providerIdentifiers.gemini,
		apiMethod: "gemini_generate_content",
	},
	{
		value: "gemini-3.1-flash-image",
		label: "Gemini 3.1 Flash Image (Nano Banana 2)",
		provider: providerIdentifiers.gemini,
		apiMethod: "gemini_generate_content",
	},
	{
		value: "gemini-3.1-flash-lite-image",
		label: "Gemini 3.1 Flash Lite Image (Nano Banana 2 Lite)",
		provider: providerIdentifiers.gemini,
		apiMethod: "gemini_generate_content",
	},
	{
		value: "gemini-3-pro-image",
		label: "Gemini 3 Pro Image (Nano Banana Pro)",
		provider: providerIdentifiers.gemini,
		apiMethod: "gemini_generate_content",
	},
	{
		value: "nano-banana-pro-preview",
		label: "Nano Banana Pro Preview",
		provider: providerIdentifiers.gemini,
		apiMethod: "gemini_generate_content",
	},
	{
		value: "gemini-3.1-flash-image-preview",
		label: "Gemini 3.1 Flash Image Preview",
		provider: providerIdentifiers.gemini,
		apiMethod: "gemini_generate_content",
	},
	{
		value: "gemini-3-pro-image-preview",
		label: "Gemini 3 Pro Image Preview",
		provider: providerIdentifiers.gemini,
		apiMethod: "gemini_generate_content",
	},
	{
		value: "gemini-2.5-flash-image",
		label: "Gemini 2.5 Flash Image (Nano Banana)",
		provider: providerIdentifiers.gemini,
		apiMethod: "gemini_generate_content",
	},
]

/**
 * Get array of model values only (for backend validation)
 */
export const IMAGE_GENERATION_MODEL_IDS = IMAGE_GENERATION_MODELS.map((m) => m.value)

/**
 * Image generation provider type
 */
export type ImageGenerationProvider =
	typeof providerIdentifiers.openrouter | typeof providerIdentifiers.xai | typeof providerIdentifiers.gemini

/**
 * Get the image generation provider with backwards compatibility
 * - If provider is explicitly set, use it
 * - If a model is already configured (existing users), default to "openrouter"
 * - Otherwise default to "openrouter" (new users)
 */
export function getImageGenerationProvider(
	explicitProvider: ImageGenerationProvider | undefined,
	_hasExistingModel: boolean,
): ImageGenerationProvider {
	return explicitProvider !== undefined ? explicitProvider : providerIdentifiers.openrouter
}
