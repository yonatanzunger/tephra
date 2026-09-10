// How the markdown surface paints the type — the CodeMirror half of it.
//
// The numbers themselves are `editor/typography.ts`, which the frame and the
// theme picker also read; what is here is how CodeMirror is told about them.
//
// The visual reference is the Clarity app's sage theme (notes.md), judged
// against real prose in Spike A rather than chosen from a palette.
//
// The stock CodeMirror highlight style is built for code: it underlines
// headings and colours syntax. Long-form prose wants neither.

import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Compartment, type Extension } from '@codemirror/state'
import type { Typography } from '../../typography.ts'

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
  // Face and size only: a highlight reaches characters, and the rest of what
  // code needs — leading, an inset, a measure — belongs to the line (`code.ts`).
  { tag: tags.monospace, fontFamily: 'var(--font-code)', fontSize: 'var(--code-size)' },
  // **Restrained, from the theme's own colours.** Comments recede, strings and
  // keywords take the accent at two strengths, and everything else is ink —
  // which works on every theme including ones nobody has written yet, and does
  // not turn a page of prose into an IDE. A fuller palette is six more colours
  // every theme would have to answer for.
  { tag: tags.comment, color: 'rgb(var(--text-muted))', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: 'rgb(var(--accent))', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'rgb(var(--accent) / .85)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'rgb(var(--text) / .75)' },
  { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], fontWeight: '600' },
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
    //
    // **Justified, or ragged right.** Hyphenation travels with it rather than
    // being a second switch: unhyphenated justified text at a reading measure
    // is what gives justification its bad name, opening rivers of white where
    // the spaces stretch to fill the line.
    '.cm-line': {
      padding: '0',
      textAlign: t.justify ? 'justify' : 'left',
      hyphens: t.justify ? 'auto' : 'manual',
      WebkitHyphens: t.justify ? 'auto' : 'manual',
    },
    // **Nothing between the lines of a paragraph.** A newline continues a
    // paragraph in markdown, and Tephra follows markdown, so consecutive lines
    // are one paragraph and a gap between them would be a gap inside one. How
    // far apart they sit is `leading`, which is the whole of that question.
    //
    // What the source editor cannot do is REFLOW them: the words break where
    // they were typed rather than at the measure, because each source line is
    // its own block. Structure agrees with markdown; wrapping waits for the
    // rendered surface (M5).
    // A list is a different reading task from a paragraph — the eye is scanning
    // for items rather than reading through — so it gets its own density, and
    // the gap between items is a separate number from the gap inside one. The
    // hanging indent itself is per line and comes from `lists.ts`, because it
    // depends on the width of that item's own marker.
    '.cm-line.tx-list': {
      lineHeight: `${t.listLeading}`,
      paddingBottom: `${t.listSpace}em`,
    },

    // ── code ─────────────────────────────────────────────────────────────
    //
    // **A block reaches its own measure, past the prose column.** Code is
    // written to eighty columns and wrapping it at a reading measure destroys
    // the one thing its layout carries. `ch` here is a character of the CODE
    // face, because that is the font on the line — which is what makes the
    // number mean what a person setting it expects.
    //
    // Wider than the column rather than scrolling inside it: a line you cannot
    // see is a line you will forget to read. Past this width it still wraps.
    '.cm-line.tx-code': {
      fontFamily: 'var(--font-code)',
      fontSize: `${t.codeSize}em`,
      lineHeight: `${t.codeLeading}`,
      paddingLeft: `${t.codeIndent}ch`,
      width: `${t.codeMeasure}ch`,
      maxWidth: 'none',
      // Never justified, whatever prose is doing: stretching the spaces in a
      // line of code changes what it says it is.
      textAlign: 'left',
      hyphens: 'manual',
    },
    // The fence rows are apparatus rather than code — they say where the block
    // begins, which the block's own shape says too.
    '.cm-line.tx-fence': { color: 'rgb(var(--text-muted))' },

    // **The blank line IS the gap between paragraphs.** One quantity, because a
    // reader sees one space; it was the sum of a padding and a height, so
    // neither number meant anything on its own. It keeps a real height rather
    // than collapsing, because the caret has to be able to go there.
    '.cm-line.tx-blank': {
      paddingBottom: '0',
      height: `${t.paragraphSpace.toFixed(3)}em`,
      lineHeight: `${t.paragraphSpace.toFixed(3)}em`,
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftWidth: '2px', borderLeftColor: 'rgb(var(--accent))' },
    // **The browser's own selection, and only that** (D67). This was styled
    // twice, once for CodeMirror's drawn layer and once for the native one,
    // because vim required the drawn layer and vim-off did not use it. With vim
    // gone there is one mechanism.
    //
    // The colour was previously --accent-surface, a pale mint on near-white,
    // which was so faint that selecting text looked like nothing had happened.
    '.cm-content ::selection, .cm-line::selection, .cm-line ::selection': {
      backgroundColor: 'rgb(var(--accent) / 0.22)',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-gutters': { display: 'none' },
    '.cm-panels': { fontFamily: 'var(--font-ui)', fontSize: '13px' },
  })
}
