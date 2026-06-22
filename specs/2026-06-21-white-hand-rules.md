# The White Hand (MEWH) — Rules Implementation Spec

Status tracker for implementing the MECCG *The White Hand* expansion rules.
Source: `https://meccg.com/rules/by-expansion/the-white-hand/` (text extracted
verbatim from the MEWH Insert, no modifications).

Scope is **rule-engine mechanics** only. Per-card DSL wiring is tracked separately under
card certification. Card **data** already exists — `wh-characters.json`,
`wh-resources.json`, `wh-items.json`, `wh-sites.json`, `wh-hazards.json`,
`wh-creatures.json` (122 cards, defined through commit 21f99c5a) — so populating WH card
definitions is **out of scope** here.

**Legend:** ✓ done · △ partial · ✗ missing

MEWH is a 122-card expansion that introduces the **Fallen-wizard** player archetype: a
fifth alignment (alongside Wizard, Ringwraith, Balrog) that mixes hero *and* minion
resources, tracks **stage points** instead of caring about printed MP values, plays at
its own **Wizardhaven** sites, and follows a large body of special **Orc & Troll** rules.
A Fallen-wizard is mechanically "a METW Wizard with exceptions"; this spec enumerates
those exceptions and maps each to engine status.

---

## What already exists (no work here)

The deck/draft/alignment layer is already Fallen-wizard-aware:

- `Alignment.FallenWizard` and the `'stage'` / `'dual'` card alignments
  (`types/common.ts`).
- Deck validation (`deck-validation.ts`): FW copy limits (1× unique, 3× non-unique stage
  resource, 2× non-unique character, 2× non-unique hero resource, 2× non-unique minion
  resource), `FALLEN_WIZARD_BANNED_CARD_IDS`, and avatar-must-be-`alignment:'fallen-wizard'`.
- `alignment-rules.ts`: FW `maxStartingCompanySize: 5`, `maxStartingSites: 1`, default
  starting sites (White Towers / Ettenmoors, both versions), and the **−5 cross-alignment
  influence penalty** (FW vs Ringwraith/Balrog; Ringwraith/Balrog vs FW).
- WH card data incl. the 5 FW avatars (wh-1 Alatar, wh-4 Gandalf, wh-7 Pallando,
  wh-8 Radagast, wh-9 Saruman), the 4 FW sites (wh-55 Deep Mines, wh-56 Isengard,
  wh-57 Rhosgobel, wh-58 The White Towers), and wh-60 *A New Ringlord*.
- `isCovertCompany()` (`reducer-utils.ts`) already treats Orc/Troll (non-Half-orc) and the
  Balrog avatar as overt, honours ally `company-overt` effects, and applies the CRF-22
  Half-orc ruling.

Everything below is the **runtime gameplay** that is not yet wired.

---

## Summary

| # | MEWH rule area | Engine status | Work in this spec |
|---|---|---|---|
| 1 | **Stage points** — player-state counter, aggregation, start-with-3 | ✗ missing | New player-state field + derive from stage permanent-events |
| 2 | **Stage resources** — org-phase-only play, discard-not-below-3, corruption points apply | △ partial (discard + gating done; start-cards → §11, CP attribution deferred) | Phase gating + discard action + CP attribution |
| 3 | **Wizardhavens** — FW's 4 sites are havens *for this player*; METW/MELE havens are not | ✗ missing | Per-player haven resolution |
| 4 | **Marshalling points** — non-stage cards worth 1 MP; immune to hero/minion MP events; none stored at non-Wizardhaven | △ partial (core done; storage-site + Day-of-Reckoning deferred) | FW MP override in scoring |
| 5 | **Victory** — One Ring win gated on *A New Ringlord*; "Day of Reckoning" | ✓ done (gate confirmed; Day-of-Reckoning label deferred) | Gate + naming |
| 6 | **Corruption checks** — FW as minion; FW non-Orc/Troll chars as Wizard; stage-card CP applies | ✓ done (CP attribution → §2) | Per-character corruption-class resolution (also fixed base minion gap) |
| 7 | **Movement & site usage** — region movement only; draw even at Wizardhaven; hero/minion site selection rules | △ partial (region-force + draw done; site-version needs linkage model) | Site-eligibility + draw rules |
| 8 | **Attack permissions** — non-overt FW ↔ Wizard cannot attack; FW ↔ Ringwraith can; overt FW any | ✓ done | CvCC permission matrix |
| 9 | **Special Orc & Troll rules** — overt triggers, play-gating, hero-resource restrictions, Half-orcs | △ partial | Large; overt mostly done, the rest missing |
| 10 | **Resource targeting / playing at site / gold rings** — hero↔minion targeting bar; site-alignment match; −1 gold ring | △ partial (gold ring done; targeting/site-tap deferred) | Targeting guards + ring modifier |
| 11 | **Setup** — declare FW, opponent swap + 10 sideboard, start with stage cards, FW starting site | △ partial (mind ≤ 5 done; start-flow deferred) | New setup sub-step |
| 12 | **FW leaves play** — discard wizard-specific stage permanent-events | ✗ missing | Removal sweep |
| 13 | **Optional rules** — CvCC at >10 stage points; Wizard→FW conversion | ✗ missing | Optional/deferred |
| 14 | **Tournament rules** — sideboard sizes, reveal FW, stage cards as draft characters | △ n/a (single-deck cap already 30; rest → §11) | Mostly config/data |

The structurally new engine pieces are **§1 stage points**, **§3 Wizardhavens**,
**§4 FW marshalling points**, **§6 corruption-class resolution**, and the **§9** Orc/Troll
restriction matrix. The rest layer onto those.

---

## 1. Stage points — ✗ MISSING

