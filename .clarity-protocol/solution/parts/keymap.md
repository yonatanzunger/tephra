# The keymap — inventory

**M5's one remaining item, and this is its first half.** R1.5 says *"the UX is
the user's own… a design that drifts toward someone else's conventions has failed
on its own terms"*, and the editing surface currently inherits fifty-nine key
bindings nobody has looked at. Deciding what they should do needs knowing what
they do, which nothing in the repository could say.

**This document is generated from the packages; `tests/unit/keymap.test.ts` is
what keeps it true.** That test fails when a binding appears or disappears, so an
upgrade cannot decide a key on our behalf.

## Five sources, none of which knows about the others

1. **`markdownKeymap`** — installed silently by `markdown()` unless
   `addKeymap: false` is passed. Two bindings, and they are the two that matter
   most: `Enter → insertNewlineContinueMarkup` and
   `Backspace → deleteMarkupBackward`. **This is the source that was invisible.**
   Reading the code I claimed Enter did not continue a list and that Backspace
   deleting a list marker was accidental; both were wrong, and both behaviours
   come from here.
2. **`defaultKeymap`** from `@codemirror/commands` — the fifty-nine below, minus
   one removed by hand.
3. **`listIndent()`**, ours — `Tab` and `Shift-Tab`, at `Prec.high`, declining
   outside a list.
4. **Menu accelerators**, which never reach CodeMirror at all: Electron handles
   them first and dispatches a command over IPC. An accelerator over a binding
   does not race it, it **kills** it.
5. **DOM handlers on components** — the find bar's `Enter` and `Escape`, the
   paste and drop handler (R7), the task row's field.

**Precedence is by array position in `bind.ts`**, which is worth knowing because
it is fragile: `markdown()` is installed before `keymap.of(defaultKeymap)`, and
that is the only reason `Enter` continues a list. Moving one line would change it
with nothing to say so.

## What the menu takes away

Three editor bindings are covered by a menu accelerator. Each is a decision, and
`SHADOWED` in the test holds the reason so the list cannot rot:

| Key | Editor would do | Menu does instead |
|---|---|---|
| `Mod-i` | `selectParentSyntax` | **Italic** — and this one is *removed* in `bind.ts` rather than merely covered, because selecting a paragraph out from under you is worse than nothing |
| `Mod-/` | `toggleComment` | **Strikeout** — `toggleComment` in markdown wraps prose in HTML comments |
| `Mod-a` | `selectAll` | **Select All**, which is the same act, so which wins cannot be observed |

**`Ctrl-` is not `Mod-`**, and conflating them was worth an entry of its own: the
first version of the test reported eight collisions between the emacs bindings
and ⌘-accelerators. `Ctrl-k` is Control-K and ⌘K is Link; they do not meet.

**A `role` is an accelerator too.** `{ role: 'selectAll' }` writes no accelerator
string but takes ⌘A from the page just the same, which is how `Mod-a` was missed
at first.

## Live, inherited, and undecided

The keys M5 actually has to make a decision about. Not bugs — open questions,
listed so that an upgrade cannot answer one instead of us:

- **`Shift-Mod-k` → `deleteLine`.** Deletes the whole line, and sits next to ⌘K,
  which is Link.
- **`Cmd-ArrowUp` / `Cmd-ArrowDown` / `Mod-Home` / `Mod-End` → document
  start/end.** In a windowed twenty-year stream "the document" is *the loaded
  window*, so these go somewhere arbitrary and call it the beginning.
- **The emacs layer** — `Ctrl-k` (delete to line end), `Ctrl-o` (split line),
  `Ctrl-t` (transpose), `Ctrl-v` (page down). macOS makes some of these standard
  and not these four.
- **`Mod-Alt-ArrowUp` / `Mod-Alt-ArrowDown` → multiple cursors**, in a prose
  editor.
