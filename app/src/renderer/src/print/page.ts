// The printed page.
//
// Paper is not a screen with different dimensions. The theme's job on screen is
// to be comfortable for hours; paper's job is to be read once, possibly by
// someone else, and to survive a photocopier. So this does not inherit the
// theme: black on white, a printer's measure, and margins the page setup can
// still argue with.

import { toHtml } from './markdown.ts'

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
`
