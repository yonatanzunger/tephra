// Binding a CodeMirror view to a DocumentWindow.
//
// The two directions are NOT symmetric, and the asymmetry is the whole of what
// keeps text from duplicating:
//
//   editor → window   every user transaction becomes window.edit(), fired and
//                     not awaited, because the editor has already painted it
//   window → editor   only changes the window did NOT originate arrive, and
//                     they are dispatched with a marker so they do not bounce
//                     straight back as a new edit
//
// THE EDITOR'S OWN HISTORY IS DISABLED. Undo is document-scoped (D23, D32) and
// may land outside the loaded region; two histories over one text diverge.

import { ChangeSet, EditorSelection, EditorState, StateEffect, Transaction, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
// **`searchKeymap` is deliberately NOT here** (D66). CodeMirror's own find
// panel binds ⌘F too, so leaving it installed put two searches on one key —
// with two grammars, two ideas of what a document is, and a Replace that edits
// the buffer rather than going through the Document. Its panel cannot express a
// tag or a date, and it only ever sees the days this window has loaded, which is
// the whole reason MS1 exists. `highlightSelectionMatches` stays: it is a
// decoration, not a command, and it is what makes a landed match legible.
import { highlightSelectionMatches } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { hangingPunctuation } from './hanging.ts'
import { textDirection } from './bidi.ts'
import { listIndent, listLayout } from './lists.ts'
import { scrollTrack, setTrackMarks, type TrackMarks } from './scroll-track.ts'
import { findMarks, setFindMarks, type FindMarks } from './find-marks.ts'
import type { WindowEdit, WindowPosition, DocumentPosition, DocumentWindow, EditOrigin } from '../../../../../shared/document-api.ts'
import { fromBuffer } from '../../../../../shared/prose.ts'
import { rebuildWidgets, widgetExtensions } from './widgets.ts'
import { contextMenu, markAt, readSelection, reportSelection, type Selection } from './range-commands.ts'
import type { MarkInfo } from '../../annotations.ts'
import { retag, tagExtents } from './tags.ts'
import { tagSpines } from './tag-spines.ts'
import { smartQuotes } from './quotes.ts'
import { commentExtents, recomment } from './comment-anchors.ts'
import type { CommentAnchor } from '../../annotations.ts'
import { richPaste } from './paste.ts'
import { dayBoundaries, redays } from './days.ts'
import { codeBlocks } from './code.ts'
import { proseHighlight, tephraTheme, typographyCompartment } from './theme.ts'
import { defaultTypography, type Typography } from '../../typography.ts'
import { Compartment } from '@codemirror/state'
import { optionsFor } from './options.ts'

/** Marks a transaction as coming FROM the document, so it is not sent back. */
const fromDocument = StateEffect.define<null>()


export interface BindOptions {
  readonly parent: HTMLElement
  readonly window: DocumentWindow
  readonly typography?: Typography
  /** Reported upward so the Pane can own extent policy (D35). */
  readonly onViewport?: (visible: { from: WindowPosition; to: WindowPosition }) => void
  /** Where the caret is, in document space, so it can outlive the session. */
  readonly onCursor?: (at: DocumentPosition) => void
  readonly onError?: (err: Error) => void
  /** A mark was clicked: here is what it stands for and where it sits. */
  readonly onMark?: (mark: MarkInfo) => void
  /** Where each visible thread's anchor sits, so the margin can align to it. */
  readonly onCommentAnchors?: (anchors: readonly CommentAnchor[]) => void
  /** The element the margin renders into, or null when this editor goes away. */
  readonly onRailHost?: (host: HTMLElement | null) => void
  /**
   * A picture arrived — pasted, or dropped on the text (R7).
   *
   * **Handled here because this is where the caret is.** The bytes come with
   * the event, so nothing has to go and ask the clipboard a second time — and a
   * drop is not on the clipboard at all, which is what makes asking the wrong
   * shape.
   */
  readonly onImages?: (images: readonly DroppedImage[]) => void
}

export interface DroppedImage {
  readonly name: string
  readonly ext: string
  readonly bytes: Uint8Array
}

export interface Binding {
  readonly view: EditorView
  /** The selection right now, in document terms. See `readSelection`. */
  selection(): Selection
  /** Put text around the selection, as ordinary typing would. */
  wrapSelection(before: string, after: string): void
  /**
   * Put emphasis on, or take it off again.
   *
   * **With a selection: a toggle.** The second press of ⌘B is a person changing
   * their mind, and answering it with `****` reads as broken.
   *
   * **With nothing selected: one delimiter run at the caret**, so the pair is
   * typed the way a person actually types it — reported from use (2026-09-15):
   *
   *     ^            ⌘I
   *     *^           foo
   *     *foo^        ⌘I
   *     *foo*^
   *
   * It used to open the whole pair and sit between them (`*^*`), which looks
   * right and is not: once you have typed the word, the caret is before the
   * closing marker and a second ⌘I matches nothing, so it opened a SECOND pair
   * and left `*foo*^**`. Emphasis is the one command that is normally used
   * without a selection, so that is the case it has to be right for.
   */
  toggleEmphasis(marker: string): void
  /**
   * Put the caret at a buffer position and show it.
   *
   * **A caret, not a selection**, and MS3 tried the other way first: selecting a
   * find's match looks right until the caret goes back to the search field, at
   * which point CodeMirror draws an *unfocused* selection — a flat grey that
   * paints straight over the match decoration underneath it. Which words were
   * found is `find-marks.ts`'s job, and it does it without needing the focus.
   */
  revealAt(at: number): void
  /**
   * Draw the widgets again.
   *
   * **Because some of what they draw is module state**, not document state:
   * `widgetOptions` holds the reveal toggles and the directory images resolve
   * from, and a change to any of those is invisible to CodeMirror — nothing in
   * the document changed, so nothing would redraw.
   */
  rebuildWidgets(): void
  /** Mark the active row's places down the scroll track (D51). */
  showTrackMarks(marks: TrackMarks): void
  /** Where the find's matches are, and which one it is standing on. */
  showFindMarks(marks: FindMarks): void
  setTypography(t: Typography): void
  destroy(): void
}

export function bindEditor(options: BindOptions): Binding {
  const { window: docWindow } = options
  const typography = options.typography ?? defaultTypography
  // **Asked of the window, not passed in.** The window knows its document and
  // the document knows its kind; a `surface` prop threaded down from the app
  // would be a second answer to a question that already has one (D54).
  const behaviour = optionsFor(docWindow.document.meta)

  // **The spines' home, made before the view that paints into it.** Inside
  // `.cm-scroller` for the same reason the rail is: a spine marks a stretch of
  // text, so it has to scroll with that text rather than be recomputed every
  // frame the reader moves. This is also why the band it sits in is reserved on
  // `.cm-content` — the breathing room `.frame-reading` keeps between the nav
  // and the first character is outside the scroller, and cannot scroll.
  const spineHost = document.createElement('div')
  spineHost.className = 'spine-host'

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: docWindow.text,
      extensions: [
        // The caret is reported upward so menu items grey correctly, and a
        // right-click raises the same commands the menu bar shows.
        reportSelection(),
        contextMenu(),
        richPaste(),
        // A day with nothing in it yet is the ordinary case first thing in the
        // morning, and with no gutter, no caret cue and no chrome it renders as
        // a blank rectangle — indistinguishable from the app having failed.
        placeholder('Nothing here yet. Start typing.'),
        listIndent(),
        scrollTrack(),
        findMarks,
        // **Paste and drop, before the editor treats them as text.** A pasted
        // screenshot has no text at all, so without this ⌘V does nothing
        // visible and the picture is silently lost.
        EditorView.domEventHandlers({
          paste(event) {
            return takeImages(event.clipboardData, options.onImages)
          },
          drop(event) {
            return takeImages(event.dataTransfer, options.onImages)
          },
        }),
        // NO history() — see the header. Undo is document.undo().
        // **`codeLanguages` is what makes a fence more than one token.** Without
        // it a fenced block parses as a single `CodeText` node whatever its info
        // string says, so ```python is styled exactly as ```. The registry is
        // lazy — a grammar is fetched the first time a block claims it — which
        // is why one dependency is cheaper here than ten hand-picked ones.
        markdown({ codeLanguages: languages }),
        syntaxHighlighting(proseHighlight, { fallback: true }),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        // Read-only is enforced HERE as well as being shown.
        //
        // Three layers, because they stop different things: `editable` takes
        // the caret out of the DOM, `readOnly` is what the commands consult,
        // and the filter drops any change that arrives anyway. The third is not
        // belt-and-braces — a programmatic dispatch (a paste command, a list
        // indent, anything a keymap adds later) is not stopped by the other
        // two, and it reached the document, which threw. A read-only surface
        // should IGNORE an edit, not fail on one.
        ...(behaviour.editable
          ? []
          : [
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              EditorState.transactionFilter.of(tr => (tr.docChanged ? [] : tr)),
            ]),
        widgetExtensions(),
        codeBlocks(),
        // **Each paragraph runs the way its own words do** (D98). Above the
        // theme, because it decides what `text-align: start` means.
        textDirection(),
        // Quotes curl as they are typed, and never afterwards (D87).
        smartQuotes(),
        listLayout(),
        // **Punctuation hangs into the margin** (D95), which is only visible in
        // justified text — with a ragged edge there is no line for it to hang
        // off, and the decoration costs nothing there.
        hangingPunctuation(),
        ...(behaviour.annotations ? [tagExtents(docWindow), tagSpines(docWindow, spineHost)] : []),
        ...(behaviour.days ? [dayBoundaries(docWindow)] : []),
        ...(behaviour.annotations
          ? [commentExtents(docWindow, anchors => options.onCommentAnchors?.(anchors))]
          : []),
        // **⌘I is ours.** CodeMirror's default keymap binds it to
        // `selectParentSyntax`, which in a prose document selects a paragraph
        // out from under you — and it is the key every text application uses
        // for italic. Dropped by KEY rather than by identity, so a future
        // CodeMirror that rebinds the same key to something else is also
        // caught, and the menu accelerator is the only thing on it.
        keymap.of(defaultKeymap.filter(binding => binding.key !== 'Mod-i')),
        typographyCompartment.of(tephraTheme(typography)),
        editorToWindow(docWindow, options.onError),
        viewportReporter(options.onViewport),
        cursorReporter(docWindow, options.onCursor),
      ] as Extension[],
    }),
  })

  // Where to land: **the append position, always.**
  //
  // The stream is oldest-first and appended to (Q7), so opening Tephra should
  // put the caret where the next sentence goes and the window should show what
  // came before it — you are continuing, not arriving somewhere. Scrolled to
  // the END rather than centred, so the blank space is below the caret and
  // yesterday is above it; the region grows backwards behind the reader, which
  // fills that space in with where they left off.
  //
  // **This used to prefer the position the last session left.** It was the
  // wrong default for a stream: it opens you in the middle of something you
  // have already finished reading, and the first keystroke lands wherever the
  // caret happened to be rather than at the end of today. The cursor is still
  // recorded — it is a true fact about the session, and navigation may want it
  // — it simply no longer decides where the app opens.
  //
  // **A note opens at the top instead**, because it is not a thing being
  // appended to: arriving at the end of a file somebody sent you is arriving at
  // the wrong end of it (D54).
  const landing = (behaviour.landing === 'append' ? docWindow.text.length : 0) as WindowPosition
  view.dispatch({
    selection: { anchor: landing as number },
  })
  if (behaviour.landing === 'append') scrollToAppendPosition(view)

  const unsubscribeChanged = docWindow.onChanged((edits, origin) => {
    applyFromDocument(view, edits, origin)
    // Growth prepends a whole day, which is a change to WHICH days are loaded
    // and not only to the text.
    if (origin === 'external') view.dispatch({ effects: redays.of(null) })
  })
  // Redrawing the extents is its own subscription, because spans change on
  // edits this editor MADE — where `onChanged` is deliberately silent — as well
  // as on edits from elsewhere. Deleting a tag's mark is exactly that case: the
  // buffer loses one character locally, and the tag it stood for goes away in
  // the answer that comes back a moment later.
  // The rail's home. Inside `.cm-scroller`, so notes scroll with the text and
  // nothing has to recompute their positions as the reader moves.
  view.scrollDOM.append(spineHost)
  const railHost = document.createElement('div')
  railHost.className = 'rail-host'
  view.scrollDOM.append(railHost)
  options.onRailHost?.(railHost)

  // A mark was clicked. The widget knows where it is; only the window knows
  // what it stands for.
  const onHandle = (event: Event): void => {
    const detail = (event as CustomEvent<{ at: number; box: DOMRect }>).detail
    options.onMark?.(markAt(docWindow, detail.at, detail.box))
  }
  view.dom.addEventListener('tephra-handle', onHandle)

  const unsubscribeSpans = docWindow.onSpansChanged(() => {
    view.dispatch({ effects: [retag.of(null), recomment.of(null), redays.of(null)] })
  })
  const unsubscribeReset = docWindow.onReset(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: docWindow.text },
      effects: fromDocument.of(null),
    })
  })

  return {
    view,
    selection(): Selection {
      return readSelection(view, docWindow)
    },
    wrapSelection(before: string, after: string): void {
      view.dispatch(
        view.state.changeByRange(r => ({
          changes: [
            { from: r.from, insert: before },
            { from: r.to, insert: after },
          ],
          // Leave the words selected, so a second thought about the URL does not
          // begin with finding them again.
          range: EditorSelection.range(r.from + before.length, r.to + before.length),
        })),
        { userEvent: 'input' },
      )
      view.focus()
    },
    toggleEmphasis(marker: string): void {
      const n = marker.length
      view.dispatch(
        view.state.changeByRange(range => {
          const doc = view.state.doc
          const before = doc.sliceString(Math.max(0, range.from - n), range.from)
          const after = doc.sliceString(range.to, Math.min(doc.length, range.to + n))
          const inside = doc.sliceString(range.from, range.to)

          // Already emphasised, with the markers OUTSIDE what is selected —
          // which is the state the first press leaves behind, and therefore the
          // one the second press has to recognise.
          if (before === marker && after === marker) {
            return {
              changes: [
                { from: range.from - n, to: range.from },
                { from: range.to, to: range.to + n },
              ],
              range: EditorSelection.range(range.from - n, range.to - n),
            }
          }
          // Already emphasised, with the markers INSIDE it — someone selected
          // the whole thing, asterisks and all.
          if (inside.length >= 2 * n && inside.startsWith(marker) && inside.endsWith(marker)) {
            return {
              changes: [
                { from: range.from, to: range.from + n },
                { from: range.to - n, to: range.to },
              ],
              range: EditorSelection.range(range.from, range.to - 2 * n),
            }
          }
          // **Nothing selected: one run, at the caret.** Pressing again after
          // typing the word closes it, because closing is the same characters
          // as opening — which is the whole reason this needs no cleverness.
          if (range.empty) {
            return {
              changes: [{ from: range.from, insert: marker }],
              range: EditorSelection.cursor(range.from + n),
            }
          }
          return {
            changes: [
              { from: range.from, insert: marker },
              { from: range.to, insert: marker },
            ],
            range: EditorSelection.range(range.from + n, range.to + n),
          }
        }),
        { userEvent: 'input' },
      )
      view.focus()
    },
    rebuildWidgets(): void {
      view.dispatch({ effects: rebuildWidgets.of(null) })
    },
    showTrackMarks(next: TrackMarks): void {
      view.dispatch({ effects: setTrackMarks.of(next) })
    },
    showFindMarks(next: FindMarks): void {
      view.dispatch({ effects: setFindMarks.of(next) })
    },
    revealAt(at: number): void {
      const where = Math.max(0, Math.min(at, view.state.doc.length))
      view.dispatch({
        selection: { anchor: where },
        // **At the TOP, with what follows below it.** Centring reads well in the
        // middle of a long document and fails at both ends: near the end of the
        // stream — which is where a recent comment or subject always is — there
        // is nothing below to centre against, so the viewport stops and the
        // thing you were sent to sits on the last line, with the whole screen
        // above it being what you already read.
        //
        // Landing at the top is the same rule that made centring right in the
        // first place: you arrive at the thing, and you read forward from it.
        // The margin is breathing room, not a heading — a line flush against
        // the chrome reads as clipped.
        //
        // Through `scrollIntoView` rather than by measuring: a jump across a
        // month lands outside the rendered range, where `coordsAtPos` answers
        // null and any measurement of our own is a guess (see the landing notes).
        effects: EditorView.scrollIntoView(where, { y: 'start', yMargin: 24 }),
      })
      view.focus()
    },
    setTypography(t: Typography): void {
      view.dispatch({ effects: typographyCompartment.reconfigure(tephraTheme(t)) })
    },
    destroy(): void {
      options.onRailHost?.(null)
      railHost.remove()
      view.dom.removeEventListener('tephra-handle', onHandle)
      unsubscribeChanged()
      unsubscribeSpans()
      unsubscribeReset()
      view.destroy()
    },
  }
}

