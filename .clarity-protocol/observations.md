# Observations

A log, not a summary. `failures/failures.md` is the quick picture.

## Failure analysis, 2026-08-23

**Coverage.** One broad analytical pass, run against the refined threat model.
38 raw failures, reduced to 3 failure modes plus a baseline group.

**Specialist perspectives recommended but NOT run**, and worth knowing are
missing: `adversarial-analysis-thinker`, `human-factors-thinker`,
`security-thinker`. They were recommended when the compelled-disclosure adversary
still looked live; the adversary decayed and D46 landed before they were
applied. **Human factors is the one whose absence still matters** — F03 is the
live failure mode, it is entirely a human-factors problem, and it was analysed
without that lens.

**Provenance.** All 38 raw failures came from one agent-run brainstorm plus the
user's own contributions during the session, in
`archive/failure-brainstorm/snapshot-20260823-180024/`. One discarded
("self-hosting moves compulsion onto the user" — an intervention caveat, not a
failure; retained as an observation in F02). One triaged as pre-existing.

## The grouping was redone by management approach, and that was the right call

The first automated pass produced **eight** groups clustered by mechanism —
retention, purge hazard, disclosure, third-party harm, self-censorship,
misjudged protection, safety-destroys-work, boundary leaks. The user collapsed
them to **three**, grouped by *how each would be managed*.

That is better, and the reason generalises. Five of the eight mechanisms —
underdeletion, purge hazard, misjudged protection, overdeletion, boundary
leakage — have one management plan between them, because all five are failures
of **correspondence between the writer's model of persistence and the machine's
behaviour**. Splitting them by mechanism produced five documents that would all
have said the same thing in their management sections.

**The test worth reusing: if two failure modes would receive the same plan, they
are one failure mode.** Mechanism-based grouping is the natural instinct and it
over-fragments.

## The analysis moved while it was being written

Unusual, and worth recording so the documents are read correctly.

**The pool was generated against an adversary that was retired mid-analysis.**
Brainstorming assumed a compelling authority; overnight the user separated that
into civil discovery (ended with the officer role) and political targeting
(already public, not in the attack chain). Roughly a third of the pool dropped a
severity level as a result. The reasoning is in Q12 rather than deleted, so it
can be re-examined if circumstances change.

**And a decision landed mid-analysis.** D46 designed against most of what
remained — but it also *created* two new failure variants that did not exist
before: overdeletion is only possible once something can really be deleted, and
two notebooks can only be confused once there are two.

**Net effect: the live failures moved from disclosure to usability.** F01 and F02
are largely handled. F03 — the writer stops writing — is the one nothing built
yet addresses, and it is the one that defeats the project.

## The two non-technical failures are in direct tension

F02 (corpus acquired) and F03 (writer stops writing) share a single top-of-chain
intervention — content scoping — and it pulls opposite ways. There is no setting
of "how much do I withhold" that is good for both.

**The only move that improves both simultaneously is lowering the friction of
the safe destination.** This reframes D46: its case is a *product* case, not a
security case. The shreddable notebook exists less to protect writing than to
make writing happen at all, and it should be judged on whether it gets opened
rather than on whether its cryptography is elegant.

## Severity was assigned on harm, deliberately ignoring likelihood

Per `failure-management.md` principle 5. Worth flagging because it produces a
counterintuitive table: **F02 is Critical while being the least likely thing
here.** It earns that on two grounds — the harm is irreversible, and it falls on
third parties who could not consent, cannot assess the risk and cannot be
warned. That is not the writer's risk to accept on their behalf, and severity is
the right place for that asymmetry to show up.
