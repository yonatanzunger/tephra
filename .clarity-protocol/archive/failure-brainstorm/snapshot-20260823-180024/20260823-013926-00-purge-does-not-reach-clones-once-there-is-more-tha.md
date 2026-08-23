# Purge does not reach clones once there is more than one

**Source:** conversation

A history rewrite is local to one repository. A force-push does not reach into a clone, so at v2b every device needs the procedure run on it, in the right order, with no mechanism to verify that it happened. A single missed device silently retains everything.

## Additional Context

Already noted in Q12. Recorded here because the failure is verification, not execution: there is no way to ask the system whether all copies are clean, so the operator's belief that a purge completed is unfalsifiable.
