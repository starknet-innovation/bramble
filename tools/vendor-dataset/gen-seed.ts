/** Prints one fresh 12-word BIP-39 mnemonic. For dataset slots only. */
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

console.log(generateMnemonic(wordlist));
