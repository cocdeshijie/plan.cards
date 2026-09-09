# Card catalog research and update audit

The catalog update adds five products and revises thirteen existing entries. The research cutoff is September 9, 2026. Its scope is U.S. credit-card releases, material earning and benefit changes, and product transitions relevant to the existing catalog. This is a targeted update audit informed by a broad news scan, not certification that every term of every catalog card has been reverified.

## Additions

| Catalog ID | Supported catalog content | Availability and source |
| --- | --- | --- |
| `fnbo/complete_rewards` | No annual fee; Visa Signature; 5x travel, 3x streaming, 2x fuel, 1x other spending. | FNBO's live offer accepts applications. Partner-bank and Mastercard offers should not be assumed identical. [1] |
| `fifth_third/truly_simple` | No annual fee; Mastercard; introductory financing described in notes, without invented rewards. | September 1 launch. The temporary Instacart promotion is not represented as a permanent annual statement credit. [2] |
| `comenity/nfl_extra_points_amex` | No annual fee; 3% NFL/team purchases, 2% groceries, restaurants, food delivery, gyms and sporting goods, 1% elsewhere. | August 26 launch; eighteen team programs use Amex. This does not establish that all team cards migrated. [3] |
| `intuit/business` | WebBank-issued Mastercard; no annual fee; 5% eligible Intuit products and services, 2% other purchases. | Live application page. Intuit transactional fees are excluded from the elevated category; 2.7% foreign transaction fee recorded. [4] |
| `upgrade/onecard_essentials` | No annual fee; Visa; unlimited 3% eligible essentials and 1% other purchases. | Invitation-only. Target/Walmart exclusions and planned payment features are clearly noted. [5, 6] |

These are catalog additions, not a claim that each product first launched during September. Welcome bonuses generally remain outside the templates because the schema has no structured offer-expiration field and public offers can vary by applicant or channel.

## Existing entries revised

### Bilt

The Obsidian hotel credit changes from $100 to $50 per calendar half-year; Palladium changes from $100 to $200. Palladium's annual Bilt Cash benefit resets on January 1 rather than the card anniversary. Hotel booking conditions and the choice between Housing-only and Flexible Bilt Cash rewards are documented; the incorrect blanket 0% introductory APR claim is removed. The legacy Wells Fargo card is marked discontinued effective February 7, with Autograph identified as the retained-account conversion product. [7–11]

The housing reward system depends on monthly spending ratios and a choice of reward currency. A universal rent multiplier or an unconditional cash-back category would misrepresent it. The catalog therefore keeps the conditional mechanics in notes and qualifies the Bilt Cash category label.

### Amazon business cards

Both U.S. Bank variants gain the missing prepaid travel category. The top-three-category bonus is automatic and has a separate combined $150,000 annual cap; the Amazon cap remains distinct. Outdated 60/90-day financing claims are replaced with the announced eligible-purchase installment option. The Amex predecessor is marked discontinued on August 14 and remains available for historical tracking. Account-specific exceptions to transfer are acknowledged. [12–14]

The change does not move a user's existing card automatically to another template ID. Issuer migration and an individual's account history are different concerns; the app's existing product-change workflow remains the way to record that transition.

### Capital One Venture Business

The missing $50 annual advertising/software credit is added with an anniversary reset. The existing travel-credit identity remains intact, with the Business Travel portal named explicitly. The multi-year application-fee benefit stays in notes. [15]

### Citi AAdvantage Executive

The already-recorded World Legend name and $695 fee remain. The unsupported 2x restaurants/gas category is replaced with 12x eligible AAdvantage Hotels/Cars bookings. Grubhub is removed from the current new-card benefit set; notes distinguish legacy account eligibility. Lyft and rental-credit conditions are clarified. [16]

A preserved prior template is not a substitute for a specific cardholder's renewal or transition notice. Existing accounts can have terms that differ from the public acquisition offer.

### Carnival

The existing ID is retained under the Carnival Rewards Mastercard name. The card component earns 3x eligible Carnival spending; Carnival's separate loyalty earnings explain the advertised combined maximum. Restaurants and groceries replace the previous broader 2x label. Carnival's FAQ says restaurants, while a discovery article says gas; the first-party FAQ governs this edit. [17, 23]

### Chase Sapphire Reserve, personal and business

The Edit moves from an anniversary reset to a calendar-year reset on both entries. Its $250-per-qualifying-stay limit and two-night prepaid minimum are stated. Business-card notes replace the fixed 1.5-cent travel redemption claim with current Points Boost mechanics, and the existing $120,000 Shops threshold uses calendar-year spending. [18–20]

