"""Entry point: uvicorn main:app --reload (from engine/)."""

import os

from api import create_app
from store import Store

app = create_app(Store(os.environ.get("RISKPILOT_DB", "riskpilot.db")))
