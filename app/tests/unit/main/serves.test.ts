// How a service declares the channels it answers on (D83).
//
// **The wiring is not tested here and cannot be**: `ipc.ts` imports Electron.
// What is worth testing is the part that was separated out for exactly that
// reason — who claims what, and what happens when two services want the same
// channel.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claim, serve, serveAsked, serveKinds, type Serves } from '../../../src/main/services/serves.ts'

const serving = (...served: ReturnType<typeof serve>[]): Serves => ({ serves: () => served })

test('A SERVICE DECLARES ITS CHANNELS, and they are collected', () => {
  const calls: string[] = []
  const comments = serving(
    serve('tephra:doc:comments', () => void calls.push('read')),
    serve('tephra:doc:addComment', (id: string) => void calls.push(`add ${id}`)),
  )
  const channels = claim([comments])
  assert.deepEqual([...channels.keys()], ['tephra:doc:comments', 'tephra:doc:addComment'])
  channels.get('tephra:doc:addComment')?.answer('c7')
  assert.deepEqual(calls, ['add c7'])
})

test('SEVERAL SERVICES compose into one table', () => {
  const a = serving(serve('one', () => 1))
  const b = serving(serve('two', () => 2), serve('three', () => 3))
  assert.deepEqual([...claim([a, b]).keys()], ['one', 'two', 'three'])
})

test('A SERVICE THAT ANSWERS NOTHING is ordinary', () => {
  // The whole foundation is like this: channels belong to domain services,
  // because a channel is something the renderer has a name for, and there is
  // nothing on the far side of the fence corresponding to a queue (D83).
  assert.equal(claim([serving()]).size, 0)
  assert.equal(claim([]).size, 0)
})

test('TWO SERVICES CANNOT CLAIM ONE CHANNEL, and it fails at startup', () => {
  // **D83's rule, made mechanical.** *Each channel is registered by exactly one
  // service* was a sentence in a design document; this is the sentence as a
  // thrown error, at wiring time, before a window opens — rather than a silent
  // question of which registration won.
  const a = serving(serve('tephra:docket', () => 'a'))
  const b = serving(serve('tephra:docket', () => 'b'))
  assert.throws(() => claim([a, b]), /two services claim the channel tephra:docket/)
})

test('and a service cannot collide with itself either', () => {
  const twice = serving(serve('same', () => 1), serve('same', () => 2))
  assert.throws(() => claim([twice]), /two services claim the channel same/)
})

test('THE ARGUMENTS ARE A CLAIM, not a fact, and the cast is in one place', () => {
  // They arrive from another process. `serve` is where a service states the
  // shape it expects, which is exactly what the old
  // `ipcMain.handle(…, (_e, span: Span) => …)` asserted — moved to one place
  // where a reader looking for *where do we trust the other process* finds it.
  const seen: unknown[] = []
  const one = serving(serve('k', (a: number, b: string) => void seen.push([a, b])))
  claim([one]).get('k')?.answer(7, 'seven')
  assert.deepEqual(seen, [[7, 'seven']])
})

test('A CHANNEL MAY ASK WHICH WINDOW IS ASKING, as a number', () => {
  // **A number, not a `WebContents`** — which is what keeps Electron out of a
  // service. Search needs it because a query's cursor belongs to the window
  // that opened it: two windows searching at once are two walks through the
  // corpus, and a shared cursor would have them stealing each other's place.
  const seen: unknown[] = []
  const one: Serves = {
    serves: () => [serveAsked('s', (asker: number, q: string) => void seen.push([asker, q]))],
  }
  const served = claim([one]).get('s')
  assert.equal(served?.wantsAsker, true, 'the wiring is told to pass it')
  served?.answer(12, 'boiler')
  assert.deepEqual(seen, [[12, 'boiler']])
})

test('and an ordinary channel is not told, which is the default', () => {
  const one: Serves = { serves: () => [serve('k', () => 1)] }
  assert.equal(claim([one]).get('k')?.wantsAsker, undefined)
})

// ── a channel that carries a command union ─────────────────────────────────

type Command =
  | { readonly kind: 'list' }
  | { readonly kind: 'add'; readonly text: string }
  | { readonly kind: 'remove'; readonly item: string }

test('A UNION CHANNEL DISPATCHES BY KIND, each arm narrowed', () => {
  const seen: string[] = []
  const one: Serves = {
    serves: () => [
      serveKinds<Command>('tephra:todo', {
        list: () => void seen.push('list'),
        // `command` is narrowed: `text` exists here and `item` does not.
        add: command => void seen.push(`add ${command.text}`),
        remove: command => void seen.push(`remove ${command.item}`),
      }),
    ],
  }
  const answer = claim([one]).get('tephra:todo')?.answer
  answer?.({ kind: 'add', text: 'Ring the dentist' })
  answer?.({ kind: 'remove', item: 'a7' })
  answer?.({ kind: 'list' })
  assert.deepEqual(seen, ['add Ring the dentist', 'remove a7', 'list'])
})

test('AN UNKNOWN KIND IS REFUSED, not read as undefined(…)', () => {
  // The kind is the one argument from the renderer that decides which code
  // runs, so it is checked where the others are merely trusted.
  const one: Serves = {
    serves: () => [serveKinds<Command>('c', { list: () => 1, add: () => 2, remove: () => 3 })],
  }
  const answer = claim([one]).get('c')?.answer
  assert.throws(() => answer?.({ kind: 'nonesuch' }), /c has no case for nonesuch/)
})
