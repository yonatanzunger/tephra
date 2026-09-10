// Where the matches are, drawn in the text (MS3).
//
// **The selection is not enough, and this is why.** A find lands, and the caret
// goes back to the field so the next keystroke is another search — which leaves
// CodeMirror's selection *unfocused*, drawn in whatever pale colour an inactive
// selection gets, and on a cream page that is very close to nothing at all. The
// first version of the walk relied on it, and the answer to *which words did it
// find* was "you cannot tell".
//
// So the match is decorated rather than selected: it stays exactly as visible
// while the caret is somewhere else, which is the whole time.
//
// **And the others are drawn too, quietly.** One mark says where you are; the
// rest say what else is on this screen, which is the difference between stepping
// blind and reading a page that has the answer on it twice.

import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

export interface FindMark {
  readonly from: number
  readonly to: number
}

export interface FindMarks {
  readonly places: readonly FindMark[]
  /** Which one the walk is standing on, or -1 while nothing has been landed on. */
  readonly current: number
}

export const NO_FIND_MARKS: FindMarks = { places: [], current: -1 }

export const setFindMarks = StateEffect.define<FindMarks>()

const other = Decoration.mark({ class: 'cm-find' })
const here = Decoration.mark({ class: 'cm-find cm-find-now' })

const build = (marks: FindMarks, length: number): DecorationSet =>
  Decoration.set(
    marks.places
      .filter(place => place.from >= 0 && place.to <= length && place.from < place.to)
      .map((place, at) => (at === marks.current ? here : other).range(place.from, place.to)),
    true,
  )

const field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFindMarks)) return build(effect.value, tr.state.doc.length)
    }
    // **Mapped through the change, not dropped.** Typing while the bar is up is
    // ordinary — you found a passage and are now editing near it — and marks
    // that vanished on the first keystroke would read as the find having failed.
    return set.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

export const findMarks: Extension = field
