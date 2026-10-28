# Gasless mainnet integration

`bun run test:mainnet` submits one real Starknet mainnet transaction through the
wallet's gasless path: the shipped mainnet route, the 6/5 price ceiling, the
pinned forwarder, SNIP-9 v2 / SNIP-12 revision 1 signing, and
`paymaster_executeTransaction`. It is not part of `bun run check` or CI. With
no account configured it prints a skip message and exits 0.

The call is a 1-base-unit transfer of the fee token back to the same account.
The paymaster fee is a second transfer of that token to the pinned forwarder
`0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f`. The script
checks the receipt, that transfer, the fee-token balance delta, and that the
STRK balance did not change. It does not use a sponsored fee mode or an API key.

The private key is read from the environment or an sncast accounts file and is
never printed. Do not commit `snfoundry.toml` when its RPC URL contains a key,
and do not commit an accounts file.

## Account class

The account must already be deployed, and its class must be one this wallet
will sign for gasless v2. For OpenZeppelin that class is:

```text
0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381
```

`sncast account create --type oz` uses a different class. Pass this class hash.
The class is already declared on mainnet.

## Create, deploy, and fund

Install [Starknet Foundry](https://foundry-rs.github.io/starknet-foundry/), then:

```shell
sncast account create \
  --network mainnet \
  --name gasless \
  --type oz \
  --class-hash 0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381
```

`sncast` writes the account to
`~/.starknet_accounts/starknet_open_zeppelin_accounts.json` under `alpha-mainnet`,
unless `--accounts-file` or `accounts-file` in `snfoundry.toml` says otherwise.
The command prints an address. Send that address enough STRK to deploy (a few
tenths of an STRK is enough), from a funded account:

```shell
sncast invoke \
  --network mainnet \
  --account funded \
  --contract-address 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d \
  --function transfer \
  --calldata <gasless-address> 200000000000000000 0
```

`200000000000000000` is 0.2 STRK. Then deploy:

```shell
sncast account deploy --network mainnet --name gasless
```

Send native USDC for the fee. One USDC (`1000000` base units, 6 decimals) is
plenty. The token is
`0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb`.

```shell
sncast invoke \
  --network mainnet \
  --account funded \
  --contract-address 0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb \
  --function transfer \
  --calldata <gasless-address> 1000000 0
```

If that USDC balance cannot cover the quoted fee, the script says so and uses
another curated mainnet token the account holds (ETH, STRK is never the fee
token, USDT, DAI, or WBTC) that the paymaster also lists.

## Run

Named sncast account:

```shell
export GASLESS_E2E_ACCOUNT=gasless
bun run test:mainnet
```

Optional overrides:

| Variable | Meaning |
| --- | --- |
| `GASLESS_E2E_ACCOUNT` | Account name in the sncast file |
| `GASLESS_E2E_ACCOUNTS_FILE` | Accounts file. Default `~/.starknet_accounts/starknet_open_zeppelin_accounts.json`, or `accounts-file` from `snfoundry.toml` |
| `GASLESS_E2E_NETWORK` | `mainnet` or `alpha-mainnet` |
| `GASLESS_E2E_PROFILE` | `[sncast.<profile>]` in `snfoundry.toml` |
| `GASLESS_E2E_SNFOUNDRY` | Path to `snfoundry.toml`. Otherwise the script walks from the current directory |
| `GASLESS_E2E_RPC_URL` | Starknet RPC. Otherwise the profile `url`, `networks.mainnet`, or the wallet's mainnet RPC |
| `GASLESS_E2E_ADDRESS` | Address, instead of an accounts file. Pair with `GASLESS_E2E_PRIVATE_KEY` |

Direct key, which takes precedence over the accounts file:

```shell
export GASLESS_E2E_ADDRESS=0x...
export GASLESS_E2E_PRIVATE_KEY=0x...
export GASLESS_E2E_RPC_URL=https://wallet.nodes.starknet.org/rpc/mainnet/v0_10
bun run test:mainnet
```

A profile can name the account and the RPC without exporting the key:

```toml
[sncast.mainnet]
account = "gasless"
accounts-file = "~/.starknet_accounts/starknet_open_zeppelin_accounts.json"
url = "https://wallet.nodes.starknet.org/rpc/mainnet/v0_10"
```

The script prints the full RPC URL and where it came from: `GASLESS_E2E_RPC_URL`,
`snfoundry url`, `snfoundry networks.mainnet`, or `wallet default`. A URL that
does not return mainnet's chain id is not used. `http://wallet.nodes.starknet.org`
has no RPC path and answers `route_not_allowed`; the script then uses
`https://wallet.nodes.starknet.org/rpc/mainnet/v0_10` and says so. The STRK
estimate passes tip `0x0`, the same as the wallet, so starknet.js does not
scan blocks for a tip.

Each curated token prints why it was skipped, or the quoted fee against the
6/5 ceiling. A build that returns `invalid_gasless_request` prints the request
and the gateway body. The private key is not in either.

On success the script prints the transaction hash, a Voyager link, and a
Starkscan link. A quote that fails the forwarder pin or the 6/5 ceiling is
refused before execute and does not spend. A malformed build is checked only
as a gateway error code (`invalid_gasless_request`) and is not submitted.
