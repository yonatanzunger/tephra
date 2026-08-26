// Binding a CodeMirror view to a DocumentWindow.
//
// The two directions are NOT symmetric, and the asymmetry is the whole of what
// keeps text from duplicating:
//
//   editor → window   every user transaction becomes window.edit(), fired and
//                     not awaited, because the editor has already painted it
//   window → editor   only changes the window did NOT originate arrive, and
//                     they are dispatched with a marker so they do not bounce
//                     straight back as a new edit
//
// THE EDITOR'S OWN HISTORY IS DISABLED. Undo is document-scoped (D23, D32) and
// may land outside the loaded region; two histories over one text diverge.

import { ChangeSet, EditorSelection, EditorState, StateEffect, Transaction, type Extension } from '@codemirror/state'
import { EditorView, crosshairCursor, drawSelection, keymap, placeholder, rectangularSelection } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { vim } from '@replit/codemirror-vim'
import { listIndent } from './lists.ts'
import type { WindowEdit, WindowPosition, DocumentPosition, DocumentWindow, EditOrigin } from '../../../shared/document-api.ts'
import { fromBuffer } from '../../../shared/prose.ts'
import { widgetExtensions } from './widgets.ts'
import { contextMenu, markAt, readSelection, reportSelection, type MarkInfo, type Selection } from './range-commands.ts'
import { retag, tagExtents } from './tags.ts'
import { commentExtents, recomment, type CommentAnchor } from './comment-anchors.ts'
import { richPaste } from './paste.ts'
import { dayBoundaries, redays } from './days.ts'
import { proseHighlight, tephraTheme, typographyCompartment, defaultTypography, type Typography } from './theme.ts'
import { Compartment } from '@codemirror/state'

/** Marks a transaction as coming FROM the document, so it is not sent back. */
const fromDocument = StateEffect.define<null>()

export const vimCompartment = new Compartment()

export interface BindOptions {
  readonly parent: HTMLElement
  readonly window: DocumentWindow
  readonly vim: boolean
  readonly typography?: Typography
  /** Reported upward so the Pane can own extent policy (D35). */
  readonly onViewport?: (visible: { from: WindowPosition; to: WindowPosition }) => void
  /** Where the caret is, in document space, so it can outlive the session. */
  readonly onCursor?: (at: DocumentPosition) => void
  readonly onError?: (err: Error) => void
  /** A mark was clicked: here is what it stands for and where it sits. */
  readonly onMark?: (mark: MarkInfo) => void
  /** Where each visible thread's anchor sits, so the margin can align to it. */
  readonly onCommentAnchors?: (anchors: readonly CommentAnchor[]) => void
  /** The element the margin renders into, or null when this editor goes away. */
  readonly onRailHost?: (host: HTMLElement | null) => void
}

export interface Binding {
  readonly view: EditorView
  /** The selection right now, in document terms. See `readSelection`. */
  selection(): Selection
  /** Put text around the selection, as ordinary typing would. */
  wrapSelection(before: string, after: string): void
  setVim(on: boolean): void
  setTypography(t: Typography): void
  destroy(): void
}

