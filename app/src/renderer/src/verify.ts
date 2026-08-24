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

    if (scene === 'undo') {
      // Undo moved from a keydown listener to Edit ▸ Undo. The path is entirely
      // new — menu item, IPC, RemoteDocument — and nothing tested it end to end
      // before, so this drives the real menu item and reads the buffer.
      // Append at the end of the buffer each time. The first version took the
      // caret for the second insert and got the SAME offset as the first,
      // producing "SECOND. FIRST. " — two inverse deletes over overlapping
      // ranges, a shape real typing never makes because the caret advances.
      const live = (): EditorViewLike =>
        (globalThis as unknown as { __view: EditorViewLike }).__view
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
      const once = (globalThis as unknown as { __view?: EditorViewLike }).__view?.state.doc.toString() ?? ''
      say('afterUndo', { hasFirst: once.includes('FIRST.'), hasSecond: once.includes('SECOND.') })

      // Is it the menu path, or is undo itself not reaching the buffer? Call the
      // same method the menu's handler calls, directly.
      await window.tephra.doc.flush()
      say('flushedAfterUndo', true)

      const docHandle = (globalThis as unknown as { __doc?: { undo(): Promise<unknown> } }).__doc
      say('directUndoAvailable', docHandle !== undefined)
      if (docHandle !== undefined) {
        await docHandle.undo()
        await settle(900)
        const direct = (globalThis as unknown as { __view?: EditorViewLike }).__view?.state.doc.toString() ?? ''
        say('afterDirectUndo', { hasFirst: direct.includes('FIRST.'), hasSecond: direct.includes('SECOND.') })
      }

      say('redoItemFound', await window.tephra.clickMenu('Redo'))
      await settle(900)
      const back = (globalThis as unknown as { __view?: EditorViewLike }).__view?.state.doc.toString() ?? ''
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
        (globalThis as unknown as { __view: EditorViewLike }).__view
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
      say('badges', [...document.querySelectorAll('.tx-marker')].map(e => e.textContent))

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
      const away = (globalThis as unknown as { __view: EditorViewLike }).__view
      say('navigatedAway', {
        location: pane.location,
        windowHasMarker: away.state.doc.toString().includes('MARKER-TEXT'),
      })

      const before = away.state.doc.toString()
      // Through the MENU, which is the only path a person has — calling
      // doc.undo() directly would bypass the very code being tested.
      const change = await window.tephra.clickMenu('Undo')
      await settle(1200)
      const after = (globalThis as unknown as { __view: EditorViewLike }).__view.state.doc.toString()
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
  state: {
    doc: { toString(): string; length: number }
    selection: { main: { head: number; from: number; to: number; empty: boolean } }
  }
  dispatch(spec: unknown): void
}
interface PaneLike {
  readonly location: unknown
}
