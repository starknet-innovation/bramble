import Foundation

/// The in-app browser's admission rules (P16, `docs/portfolio-activity.md` T5). A dapp request is
/// attributed only to the main frame's committed `https` origin, as WebKit reports it; anything
/// else is refused, never answered. Pure, so the rules are tested without a web view.
enum DappOrigin {
    private static let https = "https"
    private static let defaultPort = 443

    /// The address bar's text as the `https` URL to open, or nil. A bare host gets `https://`;
    /// any other scheme, a missing host, or credentials in the URL are refused.
    static func address(_ input: String) -> URL? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !text.contains(where: \.isWhitespace) else { return nil }
        let candidate = text.contains("://") ? text : "\(https)://\(text)"
        guard let url = URL(string: candidate), origin(of: url) != nil,
              url.user == nil, url.password == nil else { return nil }
        return url
    }

    /// The serialized origin (`https://host[:port]`) of an `https` URL, else nil.
    static func origin(of url: URL?) -> String? {
        guard let url, let scheme = url.scheme else { return nil }
        return origin(scheme: scheme, host: url.host ?? "", port: url.port ?? 0)
    }

    /// The serialized origin of a scheme, host and port as WebKit's `WKSecurityOrigin` gives them
    /// (port 0 for the default), or nil unless it is `https` with a host.
    static func origin(scheme: String, host: String, port: Int) -> String? {
        guard scheme.lowercased() == https, !host.isEmpty else { return nil }
        let explicitPort = port == 0 || port == defaultPort ? "" : ":\(port)"
        return "\(https)://\(host.lowercased())\(explicitPort)"
    }

    /// The origin a request is bound to, or nil to refuse it: it must come from the main frame,
    /// whose `https` origin equals the committed page's.
    static func admit(isMainFrame: Bool, frameOrigin: String?, committed: URL?) -> String? {
        guard isMainFrame, let frameOrigin, let page = origin(of: committed), frameOrigin == page else { return nil }
        return page
    }
}

/// A provider request read from the page's untrusted message body, bound to the origin the host
/// admitted. The body is a JSON object with a UUID `id` and a string `method`; anything else is
/// dropped, since without an id there is nothing to answer.
struct DappRequest: Equatable {
    /// The hostile-JSON budget the extension's provider bridge applies (1 MiB).
    static let maxBodyBytes = 1_048_576
    private static let maxMethodLength = 64

    let origin: String
    let id: String
    let method: String

    /// Reads `body` for `origin`, or nil when it is not a request the page's provider would send.
    static func read(origin: String, body: String) -> Self? {
        let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        guard body.utf8.count <= maxBodyBytes,
              let object = try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any],
              let requestId = object["id"] as? String, requestId.wholeMatch(of: uuid) != nil,
              let name = object["method"] as? String, !name.isEmpty, name.count <= maxMethodLength
        else { return nil }
        return Self(origin: origin, id: requestId, method: name)
    }
}

/// Where every admitted dapp request lands. Today it refuses each one, connect included, with the
/// wallet API's user-refused error (113), as the extension answers a request the person declined.
/// wallet-core's `DappSession` replaces `answer` once mobile pins a core that exports it.
final class DappRequestSink {
    private static let userRefused = 113
    private static let userRefusedMessage = "The user refused the operation"

    /// The JSON reply for `request`: `{ id, error }`, which the page's bridge hands to the provider.
    func answer(_ request: DappRequest) -> String {
        let reply: [String: Any] = [
            "id": request.id,
            "error": ["code": Self.userRefused, "message": Self.userRefusedMessage]
        ]
        let data = (try? JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}
