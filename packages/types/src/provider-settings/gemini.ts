import { z } from "zod"

import { providerIdentifiers } from "../provider-identifiers.js"
import {
	API_MODEL_ID_FIELD,
	apiModelIdProviderModelShape,
	createModelIdAccessor,
	createProviderDefinition,
} from "./common.js"

export const geminiProviderDefinition = createProviderDefinition({
	apiProvider: providerIdentifiers.gemini,
	modelIdKey: API_MODEL_ID_FIELD,
	getModelId: createModelIdAccessor(API_MODEL_ID_FIELD),
	schema: {
		...apiModelIdProviderModelShape,
		geminiApiKey: z.string().optional(),
		googleGeminiBaseUrl: z.string().optional(),
		// Gemini supports streaming for all generateContent models. Default on; set false for unary generateContent.
		geminiStreaming: z.boolean().optional(),
		// Optional inputs. Default on when unset; explicit false disables attachment/input modality.
		geminiAllowImageInput: z.boolean().optional(),
		geminiAllowVideoInput: z.boolean().optional(),
		geminiAllowAudioInput: z.boolean().optional(),
		// Generation is pricey. Default off even when the catalog reports it.
		geminiAllowImageGeneration: z.boolean().optional(),
		geminiAllowVideoGeneration: z.boolean().optional(),
		geminiAllowAudioGeneration: z.boolean().optional(),
	},
})
