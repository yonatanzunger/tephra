# Spike 01 — discovery artifacts

Disposable by design. Nothing here should be carried into v1; it exists to have
answered Q1 and Q4, and is kept only as a reference. Findings and the decisions
they produced are in `.clarity-protocol/goal/discovery/spike-01-findings.md`,
D15, D16 and D17.

## Layout

| | |
|---|---|
| `editor/` | the page — CodeMirror 6, vim, KaTeX widgets, latency instrumentation |
| `shell-swift/` | native Swift shell hosting a WKWebView, built without Xcode |
| `shell-electron/` | Electron shell, the control arm |
| `count.sh` | attributes shell-side lines per operation |
| `compare-caps.js` | folds capability reports into one table |

## Running it

```sh
cd editor && npm install
node tools/make-corpus.js     # fetches its own source text, writes public/corpus.md
npm run dev                   # serves on :8321, and on the LAN for the phone
```

Everything under `editor/public/` except `index.html`, `caps.html`, `app.css`
and `baseline.html` is generated — `bundle.js`, `vendor/`, `corpus.md` and
`img/` all rebuild from the two commands above.

**The corpus is reproducible byte for byte.** `make-corpus.js` pins its source
(Project Gutenberg's *Moby Dick*) and caches it, which is what makes a later
latency comparison against these numbers meaningful rather than suggestive.

## The instruments

| | |
|---|---|
| `tools/probe.js` | 28 headless assertions — the vim-over-widget behaviours D16 protects |
| `tools/control.js` | latency against a plain `<textarea>` holding the same corpus |
| `tools/bisect.js` | one fluidity dimension at a time, to find what "feels off" |
| `tools/latency.js` | keystroke-to-paint across widget density, position and speed |
| `tools/exp-vim-path.js` | which insertion path vim takes — the evidence behind D15 |

`probe.js` is the one worth re-pointing at the real editor when it exists. It
encodes exactly the behaviours that D16's three constraints exist to protect,
and re-deriving them from prose would be a waste.

Latency tools open a real Chrome window and take the keyboard for a minute or
two; the headless numbers are not trustworthy, because headless Chrome has no
compositor.

## The shells

```sh
cd shell-swift && ./build.sh && ./run.sh scheme      # or: localhost | file
cd shell-electron && npm install && ./run.sh scheme
```

Both take a load mode, and `./caps-run.sh` in either collects the capability
matrix across all three. `TEPHRA_SELFTEST=1` drives print and paste without a
human; `TEPHRA_PDF=<path>` saves instead of showing a panel.

The Swift shell needs no Xcode — `build.sh` assembles an `.app` by hand with
`swiftc` against the Command Line Tools SDK.
