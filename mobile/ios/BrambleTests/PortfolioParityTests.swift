@testable import Bramble
import BrambleCore
import XCTest

/// The portfolio parity fixture (written by the extension's own TypeScript) asserted through the
/// generated Swift bindings, so a binding fault — a double, an optional or a u64 that does not
/// survive the FFI — shows up as a wrong price, total or row here, not only in the Rust suite.
final class PortfolioParityTests: XCTestCase {
    private func blocks() throws -> [String: Any] {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "portfolio-parity", withExtension: "jsonl")
        )
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
        case "eur":
            .eur

        case "gbp":
            .gbp

        default:
            .usd
        }
    }

    private func points(_ map: Any?) -> [PricePoint] {
        ((map as? [String: Double]) ?? [:]).map { PricePoint(address: $0.key, value: $0.value) }
    }

    private func network(_ record: [String: Any], _ key: String) throws -> NetworkId {
        let chain: String = try fixtureValue(record, key)
        return chain == "SN_MAIN" ? .mainnet : .sepolia
    }

    private func balance(_ row: [String: Any]) throws -> TokenBalance {
        let id: String = try fixtureValue(row, "id")
        let address: String = try fixtureValue(row, "address")
        let symbol: String = try fixtureValue(row, "symbol")
        let formatted: String = try fixtureValue(row, "formatted")
        return TokenBalance(
            token: TokenConfig(
                id: id,
                network: .mainnet,
                address: address,
                symbol: symbol,
                name: symbol,
                decimals: 18
            ),
            balance: "1",
            formatted: formatted
        )
    }

    private func activityEntry(_ row: [String: Any]) throws -> ActivityEntry {
        let kinds: [String: ActivityKind] = ["transfer": .transfer, "deploy": .deploy, "declare": .declare]
        let statuses: [String: TxStatus] = [
            "pending": .pending,
            "preconfirmed": .preconfirmed,
            "rejected": .rejected,
            "reverted": .reverted
        ]
        let accountId: String = try fixtureValue(row, "accountId")
        let hash: String = try fixtureValue(row, "hash")
        let kind: String = try fixtureValue(row, "kind")
        let status: String = try fixtureValue(row, "status")
        let submittedAt: Double = try fixtureValue(row, "submittedAt")
        let summary: String = try fixtureValue(row, "summary")
        return ActivityEntry(
            accountId: accountId,
            amount: row["amount"] as? String,
            counterparty: row["counterparty"] as? String,
            direction: (row["direction"] as? String).flatMap { ["in": .in, "out": .out][$0] },
            failureNotice: nil,
            finalizedOnL1: nil,
            hash: hash,
            kind: kinds[kind] ?? .invoke,
            network: .mainnet,
            notFoundCount: nil,
            status: statuses[status] ?? .accepted,
            submittedAt: UInt64(submittedAt),
            summary: summary,
            token: row["token"] as? String,
            tokenAddress: row["tokenAddress"] as? String
        )
    }

    private func tokenConfig(_ row: [String: Any]) throws -> TokenConfig {
        let id: String = try fixtureValue(row, "id")
        let network = try network(row, "networkId")
        let address: String = try fixtureValue(row, "address")
        let symbol: String = try fixtureValue(row, "symbol")
        let name: String = try fixtureValue(row, "name")
        let decimals: Int = try fixtureValue(row, "decimals")
        return TokenConfig(
            id: id,
            network: network,
            address: address,
            symbol: symbol,
            name: name,
            decimals: UInt8(decimals)
        )
    }

    func testFiatFormattingAndHeroThroughFfi() throws {
        let fiat = try XCTUnwrap(blocks()["fiat"] as? [String: Any])
        for sample in try XCTUnwrap(fiat["format"] as? [[String: Any]]) {
            let amount: Double = try fixtureValue(sample, "value")
            let code: String = try fixtureValue(sample, "currency")
            XCTAssertEqual(formatFiat(amount: amount, currency: currency(code)), sample["out"] as? String)
        }
        let defaults = TokenPreferences(persisted: nil)
        for sample in try XCTUnwrap(fiat["hero"] as? [[String: Any]]) {
            let rows: [[String: Any]] = try fixtureValue(sample, "balances")
            let balances = try rows.map(balance)
            let code: String = try fixtureValue(sample, "currency")
            let view = PriceView(
                currency: currency(code),
                prices: points(sample["prices"]),
                changes: points(sample["changes"]),
                asOfMs: nil,
                stale: false
            )
            let hero = portfolioHero(
                visible: defaults.homeRows(balances: balances).visible,
                prices: view,
                hasAccount: true
            )
            let out: [String: Any] = try fixtureValue(sample, "out")
            XCTAssertEqual(hero.totalText ?? "—", out["total"] as? String)
            XCTAssertEqual(hero.delta?.windowText, out["window"] as? String)
        }
    }

    private func outcome(for request: PriceRequest, answers: [String: Any]) throws -> PriceOutcome {
        guard let answer = answers[request.address] as? [String: Any] else {
            return PriceOutcome(address: request.address, outcome: .unanswered)
        }
        let status: Int = try fixtureValue(answer, "status")
        let body: String = try fixtureValue(answer, "body")
        return PriceOutcome(
            address: request.address,
            outcome: HttpOutcome(
                status: UInt16(status),
                retryAfter: nil,
                body: Data(body.utf8),
                timedOut: false
            )
        )
    }

    func testPriceTimelineThroughFfi() throws {
        let plans = try XCTUnwrap((blocks()["prices"] as? [String: Any])?["plans"] as? [String: Any])
        let steps = try XCTUnwrap(plans["backoff"] as? [[String: Any]])
        let book = PriceBook(persisted: nil)
        for step in steps {
            let addresses: [String] = try fixtureValue(step, "addresses")
            let now: Double = try fixtureValue(step, "now")
            let code: String = try fixtureValue(step, "currency")
            let cur = currency(code)
            let view: PriceView
            let plan = book.plan(
                network: .mainnet,
                addresses: addresses,
                currency: cur,
                nowMs: now,
                cachedOnly: step["cached"] as? Bool ?? false
            )
            switch plan {
            case let .serve(served):
                view = served

            case let .fetch(requests):
                let answers = step["answers"] as? [String: Any] ?? [:]
                let outcomes = try requests.map { request in try outcome(for: request, answers: answers) }
                view = book.apply(
                    network: .mainnet,
                    addresses: addresses,
                    currency: cur,
                    outcomes: outcomes,
                    attemptedAtMs: now
                )
            }
            let out: [String: Any] = try fixtureValue(step, "out")
            XCTAssertEqual(view.stale, out["stale"] as? Bool)
            XCTAssertEqual(view.asOfMs, out["asOf"] as? Double)
            let prices = Dictionary(uniqueKeysWithValues: view.prices.map { ($0.address, $0.value) })
            XCTAssertEqual(prices, out["prices"] as? [String: Double])
        }
    }

    func testActivityRowsThroughFfi() throws {
        let all = try blocks()
        let now = try XCTUnwrap(all["activityNow"] as? Double)
        let block = try XCTUnwrap((all["appearance"] as? [[String: Any]])?.first)
        let entryRows: [[String: Any]] = try fixtureValue(block, "entries")
        let entries = try entryRows.map(activityEntry)
        let tokenRows: [[String: Any]] = try fixtureValue(block, "tokens")
        let tokens = try tokenRows.map(tokenConfig)
        // Rows carry no fiat figure, so prices are not an input any more.
        let groups = activityGroups(entries: entries, tracked: tokens, nowMs: now)
        XCTAssertEqual(groups.map(\.heading), block["headings"] as? [String])
        let rows = groups.flatMap(\.rows)
        let html: [[String: Any]] = try fixtureValue(block, "rows")
        XCTAssertEqual(rows.count, html.count)
        for (row, expected) in zip(rows, html) {
            assertSummary(row, expected)
            assertExpansion(row, expected)
        }
    }

    /// The disclosure's summary as the extension renders it (`transactionRow`).
    private func assertSummary(_ row: ActivityRow, _ expected: [String: Any]) {
        XCTAssertEqual(row.heading, expected["title"] as? String)
        XCTAssertEqual(row.accessibilityLabel, expected["accessible"] as? String)
        XCTAssertEqual(row.glyphTitle, expected["glyphTitle"] as? String)
        XCTAssertEqual(row.hashLabel, expected["hash"] as? String)
        XCTAssertEqual(row.hashCopyLabel, expected["hashCopyLabel"] as? String)
        XCTAssertEqual(row.hash, expected["hashCopyValue"] as? String)
        XCTAssertEqual(row.explorerUrl, expected["href"] as? String)
        XCTAssertEqual(row.statusWord, expected["meta"] as? String)
        XCTAssertEqual(row.timing, expected["timing"] as? String)
        let avatar = expected["avatar"] as? [String: Any]
        XCTAssertEqual(row.avatar.logoAddress != nil, avatar?["logo"] as? Bool)
    }

    /// The disclosure's expansion: the counterparty or the detail, the submission time, the hint.
    private func assertExpansion(_ row: ActivityRow, _ expected: [String: Any]) {
        let counterparty = expected["counterparty"] as? [String: Any]
        XCTAssertEqual(row.counterparty == nil, counterparty == nil)
        XCTAssertEqual(row.counterparty?.role, counterparty?["role"] as? String)
        XCTAssertEqual(row.counterparty?.address, counterparty?["copyValue"] as? String)
        XCTAssertEqual(row.counterparty?.addressLabel, counterparty?["label"] as? String)
        XCTAssertEqual(row.counterparty?.copyLabel, counterparty?["copyLabel"] as? String)
        XCTAssertEqual(row.detail, expected["detail"] as? String)
        XCTAssertEqual(row.submitted, expected["submitted"] as? String)
        XCTAssertEqual(row.statusHint, expected["statusHint"] as? String)
    }

    func testLinksGlyphsAndSparklinesThroughFfi() throws {
        let all = try blocks()
        let status = try XCTUnwrap(all["status"] as? [String: Any])
        let explorer: [[String: Any]] = try fixtureValue(status, "explorer")
        for sample in explorer {
            let network = try network(sample, "networkId")
            let felt: String = try fixtureValue(sample, "felt")
            XCTAssertEqual(explorerTransactionUrl(network: network, hash: felt), sample["tx"] as? String)
            XCTAssertEqual(explorerAccountUrl(network: network, address: felt), sample["account"] as? String)
        }
        let sparklines: [[String: Any]] = try fixtureValue(status, "sparklines")
        for sample in sparklines {
            let raw: [Any] = try fixtureValue(sample, "points")
            let values = raw.map { ($0 as? Double) ?? .nan }
            XCTAssertEqual(tokenSparkline(values: values)?.path ?? "", sample["path"] as? String)
        }
        let glyphs = try XCTUnwrap((all["tokens"] as? [String: Any])?["glyphs"] as? [[String: Any]])
        for sample in glyphs {
            let address: String = try fixtureValue(sample, "address")
            let symbol: String = try fixtureValue(sample, "symbol")
            let glyph = tokenGlyph(address: address, symbol: symbol)
            let out: [String: Any] = try fixtureValue(sample, "out")
            XCTAssertEqual(glyph.logoAddress != nil, out["logo"] as? Bool)
        }
    }
}
