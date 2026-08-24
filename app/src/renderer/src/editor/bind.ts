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

import { ChangeSet, EditorState, StateEffect, Transaction, type Extension } from '@codemirror/state'
import { EditorView, crosshairCursor, drawSelection, keymap, placeholder, rectangularSelection } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { vim } from '@replit/codemirror-vim'
import type { BufferEdit, BufferPosition, DocumentPosition, DocumentWindow, EditOrigin } from '../../../shared/document-api.ts'
import { widgetExtensions } from './widgets.ts'
import { contextMenu, markAt, readSelection, reportSelection, type MarkInfo, type Selection } from './range-commands.ts'
import { retag, tagExtents } from './tags.ts'
import { commentExtents, recomment, type CommentAnchor } from './comment-anchors.ts'
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
  readonly onViewport?: (visible: { from: BufferPosition; to: BufferPosition }) => void
  /** Where the caret is, in document space, so it can outlive the session. */
  readonly onCursor?: (at: DocumentPosition) => void
  /** Restored position from a previous session. Absent means "end of today". */
  readonly initialCursor?: DocumentPosition | null
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
        // A day with nothing in it yet is the ordinary case first thing in the
        // morning, and with no gutter, no caret cue and no chrome it renders as
        // a blank rectangle — indistinguishable from the app having failed.
        placeholder('Nothing here yet. Start typing.'),
        vimCompartment.of(vimExtensions(options.vim)),
        // NO history() — see the header. Undo is document.undo().
        markdown(),
        syntaxHighlighting(proseHighlight, { fallback: true }),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        widgetExtensions(),
        tagExtents(docWindow),
        commentExtents(docWindow, anchors => options.onCommentAnchors?.(anchors)),
        keymap.of([...defaultKeymap, ...searchKeymap]),
        typographyCompartment.of(tephraTheme(typography)),
        editorToWindow(docWindow, options.onError),
        viewportReporter(options.onViewport),
        cursorReporter(docWindow, options.onCursor),
      ] as Extension[],
    }),
  })

  // Where to land.
  //
  // Restored position first, if the previous session left one. Otherwise the
  // END of the loaded region: the stream is oldest-first and appended to (Q7),
  // so opening Tephra should put the cursor where the next sentence goes. That
  // matters more than it looks — the window grows backwards in the background,
  // so offset zero stops meaning "today" a moment after opening, and a cursor
  // left there would put the first thing typed into whatever old day had just
  // been loaded above it.
  const restored = options.initialCursor == null ? null : docWindow.toBuffer(options.initialCursor)
  const landing = restored ?? (docWindow.text.length as BufferPosition)
  view.dispatch({
    selection: { anchor: landing as number },
    effects: EditorView.scrollIntoView(landing as number, { y: restored === null ? 'end' : 'center' }),
  })

  const unsubscribeChanged = docWindow.onChanged((edits, origin) => {
    applyFromDocument(view, edits, origin)
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
    view.dispatch({ effects: [retag.of(null), recomment.of(null)] })
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

      const edits: BufferEdit[] = []
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        edits.push({
          from: fromA as BufferPosition,
          to: toA as BufferPosition,
          insert: inserted.toString(),
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
function applyFromDocument(view: EditorView, edits: readonly BufferEdit[], _origin: EditOrigin): void {
  if (edits.length === 0) return
  const changes = ChangeSet.of(
    edits.map(e => ({ from: e.from as number, to: e.to as number, insert: e.insert })),
    view.state.doc.length,
  )
  const head = view.state.selection.main.head
  const anchor = view.state.selection.main.anchor
  view.dispatch({
    changes,
    selection: { anchor: changes.mapPos(anchor, 1), head: changes.mapPos(head, 1) },
    effects: fromDocument.of(null),
    annotations: Transaction.addToHistory.of(false),
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
    onCursor(docWindow.toDocument(update.state.selection.main.head as BufferPosition))
  })
}

/**
 * The editor reports a fact; the Pane owns the policy (D35). Reporting upward
 * keeps the dependency pointing from Z's view to Z's view-model, and it is also
 * how ScreenMetric stays calibrated — `to - from` is a screenful in characters.
 */
function viewportReporter(
  onViewport: ((visible: { from: BufferPosition; to: BufferPosition }) => void) | undefined,
): Extension {
  if (onViewport === undefined) return []
  return EditorView.updateListener.of(update => {
    if (!update.viewportChanged && !update.geometryChanged) return
    const { from, to } = update.view.viewport
    onViewport({ from: from as BufferPosition, to: to as BufferPosition })
  })
}
