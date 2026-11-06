"""arc-worker (hardening section 6): Arc settles itself.

Follows RiskPilotEscrow's Funded events (getLogs from the deployment block, then every 2 s
from the last block seen; the catch-up on start means a restart misses nothing), and for
each funded decision:

  1. matches the event's decisionId = keccak256(decision_id) to a stored decision;
  2. waits for that decision's verified Execution;
  3. reads deposits(decisionId) on Arc: only status Funded is settled, so a restart or a
     second worker never settles twice;
  4. sends settle(decisionId, payout) signed with the operator key (ARC_OPERATOR_KEY),
     payout = amount x (1 + net_edge / size), the engine's priced result;
  5. waits for 1 confirmation and records the tx in the settlements table.

Retries 3 times (2 s, 8 s, 30 s), then records "failed: <reason>". All amounts use the USDC
ERC-20 interface, 6 decimals. Status per decision: Funded -> Settling -> Settled | Failed.
"""

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from decimal import Decimal

from eth_abi import decode, encode
from eth_account import Account
from eth_utils import keccak

from tls import CONTEXT, USER_AGENT

log = logging.getLogger("riskpilot")

FUNDED_TOPIC = "0x" + keccak(text="Funded(bytes32,address,uint256)").hex()
SEL_SETTLE = keccak(text="settle(bytes32,uint256)")[:4]
SEL_DEPOSITS = keccak(text="deposits(bytes32)")[:4]
SEL_BALANCE = keccak(text="balanceOf(address)")[:4]
STATUS = {0: "None", 1: "Funded", 2: "Settled", 3: "Refunded"}
RETRY_S = (2, 8, 30)
POLL_S = float(os.environ.get("ARC_POLL_S", "4"))  # Arc's public RPC rate-limits per IP; leave room for the wallet
UNITS = Decimal(10**6)  # USDC ERC-20 interface: 6 decimals


def decision_key(decision_id: str) -> str:
    return "0x" + keccak(text=decision_id).hex()


class Rpc:
    def __init__(self, url: str):
        self.url = url

    def __call__(self, method: str, params: list):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        req = urllib.request.Request(self.url, body, {"Content-Type": "application/json", "User-Agent": USER_AGENT})
        for wait in (1, 3, 0):  # Arc's public RPC rate-limits bursts (HTTP 429)
            try:
                with urllib.request.urlopen(req, timeout=10, context=CONTEXT) as r:
                    reply = json.load(r)
                break
            except urllib.error.HTTPError as e:
                if e.code != 429 or not wait:
                    raise
                time.sleep(wait)
        if "error" in reply:
            raise RuntimeError(reply["error"].get("message", reply["error"]))
        return reply["result"]


def payout_units(decision: dict, amount_units: int) -> int:
    """payout = amount x (1 + net_edge / size), in USDC units (6 dp), rounded down."""
    size = Decimal(decision["inputs"]["request"]["size"])
    amount = Decimal(amount_units) / UNITS
    return int((amount * (1 + Decimal(decision["net_edge"]) / size) * UNITS).to_integral_value(rounding="ROUND_DOWN"))


