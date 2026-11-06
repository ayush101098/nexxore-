/**
 * viem helper for RiskPilotEscrow on Arc testnet.
 *
 *   fund()   the user's wallet escrows USDC for an approved decision (the web app calls this)
 *   settle() the operator pays out the result (the engine's backend calls this)
 *
 * decisionId on-chain = keccak256 of the engine's decision_id string ("dec_…").
 * Amounts are USDC with 6 decimals: Arc's USDC ERC-20 interface. Native USDC for gas uses 18
 * decimals but shares the same balance; this helper only uses the ERC-20 interface.
 *
 * CLI (npx tsx escrow.ts …), reading PRIVATE_KEY, ESCROW_ADDRESS (or deployments/arc-testnet.json)
 * and ARC_RPC_URL (default Arc testnet):
 *   status <decision_id>
 *   fund <decision_id> <usdc>          as the depositor (approves first if needed)
 *   settle <decision_id> <payout_usdc> as the operator
 *   fund-reserve <usdc>
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, defineChain, http, keccak256, parseAbi, parseUnits, formatUnits, toHex,
  type Address, type Hash, type PublicClient, type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Arc testnet, from docs.arc.io/arc/references/connect-to-arc. */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc explorer", url: "https://explorer.testnet.arc.io" } },
});

export const USDC_DECIMALS = 6;

export const escrowAbi = parseAbi([
  "function fund(bytes32 decisionId, uint256 amount)",
  "function settle(bytes32 decisionId, uint256 payout)",
  "function refund(bytes32 decisionId)",
  "function fundReserve(uint256 amount)",
  "function usdc() view returns (address)",
  "function operator() view returns (address)",
  "function reserve() view returns (uint256)",
  "function deposits(bytes32) view returns (address depositor, uint64 fundedAt, uint256 amount, uint8 status)",
  "event Funded(bytes32 indexed decisionId, address indexed depositor, uint256 amount)",
  "event Settled(bytes32 indexed decisionId, address indexed depositor, uint256 amount, uint256 payout, uint256 reserve)",
]);

const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

export const STATUS = ["None", "Funded", "Settled", "Refunded"] as const;

/** On-chain key for an engine decision_id. */
export const decisionKey = (decisionId: string): Hash => keccak256(toHex(decisionId));

export type Clients = { pub: PublicClient; wallet?: WalletClient; escrow: Address };

export async function status({ pub, escrow }: Clients, decisionId: string) {
  const [depositor, fundedAt, amount, s] = await pub.readContract({
    address: escrow, abi: escrowAbi, functionName: "deposits", args: [decisionKey(decisionId)],
  });
  return { depositor, fundedAt: Number(fundedAt), amount: formatUnits(amount, USDC_DECIMALS), status: STATUS[s] };
}

async function send(c: Clients, request: Parameters<WalletClient["writeContract"]>[0]) {
  if (!c.wallet) throw new Error("a wallet client is required to send transactions");
  const hash = await c.wallet.writeContract(request);
  const receipt = await c.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return hash;
}

/** Escrow `usdc` (decimal string, e.g. "250.00") for a decision. Approves the escrow first if needed. */
export async function fund(c: Clients, decisionId: string, usdc: string) {
  const account = c.wallet!.account!;
  const amount = parseUnits(usdc, USDC_DECIMALS);
  const token = await c.pub.readContract({ address: c.escrow, abi: escrowAbi, functionName: "usdc" });
  const allowance = await c.pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, c.escrow] });
  let approveTx: Hash | undefined;
  if (allowance < amount) {
    approveTx = await send(c, { address: token, abi: erc20Abi, functionName: "approve", args: [c.escrow, amount], account, chain: c.wallet!.chain });
  }
  const fundTx = await send(c, { address: c.escrow, abi: escrowAbi, functionName: "fund", args: [decisionKey(decisionId), amount], account, chain: c.wallet!.chain });
  return { approveTx, fundTx };
}

/** Operator only: pay `payoutUsdc` to the decision's depositor. */
export async function settle(c: Clients, decisionId: string, payoutUsdc: string) {
  const account = c.wallet!.account!;
  return send(c, { address: c.escrow, abi: escrowAbi, functionName: "settle", args: [decisionKey(decisionId), parseUnits(payoutUsdc, USDC_DECIMALS)], account, chain: c.wallet!.chain });
}

export async function fundReserve(c: Clients, usdc: string) {
  const account = c.wallet!.account!;
  const amount = parseUnits(usdc, USDC_DECIMALS);
  const token = await c.pub.readContract({ address: c.escrow, abi: escrowAbi, functionName: "usdc" });
  await send(c, { address: token, abi: erc20Abi, functionName: "approve", args: [c.escrow, amount], account, chain: c.wallet!.chain });
  return send(c, { address: c.escrow, abi: escrowAbi, functionName: "fundReserve", args: [amount], account, chain: c.wallet!.chain });
}

// ── CLI ──────────────────────────────────────────────────────────────────
async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const rpc = process.env.ARC_RPC_URL ?? arcTestnet.rpcUrls.default.http[0];
  const deployments = join(here, "..", "deployments", "arc-testnet.json");
  const escrow = (process.env.ESCROW_ADDRESS ??
    (existsSync(deployments) ? JSON.parse(readFileSync(deployments, "utf8")).escrow : undefined)) as Address | undefined;
  if (!escrow) throw new Error("set ESCROW_ADDRESS or deploy first (deployments/arc-testnet.json)");

  const pub = createPublicClient({ transport: http(rpc) }) as PublicClient;
  const chainId = await pub.getChainId();
  const chain = chainId === arcTestnet.id ? arcTestnet : defineChain({ ...arcTestnet, id: chainId, name: `chain ${chainId}`, rpcUrls: { default: { http: [rpc] } } });
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  const wallet = pk ? createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(rpc) }) : undefined;
  const c: Clients = { pub, wallet, escrow };
  const explorer = chain.blockExplorers?.default.url;
  const link = (h?: string) => (h && chainId === arcTestnet.id ? `${explorer}/tx/${h}` : h);

  const [cmd, a, b] = process.argv.slice(2);
  let out: unknown;
  if (cmd === "status") out = await status(c, a);
  else if (cmd === "fund") { const r = await fund(c, a, b); out = { approveTx: link(r.approveTx), fundTx: link(r.fundTx) }; }
  else if (cmd === "settle") out = { settleTx: link(await settle(c, a, b)) };
  else if (cmd === "fund-reserve") out = { reserveTx: link(await fundReserve(c, a)) };
  else throw new Error("usage: escrow.ts status|fund|settle|fund-reserve …");
  console.log(JSON.stringify({ chainId, escrow, decisionKey: a?.startsWith("dec_") ? decisionKey(a) : undefined, ...(out as object) }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.shortMessage ?? e.message ?? e); process.exit(1); });
}
