// The wire between Z and X.
//
// Document lives in the main process (D37), the live buffer lives in the
// renderer, and this is the only thing that crosses. Everything here is plain
// data: DocumentPosition is three primitives, Span is two of those, and Edit is
// a Span plus a string — so nothing needs a custom serialiser and nothing can
// smuggle a live object across a boundary it cannot survive.

import type {
  WindowEdit, DateKey, DocumentChange, DocumentId, DocumentMeta, EditOrigin, SegmentKey,
  SessionGeneration, Span, SpanKind, TypedSpan, DocumentPosition,
} from './document-api.ts'
import type { Annotation, Marker, Prose } from './prose.ts'
import type { StoredCursor, WindowState } from './ui-state.ts'
import type { NavTarget } from './pane-api.ts'
import type { Hit, Progress, QueryId } from './search-api.ts'
import type { Problem as QueryProblem } from './query-text.ts'
import type { TodoStatus } from './kinds/todo.ts'
import type { WindowPosition, ProseOffset, ProseText } from './document-api.ts'

/** Windows are addressed by handle; the objects themselves never cross. */
export type WindowId = number

export type { QueryProblem }

/**
 * What the renderer asks for when it opens a search.
 *
 * **Not a `Query`, and the difference is the origin.** A query's origin is a
 * `Located` — a file and an offset into its body — and the renderer has no
 * business knowing which file a day lives in (D54). It says where the caret is
 * in the words it already speaks, a segment and an offset, and main resolves
 * that to a place on disk before opening the cursor.
 *
 * The rest is `QueryParams` in wire form: the scope's document, the direction to
 * walk, and whether case matters. The text is parsed in main, from the same
 * `parseQuery` the field parses with, so the two cannot disagree.
 */
export interface SearchRequest {
  readonly text: string
  /** The scope's document. Null is the whole corpus (D66). */
  readonly document: DocumentId | null
  readonly direction: 'past' | 'future'
  readonly fold: 'auto' | 'sensitive' | 'insensitive'
  /** Where to walk from. Null means the newest thing there is. */
  readonly origin: { readonly segment: SegmentKey; readonly offset: number } | null
}

export interface SearchOpened {
  readonly id: QueryId
  /** Text that could not become part of the query, for the field to say so. */
  readonly problems: readonly QueryProblem[]
}

export interface SearchBatch {
  readonly hits: readonly Hit[]
  readonly progress: Progress
}

