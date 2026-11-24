from __future__ import annotations

from backend.models import SquareConnection


def test_demo_square_connection_has_no_error_state(app):
    for _ in range(2):  # also covers reseed of an existing demo
        result = app.test_cli_runner().invoke(args=["seed-demo"])
        assert result.exit_code == 0, result.output
    with app.app_context():
        connection = SquareConnection.query.one()
        assert connection.environment == "demo"
        assert connection.status == "connected"
        assert connection.sync_status == "demo"
        # A populated sync_error makes the Square page say "Temporarily unavailable".
        assert not connection.sync_error
