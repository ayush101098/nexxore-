"""Validate the shared schemas, their examples, and the decision_id trace."""

import copy
import json
from decimal import Decimal
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
from referencing import Registry, Resource

SCHEMA_DIR = Path(__file__).resolve().parents[1] / "schemas"
EXAMPLE_DIR = SCHEMA_DIR / "examples"
OBJECTS = ["opportunity", "decision", "position", "execution"]


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def _registry() -> Registry:
    # Register every schema under its file name so relative $refs resolve offline.
    resources = []
    for path in SCHEMA_DIR.glob("*.schema.json"):
        schema = _load(path)
        resource = Resource.from_contents(schema)
        resources.append((schema["$id"], resource))
        resources.append((path.name, resource))
    return Registry().with_resources(resources)


REGISTRY = _registry()


def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(_load(SCHEMA_DIR / f"{name}.schema.json"), registry=REGISTRY)


def example(name: str) -> dict:
    return _load(EXAMPLE_DIR / f"{name}.example.json")


@pytest.mark.parametrize("name", OBJECTS + ["common"])
def test_schema_is_valid_draft_2020_12(name):
    Draft202012Validator.check_schema(_load(SCHEMA_DIR / f"{name}.schema.json"))


@pytest.mark.parametrize("name", OBJECTS)
def test_example_validates(name):
    validator(name).validate(example(name))


def test_decision_id_traces_opportunity_to_settlement():
    opp, dec, pos, exe = (example(n) for n in OBJECTS)
    assert dec["opportunity_id"] == opp["opportunity_id"]
    assert pos["decision_id"] == exe["decision_id"] == dec["decision_id"]
    assert exe["settlement_tx"] is not None


def test_example_net_edge_is_gross_minus_costs_minus_risk_charge():
    dec = example("decision")
    costs = sum(Decimal(v) for v in dec["costs"].values())
    expected = Decimal(dec["gross_edge"]) - costs - Decimal(dec["risk_charge"])
    assert Decimal(dec["net_edge"]) == expected


@pytest.mark.parametrize(
    "name, mutate",
    [
        ("decision", lambda d: d.update(verdict="MAYBE")),
        ("decision", lambda d: d.update(net_edge=-4.6)),  # number, not decimal string
        ("decision", lambda d: d["costs"].pop("gas")),
        ("decision", lambda d: d.update(created_at="2026-11-06 09:30:00")),  # not ISO UTC
        ("opportunity", lambda d: d.update(pair="BTC/USDC")),
        ("position", lambda d: d.update(primitive="perp")),
        ("execution", lambda d: d.update(tx_hash="0x1234")),
        ("execution", lambda d: d.update(extra="field")),
    ],
)
def test_invalid_objects_are_rejected(name, mutate):
    obj = copy.deepcopy(example(name))
    mutate(obj)
    with pytest.raises(ValidationError):
        validator(name).validate(obj)
