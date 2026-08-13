// Spike B — native Swift shell hosting a WKWebView.
//
// The question is not whether printing a range and pasting an image are
// possible. It is how much shell-side code and ceremony each costs, and whether
// a realistic asset-loading strategy keeps the web layer's capabilities intact.
//
// Sections are marked so tools/count.sh can attribute lines to each operation.
// Build:  ./build.sh     Run:  ./run.sh [localhost|file|scheme]

import AppKit
import WebKit
import UniformTypeIdentifiers

// MARK: begin infrastructure — window, app lifecycle, menus (out of scope per the plan)

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : "localhost"
let publicDir = ProcessInfo.processInfo.environment["TEPHRA_PUBLIC"]
    ?? FileManager.default.currentDirectoryPath + "/../editor/public"
let notesDir = ProcessInfo.processInfo.environment["TEPHRA_NOTES"]
    ?? FileManager.default.currentDirectoryPath + "/notes"
let startPage = ProcessInfo.processInfo.environment["TEPHRA_PAGE"] ?? "index.html"

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
}

// A minimal Edit menu is not decoration: without it AppKit never routes ⌘V, ⌘C
// or ⌘A through the responder chain, and the web view simply never sees them.
func installMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem(); main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    let editItem = NSMenuItem(); main.addItem(editItem)
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    NSApplication.shared.mainMenu = main
}

// MARK: end infrastructure

// MARK: begin loadmode — serving the app's own assets three ways

// A custom scheme has no port to allocate and is unreachable from any other
// process on the machine, which is why a shipping build would want one. What it
// costs in capability is exactly what this spike is measuring.
final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/" + startPage }
        let file = root.appendingPathComponent(path)
        guard let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!)
            task.didFinish()
            return
        }
        let type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        // It must be an HTTPURLResponse with a real status. A plain URLResponse
        // makes fetch() see an opaque status-0 reply and refuse the body — which
        // looks exactly like a CORS failure and is not one.
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": type,
            "Content-Length": String(data.count),
            "Access-Control-Allow-Origin": "*",
        ])!
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// One configuration recipe, used by the main view and by the offscreen print
// view, so both resolve the app's own assets identically.
func makeAssetConfig() -> WKWebViewConfiguration {
    let c = WKWebViewConfiguration()
    c.setURLSchemeHandler(AssetSchemeHandler(root: URL(fileURLWithPath: publicDir)), forURLScheme: "tephra")
    if mode == "file" {
        c.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        c.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
    }
    return c
}

func startURL(for mode: String) -> URL {
    switch mode {
    case "file":   return URL(fileURLWithPath: publicDir).appendingPathComponent(startPage)
    case "scheme": return URL(string: "tephra://app/" + startPage)!
    default:       return URL(string: "http://localhost:8321/" + startPage)!
    }
}

// MARK: end loadmode

// MARK: begin bridge — exposing native operations to the page

// Injected before the page runs, so window.tephra exists by the time the editor
// boots and can be feature-detected rather than polled for.
let BRIDGE_JS = """
window.tephra = {
  name: 'swift',
  _call(op, arg) {
    return window.webkit.messageHandlers.tephra.postMessage({ op, arg })
  },
  print(html) { return this._call('print', html) },
  pasteImage() { return this._call('pasteImage', null) },
  report(json) { return this._call('report', json) },
}
"""

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var window: NSWindow?
    var printer: Printer?

    func userContentController(_ ucc: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "malformed message"); return
        }
        switch op {
        case "print":
            guard let html = body["arg"] as? String else { replyHandler(nil, "no html"); return }
            printer = Printer(baseURL: message.frameInfo.request.url)
            printer?.print(html: html, in: window) { err in
                replyHandler(err == nil ? ["ok": true] : nil, err)
            }
        case "pasteImage":
            replyHandler(pasteImageFromPasteboard(), nil)
        case "report":
            print("CAPS \(body["arg"] as? String ?? "")")
            replyHandler(["ok": true], nil)
        default:
            replyHandler(nil, "unknown op \(op)")
        }
    }
}

