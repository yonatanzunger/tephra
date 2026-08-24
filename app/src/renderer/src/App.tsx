// The application shell. Chrome only — the editing surface owns its own DOM.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BufferPosition, DateKey, DocumentChange, DocumentPosition, SegmentKey } from '../../shared/document-api.ts'
import { defaultUiState, type UiState } from '../../shared/ui-state.ts'
import { RemoteDocument } from './x/remote-document'
import { Pane } from './pane/pane'
import { usePaneBoundary, usePaneLocation, usePaneWindow } from './pane/usePane'
import { Editor } from './editor/Editor'
import type { Selection } from './editor/range-commands.ts'
import { defaultTypography, type Typography } from './editor/theme'
import { Frame, useStream } from './frame/Frame'
import { Nav } from './frame/Nav'
import { AnomalyBadge, AnomalyList } from './frame/Anomalies'
import { Prompt, type PromptRequest } from './frame/Prompt'
import { MarkPanel } from './frame/MarkPanel'
import type { MarkInfo } from './editor/range-commands.ts'
import type { Anomaly } from '../../shared/anomalies.ts'
import { useFrameMetrics } from './frame/useFrame'
import { useTheme, typographyOf } from './theme/useTheme'
import { ThemePanel } from './theme/ThemePanel'

export function App(): React.JSX.Element {
  const [doc, setDoc] = useState<RemoteDocument | null>(null)
  const [pane, setPane] = useState<Pane | null>(null)
  const [vim, setVim] = useState(false)
  const [restored, setRestored] = useState<DocumentPosition | null>(null)
  const [themeName, setThemeName] = useState<string>(defaultUiState.theme)
  const [panelOpen, setPanelOpen] = useState(false)
  const [anomalies, setAnomalies] = useState<readonly Anomaly[]>([])
  const [anomaliesOpen, setAnomaliesOpen] = useState(false)
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const theme = useTheme(themeName, setThemeName)
  // The editor and the frame both lay out from the DRAFT, so a slider moves the
  // text while it is being dragged. That is the entire point of the panel.
  const typography = useMemo(() => typographyOf(theme.draft, theme.face), [theme.draft, theme.face])
  const [error, setError] = useState<string | null>(null)
  const [diverged, setDiverged] = useState<{ date: string } | null>(null)
  const [navVisible, setNavVisible] = useState(true)
  const [extent, setExtent] = useState<{ first: DateKey; last: DateKey } | null>(null)
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null)

  const metrics = useFrameMetrics(frameEl, typography)

  // Temporary, for the frame self-check. Goes away with verify.ts.
  ;(globalThis as unknown as { __metrics: typeof metrics }).__metrics = metrics
  // Temporary, for the self-check. Goes away with verify.ts.
  ;(globalThis as unknown as { __setHebrewScale: (n: number) => void }).__setHebrewScale = n =>
    theme.update({ hebrewScale: n })
  const stream = useStream(metrics)

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
        ;(globalThis as unknown as { __doc: RemoteDocument }).__doc = opened

        // Where the last session left off (R1.2). A stored cursor is soft
        // state: if the text it named has moved, landing slightly off and
        // scrolling is the whole cost (D11).
        const state = await window.tephra.doc.loadUiState()
        setVim(state.vim)
        setThemeName(state.theme)
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

  // Vim moved from a titlebar checkbox to View ▸ Vim mode. The setting still
  // lives here and is still saved per device; the menu is a control on it and a
  // view of it, which is why the state is pushed back after every change —
  // including the one that comes from loading ui-state.json at startup.
  useEffect(() => window.tephra.doc.onSetVim(setVim), [])
  // Temporary, for the self-check: the menu drives vim from the main process,
  // which a renderer scene cannot reach. Goes away with verify.ts.
  ;(globalThis as unknown as { __setVim: (v: boolean) => void }).__setVim = setVim
  useEffect(() => window.tephra.doc.vimChanged(vim), [vim])

  // What the notebook actually covers, so the nav offers days that exist rather
  // than a fixed span reaching into a past that has none.
  useEffect(() => {
    if (doc === null) return
    void window.tephra.doc.extent().then(setExtent)
  }, [doc])

  // Undo is document-scoped and reaches past the facade on purpose (D26). When
  // it lands outside the loaded region the Pane is told to go there — an
  // ordinary goTo, a shape that already exists.
  //
  // It arrives from the Edit menu rather than from a keydown listener. A menu
  // accelerator consumes the keystroke before the page sees it, so the two
  // cannot coexist: with both, either nothing happens or it happens twice.
  // The menu owns ⌘Z, and Edit ▸ Undo and the keystroke are then the same path.
  useEffect(() => {
    if (doc === null) return

    /**
     * Undo, and then GO AND LOOK AT IT.
     *
     * Without this, undoing a change that has since scrolled out of the loaded
     * window does its work in complete silence: the document changes, the file
     * on disk changes, and the screen does not move. Measured — a marker typed
     * into today, navigated away from, then undone, vanished from the file
     * while the buffer and the location both stayed exactly as they were.
     *
     * The danger is not the single keystroke, it is the second one. Press undo,
     * see nothing, and the natural response is to press it again — silently
     * unwinding more work in a file you are not looking at.
     *
     * `toBuffer` returns null for a segment the window does not cover, which is
     * the containment test; no new API is needed for it.
     */
    const revealing = async (work: Promise<DocumentChange | null>): Promise<void> => {
      const change = await work
      const segment = change?.edits[0]?.span.begin.segment
      if (segment === undefined) return
      const w = pane?.window
      if (w != null && w.toBuffer({ segment, offset: 0 as never, generation: w.generation }) !== null) {
        return // already on screen; nothing to go to
      }
      await pane?.goTo({ kind: 'date', date: segment as DateKey })
    }

    return window.tephra.doc.onMenuCommand(command => {
      if (command === 'undo') void revealing(doc.undo())
      else if (command === 'redo') void revealing(doc.redo())
      else if (command === 'typography') setPanelOpen(open => !open)
    })
  }, [doc, pane])

  useEffect(() => {
    if (doc === null) return
    let cancelled = false
    void window.tephra.doc.anomalies().then(found => {
      if (!cancelled) setAnomalies(found)
    })
    return () => {
      cancelled = true
    }
  }, [doc, docWindow])

  // A range command, however it was reached — menu bar, accelerator, or the
  // context menu. All three are renderings of one list (`shared/commands.ts`),
  // so this is the single place any of them lands.
  useEffect(() => {
    if (doc === null) return
    return window.tephra.doc.onRangeCommand(id => {
      // Tag and untag are the same operation with opposite signs, so they are
      // one branch: read the selection, ask for a subject, send it.
      if (id === 'tag' || id === 'untag') {
        const selection = selectionRef.current?.()
        if (selection === undefined || selection.empty) return
        const removing = id === 'untag'
        if (removing && selection.subjects.length === 0) {
          setError('Nothing in the selection carries a tag.')
          return
        }
        setPrompt({
          title: removing ? 'Remove which tag?' : 'Tag this passage as',
          placeholder: 'a subject you will gather later',
          // Prefilled with what is already there: when a passage carries one
          // subject, removing it should be a keystroke rather than a spelling
          // test. Selected on focus, so typing replaces it.
          ...(selection.subjects.length > 0 ? { initial: selection.subjects[0] as string } : {}),
          submitLabel: removing ? 'Remove' : 'Tag',
          onSubmit: subject => {
            const write = removing
              ? window.tephra.doc.untag(selection.span, subject)
              : window.tephra.doc.tag(selection.span, subject)
            void write.catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err))
            })
          },
        })
        return
      }

      if (id === 'branch') {
        const selection = selectionRef.current?.()
        if (selection === undefined || selection.empty) return
        setPrompt({
          title: 'Move this to its own file called',
          placeholder: 'what the material is about',
          submitLabel: 'Branch',
          onSubmit: name => {
            void window.tephra.doc.branch(selection.span, name).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err))
            })
          },
        })
        return
      }

      if (id === 'bookmark') {
        // The degenerate range: a point. Captured NOW, before the prompt opens
        // — the caret is where the reader left it, and a prompt taking focus is
        // not a reason to bookmark somewhere else.
        //
        // Built from the cursor App already tracks for `ui-state`, stamped with
        // the CURRENT generation. If the document moves under it while the
        // prompt is open, the write fails loudly rather than landing in the
        // wrong place — which is what D11's generations are for.
        const stored = cursorRef.current
        if (stored === null) return
        const at: DocumentPosition = {
          segment: stored.segment as SegmentKey,
          offset: stored.offset as never,
          generation: doc.generation,
        }
        setPrompt({
          title: 'Name this bookmark',
          placeholder: 'a word you will search for later',
          submitLabel: 'Bookmark',
          onSubmit: name => {
            // A failed range operation must not vanish. The write can legitimately
            // fail — a stale position if the document moved while the prompt was
            // open — and swallowing that leaves the reader believing they
            // bookmarked something.
            void window.tephra.doc.setAnchor(at, name).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err))
            })
          },
        })
      }
    })
  }, [doc, pane])

  const onViewport = useCallback(
    (visible: { from: BufferPosition; to: BufferPosition }) => pane?.viewportChanged(visible),
    [pane],
  )

  // Where the caret is, remembered. Debounced because it moves on every
  // keystroke and this is a file write; the last position is the one that
  // matters, not every position on the way there.
  // The mark someone clicked, and what it stands for. Null when nothing is open.
  const [mark, setMark] = useState<MarkInfo | null>(null)

  /**
   * A failed range operation must not vanish. Every one of these can legitimately
   * fail — a stale position if the document moved while a panel was open — and
   * swallowing that leaves the reader believing the thing happened.
   */
  const fail = useCallback((err: unknown): void => {
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  // How to ask the editor what is selected, for as long as one is mounted.
  const selectionRef = useRef<(() => Selection) | null>(null)

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
          theme: themeName,
        })
      }, 600)
    },
    [pane, vim, themeName],
  )

  // The position must also survive a quit that beats the debounce.
  useEffect(() => {
    const flushState = (): void => {
      void window.tephra.doc.saveUiState({
        ...defaultUiState,
        location: pane?.location ?? defaultUiState.location,
        cursor: cursorRef.current,
        vim,
        theme: themeName,
      })
    }
    window.addEventListener('beforeunload', flushState)
    return () => {
      window.removeEventListener('beforeunload', flushState)
      flushState()
    }
  }, [pane, vim, themeName])

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
        <button
          className="nav labelled"
          aria-pressed={navVisible}
          title="Show or hide the sections list"
          onClick={() => setNavVisible(v => !v)}
        >
          <span aria-hidden="true">☰</span> Sections
        </button>
        <span className="title">{title}</span>
        <button className="nav" onClick={() => void pane?.goToToday()}>
          today
        </button>
        <span className="spacer" />
        <AnomalyBadge
          anomalies={anomalies}
          open={anomaliesOpen}
          onToggle={() => setAnomaliesOpen(open => !open)}
        />
        {/* Refused, not hidden. A control that vanishes when the window narrows
            is a puzzle; one that declines and says why is an explanation. */}
        <button
          className="nav"
          aria-pressed={stream.open}
          title={
            metrics.streamOcclusion > 0
              ? `Open today beside what you are reading. This window is narrow, so it will cover about ${Math.round(metrics.streamOcclusion)}px of the margin — nothing moves, and closing it puts it back.`
              : 'Open today beside what you are reading'
          }
          onClick={stream.toggle}
        >
          <span aria-hidden="true">▤</span> Stream
        </button>
      </header>

      {diverged !== null && (
        <div className="banner">
          <b>{diverged.date}</b> changed on disk while you were editing it. Your unsaved
          changes to that day are <b>not being written</b>, and nothing has been
          overwritten. Copy what you need, then reopen.
        </div>
      )}

      <Frame
        metrics={metrics}
        navVisible={navVisible}
        streamOpen={stream.open}
        frameRef={setFrameEl}
        nav={
          <Nav
            today={doc?.today ?? null}
            here={location?.kind === 'date' ? location.date : null}
            extent={extent}
            onGoTo={date => void pane?.goTo({ kind: 'date', date })}
          />
        }
        stream={
          <>
            <div className="stream-head">Today</div>
            <div className="stream-body">
              {/* The column is real and its width is honest; what goes in it is
                  a second editor bound to the end of today, which is its own
                  piece of work. Reserved here so the frame can be judged. */}
              <p>
                The capture surface lands here — the end of today, always ready
                to type into, so jotting while reading something else costs no
                navigation (Q7c).
              </p>
            </div>
          </>
        }
      >
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
            onSelectionReader={read => (selectionRef.current = read)}
            onMark={setMark}
          />
        )}
        {anomaliesOpen && (
          <AnomalyList
            anomalies={anomalies}
            onClose={() => setAnomaliesOpen(false)}
            onGoTo={date => {
              void pane?.goTo({ kind: 'date', date: date as never })
              setAnomaliesOpen(false)
            }}
          />
        )}
        {prompt !== null && <Prompt request={prompt} onClose={() => setPrompt(null)} />}
        {mark !== null && (
          <MarkPanel
            mark={mark}
            onClose={() => setMark(null)}
            actions={{
              onRemoveAnchor: name => {
                setMark(null)
                void window.tephra.doc.removeAnchor(name).catch(fail)
              },
              onRemoveTag: (name, span) => {
                setMark(null)
                void window.tephra.doc.untag(span, name).catch(fail)
              },
              onRenameTag: (name, span) => {
                setMark(null)
                setPrompt({
                  title: 'Call this passage',
                  placeholder: 'a subject you will gather later',
                  initial: name,
                  submitLabel: 'Rename',
                  // This span, not the subject everywhere: renaming a subject
                  // across the corpus changes text nobody is looking at, and is
                  // a different operation entirely.
                  onSubmit: next => void window.tephra.doc.renameTag(span, name, next).catch(fail),
                })
              },
            }}
          />
        )}

        {panelOpen && (
          <ThemePanel
            control={theme}
            occlusion={{ covering: metrics.streamOcclusion }}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </Frame>
    </div>
  )
}
