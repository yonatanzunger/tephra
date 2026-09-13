// The only bridge between Z and X. Nothing here does work; it forwards.
//
// Callbacks cannot cross contextBridge, so events arrive on ipcRenderer here
// and are re-dispatched to handlers the renderer registered through this object.

import { contextBridge, ipcRenderer } from 'electron'
import type { Anomaly } from '../shared/anomalies.ts'
import type { SelectionState } from '../shared/commands.ts'
import type {
  Attached, Base, Clipboard, DayProse, DocketRow, ImageAttachment, PrintJob, SearchBatch,
  SearchOpened, SearchRequest, ZoneNotice,
} from '../shared/ipc.ts'
import type { Matter, Mode, NewMatter, Section, StepKind } from '../shared/kinds/docket.ts'
import type { QueryId } from '../shared/search-api.ts'
import type {
  Followed, IndexStatus, LinkRow, Located, OutlineNode, Reference, SectionTree, Subject, ThreadRow, TimelineDay,
} from '../shared/nav-api.ts'
import type { CommentId, CommentThread } from '../shared/comments.ts'
import type { Theme } from '../shared/theme.ts'
import type { HorizonRow } from '../shared/horizon-api.ts'
import { CHANNEL } from '../shared/ipc.ts'
import type {
  ChangeAck, DocumentInfo, EditAck, EditRequest, ExtendRequest, ReadRequest,
  SpansRequest, WindowChangedMessage, WindowId, WindowInfo, WindowReport, WindowSnapshot,
} from '../shared/ipc.ts'
import type { NavTarget } from '../shared/pane-api.ts'
import type { DateKey, Divergence, DocumentId, DocumentPosition, SegmentKey, Span, TypedSpan, VersionId } from '../shared/document-api.ts'
import type { RestoreReport, Version } from '../shared/history-api.ts'
import type { UiState } from '../shared/ui-state.ts'
import type { ResolvedItem, TodoItem, TodoStatus, WalkState } from '../shared/kinds/todo.ts'

type Handler<T> = (message: T) => void

const changedHandlers = new Set<Handler<WindowChangedMessage>>()
const resetHandlers = new Set<Handler<{ id: WindowId }>>()
const divergedHandlers = new Set<Handler<Divergence>>()

ipcRenderer.on(CHANNEL.windowChanged, (_e, message: WindowChangedMessage) => {
  for (const handler of changedHandlers) handler(message)
})
ipcRenderer.on(CHANNEL.windowReset, (_e, message: { id: WindowId }) => {
  for (const handler of resetHandlers) handler(message)
})
ipcRenderer.on(CHANNEL.diverged, (_e, message: Divergence) => {
  for (const handler of divergedHandlers) handler(message)
})

const rangeHandlers = new Set<Handler<string>>()
ipcRenderer.on(CHANNEL.rangeCommand, (_e, id: string) => {
  for (const handler of rangeHandlers) handler(id)
})

const menuHandlers = new Set<Handler<string>>()
ipcRenderer.on(CHANNEL.menuCommand, (_e, command: string) => {
  for (const handler of menuHandlers) handler(command)
})

