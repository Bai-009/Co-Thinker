"""Shared FastAPI dependencies."""

from __future__ import annotations

import uuid
from fastapi import Header, Response

from store import Session, store


SESSION_HEADER = "X-Session-Id"


async def get_session(
    response: Response,
    x_session_id: str | None = Header(default=None, alias=SESSION_HEADER),
) -> Session:
    """Resolve the caller's session, creating one on first contact.

    The session id is echoed back via `X-Session-Id` so the client can pin
    subsequent requests to the same conversation.
    """
    session = store.get_or_create(x_session_id or uuid.uuid4().hex)
    response.headers[SESSION_HEADER] = session.id
    return session
