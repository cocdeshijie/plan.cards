import os
import threading
import time

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

RATE_LIMIT_ENABLED = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() != "false"


def client_key(request: Request) -> str:
    """Rate-limit key for the real client, not the proxy in front of it.

    `get_remote_address` returns only `request.client.host`. In the shipped
    topology the browser calls same-origin `/api/*`, Next.js rewrites that to the
    backend container, and the backend is never published — so EVERY request
    arrives from one internal IP. That turned `10/minute` on login into a single
    global bucket: one person mistyping their password locked out the whole
    household, and any visitor could deny login to everyone with 11 requests.

    X-Forwarded-For's first hop is the originating client. Trusting it is
    reasonable here precisely because the backend is not directly reachable — the
    header can only be set by the proxy chain. If the backend port is published
    the header becomes spoofable, which is why the per-account throttle below
    carries the real brute-force protection rather than this.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        first_hop = forwarded.split(",")[0].strip()
        if first_hop:
            return first_hop
    return get_remote_address(request)


class AccountThrottle:
    """Per-account sliding-window throttle for failed logins.

    Deliberately separate from slowapi: its key function runs before the handler
    and cannot read the request body, so it can't see which account is being
    targeted. Keying on the account means one user's typos never lock out
    another, and an attacker cycling usernames from a single IP still hits a
    ceiling per account.

    In-memory and per-process, which matches how this app is deployed (one
    uvicorn worker). Counts failures only, so a legitimate user with the right
    password is never throttled.
    """

    def __init__(self, max_attempts: int = 10, window_seconds: int = 300) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._failures: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> list[float]:
        cutoff = now - self.window_seconds
        kept = [t for t in self._failures.get(key, []) if t > cutoff]
        if kept:
            self._failures[key] = kept
        else:
            self._failures.pop(key, None)
        return kept

    def is_blocked(self, identity: str) -> bool:
        if not RATE_LIMIT_ENABLED or not identity:
            return False
        key = identity.strip().lower()
        with self._lock:
            return len(self._prune(key, time.monotonic())) >= self.max_attempts

    def record_failure(self, identity: str) -> None:
        if not RATE_LIMIT_ENABLED or not identity:
            return
        key = identity.strip().lower()
        now = time.monotonic()
        with self._lock:
            attempts = self._prune(key, now)
            attempts.append(now)
            self._failures[key] = attempts
            # Bound total memory against an attacker cycling usernames. _prune
            # only touches the key being looked at, so stale entries for other
            # keys are swept here.
            if len(self._failures) > 10_000:
                cutoff = now - self.window_seconds
                self._failures = {
                    k: v for k, v in self._failures.items() if v and v[-1] > cutoff
                }

    def reset(self, identity: str) -> None:
        """Clear on a successful login."""
        if not identity:
            return
        with self._lock:
            self._failures.pop(identity.strip().lower(), None)


login_throttle = AccountThrottle()

limiter = Limiter(key_func=client_key, enabled=RATE_LIMIT_ENABLED)
