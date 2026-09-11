// A docket: one file, complete about one domain (MH1, D68, D72).
//
// **The todo document with the segmentation removed**, and therefore
// structurally simpler than the kind it is modelled on. `keys()` answers
// `ONLY_SEGMENT`, the arrangement `markdown` and `fileset` already use, and
// everything below `load` and `keys` is inherited: edits, undo, spans, the
// journal, the WAL, windows, divergence, versioning, restore.
//
// **What makes it a different kind is completeness** (H2). A task list holds
// what is in front of you and turns over daily; a docket holds *everything true
// about a house* — including matters that are dormant, standing, or not yet
// live — and turns over never. That is what earns the right to stop carrying
// the domain in your head, and it is why a docket is not a tag pivot: most of
// its contents are not live and many will never become tasks at all.
//
// **Every verb is one `replace()` over one BLOCK**, which is the one place this
// differs from the task list. There a verb rewrites a line; here a matter is a
// heading plus its fields plus its triggers, so the unit is a block — but it is
// still an ordinary edit: undoable, journalled, and visible to a window with the
// document open.

import type { Notebook } from '../../../w/notebook.ts'
import type { RelPath } from '../../../w/layout.ts'
import { SegmentedDocument } from '../segmented.ts'
import { Segment } from '../../segment.ts'
import { frontmatterFor, renderFrontmatter } from '../../frontmatter.ts'
import {
  matterBlock, parseMatter, parseOffset, scanMatters, STANDING, unusedMatterId,
  type Matter, type ScannedMatter, type When,
} from '../../../../shared/kinds/docket.ts'
import { nowSeconds } from '../../../../shared/dates.ts'
import { ONLY_SEGMENT } from '../../../../shared/document-api.ts'
import type {
  DocumentId, DocumentMeta, DocumentText, SegmentKey, Span,
} from '../../../../shared/document-api.ts'

/**
 * Ids taken somewhere this document cannot see (D56's rule, carried).
 *
 * A matter's id has to be unique across the corpus so that a reference to it
 * resolves without naming a docket, and a document knows only itself — so
 * whoever holds the index hands this in, and it is called only at the moment an
 * id is actually minted.
 */
export type TakenIds = () => Promise<ReadonlySet<string>>

export class DocketDocument extends SegmentedDocument {
  readonly id: DocumentId
  readonly meta: DocumentMeta & { readonly kind: 'docket' } = { kind: 'docket' }

  readonly #rel: RelPath

  constructor(notebook: Notebook, id: DocumentId) {
    super(notebook)
    this.id = id
    this.#rel = id as string as RelPath
  }

