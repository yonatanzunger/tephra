// **Domain. Depends on `CorpusService` and `DayService`.**
//
// What the sidebar asks: subjects, bookmarks, the timeline, links, threads,
// occurrences, task status, the curated sections, and every document that could
// be opened.
//
// **Every one of these is a question about the whole corpus**, which is why they
// go through the index rather than through a document (D52). The index is a
// throwaway cache of a scan, so *asking* is cheap and *repairing* is a matter of
// deleting `.tephra/index` and paying for a scan once.
//
// **A thin service, deliberately.** Most of what it serves is a single call into
// the index or the section list, and the two methods that are not — `links` and
// `documents` — are here because they compose a corpus-wide answer rather than
// because anybody asked for a layer. Thin is the honest shape for the sidebar:
// it reads, and almost nothing it reads is its own.
//
// **It does not own the section list.** `Filesets` is `CorpusService`'s, because
// the document lifecycle also writes it — pinning a new file into a section,
// retargeting a renamed one — and a service owning it would mean the other
// reaching sideways for it (D83).
//
// **`navOpen` is not here**, and cannot be: following a reference that leaves the
// app means `shell.openExternal`, and a service may not import Electron. It is
// split the way link-following already is — the service says where a reference
// points, which is a question about the notebook, and `ipc.ts` opens it.

import type { CorpusService } from './corpus-service.ts'
import type { DayService } from './day-service.ts'
import { serve, type Served, type Serves } from './serves.ts'
import { CHANNEL } from '../../shared/ipc.ts'
import { ONLY_SEGMENT, STREAM_ID, type DocumentId } from '../../shared/document-api.ts'
import type { LinkRow, Reference } from '../../shared/nav-api.ts'
import { dateKeyAt } from '../../shared/dates.ts'
import { basename } from 'node:path'
import { documentRoot, parseDayFile, STREAM_DIR, type RelPath } from '../w/layout.ts'
import { nameOf } from '../../shared/slug.ts'

export class NavService implements Serves {
  readonly #store: CorpusService
  readonly #day: DayService

  constructor(store: CorpusService, day: DayService) {
    this.#store = store
    this.#day = day
  }

  serves(): readonly Served[] {
    const index = this.#store.index
    const sections = this.#store.filesets
    return [
      serve(CHANNEL.navSubjects, () => index.subjects()),
      serve(CHANNEL.navBookmarks, () => index.bookmarks()),
      serve(CHANNEL.navTimeline, () => index.timeline()),
      serve(CHANNEL.navThreads, () => index.threads()),
      serve(CHANNEL.navStatus, () => index.status()),
      serve(CHANNEL.navOccurrences, (reference: Reference) => index.occurrences(reference)),
      serve(CHANNEL.navLinks, () => this.links()),
      serve(CHANNEL.navDocuments, () => this.documents()),
      serve(CHANNEL.navSections, () => this.sections()),
      serve(CHANNEL.navPin, (reference: Reference, label: string, section?: string) =>
        sections.pin(reference, label, section),
      ),
      serve(CHANNEL.navUnpin, (reference: Reference, section?: string) =>
        sections.unpin(reference, section),
      ),
      serve(CHANNEL.navRelabel, (reference: Reference, label: string, section: string) =>
        sections.relabel(reference, label, section),
      ),
    ]
  }

  /**
   * Every link in the corpus, with the day each appearance was written on.
   *
   * **Zone-aware, because a link's appearance is dated** (R10a, D60, D63). The
   * index records when in milliseconds; which *day* that was is a question about
   * where the notebook is, so the zone comes from the day service rather than
   * from the machine.
   */
  async links(): Promise<readonly LinkRow[]> {
    const zone = this.#day.zone
    return (await this.#store.index.links()).map(row => ({
      ...row,
      appearances: row.appearances.map(at => ({
        ...at,
        on: at.at.date ?? dateKeyAt(new Date(at.when), zone),
        ...whereWritten(at.at.file as RelPath),
      })),
    }))
  }

  /** The curated sections as a tree (D53) — the hand-made half of the sidebar. */
  async sections(): ReturnType<CorpusService['filesets']['tree']> {
    return this.#store.filesets.tree()
  }

  /**
   * Every document that could be opened, for the Open… chooser (MC6).
   *
   * The stream leads and is called *Notebook*: it is the one document nobody
   * named, and the only one that is always there. The rest answer with their
   * title, falling back to the filename for a document that has none.
   */
  async documents(): Promise<readonly { id: DocumentId; title: string }[]> {
    const out: { id: DocumentId; title: string }[] = [{ id: STREAM_ID, title: 'Notebook' }]
    for (const id of await this.#store.corpus.list()) {
      if (id === STREAM_ID) continue
      const title = await this.#store.corpus.use(id, doc => doc.titleOf(ONLY_SEGMENT), {
        mode: 'read',
        retain: false,
      })
      out.push({ id, title: title ?? basename(id as string) })
    }
    return out
  }
}

function whereWritten(file: RelPath): { doc: DocumentId; segment: string; source: string } {
  const root = documentRoot(file)
  if (root === null) {
    return {
      doc: file as unknown as DocumentId,
      segment: ONLY_SEGMENT as unknown as string,
      source: nameOf(file),
    }
  }
  return {
    doc: root as unknown as DocumentId,
    segment: parseDayFile(file)?.date ?? (ONLY_SEGMENT as unknown as string),
    // The notebook is called the notebook; a list is called what it is named.
    source: root === STREAM_DIR ? 'notebook' : nameOf(root),
  }
}
