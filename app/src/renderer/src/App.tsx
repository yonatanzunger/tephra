// The application shell. Chrome only — the editing surface owns its own DOM.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  WindowPosition, DateKey, DocumentChange, DocumentPosition, DocumentWindow, SegmentKey, SessionGeneration,
} from '../../shared/document-api.ts'
import { defaultUiState, type UiState } from '../../shared/ui-state.ts'
import { RemoteDocument } from './x/remote-document'
import { Pane } from './pane/pane'
import { usePaneBoundary, usePaneLocation, usePaneWindow } from './pane/usePane'
import { Editor } from './editor/Editor'
import type { EditorHandle } from './editor/range-commands.ts'
import { defaultTypography, type Typography } from './editor/theme'
import { Frame, useStream } from './frame/Frame'
import { Nav } from './frame/Nav'
import { AnomalyBadge, AnomalyList } from './frame/Anomalies'
import { Prompt, type PromptRequest } from './frame/Prompt'
import type { Located, Reference } from '../../shared/nav-api.ts'
import { DateRange, type DateRangeRequest } from './frame/DateRange'
import { MarkPanel } from './frame/MarkPanel'
import { Rail } from './frame/Rail'
import { createPortal } from 'react-dom'
import type { CommentThread } from '../../shared/comments.ts'
import type { CommentAnchor } from './editor/comment-anchors.ts'
import type { MarkInfo } from './editor/range-commands.ts'
import {
  printPage, printRangePage, rangeTitle, needsPages,
  PAPER_CLEAN, PAPER_FOOTNOTES, PAPER_MARGIN, PAPER_NOTES, PRINT_CSS,
} from './print/page.ts'
import type { AnnotationChoice } from './frame/DateRange'
import type { Presentation } from '../../shared/presentation.ts'

/**
 * What the dialog's four words mean, in one place (D50, Q13).
 *
 * Four rather than sixteen: the policy can express more than this, and until
 * someone has printed enough pages to know which combinations they want twice,
 * offering all of them would be a control panel in a dialog that asks one
 * question.
 */
const POLICIES: Record<AnnotationChoice, Presentation> = {
  clean: PAPER_CLEAN,
  notes: PAPER_NOTES,
  footnotes: PAPER_FOOTNOTES,
  margin: PAPER_MARGIN,
}
import { markdownFromHtml } from './import/html.ts'
import { destination } from './editor/links.ts'
import type { Anomaly } from '../../shared/anomalies.ts'
import { useFrameMetrics } from './frame/useFrame'
import { useTheme, typographyOf } from './theme/useTheme'
import { ThemePanel } from './theme/ThemePanel'

/** A reference in words, for the one place a person is told about a failure. */
function describe(target: Reference): string {
  switch (target.kind) {
    case 'url':
      return target.href
    case 'file':
      return target.path
    case 'section':
      return `the section “${target.name}”`
    case 'anchor':
      return `the bookmark “${target.name}”`
    case 'tag':
      return `the subject “${target.subject}”`
    case 'date':
      return target.date
    case 'heading':
      return `“${target.text}”`
  }
}

/** What the caret is inside, in the order a person would say it. */
export interface Where {
  readonly date: string | null
  readonly headings: readonly string[]
  readonly subjects: readonly string[]
}

const EMPTY_WHERE: Where = { date: null, headings: [], subjects: [] }
const keyOf = (w: Where): string => `${w.date}|${w.headings.join('>')}|${w.subjects.join(',')}`

/**
 * The annotations covering a position (D50, D51).
 *
 * **Read off the window's prose rather than asked of the index**: this runs on
 * every keystroke, the answer is about the place the caret already is, and the
 * window is holding exactly that. The index is for the corpus; this is for
 * here.
 */
function covering(w: DocumentWindow | null, at: DocumentPosition): Where {
  if (w === null) return EMPTY_WHERE
  const buffer = w.toWindow(at)
  if (buffer === null) return EMPTY_WHERE
  const inside = w.prose.annotations.filter(a => a.at.from <= buffer && buffer <= a.at.to)
  return {
    date: inside.find(a => a.kind === 'date')?.date ?? null,
    // Outermost first, which is the order a heading chain is spoken in.
    headings: inside
      .filter(a => a.kind === 'heading')
      .sort((a, b) => a.level - b.level)
      .map(a => a.text),
    subjects: inside.filter(a => a.kind === 'tag').map(a => a.subject),
  }
}

