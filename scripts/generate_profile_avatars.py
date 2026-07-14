from __future__ import annotations

import asyncio
import hashlib
import json
import traceback
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import aiohttp
from PIL import Image, ImageDraw, ImageOps

try:
    from endfield_cards import EFCard
except ImportError:
    # Compatibility fallback if upstream package name changes.
    from ef_cards import EFCard  # type: ignore


OUTPUT_DIR = Path("assets/avatars")
MANIFEST_PATH = Path("avatar-manifest.json")

ACCOUNTS = [
    {
        "slug": "muzaka",
        "uid": 4468761606,
    },
    {
        "slug": "orion",
        "uid": 4896434342,
    },
    {
        "slug": "naskara",
        "uid": 4367542843,
    },
]

AVATAR_SIZE = 256

# Exact avatar area used by endfield-cards Profile Template 1:
# profile/template1/profile1.py composites the avatar at (57, 61)
# with size 325x325 on a 1080px-wide profile card.
PROFILE_CARD_AVATAR_BOX = (57, 61, 382, 386)


def sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None

    digest = hashlib.sha256()

    with path.open("rb") as file:
        for chunk in iter(
            lambda: file.read(1024 * 1024),
            b"",
        ):
            digest.update(chunk)

    return digest.hexdigest()


def save_png_if_changed(
    image: Image.Image,
    target: Path,
) -> tuple[bool, str]:
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    normalized = ImageOps.fit(
        image.convert("RGBA"),
        (AVATAR_SIZE, AVATAR_SIZE),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )

    temporary = target.with_suffix(".tmp.png")
    normalized.save(
        temporary,
        format="PNG",
        optimize=True,
    )

    old_hash = sha256_file(target)
    new_hash = sha256_file(temporary)

    assert new_hash is not None

    if old_hash == new_hash:
        temporary.unlink(missing_ok=True)
        return False, new_hash

    temporary.replace(target)
    return True, new_hash


def create_generic_avatar() -> Image.Image:
    image = Image.new(
        "RGBA",
        (AVATAR_SIZE, AVATAR_SIZE),
        (13, 15, 18, 255),
    )

    draw = ImageDraw.Draw(image)

    yellow = (242, 223, 0, 255)
    dim = (74, 76, 80, 255)

    draw.rectangle(
        (1, 1, AVATAR_SIZE - 2, AVATAR_SIZE - 2),
        outline=dim,
        width=3,
    )

    draw.ellipse(
        (82, 47, 174, 139),
        outline=yellow,
        width=5,
    )

    draw.arc(
        (49, 112, 207, 270),
        start=190,
        end=350,
        fill=yellow,
        width=6,
    )

    draw.line(
        (62, 70, 40, 45),
        fill=yellow,
        width=5,
    )

    draw.line(
        (194, 70, 216, 45),
        fill=yellow,
        width=5,
    )

    return image


def add_cache_buster(url: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["_endfield_refresh"] = str(int(datetime.now(timezone.utc).timestamp()))

    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urlencode(query),
            parts.fragment,
        )
    )


async def download_image(
    session: aiohttp.ClientSession,
    url: str,
) -> Image.Image:
    fresh_url = add_cache_buster(url)

    async with session.get(
        fresh_url,
        timeout=aiohttp.ClientTimeout(total=35),
        headers={
            "User-Agent":
                "Mozilla/5.0 EndfieldAvatarBot/1.0",
            "Accept":
                "image/avif,image/webp,image/png,image/jpeg,*/*",
        },
    ) as response:
        response.raise_for_status()
        payload = await response.read()

    image = Image.open(BytesIO(payload))
    image.load()
    return image.convert("RGBA")


def extract_card_image(value: Any) -> Image.Image | None:
    if isinstance(value, Image.Image):
        return value

    for attribute in ("card", "img", "image"):
        candidate = getattr(value, attribute, None)

        if isinstance(candidate, Image.Image):
            return candidate

    return None


def crop_avatar_from_profile_card(
    profile_card: Image.Image,
) -> Image.Image:
    card = profile_card.convert("RGBA")

    if card.width < 382 or card.height < 386:
        raise RuntimeError(
            "Ukuran Profile Card lebih kecil dari area avatar."
        )

    return card.crop(PROFILE_CARD_AVATAR_BOX)


