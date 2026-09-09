# Approved forum catalog implementation — September 9, 2026

Implemented the user's exported approval for all 130 candidates in USCardForum topic 29408. The catalog now contains **441 current templates**, including **28 new product entries**. Multiple approved covers for the same new product remain variants of one template.

## Artwork

- 37 default-cover replacements and 10 alternate-cover replacements preserve their exact existing filenames. Saved card-image selections therefore remain resolvable.
- 45 alternate-cover approvals add image choices; 36 new-product cover approvals populate the 28 new entries.
- Two supplementary Amex covers attach to their parent products, with no standalone full-benefit template. Companion Platinum is under personal Platinum; Employee Business Expense is available under Business Gold and Business Platinum. [Amex's business benefits terms](https://global.americanexpress.com/card-benefits/terms/business-platinum) distinguish the employee-card benefits.
- Eight existing templates had no `card.*` default at all. Their approved art also seeds a default: Business Green, Cathay Pacific, World of Hyatt, Delta Reserve Business, Hyatt Business, Hawaiian Airlines, JetBlue Business and Marriott Bevy. Their existing variants are preserved.
- These mappings produce **139 output placements from 130 source artworks**. The catalog has 210 templates with default artwork.
- All 47 replaced files have checksum-recorded originals retained. The incorrectly mapped Canadian Business Gold face is kept in `.art-history/`, outside the selectable-image scan. Other replaced covers remain in `old/`.

New image files are PNG; replacements retain the existing supported PNG/JPEG filename and MIME type. Original dimensions are preserved, including lower-resolution approved sources; no detail was fabricated by upscaling. Most sources are native 1536×969 wallet artwork. No source was cropped, redacted, or generatively edited.

[The source registry](../../tools/forum_art_sources.json) records every source URL, approved source hash, output path/hash, target template and archive path/hash. [The importer](../../tools/import_approved_forum_art.py) verifies the approval against the reviewed candidate manifest, verifies cached source bytes, checks destination conflicts, and validates previously applied files on repeat runs. It makes no changes to financial terms or personal card records.

## Product research

The new entries use the existing YAML schema and unique version IDs. Dates are included only when established, and legacy products are not presented as active applications. Signup offers, arbitrary APR snapshots and unsupported recurring frequencies were excluded. Conditional or fractional-dollar benefits that the schema cannot model accurately are explained in notes rather than creating misleading automatic credits.

- [Six American Express products](forum-new-amex.md): Centurion, EveryDay, EveryDay Preferred, Schwab Platinum, Schwab Investor and Morgan Stanley Credit.
- [Eleven legacy/co-brand products](forum-new-legacy.md): Flying Blue, Better Balance Rewards, Merrill+, Arrival, Barclaycard Rewards, original Freedom, IHG Select, Ritz-Carlton, AT&T Access More, Dividend and ThankYou Preferred.
- [Eleven modern/specialist products](forum-new-modern.md): Affinity, AOD, Brex, Mercury IO, three Navy Federal products, two Stanford FCU products, Ralphs and X1.

An independent source review corrected Affinity's outdated standalone disclosure: the [current product page](https://www.affinityfcu.com/personal-banking/banking/credit-card/cash-rewards-visa) and its embedded terms specify a $1,000 monthly cap on qualifying Amazon purchases. It is not a general 5% bookstore category. X1 uses its current 1.5x rewards terms rather than its historical 2x/3x program. The current Flying Blue Visa and old Mastercard art share one product entry. Complete public Centurion benefits could not be verified; its sourced fee and invitation-only nature are recorded, with no guessed credits.

## Validation

- Every approved ID and source hash matched the cached artwork; every output decodes and retains the source dimensions. Lossless conversions preserve pixels exactly; JPEG replacements were checked for negligible encoding differences.
- An independent implementation review checked all source/output/archive hashes, exact replacement paths, all 28 grouped defaults, supplementary mappings and exclusion of the Canadian cover from the U.S. image picker.
- Integration tests exercise all 139 image URLs, default/alternate selection paths, creation of all 28 new cards, benefits retrieval, card images and profile export/import.
- Full backend suite passed: **921 tests**, using the repository CI settings (`RATE_LIMIT_ENABLED=false`, an isolated test database, and the local template directory). One existing dependency deprecation warning remains.
- Frontend type checking and production build passed with existing lint warnings.
- `git diff --check` passed. All 28 new entries have explicit, sourced annual fees: 14 are active, 13 are closed to new applicants, and one is discontinued.

The work changes the repository catalog and artwork. It does not create personal account records, purchase/apply for cards, or deploy the main application. Existing earlier catalog research changes are preserved.
