# Undo, autosave and versioned history — options

Open. This is the point where a v1 question (how undo works) and a v2/v3 question (the sync architecture) have to be answered together, because the wrong choice misaligns them.

## The actual problem

Two kinds of history want to exist:

- **H1 — fine-grained edit history.** Keystroke or edit-group granularity, seconds to hours old, answers *undo what I just did*.
- **H2 — versioned history.** Commit granularity, days to years old, answers *what did this look like in March, and restore it*.

They are not the same thing at different scales; they answer different questions with different granularities. The difficulty is entirely in **three places where they touch**:

1. **Autosave.** With continuous saving there is no discrete "save" event to anchor a version to. If every autosave is a version, history becomes unreadable noise; if it is not, some writes are durable but unversioned.
2. **Remote merge.** A sync pull injects changes the user did not make into the substrate H1 is built over. What does ⌘Z mean afterwards?
3. **Hand-editing.** A change arrives from outside both histories, with no record of intent.

**An option is good if it puts all three in one place, and bad if it spreads them across two mechanisms that must agree.**

## Three axes

| Axis | Choices |
|---|---|
| **Where H1 lives** | editor memory (volatile) · local disk journal · the versioned store itself |
| **Unit of H2** | per change · per autosave · per quiescence · per explicit checkpoint |
| **Remote changes vs H1** | enter the undo stack · map through it · truncate it · cannot occur while editing |

## The options

### 1. Journal + digest, implemented by us

H1 and H2 are one mechanism: an append-only log of change records with periodic realised snapshots. Undo and rewind are the same operation at different distances.

- **For.** One source of truth for history, so the three touch-points collapse into one. Storage-agnostic — any blob store can be the hub, since we ship the log rather than relying on the store's versioning. Rewind granularity is arbitrary.
- **Against.** We build all of it: compaction, integrity, divergence of two logs, garbage collection. **Hand-editing needs a ceremony** — a change arriving from outside the log has to be admitted to it, either by an explicit gesture or by synthesising a diff record, and synthesised records have no intent or grouping. And it forces the authority question: if the log is truth, plain files are a materialisation (which D31 argues is survivable but collides with hand-editing being a first-class path).
- **Where the mess lands.** Inside our code, at the log/file boundary.

### 2. Volatile in-memory undo; the hub does versioning

H1 is the editor's own history, lost on restart. H2 is the versioned store, committing on quiescence.

- **For.** Dramatically less to build — the editor supplies H1 free, and a versioned store supplies H2 free. **No ceremony:** a hand-edit is just a file change that gets committed like any other. No second local representation of the corpus. This is the VSCode + git arrangement, which is proven and which nobody finds confusing.
- **Against.** Undo is lost on restart. And **in v1 there is no hub, so v1 has no recovery at all** — which is precisely when a new application is most likely to eat a paragraph. See modifier M1, which removes this objection.
- **Where the mess lands.** Only at remote merge, and the editor's collab machinery already handles it.

### 3. Undo *is* rewind — one history, no H1

Every autosave is a version; ⌘Z reverts to the previous one.

- **For.** Exactly one mechanism, so there is no interaction problem to solve at all. Conceptually the cleanest thing on this list.
- **Against.** **The granularity is wrong in both directions.** Undo becomes "the last two seconds of typing" rather than the last word or sentence, which is not what anyone means by undo. And a version per autosave is hundreds of commits a day and millions over twenty years, which makes H2 unreadable as history. It also puts a commit on a path that must never block typing.
- **Verdict.** Worth stating because it demonstrates *why* two granularities exist rather than being an accident.

### 4. Three tiers with one job each — volatile undo, minimal WAL, hub history

Option 2, plus a write-ahead log that is **explicitly not a history**: it holds only the changes since the last file write, and is discarded at every write.

- **For.** Each mechanism has exactly one job. The WAL covers the crash gap between memory and disk, and being seconds long it is not a second history and cannot disagree with one. **"What was destroyed three weeks ago" moves to the hub**, where it is durable, versioned and cross-device — strictly better than a local 30-day journal. This **retires the 30-day retention of D28** and the ambiguity that came with it.
- **Against.** Undo still lost on restart. Requires the hub to exist for any recovery beyond seconds — again see M1.
- **Where the mess lands.** Nowhere: the WAL is too short-lived to conflict with anything, and there is only one history.

