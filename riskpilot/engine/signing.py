"""EIP-712 decision signatures (hardening section 5).

The engine signs RiskPilotDecision{id, wallet, inputsHash, verdict, expiresAt} with a key from
the environment (RISKPILOT_ENGINE_KEY). Without one it makes an ephemeral key at start-up and
says so in /health: signatures then only verify for this process's lifetime.
build() refuses a decision whose signature does not verify against the engine's address.
"""

import hashlib
import json
import os
from datetime import datetime

from eth_account import Account
from eth_account.messages import encode_typed_data

DOMAIN = {"name": "RiskPilot", "version": "1"}
TYPES = {
    "RiskPilotDecision": [
        {"name": "id", "type": "string"},
        {"name": "wallet", "type": "address"},
        {"name": "inputsHash", "type": "bytes32"},
        {"name": "verdict", "type": "string"},
        {"name": "expiresAt", "type": "uint256"},
    ]
}
ZERO = "0x0000000000000000000000000000000000000000"


class EngineKey:
    def __init__(self, key: str | None = None):
        key = key or os.environ.get("RISKPILOT_ENGINE_KEY")
        self.ephemeral = not key
        self._account = Account.from_key(key) if key else Account.create()
        self.address = self._account.address

    def sign(self, decision: dict, wallet: str | None) -> dict:
        message = typed_message(decision, wallet)
        signed = self._account.sign_message(encode_typed_data(DOMAIN, TYPES, message))
        return {"signer": self.address, "scheme": "EIP-712", "primary_type": "RiskPilotDecision", "domain": DOMAIN,
                "message": message, "signature": "0x" + signed.signature.hex().removeprefix("0x")}

    def verify(self, decision: dict) -> bool:
        sig = decision.get("signature")
        if not sig:
            return False
        try:
            message = typed_message(decision, sig["message"]["wallet"])
            if message != sig["message"]:
                return False  # the decision was changed after signing
            signer = Account.recover_message(encode_typed_data(DOMAIN, TYPES, message), signature=sig["signature"])
        except Exception:  # noqa: BLE001 - a malformed signature does not verify
            return False
        return signer == self.address


def inputs_hash(decision: dict) -> str:
    body = json.dumps(decision["inputs"], sort_keys=True, separators=(",", ":"))
    return "0x" + hashlib.sha256(body.encode()).hexdigest()


def typed_message(decision: dict, wallet: str | None) -> dict:
    return {
        "id": decision["decision_id"],
        "wallet": wallet or ZERO,
        "inputsHash": inputs_hash(decision),
        "verdict": decision["verdict"],
        "expiresAt": int(datetime.fromisoformat(decision["expires_at"]).timestamp()),
    }
