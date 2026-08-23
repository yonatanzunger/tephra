# Failure: The delete mechanism does not work the way the writer expects

## Summary

The writer holds a belief about what happens to text — that it is safe, or that
it is gone — and the mechanism does something else. It fails in **two opposite
directions**, which is why they are one failure mode rather than two: both are
failures of *correspondence* between the model and the machine, and both are
managed by the same thing.

**Underdeletion:** text the writer believed destroyed survives — in the version
history, in a version's reason, in `.tephra/`, in a clone, in a backup, in an
unrotated key table, in the OS's own caches.

**Overdeletion:** text the writer believed safe is destroyed — by a shred, a
timer, a mistaken purge pattern, or by writing into the shreddable notebook
while thinking they were in the durable one.

**Who is harmed:** the writer directly, in both directions. Indirectly, everyone
written about, since surviving residue is what a later disclosure contains.

## Failure Chain

```text
1. The writer forms a belief about persistence — from the interface, from habit,
   and from the app's own promise that nothing is ever lost.
   - Observation: the primary notebook's whole UX exists to produce the belief
     "this is safe," and R1.2 treats any moment of doubt as a defect. That
     belief is correct there and wrong in the shreddable notebook — and the
     belief travels with the person, not with the window.
   - Intervention (prevention): the notebook's identity must be continuously
     visible, not announced once on open.

2. The writer acts on the belief — writes, deletes, or moves between notebooks.
   - Observation: the same gesture has opposite consequences in the two
     notebooks. In the durable one, deletion is recoverable and shredding is
     impossible; in the shreddable one, deletion is real and irreversible.
     Identical muscle memory, inverted risk.
   - Intervention (prevention): the presence or absence of a genuine delete
     affordance must be legible at a glance, and absence must be as clearly
     communicated as presence.

3a. BRANCH A — underdeletion. The writer deletes, believing it gone.
    Residue survives in at least one place the application did not reach.
    - Intervention (prevention): crypto-shredding, which makes the residue
      unreadable without needing to enumerate where it is (D44).
    - Intervention (detection): a verification pass that scans for the content
      rather than asking the mechanism whether it succeeded.

4a. The residue is later disclosed, discovered, or produced. **harm begins**

5a. Harm is unbounded in time: the residue persists until found and destroyed,
    if ever. **harm ends** only on a purge that has been verified, which is
    itself F02.

3b. BRANCH B — overdeletion. The writer deletes, or a timer deletes, believing
    the loss recoverable or narrower than it is.
    - Intervention (prevention): no automatic expiry until manual deletion has
      been lived with (D44 defers TTL for exactly this reason).
    - Intervention (mitigation): a promote path that makes moving a conclusion
      out cheap, so less unpromoted work is at risk.

4b. More is destroyed than intended, or something not yet promoted. The loss is
    usually discovered much later. **harm begins**

5b. No recovery exists, by construction — that is the mechanism working as
    designed. **harm ends** immediately; the damage is bounded but total.

6. In BOTH branches the writer now knows their model was wrong, and confidence
   in every persistence claim the app makes drops with it.
   - Observation: this is the compounding harm and the reason the two directions
     belong together. One surprise in either direction poisons trust in both
     notebooks, which feeds directly into F03 — the writer stops writing.
```

## Observations

- **Severity: High.** Underdeletion converts a deliberate risk decision into a
  latent exposure; overdeletion destroys work irrecoverably. Neither is
  catastrophic alone, but the trust damage in step 6 cascades.
- **Related failures:** feeds **F03** (the writer stops writing) through step 6.
  Underdeletion supplies the material that **F02** discloses.
- **Largely designed against by D44**, which is why this is a management problem
  rather than an open design problem — but D44 *created* branch B, which did not
  exist before there was anything that could really be deleted.
- **Variants:** deleted text survives in history; version reasons duplicate
  content; classification cannot be backfilled; OS-level plaintext (Spotlight,
  Quick Look, Time Machine, swap); the `.tephra/` plaintext shadow; clones on
  other devices; the keychain restored from backup; key loss; auto-expiry;
  encryption breaking the exit; content unfindable; the shreddable notebook
  leaking across its own boundary via `.tephra/`, the promote path, filenames or
  search; sensitivity marking forgotten under pressure; two notebooks mistaken
  for one another.

## Intervention Points

### Prevention
- **Continuously visible notebook identity** — its own theme, not a dialog. A
  dialog is read once; paper colour is read every second.
- **A legible delete affordance**, whose *absence* in the durable notebook is as
  clearly stated as its presence in the shreddable one.
- **Crypto-shredding** rather than overwriting, so deletion does not depend on
  enumerating the copy set (D44).
- **No automatic expiry** until manual deletion has been lived with.

### Detection
- **Verification that scans for content**, not mechanisms that report their own
  success. Per this project's standing rule, each such check must be broken on
  purpose and seen to fail before it is trusted.
- **Restore-from-backup testing**, which is the only thing that catches a key
  that turned out to be extractable.

### Mitigation
- **A cheap promote path**, so the amount of unpromoted work at risk stays small.
- **Separate `.tephra/` per notebook**, so machine-local state cannot become a
  plaintext shadow of the protected corpus.

### Recovery
- **Underdeletion:** the purge procedure — which is F02, and is itself hazardous.
- **Overdeletion:** none by construction. This is the accepted cost of the
  mechanism, and it is why the affordance must be unmistakable rather than merely
  documented.

---

## Management Plan

*Not formally developed — run failure management. The approach is already
directed, by the user, and should be carried in verbatim:*

> Make sure the deletion mechanism is very well understood and surfaces
> correctly within the UX and the user's mental model. We know where data is
> stored, we know where we are writing, the presence or absence of a "delete"
> button is clear, and when it's present, it does what it says it will.

**One property to add to that list:** *when it is absent, that is equally clear* —
the durable notebook's inability to truly delete is the underdeletion failure in
its purest form, and it is currently communicated only by a document nobody
reads while writing.
