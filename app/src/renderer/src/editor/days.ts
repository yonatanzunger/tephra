// Where one day ends and the next begins.
//
// The stream is one continuous document (D8) and that is the point — but a
// document with no seams is also a document with no dates in it, and a reader
// scrolling back through a week cannot tell Tuesday's thought from Wednesday's.
// The seam is drawn rather than removed: a rule, with the day above and the day
// below named on either side of it.
//
// **The two dates are not necessarily consecutive.** Days with nothing in them
// have no file, so the gap between 21 and 24 August is a real gap and naming
// both sides is what makes it visible.

import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import type { DateKey, DocumentWindow } from '../../../shared/document-api.ts'
import { DESKTOP, place } from '../../../shared/presentation.ts'

/** Dispatched when the loaded days may have changed — growth, or a jump. */
export const redays = StateEffect.define<null>()

export function dayBoundaries(docWindow: DocumentWindow): Extension {
  const build = (state: { doc: { lineAt(at: number): { from: number }; length: number } }): DecorationSet => {
    const found: { at: number; to: number; date: DateKey }[] = []
    for (const item of place(docWindow.prose, DESKTOP)) {
      if (item.annotation.kind !== 'date' || item.slot === 'none') continue
      found.push({
        at: item.annotation.at.from as number,
        to: item.annotation.at.to as number,
        date: item.annotation.date as DateKey,
      })
    }

    // **A day with nothing in it is not a seam.** Files of pure frontmatter can
    // still be in a corpus written before they stopped being created, and two
    // rules with no text between them say nothing except that something is
    // wrong. The LAST day is kept whatever it holds: an empty today is where
    // you are about to write, and the seam above it is what says so.
    const days = found.filter((day, i) => {
      if (i === found.length - 1) return true
      return docWindow.text.slice(day.at, day.to).trim() !== ''
    })

    const builder = new RangeSetBuilder<Decoration>()
    for (let i = 1; i < days.length; i++) {
      const day = days[i] as { at: number; date: DateKey }
      const previous = days[i - 1] as { at: number; date: DateKey }
      if (day.at > state.doc.length) continue
      // A block widget has to sit on a line boundary. A day whose text does not
      // end in a newline would put this mid-line, where CodeMirror is entitled
      // to refuse it — skip rather than argue.
      if (state.doc.lineAt(day.at).from !== day.at) continue
      builder.add(
        day.at,
        day.at,
        Decoration.widget({ widget: new DayBreak(previous.date, day.date), block: true, side: -1 }),
      )
    }
    return builder.finish()
  }

  return StateField.define<DecorationSet>({
    create: state => build(state),
    update(value, transaction) {
      // Rebuilt when the days may have changed, mapped through anything else.
      // Growth prepends a whole day at offset zero, so every boundary below it
      // moves — and mapping handles that without asking the window again.
      if (transaction.effects.some(e => e.is(redays))) return build(transaction.state)
      return transaction.docChanged ? build(transaction.state) : value
    },
    provide: field => EditorView.decorations.from(field),
  })
}

class DayBreak extends WidgetType {
  readonly #before: DateKey
  readonly #after: DateKey

  constructor(before: DateKey, after: DateKey) {
    super()
    this.#before = before
    this.#after = after
  }

  override eq(other: DayBreak): boolean {
    return other.#before === this.#before && other.#after === this.#after
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'tx-daybreak'
    el.setAttribute('aria-label', `${this.#before} to ${this.#after}`)

    // The year appears only when the two sides disagree about it, which is the
    // one time it carries information.
    const sameYear = this.#before.slice(0, 4) === this.#after.slice(0, 4)
    // Both dates on the LEFT, one above the rule and one below, rather than
    // flanking it. Flanking read as a range — as though the seam covered the
    // span between two dates — when what it marks is a boundary: this day ends,
    // that one begins. Stacked, the rule is literally between them.
    el.append(
      label(this.#before, sameYear),
      Object.assign(document.createElement('span'), { className: 'tx-daybreak-rule' }),
      label(this.#after, sameYear),
    )
    return el
  }

  /** It is not text; the caret should not be able to land in it. */
  override ignoreEvent(): boolean {
    return true
  }
}

function label(date: DateKey, sameYear: boolean): HTMLElement {
  const el = document.createElement('time')
  el.className = 'tx-daybreak-date'
  el.dateTime = date
  el.textContent = readable(date, sameYear)
  return el
}

/**
 * A date a person would say out loud.
 *
 * The weekday is worth its width in a journal: "what did I do on Sunday" is a
 * question people actually ask, and a bare number does not answer it.
 */
function readable(date: DateKey, sameYear: boolean): string {
  const at = new Date(`${date}T00:00:00`)
  if (Number.isNaN(at.getTime())) return date
  const parts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
  if (!sameYear) parts.year = 'numeric'
  return at.toLocaleDateString([], parts)
}
