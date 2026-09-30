/**
 * Browser-safe surface of @musename/core.
 *
 * Everything here is pure: no `node:fs`, no `node:path`. The only module left
 * out is `config.ts`, which reads config/*.json off disk — the browser gets
 * those values from `GET /v1/config` instead.
 *
 * Import this from front-end code (`@musename/core/browser`). Importing the
 * package root from a client component would pull `node:fs` into the bundle.
 */
export * from './errors.js';
export * from './normalize.js';
export * from './confusables.js';
export * from './reserved.js';
export * from './pricing.js';
export * from './namehash.js';
export * from './card.js';
export * from './signature.js';
export * from './policy.js';
export * from './avatar.js';
