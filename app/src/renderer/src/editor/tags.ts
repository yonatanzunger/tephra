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
import { stack } from '../../../shared/tags.ts'

/** Dispatched when the spans may have changed without the text changing. */
export const retag = StateEffect.define<null>()

export function tagExtents(docWindow: DocumentWindow): Extension {
  const build = (view: EditorView): DecorationSet => {
    const length = view.state.doc.length
    const spans: { from: number; to: number; name: string }[] = []
    for (const span of docWindow.spans('tag')) {
      const from = docWindow.toWindow(span.span.begin)
      const to = docWindow.toWindow(span.span.end)
      if (from === null || to === null) continue
      spans.push({
        from: Math.max(0, Math.min(from as number, length)),
        to: Math.max(0, Math.min(to as number, length)),
        name: span.name,
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
