from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import json
import os
import re
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from endfield_cards import EFCard


OUTPUT_DIR = Path("cards")

# Penting:
# Parameter "server" di endfield-py adalah komponen pertama sk-game-role.
# Untuk Global Endfield nilainya 3, sedangkan serverId akun Asia tetap 2
# dan akan dideteksi otomatis dari player binding.
ACCOUNTS = [
    {
        "slug": "muzaka",
        "display_name": "Muzaka",
        "uid": 4468761606,
        "token_env": "ENDFIELD_TOKEN_MUZAKA",
        "server": 3,
    },
    {
        "slug": "orion",
        "display_name": "Orion",
        "uid": 4896434342,
        "token_env": "ENDFIELD_TOKEN_ORION",
        "server": 3,
    },
    {
        "slug": "naskara",
        "display_name": "Naskara",
        "uid": 4367542843,
        "token_env": "ENDFIELD_TOKEN_NASKARA",
        "server": 3,
    },
]


def normalize_account_token(raw_value: str, secret_name: str) -> str:
    """
    Menerima token mentah, token URL-encoded, JSON cookie export,
    atau teks seperti account_token: "TOKEN".

    Fungsi tidak pernah mencetak nilai token.
    """
    value = (raw_value or "").replace("\ufeff", "").strip()

    if not value:
        raise ValueError(f"{secret_name} kosong.")

    # Mendukung secret yang tidak sengaja diisi JSON export cookie.
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
                (str(item) for item in candidates if item not in (None, "")),
                "",
            )
            if selected:
                value = selected.strip()
        elif isinstance(parsed, str):
            value = parsed.strip()
    except (json.JSONDecodeError, TypeError):
        pass

    # Mendukung secret yang ditempel sebagai:
    # account_token: "xxxx"
    # ACCOUNT_TOKEN = 'xxxx'
    match = re.search(
        r"(?:account_token|ACCOUNT_TOKEN|token)\s*[:=]\s*[\"'`]([^\"'`]+)[\"'`]",
        value,
    )
    if match:
        value = match.group(1).strip()

    # Hapus pembungkus kutip jika hanya token yang dikutip.
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'`":
        value = value[1:-1].strip()

    # Cookie kadang tersimpan sebagai %2B, %2F, atau %3D.
    value = unquote(value).strip()

    # Newline saat copy-paste dihapus, tetapi spasi di tengah dianggap salah.
    value = value.replace("\r", "").replace("\n", "").replace("\t", "")

    if " " in value:
        raise ValueError(
            f"{secret_name} mengandung spasi. "
            "Isi secret hanya dengan nilai ACCOUNT_TOKEN, tanpa label atau komentar."
        )

    try:
        base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError(
            f"{secret_name} bukan Base64 valid setelah dinormalisasi "
            f"(panjang {len(value)} karakter). "
            "Hapus secret lama lalu isi hanya nilai ACCOUNT_TOKEN tanpa tanda kutip."
        ) from error

    return value


def sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None

    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_image_if_changed(image: Any, target: Path) -> bool:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")

    image.save(temporary, format="PNG", optimize=True)

    old_hash = sha256_file(target)
    new_hash = sha256_file(temporary)

    if old_hash == new_hash:
        temporary.unlink(missing_ok=True)
        return False

    temporary.replace(target)
    return True


def extract_image(obj: Any) -> Any | None:
    if obj is None:
        return None

    for attr in ("img", "card", "image"):
        image = getattr(obj, attr, None)
        if image is not None:
            return image

    return None


async def retry_async(label: str, operation, attempts: int = 3, delay: int = 4):
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            return await operation()
        except Exception as error:
            last_error = error
            print(f"{label}: percobaan {attempt}/{attempts} gagal: {error}")

            if attempt < attempts:
                await asyncio.sleep(delay * attempt)

    assert last_error is not None
    raise last_error


async def generate_account_cards(
    ef_card: EFCard,
    account: dict[str, Any],
) -> dict[str, Any]:
    slug = account["slug"]
    uid = int(account["uid"])
    server = int(account["server"])
    secret_name = account["token_env"]
    account_dir = OUTPUT_DIR / slug
    account_dir.mkdir(parents=True, exist_ok=True)

    result: dict[str, Any] = {
        "display_name": account["display_name"],
        "uid": str(uid),
        "server_name": "Asia",
        "profile": False,
        "live": False,
        "profile_changed": False,
        "live_changed": False,
        "errors": [],
    }

    print(f"\n=== {account['display_name']} / UID {uid} / GLOBAL CODE {server} ===")

    # PROFILE CARD
    try:
        async def build_profile():
            profile = await ef_card.get_profile_card(uid)
            image = extract_image(profile)

            if image is None:
                raise RuntimeError("Profile Card tidak menghasilkan gambar.")

            return image

        profile_image = await retry_async(
            "Profile Card",
            build_profile,
            attempts=3,
            delay=5,
        )

        result["profile_changed"] = save_image_if_changed(
            profile_image,
            account_dir / "profile.png",
        )
        result["profile"] = True
        print("Profile Card: OK")
    except Exception as error:
        message = f"Profile Card gagal: {error}"
        result["errors"].append(message)
        print(message)
        traceback.print_exc()

    # LIVE STATS CARD
    try:
        token = normalize_account_token(
            os.getenv(secret_name, ""),
            secret_name,
        )

        async def build_live():
            live_stats = await ef_card.get_live_stats_card(
                uid,
                token,
                server=server,
            )
            image = extract_image(live_stats)

            if image is None:
                raise RuntimeError(
                    "Live Stats kosong. Periksa token, player binding, dan region akun."
                )

            return image

        live_image = await retry_async(
            "Live Stats",
            build_live,
            attempts=2,
            delay=6,
        )

        result["live_changed"] = save_image_if_changed(
            live_image,
            account_dir / "live.png",
        )
        result["live"] = True
        print("Live Stats Card: OK")
    except Exception as error:
        message = f"Live Stats Card gagal: {error}"
        result["errors"].append(message)
        print(message)
        traceback.print_exc()

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


async def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    results: dict[str, Any] = {}
    generated_any = False

    # local_cache HARUS True.
    # endfield-cards 1.0.10 memiliki bug variabel "key" jika local_cache=False.
    async with EFCard(
        debug=True,
        cache_assets=True,
        local_cache=True,
    ) as ef_card:
        print("Updating Endfield asset metadata...")

        try:
            # Memperbarui avatar_icon dan metadata lain sebelum membuat profile.
            await ef_card.ef.update_assets()
            print("Endfield asset metadata: UPDATED")
        except Exception as error:
            # Jangan langsung hentikan workflow; fallback ke metadata bawaan package.
            print(f"Asset metadata update gagal, memakai data bawaan: {error}")

        for index, account in enumerate(ACCOUNTS):
            result = await generate_account_cards(ef_card, account)
            results[account["slug"]] = result

            if result["profile"] or result["live"]:
                generated_any = True

            if index < len(ACCOUNTS) - 1:
                await asyncio.sleep(5)

    status = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "accounts": results,
    }

    (OUTPUT_DIR / "status.json").write_text(
        json.dumps(status, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if not generated_any:
        print("Tidak ada card yang berhasil dibuat.")
        return 1

    print("\nCard generation finished.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
