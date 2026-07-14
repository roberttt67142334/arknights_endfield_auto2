from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
import re
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from endfield import Endfield


OUTPUT_DIR = Path("data")
OUTPUT_FILE = OUTPUT_DIR / "accounts.json"

ACCOUNTS = [
    {
        "slug": "muzaka",
        "display_name": "Muzaka",
        "uid": 4468761606,
        "token_env": "ENDFIELD_TOKEN_MUZAKA",
        "server_code": 3,
        "server_name": "Asia",
    },
    {
        "slug": "orion",
        "display_name": "Orion",
        "uid": 4896434342,
        "token_env": "ENDFIELD_TOKEN_ORION",
        "server_code": 3,
        "server_name": "Asia",
    },
    {
        "slug": "naskara",
        "display_name": "Naskara",
        "uid": 4367542843,
        "token_env": "ENDFIELD_TOKEN_NASKARA",
        "server_code": 3,
        "server_name": "Asia",
    },
]


def normalize_account_token(
    raw_value: str,
    secret_name: str,
) -> str:
    value = (
        raw_value or ""
    ).replace("\ufeff", "").strip()

    if not value:
        raise ValueError(
            f"{secret_name} kosong."
        )

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
                candidates.append(
                    data.get("content")
                )

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


def load_previous_data() -> dict[str, Any]:
    if not OUTPUT_FILE.exists():
        return {
            "updated_at": None,
            "accounts": {},
        }

    try:
        return json.loads(
            OUTPUT_FILE.read_text(
                encoding="utf-8"
            )
        )
    except (
        json.JSONDecodeError,
        OSError,
    ):
        return {
            "updated_at": None,
            "accounts": {},
        }


def iso_or_none(value: Any) -> str | None:
    if value is None:
        return None

    if hasattr(value, "isoformat"):
        return value.isoformat()

    return str(value)


async def retry_async(
    label: str,
    operation,
    attempts: int = 3,
    delay: int = 4,
):
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            return await operation()
        except Exception as error:
            last_error = error

            print(
                f"{label}: percobaan "
                f"{attempt}/{attempts} gagal: "
                f"{error}"
            )

            if attempt < attempts:
                await asyncio.sleep(
                    delay * attempt
                )

    assert last_error is not None
    raise last_error


def empty_account(
    config: dict[str, Any],
) -> dict[str, Any]:
    return {
        "slug": config["slug"],
        "display_name":
            config["display_name"],
        "uid": str(config["uid"]),
        "server_name":
            config["server_name"],
        "profile": None,
        "live": None,
        "profile_available": False,
        "live_available": False,
        "profile_stale": False,
        "live_stale": False,
        "errors": [],
    }


async def fetch_account(
    client: Endfield,
    config: dict[str, Any],
    previous: dict[str, Any] | None,
) -> dict[str, Any]:
    result = empty_account(config)

    if previous:
        result["profile"] = previous.get(
            "profile"
        )
        result["live"] = previous.get(
            "live"
        )

    print(
        f"\n=== {config['display_name']} "
        f"/ UID {config['uid']} ==="
    )

    # PROFILE
    try:
        async def get_profile():
            return await client.get_profile(
                config["uid"]
            )

        profile = await retry_async(
            "Profile",
            get_profile,
            attempts=3,
            delay=4,
        )

        result["profile"] = {
            "uid": str(profile.uid),
            "name": profile.name,
            "short_id":
                str(profile.short_id),
            "signature":
                profile.signature,
            "avatar_url":
                profile.avatar_url,
            "level":
                int(profile.adventure_level),
            "exploration_level":
                int(profile.world_level),
            "operator_count":
                int(profile.char_count),
        }

        result["profile_available"] = True
        result["profile_stale"] = False
        print("Profile data: OK")

    except Exception as error:
        message = (
            f"Profile data gagal: {error}"
        )
        result["errors"].append(message)
        result["profile_available"] = (
            result["profile"] is not None
        )
        result["profile_stale"] = (
            result["profile"] is not None
        )

        print(message)
        traceback.print_exc()

    # LIVE DATA
    try:
        token = normalize_account_token(
            os.getenv(
                config["token_env"],
                "",
            ),
            config["token_env"],
        )

        async def get_live():
            return await client.get_game_stats(
                token,
                server=config["server_code"],
            )

        stats = await retry_async(
            "Live data",
            get_live,
            attempts=2,
            delay=6,
        )

        if stats is None:
            raise RuntimeError(
                "API mengembalikan live data kosong."
            )

        result["live"] = {
            "sanity": {
                "current":
                    int(
                        stats.sanity_point.current
                    ),
                "max":
                    int(
                        stats.sanity_point.max
                    ),
                "full_recover_at":
                    iso_or_none(
                        stats
                        .sanity_point
                        .full_recover_at
                    ),
            },
            "daily_activity": {
                "current":
                    int(
                        stats.daily_points.current
                    ),
                "max":
                    int(
                        stats.daily_points.max
                    ),
            },
            "weekly_routine": {
                "current":
                    int(
                        stats.weekly_points.score
                    ),
                "max":
                    int(
                        stats.weekly_points.total
                    ),
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
        print("Live data: OK")

    except Exception as error:
        message = (
            f"Live data gagal: {error}"
        )
        result["errors"].append(message)
        result["live_available"] = (
            result["live"] is not None
        )
        result["live_stale"] = (
            result["live"] is not None
        )

        print(message)
        traceback.print_exc()

    return result


async def main() -> int:
    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    previous = load_previous_data()
    previous_accounts = (
        previous.get("accounts", {})
        if isinstance(previous, dict)
        else {}
    )

    output: dict[str, Any] = {
        "updated_at":
            datetime.now(
                timezone.utc
            ).isoformat(),
        "accounts": {},
    }

    successful_sources = 0

    async with Endfield(
        debug=False,
        timeout=20,
    ) as client:
        try:
            await client.update_assets()
            print(
                "Endfield asset metadata: UPDATED"
            )
        except Exception as error:
            print(
                "Asset metadata update gagal, "
                f"melanjutkan: {error}"
            )

        for index, config in enumerate(
            ACCOUNTS
        ):
            account = await fetch_account(
                client,
                config,
                previous_accounts.get(
                    config["slug"]
                ),
            )

            output["accounts"][
                config["slug"]
            ] = account

            successful_sources += int(
                account["profile_available"]
            )
            successful_sources += int(
                account["live_available"]
            )

            if index < len(ACCOUNTS) - 1:
                await asyncio.sleep(5)

    OUTPUT_FILE.write_text(
        json.dumps(
            output,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        f"\nData dashboard tersimpan: "
        f"{OUTPUT_FILE}"
    )

    if successful_sources == 0:
        print(
            "Tidak ada sumber data yang tersedia."
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(
        asyncio.run(main())
    )
