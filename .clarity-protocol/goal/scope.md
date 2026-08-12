# Scope

The concrete answer to "smaller than a high-powered notebook app." It is a counting rule, and it is countable — which is what makes it usable in an argument.

## The rule

**Tephra is a small number of view types over one directory of plain files.** The scope number is the count of *view types*, not the count of features. This falls out of R26 (plain durable formats) rather than being imposed on top of it, and it makes the departer's exit structural: if every artifact is already a file another program can open, "leaving" is not an export feature, it is stopping.

## The types

Three native types, each with its own UX. Everything else in the directory is either **external** (PDFs and other documents, opened by the OS) or **embedded** (PNGs and images, referenced from markdown and rendered inline).

| Type | UX |
|---|---|
| **Markdown** (`.md`) | The reading and editing surface. The notebook stream, branched documents, and pinned lists are all this type. Possible later export to docx and similar. |
| **TODO** | Seen *only* through the TODO experience — urgency ranking, statuses, due dates. Never edited as raw text in normal use. |
| **Fileset** | A directory with a master index. Entries are URLs, file pointers, and **bookmarks into markdown files**. Browse, open individually or en masse, annotate, snapshot. |

**One syntax family.** All three types are markdown, leniently parsed — a TODO file stays sensible to a plain reader even though it is only ever *seen* through the TODO UX. A bespoke syntax (YAML is the likely candidate for TODO) remains available at promotion time, when the UX's real requirements are known; converting a markdown TODO to YAML is a script, so nothing is foreclosed. Until then there is one parser and one merge story.

**Type is declared by name, not inferred.** Portal found the failure this prevents: a mutable list mistyped as append-only notebook content merges with append-union semantics and *silently duplicates edited lines* — no error, the file quietly fills with near-duplicate paragraphs. Explicit typing is what makes merge safe.

**Pinning is membership in a distinguished fileset** (D10). The nav is a list of sections, each one a fileset; the default section always exists and holds the pinned items. This keeps R18's two jobs distinct without inventing a mechanism: a *curated collection of references* is a section, and a *document you keep returning to* — the events calendar, an ideas list — is a file **entry within** one. Filesets therefore carry the navigation role from v1, well before the document-collection experience (R20–R23) is built.

**The subject view is not a fourth type.** Subject views, date-range views and search results are the same thing: a filtered assembly of ranges (`solution/components.md`). Whether that assembly is editable is still open, and it is the most demanding question in the design — read-only it folds into the markdown UX; editable it is a composite surface writing back into source ranges.

## What gets in, and when

The admission test is: **what does having this here beat?** Filesets compete with a folder and a text file; a browser extension competes with copy-paste. Some will win that fight, but they win it later and on evidence from use.

Which reframes the last stage of the sequencing (`solution/components.md`): **v3 is not "add the remaining features," it is "promote the ones that earned it."** v1 already ships a TODO list — a pinned markdown file with checkboxes — and a fileset — a directory with a notes file. v1 should deliberately *run* those plain versions rather than doing without, so that promotion happens against a specific recorded failure rather than an argument.

## The rule that decides what may be deferred

**Data cannot be backfilled; mechanisms can be deferred.** Deferring the TODO *UX* to v3 is free. Deferring the last-touched *timestamp* is not, because every existing item then looks equally fresh. Dates are the same class — file mtime does not survive sync, copy, or git, so a date not written into the filename or frontmatter is retroactively unreconstructible. So is subject-tag syntax, which v1 decides implicitly whether or not v1 has tagging.

Every v1 decision gets checked against: *if this is built in v3, will the corpus from v1 and v2 support it?*
