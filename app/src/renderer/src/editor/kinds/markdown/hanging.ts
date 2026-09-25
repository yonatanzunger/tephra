// Optical margin alignment: an opening quotation hangs into the margin (D95).
//
// **What a typesetter means by a straight edge.** A paragraph that begins with
// a quotation mark begins, to the eye, a little way in: the quote's ink is high
// and narrow while its advance is full, so the first line looks indented beside
// the ones below it. Setting the mark *outside* the measure is how books have
// answered that since metal type, and it is why the text beneath a hung quote
// looks ruled.
//
// **Chromium cannot do this.** `hanging-punctuation` is unimplemented — not
// unsupported at some value, but absent: `CSS.supports('hanging-punctuation',
// 'first')` is false and setting it does nothing. Measured, not assumed.
//
// ## The mechanism
//
// The glyph gets a negative left margin of exactly its own advance, measured
// off the face the line is actually set in. Its box then ends where it began,
// so the glyph paints into the margin and the text after it sits where it
// always would have. A line decoration cannot do it — the amount is a property
// of the glyph and the face, not of the line — so this is a mark on one
// character, and the advance is measured rather than guessed, because a quote
// in one face is not a quote in another.
//
// **It is keyed to the document, not to the layout**: the first character of a
// line either is an opening quote or is not, whichever way the text wraps. That
// is what makes it stable, and it is the whole reason this is the half that
// shipped.
//
// ## What did NOT ship, and why — because the same file nearly held it
//
// Hanging punctuation at the END of each visual row is the frequent case: a
// tenth of the rows in a real notebook end in a comma or a full stop, against
// about two opening quotes in the whole corpus. It was built, and it works —
// and it cannot be made to settle.
//
// **Hanging means the row gains that glyph's width.** The browser then breaks
// the line with the extra room, a hyphenation point moves into it, and the
// glyph that ended the row no longer does — so the decoration derived from the
// layout has changed the layout it was derived from. Iterating deterministically
// oscillates: `0→13, 13→13, 13→6, 6→13, 13→4, 4→1`, on one settled page, with
// the same trace across runs and whether the re-measure waits a microtask or a
// frame. A glyph left adrift mid-row drags the text after it left, over itself.
//
// Real typesetters have the same property — optical alignment changes line
// breaks in InDesign too — but they compute the break *with* the hang, in one
// pass. CSS has no way to say *break as if this were inside the measure*, and
// `hanging-punctuation` is exactly the property that would have said it.
// `parts/typography.md` keeps the experiment.

import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate,
} from '@codemirror/view'

/** What hangs at the start of a paragraph. Openers only: a closer cannot open. */
const OPENS = new Set(['“', '‘', '"', "'"])

/**
 * The advance of one glyph in the face a line is actually set in.
 *
 * **Measured against the line's own computed style**, not the theme's, because
 * a heading, a quotation and a code line are three faces and three sizes — and
 * a comma hung by the wrong amount is worse than one not hung at all, since it
 * lands somewhere nobody chose.
 */
const widths = new Map<string, number>()
function advance(glyph: string, style: CSSStyleDeclaration): number {
  const key = `${glyph}|${style.font}`
  const known = widths.get(key)
  if (known !== undefined) return known
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;white-space:pre'
  probe.style.font = style.font
  probe.style.letterSpacing = style.letterSpacing
  // Ten of them, for the reason `advanceOf` gives: one glyph rounds to the
  // pixel and the error rides into everything derived from it.
  probe.textContent = glyph.repeat(10)
  document.body.append(probe)
  const width = probe.getBoundingClientRect().width / 10
  probe.remove()
  widths.set(key, width)
  return width
}

/** What the last measurement found, dispatched into the field that draws it. */
const setHangs = StateEffect.define<readonly Hang[]>()

interface Hang {
  /** The document offset of the glyph that hangs. */
  readonly at: number
  /** Its advance in the face this line is set in — the amount it hangs by. */
  readonly px: number
}

/**
 * **A field, written by an effect, rather than decorations owned by the plugin.**
 * The measurement happens in the measure phase, where the view is mid-flight and
 * refuses a transaction outright — *calls to EditorView.update are not allowed
 * while an update is in progress*, which is what it said when this dispatched
 * directly. Dispatching afterwards makes the redraw an ordinary redraw.
 */
const hangs = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setHangs)) continue
      const builder = new RangeSetBuilder<Decoration>()
      for (const one of effect.value) {
        builder.add(one.at, one.at + 1, Decoration.mark({
          class: 'tx-hang-open',
          // **Inline-start, not left** (D98): on a right-to-left paragraph the
          // opening quote stands at the right margin, and a negative left
          // margin would hang it off the wrong edge, into the text.
          attributes: { style: `margin-inline-start:${-one.px}px` },
        }))
      }
      return builder.finish()
    }
    return tr.docChanged ? set.map(tr.changes) : set
  },
  provide: f => EditorView.decorations.from(f),
})

const measuring = ViewPlugin.fromClass(
  class {
    /** What is drawn now, so an unchanged measurement dispatches nothing. */
    #said = ''
    /** Set when the view goes, so a queued dispatch cannot reach a dead one. */
    #gone = false

    constructor(view: EditorView) {
      this.#measure(view)
    }

    destroy(): void {
      this.#gone = true
    }

    update(update: ViewUpdate): void {
      // **The document decides WHICH glyphs hang and the theme decides BY HOW
      // MUCH**, so both matter: an edit can put a quote at the start of a line,
      // and a change of face changes every advance. Geometry is watched for the
      // second reason only — this set cannot change because the text re-wrapped,
      // which is the property that keeps it from chasing its own tail.
      if (update.docChanged || update.viewportChanged || update.geometryChanged) {
        this.#measure(update.view)
      }
    }

    #measure(view: EditorView): void {
      view.requestMeasure({
        read: v => {
          const found: Hang[] = []
          for (const { from, to } of v.visibleRanges) {
            for (let at = from; at <= to;) {
              const line = v.state.doc.lineAt(at)
              const first = line.text[0] ?? ''
              if (OPENS.has(first)) {
                const dom = v.domAtPos(line.from).node
                const el = (dom.nodeType === 1 ? dom : dom.parentElement) as HTMLElement | null
                const box = el?.closest('.cm-line') as HTMLElement | null
                if (box != null) found.push({ at: line.from, px: advance(first, getComputedStyle(box)) })
              }
              at = line.to + 1
            }
          }
          return found
        },
        write: (found, v) => {
          const said = found.map(one => `${one.at}:${Math.round(one.px)}`).join(',')
          if (said === this.#said) return
          this.#said = said
          void Promise.resolve().then(() => {
            if (!this.#gone) v.dispatch({ effects: setHangs.of(found) })
          })
        },
      })
    }
  },
)

/**
 * A paragraph opening with a quotation hangs it (D95).
 *
 * The field draws and the plugin measures: the document knows which lines open
 * with a quote, and only layout knows how wide that quote is in the face the
 * line is set in.
 */
export function hangingPunctuation(): Extension {
  return [hangs, measuring]
}
