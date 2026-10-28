import { createHash } from "crypto"
import * as fsSync from "fs"
import * as fs from "fs/promises"
import * as path from "path"

import { providerIdentifiers } from "@roo-code/types"

import { ContextProxy } from "../../../core/config/ContextProxy"
import { safeWriteJson } from "../../../utils/safeWriteJson"
import { getCacheDirectoryPath } from "../../../utils/storage"
import { DEFAULT_HEADERS } from "../constants"

export type LlmsGroundTruthProvider =
	typeof providerIdentifiers.gemini | typeof providerIdentifiers.xai | typeof providerIdentifiers.openrouter

export interface ProviderLlmsSource {
	provider: LlmsGroundTruthProvider
	name: string
	url: string
	secondaryUrl?: string
	cacheFile: string
	repoBaselineFile: string
}

export interface LlmsLineChange {
	lineNumber: number
	text: string
}

export interface LlmsDiffResult {
	provider: LlmsGroundTruthProvider
	url: string
	changed: boolean
	isInitialCache: boolean
	sha256: string
	previousSha256?: string
	previousLineCount: number
	nextLineCount: number
	addedLines: LlmsLineChange[]
	removedLines: LlmsLineChange[]
	checkedAt: string
}

const LLMS_FETCH_TIMEOUT_MS = 12_000

export const PROVIDER_LLMS_GROUND_TRUTH: Record<LlmsGroundTruthProvider, ProviderLlmsSource> = {
	[providerIdentifiers.gemini]: {
		provider: providerIdentifiers.gemini,
		name: "Google Gemini & AI Studio",
		url: "https://aistudio.google.com/llms.txt",
		secondaryUrl: "https://ai.google.dev/gemini-api/docs/llms.txt",
		cacheFile: "gemini_llms.txt",
		repoBaselineFile: "gemini-llms.txt",
	},
	[providerIdentifiers.xai]: {
		provider: providerIdentifiers.xai,
		name: "xAI (Grok)",
		url: "https://docs.x.ai/llms.txt",
		cacheFile: "xai_llms.txt",
		repoBaselineFile: "xai-llms.txt",
	},
	[providerIdentifiers.openrouter]: {
		provider: providerIdentifiers.openrouter,
		name: "OpenRouter",
		url: "https://openrouter.ai/llms.txt",
		secondaryUrl: "https://openrouter.ai/docs/llms.txt",
		cacheFile: "openrouter_llms.txt",
		repoBaselineFile: "openrouter-llms.txt",
	},
}

export function isLlmsGroundTruthProvider(provider: string): provider is LlmsGroundTruthProvider {
	return Object.hasOwn(PROVIDER_LLMS_GROUND_TRUTH, provider)
}

export function normalizeLlmsText(text: string): string {
	return text.replace(/\r\n/g, "\n")
}

export function computeLlmsSha256(text: string): string {
	return createHash("sha256").update(normalizeLlmsText(text), "utf8").digest("hex")
}

/**
 * Compute line-by-line additions and removals between two llms.txt snapshots.
 */
export function diffLlmsContent(
	previousText: string,
	nextText: string,
): {
	changed: boolean
	previousLineCount: number
	nextLineCount: number
	addedLines: LlmsLineChange[]
	removedLines: LlmsLineChange[]
} {
	const normalizedPrev = previousText ? normalizeLlmsText(previousText) : ""
	const normalizedNext = normalizeLlmsText(nextText)
	const prevLines = normalizedPrev ? normalizedPrev.split("\n") : []
	const nextLines = normalizedNext.split("\n")

	const prevSet = new Set(prevLines)
	const nextSet = new Set(nextLines)

	const addedLines: LlmsLineChange[] = []
	for (let i = 0; i < nextLines.length; i++) {
		const line = nextLines[i]
		if (line.trim().length > 0 && !prevSet.has(line)) {
			addedLines.push({ lineNumber: i + 1, text: line })
		}
	}

	const removedLines: LlmsLineChange[] = []
	for (let i = 0; i < prevLines.length; i++) {
		const line = prevLines[i]
		if (line.trim().length > 0 && !nextSet.has(line)) {
			removedLines.push({ lineNumber: i + 1, text: line })
		}
	}

	return {
		changed: normalizedPrev !== normalizedNext,
		previousLineCount: prevLines.length,
		nextLineCount: nextLines.length,
		addedLines,
		removedLines,
	}
}

/**
 * Extract model descriptions from markdown links in an llms.txt document
 * (e.g. `- [Gemini 4 Argon](https://aistudio.google.com/docs/models/gemini-4-argon.md): Explore Gemini 4 Argon...`).
 */
export function extractLlmsModelDescriptions(text: string): Record<string, string> {
	const descriptions: Record<string, string> = Object.create(null)
	const lines = normalizeLlmsText(text).split("\n")
	for (const line of lines) {
		const match = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?$/)
		if (!match) {
			continue
		}
		const [, title, url, summary] = match
		const modelMatch = url.match(/\/models\/([a-zA-Z0-9._-]+?)(?:\.md(?:\.txt)?)?$/)
		if (modelMatch?.[1]) {
			const modelId = modelMatch[1]
			descriptions[modelId] = (summary || title).trim()
		}
	}
	return descriptions
}

