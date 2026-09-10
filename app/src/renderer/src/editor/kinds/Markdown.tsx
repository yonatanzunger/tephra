// The markdown surface: running text, edited as text (D54).
//
// **One of several ways a document can be shown, not the way.** Everything that
// makes this CodeMirror — the binding, the day separators, the marker layer, the
// list behaviour — is `markdown/`, under here, because it is this surface's and
// not the app's. The app knows only `SurfaceProps` (`editor/surface.ts`), which
// is what lets a kind that is not running text be a file beside this one.

import { useEffect, useRef } from 'react'
import { bindEditor, type Binding } from './markdown/bind.ts'
import type { SurfaceProps } from '../surface.ts'
import { tephra } from '../../handle.ts'

/**
 * The handle, which is richer than `SurfaceHandle` because text is richer.
 *
 * A range command arrives from the menu, which is in main; the caret is here.
 * Passing a reader upward — rather than pushing the selection up on every
 * cursor motion — keeps the typing path clear. The app narrows to this with
 * `asEditorHandle` when it needs to know that what it is showing is text.
 */
export function MarkdownSurface({
  window: docWindow,
  settings,
  onViewport,
  onCursor,
  onError,
  onHandle,
  annotations,
  onImages,
}: SurfaceProps): React.JSX.Element {
  const { typography } = settings
  const { onMark, onCommentAnchors, onRailHost } = annotations ?? {}
  const host = useRef<HTMLDivElement | null>(null)
  const binding = useRef<Binding | null>(null)

  // Rebind only when the WINDOW changes. Rebinding on a typography change would
  // throw away the buffer and the cursor with it.
  useEffect(() => {
    if (host.current === null) return
    const bound = bindEditor({
      parent: host.current,
      window: docWindow,
      typography,
      ...(onViewport !== undefined ? { onViewport } : {}),
      ...(onCursor !== undefined ? { onCursor } : {}),
      ...(onError !== undefined ? { onError } : {}),
      ...(onMark !== undefined ? { onMark } : {}),
      ...(onCommentAnchors !== undefined ? { onCommentAnchors } : {}),
      ...(onRailHost !== undefined ? { onRailHost } : {}),
      ...(onImages !== undefined ? { onImages } : {}),
    })
    binding.current = bound
    onHandle?.(bound)
    bound.view.focus()
    // Temporary: the self-check drives this. Goes away with verify.ts.
    tephra.view = bound.view
    return () => {
      onHandle?.(null)
      tephra.view = null
      bound.destroy()
      binding.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docWindow])


  useEffect(() => {
    binding.current?.setTypography(typography)
  }, [typography])

  return <div className="editor-host" ref={host} />
}