export function bindEditor(options: BindOptions): Binding {
  const { window: docWindow } = options
  const typography = options.typography ?? defaultTypography

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: docWindow.text,
      extensions: [
        // The caret is reported upward so menu items grey correctly, and a
        // right-click raises the same commands the menu bar shows.
        reportSelection(),
        contextMenu(),
        richPaste(),
        // A day with nothing in it yet is the ordinary case first thing in the
        // morning, and with no gutter, no caret cue and no chrome it renders as
        // a blank rectangle — indistinguishable from the app having failed.
        placeholder('Nothing here yet. Start typing.'),
        listIndent(),
        vimCompartment.of(vimExtensions(options.vim)),
        // NO history() — see the header. Undo is document.undo().
        markdown(),
        syntaxHighlighting(proseHighlight, { fallback: true }),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        widgetExtensions(),
        tagExtents(docWindow),
        dayBoundaries(docWindow),
        commentExtents(docWindow, anchors => options.onCommentAnchors?.(anchors)),
        keymap.of([...defaultKeymap, ...searchKeymap]),
        typographyCompartment.of(tephraTheme(typography)),
        editorToWindow(docWindow, options.onError),
        viewportReporter(options.onViewport),
        cursorReporter(docWindow, options.onCursor),
      ] as Extension[],
    }),
  })

  // Where to land: **the append position, always.**
  //
  // The stream is oldest-first and appended to (Q7), so opening Tephra should
  // put the caret where the next sentence goes and the window should show what
  // came before it — you are continuing, not arriving somewhere. Scrolled to
  // the END rather than centred, so the blank space is below the caret and
  // yesterday is above it; the region grows backwards behind the reader, which
  // fills that space in with where they left off.
  //
  // **This used to prefer the position the last session left.** It was the
  // wrong default for a stream: it opens you in the middle of something you
  // have already finished reading, and the first keystroke lands wherever the
  // caret happened to be rather than at the end of today. The cursor is still
  // recorded — it is a true fact about the session, and navigation may want it
  // — it simply no longer decides where the app opens.
  const landing = docWindow.text.length as WindowPosition
  view.dispatch({
    selection: { anchor: landing as number },
  })
  scrollToAppendPosition(view)

  const unsubscribeChanged = docWindow.onChanged((edits, origin) => {
    applyFromDocument(view, edits, origin)
    // Growth prepends a whole day, which is a change to WHICH days are loaded
    // and not only to the text.
    if (origin === 'external') view.dispatch({ effects: redays.of(null) })
  })
  // Redrawing the extents is its own subscription, because spans change on
  // edits this editor MADE — where `onChanged` is deliberately silent — as well
  // as on edits from elsewhere. Deleting a tag's mark is exactly that case: the
  // buffer loses one character locally, and the tag it stood for goes away in
  // the answer that comes back a moment later.
  // The rail's home. Inside `.cm-scroller`, so notes scroll with the text and
  // nothing has to recompute their positions as the reader moves.
  const railHost = document.createElement('div')
  railHost.className = 'rail-host'
  view.scrollDOM.append(railHost)
  options.onRailHost?.(railHost)

  // A mark was clicked. The widget knows where it is; only the window knows
  // what it stands for.
  const onHandle = (event: Event): void => {
    const detail = (event as CustomEvent<{ at: number; box: DOMRect }>).detail
    options.onMark?.(markAt(docWindow, detail.at, detail.box))
  }
  view.dom.addEventListener('tephra-handle', onHandle)

  const unsubscribeSpans = docWindow.onSpansChanged(() => {
    view.dispatch({ effects: [retag.of(null), recomment.of(null), redays.of(null)] })
  })
  const unsubscribeReset = docWindow.onReset(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: docWindow.text },
      effects: fromDocument.of(null),
    })
  })

  return {
    view,
    selection(): Selection {
      return readSelection(view, docWindow)
    },
    wrapSelection(before: string, after: string): void {
      view.dispatch(
        view.state.changeByRange(r => ({
          changes: [
            { from: r.from, insert: before },
            { from: r.to, insert: after },
          ],
          // Leave the words selected, so a second thought about the URL does not
          // begin with finding them again.
          range: EditorSelection.range(r.from + before.length, r.to + before.length),
        })),
        { userEvent: 'input' },
      )
      view.focus()
    },
    setVim(on: boolean): void {
      view.dispatch({ effects: vimCompartment.reconfigure(vimExtensions(on)) })
      view.focus()
    },
    setTypography(t: Typography): void {
      view.dispatch({ effects: typographyCompartment.reconfigure(tephraTheme(t)) })
    },
    destroy(): void {
      options.onRailHost?.(null)
      railHost.remove()
      view.dom.removeEventListener('tephra-handle', onHandle)
      unsubscribeChanged()
      unsubscribeSpans()
      unsubscribeReset()
      view.destroy()
    },
  }
}

