/**
 * Prints how to create the sncast account this suite imports, then checks a
 * configured account without printing its key. Exit 0 when nothing is
 * configured or the account is ready. Exit 1 when the configuration is unsafe.
 */
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { loadLocalMainnetFromProcess } from "../tests/mainnet/local-mainnet-account";
import { readPublicBalance } from "../tests/mainnet/local-mainnet-chain";
import { displayRpcUrl } from "./gasless-mainnet-rpc";

/**
 * The create/fund/deploy commands. The class hash is the one the wallet
 * derives, not sncast's default OpenZeppelin class.
 */
export const setupInstructions =
  (): string => `Create a mainnet OpenZeppelin account with Bramble's class, fund it, and deploy it.

  sncast account create \\
    --network mainnet \\
    --name bramble \\
    --type oz \\
    --class-hash ${OPENZEPPELIN_ACCOUNT_CLASS_HASH}

Fund the printed address with STRK (0.5 STRK covers several runs), then:

  sncast account deploy --network mainnet --name bramble

STRK token: ${STRK_TOKEN_ADDRESS}

Export the dedicated RPC and the acknowledgement, then name the account:

  export BRAMBLE_MAINNET_E2E_ACK=I_UNDERSTAND_THIS_WRITES_TO_MAINNET
  export BRAMBLE_MAINNET_E2E_RPC_URL=https://your-dedicated-mainnet-rpc
  export BRAMBLE_MAINNET_SNCAST_ACCOUNT=bramble

Optional: BRAMBLE_MAINNET_SNCAST_ACCOUNTS_FILE, BRAMBLE_MAINNET_SNCAST_PROFILE,
BRAMBLE_MAINNET_SNFOUNDRY. Direct key instead of sncast:
BRAMBLE_MAINNET_E2E_ADDRESS and BRAMBLE_MAINNET_E2E_PRIVATE_KEY.

Do not commit snfoundry.toml when its URL contains a key, and do not commit an
accounts file. Then:

  bun run build
  bun run test:e2e:mainnet:wallet

See docs/MAINNET_E2E.md.`;

const main = async (): Promise<number> => {
  console.log(setupInstructions());
  const loaded = await loadLocalMainnetFromProcess();
  if (loaded.kind === "skip") {
    console.log(loaded.message);
    return 0;
  }
  if (loaded.kind === "error") {
    console.error(loaded.message);
    return 1;
  }
  const strk = await readPublicBalance(loaded.account.rpcUrl, loaded.account.address, "STRK");
  const eth = await readPublicBalance(loaded.account.rpcUrl, loaded.account.address, "ETH");
  console.log(`Ready ${loaded.account.label}`);
  console.log(`RPC ${displayRpcUrl(loaded.account.rpcUrl)}`);
  console.log(`STRK ${strk.formatted}`);
  console.log(`ETH ${eth.formatted}`);
  return 0;
};

if (import.meta.main) {
  process.exit(await main());
}
