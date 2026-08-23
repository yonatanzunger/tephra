# The shreddable notebook

**The design for D44.** A second notebook, opened by the same app, whose storage
makes deletion real. `decisions/decisions.md` D44 holds the *why*; this holds the
*what*, in enough detail to build from.

**In one sentence:** same editor, same typography, same everything above the
filesystem — and underneath, per-file encryption with keys that can be destroyed,
no version history, no write-ahead log, and no sync.

**What it is for.** Sitting down to work through a complex idea and, in the
course of it, broaching facts that are not normally discussable. The value is in
the working-through, so the writing has to be as good as the primary notebook's;
the difference is only that it can be made to stop existing.

---

## The shape

**A notebook is a directory, and it declares itself.** `tephra.json` at the root,
in plaintext, because it must be readable before anything can be decrypted:

```json
{ "tephra": 1, "storage": "shreddable", "theme": "slate" }
```

The primary notebook declares `"storage": "versioned"` and behaves exactly as it
does today. `run.sh --root PATH` already opens an arbitrary notebook, so
multi-notebook support is largely a matter of reading this file and choosing a
`Repository` and a `Notebook` implementation from it.

**Nothing above W knows the difference.** The format is unchanged — same
markdown, same frontmatter, same markers, same degradation table. Only the bytes
at rest are transformed, by an encrypting variant of `Notebook.read`/`write`.
X and Z are untouched, which is the property that keeps this orthogonal to
everything else in the plan.

## Layout

```
notebook/
  tephra.json            plaintext — declares the storage mode
  objects/9f2a1c…        one encrypted file, opaque name
  keys                   wrapped per-file data keys
  index                  encrypted: id → date, kind, part, title
```

**Filenames carry no information, deliberately.** Leaving
`stream/2026/08/2026-08-21.md` in place would disclose which days have writing,
roughly how much, and — through the gap left by a shred — that something was
deleted and approximately when. Object names are random; the date lives inside
the encrypted frontmatter and in the index.

Enumeration therefore costs an index rather than a directory walk. Acceptable:
this notebook is small by construction, and the primary notebook's lazy
filename-hint optimisation exists precisely because *it* has five thousand files.

## Keys

Three layers, and the middle one exists for a reason worth stating.

| Layer | Where it lives | Destroyed when |
|---|---|---|
| **Master key** | Secure Enclave, non-extractable | Notebook is shredded whole, or rotated on any shred |
| **Data key**, one per object | `keys`, wrapped under the master | Its object is shredded |
| **Index key** | wrapped under the master | Rotated on every index write |

**AES-256-GCM per object**, random nonce, authenticated. Node's built-in
`crypto` covers all of it, so this adds no dependency — which matters, since
"which kind of dependency" is a standing concern in `notes.md` and the answer
here is "none."

**Why the master key must be in the Secure Enclave, and this is load-bearing.**
An ordinary keychain item is included in a Time Machine backup. Shred a key,
restore last week's backup, and the key returns while the ciphertext — also
backed up — becomes readable again. **The deletion would be silently undone by
the backup system.** A Secure Enclave key is non-extractable: it was never in
the backup, so it cannot come back from one. Secure Enclave keys are P-256, so
the master is a wrapping key and the data keys are symmetric.

**Why a shred rotates the master.** Removing an entry from `keys` means
rewriting `keys`, and rewriting a file on a copy-on-write filesystem leaves the
old version in orphaned blocks and in snapshots — the original problem, recursed
onto a smaller file. Rotating fixes it: generate a new master, re-wrap the
surviving data keys under it, write the new `keys`, and destroy the old master.
**Every old copy of `keys` becomes undecryptable, wherever it is.** Re-wrapping
N keys is trivial at this notebook's size.

## The shred operation

1. Destroy the object's data key.
2. Rotate the master and re-wrap the survivors, so stale copies of `keys` die.
3. Unlink the ciphertext.
4. Rewrite `index` under a fresh index key; destroy the old one.
5. Drop the content from in-memory state and from any search cache.

Steps 2 and 4 are the ones that would be omitted by someone writing this quickly,
and omitting either leaves a readable copy behind while the UI reports success.

**Granularity is the file.** A day, a branched document, a pinned list. Finer
granularity comes from splitting a day — see below.

## Explicit splits

