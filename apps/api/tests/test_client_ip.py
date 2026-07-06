"""Tests for real-client-IP resolution behind trusted proxies."""

from types import SimpleNamespace

import pytest

from apps.api.utils import client_ip
from apps.api.utils.client_ip import get_client_ip


def _req(headers: dict, host: str = "10.0.0.2"):
    return SimpleNamespace(
        headers={k.lower(): v for k, v in headers.items()},
        client=SimpleNamespace(host=host),
    )


@pytest.fixture
def trusted(monkeypatch):
    def _set(n):
        monkeypatch.setattr(client_ip.settings, "trusted_proxy_count", n)
    return _set


def test_spoofed_xff_is_ignored_with_one_proxy(trusted):
    trusted(1)
    # Client forges a leading XFF; Traefik appends the real peer at the end.
    r = _req({"X-Forwarded-For": "9.9.9.9, 203.0.113.7"})
    assert get_client_ip(r) == "203.0.113.7"


def test_single_client_behind_proxy(trusted):
    trusted(1)
    assert get_client_ip(_req({"X-Forwarded-For": "203.0.113.7"})) == "203.0.113.7"


def test_x_real_ip_wins(trusted):
    trusted(1)
    r = _req({"X-Real-Ip": "198.51.100.5", "X-Forwarded-For": "9.9.9.9"})
    assert get_client_ip(r) == "198.51.100.5"


def test_no_proxy_uses_socket_peer(trusted):
    trusted(0)
    assert get_client_ip(_req({"X-Forwarded-For": "9.9.9.9"})) == "10.0.0.2"


def test_two_proxies_take_second_from_right(trusted):
    trusted(2)
    r = _req({"X-Forwarded-For": "9.9.9.9, 203.0.113.7, 172.16.0.1"})
    assert get_client_ip(r) == "203.0.113.7"


def test_fewer_entries_than_trusted_count_clamps(trusted):
    trusted(2)
    assert get_client_ip(_req({"X-Forwarded-For": "203.0.113.7"})) == "203.0.113.7"


def test_no_headers_uses_socket_peer(trusted):
    trusted(1)
    assert get_client_ip(_req({})) == "10.0.0.2"
