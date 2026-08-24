// Buffer edits applied to a plain string, in the renderer.
//
// A deliberate duplicate of the batch semantics in main's text-edits.ts, kept
// tiny and separate: main must not import renderer code and the renderer must
// not import Node. If the two ever disagree, the length check in RemoteWindow
// catches it on the very next edit rather than letting the buffers drift.

import type { BufferEdit } from '../../../shared/document-api.ts'

export function applyEdits(text: string, edits: readonly BufferEdit[]): string {
  if (edits.length === 0) return text
  const sorted = [...edits].sort((a, b) => (a.from as number) - (b.from as number))
  const out: string[] = []
  let cursor = 0
  for (const edit of sorted) {
    const from = Math.min(edit.from as number, edit.to as number)
    const to = Math.max(edit.from as number, edit.to as number)
    out.push(text.slice(cursor, from), edit.insert)
    cursor = to
  }
  out.push(text.slice(cursor))
  return out.join('')
}
