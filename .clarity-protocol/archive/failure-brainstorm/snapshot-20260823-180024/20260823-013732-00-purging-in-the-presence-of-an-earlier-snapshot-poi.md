# Purging in the presence of an earlier snapshot points straight at what was purged

**Source:** conversation

A history rewrite changes every downstream hash. An adversary holding any earlier copy of the repository — a prior seizure, a backup, a synced clone, the hub's own retention — can diff the two and localise exactly what was removed and when. The purge becomes a beacon marking the most sensitive material.

## Additional Context

Not currently anywhere in purge-procedure.md, and it inverts the advice: once a copy is out, purging may be worse than leaving it. Determines that purge is only safe as a pre-push operation, never as a remediation after exposure.
