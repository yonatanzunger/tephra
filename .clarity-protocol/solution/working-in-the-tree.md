# Working in the tree

**How to run Tephra, how to test it, and the handful of things that have cost an
afternoon each.** Lifted out of `milestones.md` on 2026-09-16, when that file
became the list of projects rather than a plan with a workshop attached at the
foot. Nothing here is design — `architecture.md` holds the *why* and
`architecture-as-built.md` the map.

## Finding your way around the code

`architecture-as-built.md` is the map: the W/X/Z layers as modules, a diagram of
how a keystroke reaches the disk, and a table saying which file holds each
contract between the layers.

The tiers inside main are `parts/service-layers.md` — shell, composing, domain,
foundation, acyclic rather than numbered, and every service file names its own
tier in its opening comment. Two rules there are mechanical and are checked by
`tests/unit/main/layering.test.ts`: `main/services/` imports nothing from
Electron, and **no service imports `main/shell/`** — the second is the one that
broke three times, most recently one indirection out, through a shell file that
imported `app` itself.

## Running it

`app/run.sh` is the wrapper, and `app/Tephra.command` is the same thing made
double-clickable from Finder.

```
./run.sh              the real notebook at ~/Tephra
./run.sh --scratch    a throwaway notebook, for testing
./run.sh --root PATH  a specific one
./run.sh --dev        renderer HMR; a dev-only exception to D17
```

It rebuilds when anything under `src/` is newer than the built main process, so
"did I remember to build?" stops being a question. It also unsets
`ELECTRON_RUN_AS_NODE`, which is set in some shells and makes `require('electron')`
return a path string — the app then dies at startup with an error naming none of
that, and it has cost an afternoon once already.

```
npm run test:full     typecheck, unit and integration, then all eight suites
npm run install:app   package, then replace /Applications/Tephra.app
```

**Not `npm run install`.** A script called `install` is an npm LIFECYCLE hook: it
would run on every `npm install`, so adding a dependency would package the app
and overwrite the one in /Applications. The colon is what keeps it a command you
ask for.

`install:app` refuses while Tephra is running — replacing a running bundle works
until the app reaches for a resource that moved, and then dies somewhere
unrelated — and it REMOVES the old bundle rather than copying over it, since
`cp -R` onto an existing `.app` copies *into* it and leaves stale resources
inside a signed bundle. `--force` is there for when you know better.

**Packaging exists**: `npm run package` builds `dist/Tephra-darwin-arm64/Tephra.app`
with `@electron/packager` — a `.app` and nothing else, because one person on one
machine needs no installer, no auto-update and no DMG.

Ad-hoc signed, which on Apple Silicon is required rather than optional: arm64
macOS refuses to execute a binary whose signature does not match its bundle, and
packaging invalidates the one Electron ships with. Developer ID and notarization
are still deliberately not done — they matter only for apps other people
download.

**The icon is a placeholder.** The wiring is what matters: dropping a different
`design/icon/Tephra.icns` at that path is the whole of replacing it.

`run.sh` and `Tephra.command` remain for development; the packaged app is for
use. The `CFBundleName` patch in `run.sh` is now only needed by the dev path,
since a real bundle carries its own name.

## What the suites are

Three kinds of check, and they answer different questions. The unit and
integration tests (`npm test`) run the code directly; the **acceptance suites**
launch the real Electron app against a fixture notebook and assert against the
files on disk and what a running window can be asked; and a **screenshot** is
the only way to see what a person would see.

| Suite | The claim it checks |
|---|---|
| `m0` | Type, quit, reopen: **nothing written is ever lost.** Two real launches over one notebook. |
| `m1` | The corpus is safe — a deliberate crash, the WAL, the git repository, divergence. |
| `m2` | A range becomes something you can act on: comments, marks, tags, branching, typography. |
| `m3` | Getting around and getting out: printing, the sidebar, curated sections, the file lifecycle, windows across a quit, themes, the list's fields, smart quotes. |
| `m4` | You can find what you wrote: the walk, the results pane, the query grammar, images. |
| `mh1` | A docket is a document you can think with. |
| `mh2` | The horizon exists as a place, and draws on both its sources. |
| `mh4` | Reorientation: the day's selection, and that choosing an item does not move it. |

