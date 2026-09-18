from pathlib import Path


WORKFLOW = Path(__file__).parents[2] / ".github" / "workflows" / "demo-keep-alive.yml"


def test_demo_keep_alive_is_off_by_default_and_targets_only_demo_health():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "vars.DEMO_KEEP_ALIVE_ENABLED == 'true'" in text
    assert "https://flowtally-api-demo.onrender.com/api/health" in text
    assert "flowtally-demo.onrender.com" not in text
    assert "flowtally.ca" not in text
    assert "timeout-minutes: 3" in text
    assert "--max-time 90" in text
    assert "--retry 1" in text


def test_manual_warm_up_cannot_enable_recurring_schedule():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "inputs.action == 'warm-up'" in text
    assert "did not enable recurring keep-alive" in text
    assert "schedule" in text