**Rule.** Certain cards give the Fallen-wizard **stage points**, reflecting how far he has
deviated from his mission. The player keeps a running total. *Stage resource cards* are a
new resource type (`alignment: 'stage'`, "tarnished copper" background) playable only by FW
players; most give stage points.

There is **no** stage-point state, aggregation, or consumer anywhere in the engine
(`grep` for `stagePoint`/`stage point`/`wizardhaven` returns nothing in non-data `.ts`).

### 1.1 Data model

Stage points are **derived**, not a free-floating counter — they are the sum of stage
points printed on the FW player's stage permanent-events currently in play (plus FW-ability
/ stage-card modifiers). Per `feedback_reuse_pending_shapes`, do **not** add ad-hoc piles.

1. Add a `stagePoints?: number` field to the relevant stage card definitions' effect data
   (or a dedicated `stage-points` effect in the DSL — see below), so the value is read from
   card data, not model knowledge (`feedback_card_data`).
2. Add a **derived** `stagePoints: number` to `PlayerState` (or expose via
   `recompute-derived.ts`), computed as the sum over that player's in-play stage
   permanent-events. Recompute wherever derived stats are recomputed so it stays a single
   source of truth (mirrors the MP tally in `recompute-derived.ts`).
3. New DSL effect **`stage-points`** (value: number) declaring how many a card contributes;
   document in `docs/card-effects-dsl.md` (`feedback_dsl_docs`). Prefer this generic
   primitive over per-card keywords (`feedback_generalize_card_effects`).

### 1.2 Tests

`rule-mewh-stage-points.test.ts`: playing/removing stage permanent-events raises/lowers the
derived total; a stage card with a stage-point modifier effect adjusts a *named* card's
contribution; total is per-player and not visible to the opponent beyond projection rules.

---

## 2. Stage resources — △ PARTIAL

> **Implemented:** the **discard-a-stage-card** action — a new `discard-stage-resource`
> organization-phase action (`discardStageResourceActions` +
> `handleDiscardStageResource`), offered for an in-play stage permanent-event only when the
> resulting derived stage total stays ≥ 3, moving the card to the owner's discard pile.
> Added a shared `stagePointsOfCard` helper (reused by the §1 derivation). Stage
> permanent-events are already **org-phase-gated** (only the org-phase permanent-event
> computer offers them). Test: `rule-mewh-stage-resources.test.ts`.
>
> **Deferred (noted):** **start-with-stage-cards** belongs to setup (§11). **CP attribution
> of non-item stage cards** has no live consumer — the only stage cards carrying corruption
> points are *items* (wh-88/wh-89), already attributed via the normal item-bearing path; no
> certified non-item stage card prints corruption points, so building that path now would be
> speculative (`feedback_card_data`). The FW-specific deck-inclusion rule is a
> deck-validation concern.

**Rule.**

- A FW player **must attempt to start** with 1–3 stage **permanent-event** cards in play
  totalling exactly **3 stage points**; ≥1 must be **non-unique**; cards whose play
  conditions don't exist may not be started; revealed like starting characters (duplicate
  uniques discarded).
- During the organization phase only: the FW may **discard one** in-play stage resource —
  but **not if it would drop stage points below 3**.
- Stage **permanent-events** may be played **only during the organization phase** (unless a
  card says otherwise).
- Stage resources are FW-only; a card "specific" to another Fallen-wizard may not be
  included (deck-validation concern — confirm coverage).
- **Corruption points** printed on all **non-item** stage resource cards apply to the FW
  avatar (see §6).

### 2.1 Engine work

1. **Org-phase gating**: in `legal-actions/organization-events.ts`, restrict playing a
   `alignment:'stage'` permanent-event to the organization phase (unless the card carries
   an override effect).
2. **Discard-a-stage-card action**: a new organization-phase action that discards one
   in-play stage permanent-event, rejected if the resulting derived stage total < 3. Reuse
   the existing discard/removal path (`reducer-events.ts`) — never let a card disappear
   (`feedback_no_card_disappears`).
3. **Start-with-stage-cards** wires into setup (§11): the FW reveals 1–3 stage
   permanent-events summing to 3, ≥1 non-unique, play-conditions checked, duplicate uniques
   discarded.
4. **CP attribution**: non-item stage cards' corruption points add to the FW avatar's
   corruption-point total (consumed by §6).

### 2.2 Tests

`rule-mewh-stage-resources.test.ts`: stage permanent-event rejected outside org phase;
discard allowed when it keeps total ≥3 and rejected when it would drop below 3; a non-item
stage card raises the avatar's CP total.

---

## 3. Wizardhavens — ✗ MISSING

**Rule.** When rules and non-site cards refer to **Havens** and **Darkhavens**, for a FW
player they refer instead to his **Wizardhavens** (his FW haven sites: Isengard, The White
Towers, Rhosgobel; Deep Mines is R&L). METW Haven effects (healing, bringing characters
into play, tap-to-play resources, etc.) apply to FW companies **at Wizardhavens** and do
**not** apply at METW Havens (Grey Havens, Rivendell, Lórien, Edhellond) or MELE Darkhavens
(Minas Morgul, Dol Guldur, Carn Dûm, Geann a-Lisch).

Today "haven" is a global property of a site (`siteType === 'haven'`), independent of who
is standing there (`reducer-untap.ts` healing, movement-draw exception, etc.). MEWH makes
"is this a haven **for this player**" alignment-relative.

### 3.1 Engine work

1. **`isHavenForPlayer(site, player)` helper.** Returns true when `siteType === 'haven'`
   **and** the site's alignment is usable as a haven by that player:
   - Wizard/Ringwraith/Balrog: unchanged (their own havens/darkhavens).
   - **FW**: true only for FW Wizardhaven sites (`alignment: 'fallen-wizard'`, `siteType:
     'haven'`); **false** for METW hero havens and MELE minion darkhavens even though
     `siteType === 'haven'`.
   Centralize and route every current `siteType === 'haven'` gameplay check through it:
   untap healing (`reducer-untap.ts:151-182`), the movement no-draw-at-haven exception
   (`reducer-movement-hazard.ts:~3404`), bring-into-play, and any "tap to play at haven"
   site-rule.