// MARK: end bridge

// MARK: begin print — take rendered HTML, give back a real print panel

// window.print() inside a WKWebView does nothing: WebKit exposes no public
// delegate for it on macOS. Printing therefore has to originate natively, which
// is the whole of the shell's job here — the range was already rendered to HTML
// by the web layer.
final class Printer: NSObject, WKNavigationDelegate {
    private var web: WKWebView?
    private var hostWindow: NSWindow?
    private var done: ((String?) -> Void)?
    private let baseURL: URL?
    init(baseURL: URL?) { self.baseURL = baseURL }

    func print(html: String, in window: NSWindow?, completion: @escaping (String?) -> Void) {
        done = completion
        let info = NSPrintInfo.shared
        info.topMargin = 54; info.bottomMargin = 54
        info.leftMargin = 54; info.rightMargin = 54
        info.isHorizontallyCentered = false; info.isVerticallyCentered = false

        // The print view needs its own copy of the asset handler, or the base URL
        // it is given resolves to nothing and the load never completes.
        let width = info.paperSize.width - info.leftMargin - info.rightMargin
        let w = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: 100),
                          configuration: makeAssetConfig())
        w.navigationDelegate = self
        web = w
        // An offscreen window: a WKWebView with no window does not lay out for
        // printing, and printOperation paginates garbage.
        let host = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: width, height: 900),
                            styleMask: [.borderless], backing: .buffered, defer: false)
        host.contentView?.addSubview(w)
        host.orderBack(nil)
        hostWindow = host
        w.loadHTMLString(html, baseURL: baseURL)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // The view must be as tall as its content before printing. Leave it at
        // its loading height and WebKit paginates that height instead of the
        // paper's — which silently yields thousands of pages.
        webView.evaluateJavaScript("document.body.scrollHeight") { h, err in
            let height = CGFloat((h as? NSNumber)?.doubleValue ?? 2000)
            Swift.print("PRINT content height \(height)pt, view width \(webView.frame.width)pt, js err \(String(describing: err))")
            webView.frame = NSRect(x: 0, y: 0, width: webView.frame.width, height: height)
            self.paginate(webView)
        }
    }

    private func paginate(_ webView: WKWebView) {
        if let alt = ProcessInfo.processInfo.environment["TEPHRA_PDF_ALT"] {
            webView.createPDF(configuration: WKPDFConfiguration()) { result in
                switch result {
                case .success(let data):
                    try? data.write(to: URL(fileURLWithPath: alt))
                    Swift.print("PRINT createPDF ok, \(data.count) bytes")
                case .failure(let e):
                    Swift.print("PRINT createPDF failed: \(e)")
                }
                self.runOperation(webView)
            }
            return
        }
        runOperation(webView)
    }

    private func runOperation(_ webView: WKWebView) {
        let info = NSPrintInfo.shared
        // Test-only branch: save straight to PDF so a script can verify the
        // whole path without a human dismissing the panel.
        if let pdf = ProcessInfo.processInfo.environment["TEPHRA_PDF"] {
            info.jobDisposition = .save
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL.rawValue] = URL(fileURLWithPath: pdf)
        }
        let op = webView.printOperation(with: info)
        op.showsPrintPanel = ProcessInfo.processInfo.environment["TEPHRA_PDF"] == nil
        op.showsProgressPanel = op.showsPrintPanel
        // printOperation hands back a print view with a zero frame. Left alone it
        // paginates nothing into hundreds of thousands of pages; it has to be told
        // the content size explicitly.
        op.view?.frame = webView.bounds
        Swift.print("PRINT paper \(info.paperSize), view \(op.view?.frame.size ?? .zero)")
        // op.run() on a WKWebView print operation paginates into hundreds of
        // thousands of pages. runModal against a real window does not — the
        // operation needs a window even when no panel is shown.
        if let window = NSApplication.shared.mainWindow ?? webView.window {
            op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
        } else {
            op.run()
        }
        done?(nil); done = nil; web = nil; hostWindow = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        FileHandle.standardOutput.write("PRINT failed: \(error.localizedDescription)\n".data(using: .utf8)!)
        done?(error.localizedDescription); done = nil; web = nil
    }
}

