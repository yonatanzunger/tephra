# Spike 01 — experiment definition

**Answers:** Q1 (one surface, vim plus inline rendering) and Q4 (stack, at the OS-integration boundary).

This is a contract, written before building, so that "it sort of works" is not an available outcome. The artifacts are disposable and will not be carried into v1.

## The decomposition that makes this cheap

The original plan was one spike answering Q1 and Q4 together. They separate, and separating them front-loads the decisive test: **the editor question can be answered in a plain browser page, at zero platform cost.** Only if it passes does the shell question matter at all.

| | Question | Cost | Run if |
|---|---|---|---|
| **A** | Does one surface do vim *and* inline widgets? | An evening | always — first |
| **A′** | Does A run acceptably on Android? | Half an hour | A passes |
| **B** | Which shell makes printing and paste cheap? | An evening or two | A passes |

**Not being spiked: candidate 1, the fully native editor.** Building vim behaviour and markdown rendering from scratch in SwiftUI/AppKit is very expensive and sits on the maintainer's weakest ground, so it is worth its cost only if A fails. This is a deliberate exclusion, not an oversight, and A failing reopens it immediately.

**Also not being spiked: the windowed document over day files (D8).** It was in an earlier draft of this plan and does not belong, because **nothing in it is empirically uncertain.** Stitching a window of files into one document, writing back only the touched regions, and restoring position are all reachable by reasoning; the one genuinely unknown quantity — whether the editor stays fast at that document size — is already measured by Spike A. Building it would be starting v1, not testing a hypothesis, and a prototype carried into production is technical debt from day one. It is v1's first construction task instead (`solution/parts/components.md`), and it should follow A rather than run beside it, since a poor latency result would change the window size and therefore the design.

---

## Spike A — the editing surface

**Hypothesis.** CodeMirror 6 in a plain browser page supports a genuine vim mode *and* inline widget decorations simultaneously, with keystroke-to-paint latency imperceptible at 130 WPM in a document of realistic size.

**The sharp part is not rendering — it is vim operating over widgets.** Rendering an equation inline is well-trodden. The risk is what `dd` does to a line containing a rendered equation, whether cursor motion through a widget behaves sanely, whether visual-select spans one correctly, and whether undo puts things back. That interaction is where this either works or quietly doesn't, so it is tested explicitly rather than assumed.

**Build.** One HTML page. CodeMirror 6, vim keymap, and widget decorations for: an inline TeX equation, an inline image, and a markdown table. Load roughly 1 MB of prose so the measurement has margin. Instrument keystroke-to-paint.

**Success**, all of:
- p99 keystroke-to-paint **under 30 ms** with the document loaded, and no queueing under burst typing.
- Typing a full page at unthrottled speed **feels right** — the subjective judgement is the real criterion; the number exists to prevent talking yourself into a bad one.
- Motion across, deletion of, visual selection spanning, and undo over a rendered widget all behave the way vim should.
- Typography can be pushed to somewhere in the neighbourhood of the Clarity app's styling.

**Failure**, any of:
- Sustained p99 above 50 ms, or perceptible lag while typing.
- Vim behaviour around widgets that is wrong in a way not fixable by configuration.
- Widget rendering that degrades as the document grows.

**Not building.** Editing the rendered forms, mode switching, persistence, file loading, styling beyond what is needed to judge typography.

## Spike A′ — the same page on Android

**Hypothesis.** Spike A's page runs acceptably in Android Chrome and in a system WebView.

**Why it is here.** D4 records the sequencing's known weakness: v1's editor choice may not port to Android, and that only becomes visible in v2. This retires that risk for half an hour of work, which is an absurdly good trade.

**Build.** Serve the same page. Open it on the phone. Type into it with a Bluetooth keyboard and with the soft keyboard.

**Success.** Renders correctly, scrolls smoothly, accepts text without lag or input-method weirdness. **Failure.** Any of those failing — which would mean the desktop and mobile editors are separate builds, and that should be known now rather than in v2.

## Spike B — the OS boundary

**Hypothesis.** A native shell hosting a web view makes printing a selected range and pasting an image from the clipboard straightforward, where Tauri made them painful.

**Why these two tasks.** They are where pain has been *measured* rather than suspected, and between them they touch four requirements: printing a range (R11), pasting images in situ (R7), opening documents by OS intent (R21), and drag-and-drop later.

**Build.** The same two operations — print the current selection with a sane page setup, and paste an image from the clipboard so it lands as a file plus a markdown link — implemented twice: once in a **native Swift shell hosting a WKWebView**, once in **Electron**. Tauri needs no third implementation; its result is already known.

**Success.** Both operations work end to end, and the shell-side code for each is small enough to describe in a paragraph. Latency from Spike A is re-measured in-shell and holds.

**Failure.** Either operation requiring the kind of effort Tauri demanded, in both shells — which would mean the OS-integration cost is intrinsic rather than Tauri-specific, and would revive candidate 1 despite its price.

**Not building.** Menus, window management, app packaging, code signing, preferences.

---

## What gets recorded

Findings go to `goal/discovery/spike-01-findings.md`, and Q1 and Q4 are resolved or updated in `goal/open-questions.md` against the criteria above — as written, not as adjusted afterwards.
