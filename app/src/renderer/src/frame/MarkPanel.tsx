// What a mark says when you ask it.
//
// The mark is deliberately silent until clicked (D44): it is one character
// wide, always drawn, and carries no name, so a passage that is tagged looks
// like prose with a small mark rather than like prose with metadata stapled to
// it. This is where the name lives.
//
// It is also the only place the subjects past the third are visible. The extent
// stacks three rules deep and no further, so "what is this passage" is a
// question the list answers and the underlines cannot.
//
// **All three kinds of marker, now.** A handle stands for a bookmark, a tagged
// range or a commented one, and this panel knew about two of them — so clicking
// a comment's marker said *nothing resolves here* about a mark the editor had
// drawn itself.

import { useEffect, useRef } from 'react'
import { tagSlot } from '../../../shared/tags.ts'
import type { MarkInfo } from '../editor/annotations.ts'

export interface MarkActions {
  readonly onRenameTag: (name: string, span: MarkInfo['tags'][number]['span']) => void
  readonly onRemoveTag: (name: string, span: MarkInfo['tags'][number]['span']) => void
  readonly onRemoveAnchor: (name: string) => void
}

export function MarkPanel({
  mark,
  actions,
  onClose,
}: {
  mark: MarkInfo
  actions: MarkActions
  onClose: () => void
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null)

  // Escape closes it, and so does clicking anywhere else. A panel that can only
  // be dismissed by finding its own close button is a panel in the way.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onDown = (event: MouseEvent): void => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    // Deferred by a tick: the click that OPENED this would otherwise close it.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // Beside the mark, and kept on screen. Below by preference — the eye is
  // already there — flipping above only when there is no room.
  const below = mark.box.bottom + 8
  const room = window.innerHeight - below > 160
  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(mark.box.left - 6, window.innerWidth - 260)),
    ...(room ? { top: below } : { bottom: window.innerHeight - mark.box.top + 8 }),
  }

  return (
    <div className="mark-panel" ref={panel} style={style} role="dialog" aria-label="Marker">
      {mark.anchor !== null && (
        <div className="mark-row">
          <span className="mark-kind">Bookmark</span>
          <span className="mark-name">{mark.anchor}</span>
          <button type="button" className="link" onClick={() => actions.onRemoveAnchor(mark.anchor as string)}>
            Remove
          </button>
        </div>
      )}

      {mark.tags.map(tag => (
        <div className="mark-row" key={`${tag.name}-${String(tag.span.begin.offset)}`}>
          <span className="mark-swatch" style={{ ['--tag' as string]: `var(--tag-${tagSlot(tag.name)})` }} />
          <span className="mark-name">{tag.name}</span>
          <button type="button" className="link" onClick={() => actions.onRenameTag(tag.name, tag.span)}>
            Rename
          </button>
          <button type="button" className="link" onClick={() => actions.onRemoveTag(tag.name, tag.span)}>
            Remove
          </button>
        </div>
      ))}

      {/* **A comment is a marker too**, which this panel did not know: a
          commented range opens with a handle exactly as a tagged one does, so
          clicking one produced *nothing resolves here* about a mark the editor
          had drawn itself. Reported from use.

          Named, not reproduced. The thread's messages are in the rail beside
          the text (D50) and printing them again here would be the margin's job
          done twice — what the panel answers is *what is this mark*. */}
      {mark.comments.map(comment => (
        <div className="mark-row" key={comment.id}>
          <span className="mark-kind">{comment.resolved ? 'Resolved' : 'Comment'}</span>
          <span className="mark-name" title={comment.opening}>
            {comment.opening === '' ? 'an empty note' : comment.opening}
          </span>
          {comment.author !== '' && <span className="mark-who">{comment.author}</span>}
        </div>
      ))}

      {mark.anchor === null && mark.tags.length === 0 && mark.comments.length === 0 && (
        <div className="mark-row">
          <span className="mark-kind">Marker</span>
          {/* **Says what happened, not merely that nothing did.** Every marker
              is a bookmark, a tag or a comment, so reaching this line means one
              lost the thing it pointed at rather than that markers can be
              meaningless. */}
          <span className="mark-name">this one has lost what it pointed to</span>
        </div>
      )}
    </div>
  )
}
