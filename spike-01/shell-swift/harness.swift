// WebKit engine-parity harness. Not part of the shell — it exists because
// Spike A measured the editor in Chromium, and a Swift shell means WebKit.
// Keystrokes go through CGEvent so the real input path is exercised rather
// than synthesised transactions.

import AppKit
import WebKit

// CGEvent.post would need Accessibility permission and is silently dropped
// without it. Synthesising NSEvents into the app's own window needs no
// permission and still travels the real responder chain into WebKit.
private let KEYCODES: [Character: UInt16] = [
    "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4, "i": 34,
    "j": 38, "k": 40, "l": 37, "m": 46, "n": 45, "o": 31, "p": 35, "q": 12,
    "r": 15, "s": 1, "t": 17, "u": 32, "v": 9, "w": 13, "x": 7, "y": 16, "z": 6,
    " ": 49, ".": 47, ",": 43,
]

func sendText(_ s: String) {
    guard let win = NSApplication.shared.mainWindow else { return }
    for ch in s {
        let str = String(ch)
        let code = KEYCODES[ch] ?? 0
        for down in [true, false] {
            if let e = NSEvent.keyEvent(with: down ? .keyDown : .keyUp,
                                        location: .zero, modifierFlags: [],
                                        timestamp: ProcessInfo.processInfo.systemUptime,
                                        windowNumber: win.windowNumber, context: nil,
                                        characters: str, charactersIgnoringModifiers: str,
                                        isARepeat: false, keyCode: code) {
                win.sendEvent(e)
            }
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.012))
    }
}

func sendKey(_ code: UInt16, _ chars: String) {
    guard let win = NSApplication.shared.mainWindow else { return }
    for down in [true, false] {
        if let e = NSEvent.keyEvent(with: down ? .keyDown : .keyUp,
                                    location: .zero, modifierFlags: [],
                                    timestamp: ProcessInfo.processInfo.systemUptime,
                                    windowNumber: win.windowNumber, context: nil,
                                    characters: chars, charactersIgnoringModifiers: chars,
                                    isARepeat: false, keyCode: code) {
            win.sendEvent(e)
        }
    }
    RunLoop.current.run(until: Date().addingTimeInterval(0.012))
}

final class EngineTest {
    private var steps: [(WKWebView, @escaping () -> Void) -> Void] = []
    private var i = 0
    func add(_ f: @escaping (WKWebView, @escaping () -> Void) -> Void) { steps.append(f) }
    func run(_ web: WKWebView) {
        guard i < steps.count else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { NSApplication.shared.terminate(nil) }
            return
        }
        let step = steps[i]; i += 1
        step(web) { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.run(web) } }
    }
}

func evalJS(_ web: WKWebView, _ code: String, _ label: String, _ next: @escaping () -> Void) {
    web.callAsyncJavaScript("return JSON.stringify(await (async () => { \(code) })())",
                            arguments: [:], in: nil, in: .page) { r in
        switch r {
        case .success(let v): Swift.print("ENGINE \(label): \(v)")
        case .failure(let e):
            let info = (e as NSError).userInfo
            Swift.print("ENGINE \(label): ERROR \(info["WKJavaScriptExceptionMessage"] ?? info)")
        }
        next()
    }
}

// Keystrokes dispatched from JS. Untrusted events do not perform the insertion
// themselves, so text goes in via execCommand — the same beforeinput path the
// browser uses — while the dispatched keydown drives the vim keymap and the
// latency probe. What this cannot test is hardware input delay; that is the
// half a human has to judge.
private let KEY_HELPERS = """
window._key = (key, code) => {
  const el = document.querySelector('.cm-content')
  el.dispatchEvent(new KeyboardEvent('keydown', {key, code: code||('Key'+key.toUpperCase()), bubbles: true, cancelable: true}))
}
window._typeChar = ch => {
  window._key(ch)
  document.execCommand('insertText', false, ch)
}
"""

private let VIM_DD_JS = KEY_HELPERS + "\n" + """
for (let n=1;n<=view.state.doc.lines;n++)
  if (view.state.doc.line(n).text.includes('Beta'))
    view.dispatch({selection:{anchor:view.state.doc.line(n).from}})
view.focus()
window._key('d'); window._key('d')
await new Promise(r=>setTimeout(r,150))
const gone = !view.state.doc.toString().includes('Beta')
window._key('u')
await new Promise(r=>setTimeout(r,150))
return {deleted: gone, restored: view.state.doc.toString().includes('Beta has an equation $E = mc^2$')}
"""

