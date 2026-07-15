from __future__ import annotations

from datetime import datetime, timezone

from flask_login import UserMixin
from sqlalchemy import CheckConstraint, UniqueConstraint
from werkzeug.security import check_password_hash, generate_password_hash

from .extensions import db


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)


class User(UserMixin, TimestampMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(254), nullable=False, unique=True, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    memberships = db.relationship("OrganizationMembership", back_populates="user", cascade="all, delete-orphan")

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def get_id(self) -> str:
        return str(self.id)


class Organization(TimestampMixin, db.Model):
    __tablename__ = "organizations"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, unique=True, index=True)

    memberships = db.relationship("OrganizationMembership", back_populates="organization", cascade="all, delete-orphan")
    locations = db.relationship("RestaurantLocation", back_populates="organization", cascade="all, delete-orphan")


class OrganizationMembership(TimestampMixin, db.Model):
    __tablename__ = "organization_memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "organization_id", name="uq_membership_user_organization"),
        CheckConstraint("role in ('owner', 'manager')", name="ck_membership_role"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = db.Column(db.String(20), nullable=False)

    user = db.relationship("User", back_populates="memberships")
    organization = db.relationship("Organization", back_populates="memberships")


class RestaurantLocation(TimestampMixin, db.Model):
    __tablename__ = "restaurant_locations"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    address_line1 = db.Column(db.String(255), nullable=False, default="")
    address_line2 = db.Column(db.String(255), nullable=False, default="")
    city = db.Column(db.String(120), nullable=False, default="")
    region = db.Column(db.String(120), nullable=False, default="")
    postal_code = db.Column(db.String(40), nullable=False, default="")
    country = db.Column(db.String(120), nullable=False, default="Canada")
    timezone = db.Column(db.String(120), nullable=False, default="America/Toronto")

    organization = db.relationship("Organization", back_populates="locations")

