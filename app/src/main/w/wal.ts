import type { DocumentText } from '../../shared/document-api.ts'
// The write-ahead log (D32).
//
// The file tier writes after a second of quiet, or every five seconds. This
// covers the gap: **the seconds of typing that exist only in memory.** It holds
// nothing else and it lives for nothing longer — D32 is explicit that the WAL
// is *"too short-lived to be a second history and so cannot disagree with
// one"*. The moment a file is written, the log for it is empty again.
//
// Machine-local, in `.tephra/`, and therefore never committed and never synced:
// it is recovery state for this process on this machine, and deleting it costs
// at most the last few seconds of one session.
//
// FORMAT: one JSON object per line. Append-only, and a torn last line is
// expected rather than exceptional — a crash is precisely the event this exists
// for, and it can land in the middle of a write.
//
// `format-spec.md` describes these as serialised `DocumentChange` records. What
// is written is narrower: per-day text edits plus the day's length before them.
// The narrowing is deliberate — `baseLen` is what makes replay safe to run
// twice, and a `DocumentChange` carries generations that mean nothing after a
// restart, since a SessionGeneration dies with its process (D33).

import type { Notebook } from './notebook.ts'
import type { RelPath } from './layout.ts'
import { walFile } from './layout.ts'

export interface WalRecord {
  /**
   * Which document the edit belongs to (D54).
   *
   * **Written into the record rather than inferred from the log's filename.**
   * A log is named by slugging the document id, and slugging is not reversible
   * — `notes/a.md` and `notes-a.md` slug alike — so recovery reads the id it
   * was given instead of guessing at one.
   */
  readonly doc: string
  /** The segment the edit belongs to: a day in the stream, `content` elsewhere. */
  readonly date: string
  /** Offsets within that day's body, before the edit. */
  readonly from: number
  readonly to: number
  readonly insert: DocumentText
  /**
   * The body's length before this edit.
   *
   * **This is what makes replay safe to run twice.** A crash can land after the
   * files were written but before the log was cleared, and replaying then would
   * apply edits the file already contains — appending the same paragraph twice,
   * silently. On replay each record is applied only if the day is currently the
   * length this record expected; otherwise it has already happened and is
   * skipped. Records after it then match again, so replay resumes wherever the
   * file actually got to rather than refusing wholesale.
   */
  readonly baseLen: number
}

export class Wal {
  readonly #notebook: Notebook
  readonly #file: RelPath

  /** One log per document (format-spec). v1 has only the stream. */
  constructor(notebook: Notebook, docId = 'stream') {
    this.#notebook = notebook
    this.#file = walFile(docId)
  }

  /** Append a batch. Caller decides the batching; D32 says about 50 ms. */
  async append(records: readonly WalRecord[]): Promise<void> {
    if (records.length === 0) return
    const existing = (await this.#notebook.read(this.#file)) ?? ''
    const lines = records.map(r => JSON.stringify(r)).join('\n')
    await this.#notebook.write(this.#file, `${existing}${lines}\n`)
  }

  /**
   * Everything recoverable in the log.
   *
   * A line that will not parse is dropped, not fatal. The last one may be torn
   * by the very crash this log exists to survive, and refusing to recover
   * *anything* because the final fragment is incomplete would give up the whole
   * point at the exact moment it was needed.
   */
  async read(): Promise<readonly WalRecord[]> {
    const text = await this.#notebook.read(this.#file)
    if (text === null || text === '') return []
    const out: WalRecord[] = []
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      try {
        const parsed: unknown = JSON.parse(line)
        if (isRecord(parsed)) out.push(parsed)
      } catch {
        // A torn tail. Everything before it is still good.
      }
    }
    return out
  }

  /** Called once the files are on disk and the log has nothing left to say. */
  async clear(): Promise<void> {
    if (await this.#notebook.has(this.#file)) await this.#notebook.write(this.#file, '')
  }
}

function isRecord(value: unknown): value is WalRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Partial<WalRecord>
  return (
    typeof r.doc === 'string' &&
    typeof r.date === 'string' &&
    typeof r.from === 'number' &&
    typeof r.to === 'number' &&
    typeof r.insert === 'string' &&
    typeof r.baseLen === 'number'
  )
}