M1 already ships prefix-stable day splitting at 1 MB, `part:` in frontmatter,
and D20's rule that adjacent parts coalesce above the storage layer so a split is
invisible to the API. **Making "split here" an authored action adds a trigger,
not a mechanism.**

The split point becomes a marker in the text rather than a computed boundary:

```
<!--tephra:split-->
```

This is *more* prefix-stable than the length rule — it is explicit, it travels
with the text, and it cannot move when content above it changes. It composes with
the existing length-triggered rule: a day splits at any explicit marker and
additionally wherever the threshold demands.

Useful in the primary notebook too, and extractable early if wanted; it is not a
dependency of anything else here.

## What is absent, and why each absence is deliberate

**No version history.** `Repository` is a null implementation — the seam D43
built. Deletion cannot be real in a store designed never to forget, and this
notebook exists to be the place where deletion is real.

**No write-ahead log.** The WAL writes plaintext `DocumentChange` records under
`.tephra/`, which would defeat per-file encryption for everything recent. And for
a notebook whose purpose is not persisting, recovering the last few seconds after
a crash is arguably the wrong behaviour rather than a missing feature.

**No `.tephra/` sharing.** Machine-local state lives inside this notebook's own
directory, encrypted with everything else. `ui-state.json` is the sharp case: it
records the open document and cursor, so a shared one would name which
shreddable file was last edited.

**No sync, and this is a real loss.** Desktop-only, single-machine. Accepted
explicitly in D44 rather than by omission. Per-file encryption is, however,
exactly what end-to-end sync needs later — ciphertext can rest on a hub that is
not trusted — so the sacrifice is deferral rather than foreclosure.

## Search

v1's scan-based search reads through the Document API, which decrypts. This works
only because of architecture.md's rule 4 — *search is an X-level component, never
a W-level scan.* A design that had taken the grep-the-directory shortcut could
not search this notebook at all.

**Search does not span notebooks.** Results from the shreddable notebook must
never enter the primary notebook's index or result set, or the boundary is
decorative. The consequence is real and should be felt before it is fixed:
material here is findable only while this notebook is open.

## The exit

R26 requires the archive stay readable without the tool. **This notebook is
definitionally not the archive**, so the requirement it trades away was never
load-bearing here — but the spirit is still owed:

```
tephra export --root PATH --out DIR
```

Decrypts to ordinary markdown in the ordinary layout. Encrypted must never mean
hostage, and because the format does not fork, this is a decrypt loop and
nothing more.

## Telling the two apart

R1.2 treats any moment of *"I should save this carefully"* as a defect, and the
whole app is built to earn that trust. A second notebook wearing the same
interface inherits the trust and removes the guarantee.

**A dialog is read once and never again.** The distinction has to be continuous
and visible at a glance: its own theme — different paper, different chrome —
declared in `tephra.json` and applied on open. D41 already makes appearance a
named parameter set, so this costs a theme file.

## Verifying it, which is the part that must not be skipped

This project's standing rule: *a passing check is evidence of nothing until the
check has been seen to fail.* Three tests, and the third is the one nobody
thinks to write.

1. **Shred and scan.** Write known plaintext, shred it, then scan every byte of
   the notebook directory for the string. Must find nothing.
2. **Break it on purpose.** Disable the key destruction and confirm test 1
   *fails*. A shred test that passes against a no-op shred proves nothing, and
   this project has been misled by exactly that shape four times.
3. **Restore from backup.** Snapshot the notebook and the keychain, shred,
   restore the snapshot, and confirm the content is *still* unreadable. This is
   the test that catches a master key which turned out to be extractable, and it
   is the failure that would otherwise be discovered years later by accident.

## What this does not protect against

Stated plainly, because a design that implies completeness is worse than none.

- **An unlocked machine with the notebook open.** The plaintext is in memory, on
  screen, and reachable by anything running as the user.
- **Memory and swap while open.** mlock is not achievable inside a JS engine;
  encrypted swap and FileVault are the mitigation, and they are the OS's.
- **Anything exported** — a printed range, a PDF, a paste into another program.
- **An adversary who images the disk and obtains the key before the shred.**
  Shredding is about what survives deletion, not about possession beforehand.

**What it does accomplish** is that content deleted here is gone, including from
every copy the application could not enumerate — which is the one thing the
primary notebook cannot promise and the reason this exists.