async def generate_one(
    ef_card: EFCard,
    http: aiohttp.ClientSession,
    account: dict[str, Any],
) -> dict[str, Any]:
    slug = str(account["slug"])
    uid = int(account["uid"])
    target = OUTPUT_DIR / f"{slug}.png"

    result: dict[str, Any] = {
        "uid": str(uid),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "available": target.exists(),
        "source": None,
        "changed": False,
        "sha256": sha256_file(target),
        "error": None,
    }

    print(f"\n=== Avatar {slug} / UID {uid} ===")

    try:
        # Preferred path:
        # endfield-cards exposes its endfield-py client as `ef`.
        # The PlayerProfile model includes `avatar_url`.
        # endfield-py keeps Enka profile responses in memory for 300 seconds.
        # Remove this account from the cache before asking for its profile.
        try:
            ef_card.ef.enka_data_cache.cache.pop(str(uid), None)
        except Exception:
            pass

        profile = await ef_card.ef.get_profile(uid)
        avatar_url = str(
            getattr(profile, "avatar_url", "") or ""
        ).strip()

        if avatar_url:
            try:
                avatar = await download_image(
                    http,
                    avatar_url,
                )

                changed, digest = save_png_if_changed(
                    avatar,
                    target,
                )

                result.update({
                    "available": True,
                    "source": "avatar_url",
                    "avatar_url": avatar_url,
                    "changed": changed,
                    "sha256": digest,
                    "error": None,
                })

                print(
                    f"Avatar URL: OK | changed={changed}"
                )

                return result

            except Exception as download_error:
                print(
                    "Avatar URL gagal, mencoba crop Profile Card:",
                    download_error,
                )

        # Fallback path:
        # Generate a full Profile Card, then crop the exact 325x325
        # avatar area used by the renderer.
        profile_result = await ef_card.get_profile_card(uid)
        profile_card = extract_card_image(profile_result)

        if profile_card is None:
            raise RuntimeError(
                "endfield-cards tidak menghasilkan gambar Profile Card."
            )

        avatar = crop_avatar_from_profile_card(
            profile_card
        )

        changed, digest = save_png_if_changed(
            avatar,
            target,
        )

        result.update({
            "available": True,
            "source": "profile_card_crop",
            "changed": changed,
            "sha256": digest,
            "error": None,
        })

        print(
            f"Profile Card crop: OK | changed={changed}"
        )

        return result

    except Exception as error:
        traceback.print_exc()

        result["error"] = str(error)

        # Preserve the previous cached avatar if available.
        if target.exists():
            result["available"] = True
            result["source"] = "previous_cache"
            result["sha256"] = sha256_file(target)

            print(
                "Generation gagal; memakai avatar cache sebelumnya."
            )

            return result

        # First-run fallback so the UI never shows a broken image.
        generic = create_generic_avatar()
        changed, digest = save_png_if_changed(
            generic,
            target,
        )

        result.update({
            "available": True,
            "source": "generic_fallback",
            "changed": changed,
            "sha256": digest,
        })

        print(
            "Generation gagal dan belum ada cache; "
            "membuat ikon operator generik."
        )

        return result


async def main() -> int:
    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    results: dict[str, Any] = {}

    async with EFCard(
        debug=True,
        cache_assets=True,
        local_cache=True,
    ) as ef_card:
        try:
            print("Updating Endfield asset metadata...")
            await ef_card.ef.update_assets()
            print("Asset metadata: UPDATED")
        except Exception as error:
            # Continue because the bundled metadata may still work.
            print(
                "Asset metadata update gagal; "
                f"memakai cache/package metadata: {error}"
            )

        async with aiohttp.ClientSession() as http:
            for index, account in enumerate(ACCOUNTS):
                result = await generate_one(
                    ef_card,
                    http,
                    account,
                )

                results[str(account["slug"])] = result

                if index < len(ACCOUNTS) - 1:
                    await asyncio.sleep(3)

    manifest = {
        "generated_at":
            datetime.now(timezone.utc).isoformat(),
        "accounts": results,
    }

    MANIFEST_PATH.write_text(
        json.dumps(
            manifest,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("\nAvatar manifest:")
    print(
        json.dumps(
            manifest,
            ensure_ascii=False,
            indent=2,
        )
    )

    # Generic fallback ensures every account remains deployable.
    return 0


if __name__ == "__main__":
    raise SystemExit(
        asyncio.run(main())
    )