class ArcWorker(threading.Thread):
    def __init__(self, deployment: dict, rpc_url: str, store, operator_key: str | None,
                 publish: Callable[[str, dict], None] = lambda *_: None, rpc: Callable | None = None,
                 sleep: Callable[[float], None] = time.sleep):
        super().__init__(daemon=True, name="arc-worker")
        self.dep, self.store, self.publish, self.sleep = deployment, store, publish, sleep
        self.rpc = rpc or Rpc(rpc_url)
        self.account = Account.from_key(operator_key) if operator_key else None
        self.cursor = int(deployment["deployed_block"])
        self._stop = threading.Event()
        self.last_error: str | None = None
        self.last_poll: float | None = None

    def stop(self):
        self._stop.set()

    def status(self) -> dict:
        return {"escrow": self.dep["escrow"], "cursor": self.cursor, "last_poll": self.last_poll,
                "operator": self.account.address if self.account else None,
                "operator_key": "set" if self.account else "missing: set ARC_OPERATOR_KEY", "last_error": self.last_error}

    # ── reads ──
    def deposit(self, key: str) -> tuple[str, int, int, str]:
        raw = self.rpc("eth_call", [{"to": self.dep["escrow"], "data": "0x" + (SEL_DEPOSITS + bytes.fromhex(key[2:])).hex()}, "latest"])
        depositor, funded_at, amount, status = decode(["address", "uint64", "uint256", "uint8"], bytes.fromhex(raw[2:]))
        return depositor, funded_at, amount, STATUS[status]

    def operator_usdc(self) -> Decimal:
        who = self.dep["operator"]
        raw = self.rpc("eth_call", [{"to": self.dep["usdc"], "data": "0x" + (SEL_BALANCE + encode(["address"], [who])).hex()}, "latest"])
        return Decimal(int(raw, 16)) / UNITS

    # ── loop ──
    def poll(self) -> None:
        """One pass: new Funded logs since the cursor, plus any decision still waiting."""
        head = int(self.rpc("eth_blockNumber", []), 16)
        while self.cursor <= head:
            to = min(head, self.cursor + 9_999)
            logs = self.rpc("eth_getLogs", [{"address": self.dep["escrow"], "topics": [FUNDED_TOPIC],
                                             "fromBlock": hex(self.cursor), "toBlock": hex(to)}])
            for lg in logs:
                self.on_funded(lg["topics"][1], int(lg["data"], 16), lg["transactionHash"])
            self.cursor = to + 1
        for s in self.store.list_settlements():
            if s["status"] in ("Funded", "Settling"):
                self.try_settle(s["decision_id"])
        self.last_poll = time.time()

    def on_funded(self, key: str, amount: int, fund_tx: str) -> None:
        decision = self._decision_for(key)
        if decision is None:
            log.info(json.dumps({"event": "arc_funded_unknown", "key": key}))
            return
        did = decision["decision_id"]
        if (s := self.store.get_settlement(did)) is None or s["status"] == "Funded":
            self._record(did, "Funded", key=key, amount_units=amount, fund_tx=fund_tx)
        self.try_settle(did)

    def _decision_for(self, key: str) -> dict | None:
        for d in self.store.list_decisions(100_000):
            if decision_key(d["decision_id"]) == key:
                return d
        return None

    def _record(self, decision_id: str, status: str, **fields) -> dict:
        prev = self.store.get_settlement(decision_id) or {}
        s = {**prev, **fields, "decision_id": decision_id, "status": status, "updated_at": time.time()}
        self.store.save_settlement(s)
        self.publish("settlement", s)
        log.info(json.dumps({"event": "settlement", "decision_id": decision_id, "status": status,
                             **{k: v for k, v in fields.items() if k in ("tx", "reason")}}))
        return s

    def try_settle(self, decision_id: str) -> None:
        s = self.store.get_settlement(decision_id)
        decision = self.store.get_decision(decision_id)
        key = s["key"]
        _, _, amount, on_chain = self.deposit(key)
        if on_chain != "Funded":  # settled (by us before a restart, or anyone) or refunded: never again
            if s["status"] != "Settled" and on_chain == "Settled":
                self._record(decision_id, "Settled", note="already settled on chain")
            elif on_chain == "Refunded":
                self._record(decision_id, "Refunded")
            return
        executed = [e for e in self.store.executions_for_decision(decision_id) if e["status"] == "confirmed"]
        if not executed:
            if s.get("waiting") != "execution":
                self._record(decision_id, "Funded", waiting="execution")
            return
        if self.account is None:
            if s.get("waiting") != "operator key":
                self._record(decision_id, "Funded", waiting="operator key")
            return
        payout = payout_units(decision, amount)
        self._record(decision_id, "Settling", payout_units=payout, waiting=None)
        reason = None
        for attempt, delay in enumerate((0, *RETRY_S)):
            if delay:
                self.sleep(delay)
            try:
                tx = self._send_settle(key, payout)
                self._record(decision_id, "Settled", tx=tx, attempts=attempt + 1)
                execution = {**executed[-1], "settlement_tx": tx}
                self.store.save_execution(execution)
                return
            except Exception as e:  # noqa: BLE001 - retried, then reported
                reason = str(e)
                self.last_error = reason
                if self.deposit(key)[3] == "Settled":  # the tx landed though the receipt wait failed
                    self._record(decision_id, "Settled", note="confirmed on chain after a retry error")
                    return
        self._record(decision_id, "Failed", reason=reason)

    def _send_settle(self, key: str, payout: int) -> str:
        data = "0x" + (SEL_SETTLE + encode(["bytes32", "uint256"], [bytes.fromhex(key[2:]), payout])).hex()
        sender = self.account.address
        nonce = int(self.rpc("eth_getTransactionCount", [sender, "pending"]), 16)
        gas = int(self.rpc("eth_estimateGas", [{"from": sender, "to": self.dep["escrow"], "data": data}]), 16)
        fh = self.rpc("eth_feeHistory", ["0x1", "latest", [50]])
        base = int(fh["baseFeePerGas"][-1], 16)
        tip = int((fh.get("reward") or [["0x0"]])[-1][0], 16) or 1
        tx = {"chainId": int(self.dep["chain_id"]), "nonce": nonce, "to": self.dep["escrow"], "data": data, "value": 0,
              "gas": gas * 12 // 10, "maxFeePerGas": 2 * base + tip, "maxPriorityFeePerGas": tip, "type": 2}
        signed = self.account.sign_transaction(tx)
        raw = signed.raw_transaction.hex()
        tx_hash = self.rpc("eth_sendRawTransaction", ["0x" + raw.removeprefix("0x")])
        for _ in range(120):  # 1 confirmation
            rc = self.rpc("eth_getTransactionReceipt", [tx_hash])
            if rc:
                if int(rc["status"], 16) != 1:
                    raise RuntimeError(f"settle reverted ({tx_hash})")
                return tx_hash
            self.sleep(0.5)
        raise TimeoutError(f"no receipt for {tx_hash}")

    def run(self):
        while not self._stop.is_set():
            try:
                self.poll()
                self.last_error = None
            except Exception as e:  # noqa: BLE001
                self.last_error = str(e)
                log.warning(json.dumps({"event": "arc_worker_error", "error": str(e)}))
            self._stop.wait(POLL_S)
