// Scene-driven self-check, used by scripts/m0-acceptance.mjs.
//
// Each scene drives the REAL app — the real editor, Pane, bridge, X and W — and
// prints what it found. Two launches against one notebook is the only way to
// test what M0 actually claims: that nothing is lost across a quit.

export async function runVerify(request: string): Promise<void> {
  // **A scene may carry one argument, after a `|`.** Some claims are about a
  // path the harness made up — a file outside the notebook, whose location is
  // a temporary directory — and the scene cannot know it any other way.
  const [scene = '', arg = ''] = request.split('|')
  // **Every window runs this, so every window has to say which it is.** A
  // scene that opens a second window would otherwise get two of every answer,
  // indistinguishable in the log. The first window reports unprefixed, because
  // it is the one every existing scene is written about (MC6).
  const me = (globalThis as unknown as { __tephra: { id: number } }).__tephra
  const mine = (key: string): string => (me.id <= 1 ? key : `w${me.id}.${key}`)
  const say = (key: string, value: unknown): void =>
    console.log(`VERIFY ${mine(key)}: ${JSON.stringify(value)}`)
  const settle = (ms = 200): Promise<void> => new Promise(r => setTimeout(r, ms))

  /**
   * Wait for something to be true, rather than for long enough that it is.
   *
   * **A fixed wait is a guess about the slowest machine.** It costs that guess
   * on every machine, and it is still wrong on a slower one — which is how a
   * suite comes to take minutes and to fail under load at the same time. This
   * returns as soon as the thing has happened and gives up at the point where
   * waiting longer would be waiting for something that is not coming.
   */
  const until = async (ready: () => boolean, capMs = 8000): Promise<boolean> => {
    for (let waited = 0; waited < capMs; waited += 50) {
      if (ready()) return true
      await settle(50)
    }
    return ready()
  }

  /** The live view, asked for each time: navigation rebinds the surface. */
  const live = (): EditorViewLike =>
    (globalThis as unknown as { __tephra: { view: EditorViewLike } }).__tephra.view

  try {
    // Open, bind, restore, and let background growth finish — waited FOR rather
    // than waited OUT. This was a flat 1.8 seconds on every scene in every
    // suite, which is a minute of the acceptance run spent watching a window
    // that was ready in a fifth of it.
    //
    // A todo window has no editor view (it is not CodeMirror), so its surface
    // being on screen counts as ready too — otherwise the one window that is
    // not prose would wait out the whole cap before reporting what it is.
    const booted = (): boolean => {
      const h = (globalThis as unknown as { __tephra?: { view?: unknown; pane?: unknown } }).__tephra
      if (h?.pane === undefined || h.pane === null) return false
      return (h.view !== undefined && h.view !== null) || document.querySelector('.todo') !== null
    }
    await until(booted, 6000)
    await settle(250) // and a beat for the first paint to settle

    const handle = (globalThis as unknown as {
      __tephra: { view?: EditorViewLike; pane?: PaneLike }
    }).__tephra
    const view = handle.view
    const pane = handle.pane
    if (pane === undefined || pane === null) {
      say('ERROR', `pane=${pane != null}`)
      if (me.id <= 1) console.log('VERIFY done')
      return
    }

    // A window that is not the first is a PARTICIPANT, not a driver: it reports
    // what it is showing and lets the scene in window 1 do the asking. It never
    // says `done` — ending the run is the first window's to decide.
    if (me.id > 1) {
      if (scene === 'capture') {
        // The list, opened because somebody asked for a task, with the row for
        // it already waiting — prefilled from the selection the first time,
        // empty the second, and abandoned with Escape.
        const row = (): HTMLInputElement | null =>
          document.querySelector('.todo-adding .todo-field') as HTMLInputElement | null
        const key = (k: string): void => {
          row()?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
        }
        await until(() => row() !== null, 8000)
        say('surface', document.querySelector('.todo') !== null)
        say('rowOpen', row() !== null)
        say('prefilled', row()?.value ?? '')
        // `arg` says which half is being driven: committed, or abandoned.
        key(arg === 'escape' ? 'Escape' : 'Enter')
        await settle(2500)
        say('rowGone', row() === null)
        say('leftBehind', document.querySelectorAll('.todo-row:not(.todo-adding)').length)
        await settle(2500)
        return
      }
      say('name', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('text', live().state.doc.toString())
      // And again later, so that a change window 1 makes to the SAME document
      // can be seen arriving here — which is the whole claim (D45, MC6).
      await settle(6000)
      say('nameLater', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('textLater', live().state.doc.toString())
      return
    }

    // **The driver needs an editor; a participant does not.** A todo window has
    // no CodeMirror view and never will, and requiring one made every such
    // window report a failure and stop before it could say anything.
    if (view === undefined || view === null) {
      say('ERROR', 'this window has no editor to drive')
      console.log('VERIFY done')
      return
    }

    if (scene === 'windows') {
      // MC6: a window is a VIEW on a document, and the set of them is the
      // session. Open a note in a second window and leave it open; what the
      // next launch finds is the other half of the claim.
      const documents = await window.tephra.nav.documents()
      say('documents', documents.map(d => d.title))
      const note = documents.find(d => (d.id as unknown as string).endsWith('offer.md'))
      say('noteFound', note !== undefined)
      if (note !== undefined) {
        await window.tephra.win.create({ kind: 'document', id: note.id })
      }
      await settle(2500)
      say('titleHere', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      // Long enough for the second window to boot, report, and be saved.
      await settle(3000)
    }

    if (scene === 'windows-back') {
      // The session came back. This window is the stream; the other is the note
      // (window 2 reports for itself, under `w2.`).
      say('titleHere', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('textHere', live().state.doc.toString())

      // **The same document in two windows.** Both are views on one document in
      // main, so an edit here has to arrive there without either window being
      // told about the other (D45, through the Corpus).
      const documents = await window.tephra.nav.documents()
      const note = documents.find(d => (d.id as unknown as string).endsWith('offer.md'))
      if (note !== undefined) {
        await pane.goTo({ kind: 'document', id: note.id })
        await settle(1200)
        live().dispatch({
          changes: { from: live().state.doc.length, insert: ' Countersigned.' },
          userEvent: 'input.type',
        })
        await settle(1200)
        say('typedHere', live().state.doc.toString())
      }
      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(4000) // let the other window report what it now shows
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
      const setVim = (globalThis as unknown as { __setVim?: (v: boolean) => void }).__setVim
      setVim?.(true)
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

    if (scene === 'undo') {
      // Undo moved from a keydown listener to Edit ▸ Undo. The path is entirely
      // new — menu item, IPC, RemoteDocument — and nothing tested it end to end
      // before, so this drives the real menu item and reads the buffer.
      // Append at the end of the buffer each time. The first version took the
      // caret for the second insert and got the SAME offset as the first,
      // producing "SECOND. FIRST. " — two inverse deletes over overlapping
      // ranges, a shape real typing never makes because the caret advances.
      view.dispatch({
        changes: { from: view.state.doc.length, insert: 'FIRST. ' },
        userEvent: 'input.type',
      })
      await settle(300)
      view.dispatch({
        changes: { from: live().state.doc.length, insert: 'SECOND. ' },
        userEvent: 'input.type',
      })
      await settle(400)
      say('bufferTail', live().state.doc.toString().slice(-22))
      const typed = view.state.doc.toString()
      say('afterTyping', { hasFirst: typed.includes('FIRST.'), hasSecond: typed.includes('SECOND.') })

      await window.tephra.doc.flush()
      say('flushedAfterTyping', true)
      await settle(300)

      say('undoItemFound', await window.tephra.clickMenu('Undo'))
      await settle(900)
      const once = live()?.state.doc.toString() ?? ''
      say('afterUndo', { hasFirst: once.includes('FIRST.'), hasSecond: once.includes('SECOND.') })

      // Is it the menu path, or is undo itself not reaching the buffer? Call the
      // same method the menu's handler calls, directly.
      await window.tephra.doc.flush()
      say('flushedAfterUndo', true)

      const docHandle = (globalThis as unknown as {
        __tephra: { doc?: { undo(): Promise<unknown> } }
      }).__tephra.doc
      say('directUndoAvailable', docHandle !== undefined && docHandle !== null)
      if (docHandle !== undefined && docHandle !== null) {
        await docHandle.undo()
        await settle(900)
        const direct = live()?.state.doc.toString() ?? ''
        say('afterDirectUndo', { hasFirst: direct.includes('FIRST.'), hasSecond: direct.includes('SECOND.') })
      }

      say('redoItemFound', await window.tephra.clickMenu('Redo'))
      await settle(900)
      const back = live()?.state.doc.toString() ?? ''
      say('afterRedo', { hasFirst: back.includes('FIRST.'), hasSecond: back.includes('SECOND.') })
    }

    if (scene === 'hebrew') {
      // Does size-adjust actually reach the glyphs? Measure a Hebrew string and
      // a Latin one at two scales: Hebrew must grow by the ratio, Latin must not
      // move at all. Anything else means the unicode-range is wrong and the rule
      // is applying to the whole page.
      const probe = (text: string): number => {
        const span = document.createElement('span')
        span.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:20px'
        span.style.fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-body')
        span.textContent = text
        document.body.appendChild(span)
        const width = span.getBoundingClientRect().width
        span.remove()
        return width
      }
      const HEB = 'בראשית ברא אלהים'
      const LAT = 'In the beginning'

      const setScale = (value: number): void => {
        const set = (globalThis as unknown as { __setHebrewScale?: (n: number) => void })
          .__setHebrewScale
        set?.(value)
      }

      setScale(100)
      await settle(700)
      const base = { hebrew: probe(HEB), latin: probe(LAT) }
      say('atHundred', { hebrew: Math.round(base.hebrew), latin: Math.round(base.latin) })

      setScale(130)
      await settle(700)
      const grown = { hebrew: probe(HEB), latin: probe(LAT) }
      say('atOneThirty', { hebrew: Math.round(grown.hebrew), latin: Math.round(grown.latin) })
      say('ratios', {
        hebrew: Number((grown.hebrew / base.hebrew).toFixed(3)),
        latin: Number((grown.latin / base.latin).toFixed(3)),
      })
      say('familyInUse', getComputedStyle(document.documentElement).getPropertyValue('--font-body').slice(0, 40))
    }

    if (scene === 'lifecycle') {
      // New, rename, copy, delete — through the real menu items, which is where
      // the accelerators live and what a keystroke actually reaches.
      let waited = 0
      while (waited < 25_000 && document.querySelectorAll('.nav-row').length < 1) {
        await settle(200)
        waited += 200
      }
      const row = [...document.querySelectorAll('.nav-row')].find(r =>
        (r.textContent ?? '').includes('offer'),
      ) as HTMLElement | undefined
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(1400)
      say('opened', document.querySelector('.titlebar .title')?.textContent ?? '')

      const type = async (value: string): Promise<void> => {
        const input = document.querySelector('.prompt input') as HTMLInputElement | null
        if (input === null) return
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(120)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1400)
      }

      say('renameClicked', await window.tephra.clickMenu('Rename…'))
      await settle(600)
      say('renamePrefilled', (document.querySelector('.prompt input') as HTMLInputElement | null)?.value ?? '')
      await type('Counter offer')
      say('titleAfterRename', document.querySelector('.titlebar .title')?.textContent ?? '')

      say('copyClicked', await window.tephra.clickMenu('Save a Copy…'))
      await settle(600)
      await type('Second thoughts')
      // Save a Copy leaves you where you were — that is what the name means.
      say('titleAfterCopy', document.querySelector('.titlebar .title')?.textContent ?? '')

      say('deleteClicked', await window.tephra.clickMenu('Delete…'))
      await settle(600)
      say('confirmShown', document.querySelector('.prompt [role], .prompt-actions .destructive') !== null)
      ;(document.querySelector('.prompt-actions .destructive') as HTMLElement | null)?.click()
      await settle(1600)
      say('titleAfterDelete', document.querySelector('.titlebar .title')?.textContent ?? '')

      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'migrated') {
      // A notebook that was `stream/` yesterday and `notebook.stream/` today
      // opens, finds its days, and shows the prose that was in them (MT1, D59).
      // The migration is a directory rename; this is the claim that the rename
      // is all it is.
      let waited = 0
      while (waited < 25_000 && document.querySelectorAll('.nav-row').length < 1) {
        await settle(200)
        waited += 200
      }
      say('title', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('prose', (document.querySelector('.cm-content')?.textContent ?? '').slice(0, 60))
      say('days', [...document.querySelectorAll('.nav-row')]
        .map(r => (r.querySelector('.nav-label')?.textContent ?? ''))
        .filter(t => /^\d/.test(t)))
      say('notes', [...document.querySelectorAll('.nav-row')]
        .some(r => (r.textContent ?? '').includes('offer')))
      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'todo') {
      // The list, driven the way a person drives it — but navigated to rather
      // than opened from the menu. **⌘1 opens a window of its own** (a person
      // works with the list beside their writing, not instead of it), and a
      // scene runs in window 1: the menu item is checked separately, below.
      say('opened', await window.tephra.todo.which())
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 8000 && document.querySelector('.todo') === null) {
        await settle(200)
        waited += 200
      }
      await settle(600)
      say('title', document.querySelector('.titlebar .title')?.textContent ?? '')

      const rows = (): readonly HTMLElement[] =>
        [...document.querySelectorAll('.todo-row')] as HTMLElement[]
      const texts = (): readonly string[] =>
        rows().map(r => r.querySelector('.todo-text')?.textContent ?? '')

      say('carried', texts())
      // Drawn, not typed: a character in a box takes the text's face and its
      // own idea of where the middle is, and six of them line up six ways.
      say('marksDrawn', document.querySelectorAll('.todo-glyph svg.todo-mark').length)
      // The list is set in the notebook's own type (D41), not a second set of
      // numbers that the theme panel's sliders do not reach.
      const surface = document.querySelector('.todo') as HTMLElement | null
      const prose2 = document.querySelector('.cm-content') as HTMLElement | null
      say('type', {
        list: getComputedStyle(surface as Element).fontSize,
        listFace: getComputedStyle(surface as Element).fontFamily,
        prose: prose2 === null ? null : getComputedStyle(prose2).fontSize,
      })
      say('band', [...document.querySelectorAll('.todo-soon-item')].map(
        b => b.querySelector('.todo-when')?.textContent ?? '',
      ))
      say('tags', [...document.querySelectorAll('.todo-tag')].map(t => t.textContent ?? ''))
      say('dues', [...document.querySelectorAll('.todo-due')].map(d => d.textContent ?? ''))
      say('links', [...document.querySelectorAll('.todo-text .tx-link')].map(a2 => a2.textContent ?? ''))

      // **A click advances one step.** Not started, then in progress, then done
      // — and the row stays where it was, greyed, which is the paper page's X.
      const glyph = (): HTMLElement | null => rows()[0]?.querySelector('.todo-glyph') ?? null
      glyph()?.click()
      await settle(1000)
      say('afterOneClick', rows()[0]?.className.replace(/.*status-(\w+).*/, '$1') ?? '')
      glyph()?.click()
      await settle(1000)
      say('afterTwoClicks', rows()[0]?.className.replace(/.*status-(\w+).*/, '$1') ?? '')
      say('afterCheck', texts())
      say('finished', rows().map(r => r.className.includes('finished')))

      // The other three statuses are on the right-click menu.
      rows()[2]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))
      await settle(400)
      say('statusMenu', [...document.querySelectorAll('.row-menu button')].map(b => b.textContent ?? ''))
      ;([...document.querySelectorAll('.row-menu button')].find(
        b => (b.textContent ?? '').startsWith('Backlogged'),
      ) as HTMLElement | null)?.click()
      await settle(1200)
      say('afterBacklog', rows()[2]?.className.replace(/.*status-(\w+).*/, '$1') ?? '')

      const type = async (selector: string, value: string): Promise<void> => {
        const input = document.querySelector(selector) as HTMLInputElement | null
        if (input === null) return
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(120)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1400)
      }

      // The row edit commits once — text, tags and date together (D56).
      ;(rows()[1]?.querySelector('.todo-text') as HTMLElement | null)?.click()
      await settle(400)
      say('editingRaw', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? '')

      // **The typist's assistant** (T16): a `#` offers the tags that have live
      // items, and the date buttons write what typing would have written.
      const field = document.querySelector('.todo-field') as HTMLInputElement | null
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(field, 'read the survey #')
      field?.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(400)
      say('completions', [...document.querySelectorAll('.todo-complete button')].map(b => b.textContent ?? ''))

      // **From the keyboard**: down moves the highlight, Tab takes it. Reaching
      // for the mouse to accept a suggestion costs more than typing the tag
      // would have, which makes the assistant slower than the thing it assists.
      const key = (k: string): void => {
        document.querySelector('.todo-field')?.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
        )
      }
      key('ArrowDown')
      await settle(200)
      say('picked', document.querySelector('.todo-complete button.picked')?.textContent ?? '')
      key('Escape')
      await settle(200)
      say('escapeHidesTheList', document.querySelector('.todo-complete') === null)
      say('escapeKeptTheLine', document.querySelector('.todo-field') !== null)

      // Ask for it again and take it with Tab.
      const again = document.querySelector('.todo-field') as HTMLInputElement | null
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(again, 'read the survey #te')
      again?.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(300)
      // Which way the list runs, measured by where its options SIT: up and down
      // are what move through it, so it has to go down the page.
      {
        const opts = [...document.querySelectorAll('.todo-complete button')].map(b =>
          b.getBoundingClientRect(),
        )
        say('listRuns', opts.length < 2 ? 'one' : (opts[1] as DOMRect).top > (opts[0] as DOMRect).top ? 'down' : 'across')
      }
      key('Tab')
      await settle(300)
      say('afterTab', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? '')
      // **And again.** A controlled input keeps its selection where it was when
      // the value is set from code, and the render-time caret does not move
      // with it — so a second Tab completed the same fragment again:
      // `#t` → `#tephra` → `#tephraephra`.
      key('Tab')
      await settle(300)
      say('afterTabTwice', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? '')

      // **A completed tag is a finished tag, so the list goes away.** It went on
      // matching what had just been written into it — `#term` is still a prefix
      // of `term` — so it stayed open over a tag that was already whole. Only
      // observed here: pressing Return to prove the consequence would commit
      // the row the rest of this scene is still measuring, and it is proved at
      // the end instead.
      say('listAfterTaking', document.querySelector('.todo-complete') === null)

      ;(document.querySelectorAll('.todo-tools button')[1] as HTMLElement | null)?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      )
      await settle(400)
      ;([...document.querySelectorAll('.todo-dates button')].find(
        b => (b.textContent ?? '') === 'tomorrow',
      ) as HTMLElement | null)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await settle(400)
      say('afterDateButton', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? '')

      await type('.todo-field', 'read the survey properly #house DUE FRIDAY')
      say('afterEdit', texts())
      say('afterEditTags', [...document.querySelectorAll('.todo-tag')].map(t => t.textContent ?? ''))

      ;(document.querySelector('.todo-add') as HTMLElement | null)?.click()
      await settle(300)
      await type('.todo-field', 'ring the bank #money')
      say('afterAdd', texts())

      // **Straight-up delete**, for a line that was never a task. Not
      // *nevermind*, which is a decision and stays on the list saying so.
      const last = rows()[rows().length - 1]
      last?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))
      await settle(400)
      say('menuHasDelete', [...document.querySelectorAll('.row-menu button')].some(
        b => (b.textContent ?? '') === 'Delete',
      ))
      ;([...document.querySelectorAll('.row-menu button')].find(
        b => (b.textContent ?? '') === 'Delete',
      ) as HTMLElement | null)?.click()
      await settle(1400)
      say('afterDelete', texts())

      // Where the ink sits between the rules. A line box carries its leading
      // above and below, and an eye judges a line by its x-height band — so
      // "centred" means the ink set a shade BELOW the middle.
      {
        const row = document.querySelector('.todo-row') as HTMLElement | null
        const span = document.querySelector('.todo-text') as HTMLElement | null
        const range = document.createRange()
        if (span !== null) range.selectNodeContents(span)
        const ink = range.getBoundingClientRect()
        const box = row?.getBoundingClientRect()
        const mark = document.querySelector('.todo-mark')?.getBoundingClientRect()
        say('rhythm', {
          above: Math.round(ink.top - (box?.top ?? 0)),
          below: Math.round((box?.bottom ?? 0) - ink.bottom),
          // The mark rides up out of the geometric centre to meet the words.
          markAbove: Math.round((mark?.top ?? 0) - (box?.top ?? 0)),
        })
      }

      // Typing anywhere on the list starts an item: no button to find first.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }))
      await settle(500)
      say('typedToAdd', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? null)
      {
        const rowBox = document.querySelectorAll('.todo-row:not(.todo-adding)')[0]?.getBoundingClientRect()
        const addBox = document.querySelector('.todo-adding')?.getBoundingClientRect()
        const rail = document.querySelector('.todo-soon')?.getBoundingClientRect()
        const col = document.querySelector('.todo-column')?.getBoundingClientRect()
        say('addRow', {
          rowH: Math.round(rowBox?.height ?? -1),
          addH: Math.round(addBox?.height ?? -1),
          rowMark: Math.round(document.querySelector('.todo-row:not(.todo-adding) .todo-glyph')?.getBoundingClientRect().left ?? -1),
          addMark: Math.round(document.querySelector('.todo-adding .todo-glyph')?.getBoundingClientRect().left ?? -1),
        })
        say('railRight', (rail?.left ?? 0) >= (col?.right ?? 0))
      }
      document.querySelector('.todo-field')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
      await settle(400)

      // **An item with no words is still an item**, and the whole row is what
      // you click to give it some: the text used to be a button that collapsed
      // to nothing, leaving no way back into the line.
      const empty = await window.tephra.todo.add(await window.tephra.todo.which(), ' ')
      void empty
      await settle(1200)
      const blank = rows().find(r => (r.textContent ?? '').includes('Nothing written yet'))
      say('emptyShown', blank !== undefined)
      blank?.click()
      await settle(400)
      say('emptyEditable', document.querySelector('.todo-field') !== null)
      await type('.todo-field', 'the thing I could not name')
      say('afterNaming', texts().some(t => t.includes('could not name')))

      // **Return twice, which is what typing a line ending in a tag actually
      // is**: once to take the suggestion, once to say that is the item. It
      // used to be impossible — the list stayed open over a tag it had just
      // completed, so the second Return was eaten as "accept" like the first.
      ;(document.querySelector('.todo-add') as HTMLElement | null)?.click()
      await settle(300)
      {
        const fresh = document.querySelector('.todo-field') as HTMLInputElement | null
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          fresh,
          'paint the shed #te',
        )
        fresh?.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await settle(400)
      say('enterOffered', [...document.querySelectorAll('.todo-complete button')].map(b => b.textContent ?? ''))
      key('Enter')
      await settle(400)
      say('firstEnterTook', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? '')
      say('andClosedTheList', document.querySelector('.todo-complete') === null)
      key('Enter')
      await settle(700)
      say('secondEnterCommitted', document.querySelector('.todo-field') === null)
      say('enterEnterRows', texts())

      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'todo-look') {
      // Open the list and start adding, so a screenshot shows the geometry.
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      await settle(1200)
      // Just type: no button to find, no field to open first.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }))
      await settle(500)
      say('typedToAdd', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? null)
      {
        const rowBox = document.querySelectorAll('.todo-row')[0]?.getBoundingClientRect()
        const addBox = document.querySelector('.todo-adding')?.getBoundingClientRect()
        const rail = document.querySelector('.todo-soon')?.getBoundingClientRect()
        const col = document.querySelector('.todo-column')?.getBoundingClientRect()
        say('rowVsAdd', {
          rowH: Math.round(rowBox?.height ?? -1),
          addH: Math.round(addBox?.height ?? -1),
          rowMark: Math.round(document.querySelectorAll('.todo-glyph')[0]?.getBoundingClientRect().left ?? -1),
          addMark: Math.round(document.querySelector('.todo-adding .todo-glyph')?.getBoundingClientRect().left ?? -1),
        })
        say('rail', { left: Math.round(rail?.left ?? -1), colRight: Math.round(col?.right ?? -1) })
        const one = document.querySelector('.todo-soon-item')
        say('railSize', one === null ? '' : getComputedStyle(one).fontSize)
      }
      // Complete a tag from the keyboard, twice, and see which way the list runs.
      {
        const f = document.querySelector('.todo-field') as HTMLInputElement | null
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        set?.call(f, 'write the thing #t')
        f?.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(300)
        const tab = (): void => {
          f?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
        }
        const opts = [...document.querySelectorAll('.todo-complete button')].map(b =>
          b.getBoundingClientRect(),
        )
        say('listRuns', opts.length < 2 ? '' : (opts[1] as DOMRect).top > (opts[0] as DOMRect).top ? 'down' : 'across')
        tab()
        await settle(300)
        say('afterTab', f?.value ?? '')
        tab()
        await settle(300)
        say('afterTabTwice', f?.value ?? '')
      }
      say('marks', document.querySelectorAll('.todo-mark').length)
      // Where the INK sits between the rules, which is what "centred" means to
      // an eye: a line box has leading above and below, and a serif's
      // ascenders outrun its descenders, so a centred box looks high.
      {
        const row = document.querySelector('.todo-row') as HTMLElement | null
        const span = document.querySelector('.todo-text') as HTMLElement | null
        const range = document.createRange()
        if (span !== null) range.selectNodeContents(span)
        const ink = range.getBoundingClientRect()
        const box = row?.getBoundingClientRect()
        const mark = document.querySelector('.todo-mark')?.getBoundingClientRect()
        say('rhythm', {
          above: Math.round((ink.top - (box?.top ?? 0)) * 10) / 10,
          below: Math.round(((box?.bottom ?? 0) - ink.bottom) * 10) / 10,
          markAbove: Math.round(((mark?.top ?? 0) - (box?.top ?? 0)) * 10) / 10,
          markBelow: Math.round(((box?.bottom ?? 0) - (mark?.bottom ?? 0)) * 10) / 10,
        })
      }
      const g = document.querySelector('.todo-glyph')?.getBoundingClientRect()
      const t = document.querySelector('.todo-text')?.getBoundingClientRect()
      say('markSize', Math.round(g?.height ?? -1))
      say('markVsText', { markTop: Math.round(g?.top ?? -1), textTop: Math.round(t?.top ?? -1) })
      say('fontSize', getComputedStyle(document.querySelector('.todo') as Element).fontSize)
      say('editorFont', getComputedStyle(document.querySelector('.todo') as Element).fontFamily.slice(0, 24))
      // Type a `#` and see what completion offers, then open the date popup.
      const input = document.querySelector('.todo-field') as HTMLInputElement | null
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'plan the term #')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(400)
      say('completions', [...document.querySelectorAll('.todo-complete button')].map(b => b.textContent ?? ''))
      ;(document.querySelectorAll('.todo-tools button')[1] as HTMLElement | null)?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      )
      await settle(400)
      say('dateChoices', [...document.querySelectorAll('.todo-dates button')].map(b => b.textContent ?? ''))
      const box = document.querySelector('.todo-field')?.getBoundingClientRect()
      const rowBox = document.querySelector('.todo-row')?.getBoundingClientRect()
      say('fieldWidth', Math.round(box?.width ?? -1))
      say('fieldLeft', Math.round(box?.left ?? -1))
      say('rowLeft', Math.round(rowBox?.left ?? -1))
      say('paneLeft', Math.round(document.querySelector('.todo')?.getBoundingClientRect().left ?? -1))
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
    }

    if (scene === 'capture') {
      // A thought arrives mid-sentence and has to reach the list without
      // leaving the sentence it arrived in (T13).
      const view = live()
      const text = view.state.doc.toString()
      const at = text.indexOf('call the surveyor')
      view.dispatch({ selection: { anchor: at, head: at + 'call the surveyor about the boundary'.length } })
      await settle(400)
      say('selected', text.slice(view.state.selection.main.from, view.state.selection.main.to))

      // **Both paths open the row**, so nothing is created here: the list
      // window commits it, and the link comes back afterwards.
      const before = view.state.doc.toString()
      say('clicked', await window.tephra.clickMenu('Task\u2026'))
      // Waited FOR: the other window has to boot, claim, settle, and send the
      // answer back before there is anything here to look at.
      await until(() => view.state.doc.toString() !== before, 12_000)
      await settle(1500)
      say('proseUntouched', view.state.doc.toString() === before)
      const list = await window.tephra.todo.which()
      const today = await window.tephra.todo.today(list)
      say('items', (await window.tephra.todo.items(list, today)).map(i => i.text))
      say('prose', view.state.doc.toString().replace(/\n+/g, ' ').slice(0, 170))

      // **From a bare caret it takes you to the list with a row already open**,
      // and writes nothing into the prose. A second window opens, so what this
      // one can check is that its own text was left alone and that the request
      // was made — the row itself is the other window's, and is checked there.
      say('linked', view.state.doc.toString().includes('tephra:todo/'))

      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(500)
    }

    if (scene === 'todo-window') {
      // ⌘1 opens the list in a window of its own and leaves this one where it
      // was — which is the whole of why it is main's action and not a
      // navigation (MC6). **And ⌘0 is the same act**: both mean "there should
      // be a window with this in it, in front".
      const before = document.querySelector('.titlebar .title')?.textContent ?? ''
      say('clicked', await window.tephra.clickMenu('Task List'))
      await settle(2500)
      say('thisWindowStayed', (document.querySelector('.titlebar .title')?.textContent ?? '') === before)
      say('stillShowingProse', document.querySelector('.cm-content') !== null)
      // Asked for twice, it is the same window both times rather than a drift
      // of identical ones.
      say('again', await window.tephra.clickMenu('Task List'))
      await settle(2000)
      say('notebookAgain', await window.tephra.clickMenu('Notebook'))
      await settle(2000)
      say('stillProse', document.querySelector('.cm-content') !== null)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(1200)
    }

    if (scene === 'todolink') {
      // **⌘K in a task row** (ML). A link in a task is half the point of having
      // links at all, and the gesture has to be the notebook's gesture — but
      // the row is an `<input>` and the todo surface honestly reports no editor
      // handle, so the command reached nothing and the menu stayed grey.
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 20_000 && document.querySelectorAll('.todo-row').length < 1) {
        await settle(200)
        waited += 200
      }
      const texts = () =>
        [...document.querySelectorAll('.todo-row')].map(r =>
          (r.querySelector('.todo-text')?.textContent ?? '').trim(),
        )

      ;(document.querySelector('.todo-row') as HTMLElement | null)?.click()
      await settle(500)
      const input = document.querySelector('.todo-field') as HTMLInputElement | null
      say('editing', input !== null)

      // Select two words in the middle, the way a person would.
      const at = (input?.value ?? '').indexOf('surveyor')
      input?.setSelectionRange(at, at + 'surveyor'.length)
      input?.dispatchEvent(new Event('select', { bubbles: true }))
      await settle(400)

      await window.tephra.clickMenu('Link\u2026')
      await settle(700)
      // The row must still be open: the asking takes the focus, and a row that
      // committed while the question was on screen leaves nothing to write to.
      say('rowSurvived', document.querySelector('.todo-field') !== null)
      say('asked', document.querySelector('.prompt') !== null)

      const box = document.querySelector('#prompt-input') as HTMLInputElement | null
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        box,
        'https://example.com/survey',
      )
      box?.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(200)
      box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await settle(600)
      say('afterLink', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? '')

      ;(document.querySelector('.todo-field') as HTMLElement | null)?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
      await settle(900)
      say('committed', texts())
      // And it is a LIVE link in the row, which is what ML1's scanner is for.
      say('links', [...document.querySelectorAll('.todo-row a')].map(a => a.getAttribute('href')))
      // **The rail cannot make a link live**, because a rail row is itself a
      // button that scrolls to the item and an anchor inside a button is both
      // invalid and a second thing to hit. So it shows the label — and it was
      // showing the raw `[text](https://…)`, which is the file being honest in
      // a place nobody asked it to be.
      say('railText', document.querySelector('.todo-soon-text')?.textContent ?? '')
      say('railHasAnchor', document.querySelector('.todo-soon a') !== null)

      // **Emphasis works in a row too, and it is the same gesture** — three
      // cases, the second press taking it off again.
      ;(document.querySelectorAll('.todo-row')[1] as HTMLElement | null)?.click()
      await settle(500)
      {
        const box = document.querySelector('.todo-field') as HTMLInputElement | null
        const from = (box?.value ?? '').indexOf('survey')
        box?.setSelectionRange(from, from + 'survey'.length)
        box?.dispatchEvent(new Event('select', { bubbles: true }))
        await settle(300)
        await window.tephra.clickMenu('Bold')
        await settle(500)
        say('afterBold', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? '')
        await window.tephra.clickMenu('Bold')
        await settle(500)
        say('afterBoldTwice', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? '')
        ;(document.querySelector('.todo-field') as HTMLElement | null)?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
        await settle(400)
      }

      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(800)
    }

    if (scene === 'pills') {
      // **One language, two palettes.** A pill is a label or a control, and the
      // ink is set by whoever shows it — the content area's `--text` or the
      // sidebar and title bar's `--panel-text`. What is checked here is that
      // each pill reads as the kind of thing it IS: labels without an edge,
      // controls with one, and nothing at a size that ignores its context.
      await settle(700)
      const seen = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (el === null) return null
        const css = getComputedStyle(el)
        // **The edge is its COLOUR, not its width.** A label carries a 1px
        // transparent border so that labels and controls have identical
        // metrics and nothing shifts when one becomes the other.
        const clear = (c: string): boolean => /,\s*0\)$/.test(c) || c === 'transparent'
        return {
          size: Math.round(parseFloat(css.fontSize) * 10) / 10,
          edge: clear(css.borderTopColor) ? 'none' : 'edge',
          ink: css.color,
          ground: clear(css.backgroundColor) ? 'none' : css.backgroundColor,
        }
      }
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 20_000 && document.querySelector('.todo-tag') === null) {
        await settle(200)
        waited += 200
      }
      say('todoTag', seen('.todo-tag'))
      // **They sit in the same row and must agree.** Two independent constants
      // is what made them disagree in the first place.
      say('todoDue', seen('.todo-due'))
      // **Where they sit, not just how big they are.** Small type at the top of
      // a 1.72em line box rides visibly above the words it belongs to.
      {
        const row = [...document.querySelectorAll('.todo-row')].find(
          r => r.querySelector('.todo-due') !== null && r.querySelector('.todo-tag') !== null,
        )
        const mid = (sel: string): number | null => {
          const b = row?.querySelector(sel)?.getBoundingClientRect()
          return b === undefined ? null : Math.round(b.top + b.height / 2)
        }
        say('middles', { text: mid('.todo-text'), tag: mid('.todo-tag'), due: mid('.todo-due') })
        const box = (sel: string) => {
          const b = row?.querySelector(sel)?.getBoundingClientRect()
          const css = row?.querySelector(sel) === null || row?.querySelector(sel) === undefined
            ? null : getComputedStyle(row.querySelector(sel) as Element)
          return b === undefined ? null : {
            top: Math.round(b.top), h: Math.round(b.height * 10) / 10,
            mt: css?.marginTop, lh: css?.lineHeight, d: css?.display,
          }
        }
        say('boxes', { tags: box('.todo-tags'), tag: box('.todo-tag'), due: box('.todo-due') })
      }

      await pane.goTo({ kind: 'links' })
      await settle(900)
      say('linkSource', seen('.links-source'))
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'linkdir') {
      // **A window's location that is not a document** (ML3). Everything around
      // it is unchanged — frame, sidebar, title bar, back and forward — which
      // is the point: every filtered view after this one inherits the shape.
      // Navigated to rather than opened from the menu, for the reason the
      // `todo` scene is: \u23182 means "there should be a WINDOW with this in
      // it, in front" (the rule \u23180 and \u23181 follow), and a scene runs in
      // window 1. The menu item is checked separately, below.
      say('clicked', await window.tephra.clickMenu('Links'))
      await settle(1500)
      await pane.goTo({ kind: 'links' })
      let waited = 0
      while (waited < 20_000 && document.querySelector('.links-row') === null) {
        await settle(200)
        waited += 200
      }
      say('title', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('noEditor', document.querySelector('.cm-content') === null)

      const rows = () => [...document.querySelectorAll('.links-row')]
      // **The link is IN the sentence now**, underlined where it was written —
      // so reading the row's destination means reading the live anchor, which
      // also proves it is one.
      const targets = () => rows().map(r => r.querySelector('.links-said .tx-link')?.textContent?.trim() ?? '')
      say('rows', targets())
      say('whens', rows().map(r => r.querySelector('.links-when')?.textContent?.trim() ?? ''))
      say('where', rows().map(r => r.querySelector('.links-said')?.textContent?.trim() ?? ''))
      say('sources', rows().map(r => r.querySelector('.links-source')?.textContent?.trim() ?? ''))
      say('places', rows().map(r => r.querySelector('.links-more')?.textContent?.trim() ?? ''))
      say('liveLinks', rows().filter(r => r.querySelector('.links-said .tx-link') !== null).length)
      {
        const said = document.querySelector('.links-said') as HTMLElement | null
        const panel = document.querySelector('.links') as HTMLElement | null
        say('quoteFace', said === null ? '' : getComputedStyle(said).fontFamily.slice(0, 30))
        say('quoteSize', said === null ? '' : getComputedStyle(said).fontSize)
        say('readingVar', panel === null ? '' : getComputedStyle(panel).getPropertyValue('--reading-face').slice(0, 30))
      }
      say('count', document.querySelector('.links-count')?.textContent?.trim() ?? '')

      // Filtering is in the client; at this scale nothing else is warranted.
      const box = document.querySelector('.links-query') as HTMLInputElement | null
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, 'survey')
      box?.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(400)
      say('filtered', targets())
      say('filteredCount', document.querySelector('.links-count')?.textContent?.trim() ?? '')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, '')
      box?.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(300)

      // **Where you wrote it**, which is the question behind the question.
      // **Clicking a source filters by it**, which is how a directory of a
      // thousand rows becomes the handful you meant.
      ;(rows().find(r => (r.querySelector('.links-source')?.textContent ?? '').includes('tasks'))
        ?.querySelector('.links-source') as HTMLElement | null)?.click()
      await settle(400)
      say('bySource', targets())
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, '')
      box?.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(300)

      // **Where it goes**, for a link written inside a task — the row that
      // produced `ENOTDIR` when a file path was handed over as a document id.
      const inTask = rows().find(r =>
        (r.querySelector('.links-source')?.textContent ?? '').includes('tasks'),
      )
      ;(inTask?.querySelector('.links-said') as HTMLElement | null)?.click()
      await settle(1400)
      say('fromTask', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('taskError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await pane.goTo({ kind: 'links' })
      await settle(700)

      const back = rows().find(r =>
        (r.querySelector('.links-said .tx-link')?.textContent ?? '').includes('the paper'),
      )
      ;(back?.querySelector('.links-said') as HTMLElement | null)?.click()
      await settle(1200)
      say('wentBack', document.querySelector('.cm-content') !== null)
      say('titleAfter', document.querySelector('.titlebar .title')?.textContent ?? '')

      // And back/forward work across a location that is not a document at all.
      const backButton = [...document.querySelectorAll('.titlebar button.nav')].find(
        b => (b.textContent ?? '').trim() === '\u2039',
      ) as HTMLButtonElement | undefined
      say('canGoBack', backButton?.disabled === false)
      backButton?.click()
      await settle(900)
      say('backToLinks', document.querySelector('.links-row') !== null)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(800)
    }

    if (scene === 'tagindex') {
      // **The full set, offered after the live one** (T6, MT5b). A tag whose
      // last task was finished in March is in no list on screen — the live set
      // is today's items and needed no index — so this is the half the corpus
      // is actually asked for.
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 20_000 && document.querySelectorAll('.todo-row').length < 1) {
        await settle(200)
        waited += 200
      }
      say('everyTag', await window.tephra.todo.tags())

      ;(document.querySelector('.todo-add') as HTMLElement | null)?.click()
      await settle(400)
      const field = document.querySelector('.todo-field') as HTMLInputElement | null
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'a new one #h')
      field?.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(500)

      const options = () => [...document.querySelectorAll('.todo-complete button')]
      say('offered', options().map(b => b.textContent ?? ''))
      // Live first, and the dormant ones marked as such rather than hidden.
      say('dormant', options().filter(b => b.classList.contains('dormant')).map(b => b.textContent ?? ''))
      say('firstIsLive', options()[0]?.classList.contains('dormant') === false)

      // And a dormant one completes exactly as a live one does.
      const older = options().find(b => b.classList.contains('dormant')) as HTMLElement | undefined
      older?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await settle(400)
      say('afterTaking', (document.querySelector('.todo-field') as HTMLInputElement | null)?.value ?? '')
      ;(document.querySelector('.todo-field') as HTMLElement | null)?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
      await settle(400)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(800)
    }

    if (scene === 'walk') {
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 20_000 && document.querySelectorAll('.todo-row').length < 1) {
        await settle(200)
        waited += 200
      }
      const rows = () => [...document.querySelectorAll('.todo-row')]
      const texts = () => rows().map(r => (r.querySelector('.todo-text')?.textContent ?? '').trim())

      // **The list looking different IS the offer**, so what is checked first is
      // that it looks different — and that the day's own items do not.
      say('carriedRows', rows().filter(r => r.classList.contains('carried')).length)
      say('allRows', rows().length)
      const start = document.querySelector('.todo-walk-start') as HTMLElement | null
      say('offered', start?.dataset['offered'] ?? '')
      say('startSays', start?.textContent?.trim() ?? '')
      say('noDropButtons', document.querySelectorAll('.todo-drop').length)

      // For the picture: the list as it greets you, offering and not asking.
      if (arg !== 'offer') {
      start?.click()
      await settle(400)
      say('dropButtons', document.querySelectorAll('.todo-drop').length)
      say('finishSays', document.querySelector('.todo-walk-finish')?.textContent?.trim() ?? '')

      // Stage two, look at the preview, then change your mind about one.
      const drops = [...document.querySelectorAll('.todo-drop')] as HTMLElement[]
      drops[0]?.click()
      await settle(200)
      drops[2]?.click()
      await settle(300)
      say('staged', rows().filter(r => r.classList.contains('dropping')).length)
      say('finishCounts', document.querySelector('.todo-walk-finish')?.textContent?.trim() ?? '')
      say('nothingWrittenYet', texts().length)
      drops[2]?.click()
      await settle(300)
      say('afterKeeping', rows().filter(r => r.classList.contains('dropping')).length)

      if (arg === 'cancel') {
        ;(document.querySelector('.todo-walk-cancel') as HTMLElement | null)?.click()
        await settle(700)
        say('rowsAfterCancel', texts().length)
        say('stillOffered', (document.querySelector('.todo-walk-start') as HTMLElement | null)?.dataset['offered'] ?? '')
        say('barGone', document.querySelector('.todo-walkbar') === null)
      } else if (arg === 'stay') {
        // For the picture, mid-pass with a fate staged.
      } else {
        ;(document.querySelector('.todo-walk-finish') as HTMLElement | null)?.click()
        await settle(1200)
        say('rowsAfterFinish', texts().length)
        say('highlightGone', rows().filter(r => r.classList.contains('carried')).length)
        say('startSaysAfter', document.querySelector('.todo-walk-start')?.textContent?.trim() ?? '')
        await window.tephra.doc.flush()
      }
      }
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(900)
    }

    if (scene === 'todoview') {
      // The pivot is a view over what is already on screen (T8's cheap half),
      // so what is worth checking is that it is the SAME list rearranged: no
      // item lost, every tag a heading, and the verbs still reaching main.
      // Navigated to rather than opened from the menu, for the reason the
      // `todo` scene is: ⌘1 opens a window of its own and a scene runs in the
      // first one.
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 20_000 && document.querySelectorAll('.todo-row').length < 1) {
        await settle(200)
        waited += 200
      }
      const rows = () => [...document.querySelectorAll('.todo-row')]
      const texts = () => rows().map(r => (r.querySelector('.todo-text')?.textContent ?? '').trim())
      say('byTime', texts())

      const pick = (label: string) =>
        [...document.querySelectorAll('.todo-views button')].find(
          b => (b.textContent ?? '').trim() === label,
        ) as HTMLElement | undefined
      pick('by tag')?.click()
      await settle(600)
      say('headings', [...document.querySelectorAll('.todo-group-name')].map(h =>
        (h.childNodes[0]?.textContent ?? '').trim(),
      ))
      say('counts', [...document.querySelectorAll('.todo-group-count')].map(c => Number(c.textContent)))
      say('byTag', texts())
      // The heading said the tag; the row must not say it again — but the
      // OTHER tags on a two-tag item are exactly what the reader wants.
      const writing = [...document.querySelectorAll('.todo-group')].find(g =>
        (g.querySelector('.todo-group-name')?.textContent ?? '').startsWith('tephra'),
      )
      say('chipsUnderTephra', [...(writing?.querySelectorAll('.todo-tag') ?? [])].map(t => t.textContent))

      // A verb from inside a group still works, and the row it changes is the
      // same item everywhere it appears. **Which item that is, is found rather
      // than named** — a scene that knows its fixture's words tests the fixture.
      const repeated = texts().find((t, i) => t !== '' && texts().indexOf(t) !== i) ?? ''
      const copiesOf = (text: string) =>
        rows().filter(r => (r.querySelector('.todo-text')?.textContent ?? '').trim() === text)
      say('appearsTwice', copiesOf(repeated).length)
      ;(copiesOf(repeated)[0]?.querySelector('.todo-glyph') as HTMLElement | null)?.click()
      await settle(900)
      say('statusesAfter', copiesOf(repeated).map(r => r.className.replace(/.*status-(\w+).*/, '$1')))

      pick('by time')?.click()
      await settle(500)
      say('backToTime', texts())
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      // For the picture: this project has found the invisible selection, the
      // cut-off sheet and the sans-serif Hebrew by looking at pixels.
      if (arg === 'stay') pick('by tag')?.click()
      await settle(800)
    }

    if (scene === 'zonebar') {
      // **The control has to DO something.** The offer used to be a pill in the
      // title bar, and the title bar is a drag region — which swallows mouse
      // events, so the one thing it was for never happened. Nothing about that
      // is visible in a unit test: the handler was correct and unreachable.
      let waited = 0
      while (waited < 20_000 && document.querySelector('.zonebar') === null) {
        await settle(200)
        waited += 200
      }
      const bar = document.querySelector('.zonebar') as HTMLElement | null
      say('shown', bar !== null)
      // Across the page rather than tucked in a corner: the complaint that
      // started this was that it could not be seen.
      const page = document.querySelector('.frame-reading')?.getBoundingClientRect()
      const box = bar?.getBoundingClientRect()
      say('widthOfPage', Math.round(((box?.width ?? 0) / (page?.width ?? 1)) * 100))
      say('says', (bar?.querySelector('.zonebar-text')?.textContent ?? '').replace(/\s+/g, ' ').trim())
      say('before', (await window.tephra.doc.open()).zone)

      if (arg === 'dismiss') {
        ;(bar?.querySelector('.zonebar-close') as HTMLElement | null)?.click()
        await settle(800)
        say('gone', document.querySelector('.zonebar') === null)
        say('zoneKept', (await window.tephra.doc.open()).zone)
      } else {
        ;(bar?.querySelector('.zonebar-act') as HTMLElement | null)?.click()
        await settle(1200)
        say('after', (await window.tephra.doc.open()).zone)
        say('gone', document.querySelector('.zonebar') === null)
      }
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(800)
    }

    if (scene === 'rowmenu') {
      // Open a row's menu and leave it open, so the shot at the end of the run
      // has something to show. This project has found the invisible selection,
      // the cut-off sheet and the sans-serif Hebrew by looking at pixels.
      let waited = 0
      while (waited < 25_000 && document.querySelectorAll('.nav-row').length < 1) {
        await settle(200)
        waited += 200
      }
      const row = [...document.querySelectorAll('.nav-row')].find(r =>
        (r.textContent ?? '').includes('The offer'),
      ) as HTMLElement | undefined
      const box = row?.getBoundingClientRect()
      row?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: Math.round((box?.left ?? 0) + 90),
          clientY: Math.round((box?.top ?? 0) + 10),
        }),
      )
      await settle(600)
      say('items', [...document.querySelectorAll('.row-menu button')].map(b => b.textContent ?? ''))

      // The field has to sit exactly where the row's text did — a list that
      // jumps when a name goes from being read to being typed is a list that
      // makes you find your place again.
      if (arg === 'edit') {
        const before = row?.getBoundingClientRect()
        ;([...document.querySelectorAll('.row-menu button')].find(
          b => (b.textContent ?? '') === 'Edit Label',
        ) as HTMLElement | undefined)?.click()
        await settle(500)
        const field = document.querySelector('.nav-rename') as HTMLElement | null
        const after = field?.getBoundingClientRect()
        say('rowTop', Math.round(before?.top ?? -1))
        say('fieldTop', Math.round(after?.top ?? -1))
        say('rowHeight', Math.round(before?.height ?? -1))
        say('fieldHeight', Math.round(after?.height ?? -1))
      }
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
    }

    if (scene === 'sidebar-acts') {
      // The same three acts, asked for from the list rather than from the menu
      // bar — plus the two that only exist here: relabelling a row, and making
      // a file in the section you are looking at.
      let waited = 0
      while (waited < 25_000 && document.querySelectorAll('.nav-row').length < 1) {
        await settle(200)
        waited += 200
      }

      const rowFor = (text: string): HTMLElement | undefined =>
        [...document.querySelectorAll('.nav-row')].find(r =>
          (r.textContent ?? '').includes(text),
        ) as HTMLElement | undefined

      /** Right-click a row and read back what its menu offers. */
      const menuOn = async (text: string): Promise<readonly string[]> => {
        const row = rowFor(text)
        row?.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 200 }),
        )
        await settle(400)
        return [...document.querySelectorAll('.row-menu button')].map(b => b.textContent ?? '')
      }

      const choose = async (label: string): Promise<boolean> => {
        const item = [...document.querySelectorAll('.row-menu button')].find(
          b => (b.textContent ?? '') === label,
        ) as HTMLElement | undefined
        item?.click()
        await settle(500)
        return item !== undefined
      }

      /** Type into whichever field is asking — the row's own, or the prompt's. */
      const type = async (selector: string, value: string): Promise<void> => {
        const input = document.querySelector(selector) as HTMLInputElement | null
        if (input === null) return
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(120)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1400)
      }

      // ── a listed entry: it has a label of its own, and a file behind it ──
      say('curatedMenu', await menuOn('The offer'))
      say('editLabelChosen', await choose('Edit Label'))
      say('editingInPlace', document.querySelector('.nav-rename') !== null)
      await type('.nav-rename', 'Their first number')
      say('rowAfterRelabel', rowFor('Their first number') !== undefined)

      // ── and the file it names is renamed separately, by its own name ──
      await menuOn('Their first number')
      say('renameFileChosen', await choose('Rename File…'))
      say('renamePrefilled', (document.querySelector('.prompt input') as HTMLInputElement | null)?.value ?? '')
      await type('.prompt input', 'counter offer')
      // The label somebody wrote survives a rename of the file under it.
      say('rowKeptItsLabel', rowFor('Their first number') !== undefined)

      // ── a derived row has no line, so the same gesture renames the file ──
      say('derivedMenu', await menuOn('loose-note'))
      say('renameChosen', await choose('Rename'))
      await type('.nav-rename', 'tidied note')
      say('rowAfterRename', rowFor('tidied-note') !== undefined)

      // ── a new file, made in the section that was asked ──
      const header = [...document.querySelectorAll('.nav-head')].find(h =>
        (h.textContent ?? '').includes('The house'),
      ) as HTMLElement | undefined
      header?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }))
      await settle(400)
      say('newFileChosen', await choose('New File…'))
      await type('.prompt input', 'Survey report')
      say('titleAfterNew', document.querySelector('.titlebar .title')?.textContent ?? '')

      // ── and deleting one, from the row ──
      await menuOn('Their first number')
      say('deleteChosen', await choose('Delete File…'))
      say('confirmShown', document.querySelector('.prompt-actions .destructive') !== null)
      ;(document.querySelector('.prompt-actions .destructive') as HTMLElement | null)?.click()
      await settle(1600)

      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'lists') {
      // A wrapped bullet hangs under its own text, and the marker is drawn as a
      // bullet over the hyphen the file keeps.
      await settle(1200)
      const rows = [...document.querySelectorAll('.cm-line.tx-list')]
      say('listLines', rows.length)
      say('bullets', document.querySelectorAll('.tx-bullet').length)

      // The alignment: where the SECOND visual row of a wrapped item starts,
      // against where the first row's text starts. A DOM range over the item's
      // text gives both, because a wrapped line is one element with two rects.
      const wrapped = rows.find(l => (l.textContent ?? '').includes('wrap onto a second line'))
      let firstText = 0
      let secondRow = 0
      if (wrapped !== undefined) {
        // **A Range, not the element.** `.cm-line` is a block, so its own rects
        // are one box around both wrapped rows; a range over its text yields
        // one rect per visual row, which is the thing being measured. The range
        // starts after the bullet widget, so rect 0 is where the TEXT begins.
        const node = wrapped.lastChild ?? wrapped
        const range = document.createRange()
        range.selectNodeContents(node)
        const rects = [...range.getClientRects()]
        firstText = rects.length > 0 ? Math.round((rects[0] as DOMRect).left) : 0
        secondRow = rects.length > 1 ? Math.round((rects[1] as DOMRect).left) : 0
      }
      say('firstTextLeft', firstText)
      say('secondRowLeft', secondRow)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(400)
    }

    if (scene === 'code') {
      // A fenced block is a place with its own typography, and its language is
      // parsed — a `python` fence is Python, not one run of monospace.
      await settle(1200)
      const codeLines = [...document.querySelectorAll('.cm-line.tx-code')]
      say('codeLines', codeLines.length)
      say('fenceLines', document.querySelectorAll('.cm-line.tx-fence').length)

      const body = codeLines.find(l => (l.textContent ?? '').includes('def solve'))
      const prose = [...document.querySelectorAll('.cm-line')].find(l =>
        (l.textContent ?? '').includes('Prose sits at'),
      )
      const faceOf = (el: Element | undefined): string =>
        el === undefined ? '' : getComputedStyle(el).fontFamily
      say('codeFace', faceOf(body))
      say('proseFace', faceOf(prose))
      // Its own measure: the code column is wider than the prose one.
      say('codeWidth', body === undefined ? 0 : Math.round(body.getBoundingClientRect().width))
      say('proseWidth', prose === undefined ? 0 : Math.round(prose.getBoundingClientRect().width))

      // Highlighted: `def` is a keyword and carries the accent, and the comment
      // does not — which is only possible if the fence was parsed as Python.
      const coloured = [...document.querySelectorAll('.cm-line.tx-code span')]
        .filter(sp => (sp.textContent ?? '').trim() !== '')
        .map(sp => `${(sp.textContent ?? '').trim().slice(0, 8)}=${getComputedStyle(sp).color}`)
      say('keywordColoured', coloured.some(c => c.startsWith('def=')))
      say('distinctColours', new Set(coloured.map(c => c.split('=')[1])).size)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(400)
    }

    if (scene === 'emphasis') {
      const sample = [
        'A **bold** claim and an *italic* aside.',
        'Also __strong__ and _slanted_ with underscores.',
        'In code, `a *b* c` keeps its asterisks.',
        'The file some_file_name.txt keeps its middle.',
        'Arithmetic 2 * 3 * 4 is not emphasis.',
        'Nested **bold with *inner* italic** here.',
        '',
      ].join('\n')
      view.dispatch({ changes: { from: view.state.doc.length, insert: sample }, userEvent: 'input.type' })
      await settle(600)

      const rendered = (): string =>
        [...document.querySelectorAll('.cm-line')].map(l => l.textContent ?? '').join('\n')

      // Park the caret far away, so nothing is revealed by proximity.
      live().dispatch({ selection: { anchor: 0 } })
      await settle(300)
      const shown = rendered()
      say('concealed', {
        bold: shown.includes('A bold claim'),
        italic: shown.includes('an italic aside'),
        strongUnder: shown.includes('Also strong and'),
        emUnder: shown.includes('and slanted with'),
        codeKeepsStars: shown.includes('`a *b* c`'),
        filenameIntact: shown.includes('some_file_name.txt'),
        arithmeticIntact: shown.includes('2 * 3 * 4'),
      })
      say('stillInDocument', live().state.doc.toString().includes('**bold**'))

      // And the marks come back when the caret is inside them.
      const at = live().state.doc.toString().indexOf('**bold**')
      live().dispatch({ selection: { anchor: at + 3 } })
      await settle(300)
      say('revealedUnderCursor', rendered().includes('**bold**'))
      await settle(200)
    }

    if (scene === 'richpaste') {
      // A paste event carrying both flavours, exactly as a browser copy does.
      const board = await window.tephra.readClipboard()
      const html = board.html
      const data = new DataTransfer()
      data.setData('text/html', html)
      data.setData('text/plain', 'flattened plain text')
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      await settle(200)
      const before = view.state.doc.toString()
      const content = document.querySelector('.cm-content') as HTMLElement | null
      content?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      await settle(900)
      const added = view.state.doc.toString().slice(before.length)
      say('pastedChars', added.length)
      say('keptStructure', added.includes('## '))
      say('flattened', added.includes('flattened plain text'))
      say('head', added.trim().slice(0, 80))
      await settle(400)
    }

    if (scene === 'growth') {
      // Watch the document over time. If growth is looping, the length keeps
      // moving; if it is duplicating, the same text appears more than once.
      const samples: number[] = []
      for (let i = 0; i < 40; i++) {
        samples.push(view.state.doc.length)
        await settle(200)
      }
      say('lengths', samples.filter((n, i) => i === 0 || n !== samples[i - 1]))
      say('settled', samples[samples.length - 1] === samples[samples.length - 6])
      const text = view.state.doc.toString()
      say('mondayCount', (text.match(/Monday: a paragraph/g) ?? []).length)
      say('fridayCount', (text.match(/Friday: a paragraph/g) ?? []).length)
      say('separators', document.querySelectorAll('.tx-daybreak').length)
      const vp = (view as unknown as { viewport?: { from: number; to: number } }).viewport
      say('viewport', vp === undefined ? null : { from: vp.from, to: vp.to })
      say('caretAt', view.state.selection.main.head)
      say('linesInDom', document.querySelectorAll('.cm-line').length)
      say('daysReported', (await window.tephra.doc.spans({ kind: 'date' })).length)
    }

    if (scene === 'geometry') {
      // THE TWO GEOMETRY CLAIMS, asserted rather than debugged (D48's family C).
      //
      // Every bug in this family had the same shape: the editor's HEIGHT MAP
      // and the DOM disagreed about where a line is, so a screen point resolved
      // to a position a line away from the one it was drawn at. A block widget
      // whose spacing was `margin` rather than `padding` was one cause — the
      // margin falls outside the box the height is measured from — and it was
      // found only by driving real mouse events at a real notebook. The round
      // trip below is the same measurement, made cheap enough to run every time.
      let waited = 0
      let steady = 0
      let last = -1
      while (waited < 8000 && steady < 5) {
        await settle(200)
        waited += 200
        const now = view.state.doc.length
        steady = now === last ? steady + 1 : 0
        last = now
      }

      const text = view.state.doc.toString()
      say('daysLoaded', document.querySelectorAll('.tx-daybreak').length + 1)

      // 1. A point on screen maps back to the position it was drawn at.
      //
      // Only for positions the viewport has actually rendered — `coordsAtPos`
      // answers null outside it and there is nothing to compare — and not
      // inside an atomic range, where every point in the widget belongs to one
      // position and the round trip is not expected to be the identity.
      const HANDLE = '\ufffc'
      const atomic = (at: number): boolean =>
        text[at] === HANDLE || text[at - 1] === HANDLE
      const probes: { at: number; off: number }[] = []
      let measured = 0
      for (let at = 0; at <= view.state.doc.length; at += 7) {
        if (atomic(at)) continue
        const c = view.coordsAtPos(at)
        if (c === null) continue // outside the rendered range
        measured++
        const back = view.posAtCoords({ x: c.left, y: (c.top + c.bottom) / 2 })
        if (back !== null && back !== at) probes.push({ at, off: back - at })
      }
      say('probed', measured)
      say('roundTripWorst', Math.max(0, ...probes.map(p => Math.abs(p.off))))
      say('roundTripFailures', probes.slice(0, 8))

      // 2. The append position is on screen once the region has settled.
      const scroller = document.querySelector('.cm-scroller') as HTMLElement | null
      const box = scroller?.getBoundingClientRect()
      const caret = view.coordsAtPos(view.state.doc.length)
      say('caretAtEnd', view.state.selection.main.head === view.state.doc.length)
      say('caretVisible', caret !== null && box !== undefined &&
        caret.top >= box.top && caret.bottom <= box.bottom)
      say('earlierDayAbove', text.slice(0, Math.max(0, view.state.doc.length - 40)).includes('yesterday'))
      await settle(400)
    }

    if (scene === 'landing') {
      // Growth happens behind the reader, so the question is not where the app
      // landed at first paint but where it is once the region has finished
      // arriving.
      const scroller = document.querySelector('.cm-scroller') as HTMLElement | null
      let waited = 0
      let steady = 0
      let last = -1
      while (waited < 8000 && steady < 5) {
        await settle(200)
        waited += 200
        const now = view.state.doc.length
        steady = now === last ? steady + 1 : 0
        last = now
      }
      say('daysLoaded', document.querySelectorAll('.tx-daybreak').length + 1)
      say('caretAtEnd', view.state.selection.main.head === view.state.doc.length)

      // The claim that matters: the append position is ON SCREEN, near the
      // bottom, with earlier days above it.
      const caret = view.coordsAtPos(view.state.doc.length)
      const box = scroller?.getBoundingClientRect()
      say('caretVisible', caret !== null && box !== undefined &&
        caret.top >= box.top && caret.bottom <= box.bottom)
      say('scrolledToBottom', scroller !== null &&
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4)
      say('somethingAbove', (view.state.doc.toString().slice(0, view.state.doc.length - 20)).includes('Friday'))
      const rail = document.querySelector('.rail-host') as HTMLElement | null
      const content = document.querySelector('.cm-content') as HTMLElement | null
      say('heights', {
        content: Math.round(content?.getBoundingClientRect().height ?? -1),
        railHost: Math.round(rail?.getBoundingClientRect().height ?? -1),
        railBottom: Math.round((rail?.getBoundingClientRect().bottom ?? 0) - (scroller?.getBoundingClientRect().top ?? 0)),
      })
      say('geometry', scroller === null ? null : {
        scrollTop: Math.round(scroller.scrollTop),
        scrollHeight: Math.round(scroller.scrollHeight),
        clientHeight: Math.round(scroller.clientHeight),
        caretTop: caret === null ? null : Math.round(caret.top - (box?.top ?? 0)),
      })
      await settle(1500)
    }

    if (scene === 'days') {
      // Growth is what brings earlier days in, so wait for it rather than
      // assuming the first paint has them.
      let waited = 0
      while (waited < 4000 && document.querySelectorAll('.tx-daybreak').length < 1) {
        await settle(200)
        waited += 200
      }
      say('separators', document.querySelectorAll('.tx-daybreak').length)
      say('labels', [...document.querySelectorAll('.tx-daybreak')].map(e =>
        [...e.querySelectorAll('time')].map(t => t.textContent).join(' → ')))
      say('daysInBuffer', (view.state.doc.toString().match(/Friday|Lorem/g) ?? []).length)
      say('landedAtEnd', view.state.selection.main.head === view.state.doc.length)
      say('daysLoaded', view.state.doc.toString().split('\n').length > 4)
      await settle(2500)
    }

    if (scene === 'clipboard') {
      const board = await window.tephra.readClipboard()
      say('textBytes', board.text.length)
      say('htmlBytes', board.html.length)
      say('htmlHead', board.html.slice(0, 120))
      const { markdownFromHtml } = await import('./import/html.ts')
      const md = markdownFromHtml(board.html)
      say('converted', md === null ? 'NULL' : `${md.length} chars`)
      say('mdHead', md === null ? '' : md.slice(0, 120))
      await settle(400)
    }

    if (scene === 'mousedrag') {
      // The reported gesture, with real mouse events: press between the final
      // digits of the URL and its closing paren, then drag left and up.
      const all = view.state.doc.toString()
      // A few characters back from the line end, so the press point is
      // unambiguously on the URL's own visual row rather than at a wrap.
      const anchor = all.indexOf('#gid=507948599') + '#gid=507948599'.length - 4
      const from = view.coordsAtPos(anchor)
      const upLine = all.lastIndexOf('\n', anchor - 1)
      const target = Math.max(0, upLine - 20)
      const to = view.coordsAtPos(target)
      say('haveCoords', from !== null && to !== null)
      if (from === null || to === null) { console.log('VERIFY done'); return }

      const content = document.querySelector('.cm-content') as HTMLElement
      const at = (c: { left: number; top: number; bottom: number }): [number, number] =>
        [c.left, (c.top + c.bottom) / 2]
      const [x1, y1] = at(from)
      const [x2, y2] = at(to)
      const fire = (type: string, x: number, y: number): void => {
        content.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1,
          // A synthetic MouseEvent defaults `detail` to 0, and CodeMirror reads
          // it as the click count — 0 is not a click a mouse can produce, and
          // it selected whole ranges. The instrument was inventing the bug.
          detail: 1,
        }))
      }
      fire('mousedown', x1, y1)
      await settle(60)
      say('afterPress', { from: view.state.selection.main.from, to: view.state.selection.main.to, wanted: anchor })
      say('pressCollapsed', view.state.selection.main.empty)
      say('textAtPress', all.slice(anchor - 14, anchor + 6))
      // A few steps, as a hand would move.
      for (let i = 1; i <= 4; i++) {
        fire('mousemove', x1 + ((x2 - x1) * i) / 4, y1 + ((y2 - y1) * i) / 4)
        await settle(60)
      }
      fire('mouseup', x2, y2)
      await settle(200)

      const sel = view.state.selection.main
      say('selected', { from: sel.from, to: sel.to, anchor, target })
      say('selectedText', view.state.doc.toString().slice(sel.from, sel.to).slice(0, 90))
      say('wentTheRightWay', sel.to <= anchor + 1)
      await settle(600)
    }

    if (scene === 'coords') {
      // Does a screen point map back to the position it came from? Near a block
      // widget whose height CodeMirror has not been told, it may not.
      const all = view.state.doc.toString()
      const seam = all.indexOf('Things to do:')
      const probes: { at: number; back: number | null; off: number | null }[] = []
      for (let d = -260; d <= 260; d += 40) {
        const at = seam + d
        if (at < 0 || at > view.state.doc.length) continue
        const c = view.coordsAtPos(at)
        if (c === null) { probes.push({ at, back: null, off: null }); continue }
        const back = view.posAtCoords({ x: (c as { left?: number }).left ?? 0, y: (c.top + c.bottom) / 2 })
        probes.push({ at, back, off: back === null ? null : back - at })
      }
      say('roundTrip', probes)
      say('worstOffset', Math.max(...probes.map(p => Math.abs(p.off ?? 0))))
      await settle(600)
    }

    if (scene === 'dragup') {
      const all = view.state.doc.toString()
      // The reported start: just after the closing digits of the URL, before ')'.
      const anchor = all.indexOf('#gid=507948599') + '#gid=507948599'.length
      // A landmark BELOW the drag, whose screen position must not move.
      const landmark = all.indexOf('- Review')
      const where = (): number | null => view.coordsAtPos(landmark)?.top ?? null

      view.dispatch({ selection: { anchor, head: anchor } })
      await settle(400)
      const start = where()
      say('landmarkAtStart', start === null ? null : Math.round(start))

      // Drag left and up, a step at a time, watching the landmark.
      const moves: { head: number; landmark: number | null; shifted: boolean }[] = []
      for (const back of [10, 40, 90, 140, 200, 260]) {
        view.dispatch({ selection: { anchor, head: Math.max(0, anchor - back) } })
        await settle(180)
        const now = where()
        moves.push({
          head: anchor - back,
          landmark: now === null ? null : Math.round(now),
          shifted: start !== null && now !== null && Math.abs(now - start) > 1,
        })
      }
      say('drag', moves)
      say('everShifted', moves.some(m => m.shifted))
      say('textLength', view.state.doc.length)
      await settle(600)
    }

    if (scene === 'dragselect') {
      const all = view.state.doc.toString()
      const start = all.indexOf('https://docs.google.com/spreadsheets')
      const end = all.indexOf('Olga') + 12

      const shown = (): string => document.querySelector('.cm-content')?.textContent ?? ''
      say('linkRenderedBefore', document.querySelectorAll('.tx-link').length)
      const before = shown()

      // Selecting the URL above and dragging down PAST the link below it —
      // which is where the jump happened.
      view.dispatch({ selection: { anchor: start, head: end } })
      await settle(400)
      say('linkStillRendered', document.querySelectorAll('.tx-link').length)
      say('textUnchangedWhileSelecting', shown() === before)
      say('rawUrlOnScreen', shown().includes('1apEoM9wc8PKMBR58z'))

      // A caret inside the link still reveals it, which is how it is edited.
      view.dispatch({ selection: { anchor: all.indexOf('Olga') + 2 } })
      await settle(400)
      say('revealedForCaret', (document.querySelector('.cm-content')?.textContent ?? '').includes('1apEoM9wc8PKMBR58z'))
      await settle(800)
    }

    if (scene === 'link') {
      const all = view.state.doc.toString()
      const from = all.indexOf('Klein, Crawford and Alchian')
      view.dispatch({ selection: { anchor: from, head: from + 27 } })
      await settle(700)
      say('menuItemFound', await window.tephra.clickMenu('Link…'))
      await settle(500)
      const input = document.querySelector('.prompt input') as HTMLInputElement | null
      say('promptOpened', input !== null)
      // The clipboard held a URL, so it should already be filled in.
      say('prefilled', input?.value ?? '(none)')
      if (input !== null) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(900)
      }
      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      say('buffer', view.state.doc.toString().slice(from - 12, from + 70))
      view.dispatch({ selection: { anchor: 0 } })
      await settle(400)
      say('linkRendered', document.querySelectorAll('.tx-link').length)
      say('onScreen', document.querySelector('.cm-content')?.textContent ?? '')
      await settle(1200)
    }

    if (scene === 'import') {
      // Seeded, not borrowed: what this checks is that an import keeps the
      // original and annotates a copy, and that claim has nothing to do with
      // what happens to be on the operator's pasteboard. Put back at the end.
      const had = await window.tephra.setClipboard({
        text: 'Contract theory, in plain text.',
        html:
          '<meta charset="utf-8"><h2>Contract theory</h2>' +
          '<p>A <b>hold-up problem</b> arises when investment is relationship-specific.</p>' +
          '<p>See <a href="https://example.org/klein">Klein, Crawford and Alchian</a>.</p>',
      })
      say('clipboardSeeded', true)

      view.dispatch({ selection: { anchor: view.state.doc.length } })
      await settle(400)
      const before = view.state.doc.toString()
      say('menuItemFound', await window.tephra.clickMenu('Import Clipboard'))

      let waited = 0
      while (waited < 5000 && view.state.doc.toString() === before) {
        await settle(200)
        waited += 200
      }
      say('arrivedAfterMs', waited)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      say('inBuffer', view.state.doc.toString().slice(before.length).trim().slice(0, 120))
      say('linkRendered', document.querySelectorAll('.tx-link').length)
      await window.tephra.doc.flush()
      await window.tephra.setClipboard(had)
      await settle(600)
    }

    if (scene === 'comment') {
      const type = async (text: string): Promise<boolean> => {
        const area = document.querySelector('.rail textarea') as HTMLTextAreaElement | null
        if (area === null) return false
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        set?.call(area, text)
        area.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(120)
        area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1200)
        return true
      }

      const all = view.state.doc.toString()
      const from = all.indexOf('largest sudden loss a participant can absorb')
      view.dispatch({ selection: { anchor: from, head: from + 44 } })
      say('selected', from !== -1)
      // The menu learns about the selection over IPC, and a range command is
      // greyed until it has.
      await settle(700)
      const w0 = (pane as unknown as { window?: { text: string } }).window
      say('bufferBefore', w0?.text.length ?? -1)
      say('menuItemFound', await window.tephra.clickMenu('Comment…'))

      // Poll rather than guess: how long the note takes to appear is the
      // question, and a fixed sleep answers it only by accident.
      let waited = 0
      while (waited < 6000 && document.querySelector('.rail textarea') === null) {
        await settle(200)
        waited += 200
      }
      say('composerAppearedAfterMs', waited)
      if (waited >= 6000) say('diagnose', await window.tephra.diagnose())
      say('bufferAfter', w0?.text.length ?? -1)
      const w3 = (pane as unknown as { window?: { spans(k?: string): unknown[] } }).window
      say('spansSeenByRenderer', w3?.spans('comment')?.length ?? -1)
      say('threadsSeenByRenderer', (await window.tephra.doc.comments()).length)

      // No dialog: the note is already in the margin, open and waiting.
      say('promptShown', document.querySelector('.prompt') !== null)
      say('composerOpen', document.querySelector('.rail textarea') !== null)
      say('typed', await type('This assumes the reader already accepts premise 2.'))

      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      say('notesInMargin', document.querySelectorAll('.rail .note').length)
      say('noteText', document.querySelector('.rail .note-body')?.textContent ?? '(none)')
      say('markInText', document.querySelectorAll('.tx-handle').length)
      say('ruleUnderRange', document.querySelectorAll('.tx-commented').length)
      say('rawInBuffer', view.state.doc.toString().includes('tephra:'))
      say('bodyInBuffer', view.state.doc.toString().includes('premise 2'))
      say('quickReactions', [...document.querySelectorAll('.rail .quick')].map(b => b.textContent))

      // React, and check the actions did not move as a result.
      const before = (document.querySelector('.rail .note-actions') as HTMLElement | null)?.getBoundingClientRect().left ?? -1
      ;(document.querySelector('.rail .quick') as HTMLButtonElement | null)?.click()
      await settle(1000)
      const after = (document.querySelector('.rail .note-actions') as HTMLElement | null)?.getBoundingClientRect().left ?? -2
      say('actionsStayedPut', before === after)
      say('reactions', [...document.querySelectorAll('.rail .reaction')].map(b => b.textContent))

      // And a reply, written where the note is read.
      const reply = [...document.querySelectorAll('.rail .link')].find(b => b.textContent === 'Reply') as HTMLButtonElement | undefined
      reply?.click()
      await settle(300)
      say('replied', await type('On reflection, premise 2 is the interesting part.'))
      say('messagesNow', document.querySelectorAll('.rail .note-message').length)
      await settle(2500)
    }

    if (scene === 'print') {
      const all = view.state.doc.toString()
      // From the first VISIBLE character of the heading, which is where a
      // person's selection starts: the hashes are concealed and atomic, so the
      // caret cannot be put before them.
      const from = all.indexOf('The Shock Limit')
      view.dispatch({ selection: { anchor: from, head: all.length } })
      await settle(200)
      const at = view.state.selection.main.from
      say('selectionStartsAt', view.state.doc.toString().slice(at, at + 6))
      await settle(300)
      say('selected', from !== -1)
      say('menuItemFound', await window.tephra.clickMenu('Print Selection…'))
      await settle(3500)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(1500)
    }

    if (scene === 'printdoc') {
      // ⌘P, which for the stream means "which days?" first. The claims: the
      // dialog appears, a preset fills it in, the days that come back are the
      // ones that were WRITTEN in, and a PDF exists at the end of it.
      say('menuItemFound', await window.tephra.clickMenu('Print…'))
      await settle(500)

      const dialog = document.querySelector('.prompt.range')
      say('dialogShown', dialog !== null)
      say('presets', [...(dialog?.querySelectorAll('.range-presets button') ?? [])].map(b => b.textContent))
      // Folded into the pill language, but a preset is a primary control in its
      // own dialog rather than a chip beside a line — so it keeps the dialog's
      // size instead of shrinking to seven tenths of it.
      {
        const one = dialog?.querySelector('.range-presets button') as HTMLElement | null
        const css = one === null || one === undefined ? null : getComputedStyle(one)
        say('presetPill', css === null ? null : {
          size: Math.round(parseFloat(css.fontSize) * 10) / 10,
          edge: /,\s*0\)$/.test(css.borderTopColor) ? 'none' : 'edge',
          round: css.borderTopLeftRadius,
        })
      }

      // "Past month" rather than typing dates: it is the path a person takes,
      // and it exercises the extent the dialog was handed.
      const preset = [...(dialog?.querySelectorAll('.range-presets button') ?? [])].find(
        b => b.textContent === 'Past month',
      ) as HTMLElement | undefined
      preset?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
      await settle(200)
      const fields = [...(dialog?.querySelectorAll('.range-fields input') ?? [])] as HTMLInputElement[]
      say('range', fields.map(f => f.value))
      say('count', dialog?.querySelector('.range-count')?.textContent ?? '')

      // The annotation policy (D50), which is what the dialog is really for
      // now: the same days, printed twice, differ by this one choice.
      const choices = [...(dialog?.querySelectorAll('.range-choice') ?? [])].map(c => c.textContent)
      say('choices', choices)
      // Footnotes, which is the choice that has to paginate: paged.js has to
      // run, find pages, and put each note on the one its anchor fell on.
      const wanted = process.env.TEPHRA_PRINT_POLICY ?? 'footnotes'
      const inputs = [...(dialog?.querySelectorAll('.range-choice input') ?? [])] as HTMLInputElement[]
      const index = choices.findIndex(c => (c ?? '').toLowerCase().includes(wanted === 'footnotes' ? 'footnote' : wanted))
      const chosen = inputs[index < 0 ? 1 : index]
      chosen?.click()
      await settle(150)
      say('policyChosen', choices[index < 0 ? 1 : index] ?? '')
      say('notesChosen', chosen?.checked === true)

      const print = [...(dialog?.querySelectorAll('.prompt-actions button') ?? [])].find(
        b => b.textContent === 'Print',
      ) as HTMLElement | undefined
      say('printFound', print !== undefined)
      print?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))

      await settle(4000)
      say('dialogClosed', document.querySelector('.prompt.range') === null)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(1500)
    }

    if (scene === 'sidebar') {
      // The sidebar over a real corpus: sections with counts, and the one verb
      // (D51) — clicking a subject goes to its next occurrence, every time.
      let waited = 0
      while (waited < 8000 && document.querySelectorAll('.nav-section').length < 4) {
        await settle(200)
        waited += 200
      }

      // The head carries a caret and a count as well as a title; the title is
      // what is left when its element children are taken out.
      const titleOf = (head: Element | null): string =>
        [...(head?.childNodes ?? [])]
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent ?? '')
          .join('')
          .trim()
      const sections = [...document.querySelectorAll('.nav-section')].map(el => ({
        title: titleOf(el.querySelector('.nav-head')),
        count: el.querySelector('.nav-head .nav-count')?.textContent ?? '',
        rows: el.querySelectorAll('.nav-row').length,
      }))
      say('sections', sections)

      // Open every section, so the rows exist to be clicked.
      for (const head of [...document.querySelectorAll('.nav-head')]) {
        if (head.getAttribute('aria-expanded') === 'false') {
          (head as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        }
      }
      await settle(400)

      const rowsIn = (title: string): HTMLElement[] => {
        const section = [...document.querySelectorAll('.nav-section')].find(el =>
          (el.querySelector('.nav-head')?.textContent ?? '').includes(title),
        )
        return [...(section?.querySelectorAll('.nav-row') ?? [])] as HTMLElement[]
      }

      say('subjectRows', rowsIn('Subjects').map(r => r.textContent?.trim() ?? ''))
      say('bookmarkRows', rowsIn('Bookmarks').map(r => r.textContent?.trim() ?? ''))
      say('timelineRows', rowsIn('Timeline').map(r => r.textContent?.trim() ?? ''))

      // The limit, and the way past it. A journal of twenty years cannot show
      // every day, and a list that grows without asking is the failure mode.
      const more = document.querySelector('.nav-more') as HTMLElement | null
      say('moreLabel', more?.textContent?.trim() ?? 'none')
      more?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(300)
      say('rowsAfterMore', rowsIn('Timeline').length)

      // A day collapses. The caret is a separate control from the row, so the
      // row's verb stays "go there" (D51).
      const carets = [...document.querySelectorAll('.nav-caret')] as HTMLElement[]
      const open = carets.find(c => c.getAttribute('aria-expanded') === 'true')
      say('headingsWhileOpen', rowsIn('Timeline').filter(r => r.className.includes('nav-nested')).length)
      open?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(300)
      say('headingsWhenCollapsed', rowsIn('Timeline').filter(r => r.className.includes('nav-nested')).length)
      open?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(300)

      // THE ONE VERB. A subject used three times, clicked three times: the
      // caret should land somewhere different each time, and come back round.
      const subject = rowsIn('Subjects').find(r => (r.textContent ?? '').includes('Recurring'))
      const seen: number[] = []
      for (let i = 0; i < 4; i++) {
        subject?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        await settle(700)
        seen.push(view.state.selection.main.head)
      }
      say('caretsAfterClicks', seen)
      say('distinctPlaces', new Set(seen.slice(0, 3)).size)
      say('wrappedAround', seen[3] === seen[0])
      say('counterShown', document.querySelector('.nav-row-wrap.active .nav-count')?.textContent ?? '')

      // The scroll track: where else the set is (D51). One mark per occurrence
      // in the loaded window, and exactly one of them the current place.
      const trackMarks = [...document.querySelectorAll('.tx-track-mark')]
      say('trackMarks', trackMarks.length)
      say('trackCurrent', document.querySelectorAll('.tx-track-mark.current').length)
      say('trackTops', trackMarks.map(m => (m as HTMLElement).style.top))
      say('trackHeights', trackMarks.map(m => (m as HTMLElement).style.height))
      say('trackColour', (trackMarks[0] as HTMLElement | undefined)?.style.getPropertyValue('--track') ?? '')
      say(
        'tagColourInText',
        (document.querySelector('.tx-tag') as HTMLElement | null)?.style.getPropertyValue('--tag') ?? '',
      )
      say('trackBeyond', [...document.querySelectorAll('.tx-track-beyond')].map(e => e.textContent))
      say('steppersShown', document.querySelectorAll('.nav-steps button').length)
      // Where you are: put the caret inside the tagged phrase under today's
      // heading, read the line back — and check that filling it moved nothing
      // above it, which is why it sits at the foot (D42's no-reflow rule).
      const all = view.state.doc.toString()
      const inside = all.indexOf('the third mention')
      view.dispatch({ selection: { anchor: inside + 4 } })
      await settle(500)
      const firstRowBefore = document.querySelector('.nav-row')?.getBoundingClientRect().top ?? -1
      const here = document.querySelector('.nav-here')
      say('whereDay', here?.querySelector('.nav-here-day')?.textContent ?? '')
      say('whereHeadings', [...(here?.querySelectorAll('.nav-here-part') ?? [])].map(e => e.textContent?.replace('›', '').trim()))
      say('whereTags', [...(here?.querySelectorAll('.nav-here-tag') ?? [])].map(e => e.textContent))
      say('rowsMoved', Math.abs((document.querySelector('.nav-row')?.getBoundingClientRect().top ?? -1) - firstRowBefore))

      // And out of everything: the line has to empty as well as fill.
      const plain = all.indexOf('Five days ago')
      if (plain >= 0) {
        view.dispatch({ selection: { anchor: plain + 2 } })
        await settle(400)
        say('whereTagsAway', [...document.querySelectorAll('.nav-here-tag')].map(e => e.textContent))
        say('whereHeadingsAway', document.querySelectorAll('.nav-here-part').length)
      }

      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'sections') {
      // The curated half (D53): a fileset of filesets, read off disk, rendered
      // above the built-ins, with every entry kind resolving the way the format
      // says it does.
      let waited = 0
      while (waited < 8000 && document.querySelectorAll('.nav-section').length < 5) {
        await settle(200)
        waited += 200
      }

      const titleOf = (head: Element | null): string =>
        [...(head?.childNodes ?? [])]
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent ?? '')
          .join('')
          .trim()
      say('sections', [...document.querySelectorAll('.nav-section')].map(el =>
        titleOf(el.querySelector('.nav-head'))))

      // A pin that is not a section is a LOOSE row, above the groups: it is a
      // thing, not a container, and it has no header of its own.
      const loose = [...document.querySelectorAll('.nav-scroll > .nav-row-wrap')] as HTMLElement[]
      say('looseRows', loose.map(r => r.textContent?.trim() ?? ''))

      const groupOf = (title: string): Element | undefined =>
        [...document.querySelectorAll('.nav-section')].find(el =>
          (el.querySelector('.nav-head')?.textContent ?? '').includes(title),
        )
      const house = groupOf('The house')
      say('houseRows', [...(house?.querySelectorAll('.nav-row') ?? [])].map(r => r.textContent?.trim() ?? ''))
      say('summaries', [...document.querySelectorAll('.nav-detail')].map(e => e.textContent))
      say('missingSection', groupOf('A section that went away')?.querySelector('.nav-count')?.textContent ?? '')

      // The loose pin is the SAME ROW as the built-in one: same verb, same marks.
      const pinned = loose.find(r => (r.textContent ?? '').includes('What keeps coming up'))
      ;(pinned?.querySelector('.nav-row') as HTMLElement | undefined)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(900)
      say('caretAfterPinned', view.state.selection.main.head)
      say('marksAfterPinned', document.querySelectorAll('.tx-track-mark').length)

      // A section is a group, so its own header discloses it.
      say('houseRowsBefore', (house?.querySelectorAll('.nav-row') ?? []).length)
      ;(house?.querySelector('.nav-head') as HTMLElement | undefined)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(300)
      say('houseRowsAfter', (groupOf('The house')?.querySelectorAll('.nav-row:not([hidden])') ?? []).length)
      say('houseHidden', groupOf('The house')?.querySelector('[id^=nav-]')?.hasAttribute('hidden') ?? false)

      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'pin') {
      // THE ROUND TRIP (D53). A pin is an append to a markdown file, so the
      // test is: press the control, and find the line on disk — then find the
      // row back in the panel, having come from the file rather than from
      // whatever the renderer remembered doing.
      let waited = 0
      while (waited < 8000 && document.querySelectorAll('.nav-section').length < 5) {
        await settle(200)
        waited += 200
      }
      for (const head of [...document.querySelectorAll('.nav-head')]) {
        if (head.getAttribute('aria-expanded') === 'false') {
          (head as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        }
      }
      await settle(400)

      const sectionsBefore = document.querySelectorAll('.nav-section').length
      say('sectionsBefore', sectionsBefore)

      const rowIn = (title: string, text: string): HTMLElement | undefined => {
        const section = [...document.querySelectorAll('.nav-section')].find(el =>
          (el.querySelector('.nav-head')?.textContent ?? '').includes(title),
        )
        return [...(section?.querySelectorAll('.nav-row-wrap') ?? [])].find(w =>
          (w.textContent ?? '').includes(text),
        ) as HTMLElement | undefined
      }

      // Pin a subject.
      const subject = rowIn('Subjects', 'Recurring')
      const pin = subject?.querySelector('.nav-pin') as HTMLElement | undefined
      say('pinControlFound', pin !== undefined)
      pin?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(1200)

      // And a bookmark, so the file has two kinds in it.
      const mark = rowIn('Bookmarks', 'the-spot')
      ;(mark?.querySelector('.nav-pin') as HTMLElement | undefined)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(1200)

      // Pressing the same one again must not double it.
      const again = rowIn('Subjects', 'Recurring')
      ;(again?.querySelector('.nav-pin') as HTMLElement | undefined)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(1200)

      const curated = [...document.querySelectorAll('.nav-section')].find(el =>
        (el.querySelector('.nav-head')?.textContent ?? '').includes('Pinned'),
      )
      say('curatedTitle', [...(curated?.querySelector('.nav-head')?.childNodes ?? [])]
        .filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent ?? '').join('').trim())
      say('curatedRows', [...(curated?.querySelectorAll('.nav-row') ?? [])].map(r => r.textContent?.trim() ?? ''))
      say('sectionsAfter', document.querySelectorAll('.nav-section').length)

      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(800)
    }

    if (scene === 'unpin') {
      // A SECOND LAUNCH over the same notebook: the pins are read back from the
      // files, which is the part that matters — a pin that only existed in the
      // renderer's memory would look identical until the app was restarted.
      let waited = 0
      while (waited < 8000 && document.querySelectorAll('.nav-section').length < 5) {
        await settle(200)
        waited += 200
      }
      const pinnedSection = [...document.querySelectorAll('.nav-section')].find(el =>
        (el.querySelector('.nav-head')?.textContent ?? '').includes('Pinned'),
      )
      say('rowsAfterRestart', [...(pinnedSection?.querySelectorAll('.nav-row') ?? [])]
        .map(r => r.textContent?.trim() ?? ''))

      const toRemove = [...(pinnedSection?.querySelectorAll('.nav-row-wrap') ?? [])].find(w =>
        (w.textContent ?? '').includes('the-spot'),
      )
      const minus = toRemove?.querySelector('.nav-pin') as HTMLElement | undefined
      say('unpinFound', minus !== undefined)
      minus?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(1200)

      const after = [...document.querySelectorAll('.nav-section')].find(el =>
        (el.querySelector('.nav-head')?.textContent ?? '').includes('Pinned'),
      )
      say('rowsAfterUnpin', [...(after?.querySelectorAll('.nav-row') ?? [])].map(r => r.textContent?.trim() ?? ''))
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(800)
    }

    if (scene === 'open-document') {
      // MC5: a row that names a FILE opens that file in the editor.
      //
      // Every part of this used to be impossible at once — the pane had one
      // document, the handle was hard-coded to the stream, and a `.md` file
      // came back from `nav.open` as `unsupported` and was silently dropped
      // (D54). So the claim is the whole path: click, land, read, type, undo,
      // and go back to the stream you came from.
      let waited = 0
      while (waited < 8000 && document.querySelectorAll('.nav-section').length < 5) {
        await settle(200)
        waited += 200
      }
      for (const head of [...document.querySelectorAll('.nav-head')]) {
        if (head.getAttribute('aria-expanded') === 'false') {
          (head as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        }
      }
      await settle(400)

      const titleNow = (): string => document.querySelector('.titlebar .title')?.textContent ?? ''
      say('titleBefore', titleNow())
      say('streamText', live().state.doc.toString().includes('Yesterday'))

      const row = [...document.querySelectorAll('.nav-row')].find(r =>
        (r.textContent ?? '').includes('The offer letter'),
      ) as HTMLElement | undefined
      say('fileRowFound', row !== undefined)
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(1200)

      // THE LANDING: the note's own text, under the note's own name.
      say('titleAfter', titleNow())
      say('textAfter', live().state.doc.toString())
      say('caretAfter', live().state.selection.main.head)
      // A note has no days, so nothing draws a day separator through it.
      say('daySeparators', document.querySelectorAll('.tx-day').length)

      // An ORDINARY EDIT in an ordinary document: type, and undo it.
      live().dispatch({ selection: { anchor: live().state.doc.length } })
      live().dispatch({
        changes: { from: live().state.doc.length, insert: ' Signed on Tuesday.' },
        userEvent: 'input.type',
      })
      await settle(900)
      say('afterTyping', live().state.doc.toString())
      await window.tephra.doc.flush()

      const pane = (globalThis as unknown as { __tephra: { pane: { document: { undo: () => Promise<unknown> } } } }).__tephra.pane
      await pane.document.undo()
      await settle(900)
      say('afterUndo', live().state.doc.toString())
      // Flushed again, so the FILE is what the harness reads at the end: an
      // edit and its undo both have to arrive there, or "undoable" is a claim
      // about the screen only.
      await window.tephra.doc.flush()

      // And back where we came from, which is what a back stack is for.
      document.querySelector('.titlebar .nav')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await settle(1200)
      say('titleBack', titleNow())
      say('backInStream', live().state.doc.toString().includes('Yesterday'))

      // And the SAME file reached through its directory, which nobody curated.
      // Those entries resolve from the directory rather than from a day file's
      // depth, and getting that wrong makes a correct link report itself as
      // missing (D53).
      const derived = [...document.querySelectorAll('.nav-row')].find(
        r => (r.textContent ?? '').trim() === 'offer',
      ) as HTMLElement | undefined
      say('derivedRowFound', derived !== undefined)
      say('derivedMissing', derived?.querySelector('.nav-missing') !== null)
      derived?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(1400)
      say('afterDerived', live().state.doc.toString())

      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'emphasis') {
      // ⌘B and ⌘I through the REAL menu items, which is where the accelerators
      // live and therefore what a keystroke actually reaches.
      const doc = (): string => live().state.doc.toString()
      live().dispatch({ selection: { anchor: live().state.doc.length } })

      // From a bare caret: the markers open and the caret waits between them.
      say('bold1', await window.tephra.clickMenu('Bold'))
      await settle(500)
      say('afterBold', doc().slice(-8))
      say('caretInside', live().state.selection.main.head === live().state.doc.length - 2)

      // Typing lands between them, which is the whole point of the gesture.
      live().dispatch({
        changes: { from: live().state.selection.main.head, insert: 'loud' },
        userEvent: 'input.type',
      })
      await settle(500)
      say('typedInside', doc().slice(-12))

      // Select the word and press it again: the markers come off, not on.
      const at = doc().length
      live().dispatch({ selection: { anchor: at - 6, head: at - 2 } })
      await settle(200)
      await window.tephra.clickMenu('Bold')
      await settle(600)
      say('afterUnbold', doc().slice(-8))

      // And italic is the same gesture with one marker.
      await window.tephra.clickMenu('Italic')
      await settle(600)
      say('afterItalic', doc().slice(-8))
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(400)
    }

    if (scene === 'cmdclick') {
      // ⌘-click a sidebar row: the same there, in a window of its own.
      let waited = 0
      while (waited < 8000 && document.querySelectorAll('.nav-row').length < 2) {
        await settle(200)
        waited += 200
      }
      const row = [...document.querySelectorAll('.nav-row')].find(r =>
        (r.textContent ?? '').includes('The offer letter'),
      ) as HTMLElement | undefined
      say('rowFound', row !== undefined)
      say('titleBefore', document.querySelector('.titlebar .title')?.textContent ?? '')
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, metaKey: true }))
      await settle(2500)
      // THE POINT: this window did NOT move. The other one has it.
      say('titleAfter', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(3000)
    }

    if (scene === 'themepanel') {
      // M3: theme management is reached where a person looks for it, and it can
      // reach everything a theme HAS — including the panel colour, which was
      // derived in code and so unreachable by any amount of editing.
      say('clicked', await window.tephra.clickMenu('Settings…'))
      await settle(1500)
      say('panelOpen', document.querySelector('.theme-panel') !== null)
      say('colours', [...document.querySelectorAll('.field.swatch > span')].map(e =>
        (e.firstChild?.textContent ?? '').trim()))
      say('deleteDisabled', (document.querySelector('.theme-manage .link') as HTMLButtonElement | null)?.disabled)

      // THE POINT: change the panel colour and watch the sidebar follow.
      const before = getComputedStyle(document.documentElement).getPropertyValue('--surface-panel').trim()
      const hex = [...document.querySelectorAll('.field.swatch .hex')].find(
        (_, i) => i === 1,
      ) as HTMLInputElement | undefined
      if (hex !== undefined) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(hex, '#123456')
        hex.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(600)
      }
      // A field on the panel takes a ground lifted off the PANEL. Taking the
      // page's paper put light text on cream — unreadable, and only once
      // somebody made a panel that differs from their paper.
      const swatchHex = document.querySelector('.field.swatch .hex')
      say('fieldGround', swatchHex === null ? 'none' : getComputedStyle(swatchHex).backgroundColor)
      say('pageGround', getComputedStyle(document.documentElement).getPropertyValue('--surface').trim())
      say('panelBefore', before)
      say('panelAfter', getComputedStyle(document.documentElement).getPropertyValue('--surface-panel').trim())
      await settle(600)
    }

    if (scene === 'readonly') {
      // MC6: a file from outside the notebook opens to be READ, says so, and
      // the saying-so is the way to change it.
      await pane.goTo({ kind: 'document', id: arg })
      await settle(1400)

      const badge = (): HTMLElement | null => document.querySelector('.titlebar .badge.readonly')
      say('titleOutside', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('textOutside', live().state.doc.toString())
      say('badgeShown', badge()?.textContent ?? '(none)')

      // Typing must do nothing at all — not be accepted and refused later, when
      // what was typed is the only copy of it.
      live().dispatch({
        changes: { from: 0, insert: 'SHOULD NOT LAND' },
        userEvent: 'input.type',
      })
      await settle(500)
      say('afterTyping', live().state.doc.toString())

      // The badge IS the import gesture. One click, and this window is looking
      // at the copy — which is an ordinary document of ours.
      badge()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      await settle(2000)
      say('titleAfterImport', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('textAfterImport', live().state.doc.toString())
      say('badgeAfterImport', badge()?.textContent ?? '(none)')

      live().dispatch({
        changes: { from: live().state.doc.length, insert: '\nAnd a note of my own.\n' },
        userEvent: 'input.type',
      })
      await settle(800)
      say('typedIntoCopy', live().state.doc.toString())
      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'markpanel') {
      const click = (index: number): boolean => {
        const marks = document.querySelectorAll('.tx-handle')
        const el = marks[index] as HTMLElement | undefined
        if (el === undefined) return false
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        return true
      }
      const rows = (): unknown =>
        [...document.querySelectorAll('.mark-panel .mark-row')].map(r => ({
          name: r.querySelector('.mark-name')?.textContent ?? '',
          kind: r.querySelector('.mark-kind')?.textContent ?? '',
          actions: [...r.querySelectorAll('button')].map(b => b.textContent),
        }))

      // The overlapping mark: two subjects at one point, plus a bookmark.
      say('clickedOverlap', click(2))
      await settle(400)
      say('panelOpen', document.querySelector('.mark-panel') !== null)
      say('rowsForOverlap', rows())
      await settle(2200) // long enough to be looked at, not only measured

      // Rename the span this mark opens.
      const rename = [...document.querySelectorAll('.mark-panel button')].find(
        b => b.textContent === 'Rename',
      ) as HTMLButtonElement | undefined
      say('renameOffered', rename !== undefined)
      rename?.click()
      await settle(400)
      const input = document.querySelector('.prompt input') as HTMLInputElement | null
      say('prefilled', input?.value ?? '(no prompt)')
      if (input !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, 'Mortgage')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(120)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1000)
      }
      await window.tephra.doc.flush()
      say('tagsAfterRename', (await window.tephra.doc.spans({ kind: 'tag' })).map(t => t.name).sort())

      // THE BUG: the file was right and the panel still said the old name.
      // Re-open the same mark and read what it reports now.
      const again = document.querySelectorAll('.tx-handle')[2] as HTMLElement | undefined
      again?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      await settle(400)
      say('panelAfterRename', [...document.querySelectorAll('.mark-panel .mark-name')].map(e => e.textContent))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await settle(300)

      // And the bookmark's mark offers to remove it.
      say('clickedBookmark', click(0))
      await settle(400)
      say('rowsForBookmark', rows())
      const remove = [...document.querySelectorAll('.mark-panel button')].find(
        b => b.textContent === 'Remove',
      ) as HTMLButtonElement | undefined
      remove?.click()
      await settle(900)
      await window.tephra.doc.flush()
      say('anchorsAfter', (await window.tephra.doc.spans({ kind: 'anchor' })).map(a => a.name))
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(1200)
    }

    if (scene === 'unmark') {
      // Delete the handle the way any keymap would, and check that what was
      // drawn from the tag goes away with it.
      const handle = view.state.doc.toString().indexOf('￼')
      say('handleFound', handle)
      say('extentsBefore', document.querySelectorAll('.tx-tag').length)
      say('handlesBefore', document.querySelectorAll('.tx-handle').length)

      view.dispatch({ selection: { anchor: handle, head: handle + 1 } })
      await settle(200)
      view.dispatch({ changes: { from: handle, to: handle + 1, insert: '' }, userEvent: 'delete' })
      await settle(1200)

      say('extentsAfter', document.querySelectorAll('.tx-tag').length)
      say('handlesAfter', document.querySelectorAll('.tx-handle').length)
      say('tagSpansAfter', (await window.tephra.doc.spans({ kind: 'tag' })).length)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await window.tephra.doc.flush()
      await settle(1200)
    }

    if (scene === 'dump') {
      const w = (pane as unknown as { window?: { text: string; spans(k?: string): unknown[] } }).window
      say('bufferHead', view.state.doc.toString().slice(0, 120))
      say('windowTextHead', (w?.text ?? '(none)').slice(0, 120))
      say('rawInBuffer', view.state.doc.toString().includes('tephra:'))
      say('tagSpans', w?.spans('tag')?.length ?? -1)
      say('anchorSpans', w?.spans('anchor')?.length ?? -1)
      await settle(800)
    }

    if (scene === 'twotags') {
      // The reported bug, exactly: tag one phrase, then tag an OVERLAPPING one.
      // The second selection is made against a buffer that now carries a handle,
      // so its prose offsets no longer equal the file's byte offsets.
      const answer = async (item: string, text: string): Promise<boolean> => {
        if (!(await window.tephra.clickMenu(item))) return false
        await settle(400)
        const input = document.querySelector('.prompt input') as HTMLInputElement | null
        if (input === null) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(120)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(900)
        return true
      }
      const select = (text: string): boolean => {
        const from = view.state.doc.toString().indexOf(text)
        if (from === -1) return false
        view.dispatch({ selection: { anchor: from, head: from + text.length } })
        return true
      }

      say('firstSelected', select('participant has a finite'))
      await settle(300)
      say('firstTagged', await answer('Tag…', 'Foo'))

      say('secondSelected', select('finite shock limit'))
      await settle(300)
      say('secondTagged', await answer('Tag…', 'Bar'))
      await window.tephra.doc.flush()

      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      view.dispatch({ selection: { anchor: 0 } })
      await settle(400)
      say('onScreen', document.querySelector('.cm-content')?.textContent ?? '')
      await settle(1500)
    }

    if (scene === 'tagview') {
      const w = (pane as unknown as { window?: { spans(k?: string): unknown[] } }).window
      say('spansFromWindow', w?.spans('tag')?.length ?? 'no window')
      say('tagElements', document.querySelectorAll('.tx-tag').length)
      say('handleElements', document.querySelectorAll('.tx-handle').length)
      const frame = document.querySelector('.frame') as HTMLElement | null
      say('tagToken0', frame === null ? 'no frame' : getComputedStyle(frame).getPropertyValue('--tag-0'))
      say(
        'eachTag',
        [...document.querySelectorAll('.tx-tag')].map(e => ({
          text: (e.textContent ?? '').slice(0, 22),
          style: e.getAttribute('style'),
          colour: getComputedStyle(e).backgroundImage.match(/rgb\([^)]*\)/)?.[0] ?? '?',
        })),
      )
      const el = document.querySelector('.tx-tag') as HTMLElement | null
      if (el !== null) {
        const style = getComputedStyle(el)
        say('drawn', {
          style: el.getAttribute('style'),
          image: style.backgroundImage,
          size: style.backgroundSize,
          position: style.backgroundPosition,
        })
      }
      await settle(1500)
    }

    if (scene === 'branch') {
      const select = (text: string): boolean => {
        const from = view.state.doc.toString().indexOf(text)
        if (from === -1) return false
        view.dispatch({ selection: { anchor: from, head: from + text.length } })
        return true
      }

      say('selected', select('A longer argument, worth its own file because it has outgrown\nthe day it was written on.'))
      await settle(300)
      say('menuItemFound', await window.tephra.clickMenu('Branch Selection to Its Own File…'))
      await settle(400)
      const input = document.querySelector('.prompt input') as HTMLInputElement | null
      say('promptOpened', input !== null)
      if (input === null) { console.log('VERIFY done'); return }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'Titration curves')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(120)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle(1200)

      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      say('buffer', view.state.doc.toString())
      view.dispatch({ selection: { anchor: 0 } })
      await settle(500)
      say('linkRendered', document.querySelectorAll('.cm-link, .tx-link, a').length)
      say('onScreen', document.querySelector('.cm-content')?.textContent ?? '')
      await settle(2000)
    }

    if (scene === 'tag') {
      // Tagging and untagging, through the menu, the prompt, and the file.
      const answer = async (item: string, text: string): Promise<boolean> => {
        if (!(await window.tephra.clickMenu(item))) return false
        await settle(400)
        const input = document.querySelector('.prompt input') as HTMLInputElement | null
        if (input === null) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(120)
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(900)
        return true
      }

      const select = (text: string): boolean => {
        const from = view.state.doc.toString().indexOf(text)
        if (from === -1) return false
        view.dispatch({ selection: { anchor: from, head: from + text.length } })
        return true
      }

      const before = view.state.doc.toString()
      say('selected', select('Klein, Crawford and Alchian'))
      await settle(300)
      say('tagged', await answer('Tag…', 'House Deal'))
      await window.tephra.doc.flush()

      const tags = await window.tephra.doc.spans({ kind: 'tag' })
      say('tagNames', tags.map(t => t.name))

      // Markers touching the selection are revealed on purpose, so what the
      // badges look like can only be asked with the caret somewhere else.
      view.dispatch({ selection: { anchor: 0 } })
      await settle(2200) // long enough to be looked at, not only measured
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      say('boldSurvives', document.querySelector('.cm-content')?.textContent?.includes('Intrinsic S') === true)
      say('rawSyntaxVisible', (document.querySelector('.cm-content')?.textContent ?? '').includes('tephra:tag'))
      // `.tx-marker` was the badge MB replaced with a drawn mark; asking for it
      // is asking about a rendering that no longer exists.
      say('marks', document.querySelectorAll('.tx-handle').length)
      say('rules', document.querySelectorAll('.tx-tag').length)

      // And off again. The prompt arrives prefilled with the subject already
      // there, so answering it means pressing Enter.
      say('reselected', select('Klein, Crawford and Alchian'))
      await settle(300)
      say('untagged', await answer('Remove Tag…', 'House Deal'))
      await window.tephra.doc.flush()
      say('tagsAfter', (await window.tephra.doc.spans({ kind: 'tag' })).map(t => t.name))

      // The round trip is exact: the text is byte-for-byte what it started as.
      say('restoredExactly', view.state.doc.toString() === before)
      await settle(2500)
    }

    if (scene === 'bookmark-bold') {
      // The reported case exactly: bookmark a boldfaced phrase at the very
      // start of its line, which is where a comment would otherwise swallow
      // the whole line's formatting.
      const target = view.state.doc.toString().indexOf('**Intrinsic')
      view.dispatch({ selection: { anchor: target } })
      await settle(300)
      say('caretAt', target)
      say('menuItemFound', await window.tephra.clickMenu('Bookmark\u2026'))
      await settle(400)
      const input = document.querySelector('.prompt input') as HTMLInputElement | null
      if (input === null) { say('promptOpened', false); console.log('VERIFY done'); return }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'intrinsic-s')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(120)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle(900)
      await window.tephra.doc.flush()

      // Park the caret away so nothing is revealed by proximity, then look at
      // what is actually on screen.
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      await settle(400)
      // Computed weight of the element actually containing the word. CodeMirror
      // styles through a generated class, so looking for `<strong>` or an inline
      // font-weight finds nothing whether or not the bold survived.
      const bolded = [...document.querySelectorAll('.cm-line span')].find(
        el => (el.textContent ?? '').includes('Intrinsic'),
      )
      say('boldWeight', bolded === undefined ? 'NO SPAN' : getComputedStyle(bolded).fontWeight)
      say('markerBadge', document.querySelector('.tx-marker')?.textContent ?? 'NONE')
      say('rawSyntaxVisible', (document.querySelector('.cm-content')?.textContent ?? '').includes('tephra:mark'))
      say('asterisksVisible', (document.querySelector('.cm-content')?.textContent ?? '').includes('**'))
      say('caretNow', view.state.selection.main.head)
      await settle(3000)
    }

    if (scene === 'bookmark') {
      // The gesture, end to end: type, place the caret, invoke the command the
      // way the menu does, answer the prompt, and check what reached the file.
      view.dispatch({
        changes: { from: view.state.doc.length, insert: 'A passage worth marking.\n' },
        userEvent: 'input.type',
      })
      await settle(400)

      const target = view.state.doc.toString().indexOf('worth marking')
      view.dispatch({ selection: { anchor: target } })
      await settle(300)
      say('caretPlaced', target)

      // The menu item itself, not a shortcut to the handler beneath it.
      say('menuItemFound', await window.tephra.clickMenu('Bookmark\u2026'))
      await settle(400)
      const prompt = document.querySelector('.prompt input') as HTMLInputElement | null
      say('promptOpened', prompt !== null)
      if (prompt === null) { console.log('VERIFY done'); return }

      // Typed, then Enter — the way a person answers it.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(prompt, 'the-marked-passage')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      await settle(120)
      prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle(900)

      say('promptClosed', document.querySelector('.prompt') === null)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')

      // The third way in. A native context menu cannot be asserted from the
      // renderer — it is an OS menu, not DOM — so what is checked here is that
      // the editor hands the gesture to main rather than letting Chromium show
      // its own. The menu's CONTENTS need no separate test: it is built from the
      // same `RANGE_COMMANDS` the menu bar is, which is the point of the list.
      const content = document.querySelector('.cm-content') as HTMLElement | null
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      content?.dispatchEvent(event)
      say('contextMenuHandled', event.defaultPrevented)

      await window.tephra.doc.flush()
      const anchors = await window.tephra.doc.spans({ kind: 'anchor' })
      say('anchors', anchors.map(a => a.name))
      say('resolves', (await window.tephra.doc.resolveAnchor('the-marked-passage')) !== null)
    }

    if (scene === 'summary') {
      // Compact: a big day's buffer would be a megabyte on one line of stdout.
      const text = view.state.doc.toString()
      say('summary', {
        length: text.length,
        head: text.slice(0, 48),
        tail: text.slice(-48),
        location: pane.location,
      })
    }

    if (scene === 'edit-again') {
      // A second, different edit, so the previous text exists only in history.
      const at = view.state.doc.length
      view.dispatch({
        changes: { from: 0, to: at, insert: 'REPLACED-ENTIRELY: the earlier words are gone from the file.\n' },
        userEvent: 'input.type',
      })
      await settle(400)
      say('replaced', view.state.doc.toString().includes('REPLACED-ENTIRELY'))
    }

    if (scene === 'crash') {
      // Type, wait past the WAL batch but nowhere near the file tier, and die.
      // TEPHRA_EXIT=abrupt makes app.exit() skip before-quit entirely, which is
      // the closest thing to a crash that can be arranged on purpose.
      const at = view.state.doc.length
      view.dispatch({
        changes: { from: at, insert: 'SURVIVES-THE-CRASH: a sentence typed and never saved.\n' },
        userEvent: 'input.type',
      })
      await settle(300)
      say('typed', view.state.doc.toString().includes('SURVIVES-THE-CRASH'))
    }

    if (scene === 'undo-away') {
      // FALSIFICATION: App.tsx claims that when undo lands outside the loaded
      // region "the Pane is told to go there". Nothing in the renderer does
      // that. Type on today, navigate somewhere that does not contain today,
      // undo, and see whether anything at all happens on screen.
      const at = view.state.doc.length
      view.dispatch({ changes: { from: at, insert: 'MARKER-TEXT ' }, userEvent: 'input.type' })
      await settle(600)
      await window.tephra.doc.flush()
      say('typedOnToday', view.state.doc.toString().includes('MARKER-TEXT'))

      const older = document.querySelectorAll('.nav-dates button')
      ;(older[older.length - 1] as HTMLButtonElement | undefined)?.click()
      await settle(1200)
      const away = live()
      say('navigatedAway', {
        location: pane.location,
        windowHasMarker: away.state.doc.toString().includes('MARKER-TEXT'),
      })

      const before = away.state.doc.toString()
      // Through the MENU, which is the only path a person has — calling
      // doc.undo() directly would bypass the very code being tested.
      const change = await window.tephra.clickMenu('Undo')
      await settle(1200)
      const after = live().state.doc.toString()
      say('undoReturnedAChange', change !== null)
      say('afterUndo', {
        bufferChanged: before !== after,
        locationChanged: JSON.stringify(pane.location),
      })

      // And the thing that actually matters: did the undo reach the file?
      await window.tephra.doc.flush()
      say('flushed', true)
    }

    if (scene === 'anomalies') {
      const found = await window.tephra.doc.anomalies()
      say('reported', found.map(a => `${a.kind}@${a.date ?? '-'}:${a.line ?? '-'}${a.subject === null ? '' : ' ' + a.subject}`))
      const badge = [...document.querySelectorAll('.titlebar button')].find(b =>
        (b.textContent ?? '').includes('note'),
      ) as HTMLButtonElement | undefined
      say('badgeText', badge?.textContent?.trim() ?? 'ABSENT')
      badge?.click()
      await settle(500)
      say('panelOpen', document.querySelector('.anomaly-panel') !== null)
      say('entries', document.querySelectorAll('.anomaly-panel li').length)
      await settle(4000)
    }

    if (scene === 'panel') {
      say('opened', await window.tephra.clickMenu('Typography…'))
      await settle(4000)
    }

    if (scene === 'theme') {
      const themes = await window.tephra.doc.listThemes()
      say('themesOnDisk', themes.map(t => `${t.name}:${t.measure}ch/${t.size}px`))
      const root = document.documentElement
      say('appliedTokens', {
        surface: root.style.getPropertyValue('--surface'),
        text: root.style.getPropertyValue('--text'),
        accent: root.style.getPropertyValue('--accent'),
        face: root.style.getPropertyValue('--font-body').slice(0, 24),
        theme: root.dataset.theme ?? '',
      })
      const measured = (): unknown => {
        const content = document.querySelector('.cm-content')
        if (content === null) return null
        const style = getComputedStyle(content)
        return {
          measurePx: Math.round(content.getBoundingClientRect().width - parseFloat(style.paddingRight)),
          fontSize: getComputedStyle(document.querySelector('.cm-line') as Element).fontSize,
        }
      }
      say('beforePanel', measured())
      say('panelOpened', await window.tephra.clickMenu('Typography…'))
      await settle(600)
      say('panelPresent', document.querySelector('.theme-panel') !== null)
      say('consequence', document.querySelector('.theme-consequence')?.textContent?.trim() ?? '')
      await settle(4000)
    }

    if (scene === 'chrome') {
      const bar = document.querySelector('.titlebar')
      const app = document.querySelector('.app')
      say('titlebar', {
        present: bar !== null,
        rect: bar === null ? null : {
          top: Math.round(bar.getBoundingClientRect().top),
          height: Math.round(bar.getBoundingClientRect().height),
        },
        buttons: [...document.querySelectorAll('.titlebar button')].map(b => (b.textContent ?? '').trim()),
        inputs: document.querySelectorAll('.titlebar input').length,
      })
      const chain: unknown[] = []
      let node: Element | null = document.querySelector('.cm-scroller')
      while (node !== null) {
        chain.push({
          el: node.className.toString().slice(0, 28) || node.tagName,
          scrollTop: Math.round(node.scrollTop),
          scrollH: Math.round(node.scrollHeight),
          clientH: Math.round(node.clientHeight),
        })
        node = node.parentElement
      }
      say('scrollChain', chain)
      say('page', {
        appHeight: Math.round(app?.getBoundingClientRect().height ?? -1),
        appTop: Math.round(app?.getBoundingClientRect().top ?? -1),
        innerHeight: window.innerHeight,
        scrollY: window.scrollY,
      })
      await settle(3000)
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
        const v = live()
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

      const now = live()
      say('after', {
        docLength: now?.state.doc.length ?? -1,
        location: pane.location,
        firstLine: now?.state.doc.toString().slice(0, 40) ?? '',
        editorsInDom: document.querySelectorAll('.cm-editor').length,
        linesInDom: document.querySelectorAll('.cm-line').length,
      })
      say('failures', failures)
    }

    if (scene === 'reopen') {
      const head = view.state.selection.main.head
      say('buffer', view.state.doc.toString())
      say('landedAt', head)
      say('docLength', view.state.doc.length)
      // What a reader sees above the caret is the point of landing there: the
      // append position with the work already done visible above it.
      say('textAbove', view.state.doc.toString().slice(Math.max(0, head - 18), head))
      say('location', pane.location)
    }
  } catch (err) {
    say('ERROR', err instanceof Error ? err.message : String(err))
  }
  console.log('VERIFY done')
}

interface EditorViewLike {
  state: {
    doc: { toString(): string; length: number }
    selection: { main: { head: number; from: number; to: number; empty: boolean } }
  }
  dispatch(spec: unknown): void
  /** Where a position is on screen. Used to check what a reader can see. */
  coordsAtPos(at: number): { top: number; bottom: number; left: number } | null
  posAtCoords(coords: { x: number; y: number }): number | null
  readonly viewport: { from: number; to: number }
}
interface PaneLike {
  readonly location: unknown
  /**
   * Structural, like the rest of this file: the harness drives the real Pane.
   *
   * A window's location is a document **or a query** (ML3), so this takes both.
   */
  goTo(target: { kind: 'document'; id: unknown } | { kind: 'links' }): Promise<void>
}
