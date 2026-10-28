/**
 * Where a skill was discovered.
 * - `built-in` ships with the extension and is the lowest priority, so a user's
 *   own skill of the same name always wins. Spelled to match the `built-in`
 *   source already used by slash commands, which skills are surfaced alongside.
 */
export type SkillSource = "built-in" | "global" | "project"

/**
 * Sources that live in a user-writable directory. Built-in skills are bundled
 * inside the extension, so they cannot be created, moved, edited or deleted.
 */
export type WritableSkillSource = Exclude<SkillSource, "built-in">

export const isWritableSkillSource = (source: SkillSource): source is WritableSkillSource => source !== "built-in"

/**
 * Skill metadata for discovery (loaded at startup)
 * Only name and description are required for now
 */
export interface SkillMetadata {
	name: string // Required: skill identifier
	description: string // Required: when to use this skill
	path: string // Absolute path to SKILL.md
	source: SkillSource // Where the skill was discovered
	/**
	 * @deprecated Use modeSlugs instead. Kept for backward compatibility.
	 * If set, skill is only available in this mode.
	 */
	mode?: string
	/**
	 * Mode slugs where this skill is available.
	 * - undefined or empty array means the skill is available in all modes ("Any mode").
	 * - An array with one or more mode slugs restricts the skill to those modes.
	 */
	modeSlugs?: string[]
}

/**
 * Full skill content (loaded on activation)
 */
export interface SkillContent extends SkillMetadata {
	instructions: string // Full markdown body
}
