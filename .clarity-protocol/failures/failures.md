# Failure Modes

Three failure modes plus a baseline group, reduced from 38 raw failures.
**Grouped by management approach rather than by mechanism**, which is what makes
the set tractable: one is a design-and-UX problem, two are questions about how
the tool is used.

Context: most of this pool was generated before **D44** (the shreddable
notebook) and before the threat model was refined in **Q12**. Both landed during
analysis, and the severities below already reflect them.

1. **[The delete mechanism does not work the way the writer expects](failure-01-deletion-model-mismatch.md)**
   (High) — The writer's model of persistence and the machine's behaviour
   diverge, in **two opposite directions**: text believed destroyed survives (in
   history, reasons, `.tephra/`, clones, backups, OS caches), or text believed
   safe is destroyed (by a shred, a timer, a bad purge pattern, or writing in the
   wrong notebook). Both are failures of correspondence, and one surprise in
   either direction poisons trust in every persistence claim the app makes.
   **Mitigation:** largely designed against by D44; managed by making the
   mechanism legible — *we know where data is stored, we know where we are
   writing, the presence or absence of a delete affordance is clear, and when
   present it does what it says.* **The only group with technical work attached.**

2. **[The corpus is acquired by an adversary](failure-02-corpus-acquired-by-adversary.md)**
   (Critical) — Compulsion, seizure, theft, breach or provider drift yields the
   whole stream rather than the responsive part, because subjects are tags over
   one corpus and no artifact matches a narrow demand. The harm lands hardest on
   third parties who never knew the notebook existed, cannot assess the risk,
   and under a gag order cannot be warned. **Critical on harm, not on
   likelihood** — both originally-named adversaries have decayed (Q12).
   **Mitigation:** content scoping, FileVault, no hosted remote, verified backup
   targets; D44 bounds what exists to be taken. Managed at the level of use.

3. **[The writer stops writing](failure-03-the-writer-stops-writing.md)**
   (Critical) — Judging that something cannot safely be recorded, the writer does
   not write it. The notebook stays perfect and stops being where the hard
   thinking happens, which defeats the project's premise. Silent, invisible to
   every instrument, and requiring no adversary — only friction. **This is the
   live one:** nothing built yet addresses it, and D44's mitigation is unproven
   until the shreddable notebook is actually opened. **Mitigation:** a
   low-friction second destination, one-gesture switching, and an explicit
   periodic check, since nothing surfaces this on its own.

4. **[Existing issues](failure-04-existing-issues.md)** (Low) — The Google
   Docs / M365 baseline is already hosted, compellable and unpurgeable. Recorded
   as the comparison point. **Mitigation:** keep handling as before.

## Cross-Cutting Patterns

**The central tension: F02 and F03 are direct antagonists.** Content scoping is
the top-of-chain intervention for both and pulls opposite ways — scope tighter
and acquisition risk falls while the writer's silence grows. Tuning the scope is
therefore not an optimisation; it is a trade with no good setting.

**The only move that improves both at once is lowering the friction of the safe
destination.** That is the deeper argument for D44, and it is a *product*
argument rather than a security one: the shreddable notebook exists less to
protect writing than to make writing happen at all. It should be judged on
whether it gets opened.

**Notebook identity is a pinch point.** One mechanism — a continuously visible,
one-gesture-switchable notebook identity — sits in three chains at once: F01
prevention (don't write in the wrong one), F01 branch B (don't delete in the
wrong one), and F03 (switching must be cheap or the destination goes unused).
This is a strong argument for treating the per-notebook theme as load-bearing
rather than cosmetic.

**Every protective claim needs an instrument that has been seen to fail.**
Appears in F01 (shred verification, restore-from-backup testing) and in F02's
recovery path (purge verification). This project already has the rule and four
incidents behind it; here it applies to security properties, where a silent
failure is most expensive and least likely to be noticed.

**Cascade: F01 → F03.** A persistence surprise in either direction erodes trust
in every claim the app makes, and a writer who does not trust the notebook
writes less in it. The two must be managed together, not separately.

**Detection is irreducibly weak for F02 and F03.** A gag order removes
notification by design; a thought not written leaves no artifact. Both therefore
depend on prevention and on periodic deliberate review rather than on any signal
the system can raise.
