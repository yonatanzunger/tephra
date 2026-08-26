// What a tagged range looks like: thin coloured rules under the text.
//
// **Underlines rather than a tint**, for two reasons that turned out to be the
// same one. Overlapping subjects compose honestly — three subjects are three
// stacked rules, where three tints multiply into a fourth colour that means
// nothing — and a rule does not have to stay legible BEHIND text, so it can be
// properly saturated and subjects can actually be told apart. A tint has to
// wash out until it is nearly the page, which is exactly when it stops
// distinguishing anything.
//
// The spans come from X, which scans fence-aware and knows about pairing. The
// renderer does not re-derive them from the text; it draws what it is told.

import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state'
import type { DocumentWindow } from '../../../shared/document-api.ts'
import { DESKTOP, place } from '../../../shared/presentation.ts'
import { stack } from '../../../shared/tags.ts'

/** Dispatched when the spans may have changed without the text changing. */
export const retag = StateEffect.define<null>()

export function tagExtents(docWindow: DocumentWindow): Extension {
  const build = (view: EditorView): DecorationSet => {
    const length = view.state.doc.length
    // The policy decides whether tags are drawn at all, and where (D50). The
    // ranges arrive in the buffer's own coordinates, so there is no conversion
    // here to get wrong — which is what four separate ones used to be for.
    const spans: { from: number; to: number; name: string }[] = []
    for (const item of place(docWindow.prose, DESKTOP)) {
      if (item.annotation.kind !== 'tag' || item.slot !== 'flow') continue
      spans.push({
        from: Math.max(0, Math.min(item.annotation.at.from as number, length)),
        to: Math.max(0, Math.min(item.annotation.at.to as number, length)),
        name: item.annotation.subject,
      })
    }

    const builder = new RangeSetBuilder<Decoration>()
    for (const extent of [...stack(spans)].sort((a, b) => a.from - b.from || a.depth - b.depth)) {
      builder.add(
        extent.from,
        extent.to,
        Decoration.mark({
          class: 'tx-tag',
          attributes: { style: `--tag: var(--tag-${extent.slot}); --tag-depth: ${extent.depth}` },
        }),
      )
    }
    return builder.finish()
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(update: ViewUpdate): void {
        // Spans can change without the text changing — an external edit, an
        // undo landing elsewhere — so the effect exists as well as the usual
        // triggers.
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some(t => t.effects.some(e => e.is(retag)))
        ) {
          this.decorations = build(update.view)
        }
      }
    },
    { decorations: v => v.decorations },
  )
}
