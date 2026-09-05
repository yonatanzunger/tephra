// The margin, filled at last.
//
// MV reserved this band and D42 has kept it empty ever since — the gutter is
// `padding-right` on `.cm-content`, not a grid track, so drawing into it moves
// nothing. That is the whole reason the notes can appear and disappear without
// the text shifting under the reader's eye.
//
// The rail is mounted INSIDE the editor's scroller, so notes scroll with the
// text natively. A rail outside it would need a scroll handler recomputing every
// note's position sixty times a second to achieve exactly the same thing.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CommentId, CommentThread } from '../../../shared/comments.ts'
import type { CommentAnchor } from '../editor/annotations.ts'
import { toHtml } from '../print/markdown.ts'

/**
 * The three offered without asking: ➕ for agreement, 👀 for "seen this", 🎉
 * for the good news. Everything else is one click further away, through the
 * system's own picker, which knows every emoji and how to search them.
 */
const QUICK = ['\u2795', '\u{1F440}', '\u{1F389}']

export function Rail({
  threads,
  anchors,
  me,
  onChanged,
  onError,
}: {
  threads: readonly CommentThread[]
  anchors: readonly CommentAnchor[]
  me: string
  onChanged: () => void
  onError: (err: unknown) => void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const byId = new Map(threads.map(t => [t.id as string, t]))
  const placed = anchors.filter(a => byId.has(a.id))

  // Notes want to sit beside what they annotate and must not sit on top of one
  // another, and the second wins: push each note down until it clears the one
  // above. Heights are only knowable after layout, so this is written to the DOM
  // rather than fed back through React, which would be a second render per
  // keystroke of a scroll.
  useLayoutEffect(() => {
    const notes = [...(host.current?.children ?? [])] as HTMLElement[]
    let cursor = -Infinity
    notes.forEach((note, i) => {
      const wanted = placed[i]?.top ?? 0
      const top = Math.max(wanted, cursor)
      note.style.top = `${top}px`
      cursor = top + note.offsetHeight + 8
    })
  })

  return (
    <div className="rail" ref={host}>
      {placed.map(anchor => (
        <Note
          key={anchor.id}
          thread={byId.get(anchor.id) as CommentThread}
          me={me}
          onChanged={onChanged}
          onError={onError}
        />
      ))}
    </div>
  )
}

function Note({
  thread,
  me,
  onChanged,
  onError,
}: {
  thread: CommentThread
  me: string
  onChanged: () => void
  onError: (err: unknown) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<number | null>(null)
  const [replying, setReplying] = useState(false)

  // A message with nothing in it is one that was just created and has not been
  // written yet: open it for typing rather than displaying an empty box.
  const blank = thread.messages.findIndex(m => m.body === '')
  useEffect(() => {
    if (blank !== -1) setEditing(blank)
  }, [blank])

  const run = useCallback(
    (work: Promise<unknown>) => {
      void work.then(onChanged).catch(onError)
    },
    [onChanged, onError],
  )

  // A resolved thread collapses to a line. This is the one place `resolved`
  // earns its keep for a single user: it is how a discussion stops taking up
  // the margin once it is over.
  if (thread.resolved) {
    return (
      <div className="note note-resolved">
        <button
          type="button"
          className="link"
          onClick={() => run(window.tephra.doc.setCommentResolved(thread.id, false))}
        >
          {thread.messages.length === 1 ? '1 note' : `${thread.messages.length} notes`}, resolved
        </button>
      </div>
    )
  }

  return (
    <div className="note">
      {thread.assignee != null && <div className="note-assignee">for {thread.assignee}</div>}

      {thread.messages.map((message, index) => (
        <article className="note-message" key={`${message.at}-${index}`}>
          <header>
            <span className="note-who">{message.author}</span>
            <time dateTime={message.at}>{when(message.at)}</time>
          </header>

          {editing === index ? (
            <Composer
              initial={message.body}
              submit={message.body === '' ? 'Comment' : 'Save'}
              onCancel={() => {
                setEditing(null)
                // Abandoning a note that was never written removes it, and
                // removing the only message removes the thread — so backing out
                // of a comment leaves the file exactly as it was.
                if (message.body === '') run(window.tephra.doc.deleteComment(thread.id, index))
              }}
              onSubmit={body => {
                setEditing(null)
                run(window.tephra.doc.editComment(thread.id, index, body))
              }}
            />
          ) : (
            <div
              className="note-body"
              // Rendered by the same parser the editor and the printer use, and
              // it escapes rather than passes through raw HTML — asserted in
              // print-markdown.test.ts, which is why this is safe here.
              dangerouslySetInnerHTML={{ __html: toHtml(message.body) }}
            />
          )}

          <footer>
            {/* Reactions on their own line. Sharing a row with the actions made
                Edit and Delete move sideways every time anyone reacted, which
                is the same complaint as reflow at a smaller scale. */}
            <div className="note-reactions">
              {Object.entries(message.reactions).map(([emoji, who]) => (
              <button
                type="button"
                key={emoji}
                className="pill control reaction"
                // **The state, said out loud.** `.mine` was a class and nothing
                // else: a screen reader was told this was a button and never
                // told whether it was set.
                aria-pressed={who.includes(me)}
                title={who.join(', ')}
                onClick={() =>
                  run(window.tephra.doc.reactToComment(thread.id, index, emoji, !who.includes(me)))
                }
                >
                  {emoji} {who.length}
                </button>
              ))}
              {QUICK.filter(e => message.reactions[e] === undefined).map(emoji => (
                <button
                  type="button"
                  key={emoji}
                  className="quick"
                  onClick={() => run(window.tephra.doc.reactToComment(thread.id, index, emoji, true))}
                >
                  {emoji}
                </button>
              ))}
              <MorePicker onPick={emoji => run(window.tephra.doc.reactToComment(thread.id, index, emoji, true))} />
            </div>

            <div className="note-actions">
              <button type="button" className="link" onClick={() => setEditing(index)}>
                Edit
              </button>
              <button
                type="button"
                className="link"
                onClick={() => run(window.tephra.doc.deleteComment(thread.id, index))}
              >
                Delete
              </button>
            </div>
          </footer>
        </article>
      ))}

      {replying ? (
        <Composer
          initial=""
          submit="Reply"
          onCancel={() => setReplying(false)}
          onSubmit={body => {
            setReplying(false)
            run(window.tephra.doc.addComment(thread.id, body))
          }}
        />
      ) : (
        <div className="note-foot">
          <button type="button" className="link" onClick={() => setReplying(true)}>
            Reply
          </button>
          <button
            type="button"
            className="link"
            onClick={() => run(window.tephra.doc.setCommentResolved(thread.id, true))}
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Everything else, through the system's picker.
 *
 * macOS's panel types into whatever has focus, so this focuses a field of its
 * own and reads the first character out of it. That is the whole trick, and it
 * is cheaper than shipping an emoji database and a search box — and better,
 * because it is the picker the reader already knows.
 */
function MorePicker({ onPick }: { onPick: (emoji: string) => void }): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null)
  return (
    <span className="more">
      <button
        type="button"
        className="quick"
        title="Other reaction"
        onClick={() => {
          field.current?.focus()
          void window.tephra.emojiPanel()
        }}
      >
        +
      </button>
      <input
        ref={field}
        className="more-catch"
        value=""
        onChange={e => {
          // The first grapheme, so a skin tone or a ZWJ sequence arrives whole.
          const first = [...new Intl.Segmenter().segment(e.target.value)][0]?.segment
          if (first !== undefined && first.trim() !== '') onPick(first)
          field.current?.blur()
        }}
      />
    </span>
  )
}

/**
 * Writing a note, in the place the note is read.
 *
 * **Editing happens where the thing is rendered** (D47). Relocating a construct
 * in order to edit it costs the same as reflow does — the eye has to leave what
 * it was reading — so a message becomes a field exactly where it sat.
 */
function Composer({
  initial,
  submit,
  onSubmit,
  onCancel,
}: {
  initial: string
  submit: string
  onSubmit: (body: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    field.current?.focus()
    field.current?.setSelectionRange(initial.length, initial.length)
  }, [initial])

  return (
    <div className="composer">
      <textarea
        ref={field}
        value={value}
        rows={3}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          // Enter sends; a newline needs a modifier. A margin note is a
          // sentence or two, and reaching for a button to send one is friction
          // on the gesture this whole feature exists to make cheap.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (value.trim() !== '') onSubmit(value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
          e.stopPropagation()
        }}
      />
      <div className="composer-actions">
        <button type="button" onClick={() => value.trim() !== '' && onSubmit(value)}>
          {submit}
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** A date a person would say out loud, with the exact time in the tooltip. */
function when(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000)
  if (days <= 0) return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return at.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export type { CommentId }