/**
 * Vim, and the drawn selection layer it needs.
 *
 * These travel together on purpose. CodeMirror can render selection two ways:
 * the browser's native selection, or its own drawn layer. Vim needs the drawn
 * one, because a block cursor is not something a native caret can be. But Spike
 * A measured the drawn caret at about a millisecond more than the native one —
 * small, consistent, and on the typing path — so with vim off there is no
 * reason to pay it.
 *
 * The cost of the split is that selection has to be styled twice, once for each
 * mechanism. That is in the theme, and it is the whole of the cost.
 */
function vimExtensions(on: boolean): Extension {
  return on ? [vim({ status: true }), drawSelection(), rectangularSelection(), crosshairCursor()] : []
}

/** Every user transaction becomes a window edit. Fired, never awaited. */
function editorToWindow(
  docWindow: DocumentWindow,
  onError: ((err: Error) => void) | undefined,
): Extension {
  return EditorView.updateListener.of(update => {
    if (!update.docChanged) return

    for (const tr of update.transactions) {
      if (tr.effects.some(e => e.is(fromDocument))) continue // came from the document
      if (tr.changes.empty) continue

      const edits: WindowEdit[] = []
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        edits.push({
          from: fromA as WindowPosition,
          to: toA as WindowPosition,
          insert: fromBuffer(inserted.toString()),
        })
      })
      if (edits.length === 0) continue

      const origin: EditOrigin = tr.isUserEvent('input') || tr.isUserEvent('delete') ? 'user' : 'operation'

      // Not awaited: the editor has painted this already and R1.1 does not
      // permit a round trip on the typing path. A rejection is a real failure —
      // disk full, permissions, a desynchronised window — and must surface.
      void docWindow.edit(edits, origin).catch((err: unknown) => {
        onError?.(err instanceof Error ? err : new Error(String(err)))
      })
    }
  })
}

/**
 * Apply a change the document made, without sending it back.
 *
 * The selection is mapped with association AFTER, which matters for exactly one
 * case and matters a lot there: extending the window earlier is an insertion at
 * offset zero, and a cursor sitting at offset zero is the ordinary state right
 * after opening. CodeMirror's default keeps such a cursor at zero, so the
 * prepended day slides in underneath it and the caret ends up at the TOP of the
 * oldest loaded day — where the next thing typed lands in the wrong file. With
 * 'after' the caret travels with the text it was attached to, which is where
 * the person left it.
 */
/**
 * Put the append position where it is comfortable to write.
 *
 * **Asked of CodeMirror rather than computed here**, which is the fifth attempt
 * and the reason the previous four are worth listing:
 *
 *   - `scrollIntoView(end, 'end')` aligns the last line with the bottom EDGE,
 *     leaving the caret jammed against it with nowhere to type into.
 *   - scrolling to `scrollHeight` uses the 60vh of bottom padding well on a long
 *     day and scrolls a SHORT one clean off the top: the padding is taller than
 *     the text, so "the bottom of the document" is below everything in it.
 *   - measuring the caret and placing it a third down fixed both — **as long as
 *     the caret was rendered.** `coordsAtPos` returns null outside the rendered
 *     range, and after growth prepends thirty thousand characters the append
 *     position is nowhere near it. It returned null, this returned without
 *     scrolling, and the window sat in the middle of yesterday: viewport at
 *     28699 with the caret at 37460.
 *
 * `scrollIntoView` does that measurement internally, across regions that have
 * not been rendered, which is precisely the part that cannot be done from out
 * here. `center` rather than `end` because the padding is meant to be under the
 * caret rather than off the screen.
 */
function scrollToAppendPosition(view: EditorView): void {
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'center' }) })
}

