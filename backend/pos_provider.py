"""One active POS provider per restaurant location (owner decision 3, #167)."""
from __future__ import annotations

from .models import (
    CloverConnection,
    CloverLocationMapping,
    SquareConnection,
    SquareLocation,
    RestaurantLocation,
    SquareLocationMapping,
)
from .pos import PosProvider

_ACTIVE_STATUS = "connected"


def lock_location_for_provider_change(location_id: int, organization_id: int) -> None:
    """Serialize provider changes per restaurant location (row lock held until the caller commits).

    Both mapping endpoints take this lock before checking exclusivity and writing, so two concurrent
    Square/Clover requests cannot each observe "no other provider" (PostgreSQL; a no-op on SQLite).
    """
    RestaurantLocation.query.filter_by(id=location_id, organization_id=organization_id).with_for_update().first()


def other_active_provider(location_id: int, organization_id: int, connecting: PosProvider) -> PosProvider | None:
    """Return the *other* provider already actively mapped to this location, if any.

    "Active" = the provider's connection for this organization is ``connected`` and has a location
    mapping to this restaurant location. Disconnected / revoked connections do not block switching.
    """
    if PosProvider(connecting) != PosProvider.SQUARE:
        conflict = (
            SquareLocationMapping.query.join(SquareLocation, SquareLocation.id == SquareLocationMapping.square_location_id)
            .join(SquareConnection, SquareConnection.id == SquareLocation.square_connection_id)
            .filter(
                SquareLocationMapping.restaurant_location_id == location_id,
                SquareConnection.organization_id == organization_id,
                SquareConnection.status == _ACTIVE_STATUS,
            )
            .first()
        )
        if conflict is not None:
            return PosProvider.SQUARE
    if PosProvider(connecting) != PosProvider.CLOVER:
        conflict = (
            CloverLocationMapping.query.join(CloverConnection, CloverConnection.id == CloverLocationMapping.clover_connection_id)
            .filter(
                CloverLocationMapping.restaurant_location_id == location_id,
                CloverLocationMapping.organization_id == organization_id,
                CloverConnection.status == _ACTIVE_STATUS,
            )
            .first()
        )
        if conflict is not None:
            return PosProvider.CLOVER
    return None


def provider_conflict_message(existing: PosProvider) -> str:
    name = "Square" if existing == PosProvider.SQUARE else "Clover"
    return f"This location already uses {name} as its point-of-sale. Disconnect {name} for this location before connecting another provider."
