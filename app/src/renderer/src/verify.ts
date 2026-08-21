// Scene-driven self-check, used by scripts/m0-acceptance.mjs.
//
// Each scene drives the REAL app — the real editor, Pane, bridge, X and W — and
// prints what it found. Two launches against one notebook is the only way to
// test what M0 actually claims: that nothing is lost across a quit.

export async function runVerify(scene: string): Promise<void> {
  const say = (key: string, value: unknown): void => console.log(`VERIFY ${key}: ${JSON.stringify(value)}`)
  const settle = (ms = 200): Promise<void> => new Promise(r => setTimeout(r, ms))

  try {
    await settle(1800) // open, bind, restore, and let background growth finish

    const view = (globalThis as unknown as { __view?: EditorViewLike }).__view
    const pane = (globalThis as unknown as { __pane?: PaneLike }).__pane
    if (view === undefined || pane === undefined) {
      say('ERROR', `view=${view !== undefined} pane=${pane !== undefined}`)
      console.log('VERIFY done')
      return
    }

    if (scene === 'write') {
      const at = view.state.selection.main.head
      say('landedAt', { cursor: at, docLength: view.state.doc.length })
      view.dispatch({
        changes: { from: at, insert: 'A first sentence, typed by hand.\nAnd a second one.\n' },
        userEvent: 'input.type',
      })
      await settle(300)

      // Leave the caret somewhere specific and non-trivial, so restoring it is
      // a real claim rather than "it happened to be at the end again".
      const target = view.state.doc.toString().indexOf('second')
      view.dispatch({ selection: { anchor: target } })
      say('buffer', view.state.doc.toString())
      say('cursorLeftAt', target)

      await settle(2400) // the write tier's quiescence window, plus the state save
    }

    if (scene === 'handedit') {
      // Type, save, then wait while the harness edits the same file from
      // outside. Nothing here reaches into the watcher; it exercises the whole
      // path from the filesystem up.
      const at = view.state.selection.main.head
      view.dispatch({ changes: { from: at, insert: 'From the app.\n' }, userEvent: 'input.type' })
      await settle(2000) // let it save, so the buffer is clean
      say('beforeExternal', view.state.doc.toString())
      say('ready', true)
      await settle(3000) // the harness edits the file during this window
      say('afterExternal', view.state.doc.toString())
    }

    if (scene === 'selection') {
      const at = view.state.selection.main.head
      view.dispatch({
        changes: { from: at, insert: 'One two three four five six seven.\n' },
        userEvent: 'input.type',
      })
      await settle(400)

      // Set a selection and see whether it is there a moment later. This tells
      // "cannot select" apart from "selection collapses" apart from "selection
      // is invisible", which look identical from the outside.
      view.dispatch({ selection: { anchor: 4, head: 15 } })
      const immediately = view.state.selection.main
      say('rightAfterSetting', { from: immediately.from, to: immediately.to, empty: immediately.empty })

      await settle(1500)
      const later = view.state.selection.main
      say('oneAndAHalfSecondsLater', { from: later.from, to: later.to, empty: later.empty })

      const visible = (): unknown => {
        const drawn = document.querySelectorAll('.cm-selectionBackground')
        if (drawn.length > 0) {
          return { how: 'drawn layer', count: drawn.length, colour: getComputedStyle(drawn[0]!).backgroundColor }
        }
        const line = document.querySelector('.cm-line')
        return {
          how: 'native',
          text: globalThis.getSelection?.()?.toString() ?? '',
          colour: line === null ? null : getComputedStyle(line, '::selection').backgroundColor,
        }
      }
      say('vimOff', visible())

      // And again with vim on, which switches to the drawn layer.
      const toggle = document.querySelector('.titlebar input') as HTMLInputElement | null
      toggle?.click()
      await settle(500)
      view.dispatch({ selection: { anchor: 4, head: 15 } })
      await settle(300)
      say('vimOn', visible())
      view.dispatch({ selection: { anchor: 4, head: 32 } })
      await settle(400)
    }

    if (scene === 'reopen') {
      const head = view.state.selection.main.head
      say('buffer', view.state.doc.toString())
      say('cursorRestoredTo', head)
      say('textAtCursor', view.state.doc.toString().slice(head, head + 6))
      say('location', pane.location)
    }
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
}
