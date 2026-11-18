from __future__ import annotations

from decimal import Decimal

from backend.extensions import db
from backend.models import InventoryItem, MenuItem, Recipe


def _seed(app):
    result = app.test_cli_runner().invoke(args=["seed-demo"])
    assert result.exit_code == 0, result.output


def test_demo_seed_creates_each_recipe_once_with_ingredients(app):
    _seed(app)
    _seed(app)  # idempotent
    with app.app_context():
        recipes = Recipe.query.all()
        names = [r.name for r in recipes]
        assert len(names) == len(set(names)), names
        assert all(r.ingredients for r in recipes)
        assert all(r.description != "Canonical demo recipe" for r in recipes)
        assert all(r.normalized_name == r.name.lower() for r in recipes)
        assert MenuItem.query.filter(MenuItem.recipe_id.isnot(None)).count() >= 6


def test_reseed_removes_legacy_placeholder_duplicates_and_heals_names(app):
    _seed(app)
    with app.app_context():
        # Recreate the legacy state: spaced-out normalized names on real rows,
        # plus an empty placeholder with the clean normalized name.
        real = Recipe.query.filter_by(name="Harbour Burger").one()
        real.normalized_name = " ".join("harbour burger".replace(" ", ""))
        db.session.add(Recipe(organization_id=real.organization_id, location_id=real.location_id, name="Harbour Burger", normalized_name="harbour burger", description="Canonical demo recipe", yield_quantity=Decimal("1"), yield_unit="batch"))
        db.session.commit()
        real_id = real.id
        assert Recipe.query.filter_by(name="Harbour Burger").count() == 2
    _seed(app)
    with app.app_context():
        burgers = Recipe.query.filter_by(name="Harbour Burger").all()
        assert [r.id for r in burgers] == [real_id]
        assert burgers[0].normalized_name == "harbour burger"
        assert burgers[0].ingredients
        assert MenuItem.query.filter_by(recipe_id=real_id).count() >= 1


def test_reseed_keeps_inventory_items_unique(app):
    _seed(app)
    _seed(app)
    with app.app_context():
        names = [i.name for i in InventoryItem.query.all()]
        assert len(names) == len(set(names))


def test_reseed_prefers_canonical_menu_item_when_legacy_row_also_exists(app):
    _seed(app)
    with app.app_context():
        legacy = MenuItem.query.filter_by(name="Iced Latte").one()
        legacy.normalized_name = "i c e d l a t t e"
        db.session.add(MenuItem(organization_id=legacy.organization_id, location_id=legacy.location_id, name="Iced Latte", normalized_name="iced latte", category="Coffee", selling_price=Decimal("5.50")))
        db.session.commit()
    _seed(app)  # must not hit the unique constraint
    with app.app_context():
        rows = MenuItem.query.filter_by(name="Iced Latte").all()
        assert len(rows) == 2
        assert sorted(r.normalized_name for r in rows) == ["i c e d l a t t e", "iced latte"]