/**
 * **The native caret, and no drawn selection layer at all** (D67).
 *
 * CodeMirror can render selection two ways: the browser's native selection, or
 * its own drawn layer. Vim needed the drawn one, because a block cursor is not
 * something a native caret can be — and Spike A measured that drawn caret at
 * about a millisecond more than the native one, small, consistent, and on the
 * typing path. D15 left that on the table as the one lead worth chasing if the
 * surface ever felt less fluid than it should.
 *
 * With vim removed there is nothing to chase: the native caret is simply what
 * this uses, and the selection styling that existed twice — once per mechanism
 * — exists once.
 */

/** Every user transaction becomes a window edit. Fired, never awaited. */
function editorToWindow(
  docWindow: DocumentWindow,
  onError: ((err: Error) => void) | undefined,
): Extension {
  return EditorView.updateListener.of(update => {
    if (!update.docChanged) return

    for (const tr of update.transactions) {
      if (tr.effects.some(e => e.is(fromDocument))) continue // came from the document
      if (tr.changes.empty) continue

      const edits: WindowEdit[] = []
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        edits.push({
          from: fromA as WindowPosition,
          to: toA as WindowPosition,
          insert: fromBuffer(inserted.toString()),
        })
      })
      if (edits.length === 0) continue

      const origin: EditOrigin = tr.isUserEvent('input') || tr.isUserEvent('delete') ? 'user' : 'operation'

      // Not awaited: the editor has painted this already and R1.1 does not
      // permit a round trip on the typing path. A rejection is a real failure —
      // disk full, permissions, a desynchronised window — and must surface.
      void docWindow.edit(edits, origin).catch((err: unknown) => {
        onError?.(err instanceof Error ? err : new Error(String(err)))
      })
    }
  })
}

