"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Application also calls Base.metadata.create_all on startup for the prototype.
    # Production should run: alembic upgrade head against PostgreSQL.
    pass


def downgrade() -> None:
    pass
