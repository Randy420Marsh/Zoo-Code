import path from "path"
import fs from "fs/promises"
import * as vscode from "vscode"
import {
	GenerateImageParams,
	IMAGE_GENERATION_MODEL_IDS,
	IMAGE_GENERATION_MODELS,
	getImageGenerationProvider,
	providerIdentifiers,
} from "@roo-code/types"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { OpenRouterHandler } from "../../api/providers/openrouter"
import { generateGeminiImage, generateXaiImagineImage } from "../../api/providers/utils/image-generation"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

export class GenerateImageTool extends BaseTool<"generate_image"> {
	readonly name = "generate_image" as const

	async execute(params: GenerateImageParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const {
			prompt,
			path: relPath,
			image: inputImagePath,
			model: requestedModel,
			aspect_ratio: aspectRatio,
			resolution,
			quality,
			width,
			height,
		} = params
		const { handleError, pushToolResult, askApproval } = callbacks

		const provider = task.providerRef.deref()
		const state = await provider?.getState()
		const activeModelInfo = task.api?.getModel?.()?.info
		const expEnabled = experiments.isEnabled(state?.experiments ?? {}, EXPERIMENT_IDS.IMAGE_GENERATION)
		const isImageGenerationEnabled =
			expEnabled ||
			activeModelInfo?.supportsImageGeneration === true ||
			(state?.mode === "media" && activeModelInfo?.supportsImageGeneration !== false)

		if (!isImageGenerationEnabled) {
			pushToolResult(
				formatResponse.toolError(
					"Image generation is an experimental feature that must be enabled in settings. Please enable 'Image Generation' in the Experimental Settings section.",
				),
			)
			return
		}

		if (!prompt) {
			task.consecutiveMistakeCount++
			task.recordToolError("generate_image")
			pushToolResult(await task.sayAndCreateMissingParamError("generate_image", "prompt"))
			return
		}

		if (!relPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("generate_image")
			pushToolResult(await task.sayAndCreateMissingParamError("generate_image", "path"))
			return
		}

		const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
		if (!accessAllowed) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		let inputImageData: string | undefined
		if (inputImagePath) {
			const inputImageFullPath = path.resolve(task.cwd, inputImagePath)

			const inputImageExists = await fileExistsAtPath(inputImageFullPath)
			if (!inputImageExists) {
				await task.say("error", `Input image not found: ${getReadablePath(task.cwd, inputImagePath)}`)
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(`Input image not found: ${getReadablePath(task.cwd, inputImagePath)}`),
				)
				return
			}

			const inputImageAccessAllowed = task.rooIgnoreController?.validateAccess(inputImagePath)
			if (!inputImageAccessAllowed) {
				await task.say("rooignore_error", inputImagePath)
				pushToolResult(formatResponse.rooIgnoreError(inputImagePath))
				return
			}

			try {
				const imageBuffer = await fs.readFile(inputImageFullPath)
				const imageExtension = path.extname(inputImageFullPath).toLowerCase().replace(".", "")

				const supportedFormats = ["png", "jpg", "jpeg", "gif", "webp"]
				if (!supportedFormats.includes(imageExtension)) {
					await task.say(
						"error",
						`Unsupported image format: ${imageExtension}. Supported formats: ${supportedFormats.join(", ")}`,
					)
					task.didToolFailInCurrentTurn = true
					pushToolResult(
						formatResponse.toolError(
							`Unsupported image format: ${imageExtension}. Supported formats: ${supportedFormats.join(", ")}`,
						),
					)
					return
				}

				const mimeType = imageExtension === "jpg" ? "jpeg" : imageExtension
				inputImageData = `data:image/${mimeType};base64,${imageBuffer.toString("base64")}`
			} catch (error) {
				await task.say(
					"error",
					`Failed to read input image: ${error instanceof Error ? error.message : "Unknown error"}`,
				)
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Failed to read input image: ${error instanceof Error ? error.message : "Unknown error"}`,
					),
				)
				return
			}
		}

		const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

		// Use shared utility for backwards compatibility logic
		let imageProvider = getImageGenerationProvider(
			state?.imageGenerationProvider,
			!!state?.openRouterImageGenerationSelectedModel,
		)

		const trimmedRequestedModel = requestedModel?.trim() || undefined
		if (trimmedRequestedModel) {
			if (trimmedRequestedModel.startsWith("grok-imagine-image")) {
				imageProvider = providerIdentifiers.xai
			} else if (trimmedRequestedModel.startsWith("gemini-")) {
				imageProvider = providerIdentifiers.gemini
			} else if (trimmedRequestedModel.includes("/")) {
				imageProvider = providerIdentifiers.openrouter
			}
		}

		// Get the selected model
		let selectedModel = trimmedRequestedModel ?? state?.openRouterImageGenerationSelectedModel
		let modelInfo = undefined

		// Find the model info matching both value AND provider
		// (since the same model value can exist for multiple providers)
		if (selectedModel) {
			modelInfo = IMAGE_GENERATION_MODELS.find((m) => m.value === selectedModel && m.provider === imageProvider)
			if (!modelInfo && !trimmedRequestedModel) {
				// Model doesn't exist for this provider, use first model for selected provider
				const providerModels = IMAGE_GENERATION_MODELS.filter((m) => m.provider === imageProvider)
				modelInfo = providerModels[0]
				selectedModel = modelInfo?.value || IMAGE_GENERATION_MODEL_IDS[0]
			}
		} else {
			// No model selected, use first model for selected provider
			const providerModels = IMAGE_GENERATION_MODELS.filter((m) => m.provider === imageProvider)
			modelInfo = providerModels[0]
			selectedModel = modelInfo?.value || IMAGE_GENERATION_MODEL_IDS[0]
		}

		// Resolve API keys in priority order:
		// 1. Active profile / Experimental Image Generation setting
		// 2. Saved Zoo-Code provider profiles (for cross-provider local model execution)
		// 3. Environment variables (XAI_API_KEY, GEMINI_API_KEY / GOOGLE_API_KEY, OPENROUTER_API_KEY)
		let openRouterApiKey = state?.openRouterImageApiKey || state?.apiConfiguration?.openRouterApiKey
		let geminiApiKey = state?.apiConfiguration?.geminiApiKey
		let xaiApiKey = state?.apiConfiguration?.xaiApiKey
		let geminiBaseUrl = state?.apiConfiguration?.googleGeminiBaseUrl

		if ((!openRouterApiKey || !geminiApiKey || !xaiApiKey) && provider?.providerSettingsManager?.listConfig) {
			try {
				const savedConfigs = await provider.providerSettingsManager.listConfig()
				for (const entry of savedConfigs ?? []) {
					if (openRouterApiKey && geminiApiKey && xaiApiKey) break
					const profile = await provider.providerSettingsManager.getProfile(
						entry.id ? { id: entry.id } : { name: entry.name },
					)
					if (!openRouterApiKey && profile.openRouterApiKey) {
						openRouterApiKey = profile.openRouterApiKey
					}
					if (!geminiApiKey && profile.geminiApiKey) {
						geminiApiKey = profile.geminiApiKey
						if (!geminiBaseUrl && profile.googleGeminiBaseUrl) {
							geminiBaseUrl = profile.googleGeminiBaseUrl
						}
					}
					if (!xaiApiKey && profile.xaiApiKey) {
						xaiApiKey = profile.xaiApiKey
					}
				}
			} catch {
				// Best-effort profile lookup for cross-provider fallback
			}
		}

		if (process.env.NODE_ENV !== "test") {
			openRouterApiKey = openRouterApiKey || process.env.OPENROUTER_API_KEY
		}
		geminiApiKey = geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
		xaiApiKey = xaiApiKey || process.env.XAI_API_KEY

		// Cross-provider fallback for local/other models when no specific model/provider was locked
		if (
			!trimmedRequestedModel &&
			!state?.imageGenerationProvider &&
			!state?.openRouterImageGenerationSelectedModel &&
			!openRouterApiKey
		) {
			if (xaiApiKey) {
				imageProvider = providerIdentifiers.xai
				selectedModel = "grok-imagine-image-2.0"
			} else if (geminiApiKey) {
				imageProvider = providerIdentifiers.gemini
				selectedModel = "gemini-nano-banana-2.1"
			}
		}

		const useXaiImagine =
			imageProvider === providerIdentifiers.xai || selectedModel.startsWith("grok-imagine-image")
		const useGeminiNative =
			!useXaiImagine &&
			(imageProvider === providerIdentifiers.gemini ||
				modelInfo?.apiMethod === "gemini_generate_content" ||
				(selectedModel.startsWith("gemini-") && !selectedModel.includes("/")))

		if (
			!useXaiImagine &&
			!useGeminiNative &&
			imageProvider === providerIdentifiers.openrouter &&
			!openRouterApiKey
		) {
			const errorMessage = t("tools:generateImage.openRouterApiKeyRequired")
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		if (useGeminiNative && !geminiApiKey) {
			const errorMessage = "Gemini API key is required for Gemini native image generation"
			await task.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		const fullPath = path.resolve(task.cwd, relPath)
		const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

		const sharedMessageProps = {
			tool: "generateImage" as const,
			path: getReadablePath(task.cwd, relPath),
			content: prompt,
			isOutsideWorkspace,
			isProtected: isWriteProtected,
		}

		try {
			task.consecutiveMistakeCount = 0

			const sizeConstraints = [
				aspectRatio ? `aspect_ratio=${aspectRatio}` : undefined,
				resolution ? `resolution=${resolution}` : undefined,
				quality ? `quality=${quality}` : undefined,
				typeof width === "number" ? `width=${width}` : undefined,
				typeof height === "number" ? `height=${height}` : undefined,
			].filter((part): part is string => Boolean(part))
			const promptWithSize =
				sizeConstraints.length > 0 ? `${prompt}\n\nOutput constraints: ${sizeConstraints.join(", ")}.` : prompt

			const approvalMessage = JSON.stringify({
				...sharedMessageProps,
				content: promptWithSize,
				...(inputImagePath && { inputImage: getReadablePath(task.cwd, inputImagePath) }),
				...(sizeConstraints.length > 0 && { size: sizeConstraints.join(", ") }),
			})

			const didApprove = await askApproval("tool", approvalMessage, undefined, isWriteProtected)

			if (!didApprove) {
				return
			}

			if (useXaiImagine && !xaiApiKey) {
				const errorMessage = "xAI API key is required for grok-imagine-image generation"
				await task.say("error", errorMessage)
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const result = useXaiImagine
				? await generateXaiImagineImage({
						apiKey: xaiApiKey!,
						model: selectedModel,
						prompt,
						inputImage: inputImageData,
						aspectRatio: aspectRatio ?? undefined,
						resolution: resolution ?? undefined,
						quality: quality ?? undefined,
					})
				: useGeminiNative
					? await generateGeminiImage({
							apiKey: geminiApiKey!,
							baseURL: geminiBaseUrl,
							model: selectedModel,
							prompt,
							inputImage: inputImageData,
							aspectRatio: aspectRatio ?? undefined,
							resolution: resolution ?? undefined,
						})
					: await new OpenRouterHandler({} as any).generateImage(
							promptWithSize,
							selectedModel,
							openRouterApiKey!,
							inputImageData,
						)

			if (!result.success) {
				await task.say("error", result.error || "Failed to generate image")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(result.error || "Failed to generate image"))
				return
			}

			if (!result.imageData) {
				const errorMessage = "No image data received"
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const base64Match = result.imageData.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/)
			if (!base64Match) {
				const errorMessage = "Invalid image format received"
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const imageFormat = base64Match[1]
			const base64Data = base64Match[2]

			let finalPath = relPath
			if (!finalPath.match(/\.(png|jpg|jpeg|webp|gif)$/i)) {
				finalPath = `${finalPath}.${imageFormat === "jpeg" ? "jpg" : imageFormat}`
			}

			const imageBuffer = Buffer.from(base64Data, "base64")

			const absolutePath = path.resolve(task.cwd, finalPath)
			const directory = path.dirname(absolutePath)
			await fs.mkdir(directory, { recursive: true })

			await fs.writeFile(absolutePath, imageBuffer)

			if (finalPath) {
				await task.fileContextTracker.trackFileContext(finalPath, "roo_edited")
			}

			task.didEditFile = true

			const fullImagePath = path.join(task.cwd, finalPath)

			let imageUri = provider?.convertToWebviewUri?.(fullImagePath) ?? vscode.Uri.file(fullImagePath).toString()

			const cacheBuster = Date.now()
			imageUri = imageUri.includes("?") ? `${imageUri}&t=${cacheBuster}` : `${imageUri}?t=${cacheBuster}`

			await task.say("image", JSON.stringify({ imageUri, imagePath: fullImagePath }))
			pushToolResult(formatResponse.toolResult(getReadablePath(task.cwd, finalPath)))
		} catch (error) {
			await handleError("generating image", error as Error)
		}
	}

	override async handlePartial(_task: Task, _block: ToolUse<"generate_image">): Promise<void> {
		return
	}
}

export const generateImageTool = new GenerateImageTool()
