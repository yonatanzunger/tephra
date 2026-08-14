# Tests

```
unit/         mirrors src/ — pure logic, no Electron, runs in plain Node
integration/  paths that cross layers: crash recovery, format round-trip, the split
fixtures/     corpora that are awkward to produce by hand
```

**`integration/` is the half that matters most here.** `implementation-notes.md` §5
lists the paths that will otherwise never be tested — the day-file split fires
roughly once every few years at real writing volume, crash recovery cannot be
observed by using the app normally, and the divergence path is rare by design.
A path that fires rarely is broken when it fires, so each of those gets a test
that forces it rather than waiting for it.

**`fixtures/` exists because some of those cannot be written by hand** — a
synthetic oversized day file to force the split, a corpus with unbalanced
markers, a file whose frontmatter disagrees with its filename.

Unit tests import from `src/` directly and must not import `electron`; anything
needing the runtime belongs in `integration/`.