export const CHANNEL = {
  open: 'tephra:doc:open',
  read: 'tephra:doc:read',
  edit: 'tephra:win:edit',
  release: 'tephra:win:release',
  undo: 'tephra:doc:undo',
  redo: 'tephra:doc:redo',
  flush: 'tephra:doc:flush',
  spans: 'tephra:doc:spans',
  resolveAnchor: 'tephra:doc:resolveAnchor',
  setAnchor: 'tephra:doc:setAnchor',
  tag: 'tephra:doc:tag',
  untag: 'tephra:doc:untag',
  branch: 'tephra:doc:branch',
  renameTag: 'tephra:doc:renameTag',
  removeAnchor: 'tephra:doc:removeAnchor',
  print: 'tephra:doc:print',
  /** An image into `attachments/`, and a relative link back (R7). */
  attachImage: 'tephra:doc:attachImage',
  chooseImage: 'tephra:doc:chooseImage',
  /** Which directory a document's relative links resolve from (R7). */
  linkBase: 'tephra:doc:linkBase',
  proseIn: 'tephra:doc:proseIn',

  /**
   * Search (MS3, D65, D66).
   *
   * **The first pull-shaped channel in the app**, and the shape is the point: a
   * query over twenty years cannot be answered in one reply, and a stream pushed
   * at a renderer that is only walking one match at a time would read the corpus
   * to fill a buffer nobody asked for. So the renderer asks for `n` and gets
   * `n`, and the cursor in main stays exactly where it stopped.
   */
  searchOpen: 'tephra:search:open',
  searchNext: 'tephra:search:next',
  searchClose: 'tephra:search:close',

  /** Dockets: one channel, one union (MH1). */
  docket: 'tephra:docket',

  /** The sidebar's questions, answered by the corpus index (D51, D52). */
  navSubjects: 'tephra:nav:subjects',
  navBookmarks: 'tephra:nav:bookmarks',
  navTimeline: 'tephra:nav:timeline',
  navLinks: 'tephra:nav:links',
  navThreads: 'tephra:nav:threads',
  navOccurrences: 'tephra:nav:occurrences',
  navStatus: 'tephra:nav:status',
  navSections: 'tephra:nav:sections',
  navOpen: 'tephra:nav:open',
  navPin: 'tephra:nav:pin',
  navUnpin: 'tephra:nav:unpin',
  navRelabel: 'tephra:nav:relabel',
  /**
   * A corpus file changed on disk that no document is holding open.
   *
   * Day files announce themselves as ordinary changes (D45); a section file, a
   * note or a fileset edited by hand or arriving from sync has no window to
   * announce it, and the sidebar would otherwise go on showing what it read
   * when it started.
   */
  corpusChanged: 'tephra:doc:corpusChanged',
  /**
   * Midnight happened while the app was open.
   *
   * An app left running overnight decided which day it was filing into when its
   * window opened, and went on believing it. Typing the next morning continued
   * yesterday; a restart then filed the new day AFTER text that belonged in it.
   */
  dayRolled: 'tephra:doc:dayRolled',
  /**
   * This machine has moved, and the notebook has not been told to follow.
   *
   * Pushed rather than worked out per window: the zone is offered and never
   * applied (D63), and an offer that two windows state differently is worse
   * than no offer. Null means there is nothing to say.
   */
  /**
   * Another Tephra has taken the notebook. Terminal: nothing follows it.
   *
   * The window stops accepting edits, because anything typed after this cannot
   * be written and pretending otherwise is the lie the lock exists to prevent.
   */
  notebookLost: 'tephra:doc:notebookLost',
  quit: 'tephra:app:quit',
  zoneNotice: 'tephra:doc:zoneNotice',
  dismissZone: 'tephra:doc:dismissZone',
  comments: 'tephra:doc:comments',
  emojiPanel: 'tephra:emojiPanel',
  readClipboard: 'tephra:readClipboard',
  versions: 'tephra:history:versions',
  readDay: 'tephra:history:readDay',
  restore: 'tephra:history:restore',
  importText: 'tephra:doc:importText',
  startComment: 'tephra:doc:startComment',
  addComment: 'tephra:doc:addComment',
  editComment: 'tephra:doc:editComment',
  deleteComment: 'tephra:doc:deleteComment',
  setCommentResolved: 'tephra:doc:setCommentResolved',
  setCommentAssignee: 'tephra:doc:setCommentAssignee',
  reactToComment: 'tephra:doc:reactToComment',
  openLink: 'tephra:doc:openLink',
  extent: 'tephra:doc:extent',
  today: 'tephra:doc:today',
  extend: 'tephra:win:extend',
  anomalies: 'tephra:doc:anomalies',
  listThemes: 'tephra:theme:list',
  saveTheme: 'tephra:theme:save',
  loadUiState: 'tephra:ui:load',
  saveUiState: 'tephra:ui:save',
  /** What THIS window is: which one, what it opens, and the settings (MC6). */
  windowInfo: 'tephra:win:info',
  /** What this window is showing now — main keeps the set (MC6). */
  windowReport: 'tephra:win:report',
  windowCreate: 'tephra:win:create',
  windowReveal: 'tephra:win:reveal',
  /**
   * This window was just brought forward.
   *
   * **Because focus is not a signal a hidden window gets**, and a window that
   * was already open has no mount to react to either. Revealing is the one
   * event both cases share, so it is the one that is announced.
   */
  revealed: 'tephra:win:revealed',
  /** A capture became an item: the window that asked may now link to it. */
  captured: 'tephra:todo:captured',
  /** Every document that could be opened, for the Open… chooser (MC6). */
  navDocuments: 'tephra:nav:documents',
  deleteTheme: 'tephra:theme:delete',
  // The file lifecycle. Naming is the renderer's — a name needs a text field,
  // and this app does its asking in-app rather than in a native box (Prompt).
  newDocument: 'tephra:doc:new',
  /**
   * The task list, over one channel.
   *
   * **One channel, several verbs**, and the naming happens in the preload where
   * the renderer meets it: a bridge with `setStatus` and `add` on it reads the
   * way the document does, while the wire stays one handler. Six channels would
   * be six pieces of boilerplate saying the same thing.
   */
  todo: 'tephra:todo',
  renameDocument: 'tephra:doc:rename',
  duplicateDocument: 'tephra:doc:duplicate',
  deleteDocument: 'tephra:doc:delete',
  windowClose: 'tephra:win:close',
  /** Main chose a document — go there. Carries an id, which a command name cannot. */
  openDocument: 'tephra:doc:goto',
  /** Bring the outside file this window is showing into the notebook (MC6). */
  windowImport: 'tephra:win:import',
  /** renderer → main: the menu's checkmark follows the app, not the other way. */
  /** main → renderer */
  setZone: 'tephra:ui:setZone',
  /** main → renderer: an Edit-menu command, which owns these keystrokes. */
  menuCommand: 'tephra:ui:menuCommand',
  /** renderer → main: what the caret is doing, so menus enable correctly. */
  selectionChanged: 'tephra:ui:selectionChanged',
  /** renderer → main: pop the context menu at the pointer. */
  contextMenu: 'tephra:ui:contextMenu',
  /** main → renderer: a range command was chosen, however it was reached. */
  rangeCommand: 'tephra:ui:rangeCommand',
  windowChanged: 'tephra:win:changed',
  windowReset: 'tephra:win:reset',
  diverged: 'tephra:doc:diverged',
} as const

