# Choosing a git implementation

For the repository underneath `History` (D32). **System `git` is ruled out**: a dependency on something outside our control — its presence, its version, the user's `PATH` — is exactly the class of trouble to avoid.

**A caveat on this document.** The structural properties below are durable and worth reasoning from. **Current maintenance status, release cadence and API completeness are not something to take from me** — those change faster than my knowledge does, and library health is precisely where I am least reliable. Verify before committing; it is thirty minutes of work against a decision that is annoying to reverse.

## The distinction that matters

Not "dependency or no dependency," but which kind:

| Kind | Example | Risk |
|---|---|---|
| **System** | shelling out to `git` | Presence, version skew, the user's environment. **Ruled out.** |
| **Native module** | bindings to a C or Rust library | You control the version, but it must be built or prebuilt per platform *and per Electron ABI*. Electron rebuilds are a well-known source of pain. |
| **Pure JS / WASM** | a JS implementation | Simplest build story by far; you inherit the implementation's limits. |

## Candidates

**`isomorphic-git`** — pure JavaScript, pluggable filesystem, no native build at all. Covers init, add, commit, log, checkout, and HTTP(S) fetch/push/pull.

- **For.** No build step, no ABI coupling, no rebuild on Electron upgrade. Runs identically in Node and a browser context, which matters if the Android build is also web-based.
- **Against.** Slower than libgit2 — its known weak spot is whole-tree status, which is O(files) with stats and hashing. **That weakness does not bite us**, because we always know which files we wrote: the editor knows, and for external edits the watcher says. Full-tree scanning is needed only once, at startup after the app was closed, where seconds are acceptable.
- **The real limitation: no SSH transport.** Push and pull are HTTP(S) only. That constrains the v2a hub to an HTTPS endpoint with token auth, which is fine for a self-hosted or hosted git service but should be a conscious choice rather than a discovery.

**`nodegit`** — Node bindings to libgit2. The direct analogue of Portal's libgit2-in-Rust path.

- **For.** Real libgit2: fast, complete, battle-tested, full transport support.
- **Against.** A native module in an Electron app — prebuilt binaries per platform per ABI, and a rebuild on every Electron upgrade. This is the specific kind of fragility the "don't depend on anything" instinct is pointing at, just moved inside the bundle.

**`napi-rs` over a Rust git crate (`gitoxide` or libgit2 bindings)** — the closest thing to reusing Portal's validated work.

- **For.** Rust's git ecosystem is strong; napi-rs has a better prebuilt story than nodegit historically; and **the same Rust core could serve Android via UniFFI**, which is precisely the path Portal already proved end to end.
- **Against.** Adds a Rust toolchain to the build. Still a native module, with the ABI question, though better managed.

**`wasm-git`** — libgit2 compiled to WebAssembly. Real libgit2 with no native build, but an awkward emscripten filesystem bridge and a smaller user base.

## Recommendation

**`isomorphic-git` for v1**, revisited at v2a when network and merge requirements actually arrive.

The reasoning is that v1's needs are a small subset — init, add, commit, log, read a blob at a commit, checkout — with **no network at all**, and that subset is comfortably inside a pure-JS implementation while the build simplicity is worth a great deal in a solo evening project. The performance objection is neutralised by the fact that we never need whole-tree status on the hot path.

**And merge quality matters less here than it looks**, which removes the strongest argument for libgit2. Reconciliation is user-facing by design: divergence surfaces a picker (D12) rather than being auto-merged, and if append-union merge for day files is ever wanted it is ours to implement regardless (Portal wrote it already). Git is transport and storage here, not a merge engine.

## What to verify before committing

- Commit throughput with explicitly-listed changed paths, on a tree of ~5 000 files, avoiding `statusMatrix`.
- Startup full scan cost on the same tree.
- That HTTPS push/pull with token auth works, and that **no SSH** is acceptable for the intended hub.
- Whether the on-disk repository is byte-compatible enough that system `git` and standard tooling read it cleanly — **this is the load-bearing check**, since the entire reason for choosing git (D32) is that the exit extends to the history. A repository only Tephra can read would defeat the point.

**The last one is the decisive test.** If any candidate fails it, it fails the requirement that made git the answer in the first place.
