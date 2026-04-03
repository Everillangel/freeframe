"""Tests for share link password session management."""
import pytest
from unittest.mock import MagicMock, patch


class TestShareSession:
    """Tests for Redis-backed share sessions."""

    @patch("apps.api.services.redis_service.get_redis")
    def test_create_share_session(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        from apps.api.services.redis_service import create_share_session

        create_share_session("abc123token", "session-id-456")

        mock_redis.setex.assert_called_once_with(
            "share_session:abc123token:session-id-456",
            3600,
            "1",
        )

    @patch("apps.api.services.redis_service.get_redis")
    def test_verify_share_session_valid(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_redis.exists.return_value = 1
        mock_get_redis.return_value = mock_redis

        from apps.api.services.redis_service import verify_share_session

        result = verify_share_session("abc123token", "session-id-456")

        assert result is True
        mock_redis.exists.assert_called_once_with(
            "share_session:abc123token:session-id-456"
        )

    @patch("apps.api.services.redis_service.get_redis")
    def test_verify_share_session_invalid(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_redis.exists.return_value = 0
        mock_get_redis.return_value = mock_redis

        from apps.api.services.redis_service import verify_share_session

        result = verify_share_session("abc123token", "bad-session")

        assert result is False
