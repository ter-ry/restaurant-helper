from __future__ import annotations

from backend.models import InventoryItem


def test_demo_seed_assigns_category_appropriate_suppliers(app):
    result = app.test_cli_runner().invoke(args=["seed-demo"])
    assert result.exit_code == 0, result.output
    with app.app_context():
        by_name = {item.name: item for item in InventoryItem.query.all()}
        expected = {
            "Tomatoes": "Northern Produce Market",
            "Sparkling Water": "GTA Beverage Supply",
            "Coffee Beans": "GTA Beverage Supply",
            "Butter": "Fresh Dairy Toronto",
            "Bacon": "Oak Valley Meat Co",
            "Mayonnaise": "Harbour Dry Goods",
        }
        for name, supplier in expected.items():
            item = by_name[name]
            assert item.preferred_supplier_name == supplier, name
            assert item.supplier_id is not None
        # Non-protein items must not all collapse onto the meat supplier.
        meat = [i for i in by_name.values() if i.preferred_supplier_name == "Oak Valley Meat Co"]
        assert all(i.category == "Protein" for i in meat)
        # Every demo item carries an average cost (no "Avg not set").
        assert all(i.average_unit_cost for i in by_name.values()), [i.name for i in by_name.values() if not i.average_unit_cost]
