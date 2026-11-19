# Local mainnet wallet tests

`bun run test:e2e:mainnet:wallet` drives the built extension against Starknet
mainnet from a funded account on your machine. It is not part of `bun run check`
or CI. With nothing configured it prints a skip message and exits 0.

The mocked suite (`bun run test:e2e`) stays offline. The STRK20 lifecycle
(`bun run test:e2e:mainnet`) and the non-UI gasless script (`bun run test:mainnet`)
are separate. This suite covers the wallet UI.

## Safety

- Refuses to start when `CI` is set.
- Naming the account is the opt-in. Once `BRAMBLE_MAINNET_SNCAST_ACCOUNT` (or
  a direct address and key) is set, the suite may write to mainnet from that
  shell. Unset it when you are done.
- `BRAMBLE_MAINNET_E2E_ACK` is optional. If it is set, it must be
  `I_UNDERSTAND_THIS_WRITES_TO_MAINNET`; any other value stops the run.
- The RPC defaults to the Foundation's public endpoint,
  `https://mainnet.nodes.starknet.org/rpc/v0_10`. It is shared and rate
  limited, so a run can fail there for reasons that are not the wallet's.
  `BRAMBLE_MAINNET_E2E_RPC_URL` replaces it with your own HTTPS endpoint;
  `wallet.nodes.starknet.org` is refused. The extension is pointed at the
  chosen URL before it reads balances or sends.
- The RPC must answer mainnet's chain id. A URL that does not is not used.
- The account must already be deployed as OpenZeppelin class
  `0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381`
  (the class this wallet imports). `sncast account create --type oz` without
  that class hash derives a different address. The suite checks the on-chain
  class before it opens a browser, and checks the imported address before it
  sends. A mismatch does not submit.
- Self-transfers use `0.000001` of the token. That principal comes back to the
  same account. A review whose displayed STRK fee is above `0.02` STRK, or that
  is not priced in STRK, is not submitted.
- A gasless quote is submitted only for USDC, USDT, or DAI at or under `0.02`,
  ETH at or under `0.00002`, or WBTC at or under `0.000002`. Any other symbol,
  including STRK, is ignored. No quote under the cap means that spec is skipped
  and nothing is submitted.
- Retries are 0. A run that dies after submit does not send the transaction
  again by itself. Starting the command again will send again.
- Traces, screenshots, and video are off. The signing key is still typed into
  the import field. A failed Playwright step can print that typed value, so
  run this in a private terminal and do not turn recording on.
- The key is not printed by the loader, the setup script, or the skip message.
  Do not commit an accounts file, and do not commit `snfoundry.toml` when its
  URL contains a key.

## Cost of one full run

| Spec | What it spends |
| --- | --- |
| Balances | Nothing. Compares the home rows to `balanceOf`. |
| SNIP-12 sign | Nothing. `is_valid_signature` is a call. |
| STRK self-transfer | The network fee only, capped at 0.02 STRK on the review. |
| ETH self-transfer | The same, and only when the account holds at least 0.000001 ETH. Otherwise it is skipped. |
| Dapp invoke | One fee, same cap. One dust STRK self-transfer. |
| Dapp multicall | One fee, same cap. Two dust STRK self-transfers in one transaction. |
| Gasless send | A fee-token quote inside the caps above, or nothing if no such quote is shown. STRK balance is expected to stay put. |

Four priced transactions at the cap is 0.08 STRK, plus at most one gasless
quote. A normal mainnet fee is well under the cap. 0.5 STRK on the account
covers several full runs. The dust principal returns; the fee does not.

## Create the account

`bun run test:e2e:mainnet:setup` prints these commands and, once the variables
below are set, checks the account, its class, and its STRK and ETH balances
without printing the key.

```shell
sncast account create \
  --network mainnet \
  --name bramble \
  --type oz \
  --class-hash 0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381
```

