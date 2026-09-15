// **Domain. Depends on `CorpusService`, `DurabilityService` and `DayService`.**
//
// What arrives from **outside**: text pasted or dropped in, an image's bytes,
// and the one piece of layout knowledge a renderer needs in order to show one.
//
// **One service because the three share a rule.** Content coming in is copied
// into the corpus and the original is left alone (D47's rule, one level up) —
// from the moment it lands it is versioned, journalled, indexed and undoable,
// none of which is true of a file this app merely pointed at. The clipboard and
// the file dialog are the shell's half of the same act
// (`shell/desktop-service.ts`); what to *do* with what they hand over is this.
//
// **`linkBase` is here rather than in the library** because it exists for the
// same reason `attachImage` does: an `<img>` in a renderer needs a relative
// path, and which directory it resolves from is layout knowledge (D59, R7).

import type { CorpusService } from './corpus-service.ts'
import type { DurabilityService } from './durability-service.ts'
import type { DayService } from './day-service.ts'
import { serve, type Served, type Serves } from './serves.ts'
import { CHANNEL, type Attached, type Base, type ImageAttachment } from '../../shared/ipc.ts'
import type { DocumentPosition } from '../../shared/document-api.ts'
import { attach } from '../x/documents/attachments.ts'
import { dayFile, relativePath, type RelPath } from '../w/layout.ts'

export class IntakeService implements Serves {
  readonly #store: CorpusService
  readonly #durable: DurabilityService
  readonly #day: DayService

  constructor(store: CorpusService, durable: DurabilityService, day: DayService) {
    this.#store = store
    this.#durable = durable
    this.#day = day
  }

  serves(): readonly Served[] {
    return [
      serve(
        CHANNEL.importText,
        (at: DocumentPosition, text: string, original: { content: string; ext: string }) =>
          this.importText(at, text, original),
      ),
      serve(CHANNEL.attachImage, (request: ImageAttachment) => this.attachImage(request)),
      serve(CHANNEL.linkBase, (base: Base) => this.linkBase(base)),
    ]
  }

  /** A turn in the one mutation queue, with the day real first (note 61). */
  async #mutate<T>(work: () => Promise<T>): Promise<T> {
    await this.#day.ready()
    return this.#store.mutate(work)
  }

  /**
   * Import text at a point.
   *
   * **The clipboard is read by the shell**, not here: reading it means
   * importing Electron, and a service stays free of it — which is what lets the
   * integration suites drive this under plain Node (D83).
   */
  async importText(
    at: DocumentPosition,
    text: string,
    original: { readonly content: string; readonly ext: string },
  ): Promise<string> {
    const rel = await this.#mutate(async () => (await this.#store.stream).importText(at, text, original))
    this.#durable.touched()
    return rel
  }

  /**
   * An image into `attachments/`, and a relative link back to it (R7).
   *
   * **The bytes are written and nothing is inserted**, which is the whole of
   * the split. Where the link goes is a caret in some document, and the surface
   * that has the caret already knows how to put text at it — through the
   * ordinary edit path, so undo works, the journal records it, and this needs no
   * per-kind knowledge of what it is being pasted into. `importText` predates
   * that idea and reaches into the stream to place a block; an image should not
   * have to.
   *
   * **Filed under the day it ARRIVED**, whatever it is being pasted into. A
   * picture pasted into a note has no date of its own, and the day it turned up
   * is the only honest one — which is also what makes `attachments/YYYY/MM/`
   * browsable in a file manager.
   *
   * **The hash is the deduplication.** The same screenshot pasted twice writes
   * the same path with the same bytes, which is a no-op rather than a second
   * copy — and two different images cannot collide into one name unless they
   * are the same image.
   */
  async attachImage(request: ImageAttachment): Promise<Attached> {
    await this.#day.ready()
    // **Written by the floor**, because writing files is the floor's job and an
    // attachment is the one kind of corpus content with no document to write it
    // (`x/documents/attachments.ts`). The layering test is what said so.
    const rel = await attach(this.#store.notebook, this.#day.today, request.name, request.ext, request.bytes)
    this.#durable.touched()
    return { rel, link: relativePath(fileOfBase(request.base), rel) }
  }

  /**
   * Which directory a document's relative links resolve from (R7).
   *
   * **Asked of main because it is layout knowledge** (D59): which file a day
   * lives in, and how deep that is, is exactly what `w/layout.ts` exists to be
   * the only answer to. The renderer needs it to point an `<img>` at a file in
   * `attachments/`, and it needs it synchronously per image — so it is fetched
   * once per document rather than once per picture.
   *
   * **Any day of the stream will do**, which is not a coincidence: every day
   * file sits at the same depth, which is the same fact printing relies on for
   * its own relative links (Spike B).
   */
  async linkBase(base: Base): Promise<string> {
    await this.#day.ready()
    const file = fileOfBase(base)
    return file.split('/').slice(0, -1).join('/')
  }
}

/**
 * Which file a relative link is written FROM.
 *
 * A day's links resolve from its own file in `notebook.stream/YYYY/MM/`; every
 * other document's resolve from wherever that document is. The same two cases
 * printing has, and the reason `Base` is one type (`ipc.ts`).
 */
function fileOfBase(base: Base): RelPath {
  return base.kind === 'day' ? dayFile(base.date) : (base.id as string as RelPath)
}
