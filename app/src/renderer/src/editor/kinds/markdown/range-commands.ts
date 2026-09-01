// The renderer's half of the range gesture.
//
// Main owns the menus and therefore owns *how* a command is reached — menu bar,
// accelerator, or context menu, all three built from `RANGE_COMMANDS`. This owns
// the two things only the renderer knows: what the caret is doing, and what the
// selection actually is once a command arrives.
//
// The split matters because a greyed-out menu item is a claim about the caret,
// and the caret lives here.

import { EditorView } from '@codemirror/view'
import type { TrackMarks } from './scroll-track.ts'
import type { Extension } from '@codemirror/state'
import { NO_SELECTION, type SelectionState } from '../../../../../shared/commands.ts'
import type { WindowPosition, DocumentWindow, Span } from '../../../../../shared/document-api.ts'
import type { MarkInfo } from '../../annotations.ts'
import type { SurfaceHandle } from '../../surface.ts'

/**
 * Report the caret to main whenever it changes, so menu items enable and grey
 * correctly.
 *
 * Deduplicated on the boolean pair rather than on the selection itself: the
 * caret moves on every keystroke and only two bits of it matter here. Sending
 * an IPC message per keypress to change nothing would put avoidable traffic on
 * the typing path, which R1.1 is explicit about.
 */
export function reportSelection(): Extension {
  let last: SelectionState = NO_SELECTION
  return EditorView.updateListener.of(update => {
    if (!update.selectionSet && !update.docChanged && !update.focusChanged) return
    const main = update.state.selection.main
    const now: SelectionState = { hasPoint: update.view.hasFocus, hasRange: !main.empty }
    if (now.hasPoint === last.hasPoint && now.hasRange === last.hasRange) return
    last = now
    window.tephra.doc.selectionChanged(now)
  })
}

/** Right-click anywhere in the editor raises the same commands as the menu bar. */
export function contextMenu(): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event) {
      event.preventDefault()
      window.tephra.doc.contextMenu()
      return true
    },
  })
}

/**
 * The selection as a document span — the form every range operation takes.
 *
 * Document coordinates, never buffer offsets: a buffer offset means nothing the
 * moment the window reloads, and everything these commands write is durable
 * (D11).
 */
export function selectedSpan(view: EditorView, docWindow: DocumentWindow): Span {
  const main = view.state.selection.main
  return {
    begin: docWindow.toDocument(main.from as WindowPosition),
    end: docWindow.toDocument(main.to as WindowPosition),
  }
}

/** What a range command needs to know at the moment it is invoked. */
export interface Selection {
  readonly span: Span
  readonly empty: boolean
  /** Subjects already covering any part of it — what "Remove Tag…" offers. */
  readonly subjects: readonly string[]
  /**
   * The selection widened to whole lines.
   *
   * **Printing needs this and nothing else does.** A markdown renderer reads
   * block structure off the beginning of a line — `##` makes a heading, `-` an
   * item, `>` a quotation, `|` a table row — and those marks are concealed and
   * atomic in the editor, so a selection that starts at the first visible
   * character of a heading starts AFTER its hashes. Printed, it arrived as an
   * ordinary paragraph. Half a line of markdown is not a smaller piece of the
   * document; it is a different document.
   *
   * Tagging and branching deliberately do NOT use this: those apply to exactly
   * the words chosen, and widening them would be wrong.
   */
  readonly lines: string
}

/**
 * Read the selection when a command actually arrives, rather than tracking it.
 *
 * The caret moves on every keystroke; a command happens a few times an hour.
 * Recomputing spans and subjects on each cursor motion to have them ready would
 * put work on the typing path for something almost never asked for — which is
 * the same reasoning that keeps `reportSelection` down to two booleans.
 */
