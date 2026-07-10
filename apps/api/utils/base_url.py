"""Derive the app's public base URL from the incoming request.

Lets request-scoped endpoints build self-referential links without a hardcoded
host — so the app works from any origin (localhost, a LAN/Tailscale IP, a domain)
without reconfiguration. Honours reverse-proxy headers, falling back to the
configured FRONTEND_URL (used by background workers that have no request).
"""

from starlette.requests import Request

try:
    from ..config import settings
except ImportError:  # pragma: no cover
    from config import settings


def get_public_base_url(request: Request) -> str:
    """Return scheme://host for the current request (no trailing slash)."""
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if host:
        host = host.split(",")[0].strip()
        proto = request.headers.get("x-forwarded-proto")
        if proto:
            proto = proto.split(",")[0].strip()
        else:
            proto = request.url.scheme or "http"
        return f"{proto}://{host}"
    return settings.frontend_url.rstrip("/")
