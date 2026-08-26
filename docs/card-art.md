# Card art

Templates render a card face from `card_templates/<issuer>/<slug>/card.png`.
The house style is **1536×969 PNG** — the size Apple Wallet and Google Pay both
use for the card background, which is where most of the existing art came from.

Of 408 templates, 94 currently ship art. The rest fall back to
`card_templates/placeholder.png`.

## Two wallets, one CDN pattern

Both Apple Wallet and Google Pay cache the *same* clean card face — they pull it
from the same Visa/Mastercard token pipeline — and both leak the CDN url they
fetched it from onto a public, unauthenticated host. `tools/wallet_card_art.py`
harvests from either:

| Wallet | Read from | Art url | Command |
|--------|-----------|---------|---------|
| Apple Wallet | `~/Library/Passes/Cards/*.pkpass` (`.urls` sidecars) | `…-smp-device-asset.apple.com/broker/v1/assets/<guid>` | `extract` |
| Google Pay | Chrome `Web Data` → `masked_credit_cards.card_art_url` | `www.gstatic.com/payments_api/partnerasset/cardart/<uuid>.png` | `chrome` |

Google matters because it is **desktop-readable** — the phone wallet apps
(Google Wallet, Samsung Wallet) keep art in sandboxed Android storage you can't
read without root, but Chrome on macOS/Windows/Linux exposes the url in a plain
SQLite file. It also reaches different cards than Apple: a contributor's Google
Pay set overlaps only partly with their Apple Wallet.

Everything below describes the Apple path in detail; the Google path works the
same way, keyed on the gstatic url instead of a pod+guid.

## Where the art comes from

Apple Wallet caches the background for every provisioned Apple Pay card under
`~/Library/Passes/Cards/<id>.pkpass/cardBackgroundCombined@2x.png`, and writes a
`cardBackgroundCombined.png.urls` sidecar next to it recording the download:

```json
{"cardBackgroundCombined@2x.png": {
  "url":  "https://nc-pod10-smp-device-asset.apple.com:443/broker/v1/assets/72290a9ec8664eb794de8a8acb88a2a7",
  "size": 517417,
  "sha1": "0bbdbc9988d14006f31f1e392e0e69f3cb47ee09"}}
```

Two things about that endpoint matter here.

**It is an open CDN.** `*-smp-device-asset.apple.com` is an Akamai property
(`smp-device-content*.apple.com.edgekey.net`). A plain `curl` with no token, no
cookie and no client certificate returns the PNG with `Cache-Control:
max-age=707436`.

**The asset id identifies the artwork, not the cardholder.** Three separately
provisioned Chase cards in one Wallet all reference icon id
`028fa2ac87424955b2fa6add44888bc6`; three Amex cards share
`7dac668380274410a2a392603b4379f3`. The same artwork provisioned on a different
pod gets a different id but byte-identical content — the Amex icon is
`3d99d07b…` on pod3 and `7dac6683…` on pod10, both sha1 `8089f26b37f7…`.

So an id captured from one contributor's Wallet keeps resolving for everyone
else. `tools/wallet_art_sources.json` records those ids, and anyone can rebuild
the art from it without ever holding the card.

The art itself carries no personal data — no PAN, no name. Wallet composites the
cardholder name and last four over it at display time from `pass.json`.

## Adding art from your own Wallet

On a Mac signed into Wallet:

```bash
python3 tools/wallet_card_art.py list             # what's in your Wallet
python3 tools/wallet_card_art.py extract          # dry run: show template matches
python3 tools/wallet_card_art.py extract --write  # copy art in + record the ids
```

`extract` matches each Wallet card to a template by name and issuer. Anything
scoring below `--threshold` (0.55) is reported but skipped — co-brands are the
usual reason, since Wallet reports Bilt's `organizationName` as "Wells Fargo
Bank". Pin those once and the registry remembers:

```bash
python3 tools/wallet_card_art.py extract --write \
  --map "Bilt World Elite Mastercard=bilt/bilt_card"
```

Templates that already have art are left alone unless you pass `--overwrite`.

Commit both the new `card.png` files and the updated
`tools/wallet_art_sources.json` — the registry is what lets the next person
rebuild your contribution.

## Adding art from Google Pay (Chrome)

