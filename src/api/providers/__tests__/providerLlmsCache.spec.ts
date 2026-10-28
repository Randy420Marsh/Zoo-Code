import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { providerIdentifiers } from "@roo-code/types"
import {
	checkAndCacheProviderLlms,
	diffLlmsContent,
	extractLlmsModelDescriptions,
	isLlmsGroundTruthProvider,
	PROVIDER_LLMS_GROUND_TRUTH,
} from "../fetchers/providerLlmsCache"

describe("providerLlmsCache", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("registers gemini, xai, and openrouter as llms.txt ground-of-truth providers", () => {
		expect(isLlmsGroundTruthProvider(providerIdentifiers.gemini)).toBe(true)
		expect(isLlmsGroundTruthProvider(providerIdentifiers.xai)).toBe(true)
		expect(isLlmsGroundTruthProvider(providerIdentifiers.openrouter)).toBe(true)
		expect(isLlmsGroundTruthProvider("unknown-provider")).toBe(false)
		expect(PROVIDER_LLMS_GROUND_TRUTH.gemini.url).toBe("https://aistudio.google.com/llms.txt")
		expect(PROVIDER_LLMS_GROUND_TRUTH.xai.url).toBe("https://docs.x.ai/llms.txt")
		expect(PROVIDER_LLMS_GROUND_TRUTH.openrouter.url).toBe("https://openrouter.ai/llms.txt")
	})

	it("computes line-level additions and removals when remote llms.txt differs", () => {
		const prev = [
			"# Gemini API Docs",
			"- [Gemini 3.8 Flash](https://aistudio.google.com/docs/models/gemini-3.8-flash.md): Fast multimodal model",
			"- [Legacy Model](https://aistudio.google.com/docs/models/legacy-model.md): Deprecated",
		].join("\n")
		const next = [
			"# Gemini API Docs",
			"- [Gemini 4 Argon](https://aistudio.google.com/docs/models/gemini-4-argon.md): Flagship coding model",
			"- [Gemini 3.8 Flash](https://aistudio.google.com/docs/models/gemini-3.8-flash.md): Fast multimodal model",
		].join("\n")

		const diff = diffLlmsContent(prev, next)
		expect(diff.changed).toBe(true)
		expect(diff.addedLines).toEqual([
			{
				lineNumber: 2,
				text: "- [Gemini 4 Argon](https://aistudio.google.com/docs/models/gemini-4-argon.md): Flagship coding model",
			},
		])
		expect(diff.removedLines).toEqual([
			{
				lineNumber: 3,
				text: "- [Legacy Model](https://aistudio.google.com/docs/models/legacy-model.md): Deprecated",
			},
		])
	})

	it("extracts model descriptions from llms.txt markdown entries", () => {
		const sample = [
			"## Models",
			"- [Gemini 4 Argon](https://aistudio.google.com/docs/models/gemini-4-argon.md): Explore Gemini 4 Argon for coding",
			"- [Gemini Omni Flash](https://aistudio.google.com/docs/models/gemini-omni-flash.md): Video generation and editing model",
		].join("\n")
		const descriptions = extractLlmsModelDescriptions(sample)
		expect(descriptions["gemini-4-argon"]).toBe("Explore Gemini 4 Argon for coding")
		expect(descriptions["gemini-omni-flash"]).toBe("Video generation and editing model")
	})

	it("caches remote llms.txt locally and detects line changes on subsequent updates", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zoo-llms-cache-"))
		try {
			const v1 = "# xAI Docs\n- [Grok 4.7](https://docs.x.ai/developers/grok-4-7.md)\n"
			const v2 =
				"# xAI Docs\n- [Grok 4.7](https://docs.x.ai/developers/grok-4-7.md)\n- [Imagine Video](https://docs.x.ai/developers/model-capabilities/video/generation.md)\n"

			const fetchSpy = vi
				.spyOn(global, "fetch")
				.mockResolvedValueOnce(new Response(v1, { status: 200 }))
				.mockResolvedValueOnce(new Response(v2, { status: 200 }))

			// Seed initial cache file so it compares against v1 rather than repo baseline
			await fs.writeFile(path.join(tmpDir, "xai_llms.txt"), v1, "utf8")

			const firstCheck = await checkAndCacheProviderLlms(providerIdentifiers.xai, tmpDir)
			expect(firstCheck.changed).toBe(false)
			expect(firstCheck.addedLines).toEqual([])

			const secondCheck = await checkAndCacheProviderLlms(providerIdentifiers.xai, tmpDir)
			expect(fetchSpy).toHaveBeenCalledTimes(2)
			expect(secondCheck.changed).toBe(true)
			expect(secondCheck.addedLines).toEqual([
				{
					lineNumber: 3,
					text: "- [Imagine Video](https://docs.x.ai/developers/model-capabilities/video/generation.md)",
				},
			])

			const cachedText = await fs.readFile(path.join(tmpDir, "xai_llms.txt"), "utf8")
			expect(cachedText).toBe(v2)
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true })
		}
	})
})
