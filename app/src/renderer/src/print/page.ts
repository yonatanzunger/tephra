// The printed page.
//
// Paper is not a screen with different dimensions. The theme's job on screen is
// to be comfortable for hours; paper's job is to be read once, possibly by
// someone else, and to survive a photocopier. So this does not inherit the
// theme: black on white, a printer's measure, and margins the page setup can
// still argue with.

import { toHtml } from './markdown.ts'
import type { DayProse } from '../../../shared/ipc.ts'
import { stripHandles, type Prose } from '../../../shared/prose.ts'
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
      return `<section class="day">${heading}${toHtml(prose.text)}${notes(prose, placed)}</section>`
    })
    .join('\n')
  return { html, title }
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
      const body =
        p.annotation.kind === 'comment'
          ? p.annotation.thread.messages
              .map(m => `<div class="note-body"><b>${escape(m.author)}</b> ${toHtml(m.body)}</div>`)
              .join('')
          : ''
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

/** The whole document, assembled in main where the base URL is known. */
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
