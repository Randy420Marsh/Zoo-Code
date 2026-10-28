import { t } from "../../../i18n"

// Image generation types
interface ImageGenerationResponse {
	choices?: Array<{
		message?: {
			content?: string
			images?: Array<{
				type?: string
				image_url?: {
					url?: string
				}
			}>
		}
	}>
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

interface ImagesApiResponse {
	data?: Array<{
		b64_json?: string
		url?: string
	}>
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

export interface ImageGenerationResult {
	success: boolean
	imageData?: string
	imageFormat?: string
	error?: string
}

interface ImageGenerationOptions {
	baseURL: string
	authToken: string
	model: string
	prompt: string
	inputImage?: string
}

interface ImagesApiOptions {
	baseURL: string
	authToken: string
	model: string
	prompt: string
	inputImage?: string
	size?: string
	quality?: string
	outputFormat?: string
	responseFormat?: "b64_json" | "url"
	aspectRatio?: string
	resolution?: string
}

export interface XaiImagineImageOptions {
	apiKey: string
	model: string
	prompt: string
	inputImage?: string
	aspectRatio?: string
	resolution?: string
	quality?: string
}

export interface GeminiImageOptions {
	apiKey: string
	baseURL?: string
	model: string
	prompt: string
	inputImage?: string
	aspectRatio?: string
	resolution?: string
}

export function detectBase64ImageFormat(base64Data: string, fallback: string = "png"): string {
	const trimmed = base64Data.trim()
	if (trimmed.startsWith("iVBORw0KGgo")) {
		return "png"
	}
	if (trimmed.startsWith("/9j/")) {
		return "jpeg"
	}
	if (trimmed.startsWith("UklGR")) {
		return "webp"
	}
	if (trimmed.startsWith("R0lGOD")) {
		return "gif"
	}
	return fallback
}

/**
 * Shared image generation implementation for OpenRouter and Zoo Code Cloud providers
 */
export async function generateImageWithProvider(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, inputImage } = options

	try {
		const response = await fetch(`${baseURL}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://github.com/Randy420Marsh/Zoo-Code",
				"X-Title": "Zoo Code",
			},
			body: JSON.stringify({
				model,
				messages: [
					{
						role: "user",
						content: inputImage
							? [
									{
										type: "text",
										text: prompt,
									},
									{
										type: "image_url",
										image_url: {
											url: inputImage,
										},
									},
								]
							: prompt,
					},
				],
				modalities: ["image", "text"],
			}),
		})

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = t("tools:generateImage.failedWithStatus", {
				status: response.status,
				statusText: response.statusText,
			})

			try {
				const errorJson = JSON.parse(errorText)
				if (errorJson.error?.message) {
					errorMessage = t("tools:generateImage.failedWithMessage", {
						message: errorJson.error.message,
					})
				}
			} catch {
				// Use default error message
			}
			return {
				success: false,
				error: errorMessage,
			}
		}

		const result: ImageGenerationResponse = await response.json()

		if (result.error) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		// Extract the generated image from the response
		const images = result.choices?.[0]?.message?.images
		if (!images || images.length === 0) {
			return {
				success: false,
				error: t("tools:generateImage.noImageGenerated"),
			}
		}

		const imageData = images[0]?.image_url?.url
		if (!imageData) {
			return {
				success: false,
				error: t("tools:generateImage.invalidImageData"),
			}
		}

		// Extract base64 data from data URL
		const base64Match = imageData.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
		if (!base64Match) {
			return {
				success: false,
				error: t("tools:generateImage.invalidImageFormat"),
			}
		}

		return {
			success: true,
			imageData: imageData,
			imageFormat: base64Match[1],
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

/**
 * Generate an image using OpenAI's Images API (/v1/images/generations)
 * Supports BFL models (Flux) with provider-specific options for image editing
 *
 * @internal
 */
export async function generateImageWithImagesApi(options: ImagesApiOptions): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, inputImage, outputFormat = "png" } = options

	try {
		const url = `${baseURL}/images/generations`

		// Build the request body
		// For BFL models, inputImage is passed via providerOptions.blackForestLabs.inputImage
		const requestBody: Record<string, unknown> = {
			model,
			prompt,
			n: 1,
		}

		// Add optional parameters
		if (options.size) {
			requestBody.size = options.size
		}
		if (options.quality) {
			requestBody.quality = options.quality
		}
		// xAI Imagine documents these names. Other Images API models ignore unknown fields.
		if (options.aspectRatio) {
			requestBody.aspect_ratio = options.aspectRatio
		}
		if (options.resolution) {
			requestBody.resolution = options.resolution
		}
		if (options.responseFormat) {
			requestBody.response_format = options.responseFormat
		}

		const isXaiRequest = baseURL.includes("api.x.ai") || model.startsWith("grok-imagine-image")

		// For BFL (Black Forest Labs) models like flux-pro-1.1, use providerOptions
		if (model.startsWith("bfl/")) {
			requestBody.providerOptions = {
				blackForestLabs: {
					outputFormat: outputFormat,
					// inputImage: Base64 encoded image or URL of image to use as reference
					...(inputImage && { inputImage }),
				},
			}
		} else if (isXaiRequest) {
			if (inputImage) {
				requestBody.image_url = inputImage
			}
		} else {
			// For other models, use standard output_format parameter
			requestBody.output_format = outputFormat
		}

		const fetchOptions: RequestInit = {
			method: "POST",
			headers: {
				Authorization: `Bearer ${authToken}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://github.com/Randy420Marsh/Zoo-Code",
				"X-Title": "Zoo Code",
			},
			body: JSON.stringify(requestBody),
		}