2. **Non-site card references**: where card effects test "at a haven / darkhaven", resolve
   through `isHavenForPlayer` so a FW reads them as Wizardhaven.

### 3.2 Tests

`rule-mewh-wizardhavens.test.ts`: a FW company at Isengard heals on untap and may
bring characters into play; the same FW company at Rivendell or Minas Morgul does **not**;
a Wizard at Rivendell still heals (no regression).

---

## 4. Marshalling points (Fallen-wizard) — △ PARTIAL

> **Implemented (core).** `fwClampMp(baseMp, def, alignment)` in `recompute-derived.ts`:
> for a Fallen-wizard every non-stage card scores a flat **1** MP (positive values clamped;
> 0/negative pass through) while stage resources (`alignment: 'stage'`) score their printed
> MP. Threaded through `addMP`/`addItemMP`, the kill-pile contribution, and the storable-at
> override; the bearer-conditional item `mp-modifier` boost is suppressed for a FW (his
> items are a flat 1). Test: `rule-mewh-fallen-wizard-mp.test.ts`.
>
> **Deferred (noted):** (c) *no MP for cards stored at non-Wizardhaven sites* needs the
> storage site recorded on the stored instance (not tracked today). (d) general suppression
> of hero/minion `mp-modifier` **resource events** (Rumor of the One, etc.) vs FW-ability /
> stage-card modifiers needs a source tag on the modifier — no FW/stage MP-modifier cards
> are certified yet, so today every `mp-modifier` is a hero/minion one and the item boost is
> already suppressed. (e) the cosmetic "Day of Reckoning" projection label.

**Rule.**

- Stage resource MP is handled normally (as printed).
- **All other** MP cards are worth **only 1 MP each** to a FW, regardless of printed value.
- That 1 MP **cannot be modified by a hero or minion resource event** (Rumor of the One,
  Tribute Garnered, Sentinels of Númenor, etc.) — but **FW abilities and stage resource
  cards can** modify it.
- FW receives **no** MP for cards **stored at non-Wizardhaven sites**.
- At the Free Council, the FW's tally is his **"Day of Reckoning"** (cosmetic naming).

### 4.1 Engine work

In `recompute-derived.ts` MP tally (lines ~450-656):

1. When the scoring player's alignment is FW, clamp every **non-stage** MP contribution to
   **1** (characters, items, factions, allies, kills, misc) — except contributions coming
   from FW abilities / stage cards, which apply normally on top.
2. Suppress hero/minion **MP-modifier resource events** (`mp-modifier` effects) for FW
   scoring; still honour FW-ability and stage-card modifiers. Tag the modifier source so
   the override can tell them apart.
3. **No MP for non-Wizardhaven storage**: cards stored at a site that is not a Wizardhaven
   (use §3 `isHavenForPlayer`) award the FW 0 MP. Apply in the kill/stored-MP branch.
4. (Cosmetic) surface the FW total as "Day of Reckoning" in the player-facing projection /
   game messages; engine value unchanged.

### 4.2 Tests

`rule-mewh-fallen-wizard-mp.test.ts`: a 5-MP faction scores 1 for a FW but 5 for a Wizard;
a `mp-modifier` hero event does not change the FW's 1; a stage card that boosts a named
card's MP does; an item stored at a non-Wizardhaven site yields 0 MP to the FW; stage-card
MP scores as printed.

---

## 5. Victory conditions — ✓ DONE (One Ring gate)

> **Already satisfied / confirmed.** The Fallen-wizard One Ring win runs exclusively through
> *A New Ringlord* (wh-60), which is fully certified (`wh-60.test.ts`): played on the FW
> avatar bearing The One Ring at a Wizardhaven, it makes an end-of-turn `win-condition-roll`
> (>9 wins, <6 eliminates) handled by `scanEndOfTurnWinConditions` in
> `reducer-win-conditions.ts`. No *generic* avatar-bearing One Ring win exists for a FW: the
> Ringwraith Barad-dûr win (`checkOneRingWin`) is alignment-gated, and the Wizard's Cracks of
> Doom win card is in `FALLEN_WIZARD_BANNED_CARD_IDS`. Added the negative-gate rule test
> `rule-mewh-new-ringlord-win.test.ts` (a FW bearing The One Ring without A New Ringlord does
> not win or get eliminated at end of turn). *Deferred:* the cosmetic "Day of Reckoning" Free
> Council label, and the non-Wizardhaven storage MP exclusion (tracked in §4).

**Rule.** FW wins as a METW Wizard (opponent eliminated / recover The One Ring / most MP at
Free Council), with exceptions:

- One Ring win requires ***A New Ringlord*** (wh-60) to have been played and its conditions
  met.
- Free Council MP comparison is normal but is the FW's **Day of Reckoning** (§4).
- No MP for cards stored at non-Wizardhaven sites (§4).

`A New Ringlord` data exists (wh-60, a `win-condition-roll` on owner-end-of-turn gated on
avatar bearing The One Ring at a haven). Coordinate with `2026-06-08-one-ring-win-conditions.md`.

### 5.1 Engine work

In the One-Ring win-condition path (`reducer-win-conditions.ts`), when the *winning* player
is a FW, require that *A New Ringlord* is in play / has been played and satisfied — i.e. the
FW cannot win by The One Ring through the generic avatar-bearing path alone; the win must
flow through wh-60's effect. Verify wh-60's certification enforces "conditions met".

### 5.2 Tests

