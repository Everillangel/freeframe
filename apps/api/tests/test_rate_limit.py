"""Tests for rate limiting functionality."""
import pytest
from unittest.mock import MagicMock, patch


class TestCheckRateLimit:
    """Tests for the Redis-based rate limit checker."""

    @patch("apps.api.services.redis_service.get_redis")
    def test_allows_request_under_limit(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_redis.get.return_value = None
        mock_pipe = MagicMock()
        mock_redis.pipeline.return_value = mock_pipe
        mock_get_redis.return_value = mock_redis

        from apps.api.services.redis_service import check_rate_limit

        allowed, retry_after = check_rate_limit("127.0.0.1", "test_action", 5, 60)

        assert allowed is True
        assert retry_after == 0
        mock_pipe.incr.assert_called_once()
        mock_pipe.expire.assert_called_once()
        mock_pipe.execute.assert_called_once()

    @patch("apps.api.services.redis_service.get_redis")
    def test_blocks_request_at_limit(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_redis.get.return_value = "5"
        mock_redis.ttl.return_value = 42
        mock_get_redis.return_value = mock_redis

        from apps.api.services.redis_service import check_rate_limit

        allowed, retry_after = check_rate_limit("127.0.0.1", "test_action", 5, 60)

        assert allowed is False
        assert retry_after == 42

    @patch("apps.api.services.redis_service.get_redis")
    def test_allows_request_below_limit(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_redis.get.return_value = "3"
        mock_pipe = MagicMock()
        mock_redis.pipeline.return_value = mock_pipe
        mock_get_redis.return_value = mock_redis

        from apps.api.services.redis_service import check_rate_limit

        allowed, retry_after = check_rate_limit("127.0.0.1", "test_action", 5, 60)

        assert allowed is True
        assert retry_after == 0

    @patch("apps.api.services.redis_service.get_redis")
    def test_retry_after_minimum_is_one(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_redis.get.return_value = "10"
        mock_redis.ttl.return_value = -1
        mock_get_redis.return_value = mock_redis

        from apps.api.services.redis_service import check_rate_limit

        allowed, retry_after = check_rate_limit("127.0.0.1", "test_action", 10, 60)

        assert allowed is False
        assert retry_after == 1


class TestRateLimitDependency:
    """Tests for the FastAPI rate_limit dependency."""

    @patch("apps.api.middleware.rate_limit.check_rate_limit")
    def test_allows_when_under_limit(self, mock_check):
        mock_check.return_value = (True, 0)
        mock_request = MagicMock()
        mock_request.headers.get.return_value = "10.0.0.1"

        from apps.api.middleware.rate_limit import rate_limit

        dep = rate_limit("test", 5, 60)
        dep(mock_request)  # Should not raise

        mock_check.assert_called_once_with("10.0.0.1", "test", 5, 60)

    @patch("apps.api.middleware.rate_limit.check_rate_limit")
    def test_raises_429_when_over_limit(self, mock_check):
        mock_check.return_value = (False, 30)
        mock_request = MagicMock()
        mock_request.headers.get.return_value = "10.0.0.1"

        from apps.api.middleware.rate_limit import rate_limit

        dep = rate_limit("test", 5, 60)
        with pytest.raises(Exception) as exc_info:
            dep(mock_request)
        assert exc_info.value.status_code == 429

    @patch("apps.api.middleware.rate_limit.check_rate_limit")
    def test_falls_back_to_client_host(self, mock_check):
        mock_check.return_value = (True, 0)
        mock_request = MagicMock()
        mock_request.headers.get.return_value = None
        mock_request.client.host = "192.168.1.1"

        from apps.api.middleware.rate_limit import rate_limit

        dep = rate_limit("test", 5, 60)
        dep(mock_request)

        mock_check.assert_called_once_with("192.168.1.1", "test", 5, 60)
