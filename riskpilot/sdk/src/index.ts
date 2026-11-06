// @riskpilot/sdk: a client for the RiskPilot engine's v1 API (docs/openapi.yaml).
//
//   const rp = new RiskPilot({ engine: "http://localhost:8000", account });
//   await rp.setProfile("moderate");                       // once per wallet, EIP-191 signed
//   const stop = rp.subscribe((e) => ...);                 // block, opportunity, decision, health, settlement
//   const d = await rp.evaluate({ opportunity, ... });     // any opportunity, under the wallet's profile
//   const plan = await rp.build(d.decision_id);            // EIP-5792 calls[]; 409 unless live, signed APPROVE
//   const hash = await rp.execute(plan, { wallet, publicClient });  // simulate + send each call, in order
//   await rp.report({ decision_id, chain_id, tx_hash, ... });       // idempotent
//
// The engine decides; the caller's own wallet signs every transaction. Nothing here holds a key.

import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { verifyTypedData } from "viem";

export type Profile = "conservative" | "moderate" | "aggressive";
export type Verdict = "APPROVE" | "REJECT" | "REQUOTE" | "REQUIRE_REVIEW";

export interface Decision {
  decision_id: string;
  opportunity_id: string;
  verdict: Verdict;
  reason: string;
  gross_edge: string;
  net_edge: string;
  stress_loss_before: string;
  stress_loss_after: string;
  budget: string;
  expires_at: string;
  created_at: string;
  inputs: Record<string, any>;
  signature?: DecisionSignature;
}

export interface DecisionSignature {
  signer: Address;
  scheme: "EIP-712";
  domain: { name: string; version: string };
  message: { id: string; wallet: Address; inputsHash: Hex; verdict: string; expiresAt: number };
  signature: Hex;
}

export interface Opportunities {
  wallet: Address;
  block: number | null;
  as_of: string;
  profile: Record<string, any>;
  items: { label: string; key: string; opportunity: Record<string, any>; decision: Decision }[];
}

export interface Call { to: Address; data: Hex; value: Hex; label: string; min_out?: string }
export interface Plan { decision_id: string; chain_id: number; from: Address; calls: Call[]; signature: DecisionSignature }

export interface Execution {
  decision_id: string;
  chain_id: number;
  tx_hash: Hex;
  status: "pending" | "confirmed" | "reverted";
  verified_at: string | null;
  settlement_tx: Hex | null;
}

export type StreamEvent =
  | { event: "block"; data: { block: number; at: number; mode: string } }
  | { event: "opportunity"; data: Opportunities }
  | { event: "decision"; data: { decision_id: string; execution: Execution; position: Record<string, any> } }
  | { event: "health"; data: Record<string, any> }
  | { event: "settlement"; data: { decision_id: string; status: string; tx?: Hex; reason?: string } };