`rule-mewh-new-ringlord-win.test.ts`: a FW avatar bearing The One Ring at a Wizardhaven does
**not** win without *A New Ringlord* in play; with it played and satisfied, the win
triggers.

---

## 6. Corruption checks (Fallen-wizard) — ✓ DONE

> **Implemented.** `classifyCorruptionOutcome(charDef, ownerAlignment, total, cp)` in
> `reducer-utils.ts` returns `success | tap-success | discard | eliminate` per CoE 7.1 /
> 7.1.F1; both corruption resolvers (`reducer-free-council.ts` and `pending-reducers.ts`)
> dispatch on it and add the new **tap-success** branch (character taps, stays in play, the
> check counts as successful). This also closed the **base minion gap** (minion characters
> were previously discarded on CP/CP−1 instead of tapping). The FW avatar taps; a FW's
> non-Orc/Troll character is treated as a hero (discard); a FW's Orc/Troll taps. Tests:
> `rule-mewh-corruption.test.ts`, `10.06-fw-orc-troll-corruption` (todo completed),
> existing `rule-10.01` still green. *Remaining:* non-item stage-card CP attribution to the
> FW avatar is part of §2.

**Rule.**

- A **Fallen-wizard avatar**'s corruption check is handled **as a minion**: if the roll
  equals his CP total **or one less**, he is **tapped instead of discarded**, and is **not**
  considered to have failed.
- A FW's **non-Orc/non-Troll** character's check is handled **as a Wizard** (i.e. normal
  hero rules).
- **Orc/Troll** characters' checks are handled **as a minion** (tap on CP/CP−1, not a fail).
- Corruption points on all **non-item stage resource cards** apply to the FW avatar (§2).

The "minion tap-not-discard on CP/CP−1" rule is **not implemented at all** today —
`resolveCorruptionCheck()` (`reducer-free-council.ts`) discards on CP−1 and eliminates on
CP−2+ for every alignment, with a special wizard-avatar-always-eliminated branch. So this
section also closes a **base minion gap**, not just a FW one.

### 6.1 Engine work

In `resolveCorruptionCheck()`, classify each character's corruption-resolution **mode**:

- **Minion-mode** (tap on roll = CP or CP−1, no fail): true for any character owned by a
  Ringwraith/Balrog player; for a **FW avatar**; and for **Orc/Troll** characters owned by
  a FW.
- **Hero/Wizard-mode** (existing discard-on-CP−1 / eliminate further; wizard avatar always
  eliminated on any fail): Wizard players, and a **FW's non-Orc/non-Troll** characters.

Drive the branch off a `corruptionMode(character, ownerAlignment)` helper rather than the
current alignment-blind path. Ensure the FW avatar uses minion-mode (tap, no fail) while a
true Wizard avatar keeps "eliminated on any fail".

### 6.2 Tests

`rule-mewh-corruption.test.ts`: FW avatar rolling CP−1 is **tapped, not discarded**, and the
check is not a failure; a FW's Man character rolling CP−1 is **discarded** (Wizard-mode); a
FW's Orc rolling CP−1 is **tapped** (minion-mode); a non-item stage card raises the FW
avatar's CP and thus the tap threshold. Add a base regression: a Ringwraith character rolling
CP−1 is tapped (minion-mode), guarding the newly-introduced general rule.

---

## 7. Movement & site usage — △ PARTIAL

> **Implemented:** **draw-at-Wizardhaven** (§3, merged) and now **forced region movement** —
> a Fallen-wizard company's reachable destinations are filtered to `movementType === 'region'`
> in `planMovementActions` (`organization-companies.ts`), so starter (printed-path) movement
> is never offered to a Fallen-wizard (MEWH §7). Test: rule-3.43 `[FALLEN-WIZARD]` case
> (Edhellond is starter-only from Lórien — a Wizard may move there, a FW may not).
>
> **Deferred (noted):** the **hero/minion site-version selection** rules (non-overt FW uses
> hero sites for non-R&L; either version for R&L; the opposite version barred when in
> play/discard; Agents use hero sites) need a canonical hero↔minion **site-linkage** data
> model that does not yet exist — best done as its own sub-spec. The site-type-change
> exchange depends on the same model.

- FW companies **must use region movement**.
- Moving to a site, **both players draw** based on the destination — **even at a
  Wizardhaven** (no haven no-draw exception for FW).
- METW Havens and MELE Darkhavens are **not havens** for the FW (§3).
- **Non-overt** FW companies must use **hero** sites for sites that are **not** Ruins &
  Lairs.
- FW companies may freely use **either** minion or hero **Ruins & Lairs** sites, per site.
- If the hero (or minion) version of a site is **in play or in your discard pile**, you may
  not use the minion (or hero) version of that **same** site.
- Cards that **change a site's type** (Plotting Ruin, Heart Grown Cold, …) cause an
  immediate exchange of affected in-play site cards for the corresponding type.
- **Agents**: a FW moving an Agent hazard must use **hero** sites; if the minion version of
  a site is in play/discard, agents may not use/reveal the hero version.
- (Overt-company site rules are in §9.)

This needs a site/version model that links hero↔minion versions of the "same" site. The
investigation found **sites are independent `CardDefinitionId`s with no linkage** — so a
**canonical-site-name** mapping is prerequisite.

### 7.1 Engine work

1. **Force region movement** for FW companies in `legal-actions/organization-companies.ts`
   (no full-movement/long-event shortcuts that bypass region movement).
2. **Draw-at-Wizardhaven**: in the movement draw logic
   (`reducer-movement-hazard.ts:~3380-3450`), do **not** apply the haven no-draw exception
   when the mover is a FW arriving at a Wizardhaven — draws happen normally.
3. **Site-version selection rules**: introduce a canonical site key (e.g. a `siteName` /
   `canonicalSite` field shared by hero & minion versions). On choosing which version of a
   site to use:
   - non-overt FW must pick the **hero** version for non-R&L sites;
   - R&L may be either version;
   - reject a version whose **opposite** version is in play or in the FW's discard pile.
