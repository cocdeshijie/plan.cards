#!/usr/bin/env python3
"""Rebuild card art from the MaxRewards CDN, recorded in maxrewards_sources.json.

MaxRewards re-hosts issuer card faces on a public CloudFront CDN, keyed by a
human-readable slug that its sitemap enumerates:

    https://www.maxrewards.com/sitemap.xml            -> /credit-cards/<slug>
    https://d1f8ie53h08h9n.cloudfront.net/<slug>/lg.webp   (~900px, no auth)

Unlike the bare Apple/Google wallet faces, this is *marketing* art: many cards
carry a specimen name or a promo badge, so the set committed to the repo was
picked by eye (see tools/card-art-review.html). This script reproduces that
committed art from the recorded slugs: download the webp, trim its border,
convert to PNG, and write card_templates/<issuer>/<slug>/card.png.

`source_sha1` in the registry is the sha1 of the CDN webp, so `verify` flags
when MaxRewards changes a card's art upstream.

Requires Pillow (the wallet tool is stdlib-only; this one is not):
    python3 -m pip install Pillow

    python3 tools/maxrewards_ingest.py verify          # check every recorded slug vs the CDN
    python3 tools/maxrewards_ingest.py fetch            # rebuild art for templates that lack it
    python3 tools/maxrewards_ingest.py fetch --force    # rebuild all, overwriting
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REGISTRY = REPO / "tools" / "maxrewards_sources.json"
TEMPLATES = REPO / "card_templates"
CDN = "https://d1f8ie53h08h9n.cloudfront.net/{slug}/lg.webp"


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(1)


def load() -> dict:
    if not REGISTRY.is_file():
        die(f"missing {REGISTRY}")
    return json.loads(REGISTRY.read_text())


def get(slug: str, timeout: int = 20) -> bytes:
    url = CDN.format(slug=slug)
    req = urllib.request.Request(url, headers={"User-Agent": "plan.cards-art/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def trim(im):
    """Crop a uniform (transparent or solid-colour) border off the card."""
    from PIL import Image, ImageChops
    im = im.convert("RGBA")
    alpha = im.split()[3]
    bbox = alpha.getbbox() if alpha.getextrema()[0] < 250 else None
    if bbox is None:
        rgb = im.convert("RGB")
        bg = Image.new("RGB", rgb.size, rgb.getpixel((0, 0)))
        diff = ImageChops.difference(rgb, bg).convert("L")
        bbox = diff.point(lambda p: 255 if p > 14 else 0).getbbox()
    if bbox:
        w, h = im.size
        x0, y0, x1, y1 = bbox
        if (x1 - x0) >= w * 0.3 and (y1 - y0) >= h * 0.3:
            im = im.crop(bbox)
    return im


def cmd_fetch(args) -> int:
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        die("Pillow is required: python3 -m pip install Pillow")
    from PIL import Image

    reg = load()
    ok = skipped = failed = 0
    for tid, meta in sorted(reg["cards"].items()):
        if args.id and tid != args.id:
            continue
        card_dir = TEMPLATES / tid
        if not card_dir.is_dir():
            print(f"?? {tid}: no such template")
            failed += 1
            continue
        dest = card_dir / "card.png"
        if dest.exists() and not args.force:
            skipped += 1
            continue
        try:
            data = get(meta["slug"])
        except Exception as exc:
            print(f"!! {tid}: {exc}")
            failed += 1
            continue
        got = hashlib.sha1(data).hexdigest()
        if meta.get("source_sha1") and got != meta["source_sha1"]:
            print(f"~~ {tid}: upstream art changed ({meta['source_sha1'][:8]} -> {got[:8]}); "
                  f"{'rebuilding anyway' if args.force else 'skipping, re-review then --force'}")
            if not args.force:
                failed += 1
                continue
        im = trim(Image.open(io.BytesIO(data)))
        if args.dry_run:
            print(f"ok {tid}: {im.size[0]}x{im.size[1]} (dry run)")
        else:
            im.save(dest)
            print(f"ok {tid}: {im.size[0]}x{im.size[1]} -> {dest.relative_to(REPO)}")
        ok += 1
    print(f"\n{ok} built, {failed} failed, {skipped} skipped")
    return 1 if failed else 0


def cmd_verify(args) -> int:
    reg = load()
    stale = 0
    for tid, meta in sorted(reg["cards"].items()):
        try:
            data = get(meta["slug"])
        except Exception as exc:
            print(f"!! {tid} {meta['slug']}: {exc}")
            stale += 1
            continue
        got = hashlib.sha1(data).hexdigest()
        if got == meta.get("source_sha1"):
            print(f"ok {tid} {meta['slug']}")
        else:
            print(f"~~ {tid} {meta['slug']}: art changed ({meta.get('source_sha1','')[:8]} -> {got[:8]})")
            stale += 1
    print(f"\n{stale} source(s) changed or unreachable")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("fetch", help="rebuild card.png from recorded MaxRewards slugs")
    s.add_argument("--id", help="a single template id, e.g. bilt/blue")
    s.add_argument("--force", action="store_true", help="overwrite existing art / changed upstream")
    s.add_argument("--dry-run", action="store_true", help="download and report, do not write")
    s.set_defaults(func=cmd_fetch)
    s = sub.add_parser("verify", help="re-check every recorded slug against the CDN")
    s.set_defaults(func=cmd_verify)
    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
