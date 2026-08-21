// The application shell. Chrome only — the editing surface owns its own DOM.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BufferPosition, DocumentPosition, SegmentKey } from '@shared/document-api.ts'
import { defaultUiState, type UiState } from '@shared/ui-state.ts'
import { RemoteDocument } from './x/remote-document'
import { Pane } from './pane/pane'
import { usePaneBoundary, usePaneLocation, usePaneWindow } from './pane/usePane'
import { Editor } from './editor/Editor'
import { defaultTypography, type Typography } from './editor/theme'
import { widgetOptions } from './editor/widgets'

export function App(): React.JSX.Element {
  const [doc, setDoc] = useState<RemoteDocument | null>(null)
  const [pane, setPane] = useState<Pane | null>(null)
  const [vim, setVim] = useState(false)
  const [restored, setRestored] = useState<DocumentPosition | null>(null)
  const [typography] = useState<Typography>(defaultTypography)
  const [error, setError] = useState<string | null>(null)
  const [diverged, setDiverged] = useState<{ date: string } | null>(null)

  const docWindow = usePaneWindow(pane)
  const location = usePaneLocation(pane)
  const boundary = usePaneBoundary(pane)

  // Model construction, deliberately before and outside view construction —
  // Portal's most alarming finding was a widget that built its model during
  // view construction and lost edit state on reparenting.
  useEffect(() => {
    let created: Pane | null = null
    void (async () => {
      try {
        const opened = await RemoteDocument.open()
        const p = new Pane(opened)
        created = p
        setDoc(opened)
        setPane(p)
        // Temporary: the self-check drives this. Goes away with verify.ts.
        ;(globalThis as unknown as { __pane: Pane }).__pane = p

        // Where the last session left off (R1.2). A stored cursor is soft
        // state: if the text it named has moved, landing slightly off and
        // scrolling is the whole cost (D11).
        const state = await window.tephra.doc.loadUiState()
        setVim(state.vim)
        if (state.cursor !== null) {
          setRestored({
            segment: state.cursor.segment as SegmentKey,
            offset: state.cursor.offset as never,
            generation: opened.generation,
          })
        }
        await p.goTo(state.location, { push: false })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => created?.release()
  }, [])

  // A day changed on disk while we held unsaved edits to it. Surfaced, never
  // resolved (D12): both automatic answers destroy something. Writing to that
  // day has stopped, and it says so rather than failing quietly.
  useEffect(() => {
    return window.tephra.doc.onDiverged(d => setDiverged({ date: d.date }))
  }, [])

  // Undo is document-scoped and reached past the facade on purpose (D26). When
  // it lands outside the loaded region the Pane is told to go there — which is
  // an ordinary goTo, a shape that already exists.
  useEffect(() => {
    if (doc === null) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      void (e.shiftKey ? doc.redo() : doc.undo())
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [doc])

  const onViewport = useCallback(
    (visible: { from: BufferPosition; to: BufferPosition }) => pane?.viewportChanged(visible),
    [pane],
  )

  // Where the caret is, remembered. Debounced because it moves on every
  // keystroke and this is a file write; the last position is the one that
  // matters, not every position on the way there.
  const cursorRef = useRef<UiState['cursor']>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCursor = useCallback(
    (at: DocumentPosition) => {
      cursorRef.current = { segment: at.segment as string as never, offset: at.offset as number }
      if (saveTimer.current !== null) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void window.tephra.doc.saveUiState({
          ...defaultUiState,
          location: pane?.location ?? defaultUiState.location,
          cursor: cursorRef.current,
          vim,
        })
      }, 600)
    },
    [pane, vim],
  )

  // The position must also survive a quit that beats the debounce.
  useEffect(() => {
    const flushState = (): void => {
      void window.tephra.doc.saveUiState({
        ...defaultUiState,
        location: pane?.location ?? defaultUiState.location,
        cursor: cursorRef.current,
        vim,
      })
    }
    window.addEventListener('beforeunload', flushState)
    return () => {
      window.removeEventListener('beforeunload', flushState)
      flushState()
    }
  }, [pane, vim])

  if (error !== null) {
    return (
      <main className="scaffold">
        <h1>Tephra</h1>
        <p className="bad">{error}</p>
      </main>
    )
  }

  const title = location?.kind === 'date' ? location.date : (doc?.today ?? '…')

  return (
    <div className="app">
      <header className="titlebar">
        <button className="nav" disabled={pane?.canGoBack !== true} onClick={() => void pane?.back()}>
          ‹
        </button>
        <button className="nav" disabled={pane?.canGoForward !== true} onClick={() => void pane?.forward()}>
          ›
        </button>
        <span className="title">{title}</span>
        <button className="nav" onClick={() => void pane?.goToToday()}>
          today
        </button>
        <span className="spacer" />
        <label className="toggle">
          <input type="checkbox" checked={vim} onChange={e => setVim(e.target.checked)} /> vim
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            defaultChecked={widgetOptions.enabled}
            onChange={e => {
              widgetOptions.enabled = e.target.checked
            }}
          />{' '}
          render
        </label>
      </header>

      {diverged !== null && (
        <div className="banner">
          <b>{diverged.date}</b> changed on disk while you were editing it. Your unsaved
          changes to that day are <b>not being written</b>, and nothing has been
          overwritten. Copy what you need, then reopen.
        </div>
      )}

      {boundary?.earlier.kind === 'extendable' && (
        <button className="edge" onClick={() => void pane?.extend('earlier')}>
          ▲ earlier
        </button>
      )}
      {boundary?.earlier.kind === 'extending' && <div className="edge quiet">loading…</div>}

      {docWindow === null ? (
        <main className="scaffold">
          <p className="sub">Opening…</p>
        </main>
      ) : (
        <Editor
          window={docWindow}
          vim={vim}
          typography={typography}
          onViewport={onViewport}
          onCursor={onCursor}
          initialCursor={restored}
          onError={err => setError(err.message)}
        />
      )}
    </div>
  )
}
