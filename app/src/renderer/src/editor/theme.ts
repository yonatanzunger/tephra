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
  /** The text measure, in characters. */
  measure: number
  /** The reserved annotation gutter, in characters (D42, R27). */
  gutter: number
  /** Space between the measure and the gutter, in characters. */
  gutterGap: number
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
  gutter: 19,
  gutterGap: 3,
  leading: 1.55,
  paragraphSpace: 0.5,
  blankLine: 0.55,
}

export const typographyCompartment = new Compartment()

export const proseHighlight = HighlightStyle.define([
  // Size lives on the LINE (see .cm-line.tx-h1 in index.css), never here.
  // Setting it in both places multiplies: a heading line at 1.85em containing a
  // heading mark at 1.85em rendered at 3.4em, which looked like a display face
  // gone wrong rather than like a bug, and so survived until someone looked at
  // a screenshot. The line has to carry it, because a size set on an inline
  // mark does not reflow the line box around it.
  { tag: tags.heading1, fontWeight: '600', color: 'rgb(var(--text-heading))', textDecoration: 'none' },
  { tag: tags.heading2, fontWeight: '600', color: 'rgb(var(--text-heading))', textDecoration: 'none' },
  { tag: tags.heading3, fontWeight: '600', color: 'rgb(var(--text-heading))', textDecoration: 'none' },
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
    // NOTE: the measure and the annotation gutter are deliberately NOT set
    // here. They belong to the frame (D42), which owns the arithmetic deciding
    // whether the gutter fits and how much width the capture stream may take;
    // setting a width here as well would be the same two-computations-of-one-
    // quantity bug that put the gutter 58px off the edge in the studies. The
    // frame drives them through --measure and --gutter; see index.css.
    //
    // In particular this is no longer centred. Centring makes the text's
    // position depend on what else is on screen, so opening the stream would
    // move every line. The column is left-anchored and the slack lives to its
    // right, which is where the stream comes from.
    '.cm-content': {
      padding: '3rem 0 60vh',
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