The 2026-only selected-hotel credit is not added as an indefinitely recurring credit. The present schema cannot encode its end date. This audit also does not treat reported October DoorDash changes as effective in September.

### Robinhood Platinum

The DoorDash allowance becomes $10 monthly. Waymo and dining use $20 monthly baseline trackers with explicit instructions for their respective $10 exceptional-month increments. The missing $250 semiannual premium-hotel statement credit is added. The former generic wearable allowance is removed; current wellness benefits are described instead. [21, 22, 24]

The $700 hotel marketing total includes property benefits: it is not a $700 recurring statement-credit allowance. Flight credits remain in notes because the reviewed material gives a six-month cadence without an equally explicit anchor. The latest reward rules list prepaid hotels but omit rental cars, while the travel help page still advertises rental-car rewards. The catalog follows the newer reward rules and flags the disagreement. Dining's annual $50,000 cap is now represented. [21, 22, 25]

## Deferred leads and unresolved terms

| Lead | Decision | Evidence needed before another edit |
| --- | --- | --- |
| Navy Federal Flagship refresh reportedly due September 10 | No fee or reward edit. | Issuer announcement or effective current terms. Discovery source labels this a rumor. [26] |
| Chase Aeroplan earning changes reportedly due in 2027 | No current multiplier edit. | Public issuer confirmation and an effective date. [26] |
| Southwest premium card planned for 2027 | No active template. | Application availability, fee, reward rules and full benefits. [26] |
| IHG Premier Business anniversary-night increase reported for 2027 | No current entitlement edit. | Issuer terms that identify eligible accounts and certificate issuance dates. [26] |
| Sunoco program termination reported for October 31 | No prematurely discontinued product or invented successor. | Primary closure notice and confirmed successor issuer/application terms. [26] |
| PenFed Defender and Amex Fanatics announcements | No active template based on discovery listings alone. | Current application availability and full issuer disclosures. [27] |
| Rumored Hyatt, premium Delta, Savor X and other survey products | No additions. | Public product launch and finalized terms. [27] |
| Robinhood rental-car rewards | Claim omitted and conflict recorded in notes. | Reconciled rewards agreement or written issuer clarification. [22, 25] |
| Robinhood uneven monthly credits | Baseline trackers plus explicit exceptions. | A future schema supporting different amounts by month would permit exact automation. [21, 24] |

News indexes were used to identify leads across issuers. Their inclusion here is not endorsement of unconfirmed claims. The scan also found products already present, including Graphite Business, Samsung Galaxy, Royal One and Venture Business; an existing name alone was not treated as proof that its complete entry was current. [27]

## Format and integration decisions

All current entries follow `card_templates/<issuer>/<slug>/card.yaml`. No runtime schema fields were added. Source URLs and review dates are YAML comments, so the loader does not need to understand new metadata. New entries use supported network values, integer fees, and the documented benefits structure.

Thirteen previous files are preserved under their original version IDs in `old/`; current versions are incremented. These snapshots preserve the prior shipped state, including known inaccuracies corrected by this audit. They are compatibility records, not independently certified historical issuer terms. Existing template paths are preserved, including renamed and discontinued products.

New stable keys are added to touched recurring benefits while keeping their existing names wherever migration depends on name matching. Removed obsolete benefits can be retired by the existing sync service. User-edited and pinned records continue to follow the app's protection rules. No production database was opened or changed for this work.

The frequency model accepts monthly, quarterly, semiannual and annual periods with calendar or anniversary resets. It cannot faithfully automate expiring one-off promotions, unequal month amounts, account-specific transitions, per-stay property credits, or alternative housing reward modes. Those qualifications belong in notes or the deferred list rather than being encoded as false recurring dollar allowances.

New products use the app's existing missing-art fallback; no fabricated card artwork is included. Art acquisition and visual matching are outside this data update.

## Validation

The catalog contains 413 current templates across 29 issuer directories after this update.

- Complete backend suite: **890 passed**. This run began before the final Robinhood archive was added; the final complete catalog and sync tests below include it.
- Final catalog validation and template-sync suites: **522 passed**. Current and historical YAML schemas, IDs, availability values, names, and loader completeness passed.
- Targeted in-memory API exercise: **18 changed templates and 34 current/historical card versions** created successfully; benefit retrieval, export and re-import passed. An old Palladium hotel-credit row kept its ID and $35 of recorded usage while updating to the corrected $200 amount and stable key. A second sync did not add duplicate benefits.
- Frontend production build: **passed**, including type checking and lint validation. Existing non-failing lint, browser-data and Python dependency deprecation warnings remain.
- Whitespace and documented-field/key checks: **passed**. No application source, dependencies or lockfiles were changed.

