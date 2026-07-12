import Foundation
import JavaScriptCore

enum MarkdownRenderError: Error, CustomStringConvertible {
    case rendererUnavailable(String)
    case renderFailed(String)

    var description: String {
        switch self {
        case .rendererUnavailable(let detail): return "markdown renderer unavailable: \(detail)"
        case .renderFailed(let detail): return "markdown render failed: \(detail)"
        }
    }
}

/// Renders markdown to a self-contained HTML document using the bundled
/// `marked` library evaluated in JavaScriptCore. Stateless; each call builds
/// a fresh JSContext so a poisoned context can't leak across previews.
struct MarkdownRenderer {
    /// Documents larger than this are truncated before rendering so a huge
    /// file cannot stall the Quick Look service.
    static let maxInputBytes = 2 * 1024 * 1024

    let markedSource: String
    let stylesheet: String

    init(resourceBundle: Bundle) throws {
        guard let markedURL = resourceBundle.url(forResource: "marked", withExtension: "js"),
              let cssURL = resourceBundle.url(forResource: "preview", withExtension: "css")
        else {
            throw MarkdownRenderError.rendererUnavailable("marked.js or preview.css missing from bundle")
        }
        self.markedSource = try String(contentsOf: markedURL, encoding: .utf8)
        self.stylesheet = try String(contentsOf: cssURL, encoding: .utf8)
    }

    init(markedSource: String, stylesheet: String) {
        self.markedSource = markedSource
        self.stylesheet = stylesheet
    }

    func renderDocument(markdown: String, title: String) throws -> String {
        let (prepared, truncated) = Self.prepare(markdown)
        let body = try renderBody(markdown: prepared)
        let notice = truncated
            ? "<p class=\"truncation-notice\">Preview truncated — open in Writer to read the full document.</p>"
            : ""
        return """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <title>\(Self.escapeHTML(title))</title>
        <style>\(stylesheet)</style>
        </head>
        <body><article class="markdown-body">\(body)\(notice)</article></body>
        </html>
        """
    }

    func renderBody(markdown: String) throws -> String {
        guard let context = JSContext() else {
            throw MarkdownRenderError.rendererUnavailable("JSContext creation failed")
        }
        var jsException: String?
        context.exceptionHandler = { _, exception in
            jsException = exception?.toString() ?? "unknown JS exception"
        }
        context.evaluateScript(markedSource)
        if let exception = jsException {
            throw MarkdownRenderError.rendererUnavailable(exception)
        }
        guard let marked = context.globalObject.objectForKeyedSubscript("marked"),
              !marked.isUndefined,
              let parse = marked.objectForKeyedSubscript("parse"),
              !parse.isUndefined
        else {
            throw MarkdownRenderError.rendererUnavailable("marked.parse not found after evaluating library")
        }
        let options: [String: Any] = ["gfm": true, "breaks": false, "async": false]
        guard let result = parse.call(withArguments: [markdown, options]), jsException == nil,
              result.isString, let html = result.toString()
        else {
            throw MarkdownRenderError.renderFailed(jsException ?? "marked.parse returned a non-string")
        }
        return html
    }

    /// Strips YAML frontmatter and enforces the input size cap.
    static func prepare(_ markdown: String) -> (markdown: String, truncated: Bool) {
        var text = stripFrontmatter(markdown)
        var truncated = false
        if text.utf8.count > maxInputBytes {
            var bytes = Array(text.utf8.prefix(maxInputBytes))
            // Trim a trailing partial UTF-8 scalar so decoding stays lossless:
            // drop continuation bytes, then the dangling lead byte if any.
            while let last = bytes.last, last & 0b1100_0000 == 0b1000_0000 {
                bytes.removeLast()
            }
            if let last = bytes.last, last & 0b1100_0000 == 0b1100_0000 {
                bytes.removeLast()
            }
            text = String(decoding: bytes, as: UTF8.self)
            truncated = true
        }
        return (text, truncated)
    }

    static func stripFrontmatter(_ markdown: String) -> String {
        guard markdown.hasPrefix("---\n") || markdown.hasPrefix("---\r\n") else { return markdown }
        let afterOpen = markdown.index(markdown.startIndex, offsetBy: markdown.hasPrefix("---\r\n") ? 5 : 4)
        let rest = markdown[afterOpen...]
        for close in ["\n---\n", "\n---\r\n", "\r\n---\r\n", "\r\n---\n"] {
            if let range = rest.range(of: close) {
                return String(rest[range.upperBound...])
            }
        }
        // Frontmatter that ends the file ("\n---" with no trailing newline).
        for close in ["\n---", "\r\n---"] {
            if rest.hasSuffix(close) {
                return ""
            }
        }
        return markdown
    }

    static func escapeHTML(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}
