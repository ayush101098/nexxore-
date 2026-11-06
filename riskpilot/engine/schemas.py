"""Validators for the shared schemas. The engine keeps no private copies."""

import json
from functools import cache
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

SCHEMA_DIR = Path(__file__).resolve().parents[1] / "shared" / "schemas"


@cache
def _registry() -> Registry:
    resources = []
    for path in SCHEMA_DIR.glob("*.schema.json"):
        resource = Resource.from_contents(json.loads(path.read_text()))
        resources += [(resource.contents["$id"], resource), (path.name, resource)]
    return Registry().with_resources(resources)


@cache
def validator(name: str) -> Draft202012Validator:
    schema = json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text())
    return Draft202012Validator(schema, registry=_registry())


def validate(name: str, obj) -> None:
    """Raise jsonschema.ValidationError if obj does not match shared/schemas/<name>."""
    validator(name).validate(obj)
