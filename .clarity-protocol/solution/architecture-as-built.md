# Architecture, as built

**A map, not a design.** `architecture.md` holds the layering principles and the
rules that keep them honest; this says where each of those things actually lives
and what the contract between them is, so that "where does X happen" has a
one-line answer.

Current as of MV. Everything below exists and runs.

---

## The shape

```mermaid
flowchart TB
  subgraph MAIN["Electron main process"]
    direction TB
    subgraph X["X — logical objects"]
      SD["StreamDocument<br/><i>main/x/documents/kinds/stream.ts</i><br/>generation, undo/redo, replace"]
      DW["DocumentWindow<br/><i>main/x/window.ts</i><br/>buffer ↔ document coordinates"]
      SEG["Segment<br/><i>main/x/segment.ts</i><br/>one day file, spliced not serialised"]
      PARSE["frontmatter · markers · text-edits · anomalies<br/><i>main/x/</i>"]
    end
    subgraph W["W — infrastructure"]
      NB["Notebook<br/><i>main/w/notebook.ts</i><br/>read · write · list · watch"]
      REPO["Repository <i>(interface)</i><br/><i>main/w/repository.ts</i><br/>save · versions · contentAt · moveTo"]
      GIT["GitRepository<br/><i>main/w/git-repository.ts</i><br/>one implementation"]
      WBITS["layout · atomic · lock · watcher · themes<br/><i>main/w/</i>"]
    end
    SVC["DocumentService<br/><i>main/document-service.ts</i><br/>serial queue, write tiers<br/><b>Electron-free</b>"]
    MENU["menu · scheme · ipc<br/><i>main/</i>"]
  end

  subgraph BRIDGE["The process boundary"]
    CH["CHANNEL + payload types<br/><i>shared/ipc.ts</i>"]
    PRE["contextBridge<br/><i>preload/index.ts</i>"]
  end

  subgraph REND["Renderer — Chromium"]
    subgraph XR["X mirror — synchronous facade"]
      RD["RemoteDocument<br/><i>renderer/src/x/remote-document.ts</i>"]
      RW["RemoteWindow<br/><i>renderer/src/x/remote-window.ts</i><br/>local text, optimistic edits"]
    end
    subgraph Z["Z — features and UI"]
      PANE["Pane<br/><i>renderer/src/pane/pane.ts</i><br/>navigation, extent policy"]
      ED["Editor + bind<br/><i>renderer/src/editor/</i><br/>CodeMirror 6, widgets, vim"]
      FR["Frame · Nav · Anomalies<br/><i>renderer/src/frame/</i>"]
      TH["Theme<br/><i>renderer/src/theme/</i>"]
    end
  end

  SD --> SEG
  DW --> SD
  SEG --> PARSE
  SD --> NB
  GIT -.implements.-> REPO
  HIST["StreamHistory<br/><i>main/x/history.ts</i>"] --> REPO
  SVC --> REPO
  NB --> WBITS
  SVC --> SD
  SVC --> DW
  MENU --> SVC
  SVC <--> CH
  CH <--> PRE
  PRE <--> RD
  RD --> RW
  PANE --> RD
  PANE --> RW
  ED --> RW
  FR --> PANE
  TH --> RD
  NB -. "file changed on disk" .-> SD
```

**X lives in main, not in a hidden renderer** (D37). One consequence shapes
everything else: the renderer holds a *mirror* of X — `RemoteDocument` and
`RemoteWindow` — which keeps a local copy of the text so that coordinates can be
answered **synchronously**. An editor cannot await an IPC round trip to find out
where a character is.

---

## The contracts, and where each one is written down

| Boundary | Contract | File |
|---|---|---|
| Z ↔ X | Document, window, positions, edits | `shared/document-api.ts` |
| Z ↔ X | Navigation targets, boundary states | `shared/pane-api.ts` |
| Z ↔ X | History, generations | `shared/history-api.ts` |
| across processes | Channel names and payload shapes | `shared/ipc.ts` |
| across processes | The exposed surface itself | `preload/index.ts` (+ `.d.ts`) |
| X ↔ W | Files, listing, watching | `Notebook` in `main/w/notebook.ts` |
| X ↔ W | Where a file goes | `main/w/layout.ts` |
| X ↔ W | Durable versioned storage | `Repository` in `main/w/repository.ts` |
| anywhere | Themes | `shared/theme.ts` |
| anywhere | Format anomalies | `shared/anomalies.ts` |
| anywhere | Extent policy, screens→chars | `shared/extent.ts` |
| anywhere | Positions, dates | `shared/positions.ts`, `shared/dates.ts` |

**`shared/` is type-only plus pure functions.** No Node, no Electron, no
CodeMirror — which is what lets the same rules be tested under `node --test` and
run in the browser. `frame/metrics.ts` is the one renderer file compiled into
both projects, for that reason.

---

## Where things happen

| Looking for | It is here |
|---|---|
| Typing reaches the file | `bind.ts` → `RemoteWindow.edit` → IPC → `DocumentService.edit` → `DocumentWindow.edit` → `StreamDocument.replace` → `Segment` → `Notebook.write` |
| An edit crossing midnight is split | `DocumentWindow.#toDocumentEdits` — property-tested over every range |
| Which day owns a boundary offset | `DocumentWindow.#segmentAt`; the later day owns it |
| Undo and redo | `StreamDocument.#stepBack` / `redo`; both directions derived there |
| Work is saved to history | `DocumentService` commit tier → `Repository.save` |
| Reading an old version | `StreamHistory.readDay` → `Repository.contentAt` |
| Undo that lands off-screen | `App.tsx`, the `revealing` wrapper — navigates to it |
| External edits are adopted | `Notebook` watcher → `StreamDocument`; divergence is surfaced, never resolved (D12) |
| Text is written to disk | `DocumentService` write tiers — quiescence **and** a ceiling |
| The window never moves | `frame/metrics.ts` + `Frame.tsx` (D42) |
| Type is decided | `shared/theme.ts` + `theme/useTheme.ts`; files in `config/themes/` |
| Markup is hidden or revealed | `editor/widgets.ts` — and see **Q11**, unresolved |
| Format problems surface | `main/x/anomalies.ts` → titlebar count → `frame/Anomalies.tsx` |

---

## Two rules the code depends on

**Positions are (segment, offset, generation), never buffer offsets** — D11. A
buffer offset means nothing across a reload, because the next window may load a
different range and the same number would name different text. The one
deliberate exception is soft state like the stored cursor, "precisely because
being wrong is cheap and self-correcting."

**Edits are optimistic and never awaited on the typing path** — R1.1. The editor
paints, `RemoteWindow` applies the edit to its local copy immediately, and the
IPC round trip confirms afterwards. Main is authoritative: if the acked length
disagrees, the window resynchronises and raises `DesyncError` rather than
continuing on a buffer that no longer describes the document.

---

## Not built yet

Day-file split, the WAL, git, and the purge procedure are **M1** — the corpus is
not yet safe. Range operations (tag, bookmark, print, branch) are **M2**;
filesets and the section index **M3**; search and filtered views **M4**. The
mobile app is v2b, after sync. See `milestones.md`.
