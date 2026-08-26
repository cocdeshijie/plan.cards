#!/usr/bin/env python3
"""Card art from digital wallets, and from the public CDNs they cache it on.

Two wallets cache the same clean 1536x969 card face and leak where they got it,
both onto public, unauthenticated CDNs:

* Apple Wallet stores each provisioned pass under
  ``~/Library/Passes/Cards/<id>.pkpass`` and writes a ``<image>.png.urls``
  sidecar pointing at ``https://<pod>-smp-device-asset.apple.com/broker/v1/assets/<guid>``.
* Google Pay art urls land in Chrome's autofill database
  (``Web Data`` -> ``masked_credit_cards.card_art_url``), pointing at
  ``https://www.gstatic.com/payments_api/partnerasset/cardart/<uuid>.png``.

Both wallets pull the art from the same Visa/Mastercard token pipeline, so it is
the identical clean face. Two properties make the urls useful to us:

* The host is a plain unauthenticated CDN -- no token, no client certificate.
* The id is derived from the *artwork*, not the cardholder: an id captured from
  one person's wallet keeps resolving for everyone. Three separately provisioned
  Chase cards share one Apple icon id; the same art on a different Apple pod gets
  a different id but byte-identical content.

This script reads a local wallet (``extract`` = Apple, ``chrome`` = Google),
records the urls in ``tools/wallet_art_sources.json``, and re-downloads art from
the recorded urls on a machine that never had the card (``fetch``).

Nothing here needs a card number, and the artwork carries no personal data --
the wallet draws the name and last four over it at display time. The two Google
tables that hold a real PAN are never opened.

Stdlib only.

    python3 tools/wallet_card_art.py list             # Apple Wallet contents
    python3 tools/wallet_card_art.py extract --write   # Apple  -> templates
    python3 tools/wallet_card_art.py chrome  --write   # Google -> templates
    python3 tools/wallet_card_art.py fetch --missing   # rebuild from recorded urls
    python3 tools/wallet_card_art.py verify
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import shutil
import struct
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TEMPLATES = REPO / "card_templates"
REGISTRY = REPO / "tools" / "wallet_art_sources.json"
WALLET = Path.home() / "Library" / "Passes" / "Cards"

# The art Wallet shows behind the card face. Ordered by preference.
ART_KEYS = ("cardBackgroundCombined@3x.png", "cardBackgroundCombined@2x.png")

ASSET_URL = "https://{prefix}-{pod}-smp-device-asset.apple.com/broker/v1/assets/{guid}"
# Wallet writes whichever of these its provisioning session used. They are two
# aliases onto the same Akamai property, so either resolves any id on that pod.
HOST_PREFIXES = ("nc", "pr")
URL_RE = re.compile(
    r"https://(?:nc|pr|cn|tj)-(pod\d+)-smp-device-asset\.apple\.com(?::\d+)?"
    r"/broker/v1/assets/([0-9a-f]{32})"
)

# Wallet's organizationName is the legal entity; our directories are short slugs.
ISSUER_ALIASES = {
    "american express": "amex",
    "amex": "amex",
    "chase": "chase",
    "jpmorgan chase": "chase",
    "wells fargo bank": "wellsfargo",
    "wells fargo": "wellsfargo",
    "discover": "discover",
    "discover bank": "discover",
    "apple card": "apple",
    "goldman sachs bank usa": "apple",
    "citi": "citi",
    "citibank": "citi",
    "citibank, n.a.": "citi",
    "capital one": "capitalone",
    "bank of america": "boa",
    "u.s. bank": "usbank",
    "us bank": "usbank",
    "usbank": "usbank",
    "barclays": "barclays",
    "barclays bank delaware": "barclays",
    "synchrony": "synchrony",
    "synchrony bank": "synchrony",
    "comenity": "comenity",
    "comenity bank": "comenity",
    "comenity capital bank": "comenity",
    "bread financial": "bread_financial",
    "td bank": "td_bank",
    "hsbc": "hsbc",
    "citizens": "citizens",
    "citizens bank": "citizens",
    "pnc": "pnc",
    "pnc bank": "pnc",
    "fifth third": "fifth_third",
    "fifth third bank": "fifth_third",
    "bilt": "bilt",
    "upgrade": "upgrade",
    "sofi": "sofi",
    "robinhood": "robinhood",
    "taekus": "taekus",
    "paypal": "paypal",
    "deserve": "deserve",
    "chime": "chime",
    "venmo": "venmo",
}

# Words that carry no discriminating signal when matching a Wallet card name to
# a template name. Deliberately NOT here: tier words like "elite", "reserve",
# "premier", "signature", "infinite" -- those distinguish card variants
# ("Strata" vs "Strata Elite" vs "Strata Premier") and must stay.
STOPWORDS = {
    "card", "cards", "the", "a", "an", "of", "and", "credit", "visa",
    "mastercard", "american", "express", "bank", "n.a", "na", "inc",
}


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #

def die(msg: str) -> "None":
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(1)


def png_size(data: bytes) -> "tuple[int, int] | None":
    """Width/height straight out of the IHDR chunk."""
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h = struct.unpack(">II", data[16:24])
    return w, h


def normalize(text: str) -> "list[str]":
    text = text.lower()
    text = text.replace("®", " ").replace("™", " ").replace("&", " and ")
    tokens = re.split(r"[^a-z0-9+]+", text)
    return [t for t in tokens if t and t not in STOPWORDS]


def similarity(a: str, b: str) -> float:
    ta, tb = normalize(a), normalize(b)
    if not ta or not tb:
        return 0.0
    sa, sb = set(ta), set(tb)
    jaccard = len(sa & sb) / len(sa | sb)
    ratio = difflib.SequenceMatcher(None, " ".join(ta), " ".join(tb)).ratio()
    # Token overlap is the more reliable signal for these names; the sequence
    # ratio only breaks ties between candidates that share the same tokens.
    return 0.65 * jaccard + 0.35 * ratio


def issuer_dir(org: str) -> "str | None":
    key = org.strip().lower()
    if key in ISSUER_ALIASES:
        return ISSUER_ALIASES[key]
    for alias, slug in ISSUER_ALIASES.items():
        if key.startswith(alias) or alias in key:
            return slug
    return None


# --------------------------------------------------------------------------- #
# templates
# --------------------------------------------------------------------------- #

def load_templates() -> "list[dict]":
    """Every card template, with its declared name and whether it has art."""
    out = []
    for yaml_path in sorted(TEMPLATES.glob("*/*/card.yaml")):
        card_dir = yaml_path.parent
        name = ""
        for line in yaml_path.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("name:"):
                name = line.split(":", 1)[1].strip().strip("'\"")
                break
        images = [
            p for p in card_dir.iterdir()
            if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")
        ]
        out.append({
            "id": f"{card_dir.parent.name}/{card_dir.name}",
            "issuer_dir": card_dir.parent.name,
            "slug": card_dir.name,
            "name": name,
            "dir": card_dir,
            "has_image": bool(images),
        })
    return out


def match_template(org: str, description: str, templates: "list[dict]") -> "list[tuple[float, dict]]":
    """Rank templates against a Wallet card, best first."""
    want_issuer = issuer_dir(org)
    scored = []
    for t in templates:
        score = max(
            similarity(description, t["name"]),
            similarity(description, t["slug"].replace("_", " ")),
        )
        if want_issuer:
            # Wrong issuer is almost always a wrong match, but a mis-mapped
            # organizationName shouldn't hide the right card entirely.
            score = score * (1.0 if t["issuer_dir"] == want_issuer else 0.35)
        scored.append((score, t))
    scored.sort(key=lambda p: p[0], reverse=True)
    return scored


# --------------------------------------------------------------------------- #
# wallet
# --------------------------------------------------------------------------- #

def scan_wallet() -> "list[dict]":
    """Read every local pass that has card art cached."""
    if not WALLET.is_dir():
        die(f"no Apple Wallet passes directory at {WALLET}\n"
            "       (this command only works on a Mac signed into Wallet)")

    cards = []
    for bundle in sorted(WALLET.glob("*.pkpass")):
        pass_json = bundle / "pass.json"
        if not pass_json.is_file():
            continue
        try:
            meta = json.loads(pass_json.read_text(encoding="utf-8", errors="replace"))
        except json.JSONDecodeError:
            continue
        # Wallet keeps boarding passes and loyalty cards in the same directory;
        # only Apple Pay payment passes carry issuer card art.
        if meta.get("passTypeIdentifier") != "paymentpass.com.apple":
            continue
        if meta.get("cardType") and meta["cardType"] != "Payment":
            continue

        sources: dict[str, dict] = {}
        for sidecar in bundle.glob("*.png.urls"):
            if sidecar.stat().st_size <= 2:
                continue
            try:
                entries = json.loads(sidecar.read_text(encoding="utf-8", errors="replace"))
            except json.JSONDecodeError:
                continue
            for image_name, info in entries.items():
                m = URL_RE.search(info.get("url", ""))
                if not m:
                    continue
                sources[image_name] = {
                    "pod": m.group(1),
                    "guid": m.group(2),
                    "sha1": info.get("sha1", ""),
                    "size": info.get("size", 0),
                }

        # Prefer the highest-resolution variant the sidecar knows about, even
        # when Wallet only cached a smaller one -- the CDN still has the big
        # one, and Apple Card's @3x is 1146x720 against a cached 764x480.
        art_key = next((k for k in ART_KEYS if k in sources), None)
        # Only pair a local file with the chosen key when the names agree;
        # otherwise its pixels describe a different asset than the id we record.
        art_file = bundle / art_key if art_key and (bundle / art_key).is_file() else None
        # No sidecar at all still leaves usable pixels, just nothing to register.
        cached_only = None
        if art_key is None:
            cached_only = next((bundle / k for k in ART_KEYS if (bundle / k).is_file()), None)

        cards.append({
            "bundle": bundle,
            "org": meta.get("organizationName", "").strip(),
            "description": (meta.get("description") or meta.get("longDescription") or "").strip(),
            "suffix": meta.get("primaryAccountSuffix", ""),
            "art_key": art_key,
            "art_source": sources.get(art_key) if art_key else None,
            "art_file": art_file or cached_only,
            "art_file_matches_source": art_file is not None,
        })
    return cards


# --------------------------------------------------------------------------- #
# registry
# --------------------------------------------------------------------------- #

def load_registry() -> dict:
    if REGISTRY.is_file():
        return json.loads(REGISTRY.read_text(encoding="utf-8"))
    return {"_comment": (
        "Apple Wallet asset ids for card art, keyed by template id. "
        "Fetch with: python3 tools/wallet_card_art.py fetch. "
        "Ids are per-artwork and per-pod, not per-cardholder."
    ), "aliases": {}, "cards": {}}


def save_registry(reg: dict) -> None:
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY.write_text(json.dumps(reg, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def register(reg: dict, template_id: str, source: dict, width: int = 0, height: int = 0) -> bool:
    """Add a wallet source (Apple broker or Google gstatic). Returns True if the
    registry changed."""
    entry = reg["cards"].setdefault(template_id, {"sha1": source["sha1"], "sources": []})
    if width and height:
        entry["width"], entry["height"] = width, height
    entry["size"] = source.get("size", entry.get("size", 0))

    # A different sha1 means the issuer refreshed the art. Keep the newest as
    # canonical but hold on to the old ids -- they still resolve, and a
    # contributor may be looking at the older face.
    if entry.get("sha1") and entry["sha1"] != source["sha1"]:
        entry.setdefault("superseded", [])
        if entry["sha1"] not in entry["superseded"]:
            entry["superseded"].append(entry["sha1"])
        entry["sha1"] = source["sha1"]

    new_url = source_url(source)
    if any(source_url(s) == new_url for s in entry["sources"]):
        return False
    record = {"type": source.get("type", "apple"), "sha1": source["sha1"]}
    if source.get("pod") and source.get("guid"):
        record["pod"], record["guid"] = source["pod"], source["guid"]
    else:
        record["url"] = source["url"]
    entry["sources"].append(record)
    return True


# --------------------------------------------------------------------------- #
# CDN
# --------------------------------------------------------------------------- #

def _get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "plan.cards-art/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def download(pod: str, guid: str, timeout: int = 30) -> bytes:
    """Apple broker asset by pod+guid, trying both host aliases."""
    last: Exception = RuntimeError("no host prefix tried")
    for prefix in HOST_PREFIXES:
        try:
            return _get(ASSET_URL.format(prefix=prefix, pod=pod, guid=guid), timeout)
        except urllib.error.HTTPError:
            raise                       # a 404 means the id is wrong for this pod
        except Exception as exc:        # DNS/TLS/transport -- try the other alias
            last = exc
    raise last


def source_url(source: dict) -> str:
    """Canonical fetch URL for a source of either wallet."""
    if source.get("url"):
        return source["url"]
    # Legacy Apple entry: reconstruct from pod+guid.
    return ASSET_URL.format(prefix=HOST_PREFIXES[0], pod=source["pod"], guid=source["guid"])


def download_source(source: dict, timeout: int = 30) -> bytes:
    if source.get("type", "apple") == "apple" and source.get("pod") and source.get("guid"):
        return download(source["pod"], source["guid"], timeout)
    return _get(source_url(source), timeout)


def _tag(source: dict) -> str:
    if source.get("pod") and source.get("guid"):
        return f"{source['pod']}/{source['guid'][:8]}"
    return f"{source.get('type', '?')}:{source_url(source).rsplit('/', 1)[-1][:12]}"


def fetch_entry(entry: dict) -> "tuple[bytes | None, str]":
    """Try each recorded source until one returns art matching the sha1."""
    errors = []
    for source in entry.get("sources", []):
        try:
            data = download_source(source)
        except urllib.error.HTTPError as exc:
            errors.append(f"{_tag(source)} HTTP {exc.code}")
            continue
        except Exception as exc:  # network, DNS, TLS
            errors.append(f"{_tag(source)} {exc}")
            continue
        got = hashlib.sha1(data).hexdigest()
        want = source.get("sha1") or entry.get("sha1")
        if want and got != want:
            errors.append(f"{_tag(source)} sha1 {got[:8]} != {want[:8]}")
            continue
        return data, ""
    return None, "; ".join(errors) or "no sources recorded"


# --------------------------------------------------------------------------- #
# commands
# --------------------------------------------------------------------------- #

def cmd_list(args) -> int:
    cards = scan_wallet()
    with_art = [c for c in cards if c["art_source"]]
    print(f"{len(cards)} payment passes in Wallet, {len(with_art)} with downloadable art\n")
    print(f"{'ISSUER':<20} {'CARD':<38} {'POD':<7} {'ASSET ID':<34} {'SHA1':<10}")
    print("-" * 112)
    for c in sorted(cards, key=lambda c: (c["org"], c["description"])):
        s = c["art_source"]
        if s:
            print(f"{c['org'][:19]:<20} {c['description'][:37]:<38} "
                  f"{s['pod']:<7} {s['guid']:<34} {s['sha1'][:10]:<10}")
        else:
            print(f"{c['org'][:19]:<20} {c['description'][:37]:<38} "
                  f"{'-':<7} {'(no cached art source)':<34}")
    return 0


def cmd_extract(args) -> int:
    cards = scan_wallet()
    templates = load_templates()
    reg = load_registry()
    changed = False
    wrote = 0

    aliases = reg.setdefault("aliases", {})
    for pair in args.map or []:
        if "=" not in pair:
            die(f"--map needs the form 'Wallet card name=issuer/slug', got {pair!r}")
        wallet_name, template_id = (x.strip() for x in pair.split("=", 1))
        aliases[wallet_name] = template_id
        changed = True

    by_id = {t["id"]: t for t in templates}
    for bad in [k for k, v in aliases.items() if v not in by_id]:
        print(f"warning: alias {bad!r} points at unknown template {aliases[bad]!r}")

    for c in sorted(cards, key=lambda c: (c["org"], c["description"])):
        if not c["art_source"] and not c["art_file"]:
            continue
        if c["description"] in aliases and aliases[c["description"]] in by_id:
            score, best = 1.0, by_id[aliases[c["description"]]]
            ranked = [(score, best)]
        else:
            ranked = match_template(c["org"], c["description"], templates)
            score, best = ranked[0]
        runners = ", ".join(f"{t['id']}({s:.2f})" for s, t in ranked[1:3])

        if c["art_file_matches_source"]:
            data = c["art_file"].read_bytes()
        elif c["art_source"]:
            try:
                data = download(c["art_source"]["pod"], c["art_source"]["guid"])
            except Exception as exc:
                print(f"!! {c['org']} / {c['description']}: {c['art_key']} "
                      f"not cached locally and download failed: {exc}")
                continue
        else:
            data = c["art_file"].read_bytes()
        dims = png_size(data) or (0, 0)
        flag = "ok " if score >= args.threshold else "?? "
        print(f"{flag}{c['org']} / {c['description']}")
        print(f"    -> {best['id']}  score={score:.2f}  "
              f"{dims[0]}x{dims[1]}  {'has art' if best['has_image'] else 'NO ART'}")
        if runners:
            print(f"       next: {runners}")

        if score < args.threshold:
            print(f'       skipped (below --threshold) -- to pin it, rerun with'
                  f'\n         --map "{c["description"]}={best["id"]}"')
            continue
        if best["has_image"] and not args.overwrite:
            print("       skipped (template already has art; --overwrite to replace)")
        elif args.write:
            dest = best["dir"] / "card.png"
            dest.write_bytes(data)
            print(f"       wrote {dest.relative_to(REPO)}")
            wrote += 1

        if c["art_source"] and register(reg, best["id"], c["art_source"], *dims):
            changed = True
            print(f"       registered {c['art_source']['pod']}/{c['art_source']['guid']}")
        elif not c["art_source"]:
            print("       no asset id in Wallet -- image only, nothing to register")

    if changed and (args.write or args.register):
        save_registry(reg)
        print(f"\nupdated {REGISTRY.relative_to(REPO)}")
    elif changed:
        print("\n(registry not saved -- pass --write or --register)")
    if args.write:
        print(f"wrote {wrote} image(s)")
    return 0


def cmd_fetch(args) -> int:
    reg = load_registry()
    templates = {t["id"]: t for t in load_templates()}
    ids = [args.id] if args.id else sorted(reg["cards"])
    ok = failed = skipped = 0

    for template_id in ids:
        entry = reg["cards"].get(template_id)
        if not entry:
            print(f"?? {template_id}: not in registry")
            failed += 1
            continue
        t = templates.get(template_id)
        if not t:
            print(f"?? {template_id}: no such template")
            failed += 1
            continue
        if args.missing and t["has_image"]:
            skipped += 1
            continue

        data, err = fetch_entry(entry)
        if data is None:
            print(f"!! {template_id}: {err}")
            failed += 1
            continue
        dims = png_size(data) or (0, 0)
        if args.dry_run:
            print(f"ok {template_id}: {len(data)} bytes {dims[0]}x{dims[1]} (dry run)")
        else:
            dest = t["dir"] / "card.png"
            dest.write_bytes(data)
            print(f"ok {template_id}: {dims[0]}x{dims[1]} -> {dest.relative_to(REPO)}")
        ok += 1

    print(f"\n{ok} fetched, {failed} failed, {skipped} skipped")
    return 1 if failed else 0


def cmd_verify(args) -> int:
    reg = load_registry()
    stale = 0
    for template_id, entry in sorted(reg["cards"].items()):
        for source in entry.get("sources", []):
            tag = _tag(source)
            try:
                data = download_source(source)
            except Exception as exc:
                print(f"!! {template_id} {tag}: {exc}")
                stale += 1
                continue
            got = hashlib.sha1(data).hexdigest()
            if got == source.get("sha1"):
                print(f"ok {template_id} {tag}")
            else:
                print(f"~~ {template_id} {tag}: "
                      f"art changed ({source.get('sha1', '')[:8]} -> {got[:8]})")
                stale += 1
    print(f"\n{stale} source(s) stale or unreachable")
    return 0


# --------------------------------------------------------------------------- #
# Google Pay / Chrome
# --------------------------------------------------------------------------- #

# Chrome mirrors the card art for saved Google Pay cards from the same
# Visa/Mastercard token pipeline Apple uses, and stashes the CDN url in its
# autofill database. The host is public and unauthenticated, same as Apple's
# broker; the art is the identical clean 1536x969 face.
CHROME_ROOTS = [
    Path.home() / "Library" / "Application Support" / "Google" / "Chrome",
    Path.home() / "Library" / "Application Support" / "Chromium",
    Path.home() / "Library" / "Application Support" / "BraveSoftware" / "Brave-Browser",
    Path.home() / "Library" / "Application Support" / "Microsoft Edge",
]


def scan_chrome() -> "list[dict]":
    """Read Google Pay card art urls out of every Chromium profile's Web Data.

    Only the ``masked_credit_cards`` table is touched: it holds the network,
    issuer, product name and art url -- never a full card number.
    """
    import shutil as _shutil
    import sqlite3
    import tempfile

    cards, seen = [], set()
    for root in CHROME_ROOTS:
        if not root.is_dir():
            continue
        for web_data in root.glob("*/Web Data"):
            # Copy first -- Chrome keeps the live DB locked.
            with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            try:
                _shutil.copy2(web_data, tmp_path)
                con = sqlite3.connect(f"file:{tmp_path}?mode=ro", uri=True)
                try:
                    rows = con.execute(
                        "SELECT network, bank_name, nickname, product_description, "
                        "card_art_url FROM masked_credit_cards "
                        "WHERE card_art_url IS NOT NULL AND card_art_url != ''"
                    ).fetchall()
                except sqlite3.OperationalError:
                    rows = []
                finally:
                    con.close()
            except Exception:
                rows = []
            finally:
                tmp_path.unlink(missing_ok=True)

            for network, bank, nickname, product, url in rows:
                if not url or url in seen:
                    continue
                seen.add(url)
                cards.append({
                    "profile": f"{root.name}/{web_data.parent.name}",
                    "org": (bank or "").strip(),
                    "description": (product or nickname or "").strip(),
                    "network": (network or "").strip(),
                    "art_url": url.strip(),
                })
    return cards


def cmd_chrome(args) -> int:
    cards = scan_chrome()
    if not cards:
        print("no Google Pay card art found in any Chromium profile.\n"
              "(open Chrome, sign in, and make sure your Google Pay cards have synced)")
        return 0

    templates = load_templates()
    reg = load_registry()
    by_id = {t["id"]: t for t in templates}
    aliases = reg.setdefault("aliases", {})
    changed = wrote = 0

    for c in sorted(cards, key=lambda c: (c["org"], c["description"])):
        if c["description"] in aliases and aliases[c["description"]] in by_id:
            score, best = 1.0, by_id[aliases[c["description"]]]
            ranked = [(score, best)]
        else:
            ranked = match_template(c["org"] or c["network"], c["description"], templates)
            score, best = ranked[0]
        runners = ", ".join(f"{t['id']}({s:.2f})" for s, t in ranked[1:3])

        flag = "ok " if score >= args.threshold else "?? "
        print(f"{flag}{c['org'] or c['network']} / {c['description']}")
        print(f"    -> {best['id']}  score={score:.2f}  "
              f"{'has art' if best['has_image'] else 'NO ART'}")
        if runners:
            print(f"       next: {runners}")
        if score < args.threshold:
            print(f'       skipped (below --threshold) -- to pin it, rerun with'
                  f'\n         --map "{c["description"]}={best["id"]}"')
            continue

        try:
            data = _get(c["art_url"])
        except Exception as exc:
            print(f"       download failed: {exc}")
            continue
        dims = png_size(data) or (0, 0)
        source = {"type": "google", "url": c["art_url"],
                  "sha1": hashlib.sha1(data).hexdigest(), "size": len(data)}

        if best["has_image"] and not args.overwrite:
            print(f"       {dims[0]}x{dims[1]}; template already has art (--overwrite to replace)")
        elif args.write:
            dest = best["dir"] / "card.png"
            dest.write_bytes(data)
            print(f"       wrote {dest.relative_to(REPO)} ({dims[0]}x{dims[1]})")
            wrote += 1

        if register(reg, best["id"], source, *dims):
            changed += 1
            print(f"       registered google:{c['art_url'].rsplit('/', 1)[-1]}")

    if changed and (args.write or args.register):
        save_registry(reg)
        print(f"\nupdated {REGISTRY.relative_to(REPO)}")
    elif changed:
        print("\n(registry not saved -- pass --write or --register)")
    if args.write:
        print(f"wrote {wrote} image(s)")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("list", help="show payment passes in the local Wallet and their asset ids")
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("extract", help="match local Wallet art to templates, record asset ids")
    s.add_argument("--write", action="store_true", help="copy art into card_templates/ and save the registry")
    s.add_argument("--register", action="store_true", help="save the registry without copying images")
    s.add_argument("--overwrite", action="store_true", help="replace art on templates that already have it")
    s.add_argument("--threshold", type=float, default=0.55, help="minimum match score (default 0.55)")
    s.add_argument("--map", action="append", metavar="NAME=ISSUER/SLUG",
                   help="pin a Wallet card name to a template; remembered in the registry")
    s.set_defaults(func=cmd_extract)

    s = sub.add_parser("fetch", help="download art from Apple's CDN using recorded asset ids")
    s.add_argument("--id", help="a single template id, e.g. chase/freedom_unlimited")
    s.add_argument("--missing", action="store_true", help="only templates that have no art yet")
    s.add_argument("--dry-run", action="store_true", help="download and report, but do not write")
    s.set_defaults(func=cmd_fetch)

    s = sub.add_parser("chrome", help="match Google Pay card art (from Chrome) to templates")
    s.add_argument("--write", action="store_true", help="copy art into card_templates/ and save the registry")
    s.add_argument("--register", action="store_true", help="save the registry without copying images")
    s.add_argument("--overwrite", action="store_true", help="replace art on templates that already have it")
    s.add_argument("--threshold", type=float, default=0.55, help="minimum match score (default 0.55)")
    s.set_defaults(func=cmd_chrome)

    s = sub.add_parser("verify", help="re-check every recorded asset id against the CDN")
    s.set_defaults(func=cmd_verify)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