/**
 * Apply a change the document made, without sending it back.
 *
 * The selection is mapped with association AFTER, which matters for exactly one
 * case and matters a lot there: extending the window earlier is an insertion at
 * offset zero, and a cursor sitting at offset zero is the ordinary state right
 * after opening. CodeMirror's default keeps such a cursor at zero, so the
 * prepended day slides in underneath it and the caret ends up at the TOP of the
 * oldest loaded day — where the next thing typed lands in the wrong file. With
 * 'after' the caret travels with the text it was attached to, which is where
 * the person left it.
 */
/**
 * Put the append position where it is comfortable to write.
 *
 * **Asked of CodeMirror rather than computed here**, which is the fifth attempt
 * and the reason the previous four are worth listing:
 *
 *   - `scrollIntoView(end, 'end')` aligns the last line with the bottom EDGE,
 *     leaving the caret jammed against it with nowhere to type into.
 *   - scrolling to `scrollHeight` uses the 60vh of bottom padding well on a long
 *     day and scrolls a SHORT one clean off the top: the padding is taller than
 *     the text, so "the bottom of the document" is below everything in it.
 *   - measuring the caret and placing it a third down fixed both — **as long as
 *     the caret was rendered.** `coordsAtPos` returns null outside the rendered
 *     range, and after growth prepends thirty thousand characters the append
 *     position is nowhere near it. It returned null, this returned without
 *     scrolling, and the window sat in the middle of yesterday: viewport at
 *     28699 with the caret at 37460.
 *
 * `scrollIntoView` does that measurement internally, across regions that have
 * not been rendered, which is precisely the part that cannot be done from out
 * here. `center` rather than `end` because the padding is meant to be under the
 * caret rather than off the screen.
 */
