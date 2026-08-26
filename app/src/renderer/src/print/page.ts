// The printed page.
//
// Paper is not a screen with different dimensions. The theme's job on screen is
// to be comfortable for hours; paper's job is to be read once, possibly by
// someone else, and to survive a photocopier. So this does not inherit the
// theme: black on white, a printer's measure, and margins the page setup can
// still argue with.

import { toHtml, type Cue } from './markdown.ts'
import type { DayProse } from '../../../shared/ipc.ts'
import { stripHandles, type Prose } from '../../../shared/prose.ts'
import type { CommentThread } from '../../../shared/comments.ts'
import { CLEAN, place, PAPER_SURFACE, type Placed, type Presentation } from '../../../shared/presentation.ts'
import type { ProseOffset } from '../../../shared/document-api.ts'

/**
 * A passage rendered for paper.
 *
 * There is no base URL here on purpose. Relative links resolve from the day the
 * passage came from, and only main knows where the notebook is — so the job
 * carries the DAY and main turns it into a URL. Spike B's fourth trap was that
 * printing through a temp file makes every relative image 404 without one.
 */
export function printPage(markdown: string, title: string): { html: string; title: string } {
  return { html: toHtml(markdown), title }
}

/**
 * What paper can draw TODAY.
 *
 * The policy type (D50) is complete — margins, page footnotes, running heads —
 * and this renderer is not: those need annotated markdown (to splice a cue into
 * the text where its anchor is) and paged.js (to know where the pages break).
 * Naming the two presentations that work is how the gap stays visible instead
 * of becoming a treatment that silently draws nothing.
 */
export const PAPER_CLEAN: Presentation = { ...CLEAN, date: 'seam' }
export const PAPER_NOTES: Presentation = { ...PAPER_CLEAN, comment: 'endOfSection' }
/** The apparatus in the margin, the way a marked-up manuscript carries it. */
export const PAPER_MARGIN: Presentation = {
  ...PAPER_CLEAN, anchor: 'margin', tag: 'margin', comment: 'margin',
}
/** Tagged ranges shown in the text itself, for reading rather than for working. */
export const PAPER_INLINE_TAGS: Presentation = { ...PAPER_NOTES, tag: 'inline' }
/** Real footnotes, at the foot of the page the passage is on. Needs paged.js. */
export const PAPER_FOOTNOTES: Presentation = { ...PAPER_CLEAN, tag: 'inline', comment: 'footnote' }

/** Whether a presentation needs the document broken into pages first. */
export const needsPages = (how: Presentation): boolean => how.comment === 'footnote'

/**
 * A run of days, each under its date, drawn according to a policy.
 *
 * **The date is a heading the printer adds, not markdown put through the
 * parser.** A `## 24 August` inserted into the text would compete with the
 * headings a person wrote — it would appear in a table of contents, and it
 * would change what the day's own `##` means relative to it. Emitting the
 * element directly keeps the day labels in a different register from the
 * document's own structure, which is what they are.
 *
 * Blank days never arrive here; `proseIn` leaves them out (D8's stream files a
 * day whenever the app opens, so a fortnight is full of them).
 */
export function printRangePage(
  days: readonly DayProse[],
  title: string,
  how: Presentation = PAPER_CLEAN,
): { html: string; title: string } {
  const sameYear = new Set(days.map(d => d.date.slice(0, 4))).size === 1
  const html = days
    .map(day => {
      const prose = day.prose
      const placed = place(prose, how, PAPER_SURFACE)
      const heading = placed.some(p => p.annotation.kind === 'date' && p.slot !== 'none')
        ? `<h2 class="date">${readable(day.date, sameYear)}</h2>\n`
        : ''
      const body = toHtml(prose.text, cues(placed))
      return `<section class="day">${heading}${body}${notes(prose, placed)}</section>`
    })
    .join('\n')
  // The right margin is only reserved when something is going to be put in it:
  // a clean print should use the whole measure the page setup allows.
  const wide = html.includes('class="margin')
  return { html: wide ? `<div class="has-margin">${html}</div>` : html, title }
}

/**
 * What gets drawn AT the text: underlines, labels, marks and margin notes.
 *
 * **Every one of these is a pair of offsets and some HTML**, which is the whole
 * benefit of the annotations being one list (D50) — four kinds and four
 * treatments come out of one loop, and adding a fifth is an entry rather than a
 * pass over the document.
 *
 * A range needs two cues, and the closing one is ordered ahead of any opening
 * one at the same offset so that overlapping tags nest rather than interleave.
 *
 * **Everything emitted here is inline, and contains only inline content.** A
 * cue lands INSIDE a paragraph, and `<div>` or `<p>` inside a `<p>` is not an
 * error the browser reports — it silently closes the paragraph and re-parents
 * the content, which left the footnote element empty and its text loose in the
 * page. paged.js then dutifully moved an empty element to the foot. Spans, and
 * markdown rendered without its block wrappers.
 */