4. **Site-type-change exchange**: when a `site-type-change` effect alters a site already in
   play, swap the in-play card for the corresponding-type version (extend the existing
   site-type-change handling).
5. **Agents use hero sites**: in the Agent-movement path, force hero site versions with the
   same in-play/discard opposite-version restriction.

### 7.2 Tests

`rule-mewh-movement-site-usage.test.ts`: FW company is forced into region movement; a FW
arriving at Isengard still triggers draws; a non-overt FW at a non-R&L site is offered only
the hero version; with the hero version in discard, the minion version is unavailable; a
site-type-change swaps the in-play site card; an Agent uses the hero version.

---

## 8. Attack permissions — ✓ DONE

> **Implemented.** `canAttackAlignment(attacker, defender, attackerCovert, defenderCovert)`
> moved into `reducer-utils.ts` (was a private, overt-blind copy in `reducer-site.ts` plus
> an inlined duplicate in `legal-actions/site.ts` — both now call the shared helper). An
> overt FW may attack anyone and may be attacked by anyone; a covert FW and a Wizard may not
> attack each other; FW ↔ Ringwraith always. Covert status comes from `isCovertCompany` at
> both CvCC call sites (`hasCvCCAttackTargets` and `handleDeclareCompanyAttack`). Test:
> `rule-8.41-cvcc-alignment-restrictions.test.ts` extended with overt/covert cases (the old
> overt-blind "Wizard can attack Fallen-wizard" assertion was corrected).

**Rule.**

- FW companies may attack **Ringwraith** companies and vice versa (MELE p. 80).
- **Non-overt** FW companies and **Wizard** companies may **not** attack each other.
- **Overt** FW companies may attack **any** company controlled by another player and vice
  versa (see §9).

### 8.1 Engine work

Centralize a **`canAttack(attackerCompany, defenderCompany)`** permission used by the
company-vs-company / face-up attack legal actions:

- FW(overt) ↔ anyone: allowed.
- FW(non-overt) ↔ Ringwraith/Balrog: allowed.
- FW(non-overt) ↔ Wizard: **forbidden**.
- (Optional CvCC at >10 stage points is §13.)

### 8.2 Tests

`rule-mewh-attack-permissions.test.ts`: a non-overt FW company cannot initiate CvCC against
a Wizard company (and vice versa); a FW company can against a Ringwraith company; an overt FW
company can against any opponent.

---

## 9. Special Orc & Troll rules — △ PARTIAL

> **Implemented (hero item on Orc/Troll bearer).** In `recompute-derived.ts`, an Orc/Troll
> bearer's effective-stats computation drops every effect sourced from a `hero-resource-item`
> (so DSL stat-modifiers and item abilities are ignored) and skips the structural
> prowess/body bonus; the item's **corruption points still apply** (a cost, not a bonus), as
> do movement/playability restrictions. Test: `rule-mewh-orc-troll-hero-item.test.ts`.
>
> **Already done earlier:** overt detection incl. Half-orc exception (`isCovertCompany`);
> Orc/Troll corruption-as-minion (§6).
>
> **Already done (verified):** Half-orcs cannot take trophies — `reducer-combat.ts` already
> excludes `isHalfOrc` characters from the trophy-eligible set (`!isHalfOrc(def)`).
>
> **Implemented (company composition).** The base race-mixing restriction (CoE 3.25,
> `wouldViolateRaceMixing`) already bars Orc/Troll from sharing a company with
> Elf/Dwarf/Dúnadan/Hobbit (Man excluded) at non-haven sites. The MEWH gap was the *haven
> exception*: `companyAtHaven` now resolves the haven through `isHavenForPlayer(siteDef,
> alignment)`, so a Fallen-wizard's exception applies only at his Wizardhavens — at a METW
> Haven the restriction still holds. Non-Fallen-wizard behaviour is unchanged. Test:
> `rule-mewh-orc-troll-company.test.ts` (Orc may join a Hobbit company at Isengard, not at
> Rivendell).
>
> **Implemented (no hero perm-event on Orc/Troll company).** In the company-targeting
> permanent-event path (`organization-events.ts`), a Fallen-wizard's hero (wizard-aligned)
> permanent-event is not offered on a company containing an Orc/Troll (`companyHasOrcOrTroll`,
> Half-orcs included via `race: Orc`). Test: `rule-mewh-hero-event-orc-troll.test.ts`
> (Fellowship playable on an all-Man company, not once an Orc joins).
>
> **Still missing (each its own follow-up):** play-gating
> Orc/Troll until a permitting stage card; overt site-version usage (needs the
> §7 site-linkage model); detainment classification of overt companies; and the remaining
> hero-resource targeting/skill/tap restrictions on Orc/Troll (overlap with the
> §10 targeting bar).

**Rule (whole MEWH section).**

- A company with **any Orc/Troll character** is **overt**. So is a company with any of:
  Great Bats, Great Lord of Goblin-gate, Last Child of Ungoliant, Regiment of Black Crows,
  Two-Headed Troll (ally `company-overt`).
- **Half-orcs**: a company of only Half-orcs and Men is **not overt**; Half-orcs **cannot
  take trophies**; otherwise a Half-orc is an Orc for all purposes.
- You may **not play Orc/Troll characters** until you have played the appropriate stage card
  (e.g. *Bad Company*).
- Unless at a **Wizardhaven**, an Orc/Troll **cannot share a company** with an Elf, Dwarf,
  Dúnadan, or Hobbit.
- Orc/Troll corruption checks handled **as a minion** (§6).
- **Overt** companies must use **hero** sites for Shadow-holds, Dark-holds, and minion
  Darkhavens; **minion** sites for Border-holds, Free-holds, and hero Havens.
