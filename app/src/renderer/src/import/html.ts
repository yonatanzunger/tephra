// Rich clipboard content, converted to the format this notebook is written in.
//
// **Chromium's parser does the hard half.** Parsing real-world HTML — Word's
// `<span style>` soup, Google Docs wrappers, MSO conditional comments — is the
// expensive part of this problem, and the renderer already contains the most
// tested HTML parser there is. So this runs here rather than in main, and needs
// no HTML parser of its own; Turndown's browser build drops its DOM shim
// entirely, which is 7.7 MB of dependency that never arrives.
//
// **Imperfection is survivable here and nowhere else.** The bytes that arrived
// are kept untouched in `attachments/` (D47), so a conversion that loses
// something is recoverable by opening the original. That is what lets a
// converter ship before it is perfect — and it is the reason the rule exists.

import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

/**
 * Configured to the house style, not to Turndown's defaults.
 *
 * What this emits is read back by the same parser the editor uses and the
 * printer walks, so the choices are not cosmetic: `_underscores_` would fight
 * `some_file_name`, and setext headings cannot carry a level past two.
 */
function service(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })
  // Tables, strikethrough and task lists. The format is GFM — `@lezer/markdown`
  // is configured with it — so the converter should speak the same dialect.
  turndown.use(gfm)

  // Turndown indents list items by three spaces. Valid, and four of them nest
  // into a code block by accident; more to the point the raw file is read by
  // people, and `- One` is what a person writes.
  turndown.addRule('tightListItem', {
    filter: 'li',
    replacement: (content, node) => {
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/gm, '\n  ')
      const parent = node.parentNode as HTMLElement | null
      const ordered = parent?.nodeName === 'OL'
      const index = ordered ? [...(parent?.children ?? [])].indexOf(node as HTMLElement) + 1 : 0
      const prefix = ordered ? `${index}. ` : '- '
      return prefix + body + (node.nextSibling !== null && !/\n$/.test(body) ? '\n' : '')
    },
  })

  turndown.remove(['style', 'script', 'noscript', 'meta', 'link', 'title'])
  // A pasted fragment's own comments are not Tephra's, and one that begins a
  // line would turn the block after it into an HTML block — the rule markers
  // already obey. Dropping them is simpler than placing them.
  turndown.addRule('comments', {
    filter: (node: Node) => node.nodeType === 8,
    replacement: () => '',
  })
  return turndown
}

/**
 * Markdown for a fragment of HTML, or null if there is no content in it.
 *
 * Null rather than an empty string, because "markup that amounts to no text" is
 * a real answer and a caller should be able to say so.
 */
export function markdownFromHtml(html: string): string | null {
  const cleaned = clean(html)
  if (cleaned === null) return null
  const text = service().turndown(cleaned).trim()
  return text === '' ? null : text
}

/**
 * What survives the trip, before Turndown sees it.
 *
 * Word and Google Docs wrap their payload in a great deal that is not content:
 * conditional comments, `<o:p>` spacers, namespaced tags. Removing them here
 * rather than teaching the converter about each one keeps the rules general.
 */
function clean(html: string): string | null {
  const withoutConditionals = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
  const parsed = new DOMParser().parseFromString(withoutConditionals, 'text/html')
  const body = parsed.body
  if (body === null) return null

  for (const node of [...body.querySelectorAll('style, script, noscript, meta, link, title')]) {
    node.remove()
  }
  // Office's own namespace, which carries no content and confuses everything.
  for (const node of [...body.querySelectorAll('*')]) {
    if (node.tagName.includes(':')) node.replaceWith(...node.childNodes)
  }

  const empty = (body.textContent ?? '').trim() === ''
  return empty && body.querySelector('img, table, hr') === null ? null : body.innerHTML
}