function cues(placed: readonly Placed<ProseOffset>[]): readonly Cue[] {
  const out: Cue[] = []
  for (const { annotation, slot, cue } of placed) {
    const from = annotation.at.from as number
    const to = annotation.at.to as number

    if (annotation.kind === 'tag' && slot === 'flow') {
      // Underlined, with the subject named once where it starts. On paper
      // there is no hover and no colour, so a range with no label is a mark
      // whose meaning has been left behind on the screen.
      out.push({ at: from, html: `<span class="tag"><span class="tag-name">${escape(annotation.subject)}</span>`, order: 1 })
      out.push({ at: to, html: '</span>', order: -1 })
    } else if (annotation.kind === 'tag' && slot === 'margin') {
      out.push({ at: from, html: `<span class="tag">`, order: 1 })
      out.push({ at: to, html: `</span><span class="margin tag-margin">${escape(annotation.subject)}</span>`, order: -1 })
    } else if (annotation.kind === 'anchor' && slot === 'margin') {
      out.push({ at: from, html: `<span class="margin anchor">✳ ${escape(annotation.name)}</span>` })
    } else if (annotation.kind === 'comment' && slot === 'margin') {
      out.push({ at: to, html: `<span class="margin note">${inlineMessages(annotation.thread)}</span>`, order: -1 })
    } else if (annotation.kind === 'comment' && slot === 'foot') {
      // **The note is emitted where its anchor is, and floated away by CSS.**
      // That is how paged.js is told which page it belongs to: `float:
      // footnote` moves an element to the foot of whatever page it ended up
      // on, and it can only know that if the element was in the flow first.
      // The number is the counter's, not ours.
      out.push({ at: to, html: `<span class="footnote">${inlineMessages(annotation.thread)}</span>`, order: -1 })
    } else if (annotation.kind === 'comment' && slot === 'section') {
      // The number stands where the passage ends, and the note closes the day.
      out.push({ at: to, html: `<sup class="cue">${cue ?? ''}</sup>`, order: -1 })
    }
  }
  return out
}

/**
 * A thread with no block elements in it, for the slots that sit inside a
 * paragraph — a footnote, or a note in the margin.
 *
 * Markdown's own block wrappers are stripped rather than the markdown being
 * rendered differently: a note is a sentence or two, and its emphasis, code and
 * links should survive even though its paragraphs cannot.
 */
function inlineMessages(thread: CommentThread): string {
  return thread.messages
    .map(m => `<b>${escape(m.author)}</b> ${unwrap(toHtml(m.body))}`)
    .join(' · ')
}

