// Every link in a body, found once (ML1, D61).
//
// **There were two link parsers before this and they disagreed.** `ITEM` in
// `fileset.ts` reads both legal spellings of a destination, including
// `(<http://a b>)`; the editor's own regex read only the bare one — and
// `App.tsx`'s Insert Link writes the angle-bracket form, via `destination()`,
// whenever the URL contains a space. So inserting a link with a space in it
// produced something the app's own renderer would not render as a link. One
// scanner with three consumers retires the disagreement along with the bug.
//
// **It has no opinion about which links matter** (D61). It finds them and says
// what each one points at; whether a link belongs in the link directory is a
// separate predicate, and it arrives with the index (ML2). That split is what
// makes this reusable by a todo row and by the editor without either of them
// inheriting the directory's policy.

import { referenceOf } from './fileset.ts'
import type { Reference } from './nav-api.ts'

export interface ScannedLink {
  /** The words, which are usually the title — that is how people write links. */
  readonly label: string
  /** The destination exactly as written, angle brackets removed if it had them. */
  readonly target: string
  /** What it points at: a URL, a file, a `tephra:` reference, or nothing known. */
  readonly reference: Reference | null
  /** An image, which is embedded rather than gone to. */
  readonly image: boolean
  /** Offsets into the body given to the scanner. */
  readonly from: number
  readonly to: number
}

/**
 * **Both spellings of a destination, and the image marker in front.**
 *
 * `[label](target)` and `[label](<target with spaces>)`. CommonMark's angle
 * brackets exist for exactly the case a bare destination cannot survive, and
 * `destination()` in the editor already writes them — so a reader that does not
 * accept them is a reader that cannot read what this app writes.
 *
 * The leading `!` is captured rather than excluded: an image is a link by
 * grammar and not by intent, and the caller decides which it wanted. The link
 * directory wants documents you went to; the editor wants to draw both.
 */
const LINK = /(!?)\[([^\]\n]*)\]\(\s*(?:<([^>\n]*)>|([^)\s]*))\s*\)/g

export function scanLinks(body: string): readonly ScannedLink[] {
  const out: ScannedLink[] = []
  LINK.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINK.exec(body)) !== null) {
    const target = (m[3] ?? m[4] ?? '').trim()
    if (target === '') continue // `[text]()` points nowhere; it is not a link yet
    out.push({
      label: m[2] as string,
      target,
      // `referenceOf` already does this classification for filesets, and what a
      // target means is one question with one answer (D53).
      reference: referenceOf(target),
      image: m[1] === '!',
      from: m.index,
      to: m.index + m[0].length,
    })
  }
  return out
}

// ── writing one ────────────────────────────────────────────────────────────
//
// **The inverse of the scanner, and it lives here for that reason.** It was in
// the renderer, and the scanner was too, and the two were written months apart
// by the same grammar's two halves not talking: the writer emitted the angle-
// bracket form and the reader did not accept it. Side by side, the round trip
// is one test rather than an assumption.

/**
 * A destination, in a form the parser will return whole.
 *
 * **A bare URL containing a space or a bracket ends early**, and the rest of it
 * becomes prose sitting next to a broken link — quietly, and in the file. Angle
 * brackets are CommonMark's provision for exactly this and every renderer
 * understands them, so they are used whenever the plain form would not survive.
 *
 * `<` and `>` inside the URL are removed rather than escaped: they cannot
 * appear in a valid URL, angle brackets have no escape inside a destination,
 * and a link that silently ends in the middle is worse than one missing a
 * character it should not have had.
 */
export function destination(target: string): string {
  const url = target.trim()
  if (url === '') return ''
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, '')}>` : url
}

/**
 * The text as a reader would read it: link labels, without their targets.
 *
 * **For the places that show a line but cannot make its links live.** A row in
 * the due-soon rail is itself a button that scrolls to the item, and an anchor
 * inside a button is both invalid and a second thing to hit; a menu's label is
 * a label. Neither can render `Prose`, and both were showing the raw
 * `[text](https://…)` — which is the file being honest in a place nobody asked
 * it to be.
 *
 * Labels rather than nothing, because the label is what the sentence says. The
 * URL is what you go to, and going there is the row's job.
 */
export function flattenLinks(text: string): string {
  const links = scanLinks(text)
  if (links.length === 0) return text
  let out = ''
  let at = 0
  for (const link of links) {
    out += text.slice(at, link.from) + (link.image ? '' : link.label)
    at = link.to
  }
  return (out + text.slice(at)).replace(/\s{2,}/g, ' ').trim()
}