// MARK: end print

// MARK: begin paste — read the system pasteboard, write a file, return a link

// Reading NSPasteboard directly beats the web clipboard on two counts: no
// base64 round trip, and it sees what the source app actually offered —
// including a file promise from Finder rather than a re-encoded bitmap.
func pasteImageFromPasteboard() -> [String: Any]? {
    let pb = NSPasteboard.general

    var data: Data?
    var ext = "png"
    if let fileURL = (pb.readObjects(forClasses: [NSURL.self], options: nil) as? [URL])?.first,
       let t = UTType(filenameExtension: fileURL.pathExtension), t.conforms(to: .image) {
        data = try? Data(contentsOf: fileURL); ext = fileURL.pathExtension
    } else if let png = pb.data(forType: .png) {
        data = png
    } else if let tiff = pb.data(forType: .tiff) {
        data = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
    }
    guard let bytes = data else { return nil }

    try? FileManager.default.createDirectory(atPath: notesDir, withIntermediateDirectories: true)
    let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd-HHmmss"
    let name = "pasted-\(fmt.string(from: Date())).\(ext)"
    let dest = URL(fileURLWithPath: notesDir).appendingPathComponent(name)
    do { try bytes.write(to: dest) } catch { return nil }

    return ["path": dest.path, "bytes": bytes.count,
            "markdown": "![pasted image](\(dest.path))"]
}

// MARK: end paste

// MARK: begin infrastructure2 — wiring it together

setbuf(stdout, nil)          // so a driver script can read reports as they happen
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
installMenu()

let config = makeAssetConfig()
let bridge = Bridge()
config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "tephra")
config.userContentController.addUserScript(
    WKUserScript(source: BRIDGE_JS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
config.preferences.setValue(true, forKey: "developerExtrasEnabled")

// Test driver: select a range, print it, and read the pasteboard, then report.
final class SelfTest: NSObject, WKNavigationDelegate {
    func webView(_ web: WKWebView, didFinish nav: WKNavigation!) {
        if ProcessInfo.processInfo.environment["TEPHRA_ENGINE_TEST"] != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { engineTest.run(web) }
            return
        }
        guard ProcessInfo.processInfo.environment["TEPHRA_SELFTEST"] != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            web.evaluateJavaScript("window.spikeSelect(0, 1400)") { n, _ in
                print("SELFTEST selected \(n ?? "?") chars")
                // callAsyncJavaScript, not evaluateJavaScript: the bridge returns
                // promises, and evaluateJavaScript cannot marshal one.
                web.callAsyncJavaScript("return JSON.stringify(await window.spikePrint())",
                                        arguments: [:], in: nil, in: .page) { res in
                    print("SELFTEST print -> \(res)")
                    web.callAsyncJavaScript("return JSON.stringify(await window.spikePaste())",
                                            arguments: [:], in: nil, in: .page) { res2 in
                        print("SELFTEST paste -> \(res2)")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { NSApplication.shared.terminate(nil) }
                    }
                }
            }
        }
    }
}
let selfTest = SelfTest()

let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1400, height: 950),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
window.title = "Tephra — spike B (swift, \(mode))"
window.center()

let webView = WKWebView(frame: window.contentLayoutRect, configuration: config)
webView.autoresizingMask = [.width, .height]
webView.navigationDelegate = selfTest
window.contentView?.addSubview(webView)
bridge.window = window

let url = startURL(for: mode)
if mode == "file" {
    webView.loadFileURL(url, allowingReadAccessTo: URL(fileURLWithPath: publicDir))
} else {
    webView.load(URLRequest(url: url))
}

window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()

// MARK: end infrastructure2
