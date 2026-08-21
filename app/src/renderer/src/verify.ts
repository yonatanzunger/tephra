// Temporary self-check. Drives the real editor through the real Pane, so
// navigation, extension and the landing position are verified rather than
// assumed. Deleted once M0 can be driven by hand.

export async function runVerify(): Promise<void> {
  const say = (key: string, value: unknown): void => console.log(`VERIFY ${key}: ${JSON.stringify(value)}`)
  const settle = (ms = 200): Promise<void> => new Promise(r => setTimeout(r, ms))

  try {
    await settle(1600) // open, bind, and let the background growth finish
    const view = (globalThis as unknown as { __view?: EditorViewLike }).__view
    const pane = (globalThis as unknown as { __pane?: PaneLike }).__pane
    if (view === undefined || pane === undefined) {
      say('ERROR', `view=${view !== undefined} pane=${pane !== undefined}`)
      console.log('VERIFY done')
      return
    }

    say('location', pane.location)

    // Where the cursor lands matters more than it looks: the window grows
    // backwards in the background, so offset zero stops meaning "today" a
    // moment after opening.
    const cursor = view.state.selection.main.head
    say('cursorLandsAtEnd', { cursor, docLength: view.state.doc.length })

    view.dispatch({ changes: { from: cursor, insert: 'Typed today.\n' }, userEvent: 'input.type' })
    await settle(300)
    say('buffer', view.state.doc.toString())

    say('boundaryEarlier', pane.boundary.earlier.kind)

    await pane.goTo({ kind: 'date', date: '2026-01-02' })
    await settle(500)
    say('afterJump', { location: pane.location, canGoBack: pane.canGoBack })

    await pane.back()
    await settle(500)
    say('afterBack', { location: pane.location, canGoForward: pane.canGoForward })

    await settle(1600)
    say('flushed', true)
  } catch (err) {
    say('ERROR', err instanceof Error ? err.message : String(err))
  }
  console.log('VERIFY done')
}

interface EditorViewLike {
  state: { doc: { toString(): string; length: number }; selection: { main: { head: number } } }
  dispatch(spec: unknown): void
}
interface PaneLike {
  readonly location: unknown
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly boundary: { earlier: { kind: string }; later: { kind: string } }
  goTo(target: unknown): Promise<void>
  back(): Promise<void>
}