export interface DocumentInfo {
  /** Which document this is about — the stream unless the caller said otherwise. */
  readonly id: DocumentId
  readonly meta: DocumentMeta
  /**
   * What the document calls itself, or null when nobody named it.
   *
   * A title bar needs a name and the id is a path; the document knows the
   * answer (its frontmatter), and asking main for it here saves the renderer
   * from parsing a file it does not have (D54).
   */
  readonly title: string | null
  readonly generation: SessionGeneration
  /**
   * The day this document is writing into — the filing date (D62's writingDay).
   *
   * **Not what the calendar says**, which is `clockDay` below. They differ
   * exactly while somebody is still writing past midnight, and this is the one
   * that decides which file the next sentence lands in.
   */
  readonly today: DateKey
  /**
   * What the calendar says now (D62's clockDay).
   *
   * What the interface counts from: a due date's *in three days*, the sidebar's
   * marker. **Published rather than computed in the renderer**, so the two
   * sides cannot disagree about the date — which is the same rule the zone
   * follows, and for the same reason.
   */
  readonly clockDay: DateKey
  /**
   * The zone both dates are computed in (D63).
   *
   * Published rather than resolved in the renderer: a frontend working out its
   * own idea of the date while main files by another is the disagreement this
   * whole arrangement exists to prevent.
   */
  readonly zone: string
  readonly extent: { readonly first: DateKey; readonly last: DateKey } | null
}

/**
 * What one window is, told to the renderer that IS it.
 *
 * **A renderer no longer knows what it is showing by being the only one.** With
 * several windows the answer is per-process, and main is the only thing that
 * can say which of them this is (MC6).
 */
/**
 * The notebook's zone and this machine's, when they differ (D63).
 *
 * **Both halves, because the offer is a comparison.** "You are in Jerusalem" is
 * not actionable on its own; "this notebook files its days in Los Angeles, and
 * you are in Jerusalem" is, and it is the sentence somebody needs in order to
 * decide. Null when they agree, which is nearly always.
 */
export interface ZoneNotice {
  /** Where the notebook computes its dates. What changing it would change. */
  readonly notebook: string
  /** Where this machine says it is. What it would change to. */
  readonly system: string
}

export interface WindowInfo {
  readonly id: number
  readonly state: WindowState
  readonly theme: string
  /** How the task list is arranged (MT4a). Soft state, beside the theme. */
  readonly listView: 'time' | 'tag'
  readonly searchWidth: number
}

/**
 * What a window says about itself, whenever it changes.
 *
 * The window reports its own entry; MAIN owns the set and decides what is
 * per-window (where you are, the caret) and what is the machine's (the
 * theme). Two windows disagreeing about the theme is not a state this can
 * represent, which is the point.
 */
export interface WindowReport {
  readonly location: NavTarget
  readonly cursor: StoredCursor | null
  /** What to call this window: the document's name, or `Notebook` for the stream. */
  readonly name: string
  /**
   * The outside document this window is showing, if it is showing one (MC6).
   *
   * Reported rather than asked for, so `Import` can be enabled or greyed the
   * moment focus moves — a menu item that has to wait for a round trip is a
   * menu item that is briefly wrong.
   */
  readonly importable: DocumentId | null
  /**
   * The document this window is showing, when it is one Tephra may rename or
   * delete — so not the stream, which is not a file, and not a document from
   * outside the notebook, which is not ours.
   */
  readonly renamable: DocumentId | null
  readonly theme: string
  /** How the task list is arranged (MT4a). Soft state, beside the theme. */
  readonly listView: 'time' | 'tag'
  /** How wide the search panel was dragged to (MS4). Soft state, like the rest. */
  readonly searchWidth: number
}

