import { z } from "zod"

import { providerIdentifiers } from "../provider-identifiers.js"
import {
	API_MODEL_ID_FIELD,
	apiModelIdProviderModelShape,
	createModelIdAccessor,
	createProviderDefinition,
} from "./common.js"

export const xaiProviderDefinition = createProviderDefinition({
	apiProvider: providerIdentifiers.xai,
	modelIdKey: API_MODEL_ID_FIELD,
	getModelId: createModelIdAccessor(API_MODEL_ID_FIELD),
	schema: {
		...apiModelIdProviderModelShape,
		xaiApiKey: z.string().optional(),
		// xAI supports SSE streaming for all text-output models. Default on so the chat
		// loop keeps streaming; set false for a single non-streamed response.
		xaiStreaming: z.boolean().optional(),
		// Optional inputs. Default off so a refresh that reports image/video/audio does not attach them.
		xaiAllowImageInput: z.boolean().optional(),
		xaiAllowVideoInput: z.boolean().optional(),
		xaiAllowAudioInput: z.boolean().optional(),
		// Generation is pricey. Default off even when the cached catalog reports it.
		xaiAllowImageGeneration: z.boolean().optional(),
		xaiAllowVideoGeneration: z.boolean().optional(),
		xaiAllowAudioGeneration: z.boolean().optional(),
	},
})
