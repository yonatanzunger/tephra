# Failure: The corpus is acquired by an adversary

## Summary

Someone who should not have the notebook gets it — by lawful compulsion, by
seizure, by theft, by breach, or because the party holding it changed. Because
the notebook is one undifferentiated stream, acquisition is **all-or-nothing**:
the adversary obtains materially more than whatever interest triggered the
acquisition.

**The harm falls hardest on people who are not party to any of it.** Contacts,
colleagues and people discussed in passing are exposed. They never knew the
notebook existed, could not assess the risk, and — under a gag order — cannot be
warned. That is what makes this Critical despite a low and declining likelihood:
**it is not the writer's risk to accept on their behalf.**

**This is not primarily a technical risk.** Its controls live at the level of
how the tool is used, not in the architecture.

## Failure Chain

```text
1. Content is written that would be harmful if disclosed — not operational
   material, which is out of scope by policy, but facts that are not normally
   discussable, and private reasoning about people and politics.
   - Intervention (prevention): content scoping. This is the primary control and
     essentially the only one that reaches the top of the chain.
   - Observation: this intervention is in direct tension with F03. Scoping
     tighter reduces this failure and increases that one.

2. It persists — in the corpus, the version history, a backup, a hub, a device.
   - Intervention (mitigation): the shreddable notebook bounds what is available
     to be acquired, because content that was destroyed is genuinely gone (D46).

3. An acquiring event occurs.
   - Observation: both originally-named adversaries have decayed. Civil
     discovery ended with the officer role; political targeting does not need
     evidence it already has. The residual triggers are mundane rather than
     targeted — a stolen laptop, an unrelated matter, a provider change, an
     estate.
   - Intervention (prevention): FileVault; keeping the corpus out of cloud-synced
     folders; not pushing to a hosted remote.
   - Observation: self-hosting is NOT unambiguously better. It removes the third
     party's ability to litigate, narrow, delay or publish a transparency
     report, and relocates compulsion onto the writer directly.

4. The adversary obtains the whole stream rather than the responsive part.
   **harm begins**
   - Observation: this is the cost of the design's best idea. Subjects are tags
     over one stream, so no artifact corresponds to a narrow demand, and the
     defensible answer and the cheap answer are both "hand over everything."
   - Intervention (mitigation): separate notebooks are the only boundary that
     bounds the set, which is a second reason D46 matters.

5. Third parties are exposed, along with the association graph — who was met,
   when, and roughly about what — which survives redaction because automatic
   dating (R8) is a core feature and is what makes the graph reliable.
   - Observation: accepted. The graph cannot be removed without removing
     automatic dating, which is load-bearing.

6. Under a gag order the writer is not told, so they keep writing into a corpus
   already held, and cannot warn anyone.
   - Observation: absence of evidence of disclosure is not evidence of absence.

7. **harm ends** — never cleanly. Disclosure is not reversible, and a purge
   attempted afterwards is worse than none (see F01, and the beacon effect: a
   rewrite diffed against an earlier copy localises exactly what was removed).
```

## Observations

- **Severity: Critical.** Not because it is likely — it is not, and the trend is
  downward — but because the harm lands on people who could not consent, cannot
  assess it, and cannot be warned, and because it is irreversible.
- **Likelihood has genuinely decayed**, and the reasoning is recorded in Q12 so
  it can be re-examined rather than assumed: the officer role ended, and the
  political-targeting adversary already has what it needs and is not gathering.
- **Related failures:** **F01** underdeletion supplies the material this
  discloses. **F03** is its direct antagonist — see the cross-cutting note.
- **Variants:** compelled disclosure of a hosted hub; device seizure; phone
  seizure with compelled unlock; sync credentials on a compromised device; gag
  orders; provider terms or ownership changing under a committed archive;
  pattern-of-life leakage through metadata even when content is encrypted; the
  undifferentiated stream preventing narrow production; the association graph
  surviving redaction; third parties bearing unaccepted risk.

## Intervention Points

### Prevention
- **Content scoping** — the primary control, and the only one at the top of the
  chain. Requires a viable destination, or it becomes F03.
- **FileVault**, and verifying it rather than assuming it.
- **No hosted remote in v1**, and an explicit decision before the first push.
- **Confirm backup targets** — Time Machine destination, and whether the
  notebook sits inside any cloud-synced folder. This is the channel most likely
  to move the corpus somewhere unchosen.

### Detection
- **Largely absent, and irreducibly so.** A gag order removes notification by
  design, and there is no canary worth building for a single-user tool.

### Mitigation
- **The shreddable notebook**, which bounds what exists to be acquired.
- **Separate notebooks as the disclosure boundary**, since the one-stream design
  provides none.

### Recovery
- **None.** Disclosure is not reversible, and remediation after exposure makes
  things worse rather than better.

---

## Management Plan

*Not yet developed — run failure management.*

Directed approach: **this is managed at the level of how the tool is used**, not
by architecture. The technical half has already been taken out by D46; what
remains is a practice about what gets written where, and it should be written
down somewhere rather than held in memory, because an unwritten policy drifts.
