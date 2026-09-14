// Where a tagged REGION is drawn: a coloured spine in the left band, beside the
// text instead of under it.
//
// **A rule under the words is a word-scale device.** It says *these words*, and
// for a phrase it is exactly right. A subject stretched over three paragraphs
// says *this territory*, and the same notation at that scale puts an underline
// on every line of the section — reported from use as visually jarring. What
// makes it worse is the underline's own virtue: overlapping subjects stack, so
// three subjects are three rules under every line rather than one. The spine
// says the same thing running the direction the region actually runs.
//
// **The lanes are that argument rotated, not a new one.** Overlapping subjects
// become parallel spines rather than one blended colour, so `stack()` serves
// both drawings unchanged — three subjects are three lanes, where three tints
// would multiply into a fourth colour meaning nothing.
//
// **Silent until asked** (D44), like the mark it stands beside: a coloured rule
// and no text, so a tagged passage reads as prose rather than prose with
// metadata stapled to it. The subject is in the tooltip and in the panel.
//
// Clicking one dispatches the very event the mark widget dispatches, which is
// not a shortcut but the point. For a region taller than the window, the
// one-character mark at its start is usually off screen — so the panel it opens,
// the only place a tag can be renamed or removed, was in practice unreachable
// for exactly the wide tags hardest to select by hand. A spine is reachable
// anywhere along its length.

import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { DocumentWindow } from '../../../../../shared/document-api.ts'
import { DESKTOP, place } from '../../../../../shared/presentation.ts'
import { stack } from '../../../../../shared/tags.ts'
import { retag } from './tags.ts'

/** One lane of one region, in scroller coordinates. */
interface Spine {
  /** The tag's real start, which is what the panel is opened about. */
  readonly at: number
  readonly name: string
  readonly slot: number
  readonly depth: number
  readonly top: number
  readonly height: number
}

export function tagSpines(docWindow: DocumentWindow, host: HTMLElement): Extension {
  const regions = (length: number): { from: number; to: number; name: string }[] => {
    const out: { from: number; to: number; name: string }[] = []
    for (const item of place(docWindow.prose, DESKTOP)) {
      if (item.annotation.kind !== 'tag' || item.slot !== 'spine') continue
      out.push({
        from: Math.max(0, Math.min(item.annotation.at.from as number, length)),
        to: Math.max(0, Math.min(item.annotation.at.to as number, length)),
        name: item.annotation.subject,
      })
    }
    return out
  }

  const measure = (view: EditorView): Spine[] => {
    const box = view.scrollDOM.getBoundingClientRect()
    const offset = view.scrollDOM.scrollTop - box.top
    const out: Spine[] = []
    for (const extent of stack(regions(view.state.doc.length))) {
      // **Line blocks, not character boxes.** `coordsAtPos` answers with the
      // box of the character at that position, which sits inside its line by
      // half the leading at each end — so the rule came out seven pixels short
      // top and bottom, floating inside the paragraphs instead of covering
      // them. A region is made of whole lines and this asks for whole lines.
      //
      // It also removes the need to clip to the viewport. `coordsAtPos` answers
      // null outside what CodeMirror has rendered — and a region is precisely
      // the thing that begins above the screen and ends below it — where the
      // height map has a position for everything, estimated out of view and
      // refined as the reader arrives. So the rule is drawn to its true extent
      // and the scroller clips it, rather than the rule stopping at the edge of
      // the screen and claiming the subject stops there too.
      const head = view.lineBlockAt(extent.from)
      const foot = view.lineBlockAt(extent.to)
      const height = foot.bottom - head.top
      if (height <= 0) continue
      out.push({
        at: extent.from,
        name: extent.name,
        slot: extent.slot,
        depth: extent.depth,
        top: head.top + view.documentTop + offset,
        height,
      })
    }
    return out
  }

  const paint = (view: EditorView, spines: readonly Spine[]): void => {
    // Rebuilt rather than reconciled. There are a handful of these, they move
    // whenever anything reflows, and a keyed diff here would be machinery
    // standing in for `replaceChildren`.
    const made = spines.map(spine => {
      const rule = document.createElement('button')
      rule.type = 'button'
      rule.className = 'tag-spine'
      rule.style.top = `${spine.top}px`
      rule.style.height = `${spine.height}px`
      rule.style.setProperty('--tag', `var(--tag-${spine.slot})`)
      rule.style.setProperty('--tag-lane', String(spine.depth))
      // The name is what it is for; it just is not printed down the page.
      rule.title = spine.name
      rule.setAttribute('aria-label', `Tagged ${spine.name}`)
      // **The mark's own event, on the mark's own trigger.** `mousedown` rather
      // than `click`, defended the same way, because the press would otherwise
      // reach the editor underneath and move the caret — the spine is furniture
      // beside the text, not a position in it.
      //
      // The position asked about is one before the span: a tag's range begins
      // one character after the mark that opens it (D44), and asking with the
      // mark's coordinate is what makes this open the very same panel rather
      // than a second one that would have to be kept in step with it.
      rule.addEventListener('mousedown', event => {
        event.preventDefault()
        event.stopPropagation()
        rule.dispatchEvent(new CustomEvent('tephra-handle', {
          bubbles: true,
          detail: { at: Math.max(0, spine.at - 1), box: rule.getBoundingClientRect() },
        }))
      })
      return rule
    })
    host.replaceChildren(...made)
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.draw(view)
      }

      update(update: ViewUpdate): void {
        // Geometry alone moves nothing in the document and moves every spine:
        // one line wrapping differently shifts everything below it. Same
        // reasoning as the comment rail, and the same three triggers plus the
        // effect for spans that change without the text changing.
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.geometryChanged ||
          update.transactions.some(t => t.effects.some(e => e.is(retag)))
        ) {
          this.draw(update.view)
        }
      }

      destroy(): void {
        host.replaceChildren()
      }

      /**
       * Measure in a measure pass, never during an update.
       *
       * `coordsAtPos` forces layout, and forcing layout from inside an update is
       * how an editor starts stuttering while you type.
       */
      draw(view: EditorView): void {
        view.requestMeasure({
          read: v => measure(v),
          write: (spines, v) => paint(v, spines),
        })
      }
    },
  )
}