function scrollToAppendPosition(view: EditorView): void {
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'center' }) })
}

/**
 * Apply a change that came from the document, keeping the reader where they are.
 *
 * **Text arriving ABOVE the viewport must not move what is on screen.** The
 * region grows backwards behind the reader (D40), so a day is prepended at
 * offset zero and everything below it shifts down by that day's height —
 * scrollTop stays the same number of pixels, so the view silently slides to the
 * top of whatever just arrived.
 *
 * That single omission produced both of the symptoms it was reported as. The app
 * appeared to open at the START of the stream, because the caret was placed at
 * the end and then a day was inserted above it. And scrolling down never
 * reached the bottom: each jump to the top made the viewport report itself as
 * near the beginning, `Pane.viewportChanged` read that as "the reader is
 * approaching the edge", and grew the region again — a loop that only stopped
 * when there were no earlier days left.
 *
 * Anchoring is the ordinary fix for upward-infinite-scroll, and `extend`'s own
 * comment already claimed it: applying growth as an insertion rather than a
 * reset is what lets the cursor and the scroll position survive. The cursor did;
 * the scroll position needed this.
 */
function applyFromDocument(view: EditorView, edits: readonly WindowEdit[], _origin: EditOrigin): void {
  if (edits.length === 0) return
  const changes = ChangeSet.of(
    edits.map(e => ({ from: e.from as number, to: e.to as number, insert: e.insert })),
    view.state.doc.length,
  )

  // Entirely above what is rendered? Then the reader should not feel it at all.
  const firstVisible = view.visibleRanges[0]?.from ?? 0
  const above = edits.every(edit => Math.max(edit.from as number, edit.to as number) <= firstVisible)
  const scroller = view.scrollDOM
  const topBefore = scroller.scrollTop
  const heightBefore = scroller.scrollHeight

  const head = view.state.selection.main.head

  // **Two different right answers, and which one applies depends on where the
  // reader is.** Someone reading history wants the page held still. Someone
  // sitting at the append position — which is where the app opens — wants to
  // stay there, at the bottom, watching earlier days fill in above. Preserving
  // the visual position does the first and gets the second wrong: at startup
  // the buffer is one short day, so "where you were" is the top of an almost
  // empty screen, and holding that leaves the caret stranded up there.
  //
  // The test is whether the caret is at the end AND on screen. If it is, this
  // is the append position and it stays pinned; if it is not, the reader has
  // gone somewhere and is not to be moved.
  const caret = view.coordsAtPos(head)
  const box = scroller.getBoundingClientRect()
  const pinned =
    head === view.state.doc.length &&
    caret !== null &&
    caret.bottom <= box.bottom + 1 &&
    caret.top >= box.top - 1
  const anchor = view.state.selection.main.anchor
  view.dispatch({
    changes,
    selection: { anchor: changes.mapPos(anchor, 1), head: changes.mapPos(head, 1) },
    effects: fromDocument.of(null),
    annotations: Transaction.addToHistory.of(false),
  })

  if (pinned) {
    scrollToAppendPosition(view)
    return
  }
  if (!above) return
  // Measured rather than computed: the inserted text's height depends on how it
  // wraps, which only layout knows.
  view.requestMeasure({
    read: () => scroller.scrollHeight - heightBefore,
    write: grew => {
      if (grew !== 0) scroller.scrollTop = topBefore + grew
    },
  })
}