/**
 * Apply a change that came from the document, keeping the reader where they are.
 *
 * **Text arriving ABOVE the viewport must not move what is on screen.** The
 * region grows backwards behind the reader (D40), so a day is prepended at
 * offset zero and everything below it shifts down by that day's height —
 * scrollTop stays the same number of pixels, so the view silently slides to the
 * top of whatever just arrived.
 *
 * That single omission produced both of the symptoms it was reported as. The app
 * appeared to open at the START of the stream, because the caret was placed at
 * the end and then a day was inserted above it. And scrolling down never
 * reached the bottom: each jump to the top made the viewport report itself as
 * near the beginning, `Pane.viewportChanged` read that as "the reader is
 * approaching the edge", and grew the region again — a loop that only stopped
 * when there were no earlier days left.
 *
 * Anchoring is the ordinary fix for upward-infinite-scroll, and `extend`'s own
 * comment already claimed it: applying growth as an insertion rather than a
 * reset is what lets the cursor and the scroll position survive. The cursor did;
 * the scroll position needed this.
 */
function applyFromDocument(view: EditorView, edits: readonly WindowEdit[], _origin: EditOrigin): void {
  if (edits.length === 0) return
  const changes = ChangeSet.of(
    edits.map(e => ({ from: e.from as number, to: e.to as number, insert: e.insert })),
    view.state.doc.length,
  )

  // Entirely above what is rendered? Then the reader should not feel it at all.
  const firstVisible = view.visibleRanges[0]?.from ?? 0
  const above = edits.every(edit => Math.max(edit.from as number, edit.to as number) <= firstVisible)
  const scroller = view.scrollDOM
  const topBefore = scroller.scrollTop
  const heightBefore = scroller.scrollHeight

  const head = view.state.selection.main.head

  // **Two different right answers, and which one applies depends on where the
  // reader is.** Someone reading history wants the page held still. Someone
  // sitting at the append position — which is where the app opens — wants to
  // stay there, at the bottom, watching earlier days fill in above. Preserving
  // the visual position does the first and gets the second wrong: at startup
  // the buffer is one short day, so "where you were" is the top of an almost
  // empty screen, and holding that leaves the caret stranded up there.
  //
  // The test is whether the caret is at the end AND on screen. If it is, this
  // is the append position and it stays pinned; if it is not, the reader has
  // gone somewhere and is not to be moved.
  const caret = view.coordsAtPos(head)
  const box = scroller.getBoundingClientRect()
  const pinned =
    head === view.state.doc.length &&
    caret !== null &&
    caret.bottom <= box.bottom + 1 &&
    caret.top >= box.top - 1
  const anchor = view.state.selection.main.anchor
  view.dispatch({
    changes,
    selection: { anchor: changes.mapPos(anchor, 1), head: changes.mapPos(head, 1) },
    effects: fromDocument.of(null),
    annotations: Transaction.addToHistory.of(false),
  })

  if (pinned) {
    scrollToAppendPosition(view)
    return
  }
  if (!above) return
  // Measured rather than computed: the inserted text's height depends on how it
  // wraps, which only layout knows.
  view.requestMeasure({
    read: () => scroller.scrollHeight - heightBefore,
    write: grew => {
      if (grew !== 0) scroller.scrollTop = topBefore + grew
    },
  })
}

/**
 * Report the caret in DOCUMENT space, which is the only form that outlives the
 * session — a buffer offset names different text in the next window.
 */
function cursorReporter(
  docWindow: DocumentWindow,
  onCursor: ((at: DocumentPosition) => void) | undefined,
): Extension {
  if (onCursor === undefined) return []
  return EditorView.updateListener.of(update => {
    if (!update.selectionSet && !update.docChanged) return
    onCursor(docWindow.toDocument(update.state.selection.main.head as WindowPosition))
  })
}

/**
 * The editor reports a fact; the Pane owns the policy (D35). Reporting upward
 * keeps the dependency pointing from Z's view to Z's view-model, and it is also
 * how ScreenMetric stays calibrated — `to - from` is a screenful in characters.
 */
function viewportReporter(
  onViewport: ((visible: { from: WindowPosition; to: WindowPosition }) => void) | undefined,
): Extension {
  if (onViewport === undefined) return []
  return EditorView.updateListener.of(update => {
    if (!update.viewportChanged && !update.geometryChanged) return
    const { from, to } = update.view.viewport
    onViewport({ from: from as WindowPosition, to: to as WindowPosition })
  })
}
