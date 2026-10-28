import { describe, it, expect, vi, beforeEach } from "vitest"
import { providerIdentifiers } from "@roo-code/types"
import { generateImageTool } from "../GenerateImageTool"
import { ToolUse } from "../../../shared/tools"
import { Task } from "../../task/Task"
import * as fs from "fs/promises"
import * as pathUtils from "../../../utils/pathUtils"
import * as fileUtils from "../../../utils/fs"
import { formatResponse } from "../../prompts/responses"
import { t } from "../../../i18n"
import { EXPERIMENT_IDS } from "../../../shared/experiments"
import { OpenRouterHandler } from "../../../api/providers/openrouter"
import * as imageGenUtils from "../../../api/providers/utils/image-generation"

// Mock dependencies
vi.mock("fs/promises")
vi.mock("../../../utils/pathUtils")
vi.mock("../../../utils/fs")
vi.mock("../../../utils/safeWriteJson")
vi.mock("../../../api/providers/openrouter")

describe("generateImageTool", () => {
	let mockCline: any
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock Cline instance
		mockCline = {
			cwd: "/test/workspace",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			recordToolUsage: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			say: vi.fn(),
			rooIgnoreController: {
				validateAccess: vi.fn().mockReturnValue(true),
			},
			rooProtectedController: {
				isWriteProtected: vi.fn().mockReturnValue(false),
			},
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({
						experiments: {
							[EXPERIMENT_IDS.IMAGE_GENERATION]: true,
						},
						openRouterImageApiKey: "test-api-key",
						openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
					}),
				}),
			},
			fileContextTracker: {
				trackFileContext: vi.fn(),
			},
			didEditFile: false,
		}

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()

		// Mock file system operations
		vi.mocked(fileUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("fake-image-data"))
		vi.mocked(fs.mkdir).mockResolvedValue(undefined)
		vi.mocked(fs.writeFile).mockResolvedValue(undefined)
		vi.mocked(pathUtils.isPathOutsideWorkspace).mockReturnValue(false)
	})

	describe("partial block handling", () => {
		it("should return early when block is partial", async () => {
			const partialBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: true,
			}

			await generateImageTool.handle(mockCline as Task, partialBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			// Should not process anything when partial
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalled()
			expect(mockCline.say).not.toHaveBeenCalled()
		})

		it("should return early when block is partial even with image parameter", async () => {
			const partialBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Upscale this image",
					path: "upscaled-image.png",
					image: "source-image.png",
				},
				nativeArgs: {
					prompt: "Upscale this image",
					path: "upscaled-image.png",
					image: "source-image.png",
				},
				partial: true,
			}

			await generateImageTool.handle(mockCline as Task, partialBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			// Should not process anything when partial
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalled()
			expect(mockCline.say).not.toHaveBeenCalled()
			expect(fs.readFile).not.toHaveBeenCalled()
		})

		it("should process when block is not partial", async () => {
			const completeBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			// Mock the OpenRouterHandler generateImage method
			const mockGenerateImage = vi.fn().mockResolvedValue({
				success: true,
				imageData: "data:image/png;base64,fakebase64data",
			})

			vi.mocked(OpenRouterHandler).mockImplementation(function () {
				return {
					generateImage: mockGenerateImage,
				} as any
			})

			await generateImageTool.handle(mockCline as Task, completeBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			// Should process the complete block
			expect(mockAskApproval).toHaveBeenCalled()
			expect(mockGenerateImage).toHaveBeenCalled()
			expect(mockPushToolResult).toHaveBeenCalled()
			// Usage is recorded once at the central presentAssistantMessage
			// attribution point, not locally by the handler.
			expect(mockCline.recordToolUsage).not.toHaveBeenCalled()
		})

		it("should add cache-busting parameter to image URI", async () => {
			const completeBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			// Mock convertToWebviewUri to return a test URI
			const mockWebviewUri = "https://file+.vscode-resource.vscode-cdn.net/test/workspace/test-image.png"
			mockCline.providerRef.deref().convertToWebviewUri = vi.fn().mockReturnValue(mockWebviewUri)

			// Mock the OpenRouterHandler generateImage method
			const mockGenerateImage = vi.fn().mockResolvedValue({
				success: true,
				imageData: "data:image/png;base64,fakebase64data",
			})

			vi.mocked(OpenRouterHandler).mockImplementation(function () {
				return {
					generateImage: mockGenerateImage,
				} as any
			})

			await generateImageTool.handle(mockCline as Task, completeBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			// Check that cline.say was called with image data containing cache-busting parameter
			expect(mockCline.say).toHaveBeenCalledWith("image", expect.stringMatching(/"imageUri":"[^"]+\?t=\d+"/))

			// Verify the imageUri contains the cache-busting parameter
			const sayCall = mockCline.say.mock.calls.find((call: any[]) => call[0] === "image")
			if (sayCall) {
				const imageData = JSON.parse(sayCall[1])
				expect(imageData.imageUri).toMatch(/\?t=\d+$/)
				// Handle both Unix and Windows path separators
				const expectedPath =
					process.platform === "win32"
						? "\\test\\workspace\\test-image.png"
						: "/test/workspace/test-image.png"
				expect(imageData.imagePath).toBe(expectedPath)
			}
		})
	})

	describe("missing parameters", () => {
		it("should handle missing prompt parameter", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					path: "test-image.png",
				},
				nativeArgs: {
					path: "test-image.png",
				} as any,
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("generate_image")
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("generate_image", "prompt")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
		})

		it("should handle missing path parameter", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
				},
				nativeArgs: {
					prompt: "Generate a test image",
				} as any,
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("generate_image")
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("generate_image", "path")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
		})
	})

	describe("experiment validation", () => {
		it("should error when image generation experiment is disabled", async () => {
			// Disable the experiment
			mockCline.providerRef.deref().getState.mockResolvedValue({
				experiments: {
					[EXPERIMENT_IDS.IMAGE_GENERATION]: false,
				},
			})

			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			expect(mockPushToolResult).toHaveBeenCalledWith(
				formatResponse.toolError(
					"Image generation is an experimental feature that must be enabled in settings. Please enable 'Image Generation' in the Experimental Settings section.",
				),
			)
		})
	})

	describe("input image validation", () => {
		it("should handle non-existent input image", async () => {
			vi.mocked(fileUtils.fileExistsAtPath).mockResolvedValue(false)

			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "non-existent.png",
				},
				nativeArgs: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "non-existent.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Input image not found"))
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Input image not found"))
		})

		it("should handle unsupported image format", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "test.bmp", // Unsupported format
				},
				nativeArgs: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "test.bmp",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Unsupported image format"))
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Unsupported image format"))
		})
	})

	describe("openrouter api key validation", () => {
		it("should error when the OpenRouter API key is not configured", async () => {
			// An OpenRouter image model is selected but no API key is configured
			mockCline.providerRef.deref().getState.mockResolvedValue({
				experiments: {
					[EXPERIMENT_IDS.IMAGE_GENERATION]: true,
				},
				openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
			})

			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			const expectedMessage = t("tools:generateImage.openRouterApiKeyRequired")
			expect(mockCline.say).toHaveBeenCalledWith("error", expectedMessage)
			expect(mockPushToolResult).toHaveBeenCalledWith(formatResponse.toolError(expectedMessage))
			// The tool must stop before asking for approval or generating anything
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(OpenRouterHandler).not.toHaveBeenCalled()
		})
	})

	describe("media mode and Gemini / xAI image generation", () => {
		it("allows generate_image in media mode even when experiment flag is disabled and never writes outside workspace", async () => {
			mockCline.providerRef.deref().getState.mockResolvedValue({
				mode: "media",
				experiments: {
					[EXPERIMENT_IDS.IMAGE_GENERATION]: false,
				},
				imageGenerationProvider: providerIdentifiers.gemini,
				openRouterImageGenerationSelectedModel: "gemini-nano-banana-2.1",
				apiConfiguration: {
					geminiApiKey: "test-gemini-key",
				},
			})

			const geminiSpy = vi.spyOn(imageGenUtils, "generateGeminiImage").mockResolvedValue({
				success: true,
				imageData:
					"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
			})

			const block: ToolUse<"generate_image"> = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "A banana in space",
					path: "media/banana.png",
					model: "gemini-nano-banana-2.1",
					aspect_ratio: "16:9",
					resolution: "2k",
				},
				nativeArgs: {
					prompt: "A banana in space",
					path: "media/banana.png",
					model: "gemini-nano-banana-2.1",
					aspect_ratio: "16:9",
					resolution: "2k",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			expect(geminiSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					apiKey: "test-gemini-key",
					model: "gemini-nano-banana-2.1",
					prompt: "A banana in space",
					aspectRatio: "16:9",
					resolution: "2k",
				}),
			)
			// Must only write inside the workspace (/test/workspace/media/banana.png), never to os.tmpdir()
			expect(fs.writeFile).toHaveBeenCalledTimes(1)
			expect(vi.mocked(fs.writeFile).mock.calls[0]?.[0]).toContain("banana.png")
			geminiSpy.mockRestore()
		})

		it("falls back to saved provider profile API keys for cross-provider local model execution", async () => {
			mockCline.providerRef.deref = vi.fn().mockReturnValue({
				getState: vi.fn().mockResolvedValue({
					mode: "code",
					experiments: {
						[EXPERIMENT_IDS.IMAGE_GENERATION]: true,
					},
					apiConfiguration: {
						apiProvider: providerIdentifiers.lmstudio,
						lmStudioModelId: "qwen3.8-27b",
					},
				}),
				providerSettingsManager: {
					listConfig: vi
						.fn()
						.mockResolvedValue([{ id: "xai-prof", name: "xAI", apiProvider: providerIdentifiers.xai }]),
					getProfile: vi.fn().mockResolvedValue({
						id: "xai-prof",
						name: "xAI",
						apiProvider: providerIdentifiers.xai,
						xaiApiKey: "saved-xai-key-from-profile",
					}),
				},
			})

			const xaiSpy = vi.spyOn(imageGenUtils, "generateXaiImagineImage").mockResolvedValue({
				success: true,
				imageData:
					"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
			})

			const block: ToolUse<"generate_image"> = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Cross-provider local model test",
					path: "media/local-cross.png",
				},
				nativeArgs: {
					prompt: "Cross-provider local model test",
					path: "media/local-cross.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				toolCallId: "test-tool-call-id",
			})

			expect(xaiSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					apiKey: "saved-xai-key-from-profile",
					model: "grok-imagine-image-2.0",
					prompt: "Cross-provider local model test",
				}),
			)
			xaiSpy.mockRestore()
		})

		it("detects JPEG vs PNG format from base64 magic bytes", () => {
			const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64")
			const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString("base64")
			expect(imageGenUtils.detectBase64ImageFormat(jpegBase64)).toBe("jpeg")
			expect(imageGenUtils.detectBase64ImageFormat(pngBase64)).toBe("png")
		})
	})
})
