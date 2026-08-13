# Spike 01 — findings

Measured against `spike-01-experiment.md` as written, not as adjusted afterwards.

| | Question | Status |
|---|---|---|
| **A** | Does one surface do vim *and* inline widgets? | **Passes**, with three constraints below |
| **A′** | Does A run acceptably on Android? | **Passes**, with one hard finding: no vim on mobile |
| **B** | Which shell makes printing and paste cheap? | **Both do.** The Tauri pain was Tauri's |

**Both questions the spike existed to answer are now closed.** Q1 resolves to CodeMirror 6 as a single surface (D16); Q4 resolves to Electron (D17). Building can start.

**The one result worth carrying above all others** is not in the plan's success criteria, because nobody thought to ask for it: three separate times, the thing that decided a choice was *how typing felt*, and each time it was invisible to instrumentation. Non-vim beat vim in the browser; Chromium beat WebKit in the shells; neither difference showed up in keystroke-to-paint, input delay, JS time or long tasks. **On this project, the instrument of record for the editing surface is the person typing** — the numbers exist to catch a disaster, not to choose between good options.

Artifacts live in `spike-01/` and are disposable — `editor/` (the page), `shell-swift/`, `shell-electron/`. `npm run dev` serves the page; `node tools/probe.js` runs 28 assertions headless; `tools/bisect.js` and `tools/control.js` measure latency in a real window; `count.sh` attributes shell code per operation.

---

## Spike A — the editing surface: **passes**

CodeMirror 6 carries a genuine vim mode and inline widget decorations at the same time, over a 1.05 MB stream of real prose containing equations, tables and images. The 28-assertion suite covers `dd`, `x`, `cw`, `yy`/`p`, `v$d`, `j`/`k`, insertion adjacent to a widget, `/` search and undo across every widget type; all pass, and undo restores the document byte-for-byte every time.

**Latency is not the constraint.** Typing at 130 WPM mid-corpus, the editor's own work is **0.4 ms** at p99 per keystroke and the widget layer adds **0.2 ms**, flat regardless of position in the document. Input delay stays under 1 ms at 600 WPM, keystrokes never queue, and there are no long tasks. Everything else in the end-to-end number is the browser's input-to-present pipeline and the display refresh: the same measurement over a plain `<textarea>` holding the same 1.05 MB gives 5.8–17.5 ms at p99, against 16.3–32.9 ms for the full editor.

**The stated bar — p99 under 30 ms — is not the right instrument**, and this is the one place the experiment's contract needs amending rather than scoring. The numbers are bracketed because the two honest ways to measure disagree: the frame that paints the change is a lower bound, the frame after it an upper bound, and a whole display frame separates them. A criterion at 30 ms sits inside that bracket, so the same surface passes or fails depending on which end you read. What is unambiguous is the part the bar was proxying for: the editor contributes sub-millisecond work per keystroke and does not degrade with document size, widget count or typing speed. **The subjective criterion did its job** — typing at real speed feels good.

### Three constraints, discovered rather than chosen

**1. Block widgets cannot come from a view plugin.** CodeMirror refuses outright — *"Block decorations may not be specified via plugins."* So the widget layer splits in two: inline widgets (equations mid-line, thumbnails) are rebuilt per viewport in a `ViewPlugin`, while block widgets (tables, display equations, figures) live in a whole-document `StateField`. A state field cannot see the viewport, so it must not rescan a megabyte per keystroke; it maps its ranges through each change and rescans only the block the edit touched. Initial scan of the full corpus is 2 ms, incremental updates 0.2 ms.

**2. Rendered constructs must unrender under the cursor. This is mandatory, not stylistic.** `@replit/codemirror-vim` never consults CodeMirror's `atomicRanges` — it does its own offset arithmetic on the document, so nothing can tell it a widget is one unit. With a widget left rendered, six successive `l` presses leave the cursor frozen at the same pixel while vim walks the ten hidden source characters underneath. Unrender the construct the cursor is inside and every vim operation becomes exactly right, because vim is then operating on the text it thinks it is operating on. Vertical motion behaves differently — `j`/`k` go through `moveVertically`, which *does* respect atomic ranges — and that asymmetry is the whole of the problem.