If you use Chrome and have cards saved to Google Pay, they sync into Chrome's
autofill store and carry the same clean art:

```bash
python3 tools/wallet_card_art.py chrome           # dry run: show matches
python3 tools/wallet_card_art.py chrome --write   # copy art in + record the urls
```

Same matching, `--map` and `--overwrite` flags as `extract`. Only the
`masked_credit_cards` table is read (network, issuer, product name, art url) —
never the tables that hold a real card number. Works from Chromium, Brave and
Edge profiles too.

## Rebuilding art without a Wallet

```bash
python3 tools/wallet_card_art.py fetch --missing        # only templates lacking art
python3 tools/wallet_card_art.py fetch --id chase/sapphire_reserve
python3 tools/wallet_card_art.py verify                 # re-check every recorded id
```

`fetch` checks each download against the recorded sha1 before writing, and tries
both the `nc-` and `pr-` host aliases.

`verify` reports `~~ art changed` when an id still resolves but the bytes moved —
that means the issuer refreshed the card face, and the template art is due for a
refresh too.

## What the wallets do *not* give you

Neither wallet exposes a catalog. Apple's `/broker/v1/assets` returns 403; both
Apple's guid and Google's gstatic uuid are random 122-bit ids, so they cannot be
enumerated — an id only becomes known once somebody provisions that card into a
wallet. Apple's public manifests
(`smp-device-content.apple.com/static/hero/v3/…`, reachable from
`/static/region/v2/config.json`) carry only network-level art — Visa,
Mastercard, Amex, Discover, JCB and the transit cards — not per-product issuer
faces.

That is the ceiling on this approach: it scales with contributors' wallets
(across both Apple and Google), not with the size of the card database.

For cards nobody here holds in either wallet, the fallback is issuer / aggregator
CDNs — but those serve *marketing* art with a specimen number and name baked in
(e.g. Amex `www.aexp-static.com/.../NUS000000{NNN}_480x304_STRAIGHT_96.gif`,
sequential and enumerable; `cdn.creditcards.com/shared/images/cards/500x315/…`).
Fine as a last resort, not clean like a wallet face. Modern numberless-front
cards are the exception — their marketing art is naturally bare.

## Bulk fill from MaxRewards

The one public source that is bulk, enumerable, *and* clean for a good fraction
of cards is the MaxRewards CDN:

```
https://www.maxrewards.com/sitemap.xml            -> /credit-cards/<slug>   (~528 cards)
https://d1f8ie53h08h9n.cloudfront.net/<slug>/lg.webp    (~900px webp, no auth)
```

The slug from the sitemap resolves directly on CloudFront (unknown slug → 403).
It re-hosts issuer *marketing* art, so cleanliness is **per card**: numberless
cards come back bare, but many carry a specimen name ("D. BARRETT", "TD
CUSTOMER") or a promo badge ("NO ANNUAL FEE"). **Every candidate is reviewed by
eye** — never adopt this art unscreened. Whole issuers are unusable: all Chase
faces carry a specimen name, all TD carry "TD CUSTOMER", Amex carries "C F
FROST".

The review flow:

1. Match art-less templates to sitemap slugs, download, trim, convert to PNG.
2. Open `tools/card-art-review.html` — a checkoff grid of every candidate with
   its image — and keep only the bare ones. It exports the accepted JSON.
3. Ingest the accepted set; provenance lands in `tools/maxrewards_sources.json`.

```bash
python3 tools/maxrewards_ingest.py verify        # re-check every recorded slug vs the CDN
python3 tools/maxrewards_ingest.py fetch         # rebuild card.png for templates that lack it
```

`maxrewards_ingest.py` needs Pillow (`pip install Pillow`); the wallet tool
stays stdlib-only. This art is ~900px — below the 1536×969 wallet standard — so
wallet art always wins where both exist; treat MaxRewards as the gap-filler.

## Licensing

Card art is the issuer's trademarked material. We reproduce it to identify the
product a user is tracking, which is nominative use, and templates are
descriptive rather than promotional. Issuers do ask for removal sometimes; if
that happens, drop the image and the registry entry and let the template fall
back to the placeholder. Don't restyle or recolor a card face — an altered mark
is a weaker position than an unaltered one.