- Overt companies are **not** minion companies for the MELE detainment-attack guidelines
  (p. 31), but **are** minion companies for hazards that only attack/affect minion companies
  (e.g. *Sons of Kings*).
- **No hero resource permanent-event** may be played on a company containing an Orc/Troll.
- A hero resource may **not target** an Orc/Troll (Block, Escape, …).
- A hero resource requiring a specific **skill** may not use an Orc/Troll to fulfil it
  (Concealment, Many Turns and Doublings, …).
- An Orc/Troll may **not tap to initiate** a hero-resource effect (Praise to Elbereth, Great
  Ship, …).
- An Orc/Troll may **bear a hero item**, but **all bonuses/special abilities are ignored**
  (movement/playability restrictions still apply).

### 9.1 Status

| Sub-rule | Status | Gap |
|---|---|---|
| Orc/Troll ⇒ overt; named allies ⇒ overt; Half-orc covert exception | ✓ | `isCovertCompany()` (`reducer-utils.ts`) handles all three. |
| Orc/Troll corruption as minion | ✗ | Covered by §6 corruption-mode. |
| Half-orcs cannot take trophies | ✓ | `reducer-combat.ts` excludes `isHalfOrc` from trophy-eligible. |
| Play-gating: no Orc/Troll until *Bad Company*-type stage card | ✗ | No prerequisite check on bringing Orc/Troll into play. |
| Orc/Troll cannot company with Elf/Dwarf/Dúnadan/Hobbit unless at Wizardhaven | ✗ | No company-composition guard. |
| Overt site usage (hero for Shadow/Dark/minion-Darkhaven; minion for Border/Free/hero-Haven) | ✗ | §7 selection logic must add the overt branch. |
| Detainment: overt not minion (p.31) but is minion for minion-only hazards | ✗ | `detainment.ts` has no overt/FW special-case. |
| No hero resource perm-event on company with Orc/Troll | ✗ | No play-target guard. |
| Hero resource cannot target Orc/Troll | ✗ | Targeting guard (§10). |
| Hero skill requirement can't use Orc/Troll | ✗ | Skill-requirement guard. |
| Orc/Troll can't tap to initiate hero resource | ✗ | Tap-to-initiate guard. |
| Orc/Troll bears hero item but bonuses/abilities ignored | ✗ | Effective-stats must zero hero-item bonuses for Orc/Troll bearers. |

### 9.2 Engine work

1. **Trophy restriction**: in the trophy/kill-MP attribution, an Orc that `isHalfOrc` cannot
   take a trophy (the kill awards no trophy to a Half-orc).
2. **Play-gating**: bringing an Orc/Troll character into play requires the FW to have an
   in-play "allows Orc/Troll" stage card. Model as a generic capability flag set by such
   stage cards (a `permits-orc-troll` effect) rather than naming *Bad Company*
   (`feedback_generalize_card_effects`); gate character placement / bring-into-play on it.
3. **Company composition**: reject placing/moving an Orc/Troll into a company containing an
   Elf/Dwarf/Dúnadan/Hobbit unless that company is at a Wizardhaven (§3). Enforce in
   organization-phase company edits and movement.
4. **Overt site usage**: extend §7 site-version selection with the overt branch (hero for
   Shadow-hold/Dark-hold/minion Darkhaven; minion for Border-hold/Free-hold/hero Haven).
5. **Detainment**: in `detainment.ts`, an overt FW company is **not** treated as a minion
   company for the detainment guideline, but **is** for hazards flagged "minion companies
   only".
6. **Hero-resource restrictions on Orc/Troll** (a cluster, mostly targeting/initiation):
   - no hero resource permanent-event played on a company containing an Orc/Troll;
   - hero resources cannot target an Orc/Troll (ties into §10 targeting guard);
   - hero skill-requirement effects skip Orc/Troll characters when collecting eligible
     skill-bearers;
   - Orc/Troll cannot be the tapping character to initiate a hero-resource effect.
   Implement as predicates in the play-target / skill-collector / tap-to-initiate
   collectors, keyed on `race ∈ {Orc, Troll}` (and hero alignment of the resource).
7. **Hero item on Orc/Troll bearer**: in `effective.ts` / `recompute-derived.ts`, when an
   Orc/Troll bears a **hero** item, ignore its stat bonuses and special abilities while
   keeping movement/playability restrictions.

### 9.3 Tests

`rule-mewh-orc-troll.test.ts` (split if large): play-gating before/after the permitting
stage card; Orc cannot join a company with a Hobbit except at a Wizardhaven; overt company
site-version usage; detainment classification both ways; hero perm-event rejected on an
Orc/Troll company; hero resource cannot target/skill-use/tap an Orc/Troll; a hero item's
bonus is ignored on an Orc bearer but applied on a Man bearer; Half-orc takes no trophy.

---

## 10. Resource targeting, playing at a site, gold rings — △ PARTIAL

> **Implemented (gold ring).** A Fallen-wizard testing a **hero** gold ring
> (`hero-resource-item`) rolls at −1, applied in the gold-ring-test resolution
> (`pending-reducers.ts`); minion gold rings and other alignments are unaffected. Test:
> `rule-mewh-gold-ring.test.ts`.
>
> **Implemented (site-tap alignment match).** `siteTapCrossAlignmentBlocked` in
> `legal-actions/site.ts`: a Fallen-wizard's site-tapping resource (faction, ally, item)
> is barred when its alignment class mismatches the site (hero resource at a minion site or
> vice versa). Fallen-wizard sites (Wizardhavens) count as both and FW/stage/dual resources
> are exempt; gated on `player.alignment === 'fallen-wizard'` (single-alignment players
> always match). Test: `rule-mewh-site-tap-alignment.test.ts`. (The FW-site "counts as both"
> branch is in the guard but the four FW sites list no playable resources, so it has no
> item-play consumer to exercise.)
>
> **Deferred (noted):** the cross-alignment **targeting bar** (a hero resource event can't
> target/affect a minion site/resource and vice versa, Spells/Magic exempt). This is a
> diffuse change across every effect's target collector; in normal play, site/play
> restrictions already prevent most cross-alignment targeting, so it is left for a focused
> follow-up with concrete card consumers.