- **`Mod-[` / `Mod-]` / `Mod-Alt-\` / `Shift-Mod-\`** — indentation and bracket
  matching, from a code editor.
- **`Shift-Alt-m` → `toggleTabFocusMode`.** Obscure enough to be worth naming.
- **`Escape` → `simplifySelection`**, which collides conceptually with the find
  bar's Escape: whichever has focus wins, and that has never been decided.

## Every binding, as of 2026-09-09

Generated. `anonymous` means the command is an inline closure in the package with
no name to report — `Enter` is `insertNewlineContinueMarkup`, `Mod-Enter` is
insert-blank-line, `Alt-A` is toggle-block-comment.

| Key | Does | With Shift |
|---|---|---|
| `Enter` | anonymous | — |
| `Escape` | simplifySelection | — |
| `Alt-ArrowUp` | moveLineUp | — |
| `Shift-Alt-ArrowUp` | copyLineUp | — |
| `Alt-ArrowDown` | moveLineDown | — |
| `Shift-Alt-ArrowDown` | copyLineDown | — |
| `Mod-Alt-ArrowUp` | addCursorAbove | — |
| `Mod-Alt-ArrowDown` | addCursorBelow | — |
| `ArrowLeft` | cursorCharLeft | selectCharLeft |
| `Alt-ArrowLeft` | cursorGroupLeft | selectGroupLeft |
| `Cmd-ArrowLeft` | cursorLineBoundaryLeft | selectLineBoundaryLeft |
| `ArrowRight` | cursorCharRight | selectCharRight |
| `Alt-ArrowRight` | cursorGroupRight | selectGroupRight |
| `Cmd-ArrowRight` | cursorLineBoundaryRight | selectLineBoundaryRight |
| `ArrowUp` | cursorLineUp | selectLineUp |
| `Cmd-ArrowUp` | cursorDocStart | selectDocStart |
| `ArrowDown` | cursorLineDown | selectLineDown |
| `Cmd-ArrowDown` | cursorDocEnd | selectDocEnd |
| `PageUp` | cursorPageUp | selectPageUp |
| `PageDown` | cursorPageDown | selectPageDown |
| `Home` | cursorLineBoundaryBackward | selectLineBoundaryBackward |
| `Mod-Home` | cursorDocStart | selectDocStart |
| `End` | cursorLineBoundaryForward | selectLineBoundaryForward |
| `Mod-End` | cursorDocEnd | selectDocEnd |
| `Backspace` | deleteMarkupBackward | — |
| `Delete` | deleteCharForward | — |
| `Alt-Backspace` | deleteGroupBackward | — |
| `Alt-Delete` | deleteGroupForward | — |
| `Mod-Backspace` | deleteLineBoundaryBackward | — |
| `Mod-Delete` | deleteLineBoundaryForward | — |
| `Ctrl-ArrowLeft` | cursorSyntaxLeft | selectSyntaxLeft |
| `Ctrl-ArrowRight` | cursorSyntaxRight | selectSyntaxRight |
| `Ctrl-l` | selectLine | — |
| `Ctrl-A` | anonymous | — |
| `Ctrl-ArrowUp` | cursorPageUp | selectPageUp |
| `Ctrl-ArrowDown` | cursorPageDown | selectPageDown |
| `Ctrl-b` | cursorCharLeft | selectCharLeft |
| `Ctrl-f` | cursorCharRight | selectCharRight |
| `Ctrl-p` | cursorLineUp | selectLineUp |
| `Ctrl-n` | cursorLineDown | selectLineDown |
| `Ctrl-a` | cursorLineStart | selectLineStart |
| `Ctrl-e` | cursorLineEnd | selectLineEnd |
| `Ctrl-d` | deleteCharForward | — |
| `Ctrl-h` | deleteCharBackward | — |
| `Ctrl-k` | deleteToLineEnd | — |
| `Ctrl-Alt-h` | deleteGroupBackward | — |
| `Ctrl-o` | splitLine | — |
| `Ctrl-t` | transposeChars | — |
| `Ctrl-v` | cursorPageDown | — |
| `Mod-Enter` | anonymous | — |
| `Mod-i` | selectParentSyntax | — |
| `Mod-[` | indentLess | — |
| `Mod-]` | indentMore | — |
| `Mod-Alt-\` | indentSelection | — |
| `Shift-Mod-k` | deleteLine | — |
| `Shift-Mod-\` | cursorMatchingBracket | — |
| `Mod-/` | toggleComment | — |
| `Shift-Alt-m` | toggleTabFocusMode | — |
| `Mod-a` | selectAll | — |