**3. Block widgets need an adjacency reveal, or they are unreachable.** Replacing whole lines removes them from the visual layout, so vertical motion has nowhere to land: `j` skipped every table and display equation outright — `1→2→3→4→6→11→12`, with the table's four source rows never visited. Not merely awkward: unreachable means uneditable. Revealing a block when the cursor is on a *neighbouring* line gives motion an entry point, and `j` then visits every source line, with `k` walking back symmetrically. The cost is that a block flickers to source as you pass it, which is arguably the right behaviour anyway.

Marking block widgets atomic makes this worse and buys nothing, so inline widgets are atomic and block widgets are not.

### The fluidity finding, and what it costs

Typing feels good, but **noticeably less fluid with vim mode on than off** — a small, real, hard-to-name difference. It is not throughput. Keystroke-to-paint is identical either way (p50 4.2–12.5 ms with vim, 4.4–12.7 ms without), and both modes take the same insertion path: the browser's native `beforeinput` fires and is not default-prevented in either, so vim is not intercepting character keys and forcing a synthetic insert. Whatever it is sits below the resolution of these instruments.

The one dimension that *did* move measurably is the caret: CodeMirror's drawn cursor costs about 1 ms against the browser's native caret, and vim requires the drawn one for its block cursor. That is a lead, not a conclusion.

**Decision taken: vim is a switchable feature in the shipping UI** (D15). This is the right resolution regardless of cause — it converts an unnamed irritation into a preference, and the switch is nearly free since the entire vim layer already sits in one CodeMirror compartment.

### What was ruled out along the way

Line wrapping, markdown parsing, syntax colouring, selection-match highlighting, bracket matching and font smoothing were each measured on their own, and none of them is the culprit. Typing at the head of a 3 677-character wrapped paragraph — which forces the whole paragraph to re-wrap on every keystroke, and which the first round of measurement had missed entirely by only ever typing on freshly opened short lines — costs no more than typing at its tail or on a short line.

### Typography

Pushed to the Clarity app's sage palette and type scale: Lora at 18 px, warm stone surfaces, emerald accent, with heading sizes carried on the line so text reflows with them, markdown marks hidden away from the cursor, and KaTeX for equations. Font, size, measure, leading, paragraph spacing, tracking and caret width are all live controls on the page. It reaches the neighbourhood the criterion asked for.

---

## Spike A′ — the same page on Android: **passes**

Renders, scrolls and accepts text without lag or input-method trouble. The desktop and mobile editors do not have to be separate builds, which retires the risk D4 recorded.

**One finding sharp enough to be a constraint: vim mode is unusable on mobile.** Not degraded — unusable. A modal keymap over a soft keyboard has no way to work. This is an independent reason for D15 and the stronger of the two, because it is about capability rather than preference: the non-vim mode is not a fallback for people who dislike vim, it is what the phone always runs, and it therefore has to be good on its own terms.

## Spike B — the OS boundary: **both shells pass**

Printing a selected range and pasting an image were implemented twice, against the same editor page, in a native Swift shell hosting a WKWebView and in Electron. Both work end to end. **The Tauri finding does not generalize** — OS integration is not intrinsically expensive for a web-shelled app, and Q4 can stop treating it as the deciding cost.

No Xcode was needed: the Swift shell is a hand-assembled `.app` built with `swiftc` against the Command Line Tools SDK, which also keeps the measurement honest about the native path's scaffolding.

### The cost, which was the actual question

Shell-side lines, excluding comments, blanks and each shell's test driver:

| | Swift + WKWebView | Electron |
|---|---|---|
| serving the app's own assets three ways | 41 | 16 |
| the JS bridge | 37 | 10 |
| **print a range** | **71** | **23** |
| **paste an image** | **21** | **10** |

Both operations are describable in a paragraph in both shells, which is what the experiment asked. Electron is consistently two to three times cheaper, and that ratio is the honest summary of the difference — not a difference in kind.

### Printing: the hypothesis held, and the work is in the web layer

The prediction was that rendering a range for print belongs in the web layer and the shell contributes only the panel and page setup. That is what happened: **both shells produced an identical, correctly rendered PDF from the same ~90 lines of shared JavaScript** (markdown → HTML plus a print stylesheet). Headings, inline and display KaTeX, figures, and tables all render; no markup leaks through.

The shell-side differences are real but small:

- **`window.print()` does nothing inside a WKWebView** — WebKit exposes no public delegate for it on macOS. Printing must originate natively. In exchange, `printOperation(with:)` returns a real `NSPrintOperation`, so the user gets the genuine macOS print panel with margins and Save-as-PDF.
- Electron goes through Chromium's print path instead, which is less code and a less native panel.

**Four traps, all of which cost more time than the features did**, and all of which are the kind of thing that makes a stack feel expensive when it is merely undocumented:

1. An offscreen print view needs its **own copy of the custom-scheme handler**. Without it the base URL escapes to LaunchServices and macOS asks the user which application opens `tephra://` — a failure that would be alarming in a shipping build.
2. `printOperation` hands back a print view with a **zero frame**, which must be set to the content size.
3. `op.run()` without a window paginates 1 084 pt of content into **688 000 pages** and a 173 MB file. `op.runModal(for: window)` produces two pages and 72 KB. The operation needs a window even when no panel is shown.
4. In Electron, printing renders through a temp file, so **every relative image silently 404s** unless the print document carries an explicit `<base href>`. The fix belongs in the shared web layer and serves both shells.

### Pasting: trivial in both, with one fidelity difference worth keeping

Reading the system pasteboard natively is 21 lines in Swift and 10 in Electron. An image copied from a real application lands as a file in the notebook directory and a markdown link appears at the cursor.

The difference is what lands. **Swift writes the pasteboard's original PNG bytes; Electron re-encodes** through `nativeImage` — 7 610 bytes against 4 062 for the same 900×420 image. The pixels survive; the file does not. For a corpus intended to hold pasted material for twenty years, byte preservation is a small but real point for the native shell, and it is the sort of thing that cannot be recovered later.

### Where the app's assets come from — the check that was worth twenty minutes

Six runs: two shells × three origins. **The worry was largely unfounded.** Every origin is a secure context in both shells, with `navigator.clipboard`, `localStorage`, `indexedDB` and `crypto.subtle` available throughout.

| | localhost | `file://` | `tephra://` |
|---|---|---|---|
| Swift + WKWebView | all pass | **`fetch` fails** (opaque status 0) | all pass |
| Electron | all pass | all pass | all pass |

**A custom scheme is therefore the right shipping choice**, and it is available in both shells. It needs no port, and — unlike a localhost server inside a desktop app — it cannot be reached by any other process on the machine, which matters because these files hold other people's information. WKWebView grants it a secure context with no declaration at all; Electron needs `registerSchemesAsPrivileged({ secure: true })` before app startup.

One implementation detail that reads as a CORS failure and is not: **a `WKURLSchemeHandler` must return an `HTTPURLResponse` with a real status code.** A plain `URLResponse` makes `fetch` see an opaque status-0 reply and refuse the body.

`file://` is the option to avoid. WKWebView blocks its relative `fetch` even with `allowFileAccessFromFileURLs` set.

### The editor survives the engine change

