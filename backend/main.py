from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from endfield import Endfield


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("endfield-live-api")


POLL_SECONDS = max(
    15,
    int(os.getenv("POLL_SECONDS", "30")),
)

MANUAL_REFRESH_COOLDOWN = max(
    5,
    int(os.getenv("MANUAL_REFRESH_COOLDOWN", "10")),
)

SERVER_CODE = int(os.getenv("ENDFIELD_SERVER_CODE", "3"))

ALLOWED_ORIGINS = [
    value.strip().rstrip("/")
    for value in os.getenv(
        "ALLOWED_ORIGINS",
        "https://roberttt67142334.github.io",
    ).split(",")
    if value.strip()
]

ACCOUNTS = [
    {
        "slug": "muzaka",
        "display_name": "Muzaka",
        "uid": 4468761606,
        "token_env": "ENDFIELD_TOKEN_MUZAKA",
        "server_name": "Asia",
    },
    {
        "slug": "orion",
        "display_name": "Orion",
        "uid": 4896434342,
        "token_env": "ENDFIELD_TOKEN_ORION",
        "server_name": "Asia",
    },
    {
        "slug": "naskara",
        "display_name": "Naskara",
        "uid": 4367542843,
        "token_env": "ENDFIELD_TOKEN_NASKARA",
        "server_name": "Asia",
    },
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_account_token(
    raw_value: str,
    secret_name: str,
) -> str:
    value = (
        raw_value or ""
    ).replace("\ufeff", "").strip()

    if not value:
        raise ValueError(f"{secret_name} kosong.")

    try:
        parsed = json.loads(value)

        if isinstance(parsed, dict):
            candidates = [
                parsed.get("account_token"),
                parsed.get("ACCOUNT_TOKEN"),
                parsed.get("token"),
                parsed.get("value"),
            ]

            data = parsed.get("data")
            if isinstance(data, dict):
                candidates.append(data.get("content"))

            selected = next(
                (
                    str(item)
                    for item in candidates
                    if item not in (None, "")
                ),
                "",
            )

            if selected:
                value = selected.strip()

        elif isinstance(parsed, str):
            value = parsed.strip()

    except (json.JSONDecodeError, TypeError):
        pass

    match = re.search(
        r"(?:account_token|ACCOUNT_TOKEN|token)"
        r"\s*[:=]\s*[\"'`]([^\"'`]+)[\"'`]",
        value,
    )

    if match:
        value = match.group(1).strip()

    if (
        len(value) >= 2
        and value[0] == value[-1]
        and value[0] in "\"'`"
    ):
        value = value[1:-1].strip()

    value = unquote(value).strip()
    value = (
        value
        .replace("\r", "")
        .replace("\n", "")
        .replace("\t", "")
    )

    if " " in value:
        raise ValueError(
            f"{secret_name} mengandung spasi."
        )

    try:
        base64.b64decode(
            value,
            validate=True,
        )
    except (binascii.Error, ValueError) as error:
        raise ValueError(
            f"{secret_name} bukan Base64 valid "
            f"(panjang {len(value)} karakter)."
        ) from error

    return value


def iso_or_none(value: Any) -> str | None:
    if value is None:
        return None

    if hasattr(value, "isoformat"):
        return value.isoformat()

    return str(value)


def fallback_account(
    config: dict[str, Any],
) -> dict[str, Any]:
    return {
        "slug": config["slug"],
        "display_name": config["display_name"],
        "uid": str(config["uid"]),
        "server_name": config["server_name"],
        "profile": None,
        "live": None,
        "profile_available": False,
        "live_available": False,
        "profile_stale": False,
        "live_stale": False,
        "errors": [],
    }


def public_state_hash(state: dict[str, Any]) -> str:
    comparable = deepcopy(state)
    comparable.pop("updated_at", None)
    comparable.pop("checked_at", None)
    comparable.pop("revision", None)

    raw = json.dumps(
        comparable,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")

    return hashlib.sha256(raw).hexdigest()


class LiveStateService:
    def __init__(self) -> None:
        self.state: dict[str, Any] = {
            "updated_at": None,
            "checked_at": utc_now_iso(),
            "revision": 0,
            "poll_seconds": POLL_SECONDS,
            "accounts": {
                config["slug"]:
                    fallback_account(config)
                for config in ACCOUNTS
            },
        }

        self._state_hash = public_state_hash(self.state)
        self._refresh_lock = asyncio.Lock()
        self._subscribers: set[asyncio.Queue[str]] = set()
        self._poll_task: asyncio.Task[None] | None = None
        self._last_manual_refresh = 0.0

    def snapshot(self) -> dict[str, Any]:
        return deepcopy(self.state)

    async def start(self) -> None:
        if self._poll_task is None:
            self._poll_task = asyncio.create_task(
                self._poll_loop(),
                name="endfield-poll-loop",
            )

    async def stop(self) -> None:
        if self._poll_task is None:
            return

        self._poll_task.cancel()

        try:
            await self._poll_task
        except asyncio.CancelledError:
            pass

        self._poll_task = None

    async def _poll_loop(self) -> None:
        await self.refresh(
            reason="startup",
            force_broadcast=True,
        )

        while True:
            await asyncio.sleep(POLL_SECONDS)

            try:
                await self.refresh(reason="poll")
            except Exception:
                logger.exception(
                    "Periodic refresh gagal."
                )

    async def subscribe(
        self,
    ) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(
            maxsize=5
        )
        self._subscribers.add(queue)
        return queue

    def unsubscribe(
        self,
        queue: asyncio.Queue[str],
    ) -> None:
        self._subscribers.discard(queue)

    async def broadcast(self) -> None:
        payload = json.dumps(
            self.snapshot(),
            ensure_ascii=False,
            separators=(",", ":"),
        )

        stale_queues: list[asyncio.Queue[str]] = []

        for queue in self._subscribers:
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass

            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                stale_queues.append(queue)

        for queue in stale_queues:
            self._subscribers.discard(queue)

    async def manual_refresh(self) -> dict[str, Any]:
        elapsed = (
            time.monotonic() -
            self._last_manual_refresh
        )

        if elapsed < MANUAL_REFRESH_COOLDOWN:
            remaining = int(
                MANUAL_REFRESH_COOLDOWN - elapsed
            ) + 1

            raise HTTPException(
                status_code=429,
                detail=(
                    "Refresh terlalu cepat. "
                    f"Coba lagi dalam {remaining} detik."
                ),
            )

        self._last_manual_refresh = time.monotonic()

        return await self.refresh(
            reason="manual",
            force_broadcast=True,
        )

    async def refresh(
        self,
        *,
        reason: str,
        force_broadcast: bool = False,
    ) -> dict[str, Any]:
        async with self._refresh_lock:
            previous = self.snapshot()
            new_accounts: dict[str, Any] = {}

            logger.info(
                "Mengambil data game. reason=%s",
                reason,
            )

            async with Endfield(
                debug=False,
                timeout=25,
            ) as client:
                for index, config in enumerate(ACCOUNTS):
                    old_account = (
                        previous
                        .get("accounts", {})
                        .get(config["slug"])
                    )

                    new_accounts[config["slug"]] = (
                        await self._fetch_account(
                            client,
                            config,
                            old_account,
                        )
                    )

                    if index < len(ACCOUNTS) - 1:
                        await asyncio.sleep(1)

            candidate = {
                "updated_at": utc_now_iso(),
                "checked_at": utc_now_iso(),
                "revision":
                    int(previous.get("revision", 0)) + 1,
                "poll_seconds": POLL_SECONDS,
                "accounts": new_accounts,
            }

            candidate_hash = public_state_hash(candidate)
            changed = candidate_hash != self._state_hash

            if changed:
                self.state = candidate
                self._state_hash = candidate_hash
                logger.info("Perubahan data terdeteksi.")

            else:
                self.state["checked_at"] = utc_now_iso()
                logger.info("Tidak ada perubahan data.")

            if changed or force_broadcast:
                await self.broadcast()

            return self.snapshot()

    async def _fetch_account(
        self,
        client: Endfield,
        config: dict[str, Any],
        previous: dict[str, Any] | None,
    ) -> dict[str, Any]:
        result = fallback_account(config)

        if previous:
            result["profile"] = previous.get("profile")
            result["live"] = previous.get("live")

        errors: list[str] = []

        try:
            profile = await client.get_profile(
                config["uid"]
            )

            result["profile"] = {
                "uid": str(profile.uid),
                "name": profile.name,
                "short_id": str(profile.short_id),
                "signature": profile.signature,
                "avatar_url": profile.avatar_url,
                "level": int(profile.adventure_level),
                "exploration_level":
                    int(profile.world_level),
                "operator_count":
                    int(profile.char_count),
            }

            result["profile_available"] = True
            result["profile_stale"] = False

        except Exception as error:
            logger.exception(
                "Profile %s gagal.",
                config["display_name"],
            )

            errors.append(
                f"Profile gagal: {error}"
            )

            result["profile_available"] = (
                result["profile"] is not None
            )
            result["profile_stale"] = (
                result["profile"] is not None
            )

        try:
            token = normalize_account_token(
                os.getenv(config["token_env"], ""),
                config["token_env"],
            )

            stats = await client.get_game_stats(
                token,
                server=SERVER_CODE,
            )

            if stats is None:
                raise RuntimeError(
                    "API mengembalikan Live Stats kosong."
                )

            result["live"] = {
                "sanity": {
                    "current":
                        int(stats.sanity_point.current),
                    "max":
                        int(stats.sanity_point.max),
                    "full_recover_at":
                        iso_or_none(
                            stats
                            .sanity_point
                            .full_recover_at
                        ),
                },
                "daily_activity": {
                    "current":
                        int(stats.daily_points.current),
                    "max":
                        int(stats.daily_points.max),
                },
                "weekly_routine": {
                    "current":
                        int(stats.weekly_points.score),
                    "max":
                        int(stats.weekly_points.total),
                },
                "protocol_pass": {
                    "current":
                        int(
                            stats
                            .battle_pass
                            .current_level
                        ),
                    "max":
                        int(
                            stats
                            .battle_pass
                            .max_level
                        ),
                },
            }

            result["live_available"] = True
            result["live_stale"] = False

        except Exception as error:
            logger.exception(
                "Live data %s gagal.",
                config["display_name"],
            )

            errors.append(
                f"Live data gagal: {error}"
            )

            result["live_available"] = (
                result["live"] is not None
            )
            result["live_stale"] = (
                result["live"] is not None
            )

        result["errors"] = errors
        return result


service = LiveStateService()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await service.start()

    try:
        yield
    finally:
        await service.stop()


app = FastAPI(
    title="Endfield Live API",
    version="1.0.0",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> dict[str, Any]:
    return {
        "service": "Endfield Live API",
        "status": "online",
        "poll_seconds": POLL_SECONDS,
        "subscribers": len(service._subscribers),
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "checked_at":
            service.state.get("checked_at"),
        "updated_at":
            service.state.get("updated_at"),
    }


@app.get("/api/state")
async def get_state() -> dict[str, Any]:
    return service.snapshot()


@app.post("/api/refresh")
async def refresh_state() -> dict[str, Any]:
    return await service.manual_refresh()


@app.get("/api/events")
async def events(
    request: Request,
) -> StreamingResponse:
    queue = await service.subscribe()

    async def event_generator():
        initial = json.dumps(
            service.snapshot(),
            ensure_ascii=False,
            separators=(",", ":"),
        )

        yield (
            "retry: 5000\n"
            "event: state\n"
            f"data: {initial}\n\n"
        )

        try:
            while True:
                if await request.is_disconnected():
                    break

                try:
                    payload = await asyncio.wait_for(
                        queue.get(),
                        timeout=15,
                    )

                    yield (
                        "event: state\n"
                        f"data: {payload}\n\n"
                    )

                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"

        finally:
            service.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":
                "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
