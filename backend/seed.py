from __future__ import annotations

from dataclasses import dataclass

from .extensions import db
from .models import Organization, OrganizationMembership, RestaurantLocation, User


LOCAL_OWNER_EMAIL = "owner@flowtally.local"
LOCAL_OWNER_PASSWORD = "PilotOwner123!"
LOCAL_MANAGER_EMAIL = "manager@flowtally.local"
LOCAL_MANAGER_PASSWORD = "PilotManager123!"
LOCAL_ORGANIZATION_NAME = "Flowtally Pilot Restaurant"
LOCAL_LOCATION_NAME = "Flowtally Pilot Kitchen"


@dataclass(slots=True)
class SeedResult:
    organization_id: int
    owner_id: int
    manager_id: int
    location_id: int


def _upsert_user(*, email: str, password: str, is_active: bool = True) -> User:
    user = User.query.filter_by(email=email).first()
    if user is None:
        user = User(email=email, is_active=is_active)
        db.session.add(user)
    else:
        user.is_active = is_active
    user.set_password(password)
    return user


def _upsert_organization() -> Organization:
    organization = Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).first()
    if organization is None:
        organization = Organization(name=LOCAL_ORGANIZATION_NAME)
        db.session.add(organization)
    return organization


def _upsert_membership(user: User, organization: Organization, role: str) -> OrganizationMembership:
    membership = OrganizationMembership.query.filter_by(user_id=user.id, organization_id=organization.id).first()
    if membership is None:
        membership = OrganizationMembership(user=user, organization=organization, role=role)
        db.session.add(membership)
    else:
        membership.role = role
    return membership


def _upsert_location(organization: Organization) -> RestaurantLocation:
    location = RestaurantLocation.query.filter_by(organization_id=organization.id, name=LOCAL_LOCATION_NAME).first()
    if location is None:
        location = RestaurantLocation(
            organization=organization,
            name=LOCAL_LOCATION_NAME,
            address_line1="123 Queen St W",
            address_line2="Suite 400",
            city="Toronto",
            region="ON",
            postal_code="M5H 2M9",
            country="Canada",
            timezone="America/Toronto",
        )
        db.session.add(location)
    return location


def seed_pilot_data(*, reset: bool = False) -> SeedResult:
    if reset:
        for membership in OrganizationMembership.query.join(User).filter(User.email.in_([LOCAL_OWNER_EMAIL, LOCAL_MANAGER_EMAIL])).all():
            db.session.delete(membership)
        for user in User.query.filter(User.email.in_([LOCAL_OWNER_EMAIL, LOCAL_MANAGER_EMAIL])).all():
            db.session.delete(user)
        for location in RestaurantLocation.query.filter_by(name=LOCAL_LOCATION_NAME).all():
            db.session.delete(location)
        for organization in Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).all():
            db.session.delete(organization)
        db.session.flush()

    organization = _upsert_organization()
    db.session.flush()

    owner = _upsert_user(email=LOCAL_OWNER_EMAIL, password=LOCAL_OWNER_PASSWORD, is_active=True)
    manager = _upsert_user(email=LOCAL_MANAGER_EMAIL, password=LOCAL_MANAGER_PASSWORD, is_active=True)
    db.session.flush()

    _upsert_membership(owner, organization, "owner")
    _upsert_membership(manager, organization, "manager")
    location = _upsert_location(organization)

    db.session.commit()
    return SeedResult(organization_id=organization.id, owner_id=owner.id, manager_id=manager.id, location_id=location.id)
