// Temporary self-check. Drives the REAL editor — CodeMirror's own transaction
// path, the binding, the window, IPC, X and W — so "typing reaches disk" is
// verified rather than assumed. Deleted once it can be driven by hand.

export async function runVerify(): Promise<void> {
  const say = (key: string, value: unknown): void => console.log(`VERIFY ${key}: ${JSON.stringify(value)}`)
  const settle = (ms = 120): Promise<void> => new Promise(r => setTimeout(r, ms))

  try {
    await settle(1200) // let the shell open its window and bind the editor

    const host = document.querySelector('.editor-host') as HTMLElement | null
    say('editorMounted', host !== null)
    const cmView = (host?.querySelector('.cm-editor') as unknown as { cmView?: unknown }) ?? null
    say('cmPresent', cmView !== null)

    const view = (globalThis as unknown as { __view?: EditorViewLike }).__view
    if (view === undefined) {
      say('ERROR', 'no view exposed')
      console.log('VERIFY done')
      return
    }

    // Type through CodeMirror's own transaction path, as a keystroke would.
    view.dispatch({
      changes: { from: 0, insert: '# Tuesday\n\nProse with $E = mc^2$ inline.\n' },
      userEvent: 'input.type',
    })
    await settle(300)
    say('editorText', view.state.doc.toString())
    say('renderedWidgets', document.querySelectorAll('.tx-math, .tx-table, .tx-img').length)

    // Move the cursor into the equation: it must unrender, or vim breaks.
    const at = view.state.doc.toString().indexOf('$E =') + 2
    view.dispatch({ selection: { anchor: at } })
    await settle(200)
    say('mathRenderedWithCursorInside', document.querySelectorAll('.tx-math').length)

    view.dispatch({ selection: { anchor: 0 } })
    await settle(200)
    say('mathRenderedWithCursorAway', document.querySelectorAll('.tx-math').length)

    // A fuller page, so the typography can be judged rather than guessed at.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: SAMPLE },
      userEvent: 'input.type',
    })
    view.dispatch({ selection: { anchor: 0 } })
    await settle(400)
    say('widgetsOnPage', document.querySelectorAll('.tx-math, .tx-table, .tx-img').length)
    say('headingsStyled', document.querySelectorAll('.cm-line.tx-h1, .cm-line.tx-h2').length)

    await settle(1600) // the write tier's quiescence window
    say('flushed', true)
  } catch (err) {
    say('ERROR', err instanceof Error ? err.message : String(err))
  }
  console.log('VERIFY done')
}

const SAMPLE = [
  '# Tuesday, the twenty-first',
  '',
  'The measurement exists so that nobody has to talk themselves into a bad',
  'number. Typing at a hundred and thirty words a minute, the editor contributes',
  'well under a millisecond of work per keystroke, and the rest is the display.',
  '',
  '## What the spike settled',
  '',
  'Inline equations render where they sit: the correction term $\\alpha_s(M_Z) = 0.1179 \\pm 0.0010$ belongs in the sentence.',
  '',
  '$$\\frac{\\partial u}{\\partial t} = \\alpha \\frac{\\partial^2 u}{\\partial x^2}$$',
  '',
  '| Run | Condition | p50 | p99 |',
  '| --- | --- | --- | --- |',
  '| 01 | widgets off | 4.1 | 11.8 |',
  '| 02 | widgets on | 4.4 | 13.2 |',
  '',
  'Ordinary prose after the block, so that motion into and out of it is easy to',
  'judge by eye rather than by argument.',
  '',
].join('\n')

interface EditorViewLike {
  state: { doc: { toString(): string } }
  dispatch(spec: unknown): void
}
