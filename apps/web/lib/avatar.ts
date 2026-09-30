/**
 * The default avatar lives in @musename/core, because the editor, the draft a
 * fresh name starts with, and the MCP tool an AI calls all have to produce the
 * same image. Re-exported here so the web components import from one place.
 */
export { defaultAvatarDataUri, looksLikeImage } from '@musename/core/browser';
