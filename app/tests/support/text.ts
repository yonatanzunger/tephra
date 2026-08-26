// Branded text, for tests.
//
// A test writes literals, and a literal does not say which layer it belongs to
// any more than a variable does (see `THE LAYERS` in shared/document-api.ts).
// These are the two ways one enters: `pt` for what a person would have typed,
// `rt` for what a file would have held. Nothing here converts — the conversions
// are `proseText` and `documentText` — it only names the claim being made.

import type { ProseText, DocumentText } from '../../src/shared/document-api.ts'

export const pt = (text: string): ProseText => text as ProseText
export const rt = (text: string): DocumentText => text as DocumentText
