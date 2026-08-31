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

  /** The live view, asked for each time: navigation rebinds the surface. */
  const live = (): EditorViewLike =>
    (globalThis as unknown as { __tephra: { view: EditorViewLike } }).__tephra.view

  try {
    await settle(1800) // open, bind, restore, and let background growth finish

    const handle = (globalThis as unknown as {
      __tephra: { view?: EditorViewLike; pane?: PaneLike }
    }).__tephra
    const view = handle.view
    const pane = handle.pane
    if (view === undefined || view === null || pane === undefined || pane === null) {
      say('ERROR', `view=${view != null} pane=${pane != null}`)
      if (me.id <= 1) console.log('VERIFY done')
      return
    }

    // A window that is not the first is a PARTICIPANT, not a driver: it reports
    // what it is showing and lets the scene in window 1 do the asking. It never
    // says `done` — ending the run is the first window's to decide.
    if (me.id > 1) {
      say('name', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('text', live().state.doc.toString())
      // And again later, so that a change window 1 makes to the SAME document
      // can be seen arriving here — which is the whole claim (D45, MC6).
      await settle(6000)
      say('nameLater', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('textLater', live().state.doc.toString())
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
      const live = (): EditorViewLike =>
        live()
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

      const live = (): EditorViewLike =>
        live()
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
      say('menuItemFound', await window.tephra.clickMenu('Branch to Its Own File…'))
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
  /** Structural, like the rest of this file: the harness drives the real Pane. */
  goTo(target: { kind: 'document'; id: unknown }): Promise<void>
}
