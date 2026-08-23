# Derived .tephra state is a plaintext shadow

**Source:** conversation

The WAL, the search index, issues.json and ui-state.json hold corpus content or pointers to it in plaintext under .tephra/. D7 calls this state disposable, which is true for recovery and says nothing about confidentiality. Any protection applied to the corpus that skips .tephra/ leaks the same material.

## Additional Context

ui-state.json is the sharpest case: it records the open document and cursor, so it names which file was last being edited even if that file is otherwise protected. Disposable is not the same as harmless — a third axis the replica/cache distinction never considered.