		const response = await fetch(url, fetchOptions)

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = t("tools:generateImage.failedWithStatus", {
				status: response.status,
				statusText: response.statusText,
			})

			try {
				const errorJson = JSON.parse(errorText)
				if (errorJson.error?.message) {
					errorMessage = t("tools:generateImage.failedWithMessage", {
						message: errorJson.error.message,
					})
				}
			} catch {
				// Use default error message
			}
			return {
				success: false,
				error: errorMessage,
			}
		}

		const result: ImagesApiResponse = await response.json()

		if (result.error) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		// Extract the generated image from the response
		const images = result.data
		if (!images || images.length === 0) {
			return {
				success: false,
				error: t("tools:generateImage.noImageGenerated"),
			}
		}

		const imageItem = images[0]

		// Handle b64_json response (most common)
		if (imageItem?.b64_json) {
			const detectedFormat = detectBase64ImageFormat(imageItem.b64_json, outputFormat)
			// Convert base64 to data URL
			const dataUrl = `data:image/${detectedFormat};base64,${imageItem.b64_json}`
			return {
				success: true,
				imageData: dataUrl,
				imageFormat: detectedFormat,
			}
		}

		// Handle URL response (fallback)
		if (imageItem?.url) {
			// If it's already a data URL, use it directly
			if (imageItem.url.startsWith("data:image/")) {
				const formatMatch = imageItem.url.match(/^data:image\/(\w+);/)
				const format = formatMatch?.[1] || outputFormat
				return {
					success: true,
					imageData: imageItem.url,
					imageFormat: format,
				}
			}
			// For external URLs, return as-is (the caller will need to handle fetching)
			return {
				success: true,
				imageData: imageItem.url,
				imageFormat: outputFormat,
			}
		}