`sncast` writes `~/.starknet_accounts/starknet_open_zeppelin_accounts.json`
under `alpha-mainnet`, unless `--accounts-file` or `accounts-file` in
`snfoundry.toml` says otherwise. Send the printed address STRK from an account
that already has some, then:

```shell
sncast account deploy --network mainnet --name bramble
```

ETH is optional and only unlocks the ETH self-transfer. A little USDC (or
another capped fee token) is optional and only unlocks the gasless spec.

## Run

```shell
bun run build
export BRAMBLE_MAINNET_SNCAST_ACCOUNT=bramble
bun run test:e2e:mainnet:wallet
```

| Variable | Meaning |
| --- | --- |
| `BRAMBLE_MAINNET_SNCAST_ACCOUNT` | Account name in the sncast file. Setting it permits mainnet writes |
| `BRAMBLE_MAINNET_E2E_RPC_URL` | Your own HTTPS mainnet RPC. Default: the Foundation's public endpoint |
| `BRAMBLE_MAINNET_E2E_ACK` | Optional. If set, must be `I_UNDERSTAND_THIS_WRITES_TO_MAINNET` |
| `BRAMBLE_MAINNET_SNCAST_ACCOUNTS_FILE` | Accounts file. Default is sncast's, or `accounts-file` from the profile |
| `BRAMBLE_MAINNET_SNCAST_PROFILE` | `[sncast.<profile>]` in `snfoundry.toml` |
| `BRAMBLE_MAINNET_SNFOUNDRY` | Path to `snfoundry.toml`. Otherwise the loader walks up from the current directory |
| `BRAMBLE_MAINNET_E2E_ADDRESS` | Address, instead of an accounts file. Pair with `BRAMBLE_MAINNET_E2E_PRIVATE_KEY` |

A direct address and key take precedence over the accounts file, same as
`bun run test:mainnet`. The URL in `snfoundry.toml` is not used as the RPC.
Set `BRAMBLE_MAINNET_E2E_RPC_URL` to use the profile's endpoint.

`bun run test:e2e:install` once per machine, for Chromium.

## What each spec covers

- `balances.mainnet.ts` — import the sncast key as an OpenZeppelin account,
  set the dedicated RPC, and match the home STRK and ETH amounts to `balanceOf`.
- `transfer.mainnet.ts` — STRK self-transfer through Send, with the fee on the
  review, a successful receipt, the STRK balance down by that fee, the row in
  Activity, and the home amount matching the chain again. ETH does the same
  when the account holds ETH: ETH is unchanged and STRK pays the fee.
- `dapp-invoke.mainnet.ts` — a loopback dapp connects, then `wallet_addInvokeTransaction`
  for one STRK self-transfer and for two of them in one multicall. Both are
  approved on the transaction card after the fee is shown, and both receipts
  succeed. Activity lists each hash.
- `sign-message.mainnet.ts` — the dapp requests a fixed SNIP-12 revision 1
  message. The signature is checked with the account's `is_valid_signature`.
- `gasless-send.mainnet.ts` — the same STRK self-transfer, submitted with a
  gasless fee button when one is under the cap. STRK does not move. The fee
  token decreases by at most the quoted amount.

## Follow-ups

Account deployment through the UI is not in this suite. A fresh counterfactual
has to be funded first, and the deploy fee depends on the class. A reverted
deploy can still consume that prefund. Add it when that fee can be capped the
same way as a transfer.

Swap is not in this suite. A swap sells a token through a third-party quote.
It is not a self-transfer, it has a minimum size and slippage, and a quote can
move funds even when the rest of the flow stops. Add it only with its own cap
and a token you can afford to sell.

The STRK20 privacy lifecycle stays on `bun run test:e2e:mainnet`.

# Multisig privacy round

`bun run test:e2e:mainnet:multisig` runs STRK20 private balances on an Argent
multisig against mainnet, with real STRK. It needs the same funded sncast
account, the same variables and the same build as the wallet suite above, and
nothing else. It is local-only and is not part of `bun run check` or CI.

