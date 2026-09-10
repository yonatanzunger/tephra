# Feature backlog

**Audited 2026-09-10, when v1 completed.** Four of these left the backlog during
v1 rather than after v2, which is the list working rather than failing: each was
promoted by use or by a specific recorded failure, not by argument. Struck rows
are kept because *why* something was promoted is the reusable part.

Candidates for after v2 (sync and Android). This is a list of *things to decide about*, not a plan — when the time comes, each is admitted or dropped deliberately, against the test in `goal/scope.md`: **what does having this here beat?**

Each entry records what it competes with and what evidence would promote it. Evidence comes from living on v1 and v2, which is why v1 deliberately runs the plain-file stand-ins rather than doing without.

| Candidate | Competes with | What would promote it |
|---|---|---|
| ~~**TODO type and UX**~~ (R15–R17) | — | **Left the backlog on 2026-09-01** (D55–D58). Both reasons for the M3 re-deferral fell: the record-shaped prediction was wrong (it is a text kind), and D4's evidence gate was never exercised, so its silence was not a "no". Designed in `goal/todo.md` and `solution/todo.md`. |
| ~~**Urgency ranking**~~ (R16) | — | Absorbed as T9. |
| ~~**The forced review**~~ (R16a) | — | Dissolved: the premise was wrong. It became two mechanisms — the soft cap (T12) and the daily walk (T11) — neither of which is a forced review. See Q3. |
| ~~**The link directory**~~ (R10a) | — | **Left the backlog on 2026-09-01** (D57, D60, D61). Nothing had to promote it: the need was already established (`goal/todo.md`, interaction 2, unserved in three eras) and the sweep is one `CorpusIndex` already performs. Scheduled as **ML, after MT3** — `solution/link-roadmap.md`. It is separable but *not* cheap, which the earlier entry here claimed: nothing scans links today, so it is a scanner, an index payload and a pane of its own. |
| **Backlog resurfacing** (T14, Q3a) | Cancelling outright, or a list nobody rereads | The mechanism is undecided, which is the whole of Q3a. Everything else in the TODO design is settled. |
| **Filesets** (R20–R22) — *the collection experience* | A directory plus a notes file | Specific failures of the directory: summaries not kept, en-masse opening painful, snapshots not taken. **The nav role and the index format shipped in v1**; this is the rest. |
| **URL snapshotting** (R22) | Saving a PDF by hand | Links found dead when it mattered. |
| **Browser extension** (R23) | Copy and paste | Frequency — the friction only counts if capture is frequent enough to matter. |
| ~~**Branching a range into its own file**~~ (R14) | — | **Left the backlog in M2** (D13), and its findability half arrived with search in M4 — so the requirement is met end to end: the file is made, the link is left behind, and both the file and the passage are findable. |
| **Editable filtered views** | Read-only views, jump to source to edit | Measured friction of the jump. Still the most demanding thing in the design — and **narrowed by D9's 2026-09-08 amendment**: the only thing the question was ever about is the *composite document*, since the results panel and the find walk are read-only by nature and answered what it was invented for. So the evidence bar is now specific: wanting to edit matching passages *as one piece of prose*. |
| **Real search: ranking, stemming, synonyms** | v1's literal phrase matching | A phrase search failing on real recall tasks — the half-remembered thing not found. **Ranking cannot come first**: a scan cannot stream in rank order, so this arrives with the index below (D65 as amended). |
| **Regex search** | Reading the file in another tool | A pattern you cannot express as a phrase. Cheap by design — one more leaf that never gains an index bound (D65) — so this is a small addition whenever it is wanted. |
| **A text index** | Scanning | Scans ceasing to be instant (D7, D23 puts it at v2). Not to be confused with the **corpus index** (D52), which shipped in v1 and is a throwaway cache of a scan. |
| **History browser** | `git log` and `git show` in a terminal | The repository accumulates from v1 (D32), so the data is there from day one and only the affordance is missing. Promoted by the first time something is destroyed and noticed late — or by the terminal path proving too slow to reach for |
| **Footnotes as their own annotation kind** (D50) | Writing a footnote by hand, or using a comment for one | The first time a printed page wants notes at the foot AND commentary in the margin at the same time — the policy already expresses it, and only the kind is missing. Encoding is the open part: GFM `[^1]` is readable by every other renderer (R26) and needs a parser extension `@lezer/markdown`'s GFM does not include, where a marker pair would be consistent with comments (D47) and less legible in the raw file. |
| **docx and other export** | Copy and paste into another program | An actual occasion where the markdown was not enough. |