Backend commands use Python 3.12, matching the Docker image, with `CARD_TEMPLATES_DIR=../card_templates DATABASE_URL=sqlite:///test.db RATE_LIMIT_ENABLED=false`. Run `pytest tests/ -q` for the complete suite or `pytest tests/test_template_validation.py tests/test_template_sync.py -q` for catalog integration. The frontend check is `npm run build` after installing the existing Bun lockfile without modification.

## Sources

Dates below are publication/update dates where available. Live pages without a displayed date were accessed September 9, 2026.

1. FNBO. [Complete Rewards Visa Signature offer](https://www.card.fnbo.com/mpp/fi/offer/consumer/banner-visa-cmplt). Live product page.
2. Fifth Third Bank. [Truly Simple launch](https://www.53.com/content/fifth-third/en/media-center/press-releases/2026/press-release-2026-09-01.html). September 1, 2026.
3. Bread Financial. [NFL Extra Points Amex launch](https://investor.breadfinancial.com/node/30676/pdf). August 26, 2026.
4. Intuit. [Intuit Business Credit Card](https://www.intuit.com/credit-card/). Live product page.
5. Upgrade. [OneCard Essentials](https://www.upgrade.com/credit-card/onecard-essentials/). Live product page and disclosures.
6. Upgrade. [OneCard announcement](https://www.upgrade.com/press/memos/upgrade-launches-onecard/). August 10, 2026.
7. Bilt. [Card Offer Terms](https://www.bilt.com/terms/bilt-card-offer-terms). Updated August 28, 2026; housing choices and card-specific sections.
8. Bilt Support. [Card 2.0 Program Overview](https://support.biltrewards.com/hc/en-us/articles/42897766682381-Bilt-Card-2-0-Program-Overview). Live support page.
9. Bilt. [Palladium product page](https://www.bilt.com/card/palladium). Live product page.
10. Bilt. [Card portfolio](https://www.bilt.com/card). Live product page.
11. Bilt Support. [Card 2.0 Transition](https://support.biltrewards.com/hc/en-us/articles/40834037331085-Bilt-Card-2-0-Transition). Updated February 7, 2026.
12. U.S. Bank. [Amazon Business cards](https://www.usbank.com/business-banking/business-credit-cards/amazon-business-credit-cards.html). Live rewards table and footnotes.
13. Amazon. [New business cards available](https://press.aboutamazon.com/2026/5/amazons-new-prime-business-and-amazon-business-credit-cards-powered-by-u-s-bank-and-mastercard-are-now-available-with-enhanced-rewards-and-flexible-financing). May 13, 2026.
14. American Express. [Amazon program update](https://www.americanexpress.com/us/customer-service/faq.amazon-program-update.html). Live transition FAQ.
15. Capital One. [Venture Business](https://www.capitalone.com/small-business/credit-cards/venture-business/). Live product page, credit footnotes.
16. Citi. [AAdvantage Executive World Legend Mastercard](https://www.citi.com/credit-cards/citi-aadvantage-executive-world-legend-mastercard). Live product page.
17. Carnival. [Carnival Rewards FAQ](https://www.carnival.com/help?topicid=1152). Mastercard earnings and account transition sections.
18. Chase. [The Edit credits and benefits](https://www.chase.com/travel/guide/hotels/the-edit-chase-travel-credits-benefits). Live guide.
19. Chase. [Sapphire Reserve](https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve). Live offer terms.
20. Chase. [Sapphire Reserve for Business](https://creditcards.chase.com/business-credit-cards/sapphire/reserve). Live offer terms.
21. Robinhood. [Platinum Benefits Program Terms](https://api.robinhood.com/creditcard/legal/platinum-benefits-overview). Updated August 25, 2026.
22. Robinhood Support. [Platinum travel](https://robinhood.com/us/en/support/articles/platinum-travel/). Live support page.
23. William Charles, Doctor of Credit. [Carnival Rewards Mastercard](https://www.doctorofcredit.com/barclays-carnival-rewards-mastercard-50000-point-bonus/). September 8, 2026. Discovery source; conflicting category not adopted.
24. Robinhood Support. [Platinum dining](https://robinhood.com/us/en/support/articles/platinum-dining/). Live support page.
25. Robinhood. [Platinum Rewards Program Rules](https://api.robinhood.com/creditcard/legal/platinum-reward-terms). Updated September 8, 2026.
26. CreditOdds. [Card news](https://creditodds.com/news). Index updated September 6, 2026. Discovery and deferred leads only.
27. William Charles, Doctor of Credit. [New cards for 2026: launched, announced and rumored](https://www.doctorofcredit.com/new-credit-cards-for-2026-launched-announced-rumored/). March 24, 2026 article with later updates. Discovery only.
