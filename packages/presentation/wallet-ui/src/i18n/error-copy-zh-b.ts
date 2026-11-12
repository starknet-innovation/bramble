/**
 * Simplified Chinese for the reviewed error copy, keyed by the exact English
 * the copy tables hold (second half; see ./error-copy.ts). Text only.
 */
export const ERROR_COPY_ZH_B: Readonly<Record<string, string>> = {
  "Only Starknet signers can be managed on this multisig.":
    "此多签账户上只能管理 Starknet 签名者。",
  "Paying the network fee in another token is unavailable.": "无法用其他代币支付网络费。",
  "Pick two different tokens.": "选择两个不同的代币。",
  "Press again to delete this multisig's history.": "再按一次以删除此多签账户的历史记录。",
  "Private balances are already active.": "隐私余额已启用。",
  "Private balances are unavailable right now. Try again shortly.":
    "隐私余额暂时不可用。稍后重试。",
  "Private balances aren't available for Ledger accounts.": "Ledger 账户不支持隐私余额。",
  "Private balances aren't set up on this network.": "此网络上尚未设置隐私余额。",
  "Private balances changed. Review the shield again.": "隐私余额已变化。重新检查转入隐私余额。",
  "Private services aren't set up for this network.": "此网络尚未设置隐私服务。",
  "Removing 2FA or a guardian isn't available for Ledger accounts.":
    "Ledger 账户无法移除双重验证或守护者。",
  "Review this staking action again.": "重新检查此质押操作。",
  "Save a co-signer's wallet card before sharing securely.":
    "安全分享前，先保存共同签名者的钱包名片。",
  "Secure co-signer sharing isn't set up for this wallet.":
    "此钱包尚未设置与共同签名者的安全分享。",
  "Secure sharing is unavailable. Try again shortly.": "安全分享暂时不可用。稍后重试。",
  "Select an account first.": "先选择一个账户。",
  "Send STRK to the predicted address before deploying.": "部署前先向预测地址发送 STRK。",
  "Share the key with a co-owner first.": "先与共同所有者分享密钥。",
  "Signer keys can't be checked until the multisig is deployed.":
    "多签账户部署后才能检查签名者密钥。",
  "Signing on your Ledger didn't finish. Check Activity before trying again.":
    "Ledger 上的签名没有完成。重试前先查看活动。",
  "Something about that request wasn't right. Check the details and try again.":
    "该请求有些地方不对。检查详情后重试。",
  "Something went wrong. Please try again.": "出了点问题。重试。",
  "Staking isn't available on this network.": "此网络不支持质押。",
  "Staking option unavailable.": "质押选项不可用。",
  "Starknet names are not available on this network.": "此网络不支持 Starknet 名称。",
  "Swaps aren't available on this network.": "此网络不支持兑换。",
  "Switch to that account's network to deploy it.": "切换到该账户所在的网络以部署它。",
  "Switch to that participant's network first.": "先切换到该参与者所在的网络。",
  "Switch to the account that granted this allowance.": "切换到授予此授权额度的账户。",
  "Switch to this multisig's network first.": "先切换到此多签账户所在的网络。",
  "That Ledger account number isn't supported.": "不支持该 Ledger 账户编号。",
  "That account isn't a signer on this multisig.": "该账户不是此多签账户的签名者。",
  "That allowance is no longer on-chain. Refresh the list.": "该授权额度已不在链上。刷新列表。",
  "That amount is too large.": "该金额过大。",
  "That deployment request couldn't be verified.": "无法验证该部署请求。",
  "That didn't complete. If it was a transaction, check Activity before trying again.":
    "操作未完成。如果是交易，重试前先查看活动。",
  "That doesn't look like a Starknet address.": "这看起来不像 Starknet 地址。",
  "That endpoint reports a different Starknet chain, so nothing was submitted. Check the endpoint under Network → Advanced.":
    "该端点报告的是另一条 Starknet 链，因此没有提交任何内容。在 网络 → 高级 中检查端点。",
  "That endpoint speaks an API version this wallet can't use.":
    "该端点使用的 API 版本此钱包无法使用。",
  "That isn't a valid signature. Ask for a fresh copy.": "这不是有效的签名。索取一份新的。",
  "That multisig isn't on this network.": "该多签账户不在此网络上。",
  "That multisig isn't saved in this wallet.": "此钱包中没有保存该多签账户。",
  "That package isn't a valid transaction. Ask for a fresh copy.":
    "该数据包不是有效的交易。索取一份新的。",
  "That passphrase is wrong.": "密码错误。",
  "That prepared transaction isn't valid. Create it again.": "该准备好的交易无效。重新创建。",
  "That public key isn't a current signer on this multisig.": "该公钥不是此多签账户的当前签名者。",
  "That public key isn't valid, so the account wasn't added.": "该公钥无效，因此没有添加账户。",
  "That quote is out of date. Get a fresh price.": "该报价已过期。获取新的价格。",
  "That recipient hasn't activated private balances.": "该收款方尚未启用隐私余额。",
  "That request didn't go through. Try again.": "该请求没有成功。重试。",
  "That request has expired. Ask the site to send it again.": "该请求已过期。让网站重新发送。",
  "That request was already answered or has expired.": "该请求已被处理或已过期。",
  "That request was rejected.": "该请求已被拒绝。",
  "That review expired. Start again.": "该检查已过期。重新开始。",
  "That signature doesn't match this transaction.": "该签名与此交易不匹配。",
  "That signer account isn't available on this network.": "该签名者账户在此网络上不可用。",
  "That signer is already on this multisig.": "该签名者已在此多签账户中。",
  "That signer isn't in the reviewed signer set.": "该签名者不在已检查的签名者集合中。",
  "That signer isn't on this multisig.": "该签名者不在此多签账户中。",
  "That signing request couldn't be verified.": "无法验证该签名请求。",
  "That signing request is no longer pending. Check Activity before starting again.":
    "该签名请求已不再待处理。重新开始前先查看活动。",
  "That site is blocked.": "该网站已被阻止。",
  "That site isn't connected to this wallet.": "该网站未连接到此钱包。",
  "That site sent data this wallet can't read.": "该网站发送了此钱包无法读取的数据。",
  "That site sent token details this wallet can't read.": "该网站发送了此钱包无法读取的代币信息。",
  "That submission couldn't be verified.": "无法验证该提交。",
  "That swap review expired. Get a fresh quote.": "该兑换检查已过期。获取新的报价。",
  "That token isn't available on this network.": "该代币在此网络上不可用。",
  "That token isn't tracked on this network.": "此网络上没有跟踪该代币。",
  "That token symbol isn't supported.": "不支持该代币符号。",
  "That transaction id is already in use.": "该交易 ID 已被使用。",
  "That transaction is no longer saved.": "该交易已不再保存。",
  "That's an NFT contract, not a token. Revoke it from the site that asked.":
    "这是 NFT 合约，不是代币。在发起请求的网站上撤销。",
  "That's too long for a QR code.": "内容太长，无法生成二维码。",
  "The RPC endpoint refused this request (rate limit or gateway). Nothing was submitted. Wait a moment and try again.":
    "RPC 端点拒绝了此请求（限流或网关）。没有提交任何内容。稍等片刻后重试。",
  "The RPC rejected this request. Copy the error details for the full response.":
    "RPC 拒绝了此请求。复制错误详情以查看完整响应。",
  "The approval may not have gone through. Check Activity before trying again.":
    "批准可能没有成功。重试前先查看活动。",
  "The deployment didn't reach the network. Try again.": "部署没有到达网络。重试。",
  "The deployment may not have gone through. Check Activity before trying again.":
    "部署可能没有成功。重试前先查看活动。",
  "The fee changed while you were reviewing. Check it and submit again.":
    "你检查时费用发生了变化。核对后重新提交。",
  "The fee review is out of date. Check the fee again before deploying.":
    "费用检查已过期。部署前重新核对费用。",
  "The last submission didn't reach Starknet. Try again.": "上一次提交没有到达 Starknet。重试。",
  "The network changed. Try again.": "网络已更改。重试。",
  "The network fee was not reviewed. Nothing was submitted — review the transaction again.":
    "网络费未经检查。没有提交任何内容——重新检查交易。",
  "The operation would leak private information": "此操作会泄露隐私信息",
  "The pinned Ready Multisig 0.2 class isn't declared on this network.":
    "固定的 Ready Multisig 0.2 合约类尚未在此网络上声明。",
  "The private transaction may not have gone through. Check Activity before trying again.":
    "隐私交易可能没有成功。重试前先查看活动。",
  "The result is unknown. Check Activity before trying again.": "结果未知。重试前先查看活动。",
  "The reviewed address no longer matches. Check the fee and address again.":
    "已检查的地址不再匹配。重新核对费用和地址。",
  "The revoke may not have gone through. Check Activity before trying again.":
    "撤销可能没有成功。重试前先查看活动。",
  "The signature doesn't match this account's key, so nothing was submitted.":
    "签名与此账户的密钥不匹配，因此没有提交任何内容。",
  "The signers changed since this transaction was created. Create a new one.":
    "自创建此交易以来签名者已发生变化。创建一笔新的。",
  "The staking transaction may not have gone through. Check Activity before trying again.":
    "质押交易可能没有成功。重试前先查看活动。",
  "The swap may not have gone through. Check Activity before trying again.":
    "兑换可能没有成功。重试前先查看活动。",
  "The threshold is already set to that.": "阈值已经是该值。",
  "The transfer may not have gone through. Check Activity before trying again.":
    "转账可能没有成功。重试前先查看活动。",
  "The wallet is locked or unavailable. Unlock it and try again.":
    "钱包已锁定或不可用。解锁后重试。",
  "The wallet refused that request.": "钱包拒绝了该请求。",
  "These deployment details don't match this account's address. Nothing was submitted.":
    "这些部署详情与此账户的地址不匹配。没有提交任何内容。",
  "These signers and threshold don't produce the watched address. Check them.":
    "这些签名者和阈值得不到所关注的地址。检查它们。",
  "This Ledger has reached the number of private accounts Bramble can keep.":
    "此 Ledger 的隐私账户数量已达到 Bramble 可保存的上限。",
  "This NFT is on another network. Switch networks to move it.":
    "此 NFT 在另一个网络上。切换网络以转移它。",
  "This account allows one escape attempt every 12 hours. Try again later.":
    "此账户每 12 小时只允许一次逃生尝试。稍后重试。",
  "This account doesn't own that NFT.": "此账户不拥有该 NFT。",
  "This account has 2FA, a device signature this wallet can't provide. Use it in Braavos.":
    "此账户启用了双重验证，需要此钱包无法提供的设备签名。在 Braavos 中使用它。",
  "This account has a backup guardian, so the recovery phrase can't remove its guardian.":
    "此账户有备用守护者，因此助记词无法移除其守护者。",
  "This account has a guardian, a second approver this wallet can't provide. Remove it with Recover account on Home, or use the account in Ready.":
    "此账户有守护者，即此钱包无法提供的第二审批方。在首页用“恢复账户”移除它，或在 Ready 中使用此账户。",
  "This account is already deployed.": "此账户已部署。",
  "This account is controlled by a signer Bramble can't use.":
    "此账户由 Bramble 无法使用的签名者控制。",
  "This account reported a guardian state this wallet can't read. Use it in Ready.":
    "此账户报告的守护者状态此钱包无法读取。在 Ready 中使用它。",
  "This account runs a Ready release this wallet can't recover. Use it in Ready.":
    "此账户运行的 Ready 版本此钱包无法恢复。在 Ready 中使用它。",
  "This account runs a release this wallet doesn't recognize. Use it in Braavos.":
    "此账户运行的版本此钱包无法识别。在 Braavos 中使用它。",
  "This account runs a release this wallet doesn't recognize. Use it in Ready.":
    "此账户运行的版本此钱包无法识别。在 Ready 中使用它。",
  "This account runs an older Argent release. Upgrade it in Ready to use it here.":
    "此账户运行的是较旧的 Argent 版本。在 Ready 中升级后即可在这里使用。",
  "This account signs with a method this wallet doesn't support. Use it in Ready.":
    "此账户使用此钱包不支持的签名方式。在 Ready 中使用它。",
  "This account's owner key has changed. This phrase can no longer sign for it.":
    "此账户的所有者密钥已更改。此助记词已无法为它签名。",
  "This account's signers can't be recovered with the recovery phrase.":
    "此账户的签名者无法通过助记词恢复。",
  "This account's signing key has changed. This phrase can no longer sign for it.":
    "此账户的签名密钥已更改。此助记词已无法为它签名。",
  "This authorization is too large to share.": "此授权过大，无法分享。",
  "This changed while you were reviewing it. Review it again.":
    "你检查时内容发生了变化。重新检查。",
  "This contact is saved with different keys. Remove it first if you mean to replace them.":
    "此联系人已用不同的密钥保存。如果要替换，先将其移除。",
  "This contract doesn't match the version Bramble expects, so nothing was submitted.":
    "此合约与 Bramble 预期的版本不符，因此没有提交任何内容。",
  "This is a Bramble account. Choose Bramble to import it.":
    "这是 Bramble 账户。选择 Bramble 来导入。",
  "This is a Bramble account. Use Find my accounts instead.":
    "这是 Bramble 账户。改用“找回我的账户”。",
  "This may already have been sent by another signer. Press again to send it anyway.":
    "其他签名者可能已经发送了它。再按一次仍然发送。",
  "This message is for a different network than the one you're on. Nothing was signed.":
    "此消息针对的网络与你当前所在的不同。没有签名任何内容。",
  "This multisig already has a transaction in flight. Wait for it to settle.":
    "此多签账户已有一笔交易在处理中。等待其完成。",
  "This multisig can't make this request.": "此多签账户无法发出此请求。",
  "This multisig can't submit a private proof.": "此多签账户无法提交隐私证明。",
  "This multisig changed since this request was reviewed.":
    "自检查此请求以来，此多签账户已发生变化。",
  "This multisig isn't deployed. Removing it deletes the setup needed to deploy it. Press again to remove it.":
    "此多签账户尚未部署。移除它会删除部署所需的设置。再按一次以移除。",
  "This multisig isn't the pinned account.": "此多签账户不是固定的账户。",
  "This multisig needs more than one signer.": "此多签账户需要多于一个签名者。",
  "This multisig was imported without its deployment details, so it can't be deployed from here.":
    "此多签账户导入时没有部署详情，因此无法从这里部署。",
  "This multisig's signers aren't available yet.": "此多签账户的签名者暂不可用。",
  "This private key doesn't control that account.": "此私钥不控制该账户。",
  "This recovery phrase doesn't control that account.": "此助记词不控制该账户。",
  "This review no longer matches what was prepared. Review it again.":
    "此检查与准备的内容不再一致。重新检查。",
  "This service is rate limiting requests. Wait a moment and try again.":
    "此服务正在限制请求频率。稍等片刻后重试。",
  "This shadow account holds none of your tracked tokens. Nothing was sent.":
    "此影子账户不持有你跟踪的任何代币。没有发送任何内容。",
  "This shadow account record isn't valid. Nothing was sent.":
    "此影子账户记录无效。没有发送任何内容。",
  "This shadow account was made under a different anonymizer, so it can't be checked or swept here. Nothing was sent.":
    "此影子账户是在另一个匿名器下创建的，因此无法在这里检查或归集。没有发送任何内容。",
  "This signer has already signed.": "此签名者已经签名。",
  "This transaction already has every signature it needs.": "此交易已获得所需的全部签名。",
  "This transaction could not be saved for the signers.": "无法为签名者保存此交易。",
  "This transaction is out of date. Create a new one.": "此交易已过期。创建一笔新的。",
  "This transaction is too large to share securely. Copy the package instead.":
    "此交易过大，无法安全分享。改为复制数据包。",
  "This transaction isn't ready to send.": "此交易尚未准备好发送。",
  "This transaction isn't waiting for a signature.": "此交易不在等待签名。",
  "This transaction was already sent.": "此交易已发送。",
  "This wallet can't deploy Braavos accounts yet. Deploy it in Braavos first.":
    "此钱包暂时无法部署 Braavos 账户。先在 Braavos 中部署。",
  "This wallet changed while the account was being checked. Search for it again.":
    "检查账户时此钱包发生了变化。重新搜索。",
  "This wallet doesn't hold a signer for this multisig.": "此钱包没有此多签账户的签名者。",
  "This wallet doesn't support that network.": "此钱包不支持该网络。",
  "This wallet is full, so this change wasn't saved.": "此钱包已满，因此没有保存此更改。",
  "This wallet no longer needs Unlock anyway. Close and reopen Bramble.":
    "此钱包已不再需要“仍然解锁”。关闭并重新打开 Bramble。",
  "This wallet was set up without a recovery phrase, so there is nothing to search for.":
    "此钱包设置时没有助记词，因此没有可搜索的内容。",
  "This wallet was set up without a recovery phrase. Import an existing account instead.":
    "此钱包设置时没有助记词。改为导入现有账户。",
  "Track a token first.": "先跟踪一个代币。",
  "Turn on Show NFTs on Home in Appearance & currency to watch NFTs.":
    "在“外观与货币”中开启“在首页显示 NFT”以关注 NFT。",
  "You can't send privately to the same account.": "不能隐私发送到同一个账户。",
  "You switched accounts. Review the recovery again.": "你已切换账户。重新检查恢复。",
  "Your Ledger returned a public key Bramble can't use. Nothing was added.":
    "你的 Ledger 返回了 Bramble 无法使用的公钥。没有添加任何内容。",
  "avnu couldn't prepare this swap. Get a fresh quote and try again.":
    "avnu 无法准备此兑换。获取新的报价后重试。",
  // Heads the STRK20 classifier puts before a sanitised reason (friendly-error.ts).
  "Starknet rejected the private transaction": "Starknet 拒绝了这笔隐私交易",
  "The fee couldn't be covered": "无法支付费用",
  "The account's nonce changed. Review the transaction again.":
    "账户的 nonce 已变化。重新检查交易。",
  "The privacy pool rejected the proof": "隐私资金池拒绝了证明",
  "The private transaction failed validation": "隐私交易未通过验证",
};
