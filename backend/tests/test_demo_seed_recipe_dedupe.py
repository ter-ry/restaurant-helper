from __future__ import annotations

from collections import Counter

from backend.models import Recipe


def _recipes(app):
    with app.app_context():
        return [(r.name, r.description, len(r.ingredients)) for r in Recipe.query.all()]


def test_seed_demo_creates_one_recipe_per_name_with_ingredients(app):
    result = app.test_cli_runner().invoke(args=["seed-demo"])
    assert result.exit_code == 0, result.output
    rows = _recipes(app)
    counts = Counter(name for name, _, _ in rows)
    assert all(c == 1 for c in counts.values()), counts
    assert all(n > 0 for _, _, n in rows)


def test_seed_demo_reseed_is_idempotent_and_removes_legacy_placeholders(app):
    runner = app.test_cli_runner()
    assert runner.invoke(args=["seed-demo"]).exit_code == 0
    with app.app_context():
        from backend.app import db
        real = Recipe.query.filter_by(name="Berry Parfait").first()
        db.session.add(Recipe(organization_id=real.organization_id, location_id=real.location_id, name="Berry Parfait", normalized_name="b e r r y p a r f a i t", description="Canonical demo recipe", yield_quantity=1, yield_unit="batch"))
        db.session.commit()
    before = len(_recipes(app))
    assert runner.invoke(args=["seed-demo"]).exit_code == 0
    rows = _recipes(app)
    assert len(rows) == before - 1
    assert Counter(n for n, _, _ in rows)["Berry Parfait"] == 1
    assert all(n > 0 for _, _, n in rows)


def test_seed_demo_reseed_reuses_legacy_normalized_menu_items(app):
    from backend.models import MenuItem
    runner = app.test_cli_runner()
    assert runner.invoke(args=["seed-demo"]).exit_code == 0
    with app.app_context():
        from backend.app import db
        from backend.seed import _legacy_normalize_name
        menus = MenuItem.query.all()
        assert menus
        for m in menus:
            m.normalized_name = _legacy_normalize_name(m.name)
        db.session.commit()
        before = len(menus)
    assert runner.invoke(args=["seed-demo"]).exit_code == 0
    with app.app_context():
        assert MenuItem.query.count() == before
