// What the link directory thinks (ML2, D60, D61).
//
// **This is the policy, and `links.ts` is the scanner.** That split is D61's:
// the scanner finds every link and says what each points at, with no opinion
// about which matter — which is what lets a todo row and the editor use it
// without inheriting the directory's taste. Everything opinionated is here, in
// one module, because these two functions change together and each change
// invalidates every key the index holds.
//
// **And that is safe, because the index stores the raw target** (D60). The
// canonical form is a derived grouping key, recomputed on read, never the only
// record. Canonicalization is expected to change repeatedly — which parameters
// are noise, whether a fragment distinguishes a page, how two spellings of one
// document relate — and with the raw target kept, every change is a cache
// rebuild, which D52 makes free. Storing only the canonical form would make
// each change a reindex to recover information that had been thrown away.

import type { ScannedLink } from './links.ts'

/**
 * A grouping key, and deliberately not a target.
 *
 * **Branded so it cannot be stored where a target belongs**, which is D60's
 * load-bearing half made structural rather than merely written down. The one
 * way to get one is `canonicalizeLink`, and there is no way back to a URL you
 * could open — because there is not supposed to be: two links that group
 * together were written differently, and the directory shows what was written.
 */
export type CanonicalLink = string & { readonly __canonical: unique symbol }

/**
 * Does this link belong in the directory?
 *
 * **URLs and files, inside the corpus or outside it.** Not `tephra:` references
 * — the sidebar already serves those, and they would bury the documents under
 * them. Not images: an embedded picture is not a document you were reading.
 *
 * *Takes the link rather than the reference, which is a small amendment to
 * D61's wording.* "Not images" is a fact about the link and not about where it
 * points, so with a reference argument the policy would live in two places —
 * and one place is what the decision is actually for.
 */
export function indexable(link: ScannedLink): boolean {
  if (link.image) return false
  return link.reference?.kind === 'url' || link.reference?.kind === 'file'
}

/**
 * Query parameters that identify a campaign rather than a document.
 *
 * **A short list, on purpose.** This does not have to be a general-purpose
 * canonicalizer for the whole web; it has to be right about the links one
 * person writes down, and what is salient there is learned from use. `ref` is
 * the least safe of these — a few sites do mean something by it — and is
 * included because the cost of over-merging two spellings of one page is much
 * lower here than the cost of two rows for it.
 */
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|ref)$/i

/**
 * The key two spellings of one destination share.
 *
 * **Conservative, and expected to grow.** What it does now: drops the fragment,
 * drops tracking parameters, lowercases the scheme and host, drops a default
 * port, and resolves a corpus-relative path against the file it was written in
 * so that the same document linked from two days groups as one.
 *
 * What it deliberately does NOT do: strip `www.`, unify `http` with `https`, or
 * reorder query parameters. Each is a claim about host identity that the URL
 * does not itself make, and the patterns actually worth merging are the ones
 * that show up in use — which is a thing to learn rather than guess.
 *
 * `inFile` is the corpus path of the file the link was written in, which is
 * what a relative target is relative to.
 */
export function canonicalizeLink(target: string, inFile: string): CanonicalLink {
  if (/^https?:/i.test(target)) return canonicalUrl(target)
  // Anything else is a path: inside the corpus, or reaching out of it. Both are
  // resolved against the corpus root so that one document has one key however
  // many different files link to it.
  return resolveFrom(inFile, target) as CanonicalLink
}

function canonicalUrl(target: string): CanonicalLink {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    // Not parseable is not an error — the file is hand-edited, and text that
    // looks like a URL and is not still deserves to group with itself.
    return target.trim() as CanonicalLink
  }
  url.hash = ''
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING.test(name)) url.searchParams.delete(name)
  }
  // `URL` already lowercases the scheme and host and drops a default port.
  // What it does not drop is the `?` left behind by removing every parameter.
  return url.toString().replace(/\?$/, '') as CanonicalLink
}

/**
 * A relative target, as a corpus path.
 *
 * Leading `..` that escape the root are KEPT: a link to a file outside the
 * notebook is still a link (D61), and `../elsewhere/x.md` relative to the root
 * is a stable name for it however many files point there.
 */
function resolveFrom(inFile: string, target: string): string {
  const clean = target.split('#')[0] ?? target
  if (clean.startsWith('/')) return clean
  const parts = [...(inFile.split('/').slice(0, -1)), ...clean.split('/')]
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    // Only collapse `..` against a real directory; one that escapes the root is
    // meaningful and is kept.
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}
