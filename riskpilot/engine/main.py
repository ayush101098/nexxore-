"""Entry point: uvicorn main:app (from engine/). `make up` starts it with the demo chain.

Starts the block stream (newHeads, or polling) and, when an Arc deployment is present, the
arc-worker that settles funded decisions with ARC_OPERATOR_KEY from this process's environment.
"""

import json
import logging
import os
import sys
import time

from api import create_app
from arc_worker import ArcWorker
from demo import load_arc
from store import Store


class JsonLogs(logging.Formatter):
    def format(self, record):
        msg = record.getMessage()
        try:
            body = json.loads(msg)
        except ValueError:
            body = {"msg": msg}
        return json.dumps({"t": round(record.created, 3), "level": record.levelname.lower(), "logger": record.name, **body})


handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonLogs())
logging.getLogger("riskpilot").handlers = [handler]
logging.getLogger("riskpilot").setLevel(logging.INFO)
logging.getLogger("riskpilot").propagate = False

store = Store(os.environ.get("RISKPILOT_DB", "riskpilot.db"))
arc = load_arc()
worker = None
_arc_cache: dict = {}


def arc_reader(dep: dict) -> dict:
    """Operator balance on Arc, read at most every 30 s (it is on /health)."""
    if worker is None:
        return {"up": None}
    if time.time() - _arc_cache.get("at", 0) > 30:
        _arc_cache.update(at=time.time(), body={"up": True, "operator_usdc": str(worker.operator_usdc())})
    return _arc_cache["body"]


app = create_app(store, stream=os.environ.get("RISKPILOT_STREAM", "1") != "0", arc_reader=arc_reader)

if arc is not None and os.environ.get("RISKPILOT_ARC_WORKER", "1") != "0":
    rpc = os.environ.get("ARC_RPC_URL") or os.environ.get("ARC_TESTNET_RPC_URL") or "https://rpc.testnet.arc.io"
    worker = ArcWorker(arc, rpc, store, os.environ.get("ARC_OPERATOR_KEY"), publish=app.state.hub.publish)
    app.state.arc_worker = worker

    @app.on_event("startup")
    def _start_worker():
        worker.start()