async function fetchLlmsUrl(url: string, signal?: AbortSignal): Promise<string> {
	const response = await fetch(url, {
		headers: {
			Accept: "text/plain, text/markdown, */*",
			...DEFAULT_HEADERS,
		},
		signal,
	})
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`)
	}
	return normalizeLlmsText(await response.text())
}

function readBaselineFromRepoSync(repoBaselineFile: string): string | undefined {
	const candidates = [
		path.resolve(process.cwd(), "docs", "provider-llms", repoBaselineFile),
		path.resolve(__dirname, "..", "..", "..", "..", "docs", "provider-llms", repoBaselineFile),
	]
	for (const candidate of candidates) {
		try {
			if (fsSync.existsSync(candidate)) {
				return fsSync.readFileSync(candidate, "utf8")
			}
		} catch {
			// Ignore unreadable candidate path
		}
	}
	return undefined
}

async function resolveLlmsCacheDir(explicitCacheDir?: string): Promise<string | undefined> {
	if (explicitCacheDir) {
		await fs.mkdir(explicitCacheDir, { recursive: true })
		return explicitCacheDir
	}
	const globalStoragePath = ContextProxy.instance?.globalStorageUri?.fsPath
	if (!globalStoragePath) {
		return undefined
	}
	const baseCacheDir = await getCacheDirectoryPath(globalStoragePath)
	const llmsDir = path.join(baseCacheDir, "llms_txt")
	await fs.mkdir(llmsDir, { recursive: true })
	return llmsDir
}

/**
 * Fetch a provider remote llms.txt ground-of-truth index, compare it line-by-line
 * against the local cached snapshot (or repo baseline), and persist both the updated
 * text and the line-level diff metadata locally.
 */
export async function checkAndCacheProviderLlms(
	provider: LlmsGroundTruthProvider,
	explicitCacheDir?: string,
	callerSignal?: AbortSignal,
): Promise<LlmsDiffResult> {
	const source = PROVIDER_LLMS_GROUND_TRUTH[provider]
	const cacheDir = await resolveLlmsCacheDir(explicitCacheDir)
	const cacheFilePath = cacheDir ? path.join(cacheDir, source.cacheFile) : undefined
	const metaFilePath = cacheDir ? path.join(cacheDir, `${provider}_llms_meta.json`) : undefined

	let previousText = ""
	let isInitialCache = true
	if (cacheFilePath && fsSync.existsSync(cacheFilePath)) {
		try {
			previousText = await fs.readFile(cacheFilePath, "utf8")
			isInitialCache = false
		} catch {
			previousText = ""
		}
	}
	if (!previousText) {
		const repoBaseline = readBaselineFromRepoSync(source.repoBaselineFile)
		if (repoBaseline) {
			previousText = repoBaseline
			isInitialCache = false
		}
	}

	const controller = new AbortController()
	const timeout = setTimeout(
		() => controller.abort(new Error("Provider llms.txt request timed out")),
		LLMS_FETCH_TIMEOUT_MS,
	)
	const signal = callerSignal
		? typeof AbortSignal.any === "function"
			? AbortSignal.any([callerSignal, controller.signal])
			: controller.signal
		: controller.signal

	try {
		let remoteText = await fetchLlmsUrl(source.url, signal)
		if (source.secondaryUrl) {
			try {
				const secondaryText = await fetchLlmsUrl(source.secondaryUrl, signal)
				remoteText = `${remoteText.trimEnd()}\n\n<!-- SECONDARY_INDEX: ${source.secondaryUrl} -->\n\n${secondaryText.trimStart()}`
			} catch {
				// Keep primary llms.txt if secondary index is temporarily unreachable
			}
		}

		const diff = diffLlmsContent(previousText, remoteText)
		const sha256 = computeLlmsSha256(remoteText)
		const previousSha256 = previousText ? computeLlmsSha256(previousText) : undefined
		const checkedAt = new Date().toISOString()

		const result: LlmsDiffResult = {
			provider,
			url: source.url,
			changed: !isInitialCache && diff.changed,
			isInitialCache,
			sha256,
			previousSha256,
			previousLineCount: diff.previousLineCount,
			nextLineCount: diff.nextLineCount,
			addedLines: isInitialCache ? [] : diff.addedLines,
			removedLines: isInitialCache ? [] : diff.removedLines,
			checkedAt,
		}

		if (cacheFilePath && (isInitialCache || diff.changed || !fsSync.existsSync(cacheFilePath))) {
			await fs.writeFile(cacheFilePath, remoteText, "utf8")
		}
		if (metaFilePath) {
			await safeWriteJson(metaFilePath, {
				...result,
				addedLines: result.addedLines.slice(0, 100),
				removedLines: result.removedLines.slice(0, 100),
			})
		}

		return result
	} finally {
		clearTimeout(timeout)
	}
}

const modelDescriptionsMemo = new Map<LlmsGroundTruthProvider, { sha256: string; map: Record<string, string> }>()

/**
 * Return model descriptions parsed from the locally cached llms.txt ground-of-truth file
 * (falling back to the repository baseline in `docs/provider-llms/<provider>-llms.txt`).
 */
export function getCachedLlmsModelDescriptions(provider: LlmsGroundTruthProvider): Record<string, string> {
	const source = PROVIDER_LLMS_GROUND_TRUTH[provider]
	let text: string | undefined
	try {
		const globalStoragePath = ContextProxy.instance?.globalStorageUri?.fsPath
		if (globalStoragePath) {
			const cachedPath = path.join(globalStoragePath, "cache", "llms_txt", source.cacheFile)
			if (fsSync.existsSync(cachedPath)) {
				text = fsSync.readFileSync(cachedPath, "utf8")
			}
		}
	} catch {
		// Fall back to repo baseline
	}
	if (!text) {
		text = readBaselineFromRepoSync(source.repoBaselineFile)
	}
	if (!text) {
		return Object.create(null)
	}
	const sha256 = computeLlmsSha256(text)
	const memo = modelDescriptionsMemo.get(provider)
	if (memo && memo.sha256 === sha256) {
		return memo.map
	}
	const map = extractLlmsModelDescriptions(text)
	modelDescriptionsMemo.set(provider, { sha256, map })
	return map
}
