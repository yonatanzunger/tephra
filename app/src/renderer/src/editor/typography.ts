// How text is set: the measurements the whole app lays out from.
//
// **Not the editor's, though the editor is where it shows.** The frame sizes its
// gutters from these numbers and the theme picker edits them live, so they sit
// above any one surface — a kind that draws something other than running text
// still renders inside the same page (D41).

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
  /** Justified, with hyphenation — or ragged right. */
  justify: boolean
  /** A list has its own leading, and its own gap between items. */
  listLeading: number
  listSpace: number
  /** Code has its own face, size, leading, measure and inset. */
  codeFace: string
  codeSize: number
  codeLeading: number
  codeMeasure: number
  codeIndent: number
}

export const defaultTypography: Typography = {
  font: "'Lora', Georgia, serif",
  size: 18,
  measure: 74,
  gutter: 19,
  gutterGap: 3,
  leading: 1.55,
  paragraphSpace: 0.5,
  justify: false,
  listLeading: 1.6,
  listSpace: 0,
  codeFace: "'JetBrains Mono', ui-monospace, monospace",
  codeSize: 0.85,
  codeLeading: 1.45,
  codeMeasure: 80,
  codeIndent: 2,
}

// ── the code block's size, derived ──────────────────────────────────────────

/**
 * How wide one character is in a face, as a fraction of the font size.
 *
 * **Measured, because it is a property of the font** and no stylesheet can be
 * told it. `ch` is exactly this quantity — CSS just will not hand it over as a
 * number — so a probe is set at a known size and its width read back.
 *
 * Cached per face. The cache is cleared when fonts finish loading, because a
 * measurement taken before `JetBrains Mono` arrives is a measurement of the
 * fallback, and a code block sized from the wrong advance is the whole point of
 * this function got wrong.
 */
const advances = new Map<string, number>()

export function advanceOf(face: string): number {
  const known = advances.get(face)
  if (known !== undefined) return known
  const probe = document.createElement('span')
  probe.style.cssText =
    `position:absolute;visibility:hidden;white-space:pre;left:-9999px;` +
    `font-family:${face};font-size:100px;letter-spacing:0`
  // Ten characters rather than one: a single glyph's width rounds to the pixel,
  // and the error rides straight into the size this derives.
  probe.textContent = '0000000000'
  document.body.appendChild(probe)
  const ratio = probe.getBoundingClientRect().width / 1000
  probe.remove()
  if (ratio > 0) advances.set(face, ratio)
  return ratio > 0 ? ratio : 0.6
}

/** Forget the measurements, for when the fonts in them have changed. */
export function forgetAdvances(): void {
  advances.clear()
}

/**
 * The smallest a code block may be set, in px.
 *
 * Below this the derivation stops being a service: eighty columns of six-point
 * type is not a block you can read, and a narrow measure would produce exactly
 * that. At the floor the block keeps this size and wraps instead, which is the
 * same trade the measure itself makes at a narrow window.
 */
export const MIN_CODE_PX = 11

/**
 * What size a code block is set at, so that its own measure fits the prose one.
 *
 * **One quantity, not two that are supposed to agree** (D86). `codeMeasure` is
 * eighty columns — the width code is written to, and wrapping it narrower
 * destroys the one thing its layout carries. The prose measure is seventy-odd
 * characters of the body face. Those are two independent numbers in a theme, and
 * a code block that reached past the prose column pushed the reading column open
 * and took the prose with it — the same failure this codebase has now recorded
 * three times from two constants meant to match (the tag and the due date at
 * 14px and 11px; `--note-lift` computed where it did not resolve).
 *
 * So the size is solved for rather than authored:
 *
 *     measure × advance(body) × size  =  codeMeasure × advance(code) × codeSize × size
 *     codeSize = (measure × advance(body)) / (codeMeasure × advance(code))
 *
 * `codeSize` in the theme keeps its job — it is the size of **inline** code in a
 * line of prose, where fitting eighty columns means nothing.
 */
export function codeBlockSize(t: Typography): { readonly em: number; readonly wraps: boolean } {
  const body = advanceOf(t.font)
  const code = advanceOf(t.codeFace)
  if (body <= 0 || code <= 0 || t.codeMeasure <= 0) return { em: t.codeSize, wraps: true }
  const em = (t.measure * body) / (t.codeMeasure * code)
  const floor = MIN_CODE_PX / t.size
  return em < floor ? { em: floor, wraps: true } : { em, wraps: false }
}
