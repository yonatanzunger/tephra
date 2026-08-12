# Feature backlog

Candidates for after v2 (sync and Android). This is a list of *things to decide about*, not a plan — when the time comes, each is admitted or dropped deliberately, against the test in `goal/scope.md`: **what does having this here beat?**

Each entry records what it competes with and what evidence would promote it. Evidence comes from living on v1 and v2, which is why v1 deliberately runs the plain-file stand-ins rather than doing without.

| Candidate | Competes with | What would promote it |
|---|---|---|
| **TODO type and UX** (R15–R17) | A pinned markdown file with checkboxes | Specific recorded failures of the plain file: items lost, deadlines missed, scanning cost. Urgency ranking (R16) is the reason to build it at all. Promotion doubles as the first forced review (D6). |
| **Urgency ranking** (R16) | Reading the list top to bottom | Enough dated items that scanning fails — the exact way Era 2's due dates degraded. |
| **The forced review** (R16a) | Nothing; no stand-in exists | Observed rot: items in the list nobody has touched or decided about. Requires last-touched data, which begins at TODO promotion. |
| **Filesets** (R20–R22) | A directory plus a notes file | Specific failures of the directory: summaries not kept, en-masse opening painful, snapshots not taken. |
| **URL snapshotting** (R22) | Saving a PDF by hand | Links found dead when it mattered. |
| **Browser extension** (R23) | Copy and paste | Frequency — the friction only counts if capture is frequent enough to matter. |
| **Branching a range into its own file** (R14) | Cut and paste, plus a link | The findability half is the real requirement; a branched file nobody can find later is the current failure being fixed. |
| **Editable filtered views** | Read-only views, jump to source to edit | Measured friction of the jump. This is the most demanding thing in the design (`goal/scope.md`), so the evidence bar is correspondingly high. |
| **Real search** | v1's literal substring matching | Substring search failing on real recall tasks — the half-remembered thing not found. |
| **A derived index** | Scanning | Scans ceasing to be instant (D7). |
| **docx and other export** | Copy and paste into another program | An actual occasion where the markdown was not enough. |
