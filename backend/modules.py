from __future__ import annotations

from typing import Any


MODULE_REGISTRY: dict[str, dict[str, Any]] = {
    "PURCHASES": {
        "key": "PURCHASES",
        "displayName": "Purchasing",
        "description": "Supplier invoices, receipts, and purchase control.",
        "backendReady": True,
        "dependencies": [],
        "dashboardWidgets": ["recent_purchases", "invoice_alerts"],
        "requiredSetupTasks": ["supplier_import", "invoice_workflow"],
        "requiredPermissions": ["purchases.manage"],
    },
    "INVENTORY": {
        "key": "INVENTORY",
        "displayName": "Inventory",
        "description": "Inventory items, usage, adjustments, and stock status.",
        "backendReady": True,
        "dependencies": ["PURCHASES"],
        "dashboardWidgets": ["inventory_alerts", "usage_summary"],
        "requiredSetupTasks": ["inventory_seed"],
        "requiredPermissions": ["inventory.manage"],
    },
    "STOCK_COUNTS": {
        "key": "STOCK_COUNTS",
        "displayName": "Stock Counts",
        "description": "Count sessions and variance tracking.",
        "backendReady": True,
        "dependencies": ["INVENTORY"],
        "dashboardWidgets": ["count_status"],
        "requiredSetupTasks": ["count_process"],
        "requiredPermissions": ["stock_counts.manage"],
    },
    "REORDER_PLANS": {
        "key": "REORDER_PLANS",
        "displayName": "Reorder Plans",
        "description": "Guided order planning from current inventory and supplier history.",
        "backendReady": True,
        "dependencies": ["INVENTORY", "PURCHASES"],
        "dashboardWidgets": ["reorder_summary"],
        "requiredSetupTasks": ["preferred_supplier_mapping"],
        "requiredPermissions": ["reorder.manage"],
    },
    "MENU_COSTING": {
        "key": "MENU_COSTING",
        "displayName": "Menu Costing",
        "description": "Menu and recipe costing support.",
        "backendReady": True,
        "dependencies": ["PURCHASES", "INVENTORY"],
        "dashboardWidgets": ["menu_readiness"],
        "requiredSetupTasks": ["recipe_import"],
        "requiredPermissions": ["menu_costing.manage"],
    },
    "REPORTING": {
        "key": "REPORTING",
        "displayName": "Reporting",
        "description": "Operational reporting and summaries.",
        "backendReady": False,
        "dependencies": ["PURCHASES", "INVENTORY"],
        "dashboardWidgets": ["operational_summary"],
        "requiredSetupTasks": ["reporting_review"],
        "requiredPermissions": ["operational.read"],
    },
    "DAILY_CLOSE": {
        "key": "DAILY_CLOSE",
        "displayName": "Daily Close",
        "description": "End-of-day reporting and reconciliation.",
        "backendReady": False,
        "dependencies": ["PURCHASES"],
        "dashboardWidgets": ["daily_close"],
        "requiredSetupTasks": ["close_checklist"],
        "requiredPermissions": ["operational.read"],
    },
    "SCHEDULING": {
        "key": "SCHEDULING",
        "displayName": "Scheduling",
        "description": "Crew schedule planning and staff readiness.",
        "backendReady": False,
        "dependencies": [],
        "dashboardWidgets": ["schedule_preview"],
        "requiredSetupTasks": ["staff_setup"],
        "requiredPermissions": ["operational.read"],
    },
    "SQUARE_INTEGRATION": {
        "key": "SQUARE_INTEGRATION",
        "displayName": "Square Integration",
        "description": "Sandbox POS connection, location mapping, and sync foundations.",
        "backendReady": False,
        "dependencies": ["PURCHASES"],
        "dashboardWidgets": ["square_status"],
        "requiredSetupTasks": ["square_connect"],
        "requiredPermissions": ["organization.manage"],
    },
    "QUICKBOOKS_EXPORT": {
        "key": "QUICKBOOKS_EXPORT",
        "displayName": "QuickBooks Export",
        "description": "Accounting export support.",
        "backendReady": False,
        "dependencies": ["PURCHASES", "REPORTING"],
        "dashboardWidgets": ["export_status"],
        "requiredSetupTasks": ["accounting_mappings"],
        "requiredPermissions": ["operational.read"],
    },
}


def module_definition(module_key: str) -> dict[str, Any] | None:
    return MODULE_REGISTRY.get(module_key)


def module_dependency_keys(module_key: str) -> list[str]:
    module = module_definition(module_key)
    if module is None:
        return []
    return list(module.get("dependencies", []))