export class RiskPilotError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const DECISION_TYPES = {
  RiskPilotDecision: [
    { name: "id", type: "string" },
    { name: "wallet", type: "address" },
    { name: "inputsHash", type: "bytes32" },
    { name: "verdict", type: "string" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

/** The EIP-191 message a wallet signs to set its profile (engine api.profile_message). */
export const profileMessage = (wallet: Address, profile: Profile, setAt: string) =>
  `RiskPilot profile\nwallet: ${wallet.toLowerCase()}\nprofile: ${profile}\nset_at: ${setAt}`;

export class RiskPilot {
  readonly api: string;
  readonly account: Account;

  constructor({ engine = "http://localhost:8000", account }: { engine?: string; account: Account }) {
    this.api = engine.replace(/\/$/, "") + "/v1";
    this.account = account;
  }

  get wallet(): Address { return this.account.address; }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(this.api + path, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
    if (!r.ok) throw new RiskPilotError(r.status, `${init.method || "GET"} ${path}: ${r.status} ${await r.text()}`);
    return r.json() as Promise<T>;
  }

  /** Choose the wallet's profile (once; calling again changes it and cancels live approvals). */
  async setProfile(profile: Profile): Promise<{ wallet: string; profile: Profile; set_at: string; previous: Profile | null }> {
    if (!this.account.signMessage) throw new Error("this account cannot sign messages");
    const setAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const signature = await this.account.signMessage({ message: profileMessage(this.wallet, profile, setAt) });
    return this.call("/profile", { method: "PUT", body: JSON.stringify({ wallet: this.wallet, profile, set_at: setAt, signature }) });
  }

  async profile(): Promise<Profile | null> {
    return (await this.call<{ profile: Profile | null }>(`/profile?wallet=${this.wallet}`)).profile;
  }

  /** The wallet's evaluated opportunities at the current block. */
  opportunities(): Promise<Opportunities> {
    return this.call(`/opportunities?wallet=${this.wallet}`);
  }

  /** Evaluate any opportunity under the wallet's profile and this block's derived limits. */
  evaluate(body: Record<string, any>): Promise<Decision> {
    return this.call("/evaluate", { method: "POST", body: JSON.stringify({ wallet: this.wallet, ...body }) });
  }

  decision(id: string): Promise<Decision> {
    return this.call(`/decisions/${id}`);
  }

  /** EIP-5792 calls[] for a live, engine-signed APPROVE. Throws RiskPilotError 409 otherwise. */
  build(decisionId: string): Promise<Plan> {
    return this.call(`/decisions/${decisionId}/build`, { method: "POST" });
  }

  /** Report a verified execution (idempotent). Returns the engine's position. */
  report(execution: Execution): Promise<Record<string, any>> {
    return this.call("/executions", { method: "POST", body: JSON.stringify(execution) });
  }

  replay(decisionId: string): Promise<{ matches: boolean; decision: Decision }> {
    return this.call(`/decisions/${decisionId}/replay`, { method: "POST" });
  }

  /** Does the decision carry a valid EIP-712 signature from `engine` (the address in /v1/health)? */
  async verifyDecision(d: Decision, engine: Address): Promise<boolean> {
    const s = d.signature;
    if (!s || s.signer.toLowerCase() !== engine.toLowerCase() || s.message.id !== d.decision_id || s.message.verdict !== d.verdict) return false;
    return verifyTypedData({ address: engine, domain: s.domain, types: DECISION_TYPES, primaryType: "RiskPilotDecision",
      message: { ...s.message, expiresAt: BigInt(s.message.expiresAt) }, signature: s.signature });
  }

  /**
   * Send a plan's calls in order from `wallet`: each is simulated (eth_call) first and must succeed,
   * then sent and confirmed. Returns the last (main) transaction's hash.
   */
  async execute(plan: Plan, { wallet, publicClient }: { wallet: WalletClient; publicClient: PublicClient }): Promise<Hex> {
    let hash: Hex | undefined;
    for (const c of plan.calls) {
      await publicClient.call({ account: this.wallet, to: c.to, data: c.data });
      hash = await wallet.sendTransaction({ account: this.account, chain: wallet.chain, to: c.to, data: c.data });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error(`${c.label} reverted (${hash})`);
    }
    if (!hash) throw new Error("empty plan");
    return hash;
  }

  /** Server-sent events for this wallet. Returns a function that stops the subscription. */
  subscribe(onEvent: (e: StreamEvent) => void, onError: (e: unknown) => void = () => {}): () => void {
    const ctl = new AbortController();
    (async () => {
      const r = await fetch(`${this.api}/stream?wallet=${this.wallet}`, { signal: ctl.signal, headers: { accept: "text/event-stream" } });
      if (!r.ok || !r.body) throw new RiskPilotError(r.status, "stream refused");
      const reader = r.body.getReader(), text = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += text.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const event = frame.match(/^event: (.+)$/m)?.[1], data = frame.match(/^data: (.+)$/m)?.[1];
          if (event && data) onEvent({ event, data: JSON.parse(data) } as StreamEvent);
        }
      }
    })().catch((e) => { if (!ctl.signal.aborted) onError(e); });
    return () => ctl.abort();
  }
}
