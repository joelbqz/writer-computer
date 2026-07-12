import Foundation
import QuickLookUI

/// Data-based Quick Look preview (macOS 12+): returns rendered HTML that the
/// Quick Look service displays in its own sandboxed, script-disabled web view.
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    func providePreview(
        for request: QLFilePreviewRequest,
        completionHandler handler: @escaping (QLPreviewReply?, Error?) -> Void
    ) {
        do {
            let markdown = try Self.readText(at: request.fileURL)
            let renderer = try MarkdownRenderer(resourceBundle: Bundle(for: PreviewProvider.self))
            let html = try renderer.renderDocument(
                markdown: markdown,
                title: request.fileURL.lastPathComponent
            )
            let reply = QLPreviewReply(
                dataOfContentType: .html,
                contentSize: CGSize(width: 800, height: 1000)
            ) { reply in
                reply.stringEncoding = .utf8
                reply.title = request.fileURL.lastPathComponent
                return Data(html.utf8)
            }
            handler(reply, nil)
        } catch {
            handler(nil, error)
        }
    }

    static func readText(at url: URL) throws -> String {
        let data = try Data(contentsOf: url)
        if let utf8 = String(data: data, encoding: .utf8) {
            return utf8
        }
        // Non-UTF-8 markdown is rare; decode lossily rather than failing the
        // preview outright.
        return String(decoding: data, as: UTF8.self)
    }
}
