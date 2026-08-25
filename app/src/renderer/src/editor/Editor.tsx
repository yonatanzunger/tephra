// CodeMirror inside React, without React inside CodeMirror.
//
// The editor is mounted ONCE into a ref'd container and React never renders
// into that subtree (D39). React therefore does nothing for the editing surface,
// which is the point: the typing path never enters reconciliation, so R1.1 is
// unaffected. React earns its keep on the chrome around this.
//
// Model construction is separate from view construction — Portal's most
// alarming finding was a widget that opened its file during view construction,
// re-read constantly and lost edit state on reparenting. The DocumentWindow is
// created by the caller and handed in; this component only binds a view to it.

import { useEffect, useRef } from 'react'
import type { BufferPosition, DocumentPosition, DocumentWindow } from '../../../shared/document-api.ts'
import { bindEditor, type Binding } from './bind'
import type { MarkInfo, Selection } from './range-commands.ts'
import type { CommentAnchor } from './comment-anchors.ts'
import type { Typography } from './theme'

export interface EditorProps {
  readonly window: DocumentWindow
  readonly vim: boolean
  readonly typography: Typography
  readonly onViewport?: (visible: { from: BufferPosition; to: BufferPosition }) => void
  readonly onCursor?: (at: DocumentPosition) => void
  readonly onError?: (err: Error) => void
  /**
   * Handed a way to ask what is selected, for as long as this editor lives.
   *
   * A range command arrives from the menu, which is in main; the caret is here.
   * Passing a reader upward — rather than pushing the selection up on every
   * cursor motion — keeps the typing path clear.
   */
  readonly onSelectionReader?: (read: (() => Selection) | null) => void
  /** A mark was clicked. What it stands for, and where it is on screen. */
  readonly onMark?: (mark: MarkInfo) => void
  readonly onCommentAnchors?: (anchors: readonly CommentAnchor[]) => void
  readonly onRailHost?: (host: HTMLElement | null) => void
}

export function Editor({
  window: docWindow,
  vim,
  typography,
  onViewport,
  onCursor,
  onError,
  onSelectionReader,
  onMark,
  onCommentAnchors,
  onRailHost,
}: EditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null)
  const binding = useRef<Binding | null>(null)

  // Rebind only when the WINDOW changes. Rebinding on a typography or vim
  // change would throw away the buffer and the cursor with it.
  useEffect(() => {
    if (host.current === null) return
    const bound = bindEditor({
      parent: host.current,
      window: docWindow,
      vim,
      typography,
      ...(onViewport !== undefined ? { onViewport } : {}),
      ...(onCursor !== undefined ? { onCursor } : {}),
      ...(onError !== undefined ? { onError } : {}),
      ...(onMark !== undefined ? { onMark } : {}),
      ...(onCommentAnchors !== undefined ? { onCommentAnchors } : {}),
      ...(onRailHost !== undefined ? { onRailHost } : {}),
    })
    binding.current = bound
    onSelectionReader?.(() => bound.selection())
    bound.view.focus()
    // Temporary: the self-check drives this. Goes away with verify.ts.
    ;(globalThis as unknown as { __view: unknown }).__view = bound.view
    return () => {
      onSelectionReader?.(null)
      bound.destroy()
      binding.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docWindow])

  useEffect(() => {
    binding.current?.setVim(vim)
  }, [vim])

  useEffect(() => {
    binding.current?.setTypography(typography)
  }, [typography])

  return <div className="editor-host" ref={host} />
}