```shell
bun run build
export BRAMBLE_MAINNET_SNCAST_ACCOUNT=bramble
bun run test:e2e:mainnet:multisig
```

A round makes far more RPC calls than the wallet suite and polls for minutes.
If the shared default rate-limits it, set `BRAMBLE_MAINNET_E2E_RPC_URL`.

## What one round does

1. Opens two wallets on two browser profiles. Their recovery phrases are
   computed from the sncast key, so the sncast account is the only secret.
2. Each wallet saves the other as a co-signer. Together they own a new 2-of-2
   Argent multisig.
3. The sncast account sends STRK to the multisig address. This is the only
   transfer the sncast key signs, and it never enters a browser.
4. Owner A deploys the multisig. Owner B adds it from the chain.
5. Owner A creates the viewing key and shares it. Owner B receives it.
6. The multisig registers with the pool, then deposits.
7. It transfers privately to itself, then withdraws to the sncast account.
   Both go through the private relay.
8. It sweeps its remaining public STRK to the sncast account.

Every signature is collected the way two people would: one wallet shares over
Nostr, the other syncs, reviews and signs. The test copies nothing between the
wallets. It drives them through the background's runtime messages, not by
clicking, so it does not cover the multisig screens.

## What it checks

- Each transaction has a successful receipt.
- The deposit leaves the public balance and appears in the private balance.
- Owner B reads the same private balance as owner A, with the key it was sent.
- The withdrawal and the sweep arrive at the sncast account, to the FRI.
- The multisig ends with no more public STRK than a sweep's fee margin.
- The sncast account ends no more than the funded amount below its start.

## What it costs

Sizes follow the pool's own fee `p`, read from `get_fee_amount` before
anything is sent. A fee above 5 STRK stops the round.

| Amount | Size |
| --- | --- |
| Funding sent to the multisig | `4p + 5.1` STRK, never above 30 |
| Deposit | `2p + 2.1` STRK |
| Private self-transfer | 0.1 STRK, which stays in the multisig |

The sncast account must hold the funding plus 0.5 STRK. What does not come
back is four pool fees (register, deposit, transfer, withdraw), two relay
fees, the network fees, and a private remainder smaller than one relayed
action's cost, which is not worth withdrawing. The round prints its cost and
what it left behind. These figures have not been measured on mainnet yet.

Ceilings, fixed in `tests/mainnet/multisig/round-budget.ts`: 1 STRK for the
deployment fee, 3 STRK for a transaction carrying a proof, 0.5 STRK for a
transfer. A fee above its ceiling stops the round before it is sent.

## If a round stops early

The round keeps `.mainnet-multisig-e2e/` in the checkout: the two profiles and
`round.json`, which names the multisig and holds no key. The directory is
git-ignored and is removed when a round finishes.

- A round that fails after deployment tries to return the funds at once and
  says what it moved.
- Run the command again from the same checkout. A run that finds a deployed
  multisig only returns what it holds, then asks you to run once more.
- Do not delete `.mainnet-multisig-e2e/` while a round is unfinished. The two
  profiles hold the only copies of the multisig's viewing key. Without it the
  private balance cannot be read or withdrawn. Public STRK can still be
  recovered, because the owners are computed from the sncast key.
- The profiles are bound to the checkout path. A different worktree sees an
  empty wallet in the same directory.

The profiles are protected by the test suite's published vault passphrase, so
treat the directory like the sncast accounts file: anyone who can read it can
sign for the multisig.

## Options

| Variable | Meaning |
| --- | --- |
| `BRAMBLE_MAINNET_MULTISIG_NOSTR_RELAY` | One `wss://` relay both wallets use instead of the wallet's defaults |

## Not covered

- The multisig screens. `tests/e2e/multisig-round-wallets.e2e.ts` runs the
  two-wallet setup offline in CI so the driver does not rot.
- The broadcast firewall from the wallet suite. This round's wallets hold no
  funded key of their own; they sign only for the multisig.
- Tokens other than STRK, thresholds other than 2-of-2, and a proof that
  expires while co-owners sign.
