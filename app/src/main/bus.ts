// **Foundation. Depends on nothing.**
//
// Where a pushed message goes, and nothing else. Every service that has news
// for a renderer announces it here; no service announces to another.
//
// **A leaf on purpose.** `CorpusService`, `DurabilityService` and `DayService`
// all need to say something to the renderer and none of them needs the others,
// which is exactly what a shared dependency with no dependencies of its own is
// for. Folding this into any one of them would make the other two depend on
// that one for no reason but the array.
//
// **Electron-free, deliberately.** A `MessageSink` rather than a
// `BrowserWindow`, which is what lets the parts most likely to be subtly wrong —
// the mutation queue, the write tiers — be tested in plain Node.

/** Anything that can carry a pushed message to a renderer. */
export interface MessageSink {
  send(channel: string, message: unknown): void
}

export class Bus {
  #sinks: MessageSink[] = []

  /** Returns the way to stop listening, which is what a window's close calls. */
  addSink(sink: MessageSink): () => void {
    this.#sinks.push(sink)
    return () => {
      this.#sinks = this.#sinks.filter(s => s !== sink)
    }
  }

  /** To every renderer listening. */
  announce(channel: string, message: unknown): void {
    for (const sink of this.#sinks) sink.send(channel, message)
  }
}
