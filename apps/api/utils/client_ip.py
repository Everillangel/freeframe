"""Resolve the real client IP behind a trusted reverse proxy.

Behind a proxy like Traefik, ``request.client.host`` is the proxy's IP, so every
client shares one identity and IP-based rate limits collapse to a single bucket.

X-Forwarded-For is a comma-separated list that each proxy *appends* the peer it
received the request from. With N trusted proxies in front of the API, the real
client is the Nth entry counted from the right — entries further left were
supplied by the (untrusted) client and must not be honoured. This makes the
lookup spoof-resistant as long as ``trusted_proxy_count`` matches the deployment.
"""

from starlette.requests import Request

try:
    from ..config import settings
except ImportError:  # pragma: no cover - fallback for non-package execution
    from config import settings


def get_client_ip(request: Request) -> str:
    """Return the best-effort real client IP for rate limiting."""
    # An explicit X-Real-Ip from a trusted proxy wins if present.
    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()

    trusted = getattr(settings, "trusted_proxy_count", 1)
    if trusted and trusted > 0:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            if parts:
                # Count `trusted` hops from the right, clamped to the list start.
                idx = len(parts) - trusted
                if idx < 0:
                    idx = 0
                return parts[idx]

    return request.client.host if request.client else "unknown"
