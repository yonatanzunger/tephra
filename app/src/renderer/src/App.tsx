// The application shell. Chrome only — the editing surface owns its own DOM.

import { useCallback, useEffect, useState } from 'react'
import type { BufferPosition } from '@shared/document-api.ts'
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
  const [typography] = useState<Typography>(defaultTypography)
  const [error, setError] = useState<string | null>(null)

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
        await p.goToToday()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => created?.release()
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
          onError={err => setError(err.message)}
        />
      )}
    </div>
  )
}
