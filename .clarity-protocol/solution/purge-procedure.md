# The purge procedure

**Deleting text from Tephra does not delete it from the repository.** It stays
there permanently — that is what having a history means — and from v2a it stays
on the hub as well. Removing it is a history rewrite, not a deletion.

This is T10, and D32 made it worse rather than better: deleted text used to
survive thirty days in a local journal, and now it survives forever. **The
mitigation is this document, not a button** (D32, format-spec). A button would
imply a guarantee that cannot be made, and the section on what a purge *cannot*
reach is the most important part of the page.

**Why it matters here specifically:** the corpus holds other people's
information. If something was deleted *because* it should not have been
recorded, retention silently defeats that.

**When it is owed.** Before the first *push*, not the first commit (D36). While
v1 has no remote the exposure is bounded to one machine, which is what makes a
manual procedure sufficient for now.

---

## Before anything else

**Prevention beats purging.** A purge is irreversible, partial, and costs an
afternoon. If something must never be recorded, the reliable answer is not to
type it into the notebook — and if a conversation is confidential, the notebook
is the wrong place for its verbatim content.

**Two properties of this design make a purge larger than it looks.**

1. **A version's reason quotes the text.** Commit messages carry the first line
   of what changed, so the words can live in *two* places per version. Any
   procedure that rewrites blobs and not messages leaves half of it behind.
2. **A day is split into parts above 1 MB.** The text may be in
   `2026-08-21.md` or in `2026-08-21.2.md`, and a purge that names one file by
   hand can miss the other. Match on the text, not on the filename.

---

## The procedure

### 1. Stop Tephra

Quit the application. Not minimise — quit. A running instance holds the text in
memory, may hold it in the write-ahead log, and will happily commit it again the
moment it next saves.

### 2. Back up the notebook, and plan to destroy the backup

```bash
cp -R ~/Tephra ~/Tephra-before-purge
```

A rewrite is irreversible and a wrong pattern removes more than intended. **The
backup contains exactly what you are trying to destroy**, so delete it as soon
as the purge is verified — put a reminder somewhere you will see it.

### 3. Remove the text from the present, first

Open the notebook and edit the days so the text is gone from the current state,
then let Tephra save and record a version. History rewriting is about the past;
leaving the text in the working tree means re-committing it minutes later.

### 4. Rewrite the history

The right tool is [`git-filter-repo`](https://github.com/newren/git-filter-repo)
(`brew install git-filter-repo`, or `pip install git-filter-repo`). It is not
part of git and is worth installing for this.

```bash
cd ~/Tephra
printf 'THE EXACT TEXT==>[purged]\n' > /tmp/purge-expressions.txt
git filter-repo --replace-text /tmp/purge-expressions.txt --replace-message /tmp/purge-expressions.txt
rm /tmp/purge-expressions.txt
```

**Fallback, if `filter-repo` is unavailable.** `filter-branch` is deprecated and
slow, and it is what the commands below use because they have actually been run
against a scratch notebook rather than transcribed from memory.

```bash
cd ~/Tephra
export FILTER_BRANCH_SQUELCH_WARNING=1
git filter-branch --force \
  --tree-filter "find . -type f -name '*.md' -exec sed -i '' 's/THE EXACT TEXT/[purged]/g' {} +" \
  --msg-filter "sed 's/THE EXACT TEXT/[purged]/g'" \
  -- --all
```

> `sed -i ''` is the macOS form. On Linux it is `sed -i` with no argument, and
> using the wrong one either fails or writes a stray backup file into the corpus.

### 5. Drop everything that still points at the old objects

**Skipping this step undoes the previous one.** `filter-branch` keeps the
originals under `refs/original/`, and the reflog holds them too, so the text is
still reachable and `git gc` will not touch it.

```bash
git for-each-ref --format='%(refname)' refs/original | xargs -n1 git update-ref -d
rm -rf .git/refs/original
git reflog expire --expire=now --all
git gc --prune=now
```

### 6. Clear the machine-local state

```bash
rm -rf ~/Tephra/.tephra
```

The write-ahead log may still hold the edit; so may the cached anomaly list.
`.tephra/` is disposable by design (D7) and costs a rebuild, nothing more.

### 7. Verify — do not assume

```bash
cd ~/Tephra

# Any version whose content added or removed the string.
git log --all -S'THE EXACT TEXT' --oneline

# Any version whose reason still contains it.
git log --all --format='%H %s' | grep 'THE EXACT TEXT'

# Every blob still reachable from any ref, checked one at a time.
git rev-list --objects --all | awk '{print $1}' | sort -u | while read -r o; do
  [ "$(git cat-file -t "$o" 2>/dev/null)" = blob ] || continue
  git cat-file blob "$o" 2>/dev/null | grep -q 'THE EXACT TEXT' && echo "still present in $o"
done
```

All three must come back empty. The third is the one that matters: it reads the
actual object store rather than asking git a question git can answer from an
index.

> **A trap in writing that scan.** `git rev-list --objects` prints `<oid> <path>`,
> so piping it straight into `git cat-file --batch-check` does not do what it
> looks like it does — it silently reports nothing and the purge appears to have
> worked. Take the first field explicitly.

Finally, confirm the notebook still reads correctly — open it, and check that
the days around the purge are intact.

### 8. Only from v2a: the remote

```bash
git push --force --all
git push --force --tags
```

**And understand what this does not accomplish.** See below.

---

## What a purge cannot reach

Stated plainly, because a procedure that implies completeness is worse than none.

- **Backups.** Time Machine, any cloud backup of the folder, the copy made in
  step 2. These are the most likely places for it to survive.
- **Other machines that have already synced** (v2a onward). Each needs the same
  procedure run locally; a force-push does not reach into a clone.
- **Anyone who has cloned or fetched.** Their reflog holds the old objects until
  it expires, and their `gc` is theirs to run.
- **The hub's own retention.** A force-push moves the branch; the old objects may
  survive in the server's reflog or garbage until it prunes, and on a hosted
  service that is not under your control.
- **The operating system.** Spotlight's index, an editor's swap and undo files,
  clipboard history, screenshots, a Quick Look thumbnail cache.
- **Anything exported.** A printed range (R11), a PDF, a message quoting it.

**What the procedure does accomplish** is removing the text from the notebook's
own history on this machine — which is the thing this design created and is
therefore the thing it owes a way to undo.

---

## Verified

The commands in steps 4 (fallback), 5 and 7 were run against a scratch notebook
carrying the target text in **both** a day file and a version reason. After the
rewrite: zero blobs containing it, zero reasons containing it, the surrounding
versions intact, and the notebook still reading correctly.

Two things went wrong on the way and are corrected above rather than left for
whoever follows this while stressed: the object scan's field handling, and
`sed -i` differing between macOS and Linux.
