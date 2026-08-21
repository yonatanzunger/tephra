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

import { EditorState, StateEffect, Transaction, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { vim } from '@replit/codemirror-vim'
import type { BufferEdit, BufferPosition, DocumentWindow, EditOrigin } from '@shared/document-api.ts'
import { widgetExtensions } from './widgets.ts'
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
  readonly onError?: (err: Error) => void
}

export interface Binding {
  readonly view: EditorView
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
        vimCompartment.of(options.vim ? vim({ status: true }) : []),
        // NO history() — see the header. Undo is document.undo().
        markdown(),
        syntaxHighlighting(proseHighlight, { fallback: true }),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        widgetExtensions(),
        keymap.of([...defaultKeymap, ...searchKeymap]),
        typographyCompartment.of(tephraTheme(typography)),
        editorToWindow(docWindow, options.onError),
        viewportReporter(options.onViewport),
      ] as Extension[],
    }),
  })

  const unsubscribeChanged = docWindow.onChanged((edits, origin) => {
    applyFromDocument(view, edits, origin)
  })
  const unsubscribeReset = docWindow.onReset(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: docWindow.text },
      effects: fromDocument.of(null),
    })
  })

  return {
    view,
    setVim(on: boolean): void {
      view.dispatch({ effects: vimCompartment.reconfigure(on ? vim({ status: true }) : []) })
      view.focus()
    },
    setTypography(t: Typography): void {
      view.dispatch({ effects: typographyCompartment.reconfigure(tephraTheme(t)) })
    },
    destroy(): void {
      unsubscribeChanged()
      unsubscribeReset()
      view.destroy()
    },
  }
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

/** Apply a change the document made, without sending it back. */
function applyFromDocument(view: EditorView, edits: readonly BufferEdit[], _origin: EditOrigin): void {
  if (edits.length === 0) return
  view.dispatch({
    changes: edits.map(e => ({ from: e.from as number, to: e.to as number, insert: e.insert })),
    effects: fromDocument.of(null),
    annotations: Transaction.addToHistory.of(false),
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
