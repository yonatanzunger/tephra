// The application shell. Chrome only — the editing surface owns its own DOM.

import { useCallback, useEffect, useState } from 'react'
import type { BufferPosition, DocumentWindow } from '@shared/document-api.ts'
import { RemoteDocument } from './x/remote-document'
import { Editor } from './editor/Editor'
import { defaultTypography, type Typography } from './editor/theme'
import { widgetOptions } from './editor/widgets'

export function App(): React.JSX.Element {
  const [doc, setDoc] = useState<RemoteDocument | null>(null)
  const [docWindow, setWindow] = useState<DocumentWindow | null>(null)
  const [vim, setVim] = useState(false)
  const [typography] = useState<Typography>(defaultTypography)
  const [error, setError] = useState<string | null>(null)
  const [saved] = useState<'clean' | 'saving'>('clean')

  // Model construction, deliberately before and outside view construction.
  useEffect(() => {
    let released: DocumentWindow | null = null
    void (async () => {
      try {
        const opened = await RemoteDocument.open()
        const w = await opened.readToday()
        released = w
        setDoc(opened)
        setWindow(w)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => released?.release()
  }, [])

  // NO autosave here. Durability is main's job (D32): the write tiers live
  // beside the files, and the renderer is the process most likely to die.
  // This only reflects what main reports.

  // Undo is document-scoped and reached past the facade on purpose (D26).
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

  const onViewport = useCallback((_visible: { from: BufferPosition; to: BufferPosition }) => {
    // Reported upward already; the Pane starts consuming it in the next bullet.
  }, [])

  if (error !== null) return <main className="scaffold"><h1>Tephra</h1><p className="bad">{error}</p></main>

  return (
    <div className="app">
      <header className="titlebar">
        <span className="title">{doc?.today ?? '…'}</span>
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
        <span className={`saved ${saved}`}>{saved === 'saving' ? 'saving…' : 'saved'}</span>
      </header>
      {docWindow === null ? (
        <main className="scaffold"><p className="sub">Opening…</p></main>
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
