# Failure: The writer stops writing

## Summary

The writer approaches something that needs working through, judges that it
cannot safely be recorded, and does not write it. The notebook stays technically
perfect and quietly stops being the place where the hard thinking happens.

**This is the failure that defeats the project.** The premise is that thinking
happens *by* writing — not that writing records thinking — so a subject the
writer will not commit to the page is a subject they think about worse. Success
criteria 1 and 2 both fail, and neither the test suite nor any instrument in this
project can see it.

**It is not a technical risk**, and it cannot be fixed by making the storage
safer. It is managed at the level of how the tool is used.

## Failure Chain

```text
1. The writer approaches a subject that needs working through and is not safe to
   record permanently.

2. They assess the available destinations:
   - the durable notebook: zero friction, permanent, wrong for this;
   - the shreddable notebook: right for this, but must be opened, and is
     desktop-only and single-machine by decision (D44);
   - paper or the typewriter: safest, highest friction.
   - Observation: this assessment happens mid-thought, in the seconds before
     writing, competing with the thought itself.

3. Friction exceeds the impulse. The writer defers, or abandons.
   - Intervention (prevention): minimise the cost of reaching the right
     destination — one gesture, from anywhere, without losing the thought.
   - Observation: era 1 and era 2 both failed exactly here. `precedent.md` is
     unambiguous that the excellent notebook broke on ACCESS, not capability.
     The typewriter reproduces that failure in miniature, and it is already
     reported as a serious burden.

4. The thinking does not happen, or happens worse. **harm begins**
   - Observation: silent. No instrument sees a thought that was not written, and
     there is no artifact whose absence can be noticed.

5. The pattern generalises. Having declined once, the writer declines by
   default, and the notebook's effective scope narrows to the comfortable.
   - Intervention (detection): the only workable one is an explicit periodic
     question — *is there something I have been avoiding writing down?* Nothing
     surfaces this on its own.

6. **harm ends** — not by an event. This is a slow degradation, and it is
   reversible only by deliberately restoring a destination that is genuinely
   easy to reach.
```

## Observations

- **Severity: Critical.** It defeats the project's premise rather than degrading
  a feature, and it is the most likely of the three to actually occur, since it
  requires no adversary and no bug — only friction.
- **This is the live one.** F01 is largely designed against and F02 has decayed
  with its adversaries. Nothing has yet been *built* that addresses this, and
  D44's mitigation is unproven until it is used.
- **Directly antagonistic to F02.** Content scoping is the top-of-chain
  intervention for both, pulling opposite ways: scoping tighter reduces
  acquisition risk and increases this. See the cross-cutting note in
  `failures.md` — the only move that improves both at once is lowering the
  friction of the safe destination, which is the deeper argument for D44.
- **Fed by F01.** A persistence surprise in either direction erodes trust in
  every claim the app makes, and a writer who does not trust the notebook writes
  less in it.
- **Variants:** self-censorship under permanence; scoping with no viable
  destination; the friction of paper and the typewriter; the shreddable
  notebook's desktop-only limitation, which means the phone has no safe
  destination at all.

## Intervention Points

### Prevention
- **A low-friction second destination.** This is the whole of D44's product
  case, as distinct from its security case.
- **One-gesture switching**, so the routing decision costs a keystroke and not a
  context switch.
- **Honest communication of what each notebook is**, so the writer is not
  reasoning about persistence under uncertainty in the moment before writing.

### Detection
- **An explicit periodic review question**, because nothing else surfaces this.
  Naturally paired with whatever answers Q3's forced-review problem.
- **Notice the phone gap.** The shreddable notebook is desktop-only, so on the
  phone the only destinations are "permanent" and "nowhere."

### Mitigation
- **Lower the bar for what belongs in the shreddable notebook.** If it is
  treated as a solemn vault it will not be opened; if it is the ordinary place
  for thinking-in-progress, the friction disappears.

### Recovery
- **Restore a genuinely easy destination**, and re-approach the deferred
  subject. Nothing recovers thinking that did not happen.

---

## Management Plan

*Not yet developed — run failure management.*

Directed approach: **managed at the level of how the tool is used.** Note that
the evidence for whether this is managed at all can only come from living with
D44 — which is an argument for noticing, early and deliberately, whether the
shreddable notebook is actually being opened.