export function App(): React.JSX.Element {
  const [doc, setDoc] = useState<RemoteDocument | null>(null)
  const [pane, setPane] = useState<Pane | null>(null)
  const [vim, setVim] = useState(false)
  const [themeName, setThemeName] = useState<string>(defaultUiState.theme)
  const [panelOpen, setPanelOpen] = useState(false)
  const [anomalies, setAnomalies] = useState<readonly Anomaly[]>([])
  const [anomaliesOpen, setAnomaliesOpen] = useState(false)
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [range, setRange] = useState<DateRangeRequest | null>(null)
  /** Bumped when the document changes, so the sidebar re-asks the index. */
  const [navGeneration, setNavGeneration] = useState(0)
  /** The active row's set, in corpus terms, until the editor can place it. */
  const [track, setTrack] = useState<
    { places: readonly Located[]; current: number; slot: number | null } | null
  >(null)
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

        const state = await window.tephra.doc.loadUiState()
        setVim(state.vim)
        setThemeName(state.theme)
        // **The stored cursor no longer decides where the app opens.** Tephra
        // opens at the append position with yesterday above it, because that is
        // what continuing looks like; landing in the middle of something
        // already finished is the wrong default for a stream. It is still
        // recorded — a true fact about the session, and what navigation will
        // want when it learns to go back to where you were.
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
     * `toWindow` returns null for a segment the window does not cover, which is
     * the containment test; no new API is needed for it.
     */
    const revealing = async (work: Promise<DocumentChange | null>): Promise<void> => {
      const change = await work
      const segment = change?.edits[0]?.span.begin.segment
      if (segment === undefined) return
      const w = pane?.window
      if (w != null && w.toWindow({ segment, offset: 0 as never, generation: w.generation }) !== null) {
        return // already on screen; nothing to go to
      }
      await pane?.goTo({ kind: 'date', date: segment as DateKey })
    }

    return window.tephra.doc.onMenuCommand(command => {
      if (command === 'import') {
        const stored = cursorRef.current
        if (stored === null) return
        const at: DocumentPosition = {
          segment: stored.segment as SegmentKey,
          offset: stored.offset as never,
          generation: doc.generation,
        }
        void window.tephra
          .readClipboard()
          .then(async board => {
            // Rich content is CONVERTED, not refused and not flattened: a
            // pasted article should arrive with its headings, lists and tables
            // intact, because that is what makes it annotatable section by
            // section rather than a wall of text.
            const rich = markdownFromHtml(board.html)
            const text = rich ?? board.text
            if (text.trim() === '') {
              setError('There is nothing on the clipboard to import.')
              return
            }
            // The ORIGINAL is what gets kept: the bytes that arrived, not the
            // conversion, which is derived and lossy by nature (D47).
            const original =
              rich === null
                ? { content: board.text, ext: 'txt' }
                : { content: board.html, ext: 'html' }
            await window.tephra.doc.importText(at, text, original)
          })
          .catch(fail)
      } else if (command === 'printDocument') {
        // The extent is asked for HERE rather than held in state: it grows as
        // the day goes on, and a dialog offering "everything" that stops at
        // whatever was true when the app opened would quietly omit today.
        void window.tephra.doc
          .extent()
          .then(extent => {
            setRange({
              title: 'Print which days',
              submitLabel: 'Print',
              extent,
              onSubmit: (from, to, annotations) => {
                void window.tephra.doc
                  .proseIn(from, to)
                  .then(async days => {
                    if (days.length === 0) {
                      setError('Nothing was written in those days.')
                      return
                    }
                    const how = POLICIES[annotations]
                    const ok = await window.tephra.doc.print({
                      ...printRangePage(days, rangeTitle(days), how),
                      css: PRINT_CSS,
                      paginate: needsPages(how),
                      // Relative links resolve from a day directory, and every
                      // day in the stream sits at the same depth — so the first
                      // day of the range is as good a base as any (Spike B).
                      segment: days[0]!.date,
                    })
                    if (!ok) setError('Those days could not be prepared for printing.')
                  })
                  .catch(fail)
              },
            })
          })
          .catch(fail)
      } else if (command === 'undo') void revealing(doc.undo())
      else if (command === 'redo') void revealing(doc.redo())
      else if (command === 'typography') setPanelOpen(open => !open)
    })
  }, [doc, pane])

  useEffect(() => {
    void window.tephra.hello().then(hello => setMe(hello.author))
  }, [])

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
        const selection = editorRef.current?.selection()
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

      if (id === 'link') {
        const selection = editorRef.current?.selection()
        if (selection === undefined || selection.empty) return
        // Prefilled from the clipboard when it holds one, because the sequence
        // that ends in ⌘K almost always began with copying a URL.
        void window.tephra.readClipboard().then(board => {
          const copied = board.text.trim()
          setPrompt({
            title: 'Link this to',
            placeholder: 'https://…  or  ../../../notes/something.md',
            ...(/^(https?:\/\/|\.{1,2}\/)\S+$/.test(copied) ? { initial: copied } : {}),
            submitLabel: 'Link',
            onSubmit: target => editorRef.current?.wrapSelection('[', `](${destination(target)})`),
          })
        })
        return
      }

      if (id === 'comment') {
        const selection = editorRef.current?.selection()
        if (selection === undefined || selection.empty) return
        // No dialog. The note opens in the margin, empty and ready to type in —
        // the same surface it will be read and edited in ever after (D47). A
        // one-line prompt for something the margin already does properly is the
        // "edit where it is rendered" rule broken by the creation path.
        void window.tephra.doc.startComment(selection.span, '').then(refreshComments).catch(fail)
        return
      }

      if (id === 'print') {
        const selection = editorRef.current?.selection()
        if (selection === undefined || selection.empty) return
        const day = selection.span.begin.segment as DateKey
        void window.tephra.doc
          .print({
            ...printPage(selection.lines, day),
            css: PRINT_CSS,
            segment: day,
          })
          .then(ok => {
            if (!ok) setError('That passage could not be prepared for printing.')
          })
          .catch(fail)
        return
      }

      if (id === 'branch') {
        const selection = editorRef.current?.selection()
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
    (visible: { from: WindowPosition; to: WindowPosition }) => pane?.viewportChanged(visible),
    [pane],
  )

  // Where the caret is, remembered. Debounced because it moves on every
  // keystroke and this is a file write; the last position is the one that
  // matters, not every position on the way there.
  // The margin. Threads come from X; anchors come from the editor's geometry;
  // neither knows about the other, which is what keeps the rail out of the
  // typing path.
  const [threads, setThreads] = useState<readonly CommentThread[]>([])
  const [anchors, setAnchors] = useState<readonly CommentAnchor[]>([])
  const [railHost, setRailHost] = useState<HTMLElement | null>(null)
  const [me, setMe] = useState('')

  const refreshComments = useCallback(() => {
    void window.tephra.doc.comments().then(setThreads).catch(() => setThreads([]))
  }, [])

  // The margin follows the document: a comment made, undone, or arriving from a
  // hand-edit all change the same list, and all of them announce themselves the
  // same way (D45).
  useEffect(() => {
    if (doc === null) return
    refreshComments()
    return docWindow?.onSpansChanged(refreshComments)
  }, [doc, docWindow, refreshComments])

  // The sidebar follows the document too, and for the same reason: a subject
  // applied a moment ago belongs in the list of subjects. The index answers
  // from the loaded segment (D52), so this is a re-ask rather than a rescan.
  useEffect(() => {
    if (doc === null) return
    const bump = (): void => setNavGeneration(n => n + 1)
    bump()
    return docWindow?.onSpansChanged(bump)
  }, [doc, docWindow])

  // And a file nobody has open — a section edited by hand, a note arriving from
  // sync — announces itself directly, because there is no window to do it (D53).
  useEffect(() => window.tephra.nav.onCorpusChanged(() => setNavGeneration(n => n + 1)), [])

  /**
   * Midnight, while the app was open.
   *
   * **The caret is the whole question.** An app left running decided which day
   * it was appending to when its window opened; the next morning's first
   * sentence continued yesterday, and a restart then filed the new day AFTER
   * the text that belonged in it.
   *
   * Main says the day changed; where to go is here, because only this side
   * knows what someone is doing. **The window moves only if the caret is at the
   * append position** — that is what "still writing today's entry" looks like,
   * and it is exactly the state that would otherwise put tomorrow's words in
   * yesterday. A caret anywhere else means someone is working on a passage, and
   * a document that jumped out from under them would be worse than the bug.
   */
  useEffect(() => {
    if (pane === null) return
    return window.tephra.doc.onDayRolled(() => {
      setNavGeneration(n => n + 1)
      const editor = editorRef.current
      const w = pane.window
      if (editor === null || editor === undefined || w === null) return
      const at = editor.selection()
      const buffer = w.toWindow(at.span.begin)
      if (!at.empty || buffer === null || (buffer as number) !== w.text.length) return
      void pane.goToToday()
    })
  }, [pane])

  /**
   * The active set, drawn down the scroll track.
   *
   * **Recomputed when the window moves**, not only when the row changes: growth
   * brings earlier days in behind the reader, and an occurrence that was
   * "somewhere earlier" a moment ago is now a place on this page. Marks that
   * did not follow that would be quietly wrong in the direction people notice.
   */
  useEffect(() => {
    const editor = editorRef.current
    if (editor === null || editor === undefined) return
    if (track === null) {
      editor.showTrackMarks({ places: [], current: -1, beyond: { earlier: 0, later: 0 }, slot: null })
      return
    }
    const w = pane?.window ?? null
    const places: { from: number; to: number }[] = []
    let currentIn = -1
    let earlier = 0
    let later = 0
    const at2 = (date: string, offset: number): WindowPosition | null =>
      w === null
        ? null
        : w.toWindow({ segment: date as unknown as SegmentKey, offset: offset as never, generation: w.generation })
    track.places.forEach((at, i) => {
      const buffer = at.date === null ? null : at2(at.date, at.from)
      if (buffer === null) {
        // Outside the loaded region. Which SIDE it is on is what the edge marks
        // report, and the window's own span is what says.
        const before = w === null || at.date === null || at.date < (w.span.begin.segment as string)
        if (before) earlier += 1
        else later += 1
        return
      }
      if (i === track.current) currentIn = places.length
      // The END of the range too: the mark's height is the passage's height,
      // and a range that leaves the window is clamped by the window's own end.
      const end = at.date === null ? null : at2(at.date, at.to)
      places.push({ from: buffer as number, to: (end ?? buffer) as number })
    })
    editor.showTrackMarks({ places, current: currentIn, beyond: { earlier, later }, slot: track.slot })
  }, [track, pane, docWindow, navGeneration])

  /**
   * The sidebar's one verb, arriving here because it needs both halves: the
   * PANE to load the region the place is in, and the EDITOR to put the caret
   * there once it is loaded (D51).
   *
   * A place already on screen skips the load — jumping to where you already are
   * would throw away the scroll position for nothing.
   */
  const goToLocated = useCallback(
    async (at: Located): Promise<void> => {
      if (at.date === null || pane === null || doc === null) return // notes wait for M3.4
      const where = (generation: SessionGeneration): DocumentPosition => ({
        segment: at.date as unknown as SegmentKey,
        offset: at.from as never,
        generation,
      })
      const held = pane.window
      if (held === null || held.toWindow(where(held.generation)) === null) {
        await pane.goTo({ kind: 'span', doc: doc.id, span: { begin: where(doc.generation), end: where(doc.generation) } })
      }
      const now = pane.window
      const buffer = now === null ? null : now.toWindow(where(now.generation))
      if (buffer !== null) editorRef.current?.revealAt(buffer as number)
    },
    [doc, pane],
  )


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
  const editorRef = useRef<EditorHandle | null>(null)

  /** Day, heading chain and subjects around the caret — the sidebar's top line. */
  const [where, setWhere] = useState<Where>(EMPTY_WHERE)

  const cursorRef = useRef<UiState['cursor']>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCursor = useCallback(
    (at: DocumentPosition) => {
      cursorRef.current = { segment: at.segment as string as never, offset: at.offset as number }
      setWhere(previous => {
        const next = covering(pane?.window ?? null, at)
        // Compared before it is set: this runs on every keystroke, and a new
        // object each time would redraw the panel while someone is typing.
        return keyOf(next) === keyOf(previous) ? previous : next
      })
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
            generation={navGeneration}
            where={where}
            onGo={at => void goToLocated(at)}
            onActive={(places, current, slot) => setTrack({ places, current, slot })}
            onPin={(reference, label) => {
              void window.tephra.nav
                .pin(reference, label)
                // The panel re-reads rather than being told what changed: the
                // file on disk is the fact, and it is the only fact (D53).
                .then(() => setNavGeneration(n => n + 1))
                .catch(fail)
            }}
            onUnpin={(reference, section) => {
              void window.tephra.nav
                .unpin(reference, section)
                .then(() => setNavGeneration(n => n + 1))
                .catch(fail)
            }}
            onUnavailable={(target, why) =>
              setError(
                why === 'missing'
                  ? `That is not there any more: ${describe(target)}`
                  : // Named rather than shrugged at: the gesture is right and the
                    // capability is not built, which is a different thing from a
                    // broken link (D53).
                    `Opening ${describe(target)} arrives with documents beyond the stream.`,
              )
            }
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
            onError={err => setError(err.message)}
            onEditorHandle={handle => (editorRef.current = handle)}
            onMark={setMark}
            onCommentAnchors={setAnchors}
            onRailHost={setRailHost}
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
        {range !== null && <DateRange request={range} onClose={() => setRange(null)} />}
        {railHost !== null &&
          createPortal(
            <Rail
              threads={threads}
              anchors={anchors}
              me={me}
              onChanged={refreshComments}
              onError={fail}
            />,
            railHost,
          )}

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
