package org.bramble.wallet.send

import org.bramble.wallet.send.SendFlowModel.Stage

// Moving between the stages of [SendFlowModel] without running the plan, split from
// SendFlowModel.kt by behaviour. Main-thread only, like the model.

/** Drops the plan and returns to the amount. */
fun SendFlowModel.edit() {
    dropPlan()
    stage = Stage.DETAILS
}

/** Back from a stage: recipient ← details ← review/failure. */
fun SendFlowModel.back() {
    when (stage) {
        Stage.REVIEW, Stage.FAILED -> {
            dropPlan()
            stage =
                if (recipient == null) Stage.RECIPIENT else Stage.DETAILS
        }

        Stage.ASSET -> {
            stage = if (recipient == null) Stage.RECIPIENT else Stage.DETAILS
        }

        Stage.DETAILS -> {
            dropPlan()
            stage = Stage.RECIPIENT
        }

        else -> {
            // No step back inside the flow from here; the screen decides whether to leave.
        }
    }
}

/** Lock, backgrounding, dismissal. The core keeps the pending record of any sent write. */
fun SendFlowModel.close() = dropPlan()
