// What colour a subject is, and how a subject is identified.
//
// Both belong here rather than in either process: main decides what a subject
// IS when it writes markers, and the renderer decides what it LOOKS LIKE, and
// the two must agree about which strings are the same subject.

/**
 * Subjects compare case-insensitively and whitespace-normalised, but are stored
 * as typed (format-spec) — so *House Deal* and *house deal* are one subject and
 * the capitalisation the user chose survives in the file.
 */
export function subjectKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * **Written as a regex literal, not a string.** As a string it needed three
 * layers of backslash to say one, and `[^'\\\\\\n]` came out as *not a quote
 * and not an actual newline character* — which matched a backslash happily and
 * broke every escaped name. A literal has one layer and can be read.
 */
const NAME_PART = /(?:'((?:[^'\\\n]|\\.)+)'|([A-Za-z0-9][\w-]*))/
export const NAME_BODY = NAME_PART.source

/**
 * How a subject is written inline: `#house`, and `#'house deal'` when it has
 * spaces — the same two-form idea as a markdown link destination, and for the
 * same reason: the plain form is what anybody types and the quoted form is what
 * survives a space.
 *
 * **Not preceded by a word character**, so a URL fragment and a C preprocessor
 * line in a code fence are not tags.
 *
 * **Here rather than in `todo.ts`, because a second reader arrived** — the query
 * notation asks the same question of a search box that a task line asks of
 * itself, and T16 means it must get the same answer. Two copies of one grammar
 * is precisely how `links.ts`'s halves came to disagree (D61).
 *
 * **A source string and a factory, not a shared `RegExp`.** A `/g` regex carries
 * `lastIndex`, so one instance shared between two scanners is a bug that only
 * appears when both run.
 */
export const TAG_MARK = `(?<![\\w#])#${NAME_BODY}`

export const tagMark = (flags = 'g'): RegExp => new RegExp(TAG_MARK, flags)

/**
 * A subject written as a tag, or null if this grammar cannot say it.
 *
 * **Two forms, and which one is decided by the grammar above rather than by a
 * guess at it.** A bare `#house` where the name is one plain word; `#'the
 * house'` where it is not. The document module had this as `/\s/.test(name)`,
 * which asks the wrong question — a name can need quoting for reasons other
 * than a space, and the only authority on that is `TAG_MARK` itself.
 *
 * **And some names simply cannot be spelled.** The quoted form is `'[^']+'`,
 * with no escape, so a subject containing an apostrophe has no representation
 * at all: *Ada's birthday* would be written `#'Ada's birthday'` and read back as
 * `#'Ada'` followed by wreckage. Null rather than a mangling, so a caller
 * chooses what to do instead of silently writing something that means something
 * else. Extending the grammar to admit them is a real change and belongs in one.
 */
/**
 * A name as this file's grammars write one: bare where it can be, quoted where
 * it must be, escaped where the quotes would not survive.
 *
 * **One set of rules, because there is now more than one marker using them.** A
 * tag is `#name`, an owner is `OWNER name`, and what may follow either is the
 * same question — so it is answered once. The body pattern below is shared with
 * `TAG_MARK` and `OWNER_MARK`, and if they drift the notation has two dialects.
 */

export function spellName(name: string): string | null {
  // **A newline becomes a space rather than an escape.** These marks live inside
  // one line of a file people read and edit by hand; a `\n` escape would mean a
  // name that spans lines in the bytes and not on the page, which is the kind of
  // cleverness that costs somebody an afternoon later.
  const said = name.replace(/\s+/g, ' ').trim()
  if (said === '') return null
  if (/^[A-Za-z0-9][\w-]*$/.test(said)) return said
  // **Escaped, not refused.** The first cut returned null for a name holding an
  // apostrophe, on the grounds that the quoted form had no way to say one —
  // which is a fair reading of the grammar and an absurd thing to do to *Ada's
  // birthday*. The grammar grew the escape instead; it is the same one
  // `query-text.ts` already uses for quoted phrases.
  return `'${said.replace(/[\\']/g, m => `\\${m}`)}'`
}

/** What a match of either marker actually names, with its escapes undone. */
export const readName = (found: RegExpMatchArray, at = 1): string =>
  found[at] === undefined
    ? (found[at + 1] ?? '')
    : found[at].replace(/\\(.)/g, (_m, ch: string) => ch)

