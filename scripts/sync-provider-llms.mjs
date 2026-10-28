#!/usr/bin/env node
/**
 * Sync and diff provider llms.txt ground-of-truth indexes (Gemini, xAI, OpenRouter).
 *
 * Usage:
 *   node scripts/sync-provider-llms.mjs            # Check remote vs local cache & print line diffs
 *   node scripts/sync-provider-llms.mjs --update   # Check, print line diffs, and update local cache
 */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, "..")
const CACHE_DIR = path.join(ROOT_DIR, "docs", "provider-llms")
const MANIFEST_PATH = path.join(CACHE_DIR, "manifest.json")

export const PROVIDER_LLMS_SOURCES = {
	gemini: {
		provider: "gemini",
		name: "Google Gemini & AI Studio",
		url: "https://aistudio.google.com/llms.txt",
		secondaryUrl: "https://ai.google.dev/gemini-api/docs/llms.txt",
		cacheFile: "gemini-llms.txt",
	},
	xai: {
		provider: "xai",
		name: "xAI (Grok)",
		url: "https://docs.x.ai/llms.txt",
		cacheFile: "xai-llms.txt",
	},
	openrouter: {
		provider: "openrouter",
		name: "OpenRouter",
		url: "https://openrouter.ai/llms.txt",
		secondaryUrl: "https://openrouter.ai/docs/llms.txt",
		cacheFile: "openrouter-llms.txt",
	},
}

export function sha256(content) {
	return crypto.createHash("sha256").update(content, "utf8").digest("hex")
}

export function normalizeText(text) {
	return text.replace(/\r\n/g, "\n")
}

/**
 * Compute line-level changes between previous and next text.
 */
export function diffLlmsText(previousText, nextText) {
	const prevLines = previousText ? normalizeText(previousText).split("\n") : []
	const nextLines = normalizeText(nextText).split("\n")

	const prevSet = new Set(prevLines)
	const nextSet = new Set(nextLines)

	const addedLines = []
	for (let i = 0; i < nextLines.length; i++) {
		const line = nextLines[i]
		if (line.trim().length > 0 && !prevSet.has(line)) {
			addedLines.push({ lineNumber: i + 1, text: line })
		}
	}

	const removedLines = []
	for (let i = 0; i < prevLines.length; i++) {
		const line = prevLines[i]
		if (line.trim().length > 0 && !nextSet.has(line)) {
			removedLines.push({ lineNumber: i + 1, text: line })
		}
	}

	const changed = normalizeText(previousText) !== normalizeText(nextText)
	return {
		changed,
		previousLineCount: prevLines.length,
		nextLineCount: nextLines.length,
		addedLines,
		removedLines,
	}
}

/**
 * Extract model links/slugs referenced in an llms.txt document.
 */
export function extractModelReferences(text) {
	const refs = []
	const lines = normalizeText(text).split("\n")
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const match = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?$/)
		if (!match) continue
		const [, title, url, summary] = match
		if (
			/\/models\/|model-capabilities|image-generation|video|speech-generation|transcribe|music-generation|grok-|gemini-|veo-|lyria-|imagen/i.test(
				url,
			)
		) {
			refs.push({
				lineNumber: i + 1,
				title: title.trim(),
				url: url.trim(),
				summary: summary ? summary.trim() : undefined,
			})
		}
	}
	return refs
}

async function fetchText(url) {
	const response = await fetch(url, {
		headers: {
			Accept: "text/plain, text/markdown, */*",
		},
	})
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`)
	}
	return normalizeText(await response.text())
}

async function main() {
	const shouldUpdate = process.argv.includes("--update") || process.argv.includes("-u")
	fs.mkdirSync(CACHE_DIR, { recursive: true })

	let manifest = { updatedAt: null, providers: {} }
	if (fs.existsSync(MANIFEST_PATH)) {
		try {
			manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
		} catch {
			// Reinitialize corrupt manifest
		}
	}

	let anyDiff = false

	for (const [key, source] of Object.entries(PROVIDER_LLMS_SOURCES)) {
		const cachePath = path.join(CACHE_DIR, source.cacheFile)
		const previousText = fs.existsSync(cachePath) ? fs.readFileSync(cachePath, "utf8") : ""

		process.stdout.write(`Checking ${source.name} (${source.url})... `)
		let remoteText = await fetchText(source.url)
		if (source.secondaryUrl) {
			try {
				const secondaryText = await fetchText(source.secondaryUrl)
				remoteText = `${remoteText.trimEnd()}\n\n<!-- SECONDARY_INDEX: ${source.secondaryUrl} -->\n\n${secondaryText.trimStart()}`
			} catch (err) {
				console.warn(`\n  Warning: secondary URL ${source.secondaryUrl} failed: ${err.message}`)
			}
		}

		const diff = diffLlmsText(previousText, remoteText)
		const hash = sha256(remoteText)
		const modelRefs = extractModelReferences(remoteText)

		if (!previousText) {
			console.log(`NEW (${diff.nextLineCount} lines, ${modelRefs.length} model/capability refs)`)
			anyDiff = true
		} else if (!diff.changed) {
			console.log(`UP TO DATE (${diff.nextLineCount} lines, sha256=${hash.slice(0, 12)})`)
		} else {
			anyDiff = true
			console.log(
				`CHANGED (${diff.previousLineCount} -> ${diff.nextLineCount} lines, +${diff.addedLines.length} / -${diff.removedLines.length} lines)`,
			)
			for (const removed of diff.removedLines.slice(0, 25)) {
				console.log(`  - [L${removed.lineNumber}] ${removed.text}`)
			}
			if (diff.removedLines.length > 25) {
				console.log(`  ... and ${diff.removedLines.length - 25} more removed lines`)
			}
			for (const added of diff.addedLines.slice(0, 25)) {
				console.log(`  + [L${added.lineNumber}] ${added.text}`)
			}
			if (diff.addedLines.length > 25) {
				console.log(`  ... and ${diff.addedLines.length - 25} more added lines`)
			}
		}

		if (shouldUpdate || !previousText) {
			fs.writeFileSync(cachePath, remoteText, "utf8")
			manifest.providers[key] = {
				provider: key,
				name: source.name,
				url: source.url,
				secondaryUrl: source.secondaryUrl,
				cacheFile: source.cacheFile,
				sha256: hash,
				lineCount: diff.nextLineCount,
				modelReferenceCount: modelRefs.length,
				checkedAt: new Date().toISOString(),
				lastDiff: {
					changed: Boolean(previousText && diff.changed),
					addedCount: previousText ? diff.addedLines.length : 0,
					removedCount: previousText ? diff.removedLines.length : 0,
					addedLines: previousText ? diff.addedLines.slice(0, 50) : [],
					removedLines: previousText ? diff.removedLines.slice(0, 50) : [],
				},
			}
		}
	}

	if (shouldUpdate || !fs.existsSync(MANIFEST_PATH)) {
		manifest.updatedAt = new Date().toISOString()
		fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8")
		console.log(`Saved local llms.txt ground-of-truth cache to ${CACHE_DIR}`)
	} else if (anyDiff) {
		console.log(`Run "pnpm sync:provider-llms" to update the local llms.txt cache.`)
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error("Failed to check provider llms.txt:", err)
		process.exit(1)
	})
}