**Rule.**

- A **hero** resource may not target/affect a **minion** site or minion resource; a
  **minion** resource may not target/affect a **hero** site or hero resource. *(Exception:
  Spells and Magic are not subject to this.)*
- To play a non-FW resource that **taps a site**, the **site and the resource must be the
  same alignment** (both hero or both minion). A FW site (or any Wizardhaven) counts as
  **both** hero and minion. Applies to factions, allies, items, and other site-tapping plays.
- A FW testing a **hero gold ring** modifies the roll by **−1**. (When a gold-ring test
  indicates a ring type, the FW may play either a hero or minion ring of that type.)

### 10.1 Engine work

1. **Targeting guard**: in the play-target collectors, when the playing card is a hero
   resource, exclude minion sites/resources as targets and vice versa — unless the card is a
   Spell/Magic. Centralize as a `crossAlignmentTargetAllowed(source, target)` predicate.
2. **Site-tap alignment match**: in `legal-actions/site.ts`, gate playing a site-tapping
   non-FW resource on `resource.alignment === site.alignment`, with FW sites / Wizardhavens
   treated as wildcard (both).
3. **Gold ring −1 for FW**: in the gold-ring test resolution
   (`pending-reducers.ts:~1418-1561`), add −1 to the roll when the tester is a FW and the
   ring is a **hero** gold ring. Allow the resulting ring play to be either-alignment.

### 10.2 Tests

`rule-mewh-targeting-and-sites.test.ts`: a hero resource cannot target a minion resource
(and a Spell can); a hero faction cannot be played tapping a minion site but can at a FW
site; a FW hero gold-ring test is at −1 and the offered ring may be hero or minion.

---

## 11. Setup — △ PARTIAL

> **Implemented (mind ≤ 5):** a Fallen-wizard may not start or bring into play any character
> with mind > 5. Guard in `playCharacterActions` (`organization-characters.ts`); completes
> the `rule-3.16-fw-character-mind-limit` todo (a mind-9 character is non-viable for a FW,
> viable for a Wizard). Already in `alignment-rules.ts`: FW starting sites and
> `maxStartingCompanySize: 5`.
>
> **Deferred (noted):** the **declare-Fallen-wizard** setup step + opponent Wizard-swap /
> +10 sideboard; **start-with-stage-cards** (1–3 stage permanent-events totalling 3, ≥1
> non-unique); Orc/Troll start-gating; the broader R&L-in-Rhudaur/Arthedain starting sites;
> and the Hidden Haven option — these are a substantial new setup sub-flow best built as a
> dedicated effort.

**Rule.**

- The FW must **declare which Fallen-wizard** he plays **before** choosing starting
  companies. The opponent may then **replace** any matching hero Wizard cards in his deck /
  sideboard with other available Wizards, and may **add 10 cards** to his sideboard
  (preselected anti-FW).
- The FW's location deck may include **multiple** copies of the 4 FW sites but only **one**
  of each hero/minion site.
- The FW **starts with stage cards** (§2): 1–3 stage permanent-events totalling 3 points,
  ≥1 non-unique, conditions checked, revealed like starting characters.
- Starting characters: up to 5, hero **and** minion, **mind ≤ 5**; **no Orc/Troll** unless
  started with an appropriate stage card (e.g. *Bad Company*).
- Starting site: **The White Towers**, or any **Ruins & Lairs in Rhudaur or Arthedain**. If
  starting at an R&L site, one starting stage card may be a **Hidden Haven** played there.
- The FW may only start at his home site (avatar); no character with mind > 5 may be started
  or brought into play.

`alignment-rules.ts` already restricts FW starting sites to White Towers / Ettenmoors and
caps starting company size at 5; deck-validation enforces FW copy limits. Missing: the
**declare-FW** step, opponent swap + 10-sideboard, **start-with-stage-cards**, the
mind ≤ 5 start filter, Orc/Troll start-gating, the broader R&L-in-Rhudaur/Arthedain starting
sites, and the Hidden Haven option.

### 11.1 Engine work

1. **Declare-Fallen-wizard step** (new `SetupStep`, before character draft / company
   choice): the FW commits to an avatar; record it so the opponent's Wizard-swap and
   +10-sideboard can be offered (the swap/sideboard may be a lobby/deck-build concern —
   scope the engine portion to recording the declaration and exposing it).
2. **Start-with-stage-cards sub-step**: reveal 1–3 stage permanent-events summing to 3
   points, ≥1 non-unique, play-conditions checked, duplicate uniques discarded; place them
   in play (feeds §1/§2).
3. **Mind ≤ 5 start filter** and **Orc/Troll start-gating** (only if a permitting stage card
   is among the started stage cards) in the starting-character selection.
4. **Starting-site widening**: allow The White Towers or any R&L site in **Rhudaur /
   Arthedain** (extend `defaultStartingSites` / the starting-site eligibility to a
   region-predicate, not a fixed id list). Confirm against CRF — the current code allows
   White Towers/Ettenmoors only.
5. **Hidden Haven** option on an R&L starting site (one starting stage card).

### 11.2 Tests

`rule-mewh-setup.test.ts`: FW must reveal stage cards totalling 3 with ≥1 non-unique; a
mind-6 starting character is rejected; an Orc cannot be started without the permitting stage
card; starting at an Arthedain R&L is allowed and a Hidden Haven may be played there;
declaration of the FW is recorded.