export function spellTag(name: string): string | null {
  const body = spellName(name)
  return body === null ? null : `#${body}`
}

/**
 * What a tag match actually names.
 *
 * **One place unescapes, because three places match.** The item grammar, the
 * matter grammar and the query field all run `tagMark` and all took
 * `m[1] ?? m[2]`, which was right while the quoted form was literal. With an
 * escape in it, a raw group 1 reads `Ada\'s birthday` — backslash and all — and
 * three copies of the fix would be three chances to write two of them.
 */
export const readTag = (found: RegExpMatchArray): string =>
  found[1] === undefined
    ? (found[2] ?? '')
    : found[1].replace(/\\(.)/g, (_m, ch: string) => ch)

/**
 * The hues a tag may take, in order.
 *
 * **A slot, not a raw hash-to-hue.** Hashing straight to a hue gives colours
 * that clash with the accent, colours indistinguishable from their neighbours,
 * and colours that go muddy on cream — chosen by a hash function rather than by
 * anyone. These eight are spread far enough apart to be told from each other
 * and are picked to sit on a page rather than on a screenshot. Saturation and
 * lightness come from the theme, so the same subject is recognisably itself on
 * cream and on black.
 *
 * Two subjects sharing a slot is expected and survivable: the mark says which
 * one it is when asked.
 */
export const TAG_HUES: readonly number[] = [4, 34, 74, 104, 168, 202, 258, 314]

/**
 * Stable for the life of a subject: same words, same colour, forever.
 *
 * **FNV-1a with a finalising mix, and the mix is not decoration.** Taking
 * `hash % 8` straight from FNV uses its lowest three bits, which barely
 * avalanche for short strings — sixteen plausible subject names landed on five
 * of the eight hues, leaving three unreachable and putting four names on one
 * colour. The mixer below spreads the high entropy down into the low bits
 * before the modulus, which is what makes eight hues actually mean eight.
 */
export function tagSlot(subject: string): number {
  const key = subjectKey(subject)
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  // Murmur3's finaliser, which is where 32-bit hashes go to become uniform.
  // Every step re-coerces to unsigned: `^` yields a SIGNED 32-bit integer in
  // JavaScript, and a negative left operand makes `%` negative, which indexes
  // nothing.
  hash = (hash ^ (hash >>> 16)) >>> 0
  hash = Math.imul(hash, 0x85ebca6b) >>> 0
  hash = (hash ^ (hash >>> 13)) >>> 0
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0
  hash = (hash ^ (hash >>> 16)) >>> 0
  return hash % TAG_HUES.length
}

/** `"r g b"`, the space-separated form the stylesheet needs for `rgb(… / a)`. */
export function hslTriple(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100
  const l = lightness / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x]
  const to255 = (v: number): number => Math.round((v + m) * 255)
  return `${to255(r as number)} ${to255(g as number)} ${to255(b as number)}`
}

/**
 * How many rules may stack under one line.
 *
 * At 20px on 1.72 leading there is room for about three before they reach the
 * descenders of the line below. Past that the extent stops being drawn — the
 * marks are still there, and asking one of them is how you find out what else
 * covers this passage.
 */
const MAX_DEPTH = 3

interface Extent {
  readonly from: number
  readonly to: number
  readonly slot: number
  readonly depth: number
}

/**
 * Assign each span a depth, so overlapping subjects do not draw on top of each
 * other.
 *
 * Lowest free level wins, which keeps the common case — one tag, no overlap —
 * always on the first rule, where it is closest to the text it belongs to.
 */
export function stack(
  spans: readonly { from: number; to: number; name: string }[],
): readonly Extent[] {
  const ends: number[] = []
  const out: Extent[] = []
  for (const span of [...spans].sort((a, b) => a.from - b.from || b.to - a.to)) {
    if (span.to <= span.from) continue
    let depth = ends.findIndex(end => end <= span.from)
    if (depth === -1) {
      depth = ends.length
      ends.push(span.to)
    } else {
      ends[depth] = span.to
    }
    if (depth >= MAX_DEPTH) continue
    out.push({ from: span.from, to: span.to, slot: tagSlot(span.name), depth })
  }
  return out
}
