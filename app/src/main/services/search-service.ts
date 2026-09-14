// **Domain. Depends on `CorpusService`.**
//
// Searching the corpus (MS3, D65, D66).
//
// **Three messages rather than one**, because the answer to a query over twenty
// years is not a value: `open` narrows and returns a handle, `next` pulls as far
// as it must, `close` stops. A scan cannot stream in rank order and a stream
// pushed at a renderer that is walking one match at a time would read the corpus
// to fill a buffer nobody asked for — so the renderer asks for `n` and gets `n`,
// and the cursor stays where it stopped.
//
// **It owns the `Scanner`**, which is an X-upper object beside `Corpus` and
// `CorpusIndex` — but unlike those two, nothing else uses it, so there is no
// reason for the corpus service to hold it (D83).
//
// **A cursor belongs to the window that opened it.** Two windows searching at
// once are two walks through the corpus, and a shared cursor would have them
// stealing each other's place — so `searchOpen` is declared with the asker, and
// a window closing takes its searches with it through `forget`.

import { Scanner } from '../x/documents/search.ts'
import { Searches } from './searches.ts'
import type { CorpusService } from './corpus-service.ts'
import { serve, serveAsked, type Served, type Serves } from './serves.ts'
import { CHANNEL } from '../../shared/ipc.ts'
import type { SearchBatch, SearchOpened, SearchRequest } from '../../shared/ipc.ts'
import type { QueryId } from '../../shared/search-api.ts'

export class SearchService implements Serves {
  readonly #searches: Searches

  constructor(store: CorpusService) {
    this.#searches = new Searches(new Scanner(store.notebook, store.index))
  }

  serves(): readonly Served[] {
    return [
      serveAsked(CHANNEL.searchOpen, (asker: number, request: SearchRequest) =>
        this.open(asker, request),
      ),
      serve(CHANNEL.searchNext, (id: QueryId, count: number) => this.next(id, count)),
      serve(CHANNEL.searchClose, (id: QueryId) => this.close(id)),
    ]
  }

  open(asker: number, request: SearchRequest): SearchOpened {
    return this.#searches.open(asker, request)
  }

  async next(id: QueryId, count: number): Promise<SearchBatch> {
    return this.#searches.next(id, count)
  }

  close(id: QueryId): void {
    this.#searches.close(id)
  }

  /**
   * A window has gone; drop its cursors.
   *
   * **Called with an id taken while the window was alive.** Reading
   * `webContents.id` inside `closed` reaches a destroyed object and throws — and
   * the window that found that was the hidden one printing makes, so the failure
   * was a PDF that came out fine and a main process that fell over on the way
   * back.
   */
  forget(asker: number): void {
    this.#searches.closeFor(asker)
  }
}
