# Problem Statement

**Thinking happens by writing.** Not "writing records the thinking" — the writing *is* the thinking, which is why friction in it is not an inconvenience but a direct tax on the quality of the thought. The problem is that there is currently no place to do that writing which is simultaneously always available, pleasant enough to sustain, and organized enough to find things in later.

Three systems have been tried over ~20 years and each failed for a specific, identifiable reason. None failed for lack of features (`precedent.md` has the detail):

- A **physical lab notebook** — worked, until the work stopped happening in places where the notebook was.
- A **structured physical notebook** with a TODO section and calendar — worked *excellently*, and broke on **access**, not capability.
- **Google Docs, then M365** — solved access, and failed on **fit and quality**: less structure than paper allowed, barely functional mobile, flaky desktop.

The current state is worse than any of them: notes scattered across tools, no reliable place to write, and a growing pile of concurrent threads — house deals, research, a course, a book, a standards push, legal work — whose state lives mostly in one person's head.

## Why This Matters

The immediate cost is friction at the moment of thought: the wrong pen, or a laggy editor, measurably degrades thinking. The user discovered this with paper and now builds custom mechanical keyboards for the same reason.

The larger cost is the **graveyard problem** — projects dying of neglect rather than of decision. This project inherits that problem from Portal, and `precedent.md` identifies something important about it: the era-2 notebook prevented graveyards through a mechanism nobody designed. When a two-page TODO spread filled, live items were transcribed forward and everything else silently died — a **forced periodic review** manufactured by the finitude of paper. Digital lists never fill, so that review never happens.

## Scope

**In scope**

- A **main notebook**: one continuous chronological stream of prose, equations, tables, and inline figures. Automatically dated.
- **Subjects as tags on ranges**, not as separate notebooks — because maintaining N notebooks "has never once proven worth it," and because tagging is *retrospective*: the realization that a passage belongs to project X arrives after writing it.
- **Branching**: extracting a passage into its own file, linked from where it was, and findable afterwards.
- **A TODO list**: text, status, optional due date, optional links, optional dynamic groupings.
- **Pinned lists** — recurring editable artifacts ("blog post ideas"), plus an **events calendar** of major commitments (talks, trips) that complements rather than replaces Google Calendar.
- **Document collections (filesets)**: bundles of URLs and documents with titles and human-editable summaries, browsable, openable individually or en masse, with URL snapshotting.
- **Mac and Android**, both first-class for reading, searching and writing.
- **Offline operation** with explicit resync afterwards.

**Out of scope**

- Managing the substantive work products themselves — code, paper drafts, contracts. Those stay in git or wherever they live; the notebook *points at* them.
- Replacing the calendar, the email client, or the file manager.
- Portal's project-switching machinery: Spaces, launch manifests, environment reconstruction.
- Multi-user anything. Single user, two devices, both trusted.

## Success Criteria

1. **It is the default place to write**, chosen without deliberation, on whichever device is at hand. Any moment of "where should this go?" is a failure.
2. **The reading and writing experience is a joy** — enough so that long sessions are sustainable and the tool disappears. This is the primary requirement, not polish: era 3 had strictly more features than era 2 and failed anyway.
3. **Things written months ago are findable** — by subject, by date, by bookmark, by search.
4. **Nothing is ever lost**, including scroll position and in-flight typing. Any sense that state must be carefully managed is a failure.
5. **Leaving is possible.** The files remain comprehensible and usable without this tool.

## A note on framing

The stated goal — "a high-powered notebook app" — was pressure-tested against the history, and the history argues for something *smaller* than "high-powered." Era 2 had four status symbols and a calendar section and outperformed everything since. The binding constraints have always been availability, fit, and findability; features have never once been the limiting factor. The design should be suspicious of anything that does not serve those three.