/**
 * Report the caret in DOCUMENT space, which is the only form that outlives the
 * session — a buffer offset names different text in the next window.
 */
function cursorReporter(
  docWindow: DocumentWindow,
  onCursor: ((at: DocumentPosition) => void) | undefined,
): Extension {
  if (onCursor === undefined) return []
  return EditorView.updateListener.of(update => {
    if (!update.selectionSet && !update.docChanged) return
    onCursor(docWindow.toDocument(update.state.selection.main.head as WindowPosition))
  })
}

/**
 * The editor reports a fact; the Pane owns the policy (D35). Reporting upward
 * keeps the dependency pointing from Z's view to Z's view-model, and it is also
 * how ScreenMetric stays calibrated — `to - from` is a screenful in characters.
 */
function viewportReporter(
  onViewport: ((visible: { from: WindowPosition; to: WindowPosition }) => void) | undefined,
): Extension {
  if (onViewport === undefined) return []
  return EditorView.updateListener.of(update => {
    if (!update.viewportChanged && !update.geometryChanged) return
    const { from, to } = update.view.viewport
    onViewport({ from: from as WindowPosition, to: to as WindowPosition })
  })
}

const IMAGE = /^image\/(png|jpeg|gif|webp|avif|heic)$/

/**
 * Take the images off an event, and say whether any were taken.
 *
 * **True means handled**, which stops CodeMirror inserting whatever text the
 * same event also carried: a screenshot copied from a browser often arrives with
 * an `<img>` tag beside it, and pasting both would put the picture in twice —
 * once as a file and once as somebody else's URL.
 *
 * **Text alongside an image is not a reason to refuse.** The picture is what was
 * meant; the markup beside it is the platform being helpful.
 */
function takeImages(
  data: DataTransfer | null,
  onImages: ((images: readonly DroppedImage[]) => void) | undefined,
): boolean {
  if (data === null || onImages === undefined) return false
  const files = [...data.files].filter(file => IMAGE.test(file.type))
  if (files.length === 0) return false
  void Promise.all(
    files.map(async file => ({
      // A pasted screenshot is `image.png`; a dropped one has the name somebody
      // gave it, which is worth keeping.
      name: file.name.replace(/\.[^.]+$/, '') || 'clipboard',
      ext: (IMAGE.exec(file.type)?.[1] ?? 'png').replace('jpeg', 'jpg'),
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  ).then(onImages)
  return true
}
