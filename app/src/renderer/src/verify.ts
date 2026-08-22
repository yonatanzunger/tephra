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

    if (scene === 'spacing') {
      const at = view.state.selection.main.head
      view.dispatch({
        changes: {
          from: at,
          insert: [
            'A paragraph that has been hard-wrapped by hand, the way a person',
            'types when they are not thinking about it, so that several lines',
            'belong to one thought and should read as one block.',
            '',
            'A second paragraph, separated by a blank line, which should feel',
            'distinctly further away than the line above it did.',
            '',
          ].join('\n'),
        },
        userEvent: 'input.type',
      })
      await settle(500)
      const lines = [...document.querySelectorAll('.cm-line')].map(el => ({
        blank: el.classList.contains('tx-blank'),
        end: el.classList.contains('tx-para-end'),
        height: Math.round(el.getBoundingClientRect().height),
      }))
      say('lineBoxes', lines.slice(0, 8))
    }

    if (scene === 'frame') {
      // D42's guarantee, measured in the real app rather than in a proof sheet:
      // toggling the nav or the capture stream must move nothing. Position AND
      // width, because the studies once certified an arrangement as steady on
      // the left edge alone while its measure narrowed by 200px.
      const geometry = (): { left: number; width: number } => {
        const content = document.querySelector('.cm-content')
        if (content === null) return { left: -1, width: -1 }
        const box = content.getBoundingClientRect()
        // The measure is the content box; the reserved gutter is padding, and
        // counting it as text would hide exactly the failure being looked for.
        const style = getComputedStyle(content)
        return {
          left: Math.round(box.left),
          width: Math.round(box.width - parseFloat(style.paddingRight)),
        }
      }

      const press = (label: string): void => {
        const button = [...document.querySelectorAll('.titlebar button')].find(
          b => (b.textContent ?? '').includes(label),
        ) as HTMLButtonElement | undefined
        if (button === undefined || button.disabled) {
          say('cannotPress', { label, present: button !== undefined })
          return
        }
        button.click()
      }

      const frame = document.querySelector('.frame') as HTMLElement | null
      const reading = document.querySelector('.frame-reading') as HTMLElement | null
      const contentEl = document.querySelector('.cm-content') as HTMLElement | null
      const app = document.querySelector('.app') as HTMLElement | null
      say('geometryInputs', {
        inner: window.innerWidth,
        app: Math.round(app?.getBoundingClientRect().width ?? -1),
        streamMax: (globalThis as unknown as { __metrics?: { streamMax: number } }).__metrics?.streamMax ?? 'unset',
        frame: Math.round(frame?.getBoundingClientRect().width ?? -1),
        readingInner: reading === null ? -1 : Math.round(reading.clientWidth - 2 * parseFloat(getComputedStyle(reading).paddingLeft)),
        measureVar: frame?.style.getPropertyValue('--measure') ?? '',
        gutterVar: frame?.style.getPropertyValue('--gutter') ?? '',
        folded: frame?.dataset.gutter ?? '',
        contentBox: contentEl === null ? -1 : Math.round(contentEl.getBoundingClientRect().width),
      })
      say('navShown', geometry())

      press('Sections')
      await settle(300)
      say('navHidden', geometry())
      say('navSlotStillSpends', {
        width: Math.round(
          document.querySelector('.frame-nav-slot')?.getBoundingClientRect().width ?? -1,
        ),
      })

      press('Sections')
      await settle(300)
      say('navShownAgain', geometry())

      const streamButton = [...document.querySelectorAll('.titlebar button')].find(
        b => (b.textContent ?? '').includes('Stream'),
      ) as HTMLButtonElement | undefined
      say('streamOffered', streamButton?.disabled === false)

      press('Stream')
      await settle(300)
      say('streamOpen', geometry())
      say('streamColumn', {
        width: Math.round(
          document.querySelector('.frame-stream')?.getBoundingClientRect().width ?? 0,
        ),
      })

      // And the gutter must still be inside the reading area, which is the
      // failure the width check alone would miss.
      if (contentEl !== null && reading !== null) {
        say('gutterPastEdge', Math.round(
          contentEl.getBoundingClientRect().right -
            (reading.getBoundingClientRect().right - parseFloat(getComputedStyle(reading).paddingRight)),
        ))
      }

      press('Stream')
      await settle(300)
      say('streamClosed', geometry())

      // The default window is too narrow for the stream to be offered at all,
      // so widen it and run the same checks where the answer is different. A
      // rule that has only ever been exercised on its refusing branch is a rule
      // nobody has tested.
      // resizeTo is clamped to the display, so the harness launches a second
      // time at a width this screen does not have rather than asking for one.
      await settle(200)
      say('wideWindow', { inner: window.innerWidth })
      say('wideNavShown', geometry())

      const wideButton = [...document.querySelectorAll('.titlebar button')].find(
        b => (b.textContent ?? '').includes('Stream'),
      ) as HTMLButtonElement | undefined
      say('wideStreamOffered', wideButton?.disabled === false)

      press('Stream')
      await settle(400)
      say('wideStreamOpen', geometry())
      say('wideStreamColumn', {
        width: Math.round(
          document.querySelector('.frame-stream')?.getBoundingClientRect().width ?? 0,
        ),
      })
      if (contentEl !== null && reading !== null) {
        say('widePastEdge', Math.round(
          contentEl.getBoundingClientRect().right -
            (reading.getBoundingClientRect().right - parseFloat(getComputedStyle(reading).paddingRight)),
        ))
      }

      press('Sections')
      await settle(300)
      say('wideStreamOpenNavHidden', geometry())

      press('Stream')
      await settle(300)
      say('wideStreamClosed', geometry())
    }

    if (scene === 'streamon') {
      const button = [...document.querySelectorAll('.titlebar button')].find(
        b => (b.textContent ?? '').includes('Stream'),
      ) as HTMLButtonElement | undefined
      say('streamDisabled', button?.disabled ?? 'missing')
      button?.click()
      await settle(400)
      const panel = document.querySelector('.frame-stream')
      const content = document.querySelector('.cm-content')
      say('overlay', {
        width: Math.round(panel?.getBoundingClientRect().width ?? -1),
        covering: (panel as HTMLElement | null)?.dataset.covering ?? '',
        textLeft: Math.round(content?.getBoundingClientRect().left ?? -1),
      })
      await settle(4000)
    }

    if (scene === 'navoff') {
      // Dismiss the nav and hold, so a screenshot can show what the reserved
      // column looks like when nothing is drawn in it. Reported as "a vertical
      // stripe of coloration left behind, which looks wrong".
      const button = [...document.querySelectorAll('.titlebar button')].find(
        b => (b.textContent ?? '').includes('Sections'),
      ) as HTMLButtonElement | undefined
      button?.click()
      await settle(400)
      const slot = document.querySelector('.frame-nav-slot')
      const reading = document.querySelector('.frame-reading')
      say('whatShowsThere', {
        slotVisibility: slot === null ? 'missing' : getComputedStyle(slot).visibility,
        frameGround: getComputedStyle(document.querySelector('.frame') as Element).backgroundColor,
        readingGround: reading === null ? '' : getComputedStyle(reading).backgroundColor,
      })
      await settle(4000)
    }

    if (scene === 'today') {
      // Reported: pressing `today` blanks the whole screen. Catch what the click
      // handler throws away — App calls `void pane.goToToday()`, so a rejection
      // there disappears without trace.
      const failures: string[] = []
      addEventListener('unhandledrejection', e => failures.push(String(e.reason)))
      addEventListener('error', e => failures.push(String(e.message)))

      say('before', {
        docLength: view.state.doc.length,
        location: pane.location,
        firstLine: view.state.doc.toString().slice(0, 40),
      })

      const today = [...document.querySelectorAll('.titlebar button')].find(
        b => (b.textContent ?? '').trim() === 'today',
      ) as HTMLButtonElement | undefined
      today?.click()
      await settle(1500)

      const state = (label: string): void => {
        const v = (globalThis as unknown as { __view?: EditorViewLike }).__view
        say(label, {
          docLength: v?.state.doc.length ?? -1,
          location: pane.location,
          lines: document.querySelectorAll('.cm-line').length,
          contentWidth: Math.round(
            document.querySelector('.cm-content')?.getBoundingClientRect().width ?? -1,
          ),
        })
      }

      // The path actually reported: pick a day from the nav, then press today.
      const navDate = document.querySelectorAll('.nav-dates button')[1] as HTMLButtonElement | undefined
      say('navDateLabel', navDate?.textContent ?? 'none')
      navDate?.click()
      await settle(1200)
      state('afterNavDate')

      today?.click()
      await settle(1200)
      state('afterTodayFromDate')

      today?.click()
      await settle(1200)
      state('afterTodayAgain')

      const live = (globalThis as unknown as { __view?: EditorViewLike }).__view
      say('after', {
        docLength: live?.state.doc.length ?? -1,
        location: pane.location,
        firstLine: live?.state.doc.toString().slice(0, 40) ?? '',
        editorsInDom: document.querySelectorAll('.cm-editor').length,
        linesInDom: document.querySelectorAll('.cm-line').length,
      })
      say('failures', failures)
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
