# Shared .tephra leaks the ephemeral notebook

**Source:** conversation

If the ephemeral notebook writes to the same machine-local state as the durable one, its content and its existence appear in the WAL, in ui-state.json's record of the open document and cursor, in issues.json and later in the search index — all in plaintext, all outside whatever the ephemeral notebook promised.

## Additional Context

Yesterday's plaintext-shadow finding, now with a boundary to violate. The WAL is the pointed case: it exists for crash recovery, and for a notebook whose purpose is not persisting, recovering after a crash is arguably the wrong behaviour rather than a feature.
