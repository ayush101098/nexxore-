"""One TLS context for outbound HTTPS (Arc RPC, 0G). The python.org build ships no CA bundle, so
urllib fails with CERTIFICATE_VERIFY_FAILED unless it is given certifi's."""

import ssl

try:
    import certifi

    CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # pragma: no cover - system Pythons usually have their own store
    CONTEXT = ssl.create_default_context()

# Some RPC gateways (Arc's public RPC included) reject Python-urllib's default User-Agent with 403.
USER_AGENT = "riskpilot-engine/0.1 (+https://nexxore.xyz/riskpilot)"
