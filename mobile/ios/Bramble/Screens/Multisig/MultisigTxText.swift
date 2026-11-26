import BrambleCore

/// The extension's words for multisig transactions (`i18n/messages/multisig*.ts`,
/// `review-steps-multisig.ts`), byte for byte. Summaries and refusals are never here: a summary is
/// the core's review of the calls (`MultisigIntent.summary`), shown as it comes, and a refusal is
/// the core's reason through the extension's friendly copy (`describeRefusal`).
enum MultisigTxText {
    static let transactions = "Transactions"
    static let send = "Send"
    static let signers = "Signers"
    static let newTransaction = "New transaction"
    static let reviewTransaction = "Review transaction"
    static let amountToSend = "Amount to send"
    static let recipient = "To"
    static let token = "Token"
    static let noTokens = "No tracked tokens are available for this multisig."
    static let ready = "Transaction ready for multisig review"
    static let sendAnyway = "Send anyway"
    static let importTransaction = "Import transaction"
    static let intentPackage = "Intent package"
    static let importNote = "Import only the full immutable package. The wallet re-hashes every signed field "
        + "and requires this exact account, chain, nonce, class and current signer authority."
    static let verifyImport = "Verify and import"
    static let verified = "Intent verified and ready to review"
    static let nothingImport = "Nothing to sign. Import a transaction to review it here."
    static let waiting = "Waiting for a signature"
    static let attention = "Needs attention"
    static let needingYou = "Transactions needing you"
    static let gone = "This transaction is no longer available."
    static let sign = "Sign reviewed transaction"
    static let submit = "Submit transaction"
    static let tryUnchangedFee = "Try unchanged fee again"
    static let copyPackage = "Copy transaction package"
    static let signerSelect = "Signer in this wallet"
    static let signatures = "Signatures"
    static let maxFee = "Maximum network fee"
    static let technical = "Technical details"
    static let hash = "Transaction hash"
    static let nonce = "Nonce"
    static let copyHash = "Copy transaction hash"
    static let submittedKicker = "Submitted to Starknet"
    static let current = "Current signers"
    static let addParticipant = "Add participant"
    static let enterKey = "Enter a public key"
    static let newThreshold = "New approval threshold"
    static let approvalsAfterAdding = "Approvals after adding"
    static let approvalsAfterRemoval = "Approvals after removal"
    static let reviewAddition = "Review signer addition"
    static let reviewRemoval = "Review removal"
    static let reviewThreshold = "Review threshold change"
    static let changeReady = "Signer change ready for multisig review"

    static func signatureCount(_ intent: MultisigIntent) -> String {
        "\(intent.signedPublicKeys.count) of \(intent.threshold)"
    }

    static func signed(_ intent: MultisigIntent) -> String {
        "Exact transaction signed (\(intent.signedPublicKeys.count)/\(intent.threshold))"
    }

    static func submitted(_ hash: String) -> String { "Transaction submitted to Starknet: \(hash)" }

    /// A list row's supporting text (`compactIntentList`): its state, then its signatures.
    static func status(_ intent: MultisigIntent) -> String {
        let state: String
        switch intent.state {
        case .ready:
            state = "Ready to submit"

        case .stale:
            let full = intent.signedPublicKeys.count == Int(intent.threshold)
            state = "Out of date · " + (full ? "ready to retry" : "needs review")

        case .collecting:
            state = "Awaiting signatures"

        case .submitted, .accepted, .rejected:
            state = submittedKicker
        }
        return "\(state) · \(signatureCount(intent))"
    }

    /// `intentAction`: what the intent card offers and the note beside it. Mobile proposes a fresh
    /// transaction from the composer rather than re-pricing a stale one, so a stale card says it is
    /// out of date and, when fully signed, offers the unchanged-fee retry only. `signers` is the
    /// card's review (`MultisigIntentReview.hasFreshAuthority`): `.changed`, which a review that
    /// could not be read also is, offers nothing to sign or submit, as the extension's card;
    /// `.reading` offers nothing yet.
    static func action(
        _ intent: MultisigIntent,
        canSign: Bool,
        holdsSigner: Bool,
        signers: SignerCheck = .match
    ) -> (IntentAction, String?) {
        if isOpen(intent), signers != .match {
            return (.nothing, signers == .changed ? MultisigCopy.noteSignersChanged : nil)
        }
        switch intent.state {
        case .ready:
            return (.submit, nil)

        case .stale:
            // Only a fee refusal at an unmoved nonce reads as refused; anything else may have
            // been sent by a co-signer (audit M3). Neither sentence says nothing was sent.
            let lead = intent.staleReason == .fee
                ? "The network refused this version: the fee rose above what was signed."
                : "This may already have been sent by another signer."
            let note = "\(lead) This version is out of date — create a new transaction to continue."
            let full = intent.signedPublicKeys.count == Int(intent.threshold)
            return (full ? .retryUnchangedFee : .nothing, note)

        case .collecting where canSign:
            return (.sign, nil)

        case .collecting:
            let note = holdsSigner
                ? "This wallet has already signed. Share the package to collect the remaining signature."
                : "No eligible signer is available in this wallet. Share the package with a signer."
            return (.copyPackage, note)

        case .submitted, .accepted, .rejected:
            return (.nothing, "Nothing left to do here.")
        }
    }

    /// The card's risk panel (`reviewPanel`): the core's flags, then, unless the chain's signers
    /// still match the intent, the extension's signers-changed sentence. A review that could not be
    /// read says the same, since nothing proves the signers still match.
    static func risks(_ review: MultisigIntentReview?) -> [String] {
        (review?.riskFlags.map(\.message) ?? [])
            + (review?.hasFreshAuthority == true ? [] : [MultisigCopy.cardSignersChanged])
    }

    /// How a plan ended, in the extension's words. Send's generated copy where the failure is the
    /// same; the multisig table (`friendly-error-copy-multisig.ts`) where it is the multisig's own.
    static func failure(_ failure: MultisigTxFailure) -> String {
        switch failure {
        case .wrongChain:
            SendCopy.failureWrongChain

        case .preparationUnavailable:
            SendCopy.failurePreparationUnavailable

        case .hashMismatch:
            SendCopy.failureHashMismatch

        case .submissionIndeterminate:
            SendCopy.failureIndeterminate

        case .feeExpired:
            "The network refused this version: the fee rose above what was signed."

        case .alreadySent:
            "This transaction was already sent."

        case .resendUnconfirmed:
            "This may already have been sent by another signer. Press again to send it anyway."

        case .notStored:
            "This transaction could not be saved for the signers."

        case .locked:
            "The wallet is locked"

        case .nodeError, .boundsOutOfRange:
            SendCopy.failureDefault
        }
    }
}

/// Whether the chain's signers still match an intent, as the card's review last said.
enum SignerCheck: Equatable {
    case reading, match, changed

    init(_ review: MultisigIntentReview?) { self = review?.hasFreshAuthority == true ? .match : .changed }
}

/// The one action an intent card offers.
enum IntentAction: Equatable { case sign, submit, retryUnchangedFee, copyPackage, nothing }