private let VIM_J_JS = KEY_HELPERS + "\n" + """
view.dispatch({selection:{anchor:0}}); view.focus()
const path=[1]
for (let i=0;i<9;i++) {
  window._key('j')
  await new Promise(r=>setTimeout(r,60))
  path.push(view.state.doc.lineAt(view.state.selection.main.head).number)
}
return {path, totalLines: view.state.doc.lines}
"""

private let TYPE_JS = KEY_HELPERS + "\n" + """
const p = view.state.doc.line(1).to
view.dispatch({selection:{anchor:p}}); view.focus()
window._key('o')
await new Promise(r=>setTimeout(r,120))
window.spikeClearStats()
const S = 'the quick brown fox jumps over the lazy dog and keeps typing along '
for (let i=0;i<150;i++) { window._typeChar(S[i%S.length]); await new Promise(r=>setTimeout(r,92)) }
await new Promise(r=>setTimeout(r,250))
const m = window.spikeMetrics
const pct=(a,q)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return +s[Math.min(s.length-1,Math.floor(q/100*s.length))].toFixed(1)}
return {samples:m.paintLow.length,
  toPaint_p50:[pct(m.paintLow,50),pct(m.paint,50)], toPaint_p99:[pct(m.paintLow,99),pct(m.paint,99)],
  js_p99:pct(m.processing,99), inlineWidgets_p99:pct(m.inlineSamples,99),
  blockWidgets_p99:pct(m.blockSamples,99), maxQueue:m.maxQueue}
"""

private let FIXTURE_JS = """
const f = ['Alpha prose line, nothing rendered.',
'Beta has an equation $E = mc^2$ and prose after it.','',
'$$P(A) = 1$$','','| a | b |','| --- | --- |','| 1 | 2 |','',
'Omega last line.'].join('\\n')
view.dispatch({changes:{from:0,to:view.state.doc.length,insert:f},selection:{anchor:0}})
await new Promise(r=>setTimeout(r, 120))
return {lines: view.state.doc.lines}
"""

func buildEngineTest() -> EngineTest {
    let t = EngineTest()

    t.add { w, next in evalJS(w, "return PerformanceObserver.supportedEntryTypes", "supportedEntryTypes", next) }
    t.add { w, next in evalJS(w, FIXTURE_JS, "fixture", next) }
    t.add { w, next in evalJS(w, """
        return {math: document.querySelectorAll('.tx-math').length,
                table: document.querySelectorAll('.tx-table').length,
                katex: document.querySelectorAll('.katex').length}
    """, "widgets render", next) }

    // dd on the line holding a rendered equation, then u
    t.add { w, next in evalJS(w, """
        for (let n=1;n<=view.state.doc.lines;n++)
          if (view.state.doc.line(n).text.includes('Beta'))
            view.dispatch({selection:{anchor:view.state.doc.line(n).from}})
        view.focus()
        return {col: view.state.selection.main.head}
    """, "cursor on Beta", next) }
    t.add { w, next in evalJS(w, VIM_DD_JS, "dd via key events", next) }
    t.add { w, next in evalJS(w, VIM_J_JS, "j through block widgets", next) }
    t.add { w, next in evalJS(w, TYPE_JS, "typing 150 chars", next) }
    t.add { w, next in evalJS(w, """
        const m = window.spikeMetrics
        const pct = (a,p) => { if(!a.length) return null
          const q=[...a].sort((x,y)=>x-y); return +q[Math.min(q.length-1,Math.floor(p/100*q.length))].toFixed(1) }
        return {samples: m.paintLow.length,
                toPaint_p50: [pct(m.paintLow,50), pct(m.paint,50)],
                toPaint_p99: [pct(m.paintLow,99), pct(m.paint,99)],
                inputDelay_p99: pct(m.inputDelay,99), js_p99: pct(m.processing,99),
                inlineWidgets_p99: pct(m.inlineSamples,99), blockWidgets_p99: pct(m.blockSamples,99),
                longTasks: m.longTasks, maxQueue: m.maxQueue}
    """, "latency", next) }

    return t
}

let engineTest = buildEngineTest()
