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
  /**
   * Whether the answer wants to know **which window** asked, as its first
   * argument.
   *
   * **A number, not a `WebContents`**, which is what keeps this from dragging
   * Electron into a service. Search needs it because a query's cursor belongs to
   * the window that opened it — two windows searching at once are two walks
   * through the corpus, and a shared cursor would have them stealing each
   * other's place.
   */
  readonly wantsAsker?: true
  /**
   * Whether the renderer **tells** this channel rather than asking it.
   *
   * `ipcRenderer.send` and `ipcRenderer.invoke` are two different doors:
   * `ipcMain.handle` is deaf to a `send`, and `ipcMain.on` never gets to reply.
   * A service declares which door it is behind, because the wiring cannot know —
   * **and the failure when it guesses is silent**. `windowReport` was wired as
   * asked, the renderer went on sending its caret position into a channel with
   * no listener, and nothing anywhere logged a word: no error, no dropped
   * message, just a caret that had never been recorded by the time the window
   * was reopened.
   */
  readonly told?: true
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
 * Declare a channel whose answer is told which window asked.
 *
 * The asker arrives first, before whatever the renderer sent.
 */
export function serveAsked<A extends readonly unknown[]>(
  channel: string,
  answer: (asker: number, ...args: A) => unknown,
): Served {
  return { channel, answer: answer as Answer, wantsAsker: true }
}

/**
 * Declare a channel that carries a **command union**, one arm per `kind`.
 *
 * `docket` and `todo` were the first two channels shaped this way and the shape
 * has earned it: one channel, one union, and a verb added without touching the
 * wiring. But the dispatch was a thirty-four case `switch` in `ipc.ts`, and a
 * switch is a poor way to say *exactly these kinds, each handled once*.
 *
 * **A map of handlers is exhaustive by construction.** The type requires an arm
 * for every `kind` in the union, so adding a command to the union in
 * `shared/ipc.ts` makes this a compile error until it is handled — where a
 * forgotten `case` fell through to whatever came next. Each arm receives the
 * command **narrowed** to its own kind, so no arm re-checks what the key already
 * proved.
 */
export function serveKinds<C extends { readonly kind: string }>(
  channel: string,
  handlers: { readonly [K in C['kind']]: (command: Extract<C, { readonly kind: K }>) => unknown },
): Served {
  return serve(channel, (command: C) => {
    const handle = handlers[command.kind as C['kind']] as ((c: C) => unknown) | undefined
    // **The kind is a claim too.** Every other argument from the renderer is
    // trusted as a shape; this one decides which code runs, so an unknown kind
    // is refused rather than being read as `undefined(…)`.
    if (handle === undefined) throw new Error(`${channel} has no case for ${command.kind}`)
    return handle(command)
  })
}

/**
 * A command union whose arms are also told **which window** asked.
 *
 * `serveKinds` and `serveAsked`, composed — because capture needs both and
 * neither alone will do. A capture is a gesture *between two windows*: the words
 * come from a selection in one, the item is made in another, and the sentence is
 * given back to the first, so every arm needs to know who is on the line. And it
 * is one channel with three kinds, so it wants the exhaustiveness the map gives.
 *
 * The asker arrives first, as it does in `serveAsked`; the command is narrowed,
 * as it is in `serveKinds`.
 */
export function serveAskedKinds<C extends { readonly kind: string }>(
  channel: string,
  handlers: {
    readonly [K in C['kind']]: (asker: number, command: Extract<C, { readonly kind: K }>) => unknown
  },
): Served {
  return serveAsked(channel, (asker: number, command: C) => {
    const handle = handlers[command.kind as C['kind']] as
      | ((asker: number, c: C) => unknown)
      | undefined
    if (handle === undefined) throw new Error(`${channel} has no case for ${command.kind}`)
    return handle(asker, command)
  })
}

/**
 * Every channel claimed, by whom, with collisions refused.
 *
 * **Separated from the wiring so it can be tested**: `ipc.ts` imports Electron
 * and cannot run under plain Node, and the part worth testing is this — who
 * claims what, and what happens when two services claim the same thing.
 */
export function claim(services: readonly Serves[]): ReadonlyMap<string, Served> {
  const claimed = new Map<string, Served>()
  for (const service of services) {
    for (const served of service.serves()) {
      if (claimed.has(served.channel)) {
        throw new Error(
          `two services claim the channel ${served.channel} — each belongs to exactly one (D83)`,
        )
      }
      claimed.set(served.channel, served)
    }
  }
  return claimed
}

/**
 * Mark a declaration as one the renderer **tells** — `ipcRenderer.send`, no
 * reply — so the wiring listens with `ipcMain.on` instead of answering with
 * `ipcMain.handle`.
 *
 * **A wrapper rather than a fourth `serve…`**, because *told* is orthogonal to
 * everything else a declaration says: `windowReport` is both told and wants to
 * know which window told it, and a variant per combination would be four names
 * for two questions. `told(serveAsked(…))` reads as the two facts it is.
 */
export function told(served: Served): Served {
  return { ...served, told: true }
}
