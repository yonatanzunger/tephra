// What a comment IS, for both processes (D47).
//
// The parser and the writer live in X, where bodies are; these are the nouns
// they produce and the margin consumes.

/** Short, file-local, random. A counter collides the first time a range is pasted. */
export type CommentId = string & { readonly __comment?: unique symbol }

export interface CommentMessage {
  readonly author: string
  /** ISO-8601, as written in the byline. */
  readonly at: string
  /** Markdown, with the blockquote prefix removed. */
  readonly body: string
  /**
   * Emoji → who reacted with it, **in the order the emoji were first used**.
   *
   * A map rather than a list because the view is the common case and the edit
   * is the rare one: rendering wants the count with the names available, and a
   * flat list makes every renderer group it first — a derived value computed in
   * as many places as there are renderers.
   *
   * **Order is content.** People spell things with emoji; three in a row are a
   * sentence, not a set. A plain object preserves insertion order for string
   * keys that are not array indices, which emoji never are, so this IS an
   * ordered map and it survives JSON and both IPC hops. A `Map` would say so
   * more loudly and would not survive the trip.
   *
   * **Do not sort these keys.**
   */
  readonly reactions: Readonly<Record<string, readonly string[]>>
  /** Tokens on the byline that this version does not understand, kept verbatim. */
  readonly unknown: readonly string[]
}

export interface CommentThread {
  readonly id: CommentId
  readonly resolved: boolean
  readonly assignee: string | null
  readonly messages: readonly CommentMessage[]
}
