// **Domain. Depends on `CorpusService` and `DurabilityService`.**
//
// Reading the notebook's past, and putting it back (D32).
//
// **The tiers are not here.** Recording a version is durability's — it happens
// on a clock nobody asks for, alongside the log and the file write. This is the
// other half: the questions a person asks about what was there, and the one act
// that answers them by making it so again.
//
// **A thin service.** Two of its three verbs are a single call into
// `StreamHistory`; `restore` is the exception, and it is the whole reason the
// group is worth a service rather than a pair of lambdas in `ipc.ts`.

import type { CorpusService } from './corpus-service.ts'
import type { DurabilityService } from './durability-service.ts'
import { serve, type Served, type Serves } from './serves.ts'
import { CHANNEL } from '../../shared/ipc.ts'
import type { RestoreReport, Version } from '../../shared/history-api.ts'
import type { DateKey, VersionId } from '../../shared/document-api.ts'

export class HistoryService implements Serves {
  readonly #store: CorpusService
  readonly #durable: DurabilityService

  constructor(store: CorpusService, durable: DurabilityService) {
    this.#store = store
    this.#durable = durable
  }

  serves(): readonly Served[] {
    return [
      serve(CHANNEL.versions, (limit?: number) => this.versions(limit)),
      serve(CHANNEL.readDay, (version: VersionId, date: DateKey) => this.readDay(version, date)),
      serve(CHANNEL.restore, (version: VersionId) => this.restore(version)),
    ]
  }

  /** Days and versions, rather than paths and object ids (D32). */
  async versions(limit = 50): Promise<readonly Version[]> {
    return (await this.#durable.history?.versions(limit)) ?? []
  }

  /** What one day looked like at a version. Null when there is no history. */
  async readDay(version: VersionId, date: DateKey): Promise<string | null> {
    return (await this.#durable.history?.readDay(version, date)) ?? null
  }

  /**
   * Put the stream back the way it was at a version.
   *
   * **Flushed immediately, and a version taken straight away.** A restore that
   * lived only in memory would be undone by a crash, and the one thing somebody
   * doing a restore cannot afford is for it not to have happened. Committing it
   * at once also makes the restore itself a point to come back FROM, which is
   * what makes *the way back from a bad restore is another restore* true.
   *
   * **Through the Corpus, which is what knows which documents are open**: a
   * restore that wrote files under one would be undone by its buffer (MC7).
   */
  async restore(version: VersionId): Promise<RestoreReport> {
    const history = this.#durable.history
    if (history === null) throw new Error('this notebook has no history to restore from')
    const report = await this.#store.mutate(() => history.restore(version, this.#store.corpus))
    // **Dirty without a timer**, because the flush is on the next line: the
    // point of a restore is that it has happened.
    this.#durable.unsaved()
    await this.#durable.flush()
    await this.#durable.saveVersionNamed(`Restored to ${version.slice(0, 7)}`)
    return report
  }
}
