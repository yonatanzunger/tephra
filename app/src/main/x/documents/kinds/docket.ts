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
  MATTER_LEVEL, matterBlock, outline, parseMatter, parseOffset, scanBlocks, scanMatters,
  sectionHeading, STANDING, unusedMatterId,
  type Matter, type ScannedBlock, type ScannedMatter, type Section, type When,
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
   * Every matter, in file order, flat — sections and all.
   *
   * **File order, and nothing computed** — the task list's rule, held in the
   * part that matters: nothing here sorts itself, ever. What changed is the
   * claim that came with it, which was *creation order and nothing else*,
   * borrowed from `goal/todo.md`'s ban on rearranging. That ban was about a list
   * that turns over daily, where nesting would have had to mean urgency *or*
   * subject and could not mean both. A docket turns over never, and arranging it
   * — *periodic maintenance*, *need to do*, *major projects* — is how two people
   * find their way around it. So a person may move things; the machine may not.
   *
   * `sections()` is the divided view and the one the surface draws. This stays
   * flat because the horizon and the index want every matter, not the grouping.
   */
  async matters(): Promise<readonly Matter[]> {
    return (await this.#scan()).map(found => found.matter)
  }

  /**
   * The docket divided into its sections, which is what the surface draws.
   *
   * **Sections are for reading, and they are the only ordering this kind has.**
   * `matters()` above says creation order and nothing else, inheriting the task
   * list's rule against rearranging — and that rule was about a list that turns
   * over daily, where nesting would have had to mean urgency *or* subject. A
   * docket turns over never and is reasoned about as a whole, so grouping *is*
   * how you know your way around it: *periodic maintenance*, *need to do*,
   * *major projects*. The flat order is still the fallback, because a docket
   * with no sections has to work exactly as it did.
   */
  async sections(): Promise<readonly Section[]> {
    const segment = await this.segment(ONLY_SEGMENT)
    return outline(segment.body)
  }

  async #scan(): Promise<readonly ScannedMatter[]> {
    const segment = await this.segment(ONLY_SEGMENT)
    return scanMatters(segment.body)
  }

  async #blocks(): Promise<readonly ScannedBlock[]> {
    const segment = await this.segment(ONLY_SEGMENT)
    return scanBlocks(segment.body)
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
  async add(
    name: string,
    when: When = STANDING,
    taken?: TakenIds,
    section = '',
  ): Promise<string> {
    const said = name.trim()
    if (said === '') throw new Error('a matter needs a name')
    const id = unusedMatterId(new Set([
      ...(await this.matters()).flatMap(m => (m.id === null ? [] : [m.id])),
      ...(taken === undefined ? [] : [...(await taken())]),
    ]))
    const matter: Matter = {
      id, name: said, when, tags: [], owner: null, link: null, triggers: [], notes: [],
      arrived: nowSeconds(), declines: 0, occurrence: null, extra: [],
    }
    // **Where it goes is said, never guessed.** Appending to the end of the file
    // was right while a docket was one flat list and became wrong the moment it
    // could be divided: the end of the file is inside the *last* section, so
    // adding *fix the fence* to a docket whose last heading is *major projects*
    // would have filed it as one, silently, in the middle of a conversation. A
    // section is a claim; adding a matter makes no claim, so the default is the
    // undivided run and anything else is asked for.
    const { at, level } = await this.#endOf(section)
    const body = (await this.segment(ONLY_SEGMENT)).body
    // **A blank line between blocks, always.** The file is read by people and by
    // other markdown renderers, and two headings with nothing between them read
    // as one run-on section in both.
    const lead = at === 0 || body.slice(0, at).endsWith('\n\n')
      ? ''
      : body.slice(0, at).endsWith('\n') ? '\n' : '\n\n'
    const tail = at >= body.length ? '\n' : '\n\n'
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, at), end: this.at(ONLY_SEGMENT, at) },
      payload: `${lead}${matterBlock(matter, level)}${tail}` as DocumentText,
    }], 'operation')
    return id
  }

  /**
   * Rewrite one matter's block. Every field verb goes through here.
   *
   * **At the depth it was found at**, never at the default: a matter inside a
   * section is a heading level deeper, and a verb that reset that would flatten
   * the file's outline as a side effect of editing an owner.
   */
  async #write(id: string, change: (was: Matter) => Matter): Promise<void> {
    const found = await this.#find(id)
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, found.from), end: this.at(ONLY_SEGMENT, found.to) },
      payload: matterBlock(change(found.matter), found.level) as DocumentText,
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
   * Rewrite the prose under a matter.
   *
   * **Replaced wholesale, not appended to**, which is the task list's shape for
   * the same reason: the surface edits a block of text and hands back what it
   * now says, so there is one path and no merge to get wrong. Empty lines are
   * dropped — a note of nothing is no note.
   */
  async setNotes(id: string, notes: readonly string[]): Promise<void> {
    const kept = notes.map(line => line.trim()).filter(line => line !== '')
    await this.#write(id, was => ({ ...was, notes: kept }))
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

  // ── sections (MH1) ─────────────────────────────────────────

  /**
   * Where a matter goes and what order things sit in, as text moves.
   *
   * **A move is a splice, not a re-render.** The block that moves is written
   * out afresh — it is the one being touched — and every other block is left
   * exactly as its bytes were, which is the property the whole format rests on.
   * The two edits go in ONE `replace()` so a move is one undo, not a
   * disappearance followed by a reappearance.
   */
  async #splice(id: string, insertAt: number, level: number): Promise<void> {
    const blocks = await this.#blocks()
    const which = blocks.findIndex(b => b.kind === 'matter' && b.matter.id === id)
    const found = blocks[which]
    if (found === undefined || found.kind !== 'matter') {
      throw new Error(`${this.id} has no matter ${id}`)
    }
    // Take the blank run after the block with it, so a move leaves no hole and
    // lands with the same separation it had.
    const gapEnd = blocks[which + 1]?.from ?? (await this.segment(ONLY_SEGMENT)).body.length
    if (insertAt > found.from && insertAt < gapEnd) return // already there
    const body = (await this.segment(ONLY_SEGMENT)).body
    const tail = insertAt >= body.length ? '' : '\n\n'
    const lead = insertAt >= body.length && body !== '' && !body.endsWith('\n\n')
      ? (body.endsWith('\n') ? '\n' : '\n\n')
      : ''
    await this.replace([
      {
        span: { begin: this.at(ONLY_SEGMENT, found.from), end: this.at(ONLY_SEGMENT, gapEnd) },
        payload: '' as DocumentText,
      },
      {
        span: { begin: this.at(ONLY_SEGMENT, insertAt), end: this.at(ONLY_SEGMENT, insertAt) },
        payload: `${lead}${matterBlock(found.matter, level)}${tail}` as DocumentText,
      },
    ], 'operation')
  }

  /** Where a section's matters end — the next section heading, or the end. */
  async #endOf(section: string): Promise<{ at: number; level: number }> {
    const blocks = await this.#blocks()
    const body = (await this.segment(ONLY_SEGMENT)).body
    if (section === '') {
      // The unnamed run is everything above the first heading.
      const first = blocks.find(b => b.kind === 'section')
      return { at: first?.from ?? body.length, level: MATTER_LEVEL }
    }
    const start = blocks.findIndex(b => b.kind === 'section' && b.name === section)
    if (start < 0) throw new Error(`${this.id} has no section called ${section}`)
    const next = blocks.slice(start + 1).find(b => b.kind === 'section')
    return { at: next?.from ?? body.length, level: MATTER_LEVEL + 1 }
  }

  /**
   * Add a section, at the end.
   *
   * **At the end and empty, because that is the gesture**: somebody says *we
   * should have one for major projects* and then puts things in it. Inserting it
   * anywhere else would be guessing at an order nobody has given yet, and
   * sections can be reordered by moving their matters.
   */
  async addSection(name: string): Promise<string> {
    const said = name.trim()
    if (said === '') throw new Error('a section needs a name')
    if ((await this.sections()).some(s => s.name === said)) {
      throw new Error(`this docket already has a section called ${said}`)
    }
    const body = (await this.segment(ONLY_SEGMENT)).body
    const gap = body === '' || body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n'
    const at = body.length
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, at), end: this.at(ONLY_SEGMENT, at) },
      payload: `${gap}${sectionHeading(said)}\n` as DocumentText,
    }], 'operation')
    return said
  }

  async renameSection(name: string, to: string): Promise<void> {
    const said = to.trim()
    if (said === '') throw new Error('a section needs a name')
    const found = (await this.#blocks()).find(b => b.kind === 'section' && b.name === name)
    if (found === undefined) throw new Error(`${this.id} has no section called ${name}`)
    await this.replace([{
      span: { begin: this.at(ONLY_SEGMENT, found.from), end: this.at(ONLY_SEGMENT, found.to) },
      payload: sectionHeading(said) as DocumentText,
    }], 'operation')
  }

  /**
   * Take a section heading away and keep everything that was under it.
   *
   * **Deleting a heading must never delete a house.** The matters stay exactly
   * where they are in the file and join whatever now contains them — the section
   * above, or the undivided run at the top — and they are re-written only to fix
   * their heading depth, so the outline stays true. A section is a way of
   * reading, so removing one is a reading change and nothing else.
   */
  async removeSection(name: string): Promise<void> {
    const blocks = await this.#blocks()
    const which = blocks.findIndex(b => b.kind === 'section' && b.name === name)
    const found = blocks[which]
    if (found === undefined || found.kind !== 'section') {
      throw new Error(`${this.id} has no section called ${name}`)
    }
    const body = (await this.segment(ONLY_SEGMENT)).body
    const gapEnd = blocks[which + 1]?.from ?? body.length
    // Whatever contains them now decides how deep they are written.
    const above = blocks.slice(0, which).filter(b => b.kind === 'section')
    const level = above.length > 0 ? MATTER_LEVEL + 1 : MATTER_LEVEL
    const orphans: ScannedMatter[] = []
    for (const block of blocks.slice(which + 1)) {
      if (block.kind === 'section') break
      orphans.push(block)
    }
    await this.replace([
      {
        span: { begin: this.at(ONLY_SEGMENT, found.from), end: this.at(ONLY_SEGMENT, gapEnd) },
        payload: '' as DocumentText,
      },
      ...orphans
        .filter(m => m.level !== level)
        .map(m => ({
          span: { begin: this.at(ONLY_SEGMENT, m.from), end: this.at(ONLY_SEGMENT, m.to) },
          payload: matterBlock(m.matter, level) as DocumentText,
        })),
    ], 'operation')
  }

  /**
   * Put a matter in a section — `''` for the undivided run at the top.
   *
   * At the end of that section, or immediately before `before` if one is named,
   * which is how *put this above that one* is expressed.
   */
  async moveMatter(id: string, section: string, before?: string): Promise<void> {
    const { at, level } = await this.#endOf(section)
    if (before === undefined) {
      await this.#splice(id, at, level)
      return
    }
    const target = (await this.#blocks()).find(b => b.kind === 'matter' && b.matter.id === before)
    if (target === undefined) throw new Error(`${this.id} has no matter ${before}`)
    await this.#splice(id, target.from, level)
  }

  /**
   * Move a matter one place up or down **inside its own section**.
   *
   * **The gesture is relative because the intention is** — *this one first* —
   * and stopping at the section edge is the point rather than a limitation:
   * nudging a matter out of *periodic maintenance* and into *major projects* by
   * pressing the same key one more time would be a reclassification nobody
   * asked for. Crossing a boundary is `moveMatter`, which says where.
   *
   * Answers whether it moved, so a surface can leave the control alone at the
   * ends instead of offering a gesture that does nothing.
   */
  async nudgeMatter(id: string, delta: number): Promise<boolean> {
    if (delta === 0) return false
    const blocks = await this.#blocks()
    const which = blocks.findIndex(b => b.kind === 'matter' && b.matter.id === id)
    if (which < 0) throw new Error(`${this.id} has no matter ${id}`)
    const found = blocks[which] as ScannedBlock & { kind: 'matter' }
    // Its own section: the run of matters bounded by section headings either way.
    let first = which
    while (first > 0 && (blocks[first - 1] as ScannedBlock).kind === 'matter') first -= 1
    let last = which
    while (last + 1 < blocks.length && (blocks[last + 1] as ScannedBlock).kind === 'matter') last += 1
    const wanted = which + (delta < 0 ? -1 : 1)
    if (wanted < first || wanted > last) return false
    const neighbour = blocks[wanted] as ScannedBlock
    if (delta < 0) {
      await this.#splice(id, neighbour.from, found.level)
    } else {
      // After the neighbour means at the start of whatever follows it.
      const after = blocks[wanted + 1]?.from
        ?? (await this.segment(ONLY_SEGMENT)).body.length
      await this.#splice(id, after, found.level)
    }
    return true
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