  /** One segment, as every single-file kind does. A wrong key is a caller error. */
  protected async load(key: SegmentKey): Promise<Segment> {
    if (key !== ONLY_SEGMENT) {
      throw new Error(`${this.id} has one segment, and it is not ${key as string}`)
    }
    const text = await this.notebook.read(this.#rel)
    return text === null
      ? Segment.forFile(key, this.#rel, renderFrontmatter(frontmatterFor(null, 'docket')))
      : Segment.forFile(key, this.#rel, text)
  }

  async keys(): Promise<readonly SegmentKey[]> {
    return [ONLY_SEGMENT]
  }

  // ── reading ────────────────────────────────────────────────

  /**
   * Every matter, in the order written.
   *
   * **Creation order, and nothing else** — the task list's rule, and for the
   * same reason: `goal/todo.md` forbids rearranging a list because era 2's
   * nesting could express urgency or subject but never both. A docket is
   * reasoned about as a whole, so the order you put things in is the order you
   * know your way around.
   */
  async matters(): Promise<readonly Matter[]> {
    return (await this.#scan()).map(found => found.matter)
  }

  async #scan(): Promise<readonly ScannedMatter[]> {
    const segment = await this.segment(ONLY_SEGMENT)
    return scanMatters(segment.body)
  }

  async #find(id: string): Promise<ScannedMatter> {
    const found = (await this.#scan()).find(m => m.matter.id === id)
    if (found === undefined) throw new Error(`${this.id} has no matter ${id}`)
    return found
  }

  // ── the verbs ──────────────────────────────────────────────

  /**
   * Put a matter on the docket.
   *
   * **Appended, and dated on arrival.** `arrived` is one of the four fields
   * that cannot be added later: a move between dockets is a delete plus an
   * append and records no date of its own, so without this the resurrection
   * rate — the one measurement that says whether the graveyard tier does
   * anything — is unreconstructible.
   */
  async add(name: string, when: When = STANDING, taken?: TakenIds): Promise<string> {
    const said = name.trim()
    if (said === '') throw new Error('a matter needs a name')
    const segment = await this.segment(ONLY_SEGMENT)
    const id = unusedMatterId(new Set([
      ...(await this.matters()).flatMap(m => (m.id === null ? [] : [m.id])),
      ...(taken === undefined ? [] : [...(await taken())]),
    ]))
    const matter: Matter = {
      id, name: said, when, tags: [], owner: null, link: null, triggers: [],
      arrived: nowSeconds(), declines: 0, occurrence: null, extra: [],
    }
    // **A blank line between blocks, always.** The file is read by people and by
    // other markdown renderers, and two headings with nothing between them read
    // as one run-on section in both.
    const body = segment.body
    const gap = body === '' || body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n'
    const at = body.length
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, at), end: this.at(ONLY_SEGMENT, at) },
      payload: `${gap}${matterBlock(matter)}\n` as DocumentText,
    }], 'operation')
    return id
  }

  /** Rewrite one matter's block. Every field verb goes through here. */
  async #write(id: string, change: (was: Matter) => Matter): Promise<void> {
    const found = await this.#find(id)
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, found.from), end: this.at(ONLY_SEGMENT, found.to) },
      payload: matterBlock(change(found.matter)) as DocumentText,
    }], 'operation')
  }

  async rename(id: string, name: string): Promise<void> {
    const said = name.trim()
    if (said === '') throw new Error('a matter needs a name')
    await this.#write(id, was => ({ ...was, name: said }))
  }

  /** When it happens — or that it does not yet, which is a state (H7b). */
  async setWhen(id: string, when: When): Promise<void> {
    await this.#write(id, was => ({ ...was, when }))
  }

  async setOwner(id: string, owner: string | null): Promise<void> {
    const said = owner === null ? null : owner.trim()
    await this.#write(id, was => ({ ...was, owner: said === '' ? null : said }))
  }

  async setLink(id: string, link: string | null): Promise<void> {
    const said = link === null ? null : link.trim()
    await this.#write(id, was => ({ ...was, link: said === '' ? null : said }))
  }

  /**
   * **`tagMatter`, not `tag`** — the task list learned this too. `tag(span,
   * subject)` is every document's range-tagging verb and means something else
   * entirely, so a kind's own tagging has to be named for what it tags.
   */
  async tagMatter(id: string, subject: string): Promise<void> {
    const said = subject.trim().toLowerCase()
    if (said === '') return
    await this.#write(id, was =>
      was.tags.includes(said) ? was : { ...was, tags: [...was.tags, said] })
  }

  async untagMatter(id: string, subject: string): Promise<void> {
    const said = subject.trim().toLowerCase()
    await this.#write(id, was => ({ ...was, tags: was.tags.filter(t => t !== said) }))
  }

  /**
   * Add a run-up to a matter (H4, MH1).
   *
   * **The parameter that reconciles a complete record with a short horizon.** A
   * docket holds everything, most of it dormant; the horizon has to stay short
   * or it stops being read. The trigger is what decides when a matter crosses
   * from one to the other, and it is per matter because prep time ranges from
   * days for a filter to months for a birthday whose output is *sitting down and
   * writing a plan*.
   *
   * **Offsets are normalised on the way in** (`parseOffset`): a bare `14d` is
   * fourteen days *before*, because run-up is the case and a minus sign is
   * punctuation nobody says out loud.
   */
  async addTrigger(id: string, offset: string, text: string, effect = 'task'): Promise<void> {
    const at = parseOffset(offset)
    if (at === null) throw new Error(`${offset} is not an offset like 3d, 2w or 6m`)
    const said = text.trim()
    if (said === '') throw new Error('a run-up needs to say what happens')
    await this.#write(id, was => ({
      ...was,
      // **Sorted by when they fire**, earliest first, because that is the order
      // they are read in and the order they will run in. Two run-ups on one
      // matter in the order they happened to be typed is a list nobody can scan.
      triggers: [...was.triggers, { offset: at, effect, text: said }]
        .sort((a, b) => days(a.offset) - days(b.offset)),
    }))
  }

  /** Take one off, by its place in the matter's own order. */
  async removeTrigger(id: string, at: number): Promise<void> {
    await this.#write(id, was => ({
      ...was,
      triggers: was.triggers.filter((_, n) => n !== at),
    }))
  }

  /**
   * Take a matter off this docket, block and all.
   *
   * **The delete half of a move** (D71). The append half belongs to whoever is
   * moving it, because only they know where it is going — and the matter keeps
   * its id across the two, so its history stays continuous.
   */
  async remove(id: string): Promise<Matter> {
    const found = await this.#find(id)
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, found.from), end: this.at(ONLY_SEGMENT, found.end) },
      payload: '' as DocumentText,
    }], 'operation')
    return found.matter
  }

  /**
   * Put a matter that came from somewhere else onto this docket.
   *
   * **It keeps its id and loses nothing but its address.** `arrived` is stamped
   * afresh, because that is what it means: when this matter appeared *here*.
   */
  async adopt(matter: Matter): Promise<void> {
    const segment = await this.segment(ONLY_SEGMENT)
    const body = segment.body
    const gap = body === '' || body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n'
    const at = body.length
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, at), end: this.at(ONLY_SEGMENT, at) },
      payload: `${gap}${matterBlock({ ...matter, arrived: nowSeconds() })}\n` as DocumentText,
    }], 'operation')
  }

  /**
   * Somebody looked at this matter in a review and left it where it was.
   *
   * **The count accrues from the first review or the graveyard has no
   * criterion** (MH5 before MH6, deliberately): a threshold chosen against zero
   * data is the position the task list's soft cap has been stuck in since MT5c.
   */
  async decline(id: string): Promise<void> {
    await this.#write(id, was => ({ ...was, declines: was.declines + 1 }))
  }

  // ── the two that make new documents, which this kind does not ──

  async branch(_span: Span, _name: string): Promise<DocumentId> {
    throw new Error('branching out of a docket is not built yet')
  }

  async importText(): Promise<string> {
    throw new Error('importing into a docket is not built yet')
  }
}

export { parseMatter }

/**
 * An offset in days, for ordering only.
 *
 * **Approximate on purpose.** A month is thirty days here, which is wrong as a
 * date and right as a sort key: the question is only *which of these fires
 * first*, and nothing is computed from this. When MH3 turns an offset into a
 * date it will do it against a real calendar.
 */
const PER = { d: 1, w: 7, m: 30, y: 365 } as const

function days(offset: string): number {
  const found = /^([+-])(\d+)([dwmy])$/.exec(offset)
  if (found === null) return 0
  const size = PER[found[3] as keyof typeof PER]
  return Number(found[2]) * size * (found[1] === '-' ? -1 : 1)
}
