// **Foundation. Depends on nothing.**
//
// How a service says which IPC channels it answers on (D83).
//
// **Declared, not registered, and the difference is the Electron rule.** A
// service may not import Electron — it is checked by directory, so that the
// parts most likely to be subtly wrong can be tested in plain Node — which means
// no service can call `ipcMain.handle` for itself. So it *declares* what it
// serves and `ipc.ts` does the wiring: the same inversion the rest of the
// foundation uses, applied to the process boundary.
//
// **What this replaces.** Adding one verb meant editing four files: the command
// type in `shared/ipc.ts`, a case in `ipc.ts`'s switch, the service, and
// `preload`. Two of those four were pure transcription, and a seventy-four case
// switch is its own monolith regardless of how tidy the services above it are.
// A service that declares its own channels deletes both.
//
// **And it makes one of D83's rules mechanical.** *Each channel is registered by
// exactly one service* was a sentence in a design document; `claim` refuses two
// services that both want the same channel, so it is now a thrown error at
// startup instead of a thing to remember.

/**
 * What a channel's arguments are answered with.
 *
 * `unknown[]`, because they arrive from another process and their types are a
 * claim rather than a fact — the same claim the old `ipcMain.handle(…, (_e, span:
 * Span) => …)` made, moved to one place where it can be seen. `serve` below is
 * where a service states the shape it expects.
 */
export type Answer = (...args: readonly unknown[]) => unknown

/** One channel, and what answers on it. */
export interface Served {
  readonly channel: string
  readonly answer: Answer
}

/** A service that answers the renderer. */
export interface Serves {
  /**
   * Every channel this service claims.
   *
   * Asked once, at wiring time. A service that answers nothing — the whole
   * foundation — does not implement this: channels belong to domain services,
   * because a channel is something the renderer has a name for, and there is
   * nothing on the far side of the fence corresponding to a queue (D83).
   */
  serves(): readonly Served[]
}

/**
 * Declare one channel with the argument types the service expects.
 *
 * The cast lives here and nowhere else, so a reader looking for *where do we
 * trust the other process* finds one answer.
 */
export function serve<A extends readonly unknown[]>(
  channel: string,
  answer: (...args: A) => unknown,
): Served {
  return { channel, answer: answer as Answer }
}

/**
 * Every channel claimed, by whom, with collisions refused.
 *
 * **Separated from the wiring so it can be tested**: `ipc.ts` imports Electron
 * and cannot run under plain Node, and the part worth testing is this — who
 * claims what, and what happens when two services claim the same thing.
 */
export function claim(services: readonly Serves[]): ReadonlyMap<string, Answer> {
  const claimed = new Map<string, Answer>()
  for (const service of services) {
    for (const { channel, answer } of service.serves()) {
      if (claimed.has(channel)) {
        throw new Error(
          `two services claim the channel ${channel} — each belongs to exactly one (D83)`,
        )
      }
      claimed.set(channel, answer)
    }
  }
  return claimed
}
