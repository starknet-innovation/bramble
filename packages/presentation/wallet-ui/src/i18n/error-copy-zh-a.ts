/**
 * Simplified Chinese for the reviewed error copy, keyed by the exact English
 * the copy tables hold (first half; see ./error-copy.ts). Text only.
 */
export const ERROR_COPY_ZH_A: Readonly<Record<string, string>> = {
  "A call to the multisig itself can't be batched with other calls.":
    "对多签账户本身的调用不能与其他调用合并。",
  "A registration is already on its way for this account.": "此账户已有一笔注册正在进行。",
  "A site can't call your own account.": "网站不能调用你自己的账户。",
  "A wallet service rejected this request. Copy the error details for the full response.":
    "某项钱包服务拒绝了此请求。复制错误详情以查看完整响应。",
  "Activate private balances first.": "先启用隐私余额。",
  "Amount exceeds this multisig's balance.": "金额超过此多签账户的余额。",
  "Amount exceeds this multisig's private balance.": "金额超过此多签账户的隐私余额。",
  "An earlier private transaction from this account may still be in progress, and no check can confirm it. To continue anyway, open Settings → Unlock private transactions.":
    "此账户之前的一笔隐私交易可能仍在进行中，且无法确认。如仍要继续，打开 设置 → 解锁隐私交易。",
  "An earlier private transaction from this account may still be in progress. Check Activity, then check again. If it stays stuck, open Settings → Unlock private transactions.":
    "此账户之前的一笔隐私交易可能仍在进行中。查看活动，然后再次检查。如果一直卡住，打开 设置 → 解锁隐私交易。",
  "Approve the network fee to finish going private.": "批准网络费以完成转入隐私余额。",
  "Blocked for safety: the swap asked to approve the wrong token. Nothing was signed.":
    "出于安全已阻止：此兑换要求批准错误的代币。没有签名任何内容。",
  "Bramble can't import a Braavos account from a private key yet.":
    "Bramble 暂时无法通过私钥导入 Braavos 账户。",
  "Bramble can't record another shadow account. Nothing was sent.":
    "Bramble 无法再记录一个影子账户。没有发送任何内容。",
  "Bramble cannot verify this wallet. Close and reopen Bramble.":
    "Bramble 无法验证此钱包。关闭并重新打开 Bramble。",
  "Bramble couldn't verify its signing key. Nothing was signed.":
    "Bramble 无法验证其签名密钥。没有签名任何内容。",
  "Bramble doesn't support this account's contract version yet.":
    "Bramble 暂不支持此账户的合约版本。",
  "Bramble has no record of this shadow account. Nothing was sent.":
    "Bramble 没有此影子账户的记录。没有发送任何内容。",
  "Changing signers needs the current signer set. Refresh and try again.":
    "更改签名者需要当前的签名者集合。刷新后重试。",
  "Check the signer keys: one is invalid or repeated.": "检查签名者密钥：有一个无效或重复。",
  "Couldn't add that NFT. Check the contract address and try again.":
    "无法添加该 NFT。检查合约地址后重试。",
  "Couldn't add that account. Try again.": "无法添加该账户。重试。",
  "Couldn't add that multisig. Try again.": "无法添加该多签账户。重试。",
  "Couldn't add that token. Check the contract address and try again.":
    "无法添加该代币。检查合约地址后重试。",
  "Couldn't add those accounts. Try again.": "无法添加这些账户。重试。",
  "Couldn't build the sweep: two tracked tokens share one address. Nothing was sent.":
    "无法构建归集：两个已跟踪的代币共用一个地址。没有发送任何内容。",
  "Couldn't check balances. Try again.": "无法检查余额。重试。",
  "Couldn't check for co-signer updates. Try again shortly.":
    "无法检查共同签名者的更新。稍后重试。",
  "Couldn't check that recipient. Try again.": "无法检查该收款方。重试。",
  "Couldn't check that recovery phrase. Try again.": "无法检查该助记词。重试。",
  "Couldn't check this account's backup guardian. Try again.": "无法检查此账户的备用守护者。重试。",
  "Couldn't check this account's escape limit. Try again.": "无法检查此账户的逃生次数限制。重试。",
  "Couldn't check this account. Try again.": "无法检查此账户。重试。",
  "Couldn't check this key's Ready accounts. Try again.": "无法检查此密钥的 Ready 账户。重试。",
  "Couldn't compute this request's hash, so nothing was signed.":
    "无法计算此请求的哈希，因此没有签名任何内容。",
  "Couldn't confirm that contract is a token, so the revoke wasn't sent. Revoke it from the site that asked.":
    "无法确认该合约是代币，因此没有发送撤销。在发起请求的网站上撤销。",
  "Couldn't confirm the 2FA or guardian removal. Check activity before trying again.":
    "无法确认双重验证或守护者是否已移除。重试前先查看活动。",
  "Couldn't confirm this account. Try again.": "无法确认此账户。重试。",
  "Couldn't connect this multisig.": "无法连接此多签账户。",
  "Couldn't copy. Copy it manually.": "无法复制。手动复制。",
  "Couldn't create that folder. Try again.": "无法创建该文件夹。重试。",
  "Couldn't create your wallet. Try again.": "无法创建你的钱包。重试。",
  "Couldn't delete that folder. Try again.": "无法删除该文件夹。重试。",
  "Couldn't delete that transaction. Try again.": "无法删除该交易。重试。",
  "Couldn't estimate the network fee for this swap, so nothing was prepared. The quote may have moved, or the account may not hold enough to cover the swap and its fee. Try again, or reduce the amount.":
    "无法估算此兑换的网络费，因此没有准备任何内容。报价可能已变动，或账户余额不足以支付兑换及其费用。重试，或减少金额。",
  "Couldn't estimate the network fee, so nothing was signed. Try again.":
    "无法估算网络费，因此没有签名任何内容。重试。",
  "Couldn't estimate the network fee. Check your connection and try again.":
    "无法估算网络费。检查网络连接后重试。",
  "Couldn't export diagnostics. Try again.": "无法导出诊断信息。重试。",
  "Couldn't fetch a quote. Check your connection and try again.":
    "无法获取报价。检查网络连接后重试。",
  "Couldn't find a Ready account for this key on this network.":
    "在此网络上找不到此密钥对应的 Ready 账户。",
  "Couldn't import that account. Check what you pasted and try again.":
    "无法导入该账户。检查你粘贴的内容后重试。",
  "Couldn't import that recovery phrase. Check the words and try again.":
    "无法导入该助记词。检查单词后重试。",
  "Couldn't load 2FA or guardian removal. Check your connection and try again.":
    "无法加载双重验证或守护者移除。检查网络连接后重试。",
  "Couldn't load activity for this account. Try again.": "无法加载此账户的活动。重试。",
  "Couldn't load balances. Check your connection and try again.":
    "无法加载余额。检查网络连接后重试。",
  "Couldn't load connected sites.": "无法加载已连接的网站。",
  "Couldn't load multisig balances. Check your connection and try again.":
    "无法加载多签账户余额。检查网络连接后重试。",
  "Couldn't load private balances. Try again.": "无法加载隐私余额。重试。",
  "Couldn't load shadow accounts. Try again.": "无法加载影子账户。重试。",
  "Couldn't load the token list. Check your connection and try again.":
    "无法加载代币列表。检查网络连接后重试。",
  "Couldn't load the validator list. Paste a validator address instead.":
    "无法加载验证者列表。改为粘贴验证者地址。",
  "Couldn't load your settings. Try again.": "无法加载你的设置。重试。",
  "Couldn't load your stakes.": "无法加载你的质押。",
  "Couldn't lock the wallet. Try again.": "无法锁定钱包。重试。",
  "Couldn't look up that signer. Try again.": "无法查找该签名者。重试。",
  "Couldn't move that account. Try again.": "无法移动该账户。重试。",
  "Couldn't prepare a safe route for this swap. Get a fresh quote.":
    "无法为此兑换准备安全的路径。获取新的报价。",
  "Couldn't prepare activation. Try again.": "无法准备启用。重试。",
  "Couldn't prepare shielding. Try again.": "无法准备转入隐私余额。重试。",
  "Couldn't prepare the deployment. Try again.": "无法准备部署。重试。",
  "Couldn't prepare the sweep. Nothing was sent.": "无法准备归集。没有发送任何内容。",
  "Couldn't prepare this private action.": "无法准备此隐私操作。",
  "Couldn't prepare this private send. Try again.": "无法准备此隐私发送。重试。",
  "Couldn't prepare this staking action. Try again.": "无法准备此质押操作。重试。",
  "Couldn't prepare this swap. Get a fresh quote and try again.":
    "无法准备此兑换。获取新的报价后重试。",
  "Couldn't prepare this transaction. Try again.": "无法准备此交易。重试。",
  "Couldn't prepare this transfer. Try again.": "无法准备此转账。重试。",
  "Couldn't prepare unshielding. Try again.": "无法准备转出隐私余额。重试。",
  "Couldn't preview that account. Try again.": "无法预览该账户。重试。",
  "Couldn't reach the network, try again": "无法连接网络，再试一次",
  "Couldn't reach the network. Check your connection and try again.":
    "无法连接网络。检查网络连接后重试。",
  "Couldn't reach the network. Check your connection or RPC endpoint.":
    "无法连接网络。检查网络连接或 RPC 端点。",
  "Couldn't reach your Ledger. Reconnect the device and try again.":
    "无法连接你的 Ledger。重新连接设备后重试。",
  "Couldn't read staking on this network. Try again.": "无法读取此网络上的质押信息。重试。",
  "Couldn't read that backup file. Check the file and try again.":
    "无法读取该备份文件。检查文件后重试。",
  "Couldn't read the pool fee. Try again.": "无法读取资金池费用。重试。",
  "Couldn't read the private-balance key from your Ledger. Try again.":
    "无法从你的 Ledger 读取隐私余额密钥。重试。",
  "Couldn't read this account's deployment details. Try again.": "无法读取此账户的部署详情。重试。",
  "Couldn't read this account's owner. Try again.": "无法读取此账户的所有者。重试。",
  "Couldn't read this account's signers. Try again.": "无法读取此账户的签名者。重试。",
  "Couldn't read this account. Try again.": "无法读取此账户。重试。",
  "Couldn't read this multisig's signer history. Try again.":
    "无法读取此多签账户的签名者历史。重试。",
  "Couldn't read your connected sites. Try again.": "无法读取你已连接的网站。重试。",
  "Couldn't read your coordination key. Try again.": "无法读取你的协调密钥。重试。",
  "Couldn't read your saved settings. Restore them from a backup.":
    "无法读取你保存的设置。从备份中恢复。",
  "Couldn't read your shadow account records. Nothing was sent.":
    "无法读取你的影子账户记录。没有发送任何内容。",
  "Couldn't recover accounts. Check your connection and try again.":
    "无法恢复账户。检查网络连接后重试。",
  "Couldn't remove that NFT. Try again.": "无法移除该 NFT。重试。",
  "Couldn't remove that address. Try again.": "无法移除该地址。重试。",
  "Couldn't remove that multisig. Try again.": "无法移除该多签账户。重试。",
  "Couldn't remove that token. Try again.": "无法移除该代币。重试。",
  "Couldn't resolve that signer account. Try again.": "无法解析该签名者账户。重试。",
  "Couldn't reveal that. Re-enter your passphrase and try again.": "无法显示。重新输入密码后重试。",
  "Couldn't save that address. Try again.": "无法保存该地址。重试。",
  "Couldn't save that change. Try again.": "无法保存该更改。重试。",
  "Couldn't scan for tokens. Check your connection and try again.":
    "无法扫描代币。检查网络连接后重试。",
  "Couldn't search for accounts. Check your connection and try again.":
    "无法搜索账户。检查网络连接后重试。",
  "Couldn't share that securely. Copy the package instead.": "无法安全分享。改为复制数据包。",
  "Couldn't switch accounts. Try again.": "无法切换账户。重试。",
  "Couldn't switch networks. Try again.": "无法切换网络。重试。",
  "Couldn't sync with your co-signers. Try again.": "无法与共同签名者同步。重试。",
  "Couldn't unlock private transactions. Try again.": "无法解锁隐私交易。重试。",
  "Couldn't update that NFT. Try again.": "无法更新该 NFT。重试。",
  "Couldn't update that folder. Try again.": "无法更新该文件夹。重试。",
  "Couldn't update this multisig's key.": "无法更新此多签账户的密钥。",
  "Couldn't verify the co-signer updates. Try again shortly.":
    "无法验证共同签名者的更新。稍后重试。",
  "Couldn't verify this account's contract. Check your connection and try again.":
    "无法验证此账户的合约。检查网络连接后重试。",
  "Create a key before sharing it.": "先创建密钥再分享。",
  "Deploy this account first.": "先部署此账户。",
  "Each signer can only be added once.": "每个签名者只能添加一次。",
  "Each signer can only be removed once.": "每个签名者只能移除一次。",
  "Enter a valid Starknet address.": "输入有效的 Starknet 地址。",
  "Enter an amount to send.": "输入要发送的金额。",
  "Enter an amount to shield.": "输入要转入隐私余额的金额。",
  "Enter an amount to swap.": "输入要兑换的金额。",
  "Enter an amount to unshield.": "输入要转出隐私余额的金额。",
  "Estimate the fee again before approving.": "批准前重新估算费用。",
  "Finish what's in progress, then restart.": "先完成正在进行的操作，然后重新开始。",
  "Ledger signing isn't available. Reconnect the device and try again.":
    "Ledger 签名不可用。重新连接设备后重试。",
  "Multisig proposal saved. It was not submitted.": "多签提议已保存，但尚未提交。",
  "No Braavos account found for this key.": "未找到此密钥对应的 Braavos 账户。",
  "No account found at this address on this network. Check the address and network.":
    "在此网络上的该地址未找到账户。检查地址和网络。",
  "No account on this network yet. Add one to continue.": "此网络上还没有账户。添加一个以继续。",
  "No route found for this pair right now. Try a different amount or pair.":
    "目前没有此交易对的路径。尝试其他金额或交易对。",
  "No shielding route right now. Try again shortly.": "目前没有转入隐私余额的路径。稍后重试。",
  "Not enough signatures yet.": "签名还不够。",
};
