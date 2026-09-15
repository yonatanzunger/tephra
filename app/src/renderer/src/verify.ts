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
   * Where each mark sits relative to the words it belongs to, in pixels of
   * baseline — 0 meaning *on them*.
   *
   * **Reported from use** (2026-09-15): *the baseline of the owner, due date and
   * "do today" button are slightly off. Just enough off to drive me nuts.* The
   * geometry checks before this measured each box's MIDDLE, and centring boxes is
   * not aligning type: two faces at two sizes centred on one line sit a couple of
   * pixels apart, which is the amount that reads as sloppy.
   *
   * **A zero-height inline box sits ON the baseline**, so its `top` is the
   * baseline's y. It is appended, measured and removed, so nothing it measures
   * changes by being measured — and each mark is compared to **its own row**,
   * because the mark you want to check may be on a row the first one is not.
   */
  const baselineDeltas = (marks: readonly string[]): Record<string, number | null> => {
    const at = (el: Element): number => {
      const probe = document.createElement('span')
      probe.style.cssText = 'font-size:0;line-height:0;vertical-align:baseline;display:inline'
      probe.textContent = '\u200b'
      el.appendChild(probe)
      const y = probe.getBoundingClientRect().top
      probe.remove()
      return y
    }
    const out: Record<string, number | null> = {}
    for (const mark of marks) {
      const found = document.querySelector(`.todo-row ${mark}`)
      const words = found?.closest('.todo-row')?.querySelector('.todo-text')
      out[mark.replace(/^\./, '')] = found == null || words == null
        ? null
        : Math.round(at(found) - at(words))
    }
    return out
  }

  /**
   * Photograph the app *now*, because now is the moment this scene means.
   *
   * **The picture used to be taken after the scene ended**, which looked right
   * and was not. Within about 200ms of a scene finishing, the app's rendered
   * state goes back to its default — the stream, on today — and `window.tephra`
   * loses the pane the scene put there, which is what a React tree being
   * replaced looks like from outside. No navigation, no renderer crash and no
   * day roll: all three were instrumented and none fired. **It is not
   * root-caused**, only fenced off.
   *
   * The tell, and it is worth writing down because it cost an hour: every shot
   * across a whole session was *byte-identical* — the same 31,257 bytes, nine
   * times, across three different scenes. That reads as a broken capture, and it
   * is the opposite: the capture works perfectly and keeps photographing the
   * same reliably-restored moment.
   *
   * A scene that never calls this still gets one at the end, as before — so
   * every existing scene keeps whatever picture it had.
   */
  const shot = async (): Promise<void> => {
    await settle(250)
    console.log('VERIFY shot')
    await settle(450)
  }

  /**
   * Which of these class names no stylesheet rule mentions.
   *
   * **Asked of the stylesheet, not of a computed value**, which is the lesson
   * note 50 records: inferring *unstyled* from a 16px font is wrong twice over,
   * since a matter's name legitimately IS 16px at the notebook's reading size,
   * and an element drawn with a gradient has no meaningful font size at all.
   * Whether a rule exists is the actual question, and it can be asked directly.
   *
   * **Extracted because this is the second surface to need it**, and the failure
   * it catches has now happened three times — a rewritten CSS region dropping
   * rules twice, and a stale duplicate winning on source order once. A
   * stylesheet has no compiler, so the only rule that fails loudly is one that
   * changes something somebody happens to be watching.
   */
  const unstyled = (pattern: RegExp, names: readonly string[]): readonly string[] => {
    const written = new Set<string>()
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList | null = null
      try {
        rules = sheet.cssRules
      } catch {
        continue // a sheet from elsewhere; not ours to read
      }
      for (const rule of [...(rules ?? [])]) {
        const selector = (rule as CSSStyleRule).selectorText
        if (typeof selector !== 'string') continue
        for (const found of selector.matchAll(pattern)) written.add(found[1] as string)
      }
    }
    return names.filter(one => !written.has(one))
  }

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
        // **Which of the two causes**, on the next failure (m3's capture check,
        // flaked seven times). `mounts` rising across the key press means the
        // surface remounted and the row went with it; `doneSaw` with an empty
        // `wanted` means it committed nothing. Read them before theorising.
        say('mountsBefore', (window as unknown as { __todoMounts?: number }).__todoMounts ?? -1)
        key(arg === 'escape' ? 'Escape' : 'Enter')
        say('valueAfterKey', row()?.value ?? 'gone')
        await settle(2500)
        say('mountsAfter', (window as unknown as { __todoMounts?: number }).__todoMounts ?? -1)
        say('doneSaw', JSON.stringify((window as unknown as { __doneSaw?: unknown }).__doneSaw ?? null))
        say('rowGone', row() === null)
        say('leftBehind', document.querySelectorAll('.todo-row:not(.todo-adding)').length)
        // **The WRITER's side, which was the gap.** The reader's report said the
        // list was empty and could not say why — the instrumentation was all in
        // the window that asks, and none in the window that commits. These three
        // separate *the commit never happened* from *it happened and the reader
        // cannot see it*, and the error surface is this window's own: `appError`
        // was only ever read in the driver, so a failure here was silent.
        say('errorHere', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
        {
          const list = await window.tephra.todo.which()
          const day = await window.tephra.todo.today(list)
          say('listHere', list as unknown as string)
          say('itemsHere', (await window.tephra.todo.items(list, day)).map(one => one.text))
          say('daysHere', (await window.tephra.todo.days(list)) as unknown as string[])
          // **Does a write from this window resolve at all?** Every symptom so
          // far fits `todo.add` hanging: no item, no error, and `settle` never
          // called — so the driver never gets its link. A hang and a write that
          // silently does nothing look identical from outside; this tells them
          // apart, which nothing else has.
          // **Only in the committed half.** The abandoned half asserts the list
          // stays empty, and a probe that writes an item fails it — which it
          // did, and which was my contamination rather than a finding.
          if (arg !== 'escape') say('addResolves', await Promise.race([
            window.tephra.todo.add(list, 'probe: does a write resolve').then(() => 'resolved'),
            new Promise(r => setTimeout(() => r('HUNG'), 4000)),
          ]).catch(e => `threw ${String(e).slice(0, 80)}`))
          if (arg !== 'escape') {
            say('afterProbe', (await window.tephra.todo.items(list, day)).map(one => one.text))
          }
        }
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

      // **One mechanism now** (D67): CodeMirror's drawn selection layer came
      // with vim and went with it, so what has to be visible is the browser's
      // own selection — and "invisible" is the failure this scene exists for,
      // since a selection that cannot be seen looks exactly like one that did
      // not happen.
      const line = document.querySelector('.cm-line')
      say('selectionShown', {
        drawnLayers: document.querySelectorAll('.cm-selectionBackground').length,
        text: globalThis.getSelection?.()?.toString() ?? '',
        colour: line === null ? null : getComputedStyle(line, '::selection').backgroundColor,
      })
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
      // **Which are behind you, in order.** The band said *2 days ago* and the
      // pane says *8 Sep* — absolute, because a date column that read in
      // relative words could not line up (MH4). So the claim about ORDER is
      // asked of the overdue mark rather than of the wording.
      say('band', [...document.querySelectorAll('.hz-row')].map(
        b => b.querySelector('.hz-on')?.classList.contains('hz-past') ?? false,
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
      // **Put down**, which is what setting `[>]` became (MH5): the glyph is the
      // consequence of giving the thing a home, not a state you set on its own.
      ;([...document.querySelectorAll('.row-menu button')].find(
        b => (b.textContent ?? '').trim() === 'Move to backlog',
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
        // **Below now, not beside** (MH4 amending D42's placement): the band
        // moved out of the gutter into a pane of its own, which is what freed
        // the gutter for annotations. The no-reflow rule it was obeying is
        // satisfied better by a fixed pane than by a rail that came and went.
        say('railBelow', (document.querySelector('.todo-horizon')?.getBoundingClientRect().top ?? 0)
          >= (document.querySelector('.todo-list')?.getBoundingClientRect().top ?? 0))
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
      // **Instrumented, because this check has flaked three times and the
      // leading theory was wrong.** An empty `items` has two very different
      // causes that it cannot tell apart: the second window never committed, or
      // it committed under a different day than this read looks under. These
      // say which — every day the list holds, and what is on each.
      //
      // The seeding race (note 61) was the suspect and is not the answer: the
      // gate landed, and this failed again afterwards. So the next failure
      // should arrive with its own evidence rather than another hypothesis.
      {
        const days = await window.tephra.todo.days(list)
        const perDay: Record<string, number> = {}
        for (const day of days) {
          perDay[day as unknown as string] = (await window.tephra.todo.items(list, day)).length
        }
        say('whereTheItemsAre', { readAt: today, days: perDay })
      }
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
      say('railText', document.querySelector('.hz-what')?.textContent ?? '')
      say('railHasAnchor', document.querySelector('.todo-horizon a') !== null)

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

    if (scene === 'twoshapes') {
      // **Two shapes of one kind** (MT7). A `.todo` directory is a daily list —
      // carried, walked, with a working set that turns over. A single
      // `.todo.md` is an overall one, which does not turn over, so the controls
      // that only mean something for a list that does have nothing to attach to.
      say('made', await window.tephra.clickMenu('New Task List\u2026'))
      await settle(1600)
      const lists = (await window.tephra.nav.documents()).filter(d =>
        (d.id as unknown as string).endsWith('.todo.md'),
      )
      say('itsName', (lists[0]?.id as unknown as string) ?? '')
      await pane.goTo({ kind: 'document', id: lists[0]?.id as never })
      await settle(1200)
      // The todo surface, not the markdown editor: `surfaceFor` routes by kind
      // and a `.todo.md` is a todo.
      say('drawnAsAList', document.querySelector('.todo') !== null)
      say('notAnEditor', document.querySelector('.cm-content') === null)
      // No walk and no scrub: both are about a list that turns over.
      say('noWalk', document.querySelector('.todo-walk-start') === null)
      say('noScrub', document.querySelector('.todo-scrub') === null)
      // But every verb, because the grammar is the same one.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
      await settle(400)
      const f = document.querySelector('.todo-field') as HTMLInputElement | null
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        f,
        'the one about tephra #writing',
      )
      f?.dispatchEvent(new Event('input', { bubbles: true }))
      f?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await settle(1400)
      say('rows', [...document.querySelectorAll('.todo-row .todo-text')].map(t => (t.textContent ?? '').trim()))
      say('tags', [...document.querySelectorAll('.todo-tag')].map(t => (t.textContent ?? '').trim()))
      // **On screen AND on disk**, which is the pair that came apart: the item
      // reached the right file under a segment named for a day, and the read
      // under the one segment found nothing.
      say('keyShown', await window.tephra.todo.today(lists[0]?.id as never))
      say(
        'itemsFromMain',
        (await window.tephra.todo.items(lists[0]?.id as never, await window.tephra.todo.today(lists[0]?.id as never)))
          .length,
      )

      // And the distinguished list is still the distinguished list.
      say('tasksIs', await window.tephra.todo.which())
      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(800)
    }

    if (scene === 'fields') {
      // **The fields are the item now** (D85, MT8), so the gestures that change
      // one are their own — a tag comes off at its chip, a date and an owner at
      // the row's menu. Setting either is still typing, which the row's field
      // reads with the entry grammar; what typing cannot do is take one off.
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 20_000 && document.querySelectorAll('.todo-row').length < 1) {
        await settle(200)
        waited += 200
      }
      const rows = (): HTMLElement[] => [...document.querySelectorAll('.todo-row')] as HTMLElement[]
      const seen = (sel: string): string[] =>
        [...document.querySelectorAll(sel)].map(e => (e.textContent ?? '').trim())
      const menu = async (row: number, label: string): Promise<boolean> => {
        const box = rows()[row]?.getBoundingClientRect()
        rows()[row]?.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: Math.round((box?.left ?? 0) + 90),
          clientY: Math.round((box?.top ?? 0) + 10),
        }))
        await settle(400)
        const entry = [...document.querySelectorAll('.row-menu button')].find(
          b => (b.textContent ?? '').trim().startsWith(label),
        ) as HTMLElement | null
        entry?.click()
        await settle(900)
        return entry !== null
      }

      // **The sentence without its annotation**, which is what a row's words
      // are: `for` sits inside the text span, where words attached to a sentence
      // go (`todo-reason` is its neighbour), so reading the span gets both.
      say('rows', [...document.querySelectorAll('.todo-row .todo-text')].map(e => {
        const copy = e.cloneNode(true) as HTMLElement
        copy.querySelector('.todo-for')?.remove()
        return (copy.textContent ?? '').trim()
      }))
      // **What a docket generated says it is for**, and it carries ONE tag.
      say('for', seen('.todo-for'))
      say('tags', seen('.todo-tag'))
      say('dues', seen('.todo-due'))
      say('owners', seen('.todo-owner'))
      // **The row this scene builds has every mark on it**, which the geometry
      // scene's fixture does not — so this is where the owner's baseline is
      // actually asserted (reported from use, 2026-09-15).
      say('baselines', baselineDeltas([
        '.todo-tag', '.todo-due', '.todo-owner', '.todo-pick', '.todo-for',
      ]))

      // A tag comes off at its chip — the row's text no longer holds it, so
      // deleting it from the sentence is not a thing that can be done.
      ;(document.querySelector('.todo-tag') as HTMLElement | null)?.click()
      await settle(1200)
      say('tagsAfterClick', seen('.todo-tag'))

      // A date comes off at the menu. Setting one is `DUE friday` in the field.
      say('menuEntries', seen('.row-menu button'))
      say('clearedDue', await menu(0, 'No due date'))
      say('duesAfter', seen('.todo-due'))

      // And an owner, both ways round. **Taken off first**, because the row
      // arrives with one: the entry reads *Reassign (AV)…* while somebody has
      // it and *Who has this…* while nobody does, which is the menu saying what
      // it will do rather than what the field is called.
      say('clearedOwner', await menu(0, 'Nobody has this'))
      say('ownersCleared', seen('.todo-owner'))
      say('askedOwner', await menu(0, 'Who has this'))
      const field = document.querySelector('.todo-owner-field') as HTMLInputElement | null
      say('ownerFieldOpen', field !== null)
      if (field !== null) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'Sam')
        field.dispatchEvent(new Event('input', { bubbles: true }))
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        await settle(1200)
      }
      say('ownersAfterTyping', seen('.todo-owner'))

      // **And the file says the same thing**, which is the half a screen cannot
      // show: fields under the checkbox, and the sentence alone on its line.
      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'notes') {
      // **Prose about the item, not more task.** Indented continuation lines,
      // which is markdown's own way of attaching a paragraph to a list item —
      // and nothing in them is parsed.
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 20_000 && document.querySelectorAll('.todo-row').length < 1) {
        await settle(200)
        waited += 200
      }
      say('rows', document.querySelectorAll('.todo-row').length)
      say('shown', [...document.querySelectorAll('.todo-note')].map(n => (n.textContent ?? '').trim()))
      // **An item with no notes costs no space.** The element is not there at
      // all: one holding an invisible control still holds its height, and on a
      // list of twenty tasks that is a page of space between the words.
      say('noteBlocks', document.querySelectorAll('.todo-notes').length)
      {
        const rows = [...document.querySelectorAll('.todo-row')] as HTMLElement[]
        const gap = (a: number, b: number) =>
          Math.round(rows[b]!.getBoundingClientRect().top - rows[a]!.getBoundingClientRect().bottom)
        say('gapAfterNoted', gap(0, 1))
        say('gapAfterBare', rows.length > 2 ? gap(1, 2) : null)
      }

      // Add one, the way a person does: from the row's menu, which is where the
      // acts outside the daily rhythm live.
      const bare = document.querySelectorAll('.todo-row')[1] as HTMLElement | undefined
      const box = bare?.getBoundingClientRect()
      bare?.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: Math.round((box?.left ?? 0) + 90),
        clientY: Math.round((box?.top ?? 0) + 10),
      }))
      await settle(500)
      say('menuHasNote', [...document.querySelectorAll('.row-menu button')].map(b => b.textContent ?? ''))
      ;([...document.querySelectorAll('.row-menu button')].find(
        b => (b.textContent ?? '').startsWith('Add Note'),
      ) as HTMLElement | null)?.click()
      await settle(400)
      const field = document.querySelector('.todo-note-field') as HTMLInputElement | null
      say('opened', field !== null)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        field,
        'Called back — Thursday. #house DUE 2026-09-30',
      )
      field?.dispatchEvent(new Event('input', { bubbles: true }))
      field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await settle(1400)
      say('afterAdding', [...document.querySelectorAll('.todo-note')].map(n => (n.textContent ?? '').trim()))
      // **Nothing in a note is parsed**: the hash is a hash and the date is a date.
      say('rowsAfter', document.querySelectorAll('.todo-row').length)
      say('tagsAfter', [...document.querySelectorAll('.todo-tag')].map(t => (t.textContent ?? '').trim()))
      say('dueAfter', [...document.querySelectorAll('.todo-due')].map(d => (d.textContent ?? '').trim()))
      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(800)
    }

    if (scene === 'printhere') {
      // **Print prints what the WINDOW is showing.** It asked the stream for
      // its extent whatever was on screen, so printing from a note printed the
      // notebook — a command that reads as "print this" and did not. Only the
      // stream has days to choose between, which is why only the stream is
      // asked which ones.
      const note = (await window.tephra.nav.documents()).find(d =>
        (d.id as unknown as string).includes('covenants'),
      )
      await pane.goTo({ kind: 'document', id: note?.id as never })
      await settle(900)
      say('showing', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('clicked', await window.tephra.clickMenu('Print\u2026'))
      await settle(1200)
      // No dialog: there are no days to choose between in a note.
      say('askedWhichDays', document.querySelector('.prompt.range') !== null)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(1200)
    }

    if (scene === 'sticky') {
      // **The list's arrangement outlives the window** (MT4a, made sticky).
      // Reported home the way the theme is, because it is the same
      // kind of thing: machine-local soft state that a window forgetting makes
      // into a rare surprise, which is worse than a frequent one.
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 20_000 && document.querySelector('.todo-views') === null) {
        await settle(200)
        waited += 200
      }
      const pressed = () =>
        [...document.querySelectorAll('.todo-views button')]
          .filter(b => b.getAttribute('aria-pressed') === 'true')
          .map(b => (b.textContent ?? '').trim())
      say('atFirst', pressed())
      ;([...document.querySelectorAll('.todo-views button')].find(
        b => (b.textContent ?? '').trim() === 'by tag',
      ) as HTMLElement | null)?.click()
      await settle(700)
      say('afterClick', pressed())
      // It has to reach main to survive anything, so ask main what it holds.
      say('reported', (await window.tephra.win.info()).listView)
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(700)
    }

    if (scene === 'mt6') {
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 20_000 && document.querySelectorAll('.todo-row').length < 1) {
        await settle(200)
        waited += 200
      }
      // **The drawer** (T14): counted on the outside, so how much you have put
      // down is visible without opening it.
      say('drawerLabel', document.querySelector('.todo-drawer-open')?.textContent?.trim() ?? '')
      ;(document.querySelector('.todo-drawer-open') as HTMLElement | null)?.click()
      await settle(400)
      say('drawer', [...document.querySelectorAll('.todo-drawer .todo-resolved-row')].map(r =>
        (r.querySelector('.todo-resolved-text')?.textContent ?? '').trim(),
      ))

      // **T8's other half**: what was finished under this tag on an earlier day.
      ;([...document.querySelectorAll('.todo-views button')].find(
        b => (b.textContent ?? '').trim() === 'by tag',
      ) as HTMLElement | null)?.click()
      await settle(500)
      const house = [...document.querySelectorAll('.todo-group')].find(g =>
        (g.querySelector('.todo-group-name')?.textContent ?? '').startsWith('house'),
      )
      say('liveUnderHouse', [...(house?.querySelectorAll('.todo-row .todo-text') ?? [])].map(t =>
        (t.textContent ?? '').trim(),
      ))
      say('tailUnderHouse', [...(house?.querySelectorAll('.todo-resolved-row') ?? [])].map(r =>
        (r.querySelector('.todo-resolved-text')?.textContent ?? '').trim(),
      ))
      say('tailWhen', [...(house?.querySelectorAll('.todo-resolved-when') ?? [])].map(w =>
        (w.textContent ?? '').trim(),
      ))
      // **Scrubbing to a past day** (T7's flow 7): rare, read-only, cheap —
      // cheap because a past working set is not reconstructed, it is a file.
      ;([...document.querySelectorAll('.todo-views button')].find(
        b => (b.textContent ?? '').trim() === 'by time',
      ) as HTMLElement | null)?.click()
      await settle(300)
      say('todayRows', [...document.querySelectorAll('.todo-row .todo-text')].map(t => (t.textContent ?? '').trim()))
      const step = (which: string) =>
        [...document.querySelectorAll('.todo-scrub button')].find(
          b => (b.textContent ?? '').trim() === which,
        ) as HTMLElement | undefined
      step('\u2039')?.click()
      await settle(900)
      say('pastRows', [...document.querySelectorAll('.todo-row .todo-text')].map(t => (t.textContent ?? '').trim()))
      say('readOnly', document.querySelector('.todo')?.getAttribute('data-past') ?? '')
      // The verbs are absent rather than refusing: a control that says no is a
      // control you learn to distrust.
      say('noAdd', document.querySelector('.todo-addrow') === null)
      say('noWalk', document.querySelector('.todo-walk-start') === null)
      say('markNotAButton', document.querySelector('.todo-row button.todo-glyph') === null)
      say('wayHome', document.querySelector('.todo-scrub-back')?.textContent?.trim() ?? '')
      ;(document.querySelector('.todo-scrub-back') as HTMLElement | null)?.click()
      await settle(900)
      say('backToday', [...document.querySelectorAll('.todo-row .todo-text')].map(t => (t.textContent ?? '').trim()))
      say('writableAgain', document.querySelector('.todo-addrow') !== null)

      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(700)
    }

    if (scene === 'listbugs') {
      // Three reported from use in one sitting, all in the task list.
      await pane.goTo({ kind: 'document', id: await window.tephra.todo.which() })
      let waited = 0
      while (waited < 20_000 && document.querySelectorAll('.todo-row').length < 1) {
        await settle(200)
        waited += 200
      }

      // **1. Typing starts an item, and the first character is not an offer.**
      // The field selected everything on open, which is right for a row being
      // edited and wrong for the character you just typed: the second keystroke
      // deleted the first.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))
      await settle(500)
      {
        const f = document.querySelector('.todo-field') as HTMLInputElement | null
        say('typedOpens', f?.value ?? '')
        say('caretAfter', { start: f?.selectionStart, end: f?.selectionEnd })
        f?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      }
      await settle(400)

      // **2. A list longer than the window could not be reached past the fold.**
      {
        const el = document.querySelector('.todo') as HTMLElement | null
        say('scrolls', el === null ? '' : getComputedStyle(el).overflowY)
      }

      // **3. In the tag view, adding belongs to the group you asked from.**
      ;([...document.querySelectorAll('.todo-views button')].find(
        b => (b.textContent ?? '').trim() === 'by tag',
      ) as HTMLElement | null)?.click()
      await settle(500)
      const groups = () => [...document.querySelectorAll('.todo-group')]
      const named = (tag: string) =>
        groups().find(g => (g.querySelector('.todo-group-name')?.textContent ?? '').startsWith(tag))
      say('addHere', groups().map(g => g.querySelector('.todo-add-here')?.textContent?.trim() ?? ''))
      ;(named('house')?.querySelector('.todo-add-here') as HTMLElement | null)?.click()
      await settle(500)
      {
        const f = document.querySelector('.todo-field') as HTMLInputElement | null
        say('prefilled', f?.value ?? '')
        say('caretBeforeTag', { start: f?.selectionStart, end: f?.selectionEnd })
        // And it opened INSIDE the group, not at the foot of the page.
        say('openedInGroup', named('house')?.querySelector('.todo-field') !== null)
        say('notAtFoot', document.querySelector('.todo-column > .todo-list > .todo-adding') === null)
      }
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(700)
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
        // **Deltas, each mark against its own row's words** — 0 is on them.
        say('baselines', baselineDeltas([
          '.todo-tag', '.todo-due', '.todo-owner', '.todo-pick', '.todo-for',
        ]))
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

    if (scene === 'horizon') {
      // The full horizon (MH2, H8, D74). **Both sources present from the
      // start**, which is the thing `notes.md` records failing six times over —
      // a view built against one source and fitted to the second afterwards.
      const list = await window.tephra.todo.which()
      // Dates relative to the APP'S today, never the harness's (m2's rule): the
      // two differ either side of midnight, and this window is the authority.
      const day = await window.tephra.todo.today(list)
      const from = (days: number): string =>
        new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

      await window.tephra.doc.newDocument('The house', undefined, 'docket')
      await settle(1400)
      const docket = (await window.tephra.docket.list())[0]?.id
      if (docket !== undefined) {
        // A dated event with a long run-up: the row that proves a status step
        // finally has somewhere to go (H6), and that the instance is labelled.
        const day = await window.tephra.docket.add(docket, 'Ada\u2019s birthday',
          { mode: 'recurring-event', every: '1y', start: from(90) })
        await window.tephra.docket.addStep(docket, day, '60d', 'work out what the plan is', 'status')
        // A monthly one, so two instances of one recurrence land in the window.
        await window.tephra.docket.add(docket, 'Pay the water bill',
          { mode: 'recurring-event', every: '1m', start: from(10) })
        // And a repair with steps, which contributes a task row.
        const car = await window.tephra.docket.add(docket, 'The car needs fixing', { mode: 'task' })
        await window.tephra.docket.addStep(docket, car, '+5d', 'have the car fixed')
        // Started, so its steps have a date to be measured from — an inactive
        // matter contributes nothing, which is a different claim, tested below.
        await window.tephra.docket.activate(docket, car)
      }
      // The other source: a task with a due date of its own.
      // **With a link and a tag**, because a raw URL sprawling across a strip
      // is what use reported and what no assertion here was looking at.
      await window.tephra.todo.add(list,
        `Review Steve's [bio draft](https://docs.google.com/document/d/1t8me/edit) #career DUE ${from(3)}`)
      await window.tephra.doc.flush()

      // **The horizon is the lower half of the task list's view** (MH4, amending
      // D74), so this is where it is read — there is no window of its own to go
      // to any more, and the strip in the gutter that preceded it is gone too.
      await pane.goTo({ kind: 'document', id: list })
      await settle(1800)
      say('title', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('surface', document.querySelector('.todo-horizon .horizon') !== null)
      say('bothHalves', {
        list: document.querySelectorAll('.todo-list > .todo-row').length,
        horizon: document.querySelectorAll('.hz-row').length,
      })
      say('days', [...document.querySelectorAll('.hz-on')].map(n => n.textContent ?? ''))
      say('rows', [...document.querySelectorAll('.hz-row')].map(n => ({
        what: (n.querySelector('.hz-what') as HTMLElement | null)?.textContent ?? '',
        kind: (n.querySelector('.hz-kind') as HTMLElement | null)?.textContent ?? '',
        matter: (n.querySelector('.hz-matter') as HTMLElement | null)?.textContent ?? null,
        instance: (n.querySelector('.hz-instance') as HTMLElement | null)?.textContent ?? null,
      })))
      say('count', document.querySelector('.hz-count')?.textContent ?? '')
      say('spans', [...document.querySelectorAll('.hz-spans option')].map(n => n.textContent ?? ''))
      // **The span control does something**, which is the whole reason it is
      // there: the named risk of this design is a horizon that fills up.
      {
        const pick = document.querySelector('.hz-spans') as HTMLSelectElement | null
        const wide = document.querySelectorAll('.hz-row').length
        if (pick !== null) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
          setter?.call(pick, '0')
          pick.dispatchEvent(new Event('change', { bubbles: true }))
          await settle(900)
        }
        say('narrowed', { wide, narrow: document.querySelectorAll('.hz-row').length })
      }
      // **Legibility, checked the way MH1 learned to check it** (notes 50): ask
      // the stylesheet whether a rule exists, rather than guessing from a
      // computed value that looks plausible at browser defaults.
      say('styled', unstyled(/\.(hz-[a-z-]+|horizon)\b/g, [
        'horizon', 'hz-head', 'hz-count', 'hz-span', 'hz-empty', 'hz-list',
        'hz-on', 'hz-row', 'hz-what', 'hz-about', 'hz-kind', 'hz-matter', 'hz-instance',
        'hz-spans',
      ]))
      const what = document.querySelector('.hz-what') as HTMLElement | null
      const face = what === null ? null : getComputedStyle(what)
      say('reading', { size: face?.fontSize, family: face?.fontFamily?.slice(0, 24) })
      // **Both sources, interleaved by date in the one pane.** This was a strip
      // in the gutter with its own markup; it is the same claim about the same
      // content, asked of the surface that replaced it.
      say('strip', [...document.querySelectorAll('.hz-row')].map((n, at) => ({
        order: at,
        when: (n.querySelector('.hz-on') as HTMLElement | null)?.textContent ?? '',
        what: (n.querySelector('.hz-what') as HTMLElement | null)?.textContent ?? '',
        docket: (n.querySelector('.hz-kind') as HTMLElement | null)?.textContent !== 'due',
      })))

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

    if (scene === 'schedule') {
      // The schedule panel (MH4, H7) — **structural, not parsed**.
      await window.tephra.doc.newDocument('Games', undefined, 'docket')
      await settle(1400)
      const docket = (await window.tephra.docket.list())[0]?.id
      if (docket === undefined) { say('appError', 'no docket'); return }
      const game = await window.tephra.docket.add(docket, 'The campaign',
        { mode: 'recurring-event' })
      // **Go to it**, since making a docket does not open one: `newDocument`
      // creates the file and the pane is still wherever it was.
      await pane.goTo({ kind: 'document', id: docket })
      await settle(1400)
      // Dates relative to the app's own today, never the harness's (m2's rule).
      const list = await window.tephra.todo.which()
      const day = await window.tephra.todo.today(list)
      const from = (days: number): string =>
        new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
      void game

      const row = (): Element | undefined => [...document.querySelectorAll('.docket-row')].find(
        r => (r.querySelector('.docket-name')?.textContent ?? '').includes('campaign'))
      say('slugAtRest', row()?.querySelector('.docket-when')?.textContent?.trim() ?? '')

      // **Clicking the sentence opens the panel**, which is the whole gesture.
      ;(row()?.querySelector('.docket-when') as HTMLElement | null)?.click()
      await settle(600)
      say('panelOpen', document.querySelectorAll('.sched').length)
      // **The panel asks only what the MODE leaves open.** A recurring event
      // still has to choose a rule or a list; a task has started or it has not.
      // Two controls answering one question was the fault this replaced.
      say('shapesForRecurringEvent', [...document.querySelectorAll('.sched-option')]
        .map(n => (n.textContent ?? '').trim()))
      // The mode drop-down is here as well as on *add a matter*, because a
      // mistake made at creation has to be correctable the way it was made.
      say('modeHere', [...document.querySelectorAll('.sched .docket-mode option')]
        .map(n => n.textContent ?? '').length)

      const choose = async (label: string): Promise<void> => {
        const pick = [...document.querySelectorAll('.sched-option')].find(
          n => (n.textContent ?? '').trim() === label)?.querySelector('input') as HTMLElement | null
        pick?.click()
        await settle(800)
      }
      const setDate = async (sel: string, value: string): Promise<void> => {
        const field = document.querySelector(sel) as HTMLInputElement | null
        if (field === null) return
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(field, value)
        field.dispatchEvent(new Event('change', { bubbles: true }))
        await settle(800)
      }

      await choose('On these dates')
      say('listedChosen', document.querySelectorAll('.sched-list').length)
      say('afterChoose', {
        panels: document.querySelectorAll('.sched').length,
        checked: [...document.querySelectorAll('.sched-option')]
          .filter(n => (n.querySelector('input') as HTMLInputElement | null)?.checked === true)
          .map(n => (n.textContent ?? '').trim()),
      })
      await setDate('.sched-list .sched-date', from(7))
      await setDate('.sched-list .sched-date', from(21))
      say('chips', [...document.querySelectorAll('.sched-date-chip')]
        .map(n => (n.textContent ?? '').replace('\u00d7', '').trim()))
      // **The preview is the point of the panel**: whatever shape is selected,
      // these are the dates it actually produces.
      say('preview', [...document.querySelectorAll('.sched-peek')].map(n => n.textContent ?? ''))

      // The picture worth having is the panel OPEN; the slug at rest is checked
      // below and is one line of text.
      await shot()
      // And the same panel on a TASK asks a different question entirely.
      {
        const mode = document.querySelector('.sched .docket-mode') as HTMLSelectElement | null
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
        setter?.call(mode, 'task')
        mode?.dispatchEvent(new Event('change', { bubbles: true }))
        await settle(1000)
        say('shapesForTask', [...document.querySelectorAll('.sched-option')]
          .map(n => (n.textContent ?? '').trim()))
        // **A recurring task asks BOTH questions**, which is the fix for a panel
        // that had conflated them: whether work has begun, and how it comes
        // round — and a list is as good an answer as a rule for either kind.
        setter?.call(mode, 'recurring-task')
        mode?.dispatchEvent(new Event('change', { bubbles: true }))
        await settle(1000)
      }

      // ── the question somebody can answer (D80, amended) ──
      //
      // **A matter recurring from its own completion stores *when it is next
      // due*, and what a person has is *when I last did it*.** Typed into a
      // field meaning the next one, the last water-filter change produced a task
      // that was instantly overdue. On a fresh matter of that shape, because a
      // matter dragged through three modes is not how anybody meets this.
      {
        const filter = await window.tephra.docket.add(docket, 'Change the water filter',
          { mode: 'recurring-task', every: '120d' })
        await settle(1200)
        const row = [...document.querySelectorAll('.docket-row')].find(
          r => (r.querySelector('.docket-name')?.textContent ?? '').includes('water filter'))
        ;(row?.querySelector('.docket-when') as HTMLElement | null)?.click()
        await settle(800)
        const options = (): Element[] => [...(row?.querySelectorAll('.sched-option') ?? [])]
        const press = async (label: string): Promise<void> => {
          ;(options().find(n => (n.textContent ?? '').trim().startsWith(label))
            ?.querySelector('input') as HTMLElement | null)?.click()
          await settle(900)
        }
        await press('Started on')
        await press('counting from when it is done')
        say('askedFor', [...(row?.querySelectorAll('.sched-label') ?? [])]
          .map(n => n.textContent?.trim()))

        const box = row?.querySelector('.sched-row .sched-date') as HTMLInputElement | null
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(box, from(-200))
        box?.dispatchEvent(new Event('change', { bubbles: true }))
        await settle(1200)
        say('lastDone', {
          typed: from(-200),
          shows: (row?.querySelector('.sched-row .sched-date') as HTMLInputElement | null)?.value ?? '',
          slug: row?.querySelector('.docket-when')?.textContent?.trim() ?? '',
          next: [...(row?.querySelectorAll('.sched-peek') ?? [])].map(n => n.textContent ?? ''),
        })
        void filter
      }

      ;(document.querySelector('.sched-done button') as HTMLElement | null)?.click()
      await settle(900)
      say('slugAfter', row()?.querySelector('.docket-when')?.textContent?.trim() ?? '')
      say('styled', unstyled(/\.(sched[a-z-]*)\b/g, [
        'sched', 'sched-row', 'sched-label', 'sched-shapes', 'sched-option',
        'sched-date', 'sched-n', 'sched-list', 'sched-date-chip', 'sched-next',
        'sched-peek', 'sched-done',
      ]))
      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
    }

    if (scene === 'today') {
      // The day's selection (H9, MH4) — **a mark on the day, and a view over it**.
      const list = await window.tephra.todo.which()
      await pane.goTo({ kind: 'document', id: list })
      let waited = 0
      while (waited < 20_000 && document.querySelectorAll('.todo-row').length < 2) {
        await settle(200)
        waited += 200
      }
      const texts = (sel: string): string[] =>
        [...document.querySelectorAll(sel)].map(n => (n.textContent ?? '').trim())

      say('todayBefore', document.querySelectorAll('.todo-today').length)
      // **The right-hand group is one row, not four boxes at four heights.**
      // Tags, owner, due date and the pick control were added at different
      // times and two of them missed the row's shared nudge; the result was
      // visibly ragged. Asked of the geometry, since that is the complaint.
      {
        const tops = (sel: string): number[] => [...document.querySelectorAll(sel)]
          .map(n => Math.round(n.getBoundingClientRect().top))
        say('rowBoxes', {
          tag: tops('.todo-row .todo-tag')[0] ?? null,
          owner: tops('.todo-row .todo-owner')[0] ?? null,
          due: tops('.todo-row .todo-due')[0] ?? null,
          pick: tops('.todo-row .todo-pick')[0] ?? null,
        })
        // And the owner is not drawn as a tag, which is the other half.
        const shape = (sel: string): string | null => {
          const el = document.querySelector(sel)
          if (el === null) return null
          const css = getComputedStyle(el)
          return `${css.backgroundColor}|${css.borderRadius}`
        }
        say('ownerVsTag', { owner: shape('.todo-owner'), tag: shape('.todo-tag') })
        say('pickSays', document.querySelector('.todo-pick')?.textContent?.trim() ?? '')

      /**
       * **Driven through the real gesture**, not through the verb underneath it.
       * The first cut of this scene called `todo.choose` directly, saw nothing
       * happen, and was measuring the right thing in the wrong place: choosing
       * from the menu is what a person does, and it is also the only path that
       * proves the surface hears its own act.
       */
      const chooseRow = async (words: string, say2: string): Promise<void> => {
        const row = [...document.querySelectorAll('.todo-list > .todo-row')].find(
          one => (one.querySelector('.todo-text')?.textContent ?? '').includes(words))
        row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))
        await settle(400)
        // **Read while it is open.** The first cut sampled this after clicking,
        // which is after the menu closed — an empty list that says nothing about
        // whether the entry was ever there.
        say('menuSaid', [...document.querySelectorAll('.row-menu button')].map(b => b.textContent ?? ''))
        ;([...document.querySelectorAll('.row-menu button')].find(
          b => (b.textContent ?? '').trim() === say2) as HTMLElement | null)?.click()
        await settle(900)
      }

      // Chosen in the OPPOSITE order to the list, so *order of choosing* is a
      // claim the picture can actually fail.
      await chooseRow('post the form', 'Do this today')
      await chooseRow('ring the bank', 'Do this today')

      say('section', document.querySelectorAll('.todo-today').length)
      say('heading', document.querySelector('.todo-today-name')?.textContent?.trim() ?? '')
      say('inToday', texts('.todo-today .todo-text'))
      // **And still below**: a selection, never a relocation (H9). The section
      // is a second view of the same rows, not somewhere they went.
      say('wholeList', texts('.todo-list:not(.todo-today .todo-list) > .todo-row .todo-text'))
      say('topmost',
        document.querySelector('.todo-today, .todo-list')?.classList.contains('todo-today') ?? false)
      say('styled', unstyled(/\.(todo-today[a-z-]*)\b/g, ['todo-today', 'todo-today-name']))
      // **Measured, because a section that reads as its own region is the whole
      // claim** and *there is a rule* does not say it looks like anything. Set
      // against a tag heading, which is the thing it must be legible beside and
      // must not be mistaken for.
      {
        const box = (sel: string): Record<string, string> | null => {
          const el = document.querySelector(sel) as HTMLElement | null
          if (el === null) return null
          const css = getComputedStyle(el)
          return {
            size: css.fontSize, weight: css.fontWeight, colour: css.color,
            family: (css.fontFamily.split(',')[0] ?? '').replace(/["']/g, ''),
            case: css.textTransform, border: css.borderBottomColor,
          }
        }
        say('todayHead', box('.todo-today-name'))
        say('tagHead', box('.todo-group-name'))
        const rows = [...document.querySelectorAll('.todo-today .todo-row, .todo-list > .todo-row')]
        say('rowLefts', [...new Set(rows.map(r => Math.round(r.getBoundingClientRect().left)))])
      }

      // Unchoosing takes it back off, and the section goes when it empties.
      // **Unless the picture is what is wanted**: the shot is taken when the
      // scene ends, so a scene that tidies up photographs an empty list.
      if (arg !== 'keep') {
        await chooseRow('post the form', 'Not today')
        await chooseRow('ring the bank', 'Not today')
      }
      say('todayAfter', document.querySelectorAll('.todo-today').length)
      say('splitThere', document.querySelectorAll('.todo-split').length)

      // **Putting down offers a home, and never insists on one** (MH5). The
      // rule is *one keystroke and zero decisions*, kept by the bare entry; the
      // rest are a refinement of it, since deferral is already a reflective
      // moment and *where does this belong* is the same thought.
      {
        await window.tephra.doc.newDocument('The house', undefined, 'docket')
        await settle(1200)
        const row = document.querySelector('.todo-list > .todo-row')
        row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))
        await settle(500)
        say('putDownMenu', [...document.querySelectorAll('.row-menu button')]
          .map(b => (b.textContent ?? '').trim())
          .filter(one => one.startsWith('Move to')))
        ;([...document.querySelectorAll('.row-menu button')].find(
          b => (b.textContent ?? '').trim().startsWith('Move to The house')) as HTMLElement | null)?.click()
        await settle(1400)
        say('housed', (await window.tephra.docket.list()).map(one => one.title))
        const house = (await window.tephra.docket.list()).find(one => one.title === 'The house')
        say('filedThere', house === undefined
          ? null
          : (await window.tephra.docket.matters(house.id)).map(one => one.name))
      }
      }

      if (arg === 'keep') await shot()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'reorient') {
      // **The whole motion, end to end** (H11, MH4). What this can say that no
      // unit test can: that there is a way IN, that the three movements are
      // three different questions, and that the pass leaves an artifact.
      const list = await window.tephra.todo.which()
      await pane.goTo({ kind: 'document', id: list })
      let waited = 0
      while (waited < 20_000 && document.querySelectorAll('.todo-row').length < 2) {
        await settle(200)
        waited += 200
      }
      const words = (sel: string): string[] =>
        [...document.querySelectorAll(sel)].map(n => (n.textContent ?? '').trim())

      // **The offer is the list looking different, and this is only the way in.**
      const start = document.querySelector('.todo-walk-start') as HTMLElement | null
      say('entrance', start?.textContent?.trim() ?? '')
      say('offered', start?.dataset['offered'] ?? '')

      // ── in from the menu, which is the entrance that works from anywhere ──
      say('menuItemFound', await window.tephra.clickMenu('Reorient'))
      await settle(1400)
      say('inPass', document.querySelector('.todo-walkbar .todo-walk-finish') !== null)
      say('passSays', document.querySelector('.todo-walkbar .todo-movement')?.textContent?.trim() ?? '')
      // **The pass adds no verbs.** Every act is one you could perform at any
      // time; what it adds is the marking of what it is asking about.
      say('marked', [...document.querySelectorAll('.todo-row')]
        .filter(r => r.classList.contains('carried')).length)

      // **Both halves are on screen for the whole of it** (amends D74): what you
      // are doing and what is coming are two halves of one question, and the
      // reason this was three movements was a misreading of *first* as *before*.
      say('bothHalves', {
        list: document.querySelectorAll('.todo-list > .todo-row').length,
        horizon: document.querySelectorAll('.todo-horizon .hz-row').length,
      })

      // Choose one for today — a verb on the row, not a stage of the pass.
      ;(document.querySelectorAll('.todo-pick')[2] as HTMLElement | null)?.click()
      await settle(900)
      say('chosen', words('.todo-today .todo-text'))

      ;(document.querySelector('.todo-walkbar .todo-walk-finish') as HTMLElement | null)?.click()
      await settle(900)
      say('passOver', document.querySelector('.todo-walkbar .todo-walk-finish') === null)
      // **The artifact outlives the pass**, which is what separates reorient
      // from the walk: the walk's product was attention and nothing else.
      say('kept', words('.todo-today .todo-text'))
      say('stillBelow', words('.todo-list:not(.todo-today .todo-list) > .todo-row .todo-text'))
      say('walkedNow', (document.querySelector('.todo-walk-start') as HTMLElement | null)
        ?.textContent?.trim() ?? '')
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
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

      // **The resting list is a list** (MH4's correction to T11): nothing is
      // tinted until a pass asks about it, because a list where nearly every row
      // has carried is one where tinting them all says nothing.
      say('carriedAtRest', rows().filter(r => r.classList.contains('carried')).length)
      say('allRows', rows().length)
      const start = document.querySelector('.todo-walk-start') as HTMLElement | null
      say('offered', start?.dataset['offered'] ?? '')
      say('startSays', start?.textContent?.trim() ?? '')
      say('noDropButtons', document.querySelectorAll('.todo-drop').length)

      // For the picture: the list as it greets you, offering and not asking.
      if (arg !== 'offer') {
      start?.click()
      await settle(500)
      // And NOW they are marked: the pass says what it is putting in front of you.
      say('carriedRows', rows().filter(r => r.classList.contains('carried')).length)

      /**
       * **Selection, which is what the staged *drop* became** (MH4).
       *
       * The pass adds no verbs of its own: ⌘-click selects, and every act in the
       * bar is one you could have performed at any time. What changed is not
       * which acts exist but who they apply to — and the confirmation moved with
       * them, from the mode to the bulk act, where the consequence actually is.
       */
      const pick = async (at: number, how: 'meta' | 'shift' = 'meta'): Promise<void> => {
        rows()[at]?.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true,
          ...(how === 'shift' ? { shiftKey: true } : { metaKey: true }),
        }))
        await settle(250)
      }
      say('noBarYet', document.querySelectorAll('.todo-walkbar .todo-bulk').length)
      await pick(0)
      await pick(2)
      say('selected', rows().filter(r => r.classList.contains('selected')).length)
      say('barSays', document.querySelector('.todo-walkbar .todo-movement')?.textContent?.trim() ?? '')
      say('verbs', [...document.querySelectorAll('.todo-walkbar .todo-bulk')]
        .map(b => (b.textContent ?? '').trim()))
      say('nothingWrittenYet', texts().length)

      // **Shift extends a range over what is on the SCREEN**, which is the only
      // order that means anything when the list is grouped by tag.
      await pick(4, 'shift')
      say('afterRange', rows().filter(r => r.classList.contains('selected')).length)

      // Un-picking one puts it back, a selection being nothing until acted on.
      await pick(0)
      say('afterUnpicking', rows().filter(r => r.classList.contains('selected')).length)

      if (arg === 'cancel') {
        ;(document.querySelector('.todo-walk-cancel') as HTMLElement | null)?.click()
        await settle(700)
        say('rowsAfterCancel', texts().length)
        // **The pass is still open**, which is the point of the rename: this
        // button cancels the SELECTION, not the reorientation. Clearing one
        // should not end the other, and calling it *Clear* had made that
        // ambiguous enough to be reported from use.
        say('stillInPass', document.querySelector('.todo-walk-finish') !== null)
        say('barGone', document.querySelector('.todo-walkbar .todo-bulk') === null)
      } else {
        // **One act on many, and one undo step** — pressed here as Delete,
        // which is the one verb that cannot be taken back by pressing another.
        ;([...document.querySelectorAll('.todo-walkbar .todo-bulk')].find(
          b => (b.textContent ?? '').trim() === 'Delete') as HTMLElement | null)?.click()
        await settle(1200)
        say('rowsAfterBulk', texts().length)
        say('barAfterBulk', document.querySelectorAll('.todo-walkbar .todo-bulk').length)
        // The pass itself still ends by recording that you looked.
        ;(document.querySelector('.todo-walk-finish') as HTMLElement | null)?.click()
        await settle(900)
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

    if (scene === 'find') {
      // ⌘F, and the walk (MS3, D66). **Driven through the real menu item**, so
      // the accelerator wiring is what is being tested and not a function the
      // harness happened to call.
      say('menuItemFound', await window.tephra.clickMenu('Find\u2026'))
      await settle(400)
      const field = document.querySelector('.find-field') as HTMLInputElement | null
      say('barShown', field !== null)
      if (field !== null) {
        // React owns the value, so setting `.value` and firing `input` is how a
        // controlled field is typed into from outside.
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(field, 'surveyor')
        field.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(200)
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1200)
      }
      // **The claim is what is DRAWN**, not the scroll and not the selection: a
      // find that lands without marking the words has not said what it found,
      // and reading the mark is reading what a person would see.
      const first = view.state.selection.main
      say('firstFound', document.querySelector('.cm-find-now')?.textContent ?? '')
      say('firstAt', first.from)
      // **Decorated, not selected** (MS3): the caret is back in the field, so an
      // unfocused selection is all a reader would have had to go on.
      say('markedNow', document.querySelectorAll('.cm-find-now').length)
      say('markedAll', document.querySelectorAll('.cm-find').length)
      // The tally counts from the newest end, so the first landing is the first.
      await settle(900)
      say('tally', document.querySelector('.find-said')?.textContent ?? '')
      say('trackMarks', document.querySelectorAll('.cm-track-mark, .cm-scroll-track *').length)

      // Again, backwards in time: the second-newest mention, not the same one.
      say('steppedEarlier', await window.tephra.clickMenu('Find Earlier'))
      await settle(1200)
      const second = view.state.selection.main
      say('secondFound', document.querySelector('.cm-find-now')?.textContent ?? '')
      say('movedBack', second.from < first.from)

      // And forward again, which must return to where it started.
      say('steppedLater', await window.tephra.clickMenu('Find Later'))
      await settle(1200)
      const third = view.state.selection.main
      say('thirdAt', third.from)
      say('cameBack', third.from === first.from)

      // **Past the oldest, round to the newest.** Stepped until it says it came
      // round rather than a fixed number of times: how many matches a fixture
      // has depends on how many days the window loaded, and a count here would
      // be a test that breaks when the extent policy changes.
      let steps = 0
      let wrapped = ''
      while (steps < 10 && !wrapped.includes('\u21bb')) {
        await window.tephra.clickMenu('Find Earlier')
        await settle(900)
        wrapped = document.querySelector('.find-said')?.textContent ?? ''
        steps += 1
      }
      say('saidWhenWrapped', wrapped)
      say('stepsToWrap', steps)
      say('wrappedTo', view.state.selection.main.from)
      // Coming round lands on the newest match, which is where the very first
      // Enter landed — the loop is closed.
      say('wrapIsFirst', view.state.selection.main.from === first.from)

      // Nothing to find says so, rather than moving the caret anywhere.
      const again = document.querySelector('.find-field') as HTMLInputElement | null
      if (again !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(again, 'quagga')
        again.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(150)
        again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1500)
      }
      say('saidWhenNothing', document.querySelector('.find-said')?.textContent ?? '')
      // Unmoved from wherever the wrap left it, which is what "nothing" has to
      // mean: a search that finds nothing must not take you anywhere.
      say('caretUnmoved', view.state.selection.main.from === first.from)

      // A beat with the bar up and a match selected, for the screenshot.
      await settle(2500)
      // Escape closes it, which is the only way out that does not need a mouse.
      again?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await settle(400)
      say('closed', document.querySelector('.find-field') === null)
      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'search') {
      // ⌘⇧F and the search panel (MS4, D66). **The other rendering of the same
      // query**: the walk goes to one place at a time, this shows every place —
      // and it stays open while you read them, which is the whole reason it is
      // a panel rather than a location.
      say('menuItemFound', await window.tephra.clickMenu('Search Tephra\u2026'))
      await settle(600)
      const field = document.querySelector('.results-query') as HTMLInputElement | null
      say('panelShown', field !== null)
      // The document is still there behind it, which a location could not manage.
      say('stillReading', document.querySelector('.cm-content') !== null)
      if (field !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(field, 'surveyor')
        field.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(150)
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(2500)
      }
      say('rows', document.querySelectorAll('.results-list li').length)
      say('marked', document.querySelectorAll('.results-lead mark').length)
      say('firstMark', document.querySelector('.results-lead mark')?.textContent ?? '')
      say('counted', document.querySelector('.results-count')?.textContent ?? '')
      say('sources', document.querySelectorAll('.results-where .pill').length)
      {
        const lead = document.querySelector('.results-lead') as HTMLElement | null
        const panel = document.querySelector('.results-panel') as HTMLElement | null
        const pill = document.querySelector('.results-where .pill') as HTMLElement | null
        const when = document.querySelector('.results-when') as HTMLElement | null
        const root = getComputedStyle(document.documentElement)
        say('colours', {
          panelBg: panel === null ? null : getComputedStyle(panel).backgroundColor,
          leadInk: lead === null ? null : getComputedStyle(lead).color,
          pillInk: pill === null ? null : getComputedStyle(pill).color,
          pillBg: pill === null ? null : getComputedStyle(pill).backgroundColor,
          whenInk: when === null ? null : getComputedStyle(when).color,
          fieldInk: getComputedStyle(document.querySelector('.results-query') as Element).color,
          fieldBg: getComputedStyle(document.querySelector('.results-query') as Element).backgroundColor,
          panelText: root.getPropertyValue('--panel-text').trim(),
          text: root.getPropertyValue('--text').trim(),
          surfacePanel: root.getPropertyValue('--surface-panel').trim(),
        })
      }
      // **A line with two matches is ONE row**, which is the difference between
      // a list of places and a list of the search's own arithmetic.
      say('grouped', [...document.querySelectorAll('.results-when')]
        .filter(n => (n.textContent ?? '').includes('here')).length)

      // **Dragged wider**, and the width is what the panel reports.
      const grip = document.querySelector('.results-grip') as HTMLElement | null
      const panel = document.querySelector('.results-panel') as HTMLElement | null
      const wasWide = panel?.getBoundingClientRect().width ?? 0
      grip?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 800 }))
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 700 }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 700 }))
      await settle(400)
      say('widened', Math.round((panel?.getBoundingClientRect().width ?? 0) - wasWide))

      // **A row goes there, and the list stays.** That is the whole claim.
      ;(document.querySelector('.results-go') as HTMLElement | null)?.click()
      await settle(2400)
      say('wentThere', document.querySelector('.cm-content') !== null)
      say('listStayed', document.querySelectorAll('.results-list li').length)
      // **The list hands off to the walk**: the query is in the bar, the match
      // is marked, and ⌘G steps the same set — over the whole corpus, not
      // narrowed to whichever document the row landed in.
      say('handedOff', (document.querySelector('.find-field') as HTMLInputElement | null)?.value ?? '')
      say('markedOnArrival', document.querySelectorAll('.cm-find-now').length)
      say('tallyOnArrival', document.querySelector('.find-said')?.textContent ?? '')
      say('steppable', await window.tephra.clickMenu('Find Earlier'))
      await settle(1400)
      say('steppedTo', document.querySelector('.find-said')?.textContent ?? '')

      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(600)
    }

    if (scene === 'image') {
      // A picture pasted into the notebook (R7). **Driven as a real paste**, so
      // what is being tested is the editor's own handler and not a function the
      // harness happened to call.
      const PNG = Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQott' +
        'AAAAABJRU5ErkJggg==',
      ), c => c.charCodeAt(0))
      const file = new File([PNG], 'kitchen plan.png', { type: 'image/png' })
      const data = new DataTransfer()
      data.items.add(file)
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      view.contentDOM.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      )
      await settle(2500)
      const text = view.state.doc.toString()
      say('inserted', /!\[\]\(\S+\.png\)/.exec(text)?.[0] ?? '')
      say('rawWhileEditing', document.querySelectorAll('.cm-content img').length)
      // **A figure, once the caret leaves.** The line the caret is in shows its
      // raw markup — that is the edit-where-rendered rule (D16) — so the widget
      // is what you see the moment you look away, and not before.
      view.dispatch({ selection: { anchor: 0 } })
      await settle(900)
      say('drawn', document.querySelectorAll('.cm-content img').length)
      {
        // **Drawn is not shown.** The widget put an `<img>` on the page for as
        // long as this feature has existed, and until the corpus had a host to
        // serve from, every one of them was broken — so the claim has to be
        // that the picture LOADED, with the size it was pasted at.
        const img = document.querySelector('.cm-content img') as HTMLImageElement | null
        say('imgSrc', img?.src ?? '')
        say('imgLoaded', img !== null && img.complete && img.naturalWidth > 0)
        say('imgWidth', img?.naturalWidth ?? 0)
      }
      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(800)
    }

    if (scene === 'docket') {
      // Making a docket and working it (MH1, D68). **Driven through the real
      // menu item**, because the thing being tested is that the gesture exists
      // and asks — the first cut created `untitled.docket.md` without asking,
      // which was reported from use before anything else about this phase was.
      say('menuItemFound', await window.tephra.clickMenu('New Docket\u2026'))
      await settle(500)
      const naming = document.querySelector('.prompt input') as HTMLInputElement | null
      say('asked', naming !== null)
      if (naming !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(naming, 'The house')
        naming.dispatchEvent(new Event('input', { bubbles: true }))
        naming.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(2500)
      }
      say('title', document.querySelector('.titlebar .title')?.textContent ?? '')
      say('surface', document.querySelector('.docket') !== null)
      // The sidebar found it because its file is there, and calls it by name.
      say('inSidebar', [...document.querySelectorAll('.nav-row, .nav-nested')]
        .map(n => n.textContent ?? '').filter(t => t.includes('house')).length > 0)

      // Add a matter, with a date typed the way a person types one.
      ;(document.querySelector('.docket-add.here') as HTMLElement | null)?.click()
      await settle(300)
      const shape = (want: string): void => {
        const pick = document.querySelector('.docket-new .docket-shape') as HTMLSelectElement | null
        if (pick === null) return
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
        setter?.call(pick, want)
        pick.dispatchEvent(new Event('change', { bubbles: true }))
      }
      say('shapesOffered', [...document.querySelectorAll('.docket-new .docket-shape option')]
        .map(o => o.textContent))
      shape('event')
      await settle(200)
      const fields = [...document.querySelectorAll('.docket-new .docket-field')] as HTMLInputElement[]
      const set = (at: HTMLInputElement, value: string): void => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(at, value)
        at.dispatchEvent(new Event('input', { bubbles: true }))
      }
      // **The field's own measurements**, because the last screen of the scene
      // has no field open on it and the complaint was that the text nearly
      // touched the rule. Numbers, so a regression is caught rather than looked
      // at.
      {
        const one = fields[0]
        const css = one === undefined ? null : getComputedStyle(one)
        say('fieldBox', css === null ? null : {
          padTop: Math.round(parseFloat(css.paddingTop) * 100) / 100,
          size: Math.round(parseFloat(css.fontSize)),
          height: Math.round(one?.getBoundingClientRect().height ?? 0),
        })
      }
      if (fields[0] !== undefined) set(fields[0], 'Service the boiler')
      if (fields[1] !== undefined) set(fields[1], '2026-10-14')
      fields[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle(1800)
      say('rows', document.querySelectorAll('.docket-row').length)
      say('names', [...document.querySelectorAll('.docket-name')].map(n => n.textContent))
      say('whens', [...document.querySelectorAll('.docket-when')].map(n => n.textContent))

      // A matter with no date says so in words, because *not decided* is a state.
      ;(document.querySelector('.docket-add.here') as HTMLElement | null)?.click()
      await settle(300)
      const more = [...document.querySelectorAll('.docket-new .docket-field')] as HTMLInputElement[]
      if (more[0] !== undefined) set(more[0], 'The oven is broken')
      more[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle(1800)
      say('undated', [...document.querySelectorAll('.docket-when.undecided')].map(n => n.textContent))

      // **A recurrence, anchored** — *every 90 days, starting in October.* The
      // anchor is typed with it because it cannot be reconstructed later: the
      // matter's arrival date is re-stamped by `adopt`, so guessing from it is
      // wrong twice.
      ;(document.querySelector('.docket-add.here') as HTMLElement | null)?.click()
      await settle(300)
      // **The shape decides which questions the row asks**, so a recurring
      // matter is made by choosing one rather than by typing a rule into a date
      // field. Getting this wrong is what produced *Illegal invocation*: the
      // date went into a field that shape does not have, the matter was never
      // made, and a later lookup handed `undefined` to a native setter.
      shape('recurring-event')
      await settle(200)
      const again = [...document.querySelectorAll('.docket-new .docket-field')] as HTMLInputElement[]
      if (again[0] !== undefined) set(again[0], 'Change the air filters')
      if (again[1] !== undefined) set(again[1], '2026-10-01')
      if (again[2] !== undefined) set(again[2], '90d')
      again[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle(1800)
      // Read back in WORDS, like the run-up beside it: the row must not switch
      // languages halfway across (H3).
      say('recurrence', [...document.querySelectorAll('.docket-when')]
        .map(n => n.textContent).filter(t => (t ?? '').startsWith('every')))

      // A note on the boiler, which is the quote both people need in front of
      // them — so it shows without a click once it exists.
      {
        const row = [...document.querySelectorAll('.docket-row')].find(
          r => (r.querySelector('.docket-name')?.textContent ?? '').includes('boiler'),
        )
        // **Behind the ⋯ now**, with the other things a matter needs rarely:
        // five controls would not fit the slack they came out of.
        // **Right-click the matter**, which is where everything it needs rarely
        // now lives — the `⋯` row that used to hold these pushed the steps down
        // when it opened, and squeezed every name to one word.
        row?.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: 200, clientY: 200,
        }))
        await settle(250)
        say('menuItems', [...document.querySelectorAll('.row-menu button')]
          .map(b => b.textContent))
        const note = [...document.querySelectorAll('.row-menu button')].find(
          b => (b.textContent ?? '').includes('note'),
        ) as HTMLElement | null
        say('noteOffered', note !== null)
        note?.click()
        await settle(300)
        const field = document.querySelector('.docket-note-field') as HTMLTextAreaElement | null
        say('noteField', field !== null)
        if (field !== null) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          setter?.call(field, 'The firm on the high street did the last one.\nQuoted 480 for the part, plus labour.')
          field.dispatchEvent(new Event('input', { bubbles: true }))
          // ⌘-Enter, because Enter inside a note writes the second sentence.
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
          await settle(1800)
        }
        say('note', [...document.querySelectorAll('.docket-note p')].map(n => n.textContent))
        say('noteShownWithoutAsking', document.querySelector('.docket-note') !== null)
      }

      // And a run-up on the same matter, to prove the two live together: a note
      // and a run-up under one matter, neither eating the other.
      {
        const row = [...document.querySelectorAll('.docket-row')].find(
          r => (r.querySelector('.docket-name')?.textContent ?? '').includes('boiler'),
        )
        // **Unfold it first.** A new matter arrives folded now (MH4, from use):
        // its one seeded step's text IS its name, so opening on arrival showed a
        // line repeating the heading above it. `+ step` only exists while the
        // steps do, which is the rule that made this necessary.
        if (row?.querySelector('.docket-step') === null) {
          ;(row?.querySelector('.docket-open') as HTMLElement | null)?.click()
          await settle(300)
        }
        const runup = [...(row?.querySelectorAll('.docket-quiet') ?? [])].find(
          b => (b.textContent ?? '').trim() === '+ step',
        ) as HTMLElement | null
        runup?.click()
        await settle(300)
        const when = row?.querySelector('.docket-step.new .docket-field.narrow') as HTMLInputElement | null
        const what = row?.querySelector('.docket-step.new .docket-field.wide') as HTMLInputElement | null
        if (when !== null && when !== undefined) set(when, '2w')
        if (what !== null && what !== undefined) set(what, 'book the boiler service')
        what?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1800)
        const committed = '.docket-step:not(.new) .docket-step-when'
        say('runup', [...document.querySelectorAll(committed)].map(n => n.textContent))
        say('bothUnderOne', {
          note: document.querySelectorAll('.docket-note').length,
          runups: document.querySelectorAll(committed).length,
        })
        say('rowsAtEnd', document.querySelectorAll('.docket-row').length)
      }

      // **Legibility has a floor even though it has no instrument** (H3): the
      // name is read aloud across a table, so it takes the notebook's reading
      // face at reading size rather than a UI size.
      {
        const name = document.querySelector('.docket-name') as HTMLElement | null
        // **Every class the surface styles, actually styled.** A wholesale
        // rewrite of one CSS region took four rules with it and only one was
        // noticed by eye — the others were a `select` and two buttons, which
        // look perfectly plausible at browser defaults.
        //
        // **Asked of the stylesheet, not of a computed size.** The first cut
        // inferred *unstyled* from a 16px font, which is wrong twice over: the
        // matter's name legitimately IS 16px, being set at the notebook's
        // reading size, and the grip is drawn with a gradient so its font size
        // means nothing at all. Whether a rule exists is the actual question,
        // and it can be asked directly.
        {
          const written = new Set<string>()
          for (const sheet of [...document.styleSheets]) {
            let rules: CSSRuleList | null = null
            try {
              rules = sheet.cssRules
            } catch {
              continue // a sheet from elsewhere; not ours to read
            }
            for (const rule of [...(rules ?? [])]) {
              const selector = (rule as CSSStyleRule).selectorText
              if (typeof selector !== 'string') continue
              for (const found of selector.matchAll(/\.(docket-[a-z-]+)/g)) {
                written.add(found[1] as string)
              }
            }
          }
          say('styled', [
            'docket-step-clock', 'docket-step-kind', 'docket-mode', 'docket-start',
            'docket-grip', 'docket-step-at', 'docket-step-what', 'docket-step-when',
            'docket-name', 'docket-when', 'docket-quiet', 'docket-tools',
            'docket-step-tools', 'docket-schedule', 'docket-steps', 'docket-open',
            'docket-open-mark', 'docket-link', 'docket-owner',
          ].filter(one => !written.has(one)))
        }
        say('type', name === null ? null : {
          size: Math.round(parseFloat(getComputedStyle(name).fontSize)),
          face: (getComputedStyle(name).fontFamily.split(',')[0] ?? '').replace(/["']/g, ''),
        })
      }

      // ── sections: dividing the docket up to read it (MH1) ──
      {
        const click = (sel: string, text?: string): boolean => {
          const found = [...document.querySelectorAll(sel)].find(
            n => text === undefined || n.textContent === text,
          ) as HTMLElement | undefined
          found?.click()
          return found !== undefined
        }
        const type = (sel: string, value: string): void => {
          const field = document.querySelector(sel) as HTMLInputElement | null
          if (field === null) return
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          setter?.call(field, value)
          field.dispatchEvent(new Event('input', { bubbles: true }))
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        }
        click('.docket-step.new .docket-quiet', 'done')
        await settle(300)
        const NAMED = '.docket-section-head:not(.loose) .docket-section-name'
        const namesOf = (): (string | null)[] =>
          [...document.querySelectorAll(NAMED)].map(n => n.textContent)
        const groupsOf = (): { name: string; matters: (string | null)[] }[] =>
          [...document.querySelectorAll('.docket-section')].map(g => ({
            name: g.querySelector(NAMED)?.textContent ?? '',
            matters: [...g.querySelectorAll('.docket-name')].map(n => n.textContent),
          }))
        say('sectionOffered', click('.docket-add', 'Add a section'))
        await settle(300)
        type('.docket-field.section', 'Periodic maintenance')
        await settle(1500)
        click('.docket-add', 'Add a section')
        await settle(300)
        type('.docket-field.section', 'Major projects')
        await settle(1500)
        say('sections', namesOf())
        // An empty one says what it is rather than looking broken.
        say('emptySaidSo', [...document.querySelectorAll('.docket-section-empty')].length)

        // Move the boiler into the first section with the control that also
        // says where it is.
        const rowOf = (word: string): Element | undefined =>
          [...document.querySelectorAll('.docket-row')].find(
            r => (r.querySelector('.docket-name')?.textContent ?? '').includes(word),
          )
        say('noMoveMenu', rowOf('boiler')?.querySelector('.docket-where') === null)
        // **The mode is what a row leads with**, and its fields follow it.
        // **The mode lives inside the schedule editor**, which the sentence in
        // the date column opens — three controls folded behind the one piece of
        // text that already described them.
        ;(rowOf('boiler')?.querySelector('.docket-when') as HTMLElement | null)?.click()
        await settle(250)
        await settle(350)
        say('modesOnRow', [...(rowOf('boiler')?.querySelectorAll('.docket-mode option') ?? [])]
          .map(o => o.textContent))
        // **Asked of the panel now** (D80). The sentence in the date column is
        // still the way in and the mode is still folded behind it; what changed
        // is that the questions are radios and fields rather than a text box, so
        // *the schedule asks its questions together* is counted differently.
        say('scheduleAsksTogether', {
          when: rowOf('boiler')?.querySelectorAll('.sched .sched-option').length ?? 0,
          mode: rowOf('boiler')?.querySelector('.sched .docket-mode') !== null,
        })
        ;([...(rowOf('boiler')?.querySelectorAll('.sched .docket-quiet') ?? [])]
          .find(b => b.textContent === 'done') as HTMLElement | null)?.click()
        await settle(250)

        // **Moved by dragging**, which is the only way now: the *move to…* menu
        // was the loudest mark on a quiet row and did nothing dragging does not.
        const dragOntoHeading = async (word: string): Promise<void> => {
          const grip = rowOf(word)?.querySelector('.docket-grip') as HTMLElement | null
          if (grip === null || grip === undefined) return
          const at = grip.getBoundingClientRect()
          grip.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, button: 0, pointerId: 1,
            clientX: at.left + 4, clientY: at.top + 8,
          }))
          await settle(120)
          const head = document.querySelector('.docket-section-head:not(.loose)')
          const box = (head as Element).getBoundingClientRect()
          const x = box.left + 20
          const y = box.top + box.height / 2
          window.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerId: 1, clientX: x, clientY: y,
          }))
          await settle(120)
          window.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true, pointerId: 1, clientX: x, clientY: y,
          }))
          await settle(1600)
        }
        await dragOntoHeading('boiler')
        await dragOntoHeading('air filters')
        say('grouped', groupsOf())
        // The moved matter took its note and its run-up with it.
        say('keptItsNote', (rowOf('boiler')?.querySelectorAll('.docket-note p').length ?? 0))
        say('keptItsRunUp',
          rowOf('boiler')?.querySelectorAll('.docket-step:not(.new) .docket-step-when').length ?? 0)

        // ── a whole section, moved among the others ────────────────────────
        // Reported from use: *there's no way to reorder sections in a docket*.
        // Nudged and nudged back, so the order the rest of this scene reads is
        // the order it was left in — and because there and back is the check
        // that an exchange is an exchange.
        {
          const headOf = (name: string): Element | undefined =>
            [...document.querySelectorAll('.docket-section-head:not(.loose)')]
              .find(h => h.querySelector('.docket-section-name')?.textContent === name)
          const arrow = (name: string, which: string): HTMLElement | null =>
            ([...(headOf(name)?.querySelectorAll('.docket-quiet.step') ?? [])]
              .find(b => b.textContent === which) as HTMLElement | undefined) ?? null
          // Measured, not looked at: an arrow set at the word size reads as a
          // speck beside *rename*, and a glyph check would pass either way.
          {
            const up = arrow('Major projects', '↑')
            const box = up?.getBoundingClientRect()
            say('arrowBox', box === undefined ? null : {
              width: Math.round(box.width),
              height: Math.round(box.height),
            })
          }
          // The first section has no up arrow, because the undivided run above
          // it is not a section but a definition: nothing goes above it.
          say('sectionArrows', {
            firstUp: arrow('Periodic maintenance', '↑') !== null,
            firstDown: arrow('Periodic maintenance', '↓') !== null,
            lastUp: arrow('Major projects', '↑') !== null,
            lastDown: arrow('Major projects', '↓') !== null,
          })
          arrow('Major projects', '↑')?.click()
          await settle(1400)
          say('sectionMoved', groupsOf())
          arrow('Major projects', '↓')?.click()
          await settle(1400)
          say('sectionBack', groupsOf())
        }

        // ── a refused matter keeps what was typed into it ──────────────────
        // Reported from use: an unreadable field made the whole attempt vanish
        // — name, mode and dates — and put its explanation in a banner at the
        // top of a page long enough to be scrolled away.
        {
          const set = (at: HTMLInputElement | undefined, value: string): void => {
            if (at === undefined) return
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            setter?.call(at, value)
            at.dispatchEvent(new Event('input', { bubbles: true }))
          }
          ;([...document.querySelectorAll('.docket-add.here')][0] as HTMLElement | null)?.click()
          await settle(300)
          const pick = document.querySelector('.docket-new .docket-shape') as HTMLSelectElement | null
          if (pick !== null) {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
            setter?.call(pick, 'recurring-task')
            pick.dispatchEvent(new Event('change', { bubbles: true }))
          }
          await settle(250)
          const boxes = [...document.querySelectorAll('.docket-new .docket-field')] as HTMLInputElement[]
          set(boxes[0], 'Descale the kettle')
          set(boxes[2], 'every so often')
          await settle(200)
          ;([...document.querySelectorAll('.docket-new .docket-quiet')]
            .find(b => b.textContent === 'add') as HTMLElement | null)?.click()
          await settle(1600)
          const still = [...document.querySelectorAll('.docket-new .docket-field')] as HTMLInputElement[]
          say('refused', {
            // The row is still open, with every field as it was.
            open: document.querySelector('.docket-new') !== null,
            name: still[0]?.value ?? null,
            every: still[2]?.value ?? null,
            mode: (document.querySelector('.docket-new .docket-shape') as HTMLSelectElement | null)?.value ?? null,
            // And the reason is under the row, not at the top of the page.
            said: document.querySelector('.docket-refused')?.textContent ?? null,
            beside: (() => {
              const row = document.querySelector('.docket-new')?.getBoundingClientRect()
              const note = document.querySelector('.docket-refused')?.getBoundingClientRect()
              return row === undefined || note === undefined
                ? null
                : Math.round(note.top - row.bottom)
            })(),
            madeAnyway: [...document.querySelectorAll('.docket-name')]
              .some(n => (n.textContent ?? '').includes('kettle')),
          })
          // **Left by the door it came in by.** The rest of this scene counts
          // the matters on this docket, so completing the add here would move a
          // number a later check reads — and whether `every 5 years` parses is a
          // question about the grammar, asked of the grammar in its own test.
          ;([...document.querySelectorAll('.docket-new .docket-quiet')]
            .find(b => b.textContent === 'cancel') as HTMLElement | null)?.click()
          await settle(600)
          say('afterCancel', {
            closed: document.querySelector('.docket-new') === null,
            made: [...document.querySelectorAll('.docket-name')]
              .some(n => (n.textContent ?? '').includes('kettle')),
          })
        }

      // ── moving by hand: the grip, dragged and typed on ──
      {
        const rowOf = (word: string): Element | undefined =>
          [...document.querySelectorAll('.docket-row')].find(
            r => (r.querySelector('.docket-name')?.textContent ?? '').includes(word),
          )
        const gripOf = (word: string): HTMLElement | null =>
          (rowOf(word)?.querySelector('.docket-grip') as HTMLElement | null) ?? null
        // **Folded away by default**, which is what stops a one-step matter
        // reading as its own name twice over.
        // **Big enough to read as a direction.** It was a 9px `▸` — smaller
        // than the number beside it and at the mercy of the font — so it is
        // drawn now, and this is its actual size on screen.
        {
          const mark = document.querySelector('.docket-open-mark')
          const box = mark?.getBoundingClientRect()
          // **Either way up.** It is one shape turned through a right angle
          // rather than two characters, so an open matter's mark measures its
          // width and height the other way round.
          const w = Math.round(box?.width ?? 0)
          const h = Math.round(box?.height ?? 0)
          say('markSize', { across: Math.min(w, h), along: Math.max(w, h) })
        }
        // **Folded and unfolded, rather than *folded by default***, which is
        // not measurable here: the scene made these matters, and making one
        // opens it so its seeded step can be reworded. What the fold has to do
        // is answer the click.
        {
          const fold = (): void => {
            (rowOf('boiler')?.querySelector('.docket-open') as HTMLElement | null)?.click()
          }
          fold()
          await settle(250)
          say('folded', rowOf('boiler')?.querySelector('.docket-steps') === null)
          fold()
          await settle(250)
          say('unfolded', rowOf('boiler')?.querySelector('.docket-steps') !== null)
        }
        say('noTickOffered', document.querySelectorAll('.docket-step-done').length === 0)
        say('gripOffered', gripOf('boiler') !== null)
        // **Visible without being hovered**, because the thing reported from use
        // was not knowing that rows could be moved at all.
        {
          const grip = gripOf('boiler')
          const css = grip === null ? null : getComputedStyle(grip)
          const box = grip?.getBoundingClientRect()
          say('gripSeen', css === null ? null : {
            shown: css.display !== 'none' && css.visibility !== 'hidden',
            faint: parseFloat(css.opacity) > 0.3,
            draggable: grip?.getAttribute('draggable'),
            // Drawn rather than typed, so what proves it is there is a box with
            // size and a background — a glyph check would have passed while the
            // font substituted two dots for six.
            width: Math.round(box?.width ?? 0),
            height: Math.round(box?.height ?? 0),
            drawn: css.backgroundImage !== 'none',
            // **What makes it a drag SOURCE**, which is the part a synthetic
            // `dragstart` cannot check: dispatching the event by hand proves the
            // handlers are wired and says nothing about whether the engine would
            // ever begin a drag here. It would not, while this was a `<button>`.
            tag: grip?.nodeName,
            mayDrag: css.getPropertyValue('-webkit-user-drag').trim(),
          })
        }

        // **Pick it up, move it, let go — as pointer events, which is the whole
        // point of the rewrite.** The gesture used to be HTML5 drag-and-drop and
        // the only way to exercise it from here was to dispatch `dragstart`
        // ourselves, which proved the handlers and skipped whether a drag ever
        // began. It did not, twice, and every check passed anyway. These are the
        // same three events a hand produces.
        let attempt = 0
        /**
         * Press the grip, move, let go — and **aim after the press, not before**.
         * The target is located by a callback that runs once the row is in hand,
         * because measuring first is what hid a real defect: a strip that
         * appeared on `pointerdown` shifted every row down by its own height, so
         * the row under the cursor at aim time was not the row under it at drop
         * time. A test that measures before the gesture cannot see that.
         */
        const lift = async (from: string, aim: () => { x: number; y: number }): Promise<void> => {
          attempt += 1
          const tag = `${attempt}:${from}`
          const grip = gripOf(from)
          if (grip === null) return
          const at = grip.getBoundingClientRect()
          grip.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, button: 0, pointerId: 1,
            clientX: at.left + 4, clientY: at.top + 8,
          }))
          await settle(120)
          say(`lifted:${tag}`, document.querySelectorAll('.docket-row.lifted').length)
          const { x, y } = aim()
          window.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerId: 1, clientX: x, clientY: y,
          }))
          await settle(120)
          // What the surface thinks is under the pointer, and what it is
          // complaining about if anything — `.docket-problem` is where a bad
          // verb lands, and no check was reading it.
          {
            const at2 = document.elementFromPoint(x, y)
            const marked = document.querySelector('.docket-row.over-before, .docket-row.over-after')
            say(`aiming:${tag}`, {
              // Which row the pointer is over, by name, and which side of it the
              // surface thinks the drop is on.
              over: at2?.closest('.docket-row')?.querySelector('.docket-name')?.textContent ?? null,
              zone: at2?.closest('[data-drop-section]')?.getAttribute('data-drop-section') ?? null,
              marked: marked?.querySelector('.docket-name')?.textContent ?? null,
              edge: marked?.className.includes('over-before') === true ? 'before' : marked === null ? null : 'after',
              aimedAt: [Math.round(x), Math.round(y)],
            })
          }
          window.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true, pointerId: 1, clientX: x, clientY: y,
          }))
          await settle(1800)
          say(`said:${tag}`, {
            problem: document.querySelector('.docket-problem')?.textContent ?? 'none',
            // Zero means the pointerup handler ran and ended the drag.
            stillLifted: document.querySelectorAll('.docket-row.lifted').length,
          })
        }
        const drag = async (from: string, onto: string, half: 'top' | 'bottom'): Promise<void> => {
          await lift(from, () => {
            const box = (rowOf(onto) as Element).getBoundingClientRect()
            return { x: box.left + 60, y: half === 'top' ? box.top + 3 : box.bottom - 3 }
          })
        }
        await drag('air filters', 'boiler', 'top')
        say('dragged', [...document.querySelectorAll('.docket-section')].map(s2 =>
          [...s2.querySelectorAll('.docket-name')].map(n => n.textContent)))

        // And back down, by aiming at the bottom half instead.
        await drag('air filters', 'boiler', 'bottom')
        say('draggedBack', [...document.querySelectorAll('.docket-section')].map(s2 =>
          [...s2.querySelectorAll('.docket-name')].map(n => n.textContent)))

        // **Out of a section by dragging onto another section's heading**, which
        // is the gesture that was hard to find before.
        await lift('oven', () => {
          // The first NAMED section's heading; the undivided run's is also a
          // `.docket-section-head`, and dropping onto that would be a move to
          // where it already is.
          const heads = [...document.querySelectorAll('.docket-section-head:not(.loose)')]
          const box = (heads[0] as Element).getBoundingClientRect()
          return { x: box.left + 20, y: box.top + box.height / 2 }
        })
        say('draggedIntoSection', groupsOf())

        // The keyboard path the arrows used to be: focus the grip, press ↓.
        const grip = gripOf('oven')
        grip?.focus()
        say('gripTakesFocus', document.activeElement === grip)
        grip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
        await settle(1800)
        say('byKeyboard', [...document.querySelectorAll('.docket-section')].map(s2 =>
          [...s2.querySelectorAll('.docket-name')].map(n => n.textContent)))
      }

        // **Ungrouping the POPULATED one**, because the claim worth checking in
        // a live window is that taking a heading away does not take a house
        // with it.
        const ungroup = [...(document.querySelectorAll('.docket-section-head:not(.loose)')[0]
          ?.querySelectorAll('.docket-quiet') ?? [])].find(
          b => b.textContent === 'ungroup',
        ) as HTMLElement | null
        ungroup?.click()
        await settle(1500)
        say('afterUngroup', {
          sections: namesOf(),
          matters: [...document.querySelectorAll('.docket-name')].map(n => n.textContent).length,
        })

        // And put them back, so what is left on the screen at the end is a
        // docket somebody would actually be reading.
        for (const word of ['air filters', 'boiler']) await dragOntoHeading(word)
        const head = document.querySelector(
          '.docket-section-head:not(.loose) .docket-quiet',
        ) as HTMLElement | null
        head?.click()
        await settle(300)
        const rename = document.querySelector('.docket-field.section') as HTMLInputElement | null
        if (rename !== null) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          setter?.call(rename, 'Periodic maintenance')
          rename.dispatchEvent(new Event('input', { bubbles: true }))
          rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          await settle(1500)
        }
        say('renamed', namesOf())

        // **Add INTO a section**, the task list's gesture: the button at the
        // foot of a group adds to that group, so the add row has nothing left
        // to ask about where it goes.
        const addTo = [...document.querySelectorAll('.docket-add.here')].find(
          b => (b.textContent ?? '').includes('Periodic maintenance'),
        ) as HTMLElement | null
        say('addHereOffered', addTo !== null)
        addTo?.click()
        await settle(300)
        const typing = [...document.querySelectorAll('.docket-new .docket-field')] as HTMLInputElement[]
        say('addHereAsksNothing', document.querySelectorAll('.docket-new .docket-shape').length)
        if (typing[0] !== undefined) set(typing[0], 'Bleed the radiators')
        typing[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1800)
        say('addedHere', groupsOf())
      }

      // ── steps, chained, and activation (MH3a, D76) ──
      {
        const rowOf = (word: string): Element | undefined =>
          [...document.querySelectorAll('.docket-row')].find(
            r => (r.querySelector('.docket-name')?.textContent ?? '').includes(word),
          )
        /**
         * Show a matter's steps, since they are folded away by default.
         *
         * **Awaited, or the caller looks before React has drawn.** This clicked
         * and returned synchronously, which was invisible while a new matter
         * opened itself — there was nothing to unfold. Once a new matter arrives
         * folded (MH4), every later block began typing into a row that did not
         * exist yet, and ten checks failed at the wrong end of the scene.
         */
        const openUp = async (word: string): Promise<void> => {
          const row = rowOf(word)
          if (row?.querySelector('.docket-steps') !== null) return
          ;(row?.querySelector('.docket-open') as HTMLElement | null)?.click()
          await settle(350)
        }
        const stepsOf = (word: string): { when: string; what: string; done: boolean }[] =>
          [...(rowOf(word)?.querySelectorAll('.docket-step:not(.new)') ?? [])].map(one => ({
            when: one.querySelector('.docket-step-when')?.textContent ?? '',
            what: one.querySelector('.docket-step-what')?.textContent ?? '',
            // **Read from how it LOOKS**, since there is no tick to read: the
            // docket shows that a step is done and no longer offers to set it.
            done: one.className.includes('done'),
          }))
        /**
         * Make sure the add row is showing — **never toggle it blind**.
         * The control is a toggle, and the row now stays open after a
         * successful add, so clicking it on the assumption that it is closed
         * shuts it instead. That is what broke seven checks at once: every
         * later block typed into a row that was no longer there.
         */
        const openAdd = async (word: string): Promise<void> => {
          await openUp(word)
          const row = rowOf(word)
          if (row?.querySelector('.docket-step.new') !== null) return
          const toggle = [...(row?.querySelectorAll('.docket-quiet') ?? [])].find(
            b => (b.textContent ?? '').trim() === '+ step',
          ) as HTMLElement | null
          toggle?.click()
          await settle(300)
        }
        const addStep = async (
          word: string,
          when: string,
          what: string,
          kind?: string,
        ): Promise<void> => {
          await openAdd(word)
          const row = rowOf(word)
          if (kind !== undefined) {
            const pick = row?.querySelector('.docket-step.new .docket-step-kind') as HTMLSelectElement | null
            if (pick !== null && pick !== undefined) {
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
              setter?.call(pick, kind)
              pick.dispatchEvent(new Event('change', { bubbles: true }))
              await settle(150)
            }
          }
          const at = row?.querySelector('.docket-step.new .docket-field.narrow') as HTMLInputElement | null
          const what2 = row?.querySelector('.docket-step.new .docket-field.wide') as HTMLInputElement | null
          if (at !== null && at !== undefined) set(at, when)
          if (what2 !== null && what2 !== undefined) set(what2, what)
          what2?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          await settle(1600)
        }

        // A backlog matter with a chain: the first step is due on activation,
        // the second waits for the first.
        ;(document.querySelector('.docket-add.here') as HTMLElement | null)?.click()
        await settle(300)
        const made = [...document.querySelectorAll('.docket-new .docket-field')] as HTMLInputElement[]
        if (made[0] !== undefined) set(made[0], 'The car needs fixing')
        made[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1600)
        say('backlogged', rowOf('car')?.querySelector('.docket-when')?.textContent ?? null)
        say('activateOffered',
          rowOf('car')?.querySelector('.docket-start')?.textContent ?? null)

        // **Blank `when`, and Enter from the text field** — which is how it is
        // actually typed, and which used to do nothing at all: the row returned
        // silently on an empty schedule, so the key looked broken.
        await addStep('car', '', 'find a suitable shop')
        await openUp('car')
        say('firstStep', stepsOf('car'))
        // **Stays open for the next step**, so a sequence is typed in one go.
        say('rowWaitsForTheNext', {
          open: rowOf('car')?.querySelector('.docket-step.new') !== null,
          cleared: (rowOf('car')?.querySelector('.docket-step.new .docket-field.wide') as HTMLInputElement | null)?.value ?? null,
          exit: [...(rowOf('car')?.querySelectorAll('.docket-step.new .docket-quiet') ?? [])]
            .map(b => b.textContent),
        })
        // And Escape is the way out.
        ;(rowOf('car')?.querySelector('.docket-step.new .docket-field.narrow') as HTMLElement | null)
          ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await settle(400)
        say('escapeClosesIt', rowOf('car')?.querySelector('.docket-step.new') === null)
        say('rowAsks', {
          when: (rowOf('car')?.querySelector('.docket-step.new .docket-field.narrow') as HTMLInputElement | null)?.placeholder ?? null,
          buttons: [...(rowOf('car')?.querySelectorAll('.docket-step.new .docket-quiet') ?? [])]
            .map(b => b.textContent),
        })

        // **The chain.** The field takes the antecedent's id — which is what the
        // file holds, so that inserting a step above it cannot repoint it — and
        // the surface reads it back as that step's name.
        const docketId = (await window.tephra.docket.list())[0]?.id
        // **By name, because a matter is born with a step now**: the shape it
        // was made from seeds one, so `steps[0]` is no longer the step this is
        // about.
        const shopId = docketId === undefined
          ? ''
          : (await window.tephra.docket.matters(docketId))
            .find(m => m.name === 'The car needs fixing')
            ?.steps.find(one => one.text === 'find a suitable shop')?.id ?? ''
        await addStep('car', `after ${shopId}`, 'have the car fixed')
        await openUp('car')
        say('chained', stepsOf('car'))

        // **A bad `when` must not eat the typing** — reported from use as *it
        // just seems to drop the item*, because the row closed before the verb
        // came back and took the words with it.
        {
          await openAdd('car')
          const row = rowOf('car')
          const at = row?.querySelector('.docket-step.new .docket-field.narrow') as HTMLInputElement | null
          const what = row?.querySelector('.docket-step.new .docket-field.wide') as HTMLInputElement | null
          // `soon` — because `then` became a real schedule on request, so the
          // word this once failed on now works, and the failure case had to
          // move to something that is genuinely not a schedule.
          if (at !== null && at !== undefined) set(at, 'soon')
          if (what !== null && what !== undefined) set(what, 'a step that must survive')
          what?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          await settle(1500)
          const still = rowOf('car')?.querySelector('.docket-step.new .docket-field.wide') as HTMLInputElement | null
          say('badWhenKeptTheWords', {
            open: still !== null,
            text: still?.value ?? null,
            said: document.querySelector('.docket-problem')?.textContent ?? 'none',
            steps: stepsOf('car').length,
          })
          // Correct it in place and it goes in.
          const fix = rowOf('car')?.querySelector('.docket-step.new .docket-field.narrow') as HTMLInputElement | null
          if (fix !== null && fix !== undefined) set(fix, '2 weeks')
          still?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          await settle(1500)
          say('thenCorrected', stepsOf('car'))
        }

        // **`then` and `after 1`**, the two references a person can actually
        // type — an id is eight random characters and never shown. Both are
        // resolved to a real id on the way in.
        say('indicesShown', [...(rowOf('car')?.querySelectorAll('.docket-step-at') ?? [])]
          .map(n => n.textContent))
        await addStep('car', 'then', 'and then this one')
        say('afterThen', stepsOf('car').map(one => one.when))
        await addStep('car', 'after 1', 'and this waits on the first')
        say('afterIndex', stepsOf('car').map(one => `${one.when} · ${one.what}`))

        // **A reschedule step**, which is how a matter comes to recur from its
        // own completion — and which had no way in at all until the row could
        // say which kind it was making.
        say('stepAddReads', [...(rowOf('car')?.querySelectorAll('.docket-quiet') ?? [])]
          .map(b => (b.textContent ?? '').trim())
          .find(t => t.endsWith('step')) ?? null)
        say('kindOffered', [...(rowOf('car')?.querySelectorAll('.docket-step.new .docket-step-kind option') ?? [])]
          .map(o => o.textContent))
        say('caretStartsInWhat', document.activeElement?.className ?? null)

        // **A matter that keeps its own time**, which is the fourth shape: the
        // recurrence is the matter's two fields, and the radio says which step
        // starts the next one. No machinery step anywhere.
        ;(document.querySelector('.docket-add.here') as HTMLElement | null)?.click()
        await settle(300)
        shape('recurring-task')
        await settle(200)
        const upkeep = [...document.querySelectorAll('.docket-new .docket-field')] as HTMLInputElement[]
        if (upkeep[0] !== undefined) set(upkeep[0], 'Sharpen the mower')
        if (upkeep[1] !== undefined) set(upkeep[1], '2026-10-01')
        if (upkeep[2] !== undefined) set(upkeep[2], '90d')
        upkeep[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1800)
        // Unfolded first: steps are put away by default now (MH4), so asking
        // how many a matter has without opening it counts a folded list.
        await openUp('mower')
        say('keepUp', {
          when: rowOf('mower')?.querySelector('.docket-when')?.textContent ?? null,
          steps: (rowOf('mower')?.querySelectorAll('.docket-step:not(.new)').length ?? 0),
          clock: (rowOf('mower')?.querySelectorAll('.docket-step-clock input:checked').length ?? 0),
        })

        // **Fixing a typo in place**, which was impossible: a step's text was a
        // label, so the only repair was to drop it — losing the id its
        // dependents point at.
        {
          const target = [...(rowOf('car')?.querySelectorAll('.docket-step:not(.new)') ?? [])]
            .find(one => (one.querySelector('.docket-step-what')?.textContent ?? '')
              .includes('survive'))
          const what = target?.querySelector('.docket-step-what') as HTMLElement | null
          say('stepTextIsClickable', what?.tagName ?? null)
          what?.click()
          await settle(300)
          const field = target?.querySelector('.docket-field.wide') as HTMLInputElement | null
          if (field !== null && field !== undefined) set(field, 'a step that did survive')
          field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          await settle(1500)
          say('typoFixed', stepsOf('car').map(one => one.what))
        }

        // **Finished through the API, because the surface no longer offers it.**
        // A docket describes work and the task list is where work is done, so
        // completion will arrive from a generated task being closed. The state
        // still has to be here — a dependency reads it and suspending preserves
        // it — which is exactly what the next two checks are about.
        {
          const car = docketId === undefined
            ? undefined
            : (await window.tephra.docket.matters(docketId))
              .find(m => m.name === 'The car needs fixing')
          const shop = car?.steps.find(one => one.text === 'find a suitable shop')?.id
          if (docketId !== undefined && car?.id != null && shop != null) {
            await window.tephra.docket.completeStep(docketId, car.id, shop, true)
            const after = (await window.tephra.docket.matters(docketId))
              .find(m => m.id === car.id)
            say('ticked', after?.steps.map(one => ({
              what: one.text,
              done: one.done !== null,
            })))
            // **And the open surface knows without being touched**, which is
            // the whole point: that write came from outside this view, the way
            // generation will. Nothing was clicked between the verb and this.
            await settle(600)
            await openUp('car')
            await settle(200)
            say('surfaceHeard', stepsOf('car').some(one =>
              one.what === 'find a suitable shop' && one.done))
          }
          await settle(400)
        }

        // **Activate**, which is what the whole phase is for.
        const go = rowOf('car')?.querySelector('.docket-start') as HTMLElement | null
        go?.click()
        await settle(1800)
        say('activated', {
          when: rowOf('car')?.querySelector('.docket-when')?.textContent ?? null,
          offers: rowOf('car')?.querySelector('.docket-start')?.textContent ?? null,
        })

        // And suspend, which must not undo the tick.
        const stop = rowOf('car')?.querySelector('.docket-start') as HTMLElement | null
        stop?.click()
        await settle(1800)
        say('suspended', {
          when: rowOf('car')?.querySelector('.docket-when')?.textContent ?? null,
          steps: stepsOf('car'),
        })
      }

      // ── the docket puts work on the list, and keeps it in step (MH3a/b) ──
      {
        const docketId = (await window.tephra.docket.list())[0]?.id
        const mower = docketId === undefined
          ? undefined
          : (await window.tephra.docket.matters(docketId)).find(m => m.name.includes('mower'))
        // Started, so its first step is due today.
        if (docketId !== undefined && mower?.id != null) {
          await window.tephra.docket.activate(docketId, mower.id)
        }
        await window.tephra.docket.generate()
        const list = await window.tephra.todo.which()
        const day = await window.tephra.todo.today(list)
        const items = await window.tephra.todo.items(list, day)
        say('onTheList', items.map(one => one.text).filter(t => t.includes('mower')))
        // **Twice changes nothing**, which is the rule the whole pass rests on.
        //
        // **Asked of the list rather than of a report.** `generate` used to
        // answer with what it had made and withdrawn, and this counted both
        // being zero — which a pass that withdrew one and made one back would
        // have passed, since it reports one of each. The ids are the real claim.
        const before = JSON.stringify(items.map(one => one.id))
        await window.tephra.docket.generate()
        const after = JSON.stringify((await window.tephra.todo.items(list, day)).map(one => one.id))
        say('sameAfterTwice', before === after)
        say('countAfterTwice', (await window.tephra.todo.items(list, day)).length)

        // **And it withdraws**, which is the half that makes it a reconciler
        // rather than a sweep: clearing the start date is the only act, and the
        // next pass is what notices the task is no longer wanted.
        if (docketId !== undefined && mower?.id != null) {
          await window.tephra.docket.suspend(docketId, mower.id)
          const left = await window.tephra.todo.items(list, await window.tephra.todo.today(list))
          say('afterSuspend', left.map(one => one.text).filter(t => t.includes('mower')))
          // **Activating IS the pass now** (MH4), so what proves it came back is
          // the list, not a count the verb has already spent.
          await window.tephra.docket.activate(docketId, mower.id)
          const back = await window.tephra.todo.items(list, await window.tephra.todo.today(list))
          say('afreshOnList', back.map(one => one.text).filter(t => t.includes('mower')))
        }
      }

      await window.tephra.doc.flush()
      say('appError', document.querySelector('.scaffold .bad')?.textContent ?? 'none')
      await settle(800)
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

    if (scene === 'tag-region') {
      // A subject stretched over whole paragraphs, which is the case that sent
      // tags to the margin: the underline landed on every line of the section,
      // and three deep where subjects overlapped. Reported from use.
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

      const text = view.state.doc.toString()
      const from = text.indexOf('Every market')
      const to = text.indexOf('THE END')
      say('span', to - from)
      view.dispatch({ selection: { anchor: from, head: to } })
      await settle(300)
      say('tagged', await answer('Tag…', 'Shock limits'))
      await window.tephra.doc.flush()
      view.dispatch({ selection: { anchor: 0 } })
      await settle(900)

      // THE POINT: nothing under the words, and a rule beside them instead.
      say('underlines', document.querySelectorAll('.tx-tag').length)
      const spines = [...document.querySelectorAll('.tag-spine')] as HTMLElement[]
      say('spines', spines.length)
      {
        const one = spines[0]
        const rule = one?.getBoundingClientRect()
        // **Measured against a LINE, not against `.cm-content`.** The band is
        // that element's own padding, so its border box starts at the band's
        // left edge — comparing with it asks whether the spine is left of the
        // space reserved for the spine, which is not the question. A line sits
        // inside the padding and so begins where the text actually begins.
        const column = document.querySelector('.cm-line')?.getBoundingClientRect()
        say('spineBox', rule === undefined || column === undefined ? null : {
          // Beside the text, not under it: entirely left of the first character.
          leftOfText: Math.round(column.left - rule.right) >= 0,
          // Narrow, and as tall as the region it marks rather than as tall as
          // a line — which is the whole difference from an underline.
          width: Math.round(rule.width),
          tall: Math.round(rule.height) > 40,
          // And it is in the band the layout reserves, not hanging in the text.
          band: Math.round(
            parseFloat(getComputedStyle(document.querySelector('.cm-content') as Element).paddingLeft),
          ),
          // **One unbroken rule over the whole region**, blank lines included.
          // A region is a territory, so a spine that stopped at each paragraph
          // break would be claiming several small ones instead of one large.
          top: Math.round(rule.top),
          height: Math.round(rule.height),
          region: (() => {
            const lines = [...document.querySelectorAll('.cm-line')] as HTMLElement[]
            const first = lines.find(l => (l.textContent ?? '').includes('Every market'))
            const last = lines.find(l => (l.textContent ?? '').includes('work without it'))
            const a = first?.getBoundingClientRect()
            const b = last?.getBoundingClientRect()
            return a === undefined || b === undefined
              ? null
              : { top: Math.round(a.top), height: Math.round(b.bottom - a.top) }
          })(),
        })
      }

      await shot()

      // AND IT IS THE HANDLE: a wide tag's own mark is off screen at the top of
      // the region, so this is the only way to reach the panel that renames or
      // removes one.
      spines[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      await settle(700)
      const panel = document.querySelector('.mark-panel')
      say('panel', panel === null ? null : {
        opened: true,
        named: [...panel.querySelectorAll('.mark-name')].map(n => n.textContent),
        offers: [...panel.querySelectorAll('button')].map(b => b.textContent),
      })
      await settle(1800)
    }

    if (scene === 'mark-panel') {
      // Reported from use: clicking a marker showed a panel saying *nothing
      // resolves here*, for a mark the editor had itself drawn.
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
      const text = view.state.doc.toString()
      const from = text.indexOf('Klein, Crawford')
      view.dispatch({ selection: { anchor: from, head: from + 'Klein, Crawford and Alchian'.length } })
      await settle(300)
      say('tagged', await answer('Tag…', 'House Deal'))
      await window.tephra.doc.flush()
      view.dispatch({ selection: { anchor: 0 } })
      await settle(900)

      // A tagged range is written with TWO markers, so it draws two handles.
      const handles = [...document.querySelectorAll('.tx-handle')] as HTMLElement[]
      say('handles', handles.length)
      const asked: unknown[] = []
      for (let i = 0; i < handles.length; i++) {
        handles[i]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        await settle(500)
        const panel = document.querySelector('.mark-panel')
        asked.push({
          at: i,
          names: [...(panel?.querySelectorAll('.mark-name') ?? [])].map(n => n.textContent),
          kinds: [...(panel?.querySelectorAll('.mark-kind') ?? [])].map(n => n.textContent),
        })
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await settle(300)
      }
      say('resolved', asked)

      // And a BOOKMARK's marker, which resolves by a different rule in
      // `markAt` — the tag's span begins after its marker, the anchor's is
      // asked for AT it.
      view.dispatch({ selection: { anchor: 0 } })
      await settle(300)
      say('bookmarked', await answer('Bookmark…', 'The opening'))
      await window.tephra.doc.flush()
      view.dispatch({ selection: { anchor: view.state.doc.length } })
      await settle(900)
      const all = [...document.querySelectorAll('.tx-handle')] as HTMLElement[]
      say('handlesNow', all.length)
      const afterBookmark: unknown[] = []
      for (let i = 0; i < all.length; i++) {
        all[i]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        await settle(500)
        const panel = document.querySelector('.mark-panel')
        afterBookmark.push({
          at: i,
          names: [...(panel?.querySelectorAll('.mark-name') ?? [])].map(n => n.textContent),
          kinds: [...(panel?.querySelectorAll('.mark-kind') ?? [])].map(n => n.textContent),
        })
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await settle(300)
      }
      say('resolvedWithBookmark', afterBookmark)
      say('anchorSpans', (await window.tephra.doc.spans({ kind: 'anchor' })).length)

      // And a COMMENT's marker, which `markAt` does not ask about at all.
      const said = view.state.doc.toString()
      const at = said.indexOf('property of the participant')
      view.dispatch({ selection: { anchor: at, head: at + 'property of the participant'.length } })
      await settle(300)
      // **No dialog** — the note opens in the margin ready to type in (D47), so
      // this is typed where a person types it rather than into a prompt.
      say('commented', await window.tephra.clickMenu('Comment…'))
      await settle(1200)
      const composer = document.querySelector('.composer textarea') as HTMLTextAreaElement | null
      say('composerOpened', composer !== null)
      if (composer !== null) {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        set?.call(composer, 'Is this the right word for it?')
        composer.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(200)
        composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle(1200)
      }
      await window.tephra.doc.flush()
      view.dispatch({ selection: { anchor: 0 } })
      await settle(1200)
      const every = [...document.querySelectorAll('.tx-handle')] as HTMLElement[]
      say('handlesWithComment', every.length)
      const afterComment: unknown[] = []
      for (let i = 0; i < every.length; i++) {
        every[i]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        await settle(500)
        const panel = document.querySelector('.mark-panel')
        afterComment.push({
          at: i,
          names: [...(panel?.querySelectorAll('.mark-name') ?? [])].map(n => n.textContent),
          kinds: [...(panel?.querySelectorAll('.mark-kind') ?? [])].map(n => n.textContent),
          who: [...(panel?.querySelectorAll('.mark-who') ?? [])].map(n => n.textContent),
        })
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await settle(300)
      }
      say('resolvedWithComment', afterComment)

      // The comment's marker is the reported case, so its panel is the one the
      // picture is of — found by what it says rather than by its index, so the
      // scene keeps meaning this even if the fixture gains another marker.
      for (const handle of every) {
        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        await settle(450)
        const kind = document.querySelector('.mark-panel .mark-kind')?.textContent
        if (kind === 'Comment') break
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        await settle(250)
      }
      say('photographed', document.querySelector('.mark-panel .mark-kind')?.textContent ?? null)
      await shot()
      await settle(1500)
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
  /** The editable element, for driving a real paste or drop at it (R7). */
  readonly contentDOM: HTMLElement
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
