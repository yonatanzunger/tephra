// The renderer's half of the window (D37), and specifically its coordinates.
//
// **This file exists because its absence was the bug.** When markers left the
// buffer (D44), `LocalWindow` in main learned the prose↔raw mapping and
// `RemoteWindow` — the same object's other half — did not. Every test passed,
// because every window test drove main. What reached the screen was a tag
// applied 27 characters from where the selection was, and the file said so.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { RemoteWindow } from '../../src/renderer/src/x/remote-window.ts'
import { ProseMap, proseText, type Marker } from '../../src/shared/prose.ts'
import type {
  WindowPosition, DateKey, Document, DocumentOffset, ProseOffset, SegmentKey, SessionGeneration,
  TypedSpan, DocumentText } from '../../src/shared/document-api.ts'
import type { WindowSnapshot, WindowId } from '../../src/shared/ipc.ts'
import { rt } from '../support/text.ts'

const DAY = '2026-03-14' as DateKey
const START = '<!--tephra:tag-start Foo-->'
const END = '<!--tephra:tag-end Foo-->'

/**
 * A day whose body carries a handle and a boundary, and the snapshot main would
 * send for it — built through the same code main uses, so the fixture cannot
 * quietly disagree with the thing it is testing.
 */
function fixture(raw: DocumentText) {
  const at = (text: string): DocumentOffset => raw.indexOf(text) as DocumentOffset
  const past = (text: string): DocumentOffset => (raw.indexOf(text) + text.length) as DocumentOffset
  const markers: Marker[] = [
    ...(raw.includes(START) ? [{ from: at(START), to: past(START), width: 1 as const }] : []),
    ...(raw.includes(END) ? [{ from: at(END), to: past(END), width: 0 as const }] : []),
  ]
  const map = ProseMap.of(raw.length, markers)
  const snapshot: WindowSnapshot = {
    id: 1 as WindowId,
    text: proseText(raw, map),
    span: {
      begin: { segment: DAY as unknown as SegmentKey, offset: 0 as DocumentOffset, generation: 1 as SessionGeneration },
      end: { segment: DAY as unknown as SegmentKey, offset: raw.length as DocumentOffset, generation: 1 as SessionGeneration },
    },
    generation: 1 as SessionGeneration,
    spans: [],
    placement: [{ date: DAY, start: 0 as WindowPosition, length: raw.length, markers, annotations: [] }],
    boundaries: { earlier: false, later: false },
  }
  const window = new RemoteWindow({} as Document, snapshot)
  return { window, raw, map }
}

const BODY = rt(`Every market ${START}participant has a finite${END} shock limit S(τ).\n`)

const at = (n: number) => ({ segment: DAY as unknown as SegmentKey, offset: n as DocumentOffset, generation: 1 as SessionGeneration })
const SPAN: TypedSpan = { kind: 'tag', name: 'Foo', span: { begin: at(10), end: at(20) } }
const PLACEMENT = [{ date: DAY, start: 0 as WindowPosition, length: BODY.length, markers: [], annotations: [] }]
const EDGES = { earlier: false, later: false }

test('a prose position becomes the RAW offset it stands for, not itself', () => {
  const { window, raw } = fixture(BODY)
  // The reported bug: selecting "finite shock limit" and tagging it put the
  // markers 27 characters early, because the prose offset was handed to the
  // document as though it were a byte offset.
  const at = window.text.indexOf('finite shock limit')
  const position = window.toDocument(at as WindowPosition)
  // Not a slice of eighteen: the range's end marker sits between "finite" and
  // " shock limit" in the bytes, which is exactly why prose and raw are
  // different coordinate spaces. What matters is that the offset lands on the
  // word the person selected.
  assert.ok(
    raw.startsWith('finite', position.offset as number),
    `landed on ${JSON.stringify(raw.slice(position.offset as number, (position.offset as number) + 18))}`,
  )
})

test('every prose position survives the round trip', () => {
  const { window } = fixture(BODY)
  for (let i = 0; i <= window.text.length; i++) {
    assert.equal(window.toWindow(window.toDocument(i as WindowPosition)), i, `prose ${i}`)
  }
})

test('main and the renderer agree, position for position', () => {
  const { window, map } = fixture(BODY)
  for (let i = 0; i <= window.text.length; i++) {
    const mine = window.toDocument(i as WindowPosition).offset as number
    assert.equal(mine, map.toDocument(i as ProseOffset), `the two halves disagree at prose ${i}`)
  }
})

test('a body with no markers is unaffected', () => {
  const { window, raw } = fixture(rt('Nothing marked here at all.\n'))
  assert.equal(window.text, raw)
  assert.equal(window.toDocument(7 as WindowPosition).offset as number, 7)
})

test('when the spans change, whoever draws them is told', async () => {
  // The bug this exists for: deleting a tag's mark removed the tag from the
  // file, and the underline stayed on screen. The edit was the EDITOR's, so the
  // change feed is deliberately silent about it (echo suppression) — and the
  // acknowledgement that carried the new, empty span list arrived with no
  // announcement at all, so nothing ever asked for a redraw.
  const { window } = fixture(BODY)
  let told = 0
  window.onSpansChanged(() => told++)

  window.applyRemote([], 'external', window.text, 2 as SessionGeneration, [SPAN], PLACEMENT, EDGES)
  assert.equal(told, 1, 'a new span should be announced')

  window.applyRemote([], 'external', window.text, 3 as SessionGeneration, [SPAN], PLACEMENT, EDGES)
  assert.equal(told, 1, 'the same spans again are not news — this is the typing path')

  window.applyRemote([], 'external', window.text, 4 as SessionGeneration, [], PLACEMENT, EDGES)
  assert.equal(told, 2, 'and losing them is')
})
