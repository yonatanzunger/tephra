// Where else the active row's places are, marked down the scroll track (D51).
//
// **This is what makes a SET legible rather than merely traversable.** The row
// says `3 of 7` and the steppers walk it, but neither tells you that four of
// them are clustered in one afternoon and the rest are months away. The track
// does, at a glance, and it is the same annotations the sidebar is listing —
// a third rendering of one value (D50), after the editor's decorations and the
// printer's apparatus.
//
// Positions come from the HEIGHT MAP, not from a ratio of offsets: a document
// with block widgets and wrapped lines has no linear relationship between
// character position and vertical position, and pretending otherwise puts the
// marks a screenful away from the text they stand for.

import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/** One place in the set: a RANGE, because most of them are. */
export interface TrackPlace {
  readonly from: number
  readonly to: number
}

export interface TrackMarks {
  readonly places: readonly TrackPlace[]
  /** Which of them was jumped to last, or -1. */
  readonly current: number
  /** Occurrences outside the loaded region, which cannot be drawn to scale. */
  readonly beyond: { readonly earlier: number; readonly later: number }
  /**
   * The tag palette slot this set is drawn in, or null for the accent.
   *
   * **The same slot the underline uses.** A subject is recognisably itself
   * wherever it appears (tags.ts): if the track drew it in the accent while the
   * text underlined it in green, the mark and the passage would not obviously
   * be about the same thing.
   */
  readonly slot: number | null
}

const NOTHING: TrackMarks = { places: [], current: -1, beyond: { earlier: 0, later: 0 }, slot: null }

export const setTrackMarks = StateEffect.define<TrackMarks>()

const marks = StateField.define<TrackMarks>({
  create: () => NOTHING,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setTrackMarks)) return effect.value
    // Positions are buffer positions, so an edit moves them exactly as it moves
    // everything else. Mapping rather than dropping keeps the marks correct
    // while someone types in the middle of a marked passage.
    if (!tr.docChanged || value.places.length === 0) return value
    return {
      ...value,
      places: value.places.map(at => ({
        from: tr.changes.mapPos(at.from),
        to: tr.changes.mapPos(at.to),
      })),
    }
  },
})

export function scrollTrack(): Extension {
  return [
    marks,
    ViewPlugin.fromClass(
      class {
        readonly layer: HTMLElement

        constructor(view: EditorView) {
          this.layer = document.createElement('div')
          this.layer.className = 'tx-track'
          this.layer.setAttribute('aria-hidden', 'true')
          view.dom.appendChild(this.layer)
          this.draw(view)
        }

        update(update: ViewUpdate): void {
          const changed =
            update.docChanged ||
            update.geometryChanged ||
            update.transactions.some(tr => tr.effects.some(e => e.is(setTrackMarks)))
          if (changed) this.draw(update.view)
        }

        draw(view: EditorView): void {
          const state = view.state.field(marks)
          const height = view.contentHeight
          this.layer.replaceChildren()
          if (height <= 0) return

          const clamp = (at: number): number => Math.max(0, Math.min(at, view.state.doc.length))
          const colour = state.slot === null ? 'var(--accent)' : `var(--tag-${state.slot})`

          state.places.forEach((place, i) => {
            // **Proportional to the passage, not a tick.** A tagged range that
            // runs for two pages and one that covers three words are different
            // facts about the document, and a row of identical dashes says they
            // are the same. The minimum keeps a three-word range visible.
            const top = view.lineBlockAt(clamp(place.from)).top
            const bottom = view.lineBlockAt(clamp(place.to)).bottom
            const mark = document.createElement('div')
            mark.className = i === state.current ? 'tx-track-mark current' : 'tx-track-mark'
            mark.style.top = `${((top / height) * 100).toFixed(3)}%`
            mark.style.height = `max(3px, ${(((bottom - top) / height) * 100).toFixed(3)}%)`
            mark.style.setProperty('--track', colour)
            this.layer.appendChild(mark)
          })

          // **Off-window occurrences get an edge mark, not a guess.** They are
          // real and they are not on this page; drawing them at the top or
          // bottom says so without claiming a position the window cannot know.
          for (const [side, count] of [
            ['earlier', state.beyond.earlier],
            ['later', state.beyond.later],
          ] as const) {
            if (count === 0) continue
            const edge = document.createElement('div')
            edge.className = `tx-track-beyond ${side}`
            edge.textContent = String(count)
            this.layer.appendChild(edge)
          }
        }

        destroy(): void {
          this.layer.remove()
        }
      },
    ),
  ]
}