Spike A measured everything in Chromium; a Swift shell means WebKit, and this was the one thing in Spike B that could have eliminated an option outright. It did not. Inside the WKWebView: widgets render, `dd` deletes a line holding a rendered equation and `u` restores it, and `j` walks every source line from 1 to 10 including the ones inside the display-math block and the table — so the adjacency reveal that Spike A discovered works in WebKit too. Typing 150 characters gives keystroke-to-paint of 4–17 ms at p50 and 15–31 ms at p99, with widget rebuilds at 1 ms and no keystroke queueing.

Two honest caveats. The keystrokes were dispatched from JavaScript rather than hardware, so **hardware input delay is not included** in those numbers and Event Timing does not record untrusted events. And a **correction to the capability table above**: WebKit's `PerformanceObserver.observe({type:'longtask'})` does not throw, but `supportedEntryTypes` does not list `longtask` — so the long-task metric is Chromium-only, and an earlier "yes" in that row was a false positive from too weak a check.

### The judgement that decided it

Typing in the Electron shell felt better than in the Swift shell — the same kind of subtle, hard-to-name difference as vim against non-vim, and if anything more acute. In the other direction, the Swift print panel showed a **preview of the document to be printed** and Electron's did not.

**On macOS these are not independent choices.** A native shell gets WKWebView; there is no way to put Chromium behind it short of embedding CEF, which this project cannot afford. Electron is Chromium by construction. So whatever makes the Swift shell feel subtly worse lives in the web view, and **cannot be fixed inside the Swift arm at all** — while the print gap closes in eleven lines in the Electron arm: render to PDF, show it in Chromium's own PDF viewer, which arrives with a page-thumbnail sidebar, zoom and a print button, and is arguably better than the panel's inline thumbnail. Electron's print section goes from 23 lines to 34, still half the Swift arm.

That asymmetry is the whole argument. The gap that cannot be closed sits on R1.1, the requirement the project exists to satisfy; the gap that closes cheaply sits on R11, which is occasional. **Q4 resolves to Electron** (D17).

The costs of that choice, recorded so they are not rediscovered as surprises: a ~150 MB bundled runtime, and paste that re-encodes rather than preserving the pasteboard's original bytes. The second is the one that cannot be undone later, and if it ever matters it is recoverable through a small native path.

---

## What this changes, and what it leaves alone

**Straight into v1's construction:**

- The widget layer splits in two — inline in a viewport-scanned `ViewPlugin`, block in an incrementally-updated `StateField`. This is forced by CodeMirror, not chosen.
- Rendered constructs unrender under the cursor, and blocks unrender from a neighbouring line. Both are correctness requirements for vim, not preferences.
- The app serves itself from a **custom scheme**, whose handler must return an `HTTPURLResponse` with a real status code. Not `file://`, and not a localhost server.
- Print renders the range to HTML in the web layer and hands it to the shell. The print document carries an explicit `<base href>`.
- Vim is a setting (D15), and the non-vim mode is a first-class surface because it is what the phone always runs.

**Left alone deliberately.** Q2 (storage), Q3 (the filling page) and Q5 (mobile scope) were not in this spike and are untouched by it. D4's sequencing survives: the specific risk it named — that v1's editor choice might not port to Android — is retired by A′.

## Known unknowns, recorded rather than resolved

- **Drag-and-drop** was deliberately left out. It is where the shells differ most, and it touches R21 and R23.
- **Rendered *editing*** — cursor enters a node, markup reveals, cursor leaves, it re-renders — was tested only as reveal-on-cursor for widgets. Q1's staging (inline constructs first, tables and equations last) is unaffected and still stands.
- **The WebKit latency numbers came from JavaScript-dispatched keystrokes**, so hardware input delay is not in them. This did not matter in the end, since the decision turned on subjective feel, but the numbers should not be quoted as if they were hardware-driven.
- **Why vim and WebKit each feel worse** remains unexplained. The one measurable lead is that CodeMirror's drawn caret costs about 1 ms against the browser's native caret, and vim requires the drawn one.