/** Everything the renderer needs to serve the synchronous half of the API. */
export interface WindowSnapshot {
  readonly id: WindowId
  readonly text: ProseText
  readonly span: Span
  readonly generation: SessionGeneration
  readonly spans: readonly TypedSpan[]
  /** Where each segment's body starts in the buffer — the coordinate mapping. */
  /**
   * Where each segment sits, and what its markers are.
   *
   * `start` is a PROSE offset and `length` is the segment's document length; the
   * markers are what lets the renderer build the same prose↔raw map main has
   * (D44). Sending them is what stops there being two implementations of one
   * mapping — the first version omitted them, and tag underlines were drawn at
   * offsets that had never accounted for the marker bytes.
   */
  readonly placement: readonly {
    readonly date: DateKey
    /** Where this segment's prose begins in the window's buffer. */
    readonly start: WindowPosition
    readonly length: number
    readonly markers: readonly Marker[]
    /**
     * In the SEGMENT's coordinates; the renderer shifts them by `start` (D50).
     *
     * Sent per segment rather than pre-shifted for the same reason the markers
     * are sent at all: a segment arriving from growth carries its own, and the
     * window is assembled from the parts on both sides by the same rule.
     */
    readonly annotations: readonly Annotation<ProseOffset>[]
  }[]
  readonly boundaries: Boundaries
}

/**
 * The reply to an edit.
 *
 * `length` is a cheap consistency check, not decoration: the renderer applied
 * the same edits locally, so if the authoritative text is a different length
 * the two have diverged and the window must resync rather than continue on a
 * buffer that no longer describes the document.
 */
export interface EditAck {
  readonly generation: SessionGeneration
  readonly length: number
  readonly spans: readonly TypedSpan[]
  readonly placement: WindowSnapshot['placement']
}

export interface ChangeAck {
  readonly change: DocumentChange | null
  readonly generation: SessionGeneration
}

export interface WindowChangedMessage {
  readonly id: WindowId
  readonly edits: readonly WindowEdit[]
  readonly origin: EditOrigin
  readonly generation: SessionGeneration
  readonly text: ProseText
  readonly spans: readonly TypedSpan[]
  readonly placement: WindowSnapshot['placement']
  readonly boundaries: Boundaries
}

/**
 * Open a window on a region of a document.
 *
 * **The document is named, and the region is in SEGMENT KEYS.** Both used to be
 * implicit: the document was always the stream and a key was always a date. A
 * note has one segment whose key is not a date, so a request that could only
 * say `first: DateKey` could not ask for it at all (D54).
 */
export interface ReadRequest {
  readonly doc?: DocumentId
  readonly first: SegmentKey
  readonly last: SegmentKey
}

export interface EditRequest {
  readonly id: WindowId
  readonly edits: readonly WindowEdit[]
  readonly origin: EditOrigin
  /** What the renderer believed when it composed these edits. */
  readonly generation: SessionGeneration
}

export interface SpansRequest {
  readonly doc?: DocumentId
  readonly kind?: SpanKind
}

export interface ExtendRequest {
  readonly id: WindowId
  readonly direction: 'earlier' | 'later'
  /** Characters, not days (D40). The Pane converts from its screen policy. */
  readonly chars: number
}

/** What lies beyond each edge, so the UI can offer the right affordance. */
export interface Boundaries {
  readonly earlier: boolean
  readonly later: boolean
}

export type { DocumentPosition }

/**
 * A passage on its way to paper.
 *
 * The HTML is rendered in the renderer, where the markdown parser already lives
 * (Spike B: printing is a web-layer job and the shell contributes the panel).
 * `segment` says which day the passage came from, which is what relative links
 * resolve against — main turns it into a base URL, since only main knows where
 * the notebook is. Spike B's fourth trap: without one, printing through a temp
 * file makes every relative image silently 404.
 */
/**
 * One day on its way out of the app — to paper now, to an export later.
 *
 * The whole prose (D50), not just its text: what a renderer does with the
 * annotations is its own policy, and a shape that dropped them here would make
 * "clean" the only thing anything outside the editor could ever print.
 */