export function readSelection(view: EditorView, docWindow: DocumentWindow): Selection {
  const main = view.state.selection.main
  const whole = docWindow.snap(main.from as WindowPosition, main.to as WindowPosition)
  const subjects: string[] = []
  for (const span of docWindow.spans('tag')) {
    const from = docWindow.toWindow(span.span.begin)
    const to = docWindow.toWindow(span.span.end)
    if (from === null || to === null) continue
    // Overlap, not containment: a selection half inside a tagged passage is
    // still a selection someone may want that tag taken off.
    if ((from as number) < main.to && (to as number) > main.from && !subjects.includes(span.name)) {
      subjects.push(span.name)
    }
  }
  return {
    span: selectedSpan(view, docWindow),
    empty: main.empty,
    subjects,
    lines: view.state.sliceDoc(whole.from as number, whole.to as number),
  }
}


/**
 * What the mark at this buffer position stands for.
 *
 * The identification is a coordinate question, and so it is asked in
 * coordinates: a bookmark's span is zero-length AT the marker, and a tag's span
 * begins one prose character after it — the character the mark itself occupies
 * (D44). Nothing here re-derives anything from the text.
 */
export function markAt(docWindow: DocumentWindow, at: number, box: DOMRect): MarkInfo {
  const anchor =
    docWindow.spans('anchor').find(s => (docWindow.toWindow(s.span.begin) as number | null) === at) ?? null

  const opens: { name: string; span: Span }[] = []
  const covers: { name: string; span: Span }[] = []
  for (const span of docWindow.spans('tag')) {
    const from = docWindow.toWindow(span.span.begin) as number | null
    const to = docWindow.toWindow(span.span.end) as number | null
    if (from === null || to === null) continue
    if (from === at + 1) opens.push({ name: span.name, span: span.span })
    else if (from <= at && to >= at) covers.push({ name: span.name, span: span.span })
  }

  return { box, anchor: anchor === null ? null : anchor.name, tags: [...opens, ...covers] }
}

/**
 * What the app can ask of a live editor.
 *
 * The caret lives here and the commands arrive from the menu, which is in main
 * — so the app holds this rather than the view itself, and asks in terms of the
 * selection rather than in terms of CodeMirror.
 */
export interface EditorHandle extends SurfaceHandle {
  selection(): Selection
  /**
   * Put text around the selection, as ordinary typing would.
   *
   * Ordinary on purpose: it goes through the same path a keystroke does, so the
   * window maps it, the marker rules apply, and it is one undo step — none of
   * which a bespoke document operation would get for free.
   */
  wrapSelection(before: string, after: string): void
  /**
   * Put emphasis on, or take it off again.
   *
   * A toggle, because the second press of ⌘B is someone changing their mind and
   * `****` reads as broken. From a bare caret it opens the pair and waits
   * inside — which is how a person types a bold word they have not written yet,
   * and why emphasis is the one command that needs no selection.
   */
  toggleEmphasis(marker: string): void
  /**
   * Put the caret at a place in the buffer and show it.
   *
   * **Centred, not merely scrolled to.** A jump that lands on the last visible
   * line is technically a success and reads as a failure: the sentence you were
   * sent to is at the edge of the screen with nothing after it. Centring is
   * also what `scrollIntoView` can do across regions that have not been
   * rendered, which a jump across a month always is.
   */
  revealAt(at: number): void
  /**
   * Mark a set of places down the scroll track.
   *
   * The sidebar owns the SET — which row is active, and where its occurrences
   * are in the corpus — and the editor owns the geometry, because only it knows
   * where a buffer position sits on the page. So the marks arrive already in
   * buffer coordinates and the editor decides where that is (D51).
   */
  showTrackMarks(marks: TrackMarks): void
}

/**
 * The handle, if what is showing is text.
 *
 * **A check rather than a cast.** The range commands — tag, mark, link, comment
 * — are all "do something with the selection", which is a question only a text
 * surface can answer. When the thing on screen is a list or a canvas, the honest
 * result is null, and the menu items grey out because there genuinely is no
 * selection to act on (D54).
 */
export function asEditorHandle(handle: SurfaceHandle | null): EditorHandle | null {
  return handle !== null && 'wrapSelection' in handle ? (handle as EditorHandle) : null
}
