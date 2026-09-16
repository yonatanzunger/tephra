// The application shell. Chrome only — the editing surface owns its own DOM.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  WindowPosition, DateKey, DocumentChange, DocumentId, DocumentPosition, DocumentWindow, SegmentKey,
  SessionGeneration,
} from '../../shared/document-api.ts'
import { isOutside, ONLY_SEGMENT, STREAM_ID } from '../../shared/document-api.ts'
import { dayLabel } from '../../shared/dates.ts'
import { defaultUiState, defaultWindowState, type StoredCursor } from '../../shared/ui-state.ts'
import { Documents } from './x/documents'
import type { RemoteStream } from './x/kinds/stream'
import { Pane } from './pane/pane'
import { usePaneBoundary, usePaneLocation, usePaneWindow } from './pane/usePane'
import { surfaceFor } from './editor/kinds/registry.ts'
import type { SurfaceHandle, TextTarget } from './editor/surface.ts'
import { asEditorHandle, type EditorHandle } from './editor/kinds/markdown/range-commands.ts'
import { defaultTypography, type Typography } from './editor/typography.ts'
import { Frame, useStream } from './frame/Frame'
import { Nav } from './frame/Nav'
import { AnomalyBadge, AnomalyList } from './frame/Anomalies'
import { Prompt, type PromptRequest } from './frame/Prompt'
import { Find, type FindControl } from './frame/Find'
import { nameOf } from '../../shared/slug'
import type { DroppedImage } from './editor/kinds/markdown/bind'
import { widgetOptions } from './editor/kinds/markdown/widgets'
import type { Base } from '../../shared/ipc'
import { Results } from './frame/Results'
import type { Hit } from '../../shared/search-api'
import { NO_FIND_MARKS } from './editor/kinds/markdown/find-marks'
import { matchesIn, phraseRegex } from '../../shared/phrase'
import { parseQuery } from '../../shared/query-text'
import { EVERYWHERE } from '../../shared/search-api'
import { Confirm, type ConfirmRequest } from './frame/Confirm'
import { tephra } from './handle'
import type { Located, Reference } from '../../shared/nav-api.ts'
import { DateRange, type DateRangeRequest } from './frame/DateRange'
import { MarkPanel } from './frame/MarkPanel'
import { Rail } from './frame/Rail'
import { createPortal } from 'react-dom'
import type { CommentThread } from '../../shared/comments.ts'
import type { CommentAnchor } from './editor/annotations.ts'
import type { MarkInfo } from './editor/annotations.ts'
import {
  printPage, printRangePage, rangeTitle, needsPages,
  PAPER_CLEAN, PAPER_FOOTNOTES, PAPER_MARGIN, PAPER_NOTES, printCss,
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
import { destination } from '../../shared/links.ts'
import type { Anomaly } from '../../shared/anomalies.ts'
import { useFrameMetrics } from './frame/useFrame'
import { ZoneBar } from './frame/ZoneBar'
import { Links } from './frame/Links'
import type { ZoneNotice } from '../../shared/ipc.ts'
import { useTheme, typographyOf } from './theme/useTheme'
import { forgetAdvances } from './editor/typography'
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
    case 'todo':
      return 'that task'
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
  /** The STREAM, which is what the app opens with and what the title bar dates. */
  const [doc, setDoc] = useState<RemoteStream | null>(null)
  const [pane, setPane] = useState<Pane | null>(null)
  /** Whether this window has learned what it is and gone there (MC6). */
  const [ready, setReady] = useState(false)
  /**
   * How the task list is arranged (MT4a, made sticky).
   *
   * **Here rather than in the surface**, because it is machine-local soft state
   * that outlives the window — the same category as the theme, and it rides
   * home the same way. The surface owns the *control*; what it is set to is a
   * setting, and a setting a window forgets is not one.
   */
  const [listView, setListView] = useState<'time' | 'tag'>('time')
  const [themeName, setThemeName] = useState<string>(defaultUiState.theme)
  const [panelOpen, setPanelOpen] = useState(false)
  const [anomalies, setAnomalies] = useState<readonly Anomaly[]>([])
  const [anomaliesOpen, setAnomaliesOpen] = useState(false)
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [finding, setFinding] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  /** Bumped on every landing, so the marks recompute which one is current. */
  const [findLanded, setFindLanded] = useState(0)
  /** A query and a place, handed to the bar by a results row (MS4). */
  const [findSeed, setFindSeed] = useState<{ text: string; hit: Hit; corpus: boolean } | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchWidth, setSearchWidth] = useState(defaultUiState.searchWidth)
  const findControl = useRef<FindControl | null>(null)
  /**
   * Where the walk last landed — as a DOCUMENT position, not a buffer one.
   *
   * **A buffer offset does not survive the navigation that produced it.** The
   * first version stored one, and choosing a result loaded more days behind the
   * one it landed in: every offset shifted, the remembered 34 no longer matched
   * the real 40, and the landed match drew as an ordinary one. Buffer
   * coordinates are a fact about a window; this has to outlive the window.
   */
  const findHere = useRef<{ segment: SegmentKey; from: number } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
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
  /**
   * **Recomputed once the fonts are in.** The code block's size is solved from
   * the *measured* advance of the body and code faces (D86), and a measurement
   * taken before `Lora` and `JetBrains Mono` arrive measures whatever fallback
   * was standing in — so the block would be sized from the wrong font and look
   * near-right, which is the worst kind of wrong.
   *
   * `document.fonts.ready` settles once per session; this forgets the cached
   * advances and asks for one more pass.
   */
  const [fontsIn, setFontsIn] = useState(false)
  useEffect(() => {
    let live = true
    void document.fonts.ready.then(() => {
      if (!live) return
      forgetAdvances()
      setFontsIn(true)
    })
    return () => {
      live = false
    }
  }, [])
  const typography = useMemo(
    () => typographyOf(theme.draft, theme.face),
    // `fontsIn` is not read: it is here to ask for the recomputation above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme.draft, theme.face, fontsIn],
  )
  const [error, setError] = useState<string | null>(null)
  const [diverged, setDiverged] = useState<{ date: string } | null>(null)
  const [navVisible, setNavVisible] = useState(true)
  const [extent, setExtent] = useState<{ first: DateKey; last: DateKey } | null>(null)
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null)

  /**
   * A task this window asked for exists now, so the words become a link to it.
   *
   * **Written on the way back, not on the way out.** The item cannot be made
   * until the row is committed, and the selection is still here waiting — so
   * this is the only moment both halves exist at once (T13).
   */
  useEffect(
    () =>
      window.tephra.todo.onCaptured(item => {
        editorRef.current?.wrapSelection('[', `](tephra:todo/${item})`)
        setNavGeneration(n => n + 1)
      }),
    [],
  )


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
        const documents = new Documents()
        const opened = await documents.stream()
        const p = new Pane(documents, opened)
        created = p
        setDoc(opened)
        setPane(p)
        // Temporary: the self-check drives this. Goes away with verify.ts.
        tephra.pane = p
        tephra.doc = opened

        // **What THIS window is, asked of main.** A renderer used to know what
        // it was showing by being the only one; with a set of windows, which
        // one this is is main's to say (MC6).
        const info = await window.tephra.win.info()
        tephra.id = info.id
        setListView(info.listView)
        setSearchWidth(info.searchWidth)
        setThemeName(info.theme)
        // **The stored cursor no longer decides where the app opens.** Tephra
        // opens at the append position with yesterday above it, because that is
        // what continuing looks like; landing in the middle of something
        // already finished is the wrong default for a stream. It is still
        // recorded — a true fact about the session, and what navigation will
        // want when it learns to go back to where you were.
        await p.goTo(info.state.location, { push: false })
        setReady(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => created?.release()
  }, [])

  // File ▸ Open… landed on a document. **Main picked it** — the dialog is the
  // OS's and the resolution from a path to a document is the notebook's — so
  // all that is left here is going there (MC6).
  useEffect(() => {
    return window.tephra.win.onOpenDocument(id => {
      void pane?.goTo(id === STREAM_ID ? { kind: 'today' } : { kind: 'document', id }).catch(fail)
    })
  }, [pane])

  // A day changed on disk while we held unsaved edits to it. Surfaced, never
  // resolved (D12): both automatic answers destroy something. Writing to that
  // day has stopped, and it says so rather than failing quietly.
  useEffect(() => {
    return window.tephra.doc.onDiverged(d => setDiverged({ date: d.date }))
  }, [])


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
      // **Asked of the ref, never of `finding`.** This effect's dependencies are
      // `[doc, pane]`, so a closure over that state would be whatever it was
      // when the pane last changed — the same staleness the print command has a
      // note about a few lines below.
      if (command === 'find') {
        // **A second ⌘F focuses rather than reopens**, which is what it does
        // everywhere else: the bar is up with the last thing you looked for in
        // it, and pressing again means *let me type over that*.
        setFinding(true)
        setFindSeed(null)
        findControl.current?.focus()
      } else if (command === 'newDocket') {
        // **Named before it exists** (MH1). A docket is named for a domain —
        // the house, birthdays, speaking engagements — and one called
        // `untitled` is one nobody recognises in the sidebar tomorrow. The
        // prompt is the same one the sidebar's *New File* uses; `dockets/` is
        // decided by the kind, not by a section (`newDocument`).
        setPrompt({
          title: 'Call the new docket',
          placeholder: 'the house · birthdays · speaking',
          submitLabel: 'Create',
          onSubmit: label => {
            void window.tephra.doc
              .newDocument(label, undefined, 'docket')
              // Straight into it, in this window: a docket you just made is one
              // you are about to sit down with.
              .then(async id => {
                await pane?.goTo({ kind: 'document', id })
                setNavGeneration(n => n + 1)
              })
              .catch(fail)
          },
        })
      } else if (command === 'searchAll') {
        // **A panel, not a location**, which is the correction MS4 made to its
        // own first design: a result set is something you keep beside you while
        // reading, and a location would have been navigated away from by the
        // first row you followed.
        setSearching(true)
      } else if (command === 'findEarlier' || command === 'findLater') {
        const direction = command === 'findEarlier' ? 'past' : 'future'
        // **⌘G with no bar opens one** rather than doing nothing: it is the same
        // request, made by somebody who has not typed yet.
        if (findControl.current === null) setFinding(true)
        else findControl.current.step(direction)
      } else if (command === 'import') {
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
      } else if (command === 'renameFile' || command === 'duplicateFile') {
        // **Both are "give it a name", and differ only in what keeps it.**
        // Rename moves this document and rewrites the sections pointing at it;
        // Save a Copy leaves the original exactly where it was.
        const showing = pane?.document
        if (showing == null) return
        const named = showing.title ?? nameOf(showing.id)
        if (command === 'renameFile') askRename(showing.id, named)
        else askCopy(showing.id, named)
      } else if (command === 'deleteFile') {
        const showing = pane?.document
        if (showing == null) return
        askDelete(showing.id, showing.title ?? nameOf(showing.id))

      } else if (command === 'printDocument') {
        // **A window showing a document prints THAT document.** This asked the
        // stream for its extent whatever was on screen, so printing from a note
        // printed the notebook — a command that reads as "print this" and does
        // not. Only the stream has days to choose between, which is why only
        // the stream is asked.
        // **Asked of the live pane, not of a render's value.** This effect's
        // dependencies are `[doc, pane]`, and a pane's document changes without
        // the pane object doing — so a closure over the derived value would be
        // printing whatever was open when the menu was last rebuilt.
        const showing = pane?.document ?? null
        const held = pane?.window ?? null
        if (showing !== null && showing.id !== STREAM_ID && held !== null) {
          const named = showing.title ?? nameOf(showing.id)
          void window.tephra.doc
            .print({
              ...printPage(held.text, named),
              css: printCss(theme.draft.justify, theme.draft.codeFace),
              base: { kind: 'document', id: showing.id },
            })
            .then(ok => {
              if (!ok) setError(`${named} could not be prepared for printing.`)
            })
            .catch(fail)
          return
        }
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
                      css: printCss(theme.draft.justify, theme.draft.codeFace),
                      paginate: needsPages(how),
                      // Relative links resolve from a day directory, and every
                      // day in the stream sits at the same depth — so the first
                      // day of the range is as good a base as any (Spike B).
                      base: { kind: 'day', date: days[0]!.date },
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

      if (id === 'bold' || id === 'italic' || id === 'strike') {
        // The one command that needs nothing but a caret: with no selection it
        // opens the markers and waits inside them.
        // Whichever target is present — a task row is text too (ML, MT5a).
        ;(editorRef.current ?? textRef.current)?.toggleEmphasis(
          id === 'bold' ? '**' : id === 'strike' ? '~~' : '*',
        )
        return
      }

      if (id === 'task') {
        /**
         * **Capture, without leaving the sentence it arrived in** (T13).
         *
         * Two behaviours from one gesture, and the difference is whether the
         * prose IS the task. With a selection those words become the item and
         * the words stay where they are, wrapped in a link to it — a journal
         * that loses a sentence to make a task out of it has been gutted to
         * fill a list. From a bare caret the line is offered in a prompt
         * instead, because a line of prose is rarely phrased as a task, and
         * nothing is written back: linking words that are not the task would
         * point at something that does not say what it points to.
         */
        const selection = editorRef.current?.selection()
        const w = pane?.window
        if (selection === undefined || w === null || w === undefined) return
        const from = w.toWindow(selection.span.begin)
        const to = w.toWindow(selection.span.end)
        const words =
          selection.empty || from === null || to === null
            ? ''
            : w.text.slice(from as number, to as number).trim()

        // **One flow, whichever way it started.** Creating the item outright
        // from a selection was a second flow wearing the same key: no chance to
        // add a tag or a date, no chance to change your mind, and an item put
        // somewhere you could not see. Both paths now open the row in the list
        // — prefilled from the selection, or empty — and both come back here
        // when they are done, committed or abandoned.
        void window.tephra.todo
          .capture(words, words !== '')
          .then(id => window.tephra.win.reveal({ kind: 'document', id }))
          .catch(fail)
        return
      }

      if (id === 'image') {
        const target: TextTarget | null = editorRef.current ?? textRef.current
        const at = baseOf()
        if (target === null || at === null) return
        void window.tephra.doc
          .chooseImage(at)
          .then(got => {
            if (got !== null) target.wrapSelection(`![](${got.link})`, '')
          })
          .catch(fail)
        return
      }

      if (id === 'link') {
        // Whichever target is present: `EditorHandle` satisfies `TextTarget`
        // structurally, so this branches on nothing.
        const target: TextTarget | null = editorRef.current ?? textRef.current
        if (target === null || target.selection().empty) return
        // Prefilled from the clipboard when it holds one, because the sequence
        // that ends in ⌘K almost always began with copying a URL.
        void window.tephra.readClipboard().then(board => {
          const copied = board.text.trim()
          setPrompt({
            title: 'Link this to',
            placeholder: 'https://…  or  ../../../notes/something.md',
            ...(/^(https?:\/\/|\.{1,2}\/)\S+$/.test(copied) ? { initial: copied } : {}),
            submitLabel: 'Link',
            onSubmit: to => target.wrapSelection('[', `](${destination(to)})`),
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
            css: printCss(theme.draft.justify, theme.draft.codeFace),
            // **Where the selection came from**, which for a document is that
            // document — a passage printed out of a note carries the note's
            // images, not a day's.
            base:
              pane?.document != null && pane.document.id !== STREAM_ID
                ? { kind: 'document', id: pane.document.id }
                : { kind: 'day', date: day },
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
   * What main says about the zone (D63), and nothing this side worked out.
   *
   * **Asked once and then listened for.** A window that opens between two polls
   * still has to know, and a window that is already open has to stop showing
   * the offer the moment somebody in another window takes or declines it — the
   * defect being fixed was two windows disagreeing about this, so agreement is
   * the property, not the display.
   */
  const [zoneNotice, setZoneNotice] = useState<ZoneNotice | null>(null)
  useEffect(() => {
    void window.tephra.doc.zoneNotice().then(setZoneNotice).catch(fail)
    return window.tephra.doc.onZoneNotice(setZoneNotice)
  }, [])

  /**
   * Another Tephra has taken the notebook (the lock, `w/lock.ts`).
   *
   * **Terminal, and it covers everything.** Nothing typed after this can be
   * written, so a surface that still accepts typing would be lying — and the
   * one honest thing left to offer is the way out. Main shows a native dialog
   * as well, because a window mid-reload would never render this; the two say
   * the same thing and either one is enough.
   */
  const [lost, setLost] = useState(false)
  useEffect(() => window.tephra.doc.onNotebookLost(() => setLost(true)), [])

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
   * The find's matches, drawn in the text and down the scroll track (MS3).
   *
   * **Scanned from the loaded buffer rather than pulled from the engine**, and
   * the reason is the streaming: asking the engine where every match is would
   * read the corpus to the end, which is exactly what the pull-shaped cursor
   * exists to avoid. What the buffer holds is what the surface can draw, and the
   * two questions have different answers on purpose — the walk goes to places
   * this scan cannot see, and says so by landing there.
   *
   * **One matcher, shared with the engine** (`shared/phrase.ts`), so the marks
   * cannot sit anywhere the walk would not go.
   *
   * **And nothing is marked for a scoped query.** `foo #wombats` means foo
   * *inside* the tagged text, and a buffer scan cannot see the tags — so it
   * would mark every foo on the page, most of them places the walk will not
   * stop. Marking only what is certainly right is better than marking a page
   * full of near-misses.
   */
  useEffect(() => {
    const editor = editorRef.current
    if (editor === null || editor === undefined) return
    const w = pane?.window ?? null
    if (!finding || findQuery.trim() === '' || w === null) {
      editor.showFindMarks(NO_FIND_MARKS)
      // Only ours: a sidebar row's marks are the other owner of this track, and
      // clearing them here would take them away whenever a find ended.
      if (finding) editor.showTrackMarks({ places: [], current: -1, beyond: { earlier: 0, later: 0 }, slot: null })
      return
    }
    const { query } = parseQuery(findQuery, {
      scope: EVERYWHERE,
      order: { kind: 'chronological', origin: 'now', direction: 'past' },
      fold: 'auto',
    })
    const regex = query.scope.tags.length > 0 || query.scope.dates !== null
      ? null
      : phraseRegex(query.find, query.fold)
    // Mapped through the window that is loaded NOW, which is the whole reason
    // this is kept as a document position.
    const landed = findHere.current
    const here =
      landed === null
        ? null
        : w.toWindow({ segment: landed.segment, offset: landed.from as never, generation: w.generation })
    if (regex === null) {
      editor.showFindMarks(
        here === null ? NO_FIND_MARKS : { places: [{ from: here as number, to: here as number }], current: 0 },
      )
      return
    }
    const places = matchesIn(w.text, regex)
    const current = here === null ? -1 : places.findIndex(place => place.from === (here as number))
    editor.showFindMarks({ places, current })
    // **And down the track, which is the same set seen from further away.** The
    // marks in the text say what is on this screen; the track says how the
    // matches are spread through everything loaded, which is the question you
    // ask before deciding whether to keep stepping.
    //
    // `beyond` stays at zero rather than guessing: how many matches lie outside
    // the loaded region is exactly what this scan cannot know, and a number that
    // is wrong in the direction of "there are none" is worse than no number.
    editor.showTrackMarks({ places, current, beyond: { earlier: 0, later: 0 }, slot: null })
  }, [finding, findQuery, findLanded, pane, docWindow, navGeneration])

  /**
   * The sidebar's one verb, arriving here because it needs both halves: the
   * PANE to load the region the place is in, and the EDITOR to put the caret
   * there once it is loaded (D51).
   *
   * A place already on screen skips the load — jumping to where you already are
   * would throw away the scroll position for nothing.
   */
  /**
   * Go to a place the index found — in any document, not only in a day.
   *
   * **A dateless place is a place in some other document** (D54): the index
   * scans every file, and a span in a note used to be dropped here because the
   * pane had one document to offer. Which document it is is the file itself,
   * whose one segment is the constant every one-segment kind uses (D27).
   */
  /**
   * Where a relative link written at the caret would resolve from (R7).
   *
   * **The day the caret is in, not today**, for the stream: a picture pasted
   * while reading last Tuesday belongs to a link that works from Tuesday's file.
   * Everything else resolves from its own path, which is what it is called.
   */
  const baseOf = useCallback((): Base | null => {
    const showing = pane?.document ?? null
    if (showing === null) return null
    if (showing.id !== STREAM_ID) return { kind: 'document', id: showing.id }
    const segment = cursorRef.current?.segment ?? doc?.today ?? null
    return segment === null ? null : { kind: 'day', date: segment as DateKey }
  }, [pane, doc])

  /**
   * Where this document's relative image links resolve from (R7).
   *
   * **Fetched once per document, not once per picture**, because a widget draws
   * synchronously and cannot wait for a round trip. Set on `widgetOptions`,
   * which is module state the decoration builders already read — mutable on
   * purpose, and per window, since each window is its own renderer.
   */
  useEffect(() => {
    const at = baseOf()
    if (at === null) {
      widgetOptions.imageBase = ''
      return
    }
    let live = true
    void window.tephra.doc
      .linkBase(at)
      .then(base => {
        if (!live) return
        widgetOptions.imageBase = base
        // Redraw: the pictures already on screen were placed against the old
        // base, which for the first document is no base at all.
        editorRef.current?.rebuildWidgets()
      })
      .catch(fail)
    return () => {
      live = false
    }
  }, [baseOf, docWindow])

  /**
   * A picture arrived: write it, then insert a link to it at the caret (R7).
   *
   * **Two acts, deliberately separate.** Main writes the file and answers with a
   * relative link; the surface puts that link in through the ordinary edit path,
   * so undo undoes it, the journal records it, and nothing about a picture needs
   * to know which kind of document it landed in.
   */
  const putImages = useCallback(
    async (images: readonly DroppedImage[]): Promise<void> => {
      const target: TextTarget | null = editorRef.current ?? textRef.current
      const at = baseOf()
      if (target === null || at === null) return
      for (const image of images) {
        const got = await window.tephra.doc.attachImage({ base: at, ...image })
        target.wrapSelection(`![](${got.link})`, '')
      }
    },
    [baseOf],
  )

  const goToLocated = useCallback(
    async (at: Located, select = false): Promise<void> => {
      if (pane === null || doc === null) return
      const inStream = at.date !== null
      const id = inStream ? doc.id : (at.file as unknown as DocumentId)
      const segment = (inStream ? at.date : ONLY_SEGMENT) as unknown as SegmentKey
      const where = (generation: SessionGeneration): DocumentPosition => ({
        segment,
        offset: at.from as never,
        generation,
      })
      const held = pane.window
      const showing = held !== null && pane.document?.id === id && held.toWindow(where(held.generation)) !== null
      if (!showing) {
        // **A query pane has no document to take a generation from**, and this
        // is the path a link directory row uses to reach where it was written.
        // The stream's answers for it: the generation is a staleness claim, and
        // the read that follows re-establishes it.
        const g = pane.document?.generation ?? doc.generation
        await pane.goTo({ kind: 'span', doc: id, span: { begin: where(g), end: where(g) } })
      }
      const now = pane.window
      const buffer = now === null ? null : now.toWindow(where(now.generation))
      if (buffer === null) return
      // **A find match is MARKED, not selected.** The caret goes back to the
      // search field so the next keystroke is another search, which leaves an
      // unfocused selection painting flat grey over the mark underneath it —
      // so the range is remembered here and drawn by `find-marks.ts` instead.
      if (select) findHere.current = { segment, from: at.from }
      editorRef.current?.revealAt(buffer as number)
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

  // ── the file lifecycle, wherever it is asked for ─────────────────────────
  //
  // **One implementation, two ways in.** The File menu acts on the document
  // this window is showing; the sidebar acts on the row you right-clicked. That
  // is the only difference between them, and it is entirely in WHICH document
  // gets passed — so these take one and neither knows which gesture called it.
  //
  // Two implementations would be two chances for only one of them to rewrite
  // the sections pointing at a renamed file, which is the failure this whole
  // milestone exists to prevent (D13).

  /** The stream is not a file, and a file outside the notebook is not ours. */
  const ours = (id: DocumentId): boolean => id !== STREAM_ID && !isOutside(id)

  const rename = (id: DocumentId, label: string): void => {
    if (!ours(id)) return
    void window.tephra.doc
      .renameDocument(id, label)
      .then(async made => {
        // **The window follows the document it is SHOWING, and only that one.**
        // A rename changes a document's identity, so a window left on the old
        // id is looking at nothing — but renaming a file from the sidebar while
        // reading a different one is not a reason to leave the one you are
        // reading.
        if (pane?.document?.id === id) await pane.goTo({ kind: 'document', id: made })
        setNavGeneration(n => n + 1)
      })
      .catch(fail)
  }

  /**
   * The same rename, for the callers who have to ask for the name first.
   *
   * The File menu acts on a document whose name is not being typed anywhere, so
   * it needs a field to type it in; the sidebar's in-place edit already has
   * one, and calls `rename` directly.
   */
  const askRename = (id: DocumentId, name: string): void => {
    if (!ours(id)) return
    setPrompt({
      title: 'Rename this to',
      initial: name,
      submitLabel: 'Rename',
      onSubmit: label => rename(id, label),
    })
  }

  const askCopy = (id: DocumentId, name: string): void => {
    if (!ours(id)) return
    setPrompt({
      title: 'Save a copy called',
      initial: name,
      submitLabel: 'Save a Copy',
      onSubmit: label => {
        void window.tephra.doc
          .duplicateDocument(id, label)
          // Nowhere to go: `Save a Copy` leaves you in the document you were
          // working in, which is what the name says and what makes it different
          // from `Save As`.
          .then(() => setNavGeneration(n => n + 1))
          .catch(fail)
      },
    })
  }

  const askDelete = (id: DocumentId, name: string): void => {
    if (!ours(id)) return
    setConfirm({
      title: `Delete ${name}?`,
      // Said plainly, because it is true and it is the thing a person wants to
      // know: the file goes, and the sections naming it will say so rather than
      // quietly losing the entry (D7).
      detail:
        'The file is removed from your notebook. Any section that names it will ' +
        'show the entry as not found, rather than dropping it.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        void window.tephra.doc
          .deleteDocument(id)
          .then(async () => {
            // Only the window that was reading it has to leave.
            if (pane?.document?.id === id) await pane.goToToday()
            setNavGeneration(n => n + 1)
          })
          .catch(fail)
      },
    })
  }

  // How to ask the editor what is selected, for as long as one is mounted.
  const editorRef = useRef<EditorHandle | null>(null)
  /** A plain text field a range command can write into, when a surface has one open. */
  const textRef = useRef<TextTarget | null>(null)

  /** Day, heading chain and subjects around the caret — the sidebar's top line. */
  const [where, setWhere] = useState<Where>(EMPTY_WHERE)

  const cursorRef = useRef<StoredCursor | null>(null)
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
      saveTimer.current = setTimeout(() => reportRef.current(), 600)
    },
    // `pane` stays: the where-you-are line is computed from the window this
    // caret is in, and a stale closure over a null pane leaves it blank —
    // which is what the empty foot of the panel was.
    [pane],
  )

  /** Whether what is on screen can be read but not written (MC6). */
  const readOnly = docWindow?.document.meta.readOnly === true

  /**
   * What the title bar says we are looking at.
   *
   * **The day the CARET is in, not the day we navigated to.** The two disagree
   * the moment you scroll: the location stays `today` while you read back into
   * last week, and the bar went on claiming today — with the panel's own footer
   * correctly saying otherwise, two feet away. `where.date` is what that footer
   * uses, so this is the same answer rather than a second one.
   *
   * A document is whatever it calls itself, falling back to its filename, which
   * is the only other name it has.
   */
  const showingDoc = pane?.document ?? null
  const title =
    // **A window can be showing a query** (ML3), which has no document to be
    // named after and is called what it is.
    location?.kind === 'links'
      ? 'Links'
      : // **Asked of the DOCUMENT, not of how we arrived at it.** This tested
        // the location's kind, so a window reached by a span — which is how the
        // sidebar opens a note and how every link-directory row opens anything
        // — fell through to the date logic and called a task list "5 Sep".
        showingDoc !== null && showingDoc.id !== STREAM_ID
      ? (showingDoc.title ?? nameOf(showingDoc.id))
      : where.date !== null
        ? dayLabel(where.date as DateKey, doc?.today)
        : location?.kind === 'date'
          ? dayLabel(location.date, doc?.today)
          : doc === null
            ? '…'
            : dayLabel(doc.today, doc.today)

  /**
   * Tell main what this window is showing, and what to call it.
   *
   * **Its own entry, and nothing else's.** Main holds the set and decides what
   * is the machine's — the theme, the list's arrangement — from whatever
   * changed last; a renderer
   * that wrote the whole file would erase every other window each time the
   * caret moved (MC6). The name is the title bar's, because a window is called
   * what it is showing.
   */
  const reportRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    // **Nothing to say until it knows what it is.** The first render happens
    // before `win.info()` comes back, when the pane still says "today" — and a
    // report then overwrites the very target this window was opened to show.
    // That is how a window opened on a note came back as a second stream.
    if (!ready) return
    reportRef.current = (): void => {
      tephra.name = title
      const showing = pane?.document?.id
      window.tephra.win.report({
        location: location ?? defaultWindowState.location,
        cursor: cursorRef.current,
        name: title === '…' ? 'Tephra' : title,
        // What `Import` would act on, said by the window that knows: only a
        // document from outside the notebook can be brought into it (MC6).
        importable: showing !== undefined && isOutside(showing) ? showing : null,
        // Rename and Delete apply to a document of OURS: not the stream, which
        // is not a file, and not one from outside, which is not ours to move.
        renamable:
          showing !== undefined && showing !== STREAM_ID && !isOutside(showing) ? showing : null,
        listView,
        searchWidth,
        theme: themeName,
      })
    }
    reportRef.current()
  }, [ready, pane, location, title, listView, searchWidth, themeName])

  // The position must also survive a quit that beats the debounce.
  useEffect(() => {
    const flushState = (): void => reportRef.current()
    window.addEventListener('beforeunload', flushState)
    return () => {
      window.removeEventListener('beforeunload', flushState)
      flushState()
    }
  }, [])

  if (error !== null) {
    return (
      <main className="scaffold">
        <h1>Tephra</h1>
        <p className="bad">{error}</p>
      </main>
    )
  }

  // **Which surface, decided from the document rather than assumed.** Every kind
  // is running text today, so this is always the markdown one — but it is a
  // lookup, so the first kind that is shown some other way is a file and a line
  // in the registry rather than another flag inside the editor (D54).
  const Surface = docWindow === null ? null : surfaceFor(docWindow.document.meta.kind)


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
        {/* **The constraint and the way out of it are the same control.** A
            file from outside the notebook is read-only because this app cannot
            keep its promises about a file it does not manage — no history, no
            versions, no index. Saying so is only half of it; the other half is
            that the fix is one click away, and it is here rather than buried in
            a menu because this is where the reader learns they need it (MC6). */}
        {readOnly && (
          <button
            type="button"
            className="pill control badge readonly"
            title="This file is outside your notebook: it can be read, but not changed. Import it to keep it here."
            onClick={() => void window.tephra.win.import().catch(fail)}
          >
            Read-only · Import
          </button>
        )}
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
        insetRight={searching ? searchWidth + 22 : 0}
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
            onOpenDocument={id => void pane?.goTo({ kind: 'document', id }).catch(fail)}
            // Straight to the append position. `goToToday` reopens the window
            // even when today is already showing, and the stream's surface
            // lands at the end — which is the whole of what "now" means, and
            // why this needs no special case in the editor (MC6, Q7).
            onNow={() => void pane?.goToToday().catch(fail)}
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
            // The same acts the File menu drives, on the row you asked from.
            onAskRename={askRename}
            onRename={rename}
            onCopy={askCopy}
            onDelete={askDelete}
            onRelabel={(reference, label, section) => {
              void window.tephra.nav
                .relabel(reference, label, section)
                .then(() => setNavGeneration(n => n + 1))
                .catch(fail)
            }}
            onNewFile={section => {
              setPrompt({
                title: 'Call the new file',
                placeholder: 'what this one is about',
                submitLabel: 'Create',
                onSubmit: label => {
                  void window.tephra.doc
                    .newDocument(label, section ?? undefined)
                    // **Straight into it.** A file you just made is one you are
                    // about to write in, and the sidebar shows where it went.
                    .then(async id => {
                      await pane?.goTo({ kind: 'document', id })
                      setNavGeneration(n => n + 1)
                    })
                    .catch(fail)
                },
              })
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
        {zoneNotice !== null && (
          <ZoneBar
            notice={zoneNotice}
            onAdopt={() => void window.tephra.doc.setZone(zoneNotice.system).catch(fail)}
            onDismiss={() => void window.tephra.doc.dismissZone().catch(fail)}
          />
        )}

        {/* **In the flow rather than over the text**, and below any notice. An
            overlay in the top corner sat on top of the zone bar, and a find bar
            that covers the words you are looking for is the wrong shape for a
            surface whose whole job is reading. */}
        {finding && (
          <Find
            // The reading column already stops short of the panel, so the bar
            // needs no inset of its own.
            inset={0}
            control={findControl}
            seed={findSeed}
            document={(pane?.document?.id ?? null) as string | null}
            origin={() => cursorRef.current}
            onGo={async hit => {
              await goToLocated(hit.at, true)
              // Landing is what decides which mark is the current one, and the
              // query has not changed — so the effect is nudged rather than
              // waited on.
              setFindQuery(q => q)
              setFindLanded(n => n + 1)
            }}
            onQuery={setFindQuery}
            onClose={() => {
              setFinding(false)
              setFindSeed(null)
              findHere.current = null
            }}
          />
        )}

        {boundary?.earlier.kind === 'extendable' && (
          <button className="edge" onClick={() => void pane?.extend('earlier')}>
            ▲ earlier
          </button>
        )}
        {boundary?.earlier.kind === 'extending' && <div className="edge quiet">loading…</div>}

        {location?.kind === 'links' ? (
          // **A location that is not a document draws something that is not a
          // surface** (ML3). Everything around it — the frame, the sidebar, the
          // title bar, back and forward — is unchanged, which is the point:
          // every filtered view after this one inherits the same shape.
          <Links
            // **The notebook's own type, not a second set of numbers** (D41).
            // The task list learned this the hard way: a hard-coded size made
            // it quietly a different app from the notebook beside it, and made
            // the theme panel's sliders lie about what they controlled.
            typography={typography}
            today={doc?.clockDay ?? null}
            onError={setError}
            // A link into the corpus is this app's to open (D54), and where it
            // goes is a document — the same act the sidebar performs.
            onOpenDocument={id => void pane?.goTo({ kind: 'document', id }).catch(fail)}
            onGoTo={(at, elsewhere) => {
              // **The DOCUMENT it was written in, which is not always the file**
              // — for a task list or the notebook the document is the directory
              // and the file is one of its segments (D59). Opening the file path
              // as a document is what produced `ENOTDIR` on a link written in a
              // task; main answers both now, so this does not have to guess.
              if (elsewhere) {
                void window.tephra.win.create(
                  at.at.date !== null ? { kind: 'date', date: at.at.date } : { kind: 'document', id: at.doc },
                )
                return
              }
              if (pane === null) return
              const where = (generation: SessionGeneration): DocumentPosition => ({
                segment: at.segment as unknown as SegmentKey,
                offset: at.at.from as never,
                generation,
              })
              const g = pane.document?.generation ?? doc?.generation
              if (g === undefined) return
              void pane
                .goTo({ kind: 'span', doc: at.doc, span: { begin: where(g), end: where(g) } })
                .then(() => {
                  const now = pane.window
                  const buffer = now === null ? null : now.toWindow(where(now.generation))
                  if (buffer !== null) editorRef.current?.revealAt(buffer as number)
                })
                .catch(fail)
            }}
          />
        ) : docWindow === null || Surface === null ? (
          <main className="scaffold">
            <p className="sub">Opening…</p>
          </main>
        ) : (
          <Surface
            window={docWindow}
            settings={{ typography, listView, onListView: setListView }}
            onViewport={onViewport}
            onCursor={onCursor}
            onError={(err: Error) => setError(err.message)}
            // **Narrowed at runtime, not asserted.** The range commands are
            // text commands; a surface that is not text has no selection to
            // wrap, and the honest answer there is a null handle and greyed
            // menu items rather than a cast that would be a lie (D54).
            onHandle={(handle: SurfaceHandle | null) => (editorRef.current = asEditorHandle(handle))}
            // **And a surface that is not text can still hold some.** A task
            // being edited is an `<input>`, and ⌘K means there what it means in
            // the notebook — so a range command takes whichever target is
            // present rather than knowing which surface it is talking to (ML).
            onTextTarget={(target: TextTarget | null) => (textRef.current = target)}
            annotations={{ onMark: setMark, onCommentAnchors: setAnchors, onRailHost: setRailHost }}
            onImages={images => void putImages(images).catch(fail)}
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
        {lost && (
          <div className="lost-scrim" role="alertdialog" aria-modal="true" aria-label="Notebook taken over">
            <div className="lost">
              <h2>Another copy of Tephra has taken over this notebook.</h2>
              <p>
                This window has stopped saving, so the two copies cannot write over each other.
                Anything typed since it stopped is still on screen and has not been written.
              </p>
              <button type="button" onClick={() => void window.tephra.win.quit()}>
                Quit
              </button>
            </div>
          </div>
        )}
        {prompt !== null && <Prompt request={prompt} onClose={() => setPrompt(null)} />}
        {confirm !== null && <Confirm request={confirm} onClose={() => setConfirm(null)} />}
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

        {searching && (
          <Results
            width={searchWidth}
            onWidth={setSearchWidth}
            face={typography.font}
            today={doc?.clockDay ?? null}
            onError={setError}
            onClose={() => setSearching(false)}
            onGoTo={(hit, query, elsewhere) => {
              if (elsewhere) {
                void window.tephra.win.create(
                  hit.at.date !== null
                    ? { kind: 'date', date: hit.at.date }
                    : { kind: 'document', id: hit.at.file as unknown as DocumentId },
                )
                return
              }
              // **The panel stays.** Following a row is a question asked of
              // the list, not a departure from it — which is the whole reason
              // this is a panel and not a place.
              void goToLocated(hit.at, true)
                .then(() => {
                  setFindQuery(query)
                  setFindSeed({ text: query, hit, corpus: true })
                  setFinding(true)
                  setFindLanded(n => n + 1)
                })
                .catch(fail)
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
