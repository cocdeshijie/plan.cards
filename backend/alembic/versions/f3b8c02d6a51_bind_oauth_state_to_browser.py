"""bind oauth state to the initiating browser

`state` was a server-global random token with no binding to any user agent, and
GET /api/auth/oauth/{provider}/authorize is unauthenticated in OAuth mode — so
anyone could mint a valid one. That makes the CSRF defence `state` exists to
provide non-functional: an attacker completes the provider flow with their own
account, captures ?code=&state=, and delivers that callback URL to a victim.
The victim's browser is then signed into the ATTACKER's account, and enters
their financial data there. Worse, if the victim had previously started (and
abandoned) an account-link flow, the stale oauth_flow_type in localStorage
routes the same URL to the link endpoint instead, permanently binding the
attacker's provider identity to the victim's account.

Storing the SHA-256 of a nonce held in an HttpOnly cookie ties each state to the
one browser that started the flow.

Revision ID: f3b8c02d6a51
Revises: e7c1f45b9d28
Create Date: 2026-08-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3b8c02d6a51'
down_revision: Union[str, None] = 'e7c1f45b9d28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("oauth_states") as batch_op:
        batch_op.add_column(sa.Column("browser_nonce_hash", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("provider", sa.String(length=50), nullable=True))

    # In-flight flows predate the binding and can never satisfy it. They are
    # short-lived (10 min) and cheap to restart, so clear them rather than
    # leaving states that will fail validation.
    op.execute("DELETE FROM oauth_states")


def downgrade() -> None:
    with op.batch_alter_table("oauth_states") as batch_op:
        batch_op.drop_column("provider")
        batch_op.drop_column("browser_nonce_hash")