### 5. Undo journal synced alongside the document

The option D31 already examined and rejected: a journal that is neither authoritative nor derivable from the files, which must nonetheless be kept in agreement with them across devices. Listed so it is not rediscovered.

### 6. Periodic buffer snapshots

Undo by restoring a full snapshot of the window taken every N seconds or N edits.

- **For.** Trivially simple; no change records, no position mapping.
- **Against.** Coarse granularity, and memory proportional to snapshot count × window size. Strictly worse than the editor's built-in history, which is free and finer.
- **Verdict.** Only interesting if the editor's history were unavailable, which it is not.

### 7. Session-scoped disk journal

Between 2 and 1: the journal persists, but only for the current session, and is cleared on clean exit.

- **For.** Undo survives a crash but not a deliberate restart, which matches the intuition that a crash should cost nothing and a fresh start should be fresh.
- **Against.** A third lifetime to reason about, buying a narrow case. The crash case is already covered by the WAL restoring the *text*; what is lost is only the ability to undo past it.

## Three modifiers, applicable across options

**M1 — the versioned store can be local from v1.** If the hub is git-shaped, v1 can simply have a **local repository with no remote**, and v2a becomes "add a remote" rather than "add versioning." This is the single highest-value idea on this page: it gives v1 real recovery, it validates the versioning model against real data a year before sync ships, it makes both histories exist from day one so their interaction is *exercised* rather than deferred, and it shrinks the v2a step substantially. It removes the only serious objection to options 2 and 4.

**M2 — three timescales, deliberately different.** Durability wants to be immediate; history wants to be meaningful. So:

| Tier | Trigger | Purpose |
|---|---|---|
| WAL append | every change (~ms) | crash gap between memory and disk |
| File write | short quiescence (~1 s) | the corpus is the corpus |
| **Commit** | **long quiescence or session boundary (~minutes)** | readable history |

**Autosave frequency and commit frequency must not be the same number.** Committing per autosave is what makes option 3 fail, and the same mistake is available inside options 2 and 4. The three tiers compose without a gap: changes written but not yet committed are recoverable because they are *in the file*.

**M3 — remote-change policy.** Map remote changes through the undo stack without admitting them to it (what collaborative-editing machinery already does, and correct here since a "remote" change is your own from another device). **But after a divergence resolution, truncate the stack**: mapping an undo through a user's conflict choice is not well-defined, and a wrong answer there is silent corruption of exactly the kind T1 names.

## Comparison

| | Build cost | Hand-edit ceremony | Undo survives restart | Where the mess lands | v1 recovery |
|---|---|---|---|---|---|
| **1** journal+digest | High | **Yes** | Yes | log/file boundary, ours | Yes |
| **2** volatile + hub | Low | No | No | remote merge only | **Only with M1** |
| **3** undo = rewind | Low | No | Yes | nowhere — but granularity is wrong | Yes |
| **4** three tiers | Low–medium | No | No | nowhere | **Only with M1** |
| **5** synced journal | High | No | Yes | everywhere — rejected | Yes |
| **6** snapshots | Very low | No | Optional | nowhere | No |
| **7** session journal | Medium | No | Crash only | small | Partial |

## Where I land, for you to take apart

**Option 4 with M1, M2 and M3** — volatile undo, a WAL that is explicitly not a history, and a versioned store that is local in v1 and gains a remote in v2a.

The argument is that it is the only option that puts **all three touch-points in one place or in none**. The WAL is too short-lived to be a second history; the hub is the only history; hand-editing needs no ceremony because a hand-edit is simply a file change; and remote merges touch only the editor's volatile stack, where the existing machinery handles them. It also retires two things we currently carry without a clear owner: the 30-day journal retention, and the "rewindable history" backlog item that had no mechanism.

The cost is that **undo does not survive a restart** — and the honest defence is the one you offered: this is VSCode + git, which you use daily without friction, and where the recovery path after a restart is "look at the history," not "press ⌘Z forty times."

**The thing most worth arguing about** is whether option 1 buys enough to justify its ceremony. It is the only option where undo is genuinely unbounded and cross-device, and if that turns out to matter, nothing else on this list provides it.
