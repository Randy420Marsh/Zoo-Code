import type OpenAI from "openai"

const GENERATE_IMAGE_DESCRIPTION = `Request to generate or edit an image using AI models through OpenRouter, Google Gemini, or xAI APIs. This tool can create new images from text prompts or modify existing images based on your instructions. When an input image is provided, the AI will apply the requested edits, transformations, or enhancements to that image.

Rules:
- Stay strictly inside the current workspace directory during image generation: do not read or write outside the workspace unless the user explicitly asks.
- Never delete generated images or intermediate files unless the user explicitly asks.

Parameters:
- prompt: (required) The text prompt describing what to generate or how to edit the image
- path: (required) The file path where the generated/edited image should be saved (relative to the current workspace directory). The tool will automatically add the appropriate image extension if not provided.
- image: (optional) The file path to an input image to edit or transform (relative to the current workspace directory). Supported formats: PNG, JPG, JPEG, GIF, WEBP.
- model: (optional, null to use configured default) Model ID override for image generation (e.g., "grok-imagine-image-2.0", "gemini-nano-banana-2.1", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-3-pro-image", "gemini-2.5-flash-image", "google/gemini-3-pro-image").
- aspect_ratio: (required, null if unsupported) Documented aspect ratio for the target model. xAI grok-imagine-image-2.0 accepts 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 19.5:9, 9:19.5, 20:9, 9:20, 21:9, 5:2, auto. Gemini image models accept 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 4:5, 5:4, 21:9.
- resolution: (required, null if unsupported) xAI images: 1k or 2k. Gemini 3 image models: 1K, 2K, or 4K. Do not invent other tokens.
- quality: (required, null if unsupported) xAI grok-imagine-image-2.0: auto, low, or medium.
- width / height: (required, null if unsupported) Pixel size only for models that document width and height. Leave null for xAI Imagine and Gemini.

Example: Generating a sunset image
{ "prompt": "A beautiful sunset over mountains with vibrant orange and purple colors", "path": "images/sunset.png", "image": null, "model": null, "aspect_ratio": "16:9", "resolution": "1k", "quality": null, "width": null, "height": null }

Example: Editing an existing image
{ "prompt": "Transform this image into a watercolor painting style", "path": "images/watercolor-output.png", "image": "images/original-photo.jpg", "model": null, "aspect_ratio": null, "resolution": null, "quality": null, "width": null, "height": null }

Example: Upscaling and enhancing an image
{ "prompt": "Upscale this image to higher resolution, enhance details, improve clarity and sharpness while maintaining the original content and composition", "path": "images/enhanced-photo.png", "image": "images/low-res-photo.jpg", "model": null, "aspect_ratio": null, "resolution": null, "quality": null, "width": null, "height": null }`

const PROMPT_PARAMETER_DESCRIPTION = `Text description of the image to generate or the edits to apply`

const PATH_PARAMETER_DESCRIPTION = `Filesystem path (relative to the workspace) where the resulting image should be saved`

const IMAGE_PARAMETER_DESCRIPTION = `Optional path (relative to the workspace) to an existing image to edit; supports PNG, JPG, JPEG, GIF, and WEBP`

export default {
	type: "function",
	function: {
		name: "generate_image",
		description: GENERATE_IMAGE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				prompt: {
					type: "string",
					description: PROMPT_PARAMETER_DESCRIPTION,
				},
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
				image: {
					type: ["string", "null"],
					description: IMAGE_PARAMETER_DESCRIPTION,
				},
				model: {
					type: ["string", "null"],
					description:
						"Optional image generation model ID override (e.g., grok-imagine-image-2.0, gemini-nano-banana-2.1, gemini-3.1-flash-image, gemini-3-pro-image, gemini-2.5-flash-image). Null to use the configured default model.",
				},
				aspect_ratio: {
					type: ["string", "null"],
					description:
						"Aspect ratio the target image model documents. xAI grok-imagine-image-2.0: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 19.5:9, 9:19.5, 20:9, 9:20, 21:9, 5:2, or auto. Gemini: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 4:5, 5:4, 21:9. Null if the model has no aspect_ratio parameter.",
				},
				resolution: {
					type: ["string", "null"],
					description:
						"Resolution token the target model documents. xAI images: 1k or 2k. Gemini 3 image models: 1K, 2K, or 4K. xAI video: 480p, 720p, or 1080p. Null if unsupported.",
				},
				quality: {
					type: ["string", "null"],
					description:
						"xAI grok-imagine-image-2.0 quality: auto, low, or medium. Null if the model has no quality parameter.",
				},
				width: {
					type: ["integer", "null"],
					description:
						"Pixel width only when the chosen model documents a width parameter. Do not set this for xAI Imagine or Gemini; use aspect_ratio and resolution instead.",
				},
				height: {
					type: ["integer", "null"],
					description:
						"Pixel height only when the chosen model documents a height parameter. Do not set this for xAI Imagine or Gemini; use aspect_ratio and resolution instead.",
				},
			},
			required: ["prompt", "path", "image", "aspect_ratio", "resolution", "quality", "width", "height"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