const unwrap = (html: string): string =>
  html.replace(/<\/?(?:p|div|section|blockquote|ul|ol|li|h[1-6])[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

/** A thread as paper sees it: who said it, and what they said. */
function messages(thread: CommentThread): string {
  return thread.messages
    .map(m => `<div class="note-body"><b>${escape(m.author)}</b> ${toHtml(m.body)}</div>`)
    .join('')
}

/**
 * The notes closing a day — the on-screen cousin of a footnote, on paper
 * because paper cannot do the real thing yet (D50).
 *
 * **Each note quotes what it is about.** A note at the end of a day is a long
 * way from the sentence it was written about, and without the quotation it is a
 * remark about nothing. The quotation is what a cue in the margin would have
 * bought, at the cost of some ink.
 */
function notes(prose: Prose<ProseOffset>, placed: readonly Placed<ProseOffset>[]): string {
  const closing = placed.filter(p => p.slot === 'section')
  if (closing.length === 0) return ''
  const items = closing
    .map(p => {
      const about = quote(prose.text.slice(p.annotation.at.from, p.annotation.at.to))
      const body = p.annotation.kind === 'comment' ? messages(p.annotation.thread) : ''
      return `<li value="${p.cue ?? ''}"><q>${escape(about)}</q>${body}</li>`
    })
    .join('\n')
  return `\n<section class="notes"><h3>Notes</h3><ol>${items}</ol></section>`
}

/** Enough of the passage to recognise it, and not a paragraph of it. */
function quote(text: string, limit = 90): string {
  const clean = stripHandles(text).replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * What the printed run is called, in the running header and the window title.
 *
 * Named for what was WRITTEN rather than for what was asked for: a request for
 * "everything" that finds four days should say those four days, because that is
 * what the pages in your hand contain.
 */
export function rangeTitle(days: readonly DayProse[]): string {
  const first = days[0]?.date ?? ''
  const last = days[days.length - 1]?.date ?? first
  if (first === last) return readable(first, false)
  const sameYear = first.slice(0, 4) === last.slice(0, 4)
  return `${readable(first, sameYear)} – ${readable(last, false)}`
}

/**
 * A date a person would say out loud — the same form the day seam uses on
 * screen, so a printed day and the day above the line read alike.
 */
export function readable(date: string, sameYear: boolean): string {
  const at = new Date(`${date}T00:00:00`)
  if (Number.isNaN(at.getTime())) return date
  const parts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }
  if (!sameYear) parts.year = 'numeric'
  return at.toLocaleDateString([], parts)
}

/**
 * The whole document, assembled in main where the base URL is known.
 *
 * **No backticks below, not even in a comment.** This is a template literal, so
 * one ends the stylesheet in the middle and the error lands on a line of CSS
 * that is perfectly fine. It has happened twice.
 */
export const PRINT_CSS = `
  @page { margin: 20mm 18mm; }
  html { font-size: 11pt; }
  body {
    margin: 0; color: #000; background: #fff;
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
    line-height: 1.5; hyphens: auto;
  }
  /* A printer's measure. On screen the frame guarantees this; on paper the page
     does, and 34em at 11pt is close to the same count of characters. */
  main { max-width: 34em; margin: 0 auto; }
  header { margin: 0 0 2em; padding-bottom: .6em; border-bottom: .5pt solid #999; }
  header .who { font: 8pt/1.4 -apple-system, system-ui, sans-serif; letter-spacing: .06em;
                text-transform: uppercase; color: #555; }
  h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.2; margin: 1.4em 0 .5em; }
  h1 { font-size: 1.6em } h2 { font-size: 1.3em } h3 { font-size: 1.1em }
  p { margin: 0 0 .7em; orphans: 3; widows: 3; }
  blockquote { margin: .8em 0 .8em 1.5em; padding-left: 1em; border-left: 1pt solid #999; color: #333; }
  code, pre { font-family: 'SF Mono', ui-monospace, Menlo, monospace; font-size: .88em; }
  pre { padding: .6em .8em; background: #f2f2f2; border-radius: 3px; overflow-wrap: break-word;
        white-space: pre-wrap; page-break-inside: avoid; }
  table { border-collapse: collapse; margin: .9em 0; font-size: .95em; page-break-inside: avoid; }
  th, td { border: .5pt solid #999; padding: .3em .5em; text-align: left; }
  th { background: #f2f2f2; }
  img { max-width: 100%; page-break-inside: avoid; }
  hr { border: 0; border-top: .5pt solid #999; margin: 1.4em 0; }
  a { color: #000; }
  /* The target is what matters on paper, since the link cannot be followed. */
  a[href]:not([href^='#'])::after { content: ' (' attr(href) ')'; font-size: .82em; color: #555; }
  .katex-display { margin: .9em 0; page-break-inside: avoid; }

  /* A range of days. The date is a label rather than a heading of the text, so
     it is set in the sans face the running header uses and ruled off, and it
     never separates from the day it belongs to. */
  .day + .day { margin-top: 2em; }
  /* ── the apparatus ───────────────────────────────────────────────────────
     A marked-up manuscript, not a screenshot of one: paper has no colour to
     spend, no hover, and a margin the page can actually give up. */
  main { position: relative; }
  .tag { border-bottom: .5pt dotted #666; }
  .tag-name { font: 7.5pt/1 -apple-system, system-ui, sans-serif; letter-spacing: .06em;
              text-transform: uppercase; color: #666; vertical-align: .5em;
              margin-right: .15em; white-space: nowrap; }
  .cue { font-size: .7em; color: #444; }
  .cue::before { content: '['; } .cue::after { content: ']'; }
  /* A span, because this lives inside a paragraph; block display is a style,
     not a parse. */
  .margin {
    display: block; float: right; clear: right; width: 11em; margin-right: -13.5em;
    font: 8pt/1.35 -apple-system, system-ui, sans-serif; color: #444;
    break-inside: avoid; page-break-inside: avoid;
  }
  .margin.tag-margin { text-transform: uppercase; letter-spacing: .06em; font-size: 7.5pt; color: #666; }
  .margin.anchor { color: #666; }
  /* Margin notes need the margin, and only when there are margin notes. */
  .has-margin { margin-right: 13.5em; }

  /* Footnotes, which exist only once paged.js has made pages to put them on.
     The area is styled by ITS OWN class rather than through a nested at-rule
     inside @page: that form is parsed by paged.js's own CSS parser, and a
     stylesheet it cannot read is a stylesheet it ignores — including the float
     line that makes footnotes happen at all. */
  .footnote { float: footnote; font-size: .85em; }
  .footnote p { margin: 0; display: inline; }
  .pagedjs_footnote_area { border-top: .5pt solid #999; padding-top: .3em; margin-top: .6em; }
  .pagedjs_footnote_area .footnote { font-size: .8em; }

  .notes { margin: 1.4em 0 0; padding-top: .6em; border-top: .5pt solid #ccc;
           break-inside: avoid; page-break-inside: avoid; }
  .notes h3 { font: 8.5pt/1.4 -apple-system, system-ui, sans-serif; letter-spacing: .08em;
              text-transform: uppercase; color: #555; margin: 0 0 .5em; }
  .notes ol { margin: 0; padding-left: 1.4em; font-size: .92em; }
  .notes li { margin: 0 0 .5em; }
  .notes q { color: #555; }
  .notes q::before { content: '“'; } .notes q::after { content: '”'; }
  .note-body { margin: .15em 0 0; }
  .note-body p { margin: 0 0 .3em; }

  .day .date {
    font: 8.5pt/1.4 -apple-system, system-ui, sans-serif; letter-spacing: .08em;
    text-transform: uppercase; color: #555; margin: 0 0 .9em;
    padding-bottom: .35em; border-bottom: .5pt solid #ccc;
    break-after: avoid; page-break-after: avoid;
  }
`
