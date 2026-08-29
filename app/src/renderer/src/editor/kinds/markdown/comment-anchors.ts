// Where each comment's anchor sits on screen, and how a commented range looks.
//
// The rail lives in React and the geometry lives in CodeMirror, so this is the
// seam: the editor reports a top for every visible thread, and the rail places
// its notes there. Nothing here knows what a comment SAYS — that comes from X,
// through the bridge, because a decoration does not want a message list.

import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state'
import type { DocumentWindow } from '../../../../../shared/document-api.ts'
import { DESKTOP, place } from '../../../../../shared/presentation.ts'
import type { CommentAnchor } from '../../annotations.ts'

/** Dispatched when the spans may have changed without the text changing (D45). */
export const recomment = StateEffect.define<null>()


/**
 * The rule under a commented range, and the anchor positions the rail needs.
 *
 * Dotted rather than solid, and in the theme's muted colour rather than a
 * subject's: **a comment is not a subject.** Tags say what a passage is about
 * and earn a hue apiece; a comment says someone had something to say, and every
 * comment is the same kind of thing.
 */
export function commentExtents(
  docWindow: DocumentWindow,
  sink: (anchors: readonly CommentAnchor[]) => void,
): Extension {
  const build = (view: EditorView): DecorationSet => {
    const length = view.state.doc.length
    const builder = new RangeSetBuilder<Decoration>()
    for (const span of spansOf(docWindow, view)) {
      if (span.to <= span.from || span.from > length) continue
      builder.add(
        span.from,
        Math.min(span.to, length),
        Decoration.mark({ class: span.resolved ? 'tx-commented tx-resolved' : 'tx-commented' }),
      )
    }
    return builder.finish()
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
        this.report(view)
      }

      update(update: ViewUpdate): void {
        const changed =
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some(t => t.effects.some(e => e.is(recomment)))
        if (changed) this.decorations = build(update.view)
        // Geometry alone moves nothing in the document and moves everything in
        // the rail: a line wrapping differently puts every note below it
        // somewhere new.
        if (changed || update.geometryChanged) this.report(update.view)
      }

      /**
       * Read positions in a measure pass, never during an update.
       *
       * `coordsAtPos` forces layout, and forcing layout from inside an update
       * is how an editor starts stuttering while you type.
       */
      report(view: EditorView): void {
        view.requestMeasure({
          read: v => {
            const box = v.scrollDOM.getBoundingClientRect()
            const out: CommentAnchor[] = []
            for (const span of spansOf(docWindow, v)) {
              const coords = v.coordsAtPos(Math.min(span.from, v.state.doc.length))
              if (coords === null) continue
              out.push({
                id: span.id,
                top: coords.top - box.top + v.scrollDOM.scrollTop,
                resolved: span.resolved,
              })
            }
            return out
          },
          write: anchors => sink(anchors),
        })
      }
    },
    { decorations: v => v.decorations },
  )
}

interface Anchored {
  id: string
  from: number
  to: number
  resolved: boolean
}

function spansOf(docWindow: DocumentWindow, view: EditorView): Anchored[] {
  const out: Anchored[] = []
  for (const item of place(docWindow.prose, DESKTOP)) {
    if (item.annotation.kind !== 'comment' || item.slot !== 'margin') continue
    out.push({
      id: item.annotation.thread.id as string,
      // The handle is one character before the range it opens; the note points
      // at the mark, which is what a reader sees.
      from: Math.max(0, (item.annotation.at.from as number) - 1),
      to: item.annotation.at.to as number,
      resolved: item.annotation.thread.resolved,
    })
  }
  return out
}