**Three things about running them that are not obvious and have each cost time:**

- **`npm run typecheck` is the only real typecheck.** `npx tsc -p .` silently
  skips the main process, and `tsx` does not typecheck at all.
- **`env -u ELECTRON_RUN_AS_NODE` in front of anything that launches Electron**,
  for the reason `run.sh` unsets it.
- **The suites are serial.** They share `out/`, and each rebuilds at its start —
  so two at once fight over the build, and **editing `src/` while one is in
  flight** means the suite is testing something that no longer exists.

**A screenshot is part of verification, not a nicety:**

```
TEPHRA_ROOT=<fixture> TEPHRA_VERIFY_MODE=1 \
  TEPHRA_SHOT=/tmp/shot.png TEPHRA_SHOT_DELAY=6000 ./node_modules/.bin/electron .
```

It renders against the build in `out/`, so **a shot after an edit shows the
previous build** unless `npm run build` runs first — which is a thing already
looked at twice and believed once.

## Keeping the suites fast

**Where it stands, measured 2026-09-16 on the development machine.** `npm test`
is **1,168 tests in 18 seconds**; the eight acceptance suites are **559 checks
in eight minutes** of real Electron. Half of that is `m3` alone — 248 seconds,
286 checks — which is what a suite looks like when a milestone's worth of
navigation, lifecycle, theme and list behaviour accumulates in one place. If the
run gets slower, look there first.

They were nine minutes and six respectively at their worst, and what fixed each
is worth writing down because both will happen again.

**`npm test`: a fixture that started a service and never stopped it.** One file
took 61 seconds of wall clock for half a second of CPU — it set a 60-second file
tier deliberately (so the tier could not rescue what the WAL was being tested
for), typed, and closed the notebook without stopping the service. The tier's
timer then held the process open for its whole interval after the tests had
passed. **A test that starts a service is a process that has to stop it**, which
is what the app does on quit (D32).

**The acceptance suites: waiting a fixed time instead of waiting for a fact.**
Every scene opened with a flat 1.8-second settle — a guess about the slowest
machine, paid on every machine, and still wrong on a slower one. `until()` polls
for the window being ready instead. That is a minute across the suites, and it
is also why scenes used to fail under load: a fixed wait that is too short does
not slow down, it lies.

**Both suites report where their time goes.** `TEPHRA_TIMING=1 npm run m3`
prints seconds per scene, slowest first. A harness that cannot say what it spent
gets slower by accident, which is exactly what happened here.

**And every date a fixture writes is relative** (`dayFrom` in the harnesses). A
due date spelled `2026-09-14` is a different number of days away tomorrow than
today, so a literal passes on the day it was written and fails every day after.
Two checks did exactly that and were caught by the calendar rolling over
mid-session.

## How to know what to test

**The rule that replaced "test M0's list".** Every suite above exists because
the layer beneath it could not see the claim — that sentence is in the header
comment of each one, and it is the test for whether a new check belongs there or
in `npm test`. If a unit test can assert it, it belongs in a unit test; the
suites are for what only a running window can be asked.

- **A scene is a claim, not a script.** It goes in `src/renderer/src/verify.ts`
  and reports facts with `say(...)`; the assertions live in the suite's `.mjs`
  and are written so the failure message names the numbers.
- **A check whose failure would read as "confusing" rather than "wrong" wants a
  screenshot**, because that is the class the suites cannot see: overlap,
  baseline, measure, whether a control looks like a control.
- **After every change, the acceptance run is `npm run m0` at minimum** —
  because it asserts the property the whole project rests on: that nothing
  written is ever lost.