---

## 12. Fallen-wizard leaves play — ✗ MISSING

**Rule.** If the FW avatar leaves play, **discard all in-play stage permanent-events
specific to that wizard** (e.g. Alatar's, if you are Alatar). As normal, all hazard
permanent-events on the avatar are discarded.

### 12.1 Engine work

In the avatar-removal sweep (`reducer-events.ts` / `postReduce`), when a FW avatar leaves
play, route every in-play **wizard-specific** stage permanent-event owned by that player to
its owner's discard (key on a `fallen-wizard-specific` marker in card data — already implied
by the "Alatar specific" text). Never drop an instance silently
(`feedback_no_card_disappears`).

### 12.2 Tests

`rule-mewh-wizard-leaves-play.test.ts`: when the FW avatar is removed, its wizard-specific
stage permanent-events are discarded while non-specific stage cards remain; no instance
disappears.

---

## 13. Optional rules — ✗ MISSING (deferred)

- **Company vs. Company combat**: a company containing a FW with **>10 stage points** may
  initiate CvCC against any opponent company, and vice versa. Layers onto §8 `canAttack`
  (consult the derived stage total from §1). Gate behind an "optional rules enabled" flag.
- **Wizard→Fallen-wizard conversion**: a Wizard player who fails a corruption check by 0/1
  may, with the right sideboard cards, convert to a FW (replace avatar, play a ≤3-point
  stage card, resume under FW rules). Substantial; **deferred** unless prioritized.

Mark both as out-of-scope-for-now unless explicitly requested; note the §8/§1 hook points.

---

## 14. Tournament rules — △ PARTIAL (n/a for the modeled game)

> **Assessed:** the engine models a **single-deck** game. The standard sideboard cap is
> already 30 (`deck-validation.ts` rule 1.31), which equals the Fallen-wizard 1-/2-deck
> tournament size — so there is no FW-specific gap for the modeled format; the 35/40 sizes
> apply only to 3-/4-deck tournament formats that are not modeled. **Reveal the
> Fallen-wizard** and **stage cards as draft characters** fold into the §11 setup work.

- **Stage cards as draft characters**: when the Character Draft is used, treat starting
  stage cards as characters. Wire into the draft once §11 start-with-stage-cards exists.
- **Sideboard sizes** (FW): 30 (1- and 2-deck), 35 (3-deck), 40 (4-deck). Deck-validation /
  lobby config — confirm and adjust the FW sideboard-size limit.
- **Reveal the Fallen-wizard** before the game in general-opponent format — surfaced by §11
  declaration.

Mostly configuration/data; fold into §11 and deck-validation.

---

## Implementation order

1. **§1 Stage points** — derived player-state value + `stage-points` DSL effect. Foundation
   for §2, §4, §13.
2. **§6 Corruption-class resolution** — self-contained reducer fix; also closes a base
   minion gap. High value, low blast radius.
3. **§3 Wizardhavens** — `isHavenForPlayer` helper threaded through healing/draw/site rules.
   Prerequisite for §4 storage and §7/§9 site usage.
4. **§4 Fallen-wizard marshalling points** — scoring override (needs §1 + §3).
5. **§2 Stage resources** — org-phase gating, discard action, CP attribution (needs §1).
6. **§10 Targeting / site-tap / gold ring** — localized legal-action guards.
7. **§8 Attack permissions** — `canAttack` matrix.
8. **§7 Movement & site usage** — region-movement force, draw-at-Wizardhaven,
   site-version selection (needs the canonical-site-name model).
9. **§9 Special Orc & Troll rules** — the largest cluster; builds on §3/§6/§7/§10.
10. **§11 Setup** — declare-FW + start-with-stage-cards + start filters (needs §1/§2).
11. **§12 FW leaves play** — removal sweep.
12. **§5 New Ringlord win gate** — coordinate with the One-Ring win-conditions spec.
13. **§13/§14 optional + tournament** — last, behind flags / config.

---

## Tests index

New test files under `packages/shared/src/tests/rules/`:

| File | Covers |
|---|---|
| `rule-mewh-stage-points.test.ts` | §1 |
| `rule-mewh-stage-resources.test.ts` | §2 |
| `rule-mewh-wizardhavens.test.ts` | §3 |
| `rule-mewh-fallen-wizard-mp.test.ts` | §4 |
| `rule-mewh-new-ringlord-win.test.ts` | §5 |
| `rule-mewh-corruption.test.ts` | §6 (+ base minion regression) |
| `rule-mewh-movement-site-usage.test.ts` | §7 |
| `rule-mewh-attack-permissions.test.ts` | §8 |
| `rule-mewh-orc-troll.test.ts` | §9 |
| `rule-mewh-targeting-and-sites.test.ts` | §10 |
| `rule-mewh-setup.test.ts` | §11 |
| `rule-mewh-wizard-leaves-play.test.ts` | §12 |

Use FW/minion fixtures per the package testing convention. All test changes go through a PR
for wigy's review — never committed directly to master (`feedback_test_changes_review`,
`feedback_no_auto_merge_test_prs`).

---

## Out of scope

- Populating / certifying individual WH card definitions (data already defined; per-card DSL
  wiring tracked under card certification).
- The opponent-side deck-build mechanics of the FW declaration (Wizard swap + 10 anti-FW
  sideboard) beyond recording the declaration in engine state — likely a lobby/deck-editor
  concern.
- **§13 Wizard→Fallen-wizard conversion** (optional rule) — deferred unless prioritized.
- Geann a-Lisch and any MELE Darkhaven data corrections needed for §3 (verify, don't fix
  here).
- The canonical hero↔minion **site-linkage data model** (§7) is a prerequisite that may
  warrant its own small spec if no `siteName`/`canonicalSite` field exists yet.