export interface DayProse {
  readonly date: DateKey
  readonly prose: Prose<ProseOffset>
}

export interface PrintJob {
  /**
   * Whether this document needs to be broken into pages before it is printed.
   *
   * Only a footnote needs it — it has to know which page its anchor fell on —
   * and it costs a megabyte of pagination and a second of work, so it is asked
   * for rather than assumed (D50).
   */
  readonly paginate?: boolean
  readonly html: string
  readonly css: string
  readonly title: string
  /**
   * Where relative links and images resolve FROM.
   *
   * **Not a date, which is what this used to be.** It was `segment: DateKey`,
   * and main turned it into a day directory — which is the right answer for the
   * stream and has none at all for a note, whose images sit relative to its own
   * file. A field that means "which directory" should say which directory, and
   * only the two kinds of thing that can answer it should be able to.
   */
  readonly base: Base
}

/**
 * Where relative links resolve FROM: a day of the stream, or a document.
 *
 * **The two things that can answer "which directory"**, and named once because
 * two callers now ask it — printing, and attaching an image (R7). It is not a
 * date: a note's images sit relative to its own file and it has no day.
 */
export type Base =
  | { readonly kind: 'day'; readonly date: DateKey }
  | { readonly kind: 'document'; readonly id: DocumentId }

/**
 * An image on its way into the corpus (R7).
 *
 * **The bytes come from the renderer**, because that is where they arrive: a
 * paste event and a drop both carry the file itself, so asking main to read the
 * clipboard again would be a second answer to a question already answered — and
 * a worse one, since a drop is not on the clipboard at all.
 *
 * `name` is what to call it, from a dropped file or a picked one. The clipboard
 * rarely says, and `clipboard` is what it is called then.
 */
export interface ImageAttachment {
  readonly base: Base
  readonly name: string
  readonly ext: string
  readonly bytes: Uint8Array
}

/**
 * What Tephra will take as an image.
 *
 * **A closed list, and deliberately short.** Markdown renders what the platform
 * renders, so this is the intersection of *what a browser draws inline* and
 * *what somebody actually pastes*. SVG is absent on purpose: it is a document
 * with script in it, not a picture, and embedding one is a decision rather than
 * a paste.
 */
export const IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic']

/** Where it landed, and how to write a link to it from `base`. */
export interface Attached {
  readonly rel: string
  /** Relative, because every other link in the format is (format-spec). */
  readonly link: string
}

/** What the clipboard is offering. Read in main, which is the only side with one. */
export interface Clipboard {
  readonly text: string
  readonly html: string
}

/**
 * One task-list verb, as it crosses the wire (MT3).
 *
 * A union rather than a channel each: the preload gives the renderer named
 * methods over it, so the API a caller sees has the document's own nouns while
 * the wire has one handler to keep in step.
 */
/**
 * One verb on one docket (MH1, D68).
 *
 * **The task list's shape, because it is the same kind of traffic**: a surface
 * that is a list of rows, each gesture one small edit to one row. One channel
 * and a discriminated union rather than a dozen channels — the alternative is a
 * dozen names to keep in step across four files.
 */
