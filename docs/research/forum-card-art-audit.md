# USCardForum card-art audit — 2026-09-09

All 130 U.S. approval candidates were subsequently accepted and implemented. See the [implementation report](forum-card-art-implementation.md); the audit below preserves the review-stage decisions.

The [source thread](https://www.uscardforum.com/t/topic/29408) was crawled through all **737 available posts**, ending at post 779 (last post: August 23, 2026). The Discourse stream contains 42 unavailable/deleted post-number gaps. The audit covers image attachments, linked image files, and directly shared wallet artwork endpoints. It does not claim to recursively audit all images inside separately linked galleries, repositories, or collections.

## Coverage and screening

- **632 unique image/artwork URLs**, including non-card preview assets.
- **626 retrieved**. Two wallet sources were PDF artwork and were rendered for inspection. Two image-host HTML wrappers were resolved to their original images.
- **582 unique full-size images visually inspected**, plus six small icons/incomplete details. Another 38 sources were pixel-identical duplicates and inherit the canonical classification.
- Comparison index: **301 existing catalog image files**, including historical and alternate artwork. Exact pixel matches and perceptual hashes were used as aids; proposed mappings and duplicate designs were visually reviewed.
- **22 additional same-design files consolidated** after visual comparison, favoring higher-resolution originals without merging different products or historical designs.
- **6 unavailable sources**: two defunct HSBC Canada preview/logo URLs and four Cubeupload 404s in post 762. That post also has working forum-hosted attachments, but the missing files cannot be independently inspected or asserted to be identical.

The complete per-URL record is [forum-card-art-audit.json](forum-card-art-audit.json). Its mutually exclusive outcomes total 632: 369 candidates across all markets/types, 63 already-existing images, 19 unresolved identities/mappings, 115 rejected images/icons/details, 38 pixel duplicates, 22 additional duplicate designs, and 6 unavailable sources. Candidate does not mean approved or ready for a U.S. product template.

## Approval gallery

[Open the private review page](https://plan-cards-art-review-sep2026.gritty-rook-5362.chatgpt.site).

The private gallery presents **130 vetted U.S. credit-card covers**, all selected by default at the user's request:

| Action | Covers | Meaning |
|---|---:|---|
| New product | 36 | Create a missing card entry and add artwork; multiple covers for the same product are grouped. |
| Quality upgrade | 37 | Replace the default image, preserving history. |
| Alternate cover | 45 | Add another image choice to an existing product. |
| Alternate quality upgrade | 10 | Replace a specific existing alternate image, retaining the default. |
| Additional-card cover | 2 | Supplementary Amex artwork; do not create standalone financial products. |

The 36 new-product covers group into 28 proposed products. Proposed product keys are provisional implementation identifiers, not existing database records. The remaining 239 clean candidates are outside the default U.S. credit-card scope. Their identities, source links, and available research remain in the audit.

The implementation manifest is [tools/forum_art_review_candidates.json](../../tools/forum_art_review_candidates.json). It preserves stable image IDs, SHA-256 hashes, original source and post URLs, intended existing-template mappings, action types, explicit replacement paths where applicable, and primary research links. The page exports only currently checked IDs and their records. No forum artwork or new product from this approval exercise has been applied to the card catalog.

## Identification findings

- The catalog's American Express Business Gold default uses Canadian bilingual artwork. Clean U.S. BUSINESS-only artwork is proposed as a replacement (img-0306). Canadian SimplyCash and other foreign Amex lookalikes were kept out of U.S. mappings.
- Nine Bank of America affinity covers were linked to Customized Cash Rewards using issuer or affinity-organization evidence, rather than creating duplicate products. These include [AQHA](https://www.aqha.com/bank-of-america), alumni, and charity designs. NWF art remains unresolved because a primary-source family mapping could not be established.
- [Navy Federal More Rewards](https://www.navyfederal.org/loans-cards/credit-cards/more-rewards.html), [Affinity Cash Rewards](https://www.affinityfcu.com/personal-banking/banking/credit-card/cash-rewards-visa), Mercury IO, Brex, and Stanford FCU covers identify products missing from this catalog. This audit establishes artwork identity; current fees, benefits, availability, eligibility and versioned YAML terms must be researched during approved implementation.
- [Neo's United card](https://support.neofinancial.com/en/articles/14009994-find-the-best-credit-card-for-you) is Canadian and is excluded from the U.S. approval set.
- Discover designs are generic optional family artwork. A design alone does not establish a separate rewards product. [Discover's own historical flag-design post](https://www.flickr.com/photos/discovercard/4728574940) corroborates the American flag design; current design availability is not implied.
- Supplementary Amex employee/companion cards are not independent full-benefit products. Historical products such as original Freedom, IHG Select, EveryDay, Dividend and Merrill+ must not be presented as open applications without current verification.

## Clean-cover rule and validation

Only intact card faces enter the gallery. Photographs, application/device screenshots, personal names, visible card-number fragments, masking scribbles, unrelated graphics, logos and partial crops are excluded. No personal details were erased to manufacture a clean cover. A marked-up Navy Federal image was explicitly rejected in favor of an intact version. Rejected source images are absent from the hosted project.

Approved implementation should preserve the repository's PNG wallet-cover convention (1536×969), retain original provenance, avoid unnecessary upscaling, preserve alternate/history selection behavior, and use existing YAML schema/versioning for new products. The review itself leaves originals intact for quality assessment.

Validation: selection/export tests passed (selected-only IDs, deduplication, invalid-input handling, hashes and asset existence), TypeScript passed, and the production build passed. All final candidate images received visual inspection. Browser UI testing was not requested. The optional read-only WebMCP export hook has no supported runtime validation context in this session; it is not claimed as verified and is not required for the checkbox/copy workflow.
