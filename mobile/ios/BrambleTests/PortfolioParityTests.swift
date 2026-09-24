import BrambleCore
import XCTest

/// The portfolio parity fixture (written by the extension's own TypeScript) asserted through the
/// generated Swift bindings, so a binding fault — a double, an optional or a u64 that does not
/// survive the FFI — shows up as a wrong price, total or row here, not only in the Rust suite.
final class PortfolioParityTests: XCTestCase {
    private func blocks() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "portfolio-parity", withExtension: "jsonl"))
        let text = try String(contentsOf: url, encoding: .utf8)
        var blocks: [String: Any] = [:]
        for line in text.split(separator: "\n") {
            let record = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
            blocks[try XCTUnwrap(record["block"] as? String)] = record["value"]
        }
        return blocks
    }

    private func currency(_ code: String) -> DisplayCurrency {
        switch code {
        case "eur": .eur
        case "gbp": .gbp
        default: .usd
        }
    }

    private func points(_ map: Any?) -> [PricePoint] {
        ((map as? [String: Double]) ?? [:]).map { PricePoint(address: $0.key, value: $0.value) }
    }

    func testFiatFormattingAndHeroThroughFfi() throws {
        let fiat = try XCTUnwrap(blocks()["fiat"] as? [String: Any])
        for c in try XCTUnwrap(fiat["format"] as? [[String: Any]]) {
            XCTAssertEqual(formatFiat(amount: c["value"] as! Double, currency: currency(c["currency"] as! String)), c["out"] as? String)
        }
        let defaults = TokenPreferences(persisted: nil)
        for c in try XCTUnwrap(fiat["hero"] as? [[String: Any]]) {
            let balances = (c["balances"] as! [[String: Any]]).map { b in
                TokenBalance(token: TokenConfig(id: b["id"] as! String, network: .mainnet, address: b["address"] as! String,
                                                symbol: b["symbol"] as! String, name: b["symbol"] as! String, decimals: 18),
                             balance: "1", formatted: b["formatted"] as! String)
            }
            let view = PriceView(currency: currency(c["currency"] as! String), prices: points(c["prices"]), changes: points(c["changes"]), asOfMs: nil, stale: false)
            let hero = portfolioHero(visible: defaults.homeRows(balances: balances).visible, prices: view, hasAccount: true)
            let out = c["out"] as! [String: Any]
            XCTAssertEqual(hero.totalText ?? "—", out["total"] as? String)
            XCTAssertEqual(hero.delta?.windowText, out["window"] as? String)
        }
    }

    func testPriceTimelineThroughFfi() throws {
        let plans = try XCTUnwrap((blocks()["prices"] as? [String: Any])?["plans"] as? [String: Any])
        let steps = try XCTUnwrap(plans["backoff"] as? [[String: Any]])
        let book = PriceBook(persisted: nil)
        for step in steps {
            let addresses = step["addresses"] as! [String]
            let now = step["now"] as! Double
            let cur = currency(step["currency"] as! String)
            let view: PriceView
            switch book.plan(network: .mainnet, addresses: addresses, currency: cur, nowMs: now, cachedOnly: step["cached"] as? Bool ?? false) {
            case let .serve(served):
                view = served
            case let .fetch(requests):
                let answers = step["answers"] as? [String: Any] ?? [:]
                let outcomes = requests.map { request -> PriceOutcome in
                    guard let answer = answers[request.address] as? [String: Any] else {
                        return PriceOutcome(address: request.address, outcome: .unanswered)
                    }
                    return PriceOutcome(address: request.address, outcome: HttpOutcome(
                        status: UInt16(answer["status"] as! Int), retryAfter: nil,
                        body: Data((answer["body"] as! String).utf8), timedOut: false))
                }
                view = book.apply(network: .mainnet, addresses: addresses, currency: cur, outcomes: outcomes, attemptedAtMs: now)
            }
            let out = step["out"] as! [String: Any]
            XCTAssertEqual(view.stale, out["stale"] as? Bool)
            XCTAssertEqual(view.asOfMs, out["asOf"] as? Double)
            XCTAssertEqual(Dictionary(uniqueKeysWithValues: view.prices.map { ($0.address, $0.value) }), out["prices"] as? [String: Double])
        }
    }

    func testActivityRowsThroughFfi() throws {
        let all = try blocks()
        let now = try XCTUnwrap(all["activityNow"] as? Double)
        let block = try XCTUnwrap((all["appearance"] as? [[String: Any]])?.first)
        let entries = (block["entries"] as! [[String: Any]]).map { e in
            ActivityEntry(accountId: e["accountId"] as! String, amount: e["amount"] as? String, counterparty: e["counterparty"] as? String,
                          failureNotice: nil, finalizedOnL1: nil, hash: e["hash"] as! String,
                          kind: ["transfer": .transfer, "deploy": .deploy, "declare": .declare][e["kind"] as! String] ?? .invoke,
                          network: .mainnet, notFoundCount: nil,
                          status: ["pending": .pending, "preconfirmed": .preconfirmed, "rejected": .rejected, "reverted": .reverted][e["status"] as! String] ?? .accepted,
                          submittedAt: UInt64(e["submittedAt"] as! Double), summary: e["summary"] as! String, token: e["token"] as? String)
        }
        let tokens = (block["tokens"] as! [[String: Any]]).map { t in
            TokenConfig(id: t["id"] as! String, network: t["networkId"] as! String == "SN_MAIN" ? .mainnet : .sepolia,
                        address: t["address"] as! String, symbol: t["symbol"] as! String, name: t["name"] as! String, decimals: UInt8(t["decimals"] as! Int))
        }
        let view = PriceView(currency: .usd, prices: points(block["prices"]), changes: [], asOfMs: nil, stale: false)
        let groups = activityGroups(entries: entries, tracked: tokens, prices: view, nowMs: now)
        XCTAssertEqual(groups.map(\.heading), block["headings"] as? [String])
        let rows = groups.flatMap(\.rows)
        let html = block["rows"] as! [[String: Any]]
        XCTAssertEqual(rows.count, html.count)
        for (row, expected) in zip(rows, html) {
            XCTAssertEqual(row.accessibilityLabel, expected["accessible"] as? String)
            XCTAssertEqual(row.explorerUrl, expected["href"] as? String)
            XCTAssertEqual(row.fiatText ?? "—", expected["fiat"] as? String)
            XCTAssertEqual(row.timing, expected["timing"] as? String)
        }
    }

    func testLinksGlyphsAndSparklinesThroughFfi() throws {
        let all = try blocks()
        let status = try XCTUnwrap(all["status"] as? [String: Any])
        for c in status["explorer"] as! [[String: Any]] {
            let network: NetworkId = c["networkId"] as! String == "SN_MAIN" ? .mainnet : .sepolia
            XCTAssertEqual(explorerTransactionUrl(network: network, hash: c["felt"] as! String), c["tx"] as? String)
            XCTAssertEqual(explorerAccountUrl(network: network, address: c["felt"] as! String), c["account"] as? String)
        }
        for c in status["sparklines"] as! [[String: Any]] {
            let values = (c["points"] as! [Any]).map { ($0 as? Double) ?? .nan }
            XCTAssertEqual(tokenSparkline(values: values)?.path ?? "", c["path"] as? String)
        }
        let glyphs = try XCTUnwrap((all["tokens"] as? [String: Any])?["glyphs"] as? [[String: Any]])
        for c in glyphs {
            let glyph = tokenGlyph(address: c["address"] as! String, symbol: c["symbol"] as! String)
            let out = c["out"] as! [String: Any]
            XCTAssertEqual(glyph.logoAddress != nil, out["logo"] as? Bool)
        }
    }
}