export type DocketCommand =
  /** Every docket there is, newest name last. */
  | { readonly kind: 'list' }
  | { readonly kind: 'matters'; readonly docket: DocumentId }
  | {
      readonly kind: 'add'
      readonly docket: DocumentId
      readonly name: string
      /** As written: `2026-11-12`, `2026-03..2026-05`, `every 90 days`, or nothing. */
      readonly when?: string
      /** Which section to put it in. Absent means the undivided run. */
      readonly section?: string
    }
  | { readonly kind: 'rename'; readonly docket: DocumentId; readonly matter: string; readonly name: string }
  | { readonly kind: 'when'; readonly docket: DocumentId; readonly matter: string; readonly when: string }
  | {
      readonly kind: 'owner'
      readonly docket: DocumentId
      readonly matter: string
      readonly owner: string | null
    }
  | { readonly kind: 'link'; readonly docket: DocumentId; readonly matter: string; readonly link: string | null }
  | { readonly kind: 'tag'; readonly docket: DocumentId; readonly matter: string; readonly subject: string }
  | { readonly kind: 'untag'; readonly docket: DocumentId; readonly matter: string; readonly subject: string }
  | { readonly kind: 'remove'; readonly docket: DocumentId; readonly matter: string }
  /** Prose under a matter. Nothing in it is parsed. */
  | {
      readonly kind: 'notes'
      readonly docket: DocumentId
      readonly matter: string
      readonly notes: readonly string[]
    }
  /** A run-up: *this long before, do this* (H4). `offset` as a person types it. */
  | {
      readonly kind: 'addTrigger'
      readonly docket: DocumentId
      readonly matter: string
      readonly offset: string
      readonly text: string
      readonly effect?: string
    }
  | {
      readonly kind: 'removeTrigger'
      readonly docket: DocumentId
      readonly matter: string
      readonly at: number
    }
  // ── sections: how a docket is divided for reading (MH1) ──
  | { readonly kind: 'sections'; readonly docket: DocumentId }
  | { readonly kind: 'addSection'; readonly docket: DocumentId; readonly name: string }
  | {
      readonly kind: 'renameSection'
      readonly docket: DocumentId
      readonly name: string
      readonly to: string
    }
  /** The heading goes; everything under it stays. */
  | { readonly kind: 'removeSection'; readonly docket: DocumentId; readonly name: string }
  /**
   * Put a matter in a section of THIS docket — `''` is the undivided run.
   *
   * **`place`, not `move`**: `move` below is D71's between-dockets transfer, and
   * two verbs a letter apart that mean different things is how a wrong call gets
   * made. This one never changes which document a matter is on.
   */
  | {
      readonly kind: 'place'
      readonly docket: DocumentId
      readonly matter: string
      readonly section: string
      /** Above this one, rather than at the end of the section. */
      readonly before?: string
    }
  /** One place up or down inside its own section. Answers whether it moved. */
  | {
      readonly kind: 'nudge'
      readonly docket: DocumentId
      readonly matter: string
      readonly delta: number
    }
  /** The move (D71): out of one docket and onto another, keeping the id. */
  | {
      readonly kind: 'move'
      readonly docket: DocumentId
      readonly matter: string
      readonly to: DocumentId
    }

/** What a docket is called, for a picker that must not show a filename. */
export interface DocketRow {
  readonly id: DocumentId
  readonly title: string
}

export type TodoCommand =
  | { readonly kind: 'list' }
  | { readonly kind: 'today'; readonly list: DocumentId }
  | { readonly kind: 'items'; readonly list: DocumentId; readonly date: DateKey }
  | { readonly kind: 'add'; readonly list: DocumentId; readonly text: string }
  | {
      readonly kind: 'status'
      readonly list: DocumentId
      readonly item: string
      readonly status: TodoStatus
      readonly note?: string
    }
  | { readonly kind: 'edit'; readonly list: DocumentId; readonly item: string; readonly text: string }
  /** The lines written UNDER an item — progress, who was called. Nothing is parsed. */
  | {
      readonly kind: 'notes'
      readonly list: DocumentId
      readonly item: string
      readonly notes: readonly string[]
    }
  | { readonly kind: 'remove'; readonly list: DocumentId; readonly item: string }
  /** Which days this list has, oldest first (T7's flow 7). */
  | { readonly kind: 'days'; readonly list: DocumentId }
  /** What was finished under each tag before today (T8's tail). */
  | { readonly kind: 'resolved' }
  /** Everything put down and not picked up again (T14). */
  | { readonly kind: 'backlog' }
  /** What the walk knows about a day: reviewed yet, and what arrived from before (T11). */
  /** Every tag that has ever been on a task (T6). The full set; live is today's. */
  | { readonly kind: 'tags' }
  | { readonly kind: 'walk'; readonly list: DocumentId; readonly date: DateKey }
  /**
   * End a pass: delete what was marked, and record that the day was reviewed.
   *
   * **One command, because it is one act.** Two — drop these, then mark walked
   * — could half-happen, and a day whose items went but whose review did not
   * record is a day that offers to review a list it has already groomed.
   */
  | { readonly kind: 'finishWalk'; readonly list: DocumentId; readonly date: DateKey; readonly drop: readonly string[] }
  /**
   * Show the list with a row open for a task (T13).
   *
   * `text` prefills it — the words a selection offered. `wrap` says the asking
   * window wants a link back once there is something to link to, which it
   * cannot write itself: the item does not exist until the row is committed,
   * and by then the caret is in another window.
   */
  | { readonly kind: 'capture'; readonly text: string; readonly wrap: boolean }
  /** The list takes the waiting capture, if there is one. */
  | { readonly kind: 'claim' }
  /** It became this item, or `null` because it was abandoned. */
  | { readonly kind: 'settle'; readonly item: string | null }
