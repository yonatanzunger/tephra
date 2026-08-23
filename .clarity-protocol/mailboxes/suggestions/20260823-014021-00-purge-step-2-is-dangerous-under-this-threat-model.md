# Purge step 2 is dangerous under this threat model

**Source:** conversation
**Target:** solution/purge-procedure.md

Step 2 instructs the operator to make a complete plaintext copy of the notebook before rewriting, relying on memory to destroy it later. Against seizure that backup is the primary exposure. Rewrite to require an encrypted backup, or a backup on removable media destroyed as an explicit final step, or to make the backup optional with the tradeoff stated. Also add a warning absent today: rewriting history when any earlier copy may exist elsewhere lets an adversary diff the two and localise exactly what was purged — so purge is a pre-push operation, not a remediation after exposure.
