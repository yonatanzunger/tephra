// Temporary self-check for the bridge milestone. Drives the real IPC path from
// inside the renderer, so "the round trip works" is verified rather than
// assumed. Deleted once the editor can be driven by hand.

import { RemoteDocument } from './x/remote-document'
import type { BufferPosition } from '@shared/document-api.ts'

const bp = (n: number): BufferPosition => n as BufferPosition

export async function runVerify(): Promise<void> {
  const say = (key: string, value: unknown): void => console.log(`VERIFY ${key}: ${JSON.stringify(value)}`)
  try {
    const doc = await RemoteDocument.open()
    say('origin', location.origin)
    say('today', doc.today)

    const w = await doc.readToday()
    say('initialText', w.text)

    // The synchronous half: no round trip, so a thousand calls are free.
    const start = performance.now()
    for (let i = 0; i < 1000; i++) w.toDocument(bp(0))
    say('1000 sync toDocument calls, ms', Math.round(performance.now() - start))

    await w.edit([{ from: bp(0), to: bp(0), insert: 'Hello from the renderer.\n' }], 'user')
    say('afterEdit', w.text)
    say('spanKinds', w.spans().map(s => s.kind))

    // Ordering under load: fire without awaiting, the way an editor does.
    const pending: Promise<void>[] = []
    for (const ch of 'abcde') {
      const at = bp(w.text.length)
      pending.push(w.edit([{ from: at, to: at, insert: ch }], 'user'))
    }
    await Promise.all(pending)
    say('afterBurst', { text: w.text, length: w.text.length })

    // No sleep: undo() now resolves only once every open window has caught up.
    const change = await doc.undo()
    say('undoReturned', change === null ? null : { from: change.from, to: change.to, edits: change.edits.length })
    say('afterUndo', { text: w.text, length: w.text.length })

    await doc.flush()
    say('flushed', true)
  } catch (err) {
    say('ERROR', err instanceof Error ? `${err.message}` : String(err))
  }
  console.log('VERIFY done')
}