		return {
			success: false,
			error: t("tools:generateImage.invalidImageData"),
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

const XAI_IMAGE_ASPECT_RATIOS = new Set([
	"1:1",
	"16:9",
	"9:16",
	"4:3",
	"3:4",
	"3:2",
	"2:3",
	"2:1",
	"1:2",
	"19.5:9",
	"9:19.5",
	"20:9",
	"9:20",
	"21:9",
	"5:2",
	"auto",
])

const XAI_IMAGE_RESOLUTIONS = new Set(["1k", "2k"])
const XAI_IMAGE_QUALITIES = new Set(["auto", "low", "medium"])

/**
 * POST https://api.x.ai/v1/images/generations for grok-imagine-image-2.0.
 * Only documented fields are sent. Width/height pixels are not an xAI parameter.
 */
export async function generateXaiImagineImage(options: XaiImagineImageOptions): Promise<ImageGenerationResult> {
	const aspectRatio =
		options.aspectRatio && XAI_IMAGE_ASPECT_RATIOS.has(options.aspectRatio) ? options.aspectRatio : "auto"
	const resolution = options.resolution && XAI_IMAGE_RESOLUTIONS.has(options.resolution) ? options.resolution : "1k"
	const quality = options.quality && XAI_IMAGE_QUALITIES.has(options.quality) ? options.quality : "auto"

	return generateImageWithImagesApi({
		baseURL: "https://api.x.ai/v1",
		authToken: options.apiKey,
		model: options.model || "grok-imagine-image-2.0",
		prompt: options.prompt,
		inputImage: options.inputImage,
		aspectRatio,
		resolution,
		quality,
		responseFormat: "b64_json",
		outputFormat: "png",
	})
}

const GEMINI_IMAGE_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"])
const GEMINI_IMAGE_SIZES = new Set(["1K", "2K", "4K"])

interface GeminiGenerateContentResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string
				inlineData?: {
					mimeType?: string
					data?: string
				}
			}>
		}
	}>
	error?: {
		message?: string
		status?: string
		code?: number
	}
}

/**
 * Generate or edit an image using Google Gemini's native generateContent endpoint
 * (`/v1beta/models/{model}:generateContent` with `responseModalities: ["TEXT", "IMAGE"]`).
 */
export async function generateGeminiImage(options: GeminiImageOptions): Promise<ImageGenerationResult> {
	const { apiKey, baseURL = "https://generativelanguage.googleapis.com", model, prompt, inputImage } = options
	const cleanBaseUrl = baseURL.replace(/\/+$/, "")
	const cleanModel = model.replace(/^models\//, "")
	const url = `${cleanBaseUrl}/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`

	const parts: Array<Record<string, unknown>> = [{ text: prompt }]
	if (inputImage) {
		const dataUrlMatch = inputImage.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
		if (dataUrlMatch) {
			parts.push({
				inlineData: {
					mimeType: dataUrlMatch[1],
					data: dataUrlMatch[2],
				},
			})
		}
	}

	const imageConfig: Record<string, string> = {}
	if (options.aspectRatio && GEMINI_IMAGE_ASPECT_RATIOS.has(options.aspectRatio)) {
		imageConfig.aspectRatio = options.aspectRatio
	}
	const normalizedSize = options.resolution?.trim().toUpperCase()
	if (normalizedSize && GEMINI_IMAGE_SIZES.has(normalizedSize)) {
		imageConfig.imageSize = normalizedSize
	}

	const requestBody: Record<string, unknown> = {
		contents: [{ role: "user", parts }],
		generationConfig: {
			responseModalities: ["TEXT", "IMAGE"],
			...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
		},
	}

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"x-goog-api-key": apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
		})

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = t("tools:generateImage.failedWithStatus", {
				status: response.status,
				statusText: response.statusText,
			})
			try {
				const errorJson = JSON.parse(errorText) as GeminiGenerateContentResponse
				if (errorJson.error?.message) {
					errorMessage = t("tools:generateImage.failedWithMessage", {
						message: errorJson.error.message,
					})
				}
			} catch {
				// Use default error message
			}
			return {
				success: false,
				error: errorMessage,
			}
		}

		const result = (await response.json()) as GeminiGenerateContentResponse
		if (result.error?.message) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		const candidateParts = result.candidates?.[0]?.content?.parts ?? []
		const imagePart = candidateParts.find(
			(part) =>
				part.inlineData?.data && (!part.inlineData.mimeType || part.inlineData.mimeType.startsWith("image/")),
		)
		const base64Data = imagePart?.inlineData?.data
		if (!base64Data) {
			return {
				success: false,
				error: t("tools:generateImage.noImageGenerated"),
			}
		}

		const rawFormat = imagePart?.inlineData?.mimeType?.split("/")[1]?.toLowerCase()
		const imageFormat = detectBase64ImageFormat(base64Data, rawFormat || "png")
		return {
			success: true,
			imageData: `data:image/${imageFormat};base64,${base64Data}`,
			imageFormat,
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}
