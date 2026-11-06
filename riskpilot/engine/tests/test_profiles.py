"""Section 2: profiles chosen once, budgets derived each block, deterministic decision ids."""

from datetime import timedelta
from decimal import Decimal

from eth_account import Account
from eth_account.messages import encode_defunct

from api import profile_message
from models import Holdings
from profiles import PROFILES, derive, get_profile
from tests.test_demo import CHAIN, MAKER, NOW, client, curves_file  # noqa: F401 - autouse: the test curves.json

HELD = dict(holdings=Holdings(weth="8", usdc="5000"), gas=Decimal("0.0875"), spot=Decimal("2218.55"))
# A fresh key for the signing tests (never an Anvil default account: those keys are public).
SIGNER = Account.create()


def seed(c, profile="moderate"):
    return c.post(f"/demo/seed?profile={profile}").json()


def item(body, label):
    return next(i["decision"] for i in body["items"] if i["label"].startswith(label))


def test_profile_table():
    rows = {n: (p.lam, p.budget_share, p.budget_cap, p.min_edge, p.k, p.aqua_margin, p.max_slippage, p.max_position_share)
            for n, p in PROFILES.items()}
    D = Decimal
    assert rows == {
        "conservative": (D("1.0"), D("0.01"), D("150"), D("10"), D("3"), D("0.5"), D("0.003"), D("0.1")),
        "moderate": (D("0.5"), D("0.025"), D("250"), D("5"), D("2"), D("0.2"), D("0.005"), D("0.25")),
        "aggressive": (D("0.25"), D("0.05"), D("500"), D("3"), D("1.5"), D("0.1"), D("0.01"), D("0.5")),
    }
    assert get_profile("balanced") is PROFILES["moderate"]


def test_moderate_budget_is_the_250_cap_and_put_like_stays_rejected():
    body = seed(client(**HELD))
    put = item(body, "Put-like")
    assert put["budget"] == "250.00"
    assert put["inputs"]["profile"]["budget_bound"] == "cap"
    assert put["verdict"] == "REJECT"
    assert put["reason"].startswith("Rejected: adds $629.93 worst-case loss; limit $250 (")
    assert body["profile"]["profile"] == "moderate" and body["profile"]["budget"] == "250.00"


def test_conservative_budget_is_the_150_cap():
    d = item(seed(client(**HELD), "conservative"), "Put-like")
    assert d["budget"] == "150.00" and d["inputs"]["profile"]["budget_bound"] == "cap"


def test_small_wallet_budget_is_the_share():
    d = derive(PROFILES["moderate"], Decimal("2000"))
    assert (d["budget"], d["budget_bound"], d["max_position"]) == ("50.00", "share", "500.00")


def test_slippage_and_gas_ceiling():
    d = derive(PROFILES["moderate"], Decimal("100000"), impact=Decimal("0.0012"), base_fee_gwei=Decimal("10"), tip_gwei=Decimal("1"))
    assert d["slippage_tolerance"] == "0.001700"  # impact + 5 bp, under the 0.50% max
    assert (d["gas_ceiling_gwei"], d["tip_gwei"]) == ("21.000000000", "1.000000000")  # 2 x base fee + tip
    assert derive(PROFILES["conservative"], None, impact=Decimal("0.01"))["slippage_tolerance"] == "0.003000"
    # A near-zero base fee (empty blocks on the demo chain) stays fixed-point, never 6.56E-7.
    tiny = derive(PROFILES["moderate"], None, base_fee_gwei=Decimal("0.000000283"), tip_gwei=Decimal("0.00000009"))
    assert (tiny["gas_ceiling_gwei"], tiny["tip_gwei"]) == ("0.000000656", "0.000000090")


def test_seed_needs_a_signed_profile():
    c = client(**HELD)
    W = SIGNER.address
    assert c.get(f"/profile?wallet={W}").json()["profile"] is None
    r = c.post(f"/demo/seed?wallet={W}")
    assert r.status_code == 409 and r.json()["detail"]["needs_profile"] is True
    set_at = "2026-11-06T14:00:00Z"
    sig = Account.sign_message(encode_defunct(text=profile_message(W, "conservative", set_at)), SIGNER.key).signature.hex()
    bad = c.put("/profile", json={"wallet": W, "profile": "aggressive", "set_at": set_at, "signature": "0x" + sig})
    assert bad.status_code == 401  # signed conservative, asked for aggressive
    ok = c.put("/profile", json={"wallet": W, "profile": "conservative", "set_at": set_at, "signature": "0x" + sig}).json()
    assert ok["profile"] == "conservative" and ok["previous"] is None and ok["source"] == "EIP-191 signature"
    assert c.get(f"/profile?wallet={W}").json()["profile"] == "conservative"
    body = c.post(f"/demo/seed?wallet={W}").json()
    assert {i["decision"]["inputs"]["profile"]["name"] for i in body["items"]} == {"conservative"}


def test_balanced_is_an_alias_for_moderate():
    assert item(seed(client(**HELD), "balanced"), "Put-like")["inputs"]["profile"]["name"] == "moderate"


def test_ids_are_hash_of_inputs_block_and_version():
    first = [i["decision"]["decision_id"] for i in seed(client(**HELD))["items"]]
    later = [i["decision"]["decision_id"] for i in seed(client(**HELD, clock=lambda: NOW + timedelta(minutes=7)))["items"]]
    assert first == later  # same block, same inputs: same ids, whenever it runs
    moved = [i["decision"]["decision_id"] for i in seed(client(**HELD, chain={**CHAIN, "block": CHAIN["block"] + 1}))["items"]]
    assert not set(first) & set(moved)  # a new block gives new ids


def test_replay_of_a_profiled_decision_is_identical():
    c = client(**HELD)
    for it in seed(c)["items"]:
        r = c.post(f"/decisions/{it['decision']['decision_id']}/replay").json()
        assert r["matches"], it["label"]