const tephra = {
  hello: (): Promise<{ version: string; origin: string; author: string }> =>
    ipcRenderer.invoke('tephra:hello'),
  /** What the clipboard holds. Converting it is the renderer's job. */
  readClipboard: (): Promise<Clipboard> => ipcRenderer.invoke(CHANNEL.readClipboard),
  /** Open the system's emoji picker. It types into whatever has focus. */
  emojiPanel: (): Promise<boolean> => ipcRenderer.invoke(CHANNEL.emojiPanel),
  /** Follow a link found in the text. Main decides whether it may be followed. */
  openLink: (target: string): Promise<boolean> => ipcRenderer.invoke(CHANNEL.openLink, target),
  /** Self-check only. What each window holds, for comparing against main. */
  diagnose: (): Promise<unknown> => ipcRenderer.invoke('tephra:verify:diagnose'),
  /** Verify only: seed the clipboard, and get back what was on it. */
  setClipboard: (next: Clipboard | null): Promise<Clipboard> =>
    ipcRenderer.invoke('tephra:verify:clipboard', next),
  /** Self-check only; the handler exists only when TEPHRA_VERIFY is set. */
  clickMenu: (label: string): Promise<boolean> => ipcRenderer.invoke('tephra:verify:menu', label),

  /**
   * The sidebar's half of the world (D51): what the corpus contains, and where.
   *
   * Its own namespace rather than more of `doc`, because these are questions
   * about the CORPUS — a bookmark in a note is a legitimate answer, and no
   * document is holding that note open.
   */
  /**
   * A running query (MS3, D65).
   *
   * **Pull, not push**, which is why there is no `onHit`. The walk asks for one
   * and gets one; a pane asks for a screenful and gets a screenful; and the scan
   * in main never reads further than it was asked to. Whoever opens one closes
   * it — though a window closing does it too, so a renderer that goes away
   * without tidying leaks nothing.
   */
  search: {
    open: (request: SearchRequest): Promise<SearchOpened> =>
      ipcRenderer.invoke(CHANNEL.searchOpen, request),
    next: (id: QueryId, count: number): Promise<SearchBatch> =>
      ipcRenderer.invoke(CHANNEL.searchNext, id, count),
    close: (id: QueryId): Promise<void> => ipcRenderer.invoke(CHANNEL.searchClose, id),
  },

  /**
   * The horizon (MH2, H8, D74) — **its own thing, not a corner of `nav`.**
   *
   * It is not navigation and it is not a docket verb: it is a query over
   * everything dated, which dockets and the task list both implement. Nesting it
   * under either would make one of its sources look like its owner.
   */
  horizon: (from: DateKey, to: DateKey): Promise<readonly HorizonRow[]> =>
    ipcRenderer.invoke(CHANNEL.horizon, from, to),

  nav: {
    subjects: (): Promise<readonly Subject[]> => ipcRenderer.invoke(CHANNEL.navSubjects),
    bookmarks: (): Promise<readonly { name: string; at: Located }[]> =>
      ipcRenderer.invoke(CHANNEL.navBookmarks),
    /** The days, oldest first, each with the headings written in it. Days only. */
    timeline: (): Promise<readonly TimelineDay[]> => ipcRenderer.invoke(CHANNEL.navTimeline),
    /** The link directory: every destination, newest first by last appearance (R10a). */
    links: (): Promise<readonly LinkRow[]> => ipcRenderer.invoke(CHANNEL.navLinks),
    threads: (): Promise<readonly ThreadRow[]> => ipcRenderer.invoke(CHANNEL.navThreads),
    occurrences: (reference: Reference): Promise<readonly Located[]> =>
      ipcRenderer.invoke(CHANNEL.navOccurrences, reference),
    status: (): Promise<IndexStatus> => ipcRenderer.invoke(CHANNEL.navStatus),
    /** The curated half: sections, resolved into a tree (D53). */
    sections: (): Promise<SectionTree> => ipcRenderer.invoke(CHANNEL.navSections),
    /** Put a reference into a section — an append to a markdown file (D53). */
    pin: (reference: Reference, label: string, section?: string): Promise<'pinned' | 'already'> =>
      ipcRenderer.invoke(CHANNEL.navPin, reference, label, section),
    /** Take one out again — the same act, one line removed (D53). */
    unpin: (reference: Reference, section?: string): Promise<boolean> =>
      ipcRenderer.invoke(CHANNEL.navUnpin, reference, section),
    /**
     * Change what an entry is CALLED here, without moving it or touching what
     * it points at. The section is required rather than defaulted: relabelling
     * is always done to a row you are looking at, which knows the file it is in.
     */
    relabel: (reference: Reference, label: string, section: string): Promise<boolean> =>
      ipcRenderer.invoke(CHANNEL.navRelabel, reference, label, section),
    /** Follow a reference that leaves the app: a URL, or a file the OS owns. */
    /**
     * `from` is the document the reference was READ IN, because a relative link
     * means "relative to the file it is written in" — a section's entry and a
     * day's link resolve from different places (D53).
     */
    open: (reference: Reference, from?: string): Promise<Followed> =>
      ipcRenderer.invoke(CHANNEL.navOpen, reference, from),
    /** Every document there is, with what it calls itself — the Open… list. */
    documents: (): Promise<readonly { id: DocumentId; title: string }[]> =>
      ipcRenderer.invoke(CHANNEL.navDocuments),
    /**
     * A document was written to, by anybody.
     *
     * **For surfaces that read through verbs**: a docket redraws from what the
     * service tells it, so without this it sits stale while another window — or
     * generation, in the background — writes to the same file.
     */
    onDocumentsChanged(handler: Handler<readonly DocumentId[]>): () => void {
      const listener = (_e: unknown, m: { documents: readonly DocumentId[] }): void =>
        handler(m.documents)
      ipcRenderer.on(CHANNEL.documentsChanged, listener)
      return () => ipcRenderer.removeListener(CHANNEL.documentsChanged, listener)
    },
    /** Something changed on disk that no window is holding open (D53). */
    onCorpusChanged(handler: Handler<readonly string[]>): () => void {
      const listener = (_e: unknown, paths: readonly string[]): void => handler(paths)
      ipcRenderer.on(CHANNEL.corpusChanged, listener)
      return () => ipcRenderer.removeListener(CHANNEL.corpusChanged, listener)
    },
  },

  /**
   * This window, and the others (MC6).
   *
   * A renderer used to know what it was showing by being the only one; with a
   * set of windows, which one this is is main's to say.
   */
  win: {
    info: (): Promise<WindowInfo> => ipcRenderer.invoke(CHANNEL.windowInfo),
    /** Fire and forget: losing a cursor position is cheap and self-correcting. */
    report: (report: WindowReport): void => ipcRenderer.send(CHANNEL.windowReport, report),
    create: (target?: NavTarget): Promise<void> => ipcRenderer.invoke(CHANNEL.windowCreate, target),
    /** The one thing left to offer once the notebook has been taken away. */
    quit: (): void => ipcRenderer.send(CHANNEL.quit),
    /** Bring it to the front, in the window that already has it or a new one. */
    reveal: (target: NavTarget): Promise<void> => ipcRenderer.invoke(CHANNEL.windowReveal, target),
    /** This window was brought forward — by ⌘1, or by somebody capturing a task. */
    onRevealed(handler: () => void): () => void {
      const listener = (): void => handler()
      ipcRenderer.on(CHANNEL.revealed, listener)
      return () => ipcRenderer.removeListener(CHANNEL.revealed, listener)
    },
    /** Bring in what this window is showing — the read-only badge's gesture. */
    import: (): Promise<void> => ipcRenderer.invoke(CHANNEL.windowImport),
    /** Main picked a document for this window to show (File ▸ Open…). */
    onOpenDocument(handler: Handler<DocumentId>): () => void {
      const listener = (_e: unknown, id: DocumentId): void => handler(id)
      ipcRenderer.on(CHANNEL.openDocument, listener)
      return () => ipcRenderer.removeListener(CHANNEL.openDocument, listener)
    },
    close: (): Promise<void> => ipcRenderer.invoke(CHANNEL.windowClose),
  },

  /**
   * The task list (MT3).
   *
   * **Named verbs over one channel.** The wire is a union and this is where it
   * stops being one: a caller writes `todo.setStatus(list, id, 'done')`, which
   * is the document's own vocabulary, and never composes a command object.
   */
  /**
   * Dockets (MH1, D68) — the task list's bridge shape, because it is the same
   * kind of traffic: a list of rows, each gesture one small edit to one row.
   */
  docket: {
    /** Every docket, by what it is called. */
    list: (): Promise<readonly DocketRow[]> => ipcRenderer.invoke(CHANNEL.docket, { kind: 'list' }),
    matters: (docket: DocumentId): Promise<readonly Matter[]> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'matters', docket }),
    /** `when` as a person types it, parsed in main so there is one grammar. */
    /** `section` is where it goes; absent means the undivided run (MH1). */
    add: (docket: DocumentId, name: string, shape?: NewMatter, section?: string): Promise<string> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'add', docket, name, shape, section }),
    rename: (docket: DocumentId, matter: string, name: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'rename', docket, matter, name }),
    /** Which of the four kinds of thing a matter is. */
    setMode: (docket: DocumentId, matter: string, mode: Mode): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'mode', docket, matter, mode }),
    /** The next instance, or none. No start date is the whole of *inactive*. */
    setStart: (docket: DocumentId, matter: string, start: string | null): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'start', docket, matter, start }),
    /** Move a matter to another docket (MH5). Returns its id in the new one. */
    moveTo: (docket: DocumentId, matter: string, to: DocumentId): Promise<string | null> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'moveTo', docket, matter, to }),
    /** The instances, listed outright (H7). Setting them clears any interval. */
    setDates: (docket: DocumentId, matter: string, dates: readonly DateKey[]): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'dates', docket, matter, dates }),
    /** How often it comes round, as typed. */
    setEvery: (docket: DocumentId, matter: string, every: string | null): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'every', docket, matter, every }),
    /** Which step's completion starts the next instance (Qa). */
    setAfter: (docket: DocumentId, matter: string, after: string | null): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'after', docket, matter, after }),
    /** Reconcile the list with the dockets. Unattended in life; here to test. */
    generate: (): Promise<{ made: readonly string[]; withdrawn: readonly string[] }> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'generate' }),
    /** Move a recurring matter on to its next instance. */
    advance: (docket: DocumentId, matter: string): Promise<DateKey | null> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'advance', docket, matter }),
    setOwner: (docket: DocumentId, matter: string, owner: string | null): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'owner', docket, matter, owner }),
    setLink: (docket: DocumentId, matter: string, link: string | null): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'link', docket, matter, link }),
    tag: (docket: DocumentId, matter: string, subject: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'tag', docket, matter, subject }),
    untag: (docket: DocumentId, matter: string, subject: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'untag', docket, matter, subject }),
    remove: (docket: DocumentId, matter: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'remove', docket, matter }),
    /** The prose under a matter — the quote, what the plumber said. Not parsed. */
    setNotes: (docket: DocumentId, matter: string, notes: readonly string[]): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'notes', docket, matter, notes }),
    /**
     * *At this moment, this happens* (D76). `when` as typed: `2w`, `+3d`,
     * `right away`, or `after <step id>` optionally `+90d`.
     */
    addStep: (
      docket: DocumentId, matter: string, when: string, text: string, stepKind?: StepKind,
    ): Promise<string> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'addStep', docket, matter, when, text, stepKind }),
    /** Fix what a step says. Keeps its id, its schedule and its stamp. */
    editStep: (docket: DocumentId, matter: string, step: string, text: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'editStep', docket, matter, step, text }),
    /** Reschedule one step, as typed. */
    setStepWhen: (docket: DocumentId, matter: string, step: string, when: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'stepWhen', docket, matter, step, when }),
    /** Change which of the three kinds a step is — how a `reschedule` is made. */
    setStepKind: (
      docket: DocumentId, matter: string, step: string, stepKind: StepKind,
    ): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'stepKind', docket, matter, step, stepKind }),
    removeStep: (docket: DocumentId, matter: string, step: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'removeStep', docket, matter, step }),
    /** Stamp a step done, or undo it. What a dependency reads. */
    completeStep: (
      docket: DocumentId, matter: string, step: string, done: boolean,
    ): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'completeStep', docket, matter, step, done }),
    /** Start work on it — the date that makes its first step due today. */
    activate: (docket: DocumentId, matter: string): Promise<DateKey> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'activate', docket, matter }),
    /** Stop work on it, keeping what it has already done. */
    suspend: (docket: DocumentId, matter: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'suspend', docket, matter }),
    /** The docket divided into sections, in file order. How it is read (MH1). */
    sections: (docket: DocumentId): Promise<readonly Section[]> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'sections', docket }),
    addSection: (docket: DocumentId, name: string): Promise<string> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'addSection', docket, name }),
    renameSection: (docket: DocumentId, name: string, to: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'renameSection', docket, name, to }),
    /** The heading goes; everything under it stays where it is. */
    removeSection: (docket: DocumentId, name: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'removeSection', docket, name }),
    /** A whole section up or down among the others; false at the ends. */
    nudgeSection: (docket: DocumentId, name: string, delta: number): Promise<boolean> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'nudgeSection', docket, name, delta }),
    /** Into a section of the same docket — `''` for the undivided run. */
    place: (docket: DocumentId, matter: string, section: string, before?: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'place', docket, matter, section, before }),
    /** One place up or down inside its own section; false at the ends. */
    nudge: (docket: DocumentId, matter: string, delta: number): Promise<boolean> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'nudge', docket, matter, delta }),
    /** Out of one docket and onto another, keeping the id (D71). */
    move: (docket: DocumentId, matter: string, to: DocumentId): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.docket, { kind: 'move', docket, matter, to }),
  },

  todo: {
    /** The notebook's list — the `.todo` directory at the root, made if new. */
    which: (): Promise<DocumentId> => ipcRenderer.invoke(CHANNEL.todo, { kind: 'list' }),
    /** Today, materialised from the last day that had a file if need be (D55). */
    /**
     * Which segment of this list to show — a day, or the one segment.
     *
     * Named `SegmentKey` rather than `DateKey` (MT7) — the two are one type,
     * so this is for the reader: an overall list has no days.
     */
    today: (list: DocumentId): Promise<SegmentKey> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'today', list }),
    items: (list: DocumentId, date: SegmentKey): Promise<readonly TodoItem[]> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'items', list, date }),
    add: (list: DocumentId, text: string): Promise<string> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'add', list, text }),
    setStatus: (list: DocumentId, item: string, status: TodoStatus, note?: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'status', list, item, status, note }),
    /** The committed row edit: text, tags and date together, one edit (D56). */
    edit: (list: DocumentId, item: string, text: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'edit', list, item, text }),
    /** The lines written under an item. Nothing in them is parsed (T16 does not apply). */
    setNotes: (list: DocumentId, item: string, notes: readonly string[]): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'notes', list, item, notes }),
    /** Off the list, for a line that was never a task. Earlier days keep theirs. */
    remove: (list: DocumentId, item: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'remove', list, item }),
    /**
     * Every tag ever put on a task (T6).
     *
     * The FULL set. The live one is the tags on today's items, which the
     * surface already has — so this is the half that needed an index, and
     * *dormant* is the subtraction between them.
     */
    tags: (): Promise<readonly string[]> => ipcRenderer.invoke(CHANNEL.todo, { kind: 'tags' }),
    /** Which days this list has, oldest first — what scrubbing steps through (MT6). */
    days: (list: DocumentId): Promise<readonly DateKey[]> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'days', list }),
    /** What was finished under each tag before today — T8's other half (MT6). */
    resolved: (): Promise<Record<string, readonly ResolvedItem[]>> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'resolved' }),
    /** Everything put down and not picked up again (T14). */
    backlog: (): Promise<readonly ResolvedItem[]> => ipcRenderer.invoke(CHANNEL.todo, { kind: 'backlog' }),
    /** Whether the day has been reviewed, and what arrived from before it (T11). */
    walk: (list: DocumentId, date: DateKey): Promise<WalkState> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'walk', list, date }),
    /** One act on many items: a status, or `remove`. Returns how many changed. */
    bulk: (list: DocumentId, items: readonly string[], action: TodoStatus | 'remove'): Promise<number> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'bulk', list, items, action }),
    /** Put it down: transferred, and housed on a docket (MH5). */
    putDown: (list: DocumentId, item: string, docket?: DocumentId): Promise<string | null> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'putDown', list, item, docket }),
    /** Which matter made this item, or null if nobody did. */
    matterFor: (item: string): Promise<{ docket: DocumentId; matter: string } | null> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'matterFor', item }),
    /** The day's selection, in the order it was chosen (H9). */
    chosen: (list: DocumentId, date: DateKey): Promise<readonly string[]> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'chosen', list, date }),
    /** Choose an item for the day, or unchoose it. A mark, never a move. */
    choose: (list: DocumentId, date: DateKey, item: string, chosen: boolean): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'choose', list, date, item, chosen }),
    /** End a pass: delete what was marked and record the review, as one act. */
    finishWalk: (list: DocumentId, date: DateKey, drop: readonly string[]): Promise<number> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'finishWalk', list, date, drop }),
    /** Show the list with a row open for a task, prefilled with `text` (T13). */
    capture: (text: string, wrap: boolean): Promise<DocumentId> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'capture', text, wrap }),
    /** The list takes it, if one is waiting. Taking it means nobody else will. */
    claim: (): Promise<{ text: string } | null> => ipcRenderer.invoke(CHANNEL.todo, { kind: 'claim' }),
    /** It became this item, or `null` because it was abandoned. */
    settle: (item: string | null): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.todo, { kind: 'settle', item }),
    /**
     * A task this window asked for now exists, so its words can point at it.
     *
     * The item cannot be made until the row is committed, and by then the caret
     * is in another window — so the link is written when the answer comes back
     * rather than when the question was asked.
     */
    onCaptured(handler: Handler<string>): () => void {
      const listener = (_e: unknown, item: string): void => handler(item)
      ipcRenderer.on(CHANNEL.captured, listener)
      return () => ipcRenderer.removeListener(CHANNEL.captured, listener)
    },
  },
  doc: {
    open: (id?: DocumentId): Promise<DocumentInfo> => ipcRenderer.invoke(CHANNEL.open, id),
    read: (request: ReadRequest): Promise<WindowSnapshot> => ipcRenderer.invoke(CHANNEL.read, request),
    edit: (request: EditRequest): Promise<EditAck> => ipcRenderer.invoke(CHANNEL.edit, request),
    release: (id: WindowId): Promise<void> => ipcRenderer.invoke(CHANNEL.release, id),
    extend: (request: ExtendRequest): Promise<void> => ipcRenderer.invoke(CHANNEL.extend, request),
    loadUiState: (): Promise<UiState> => ipcRenderer.invoke(CHANNEL.loadUiState),
    saveUiState: (state: UiState): Promise<void> => ipcRenderer.invoke(CHANNEL.saveUiState, state),
    undo: (id?: DocumentId): Promise<ChangeAck> => ipcRenderer.invoke(CHANNEL.undo, id),
    redo: (id?: DocumentId): Promise<ChangeAck> => ipcRenderer.invoke(CHANNEL.redo, id),
    flush: (): Promise<void> => ipcRenderer.invoke(CHANNEL.flush),
    spans: (request: SpansRequest): Promise<readonly TypedSpan[]> => ipcRenderer.invoke(CHANNEL.spans, request),
    resolveAnchor: (name: string): Promise<DocumentPosition | null> =>
      ipcRenderer.invoke(CHANNEL.resolveAnchor, name),
    setAnchor: (at: DocumentPosition, name: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.setAnchor, at, name),
    tag: (span: Span, subject: string): Promise<void> => ipcRenderer.invoke(CHANNEL.tag, span, subject),
    untag: (span: Span, subject: string): Promise<void> => ipcRenderer.invoke(CHANNEL.untag, span, subject),
    branch: (span: Span, name: string): Promise<DocumentId> => ipcRenderer.invoke(CHANNEL.branch, span, name),
    renameTag: (span: Span, from: string, to: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.renameTag, span, from, to),
    removeAnchor: (name: string): Promise<void> => ipcRenderer.invoke(CHANNEL.removeAnchor, name),
    /**
     * An image into `attachments/`, and a relative link back (R7).
     *
     * **Nothing is inserted by this.** The link comes back and the surface with
     * the caret puts it there through the ordinary edit path, so undo and the
     * journal need no special case for a picture.
     */
    /** Which directory this document's relative links resolve from (R7). */
    linkBase: (base: Base): Promise<string> => ipcRenderer.invoke(CHANNEL.linkBase, base),
    attachImage: (request: ImageAttachment): Promise<Attached> =>
      ipcRenderer.invoke(CHANNEL.attachImage, request),
    /** The same act, from a file dialog only main can open. Null if cancelled. */
    chooseImage: (base: Base): Promise<Attached | null> =>
      ipcRenderer.invoke(CHANNEL.chooseImage, base),
    print: (request: PrintJob): Promise<boolean> => ipcRenderer.invoke(CHANNEL.print, request),
    /** Every written day in a range, as prose: what the whole-document print reads. */
    proseIn: (from: DateKey, to: DateKey): Promise<readonly DayProse[]> =>
      ipcRenderer.invoke(CHANNEL.proseIn, from, to),

    /** Store the original untouched and put a copy at this point (R28, D47). */
    importText: (
      at: DocumentPosition,
      text: string,
      original: { content: string; ext: string },
    ): Promise<string> => ipcRenderer.invoke(CHANNEL.importText, at, text, original),
    /** The durable half: commits, and what a day looked like at one (D32). */
    versions: (limit?: number): Promise<readonly Version[]> =>
      ipcRenderer.invoke(CHANNEL.versions, limit),
    readDay: (version: VersionId, date: DateKey): Promise<string | null> =>
      ipcRenderer.invoke(CHANNEL.readDay, version, date),
    restore: (version: VersionId): Promise<RestoreReport> =>
      ipcRenderer.invoke(CHANNEL.restore, version),
    comments: (): Promise<readonly CommentThread[]> => ipcRenderer.invoke(CHANNEL.comments),
    startComment: (span: Span, body: string): Promise<CommentId> =>
      ipcRenderer.invoke(CHANNEL.startComment, span, body),
    addComment: (id: CommentId, body: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.addComment, id, body),
    editComment: (id: CommentId, index: number, body: string): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.editComment, id, index, body),
    deleteComment: (id: CommentId, index: number): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.deleteComment, id, index),
    setCommentResolved: (id: CommentId, resolved: boolean): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.setCommentResolved, id, resolved),
    setCommentAssignee: (id: CommentId, to: string | null): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.setCommentAssignee, id, to),
    reactToComment: (id: CommentId, index: number, emoji: string, on: boolean): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.reactToComment, id, index, emoji, on),
    extent: (): Promise<{ first: DateKey; last: DateKey } | null> => ipcRenderer.invoke(CHANNEL.extent),
    today: (): Promise<DateKey> => ipcRenderer.invoke(CHANNEL.today),
    /** Say where you are now. Offered when the system disagrees, never applied. */
    setZone: (zone: string): Promise<void> => ipcRenderer.invoke(CHANNEL.setZone, zone),
    /** What to say about the zone, if anything (D63). Main's answer, not ours. */
    zoneNotice: (): Promise<ZoneNotice | null> => ipcRenderer.invoke(CHANNEL.zoneNotice),
    dismissZone: (): Promise<void> => ipcRenderer.invoke(CHANNEL.dismissZone),
    /** Another Tephra has the notebook. Terminal: nothing follows it. */
    onNotebookLost(handler: Handler<void>): () => void {
      const listener = (): void => handler(undefined)
      ipcRenderer.on(CHANNEL.notebookLost, listener)
      return () => ipcRenderer.removeListener(CHANNEL.notebookLost, listener)
    },
    onZoneNotice(handler: Handler<ZoneNotice | null>): () => void {
      const listener = (_e: unknown, notice: ZoneNotice | null): void => handler(notice)
      ipcRenderer.on(CHANNEL.zoneNotice, listener)
      return () => ipcRenderer.removeListener(CHANNEL.zoneNotice, listener)
    },

    anomalies: (): Promise<readonly Anomaly[]> => ipcRenderer.invoke(CHANNEL.anomalies),
    listThemes: (): Promise<readonly Theme[]> => ipcRenderer.invoke(CHANNEL.listThemes),
    saveTheme: (theme: Theme): Promise<void> => ipcRenderer.invoke(CHANNEL.saveTheme, theme),
    /** Only a theme somebody made: a built-in comes back on the next launch. */
    deleteTheme: (name: string): Promise<boolean> => ipcRenderer.invoke(CHANNEL.deleteTheme, name),
    /** A new document: a real file from the first keystroke, named later. */
    /**
     * A new document, named now or named later.
     *
     * `section` is the file a section is written in — the new document is made
     * where that section's files live, and named in it when it has a line to
     * write. Both absent is the File menu's version: `untitled`, in `notes/`.
     */
    /** A note, or an overall task list — the same gesture with a different kind (MT7). */
    newDocument: (
      label?: string,
      section?: string,
      kind?: 'markdown' | 'todo' | 'docket',
    ): Promise<DocumentId> =>
      ipcRenderer.invoke(CHANNEL.newDocument, label, section, kind),
    /** Returns the NEW id — a document's identity is its path, so the old one is gone. */
    renameDocument: (id: DocumentId, label: string): Promise<DocumentId> =>
      ipcRenderer.invoke(CHANNEL.renameDocument, id, label),
    duplicateDocument: (id: DocumentId, label: string): Promise<DocumentId> =>
      ipcRenderer.invoke(CHANNEL.duplicateDocument, id, label),
    deleteDocument: (id: DocumentId): Promise<void> =>
      ipcRenderer.invoke(CHANNEL.deleteDocument, id),

    onMenuCommand(handler: Handler<string>): () => void {
      menuHandlers.add(handler)
      return () => menuHandlers.delete(handler)
    },

    /** What the caret is doing, so the menus can grey correctly. */
    selectionChanged: (selection: SelectionState): void =>
      ipcRenderer.send(CHANNEL.selectionChanged, selection),
    /** Ask main to pop the native context menu at the pointer. */
    contextMenu: (): void => ipcRenderer.send(CHANNEL.contextMenu),
    onRangeCommand(handler: Handler<string>): () => void {
      rangeHandlers.add(handler)
      return () => rangeHandlers.delete(handler)
    },

    onWindowChanged(handler: Handler<WindowChangedMessage>): () => void {
      changedHandlers.add(handler)
      return () => changedHandlers.delete(handler)
    },
    onWindowReset(handler: Handler<{ id: WindowId }>): () => void {
      resetHandlers.add(handler)
      return () => resetHandlers.delete(handler)
    },
    /**
     * Midnight happened while the app was open.
     *
     * The day a notebook files into was decided when its window opened, and an
     * app left running went on believing it.
     */
    onDayRolled(handler: Handler<string>): () => void {
      const listener = (_e: unknown, today: string): void => handler(today)
      ipcRenderer.on(CHANNEL.dayRolled, listener)
      return () => ipcRenderer.removeListener(CHANNEL.dayRolled, listener)
    },
    /** A day changed on disk while it had unsaved edits. Surfaced, never resolved (D12). */
    onDiverged(handler: Handler<Divergence>): () => void {
      divergedHandlers.add(handler)
      return () => divergedHandlers.delete(handler)
    },
  },
} as const

export type TephraBridge = typeof tephra

contextBridge.exposeInMainWorld('tephra', tephra)
