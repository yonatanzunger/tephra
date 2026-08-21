// Typography. The visual reference is the Clarity app's sage theme (notes.md),
// judged against real prose in Spike A rather than chosen from a palette.
//
// The stock CodeMirror highlight style is built for code: it underlines
// headings and colours syntax. Long-form prose wants neither.

import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Compartment, type Extension } from '@codemirror/state'

export interface Typography {
  font: string
  size: number
  measure: number
  /** Line height within a paragraph. */
  leading: number
  /** Extra space at a paragraph's end, in ems. */
  paragraphSpace: number
  /** Height of a blank line, as a fraction of a text line. */
  blankLine: number
}

export const defaultTypography: Typography = {
  font: "'Lora', Georgia, serif",
  size: 18,
  measure: 74,
  leading: 1.55,
  paragraphSpace: 0.5,
  blankLine: 0.55,
}

export const typographyCompartment = new Compartment()

export const proseHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.85em', fontWeight: '600', color: 'rgb(var(--text-heading))', textDecoration: 'none' },
  { tag: tags.heading2, fontSize: '1.4em', fontWeight: '600', color: 'rgb(var(--text-heading))', textDecoration: 'none' },
  { tag: tags.heading3, fontSize: '1.2em', fontWeight: '600', color: 'rgb(var(--text-heading))', textDecoration: 'none' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'rgb(var(--accent))', textDecoration: 'none' },
  { tag: tags.url, color: 'rgb(var(--text-muted))' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.85em' },
  { tag: tags.quote, color: 'rgb(var(--text-muted))', fontStyle: 'italic' },
])

export function tephraTheme(t: Typography): Extension {
  return EditorView.theme({
    '&': { fontSize: `${t.size}px`, color: 'rgb(var(--text))', backgroundColor: 'rgb(var(--surface))', height: '100%' },
    '.cm-scroller': { fontFamily: t.font, lineHeight: String(t.leading), letterSpacing: '-0.01em', overflowX: 'hidden' },
    '.cm-content': {
      maxWidth: `${t.measure}ch`,
      margin: '0 auto',
      padding: '3rem 1rem 60vh',
      caretColor: 'rgb(var(--accent))',
    },
    // Per-paragraph, not per-line: see the note in widgets.ts.
    '.cm-line': { padding: '0' },
    '.cm-line.tx-para-end': { paddingBottom: `${t.paragraphSpace}em` },
    '.cm-line.tx-blank': { height: `${(t.blankLine * t.leading).toFixed(3)}em`, lineHeight: `${(t.blankLine * t.leading).toFixed(3)}em` },
    '.cm-cursor, .cm-dropCursor': { borderLeftWidth: '2px', borderLeftColor: 'rgb(var(--accent))' },
    '.cm-fat-cursor': { background: 'rgb(var(--accent)) !important', color: 'rgb(var(--surface)) !important' },
    // Styled twice because there are two mechanisms: the drawn layer, which
    // vim requires, and the browser's native selection, used when vim is off.
    // The colour was previously --accent-surface, a pale mint on near-white,
    // which was so faint that selecting text looked like nothing had happened.
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgb(var(--accent) / 0.22)',
    },
    '.cm-content ::selection, .cm-line::selection, .cm-line ::selection': {
      backgroundColor: 'rgb(var(--accent) / 0.22)',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-gutters': { display: 'none' },
    '.cm-panels': { fontFamily: 'var(--font-ui)', fontSize: '13px' },
  })
}
