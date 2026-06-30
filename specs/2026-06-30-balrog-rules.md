# The Balrog (MEBA) — Rules Implementation Spec

Status tracker for implementing the MECCG *Middle-earth: The Balrog* (MEBA)
expansion rules.
Source: `https://meccg.com/rules/by-expansion/the-balrog/` (text extracted
verbatim from the MEBA Rulesbook, no modifications).

Scope is **rule-engine mechanics only**. Per-card DSL wiring is tracked separately
under card certification. Card **data** files already exist
(`ba-characters.json`, `ba-sites.json`, `ba-items.json`, `ba-resources.json`,
`ba-hazards.json`, `ba-creatures.json`); populating remaining BA card *definitions*
is out of scope here.

**Legend:** ✓ done · △ partial · ✗ missing

The Balrog is a self-contained avatar alignment built on top of the Ringwraith
(minion) rules: a Balrog player "acts as a Ringwraith player," so most of MELE
already applies. `Alignment.Balrog` exists, `alignment-rules.ts` carries the Balrog
entry (starting company size 6, starting sites Moria + The Under-gates, 2 starting
sites), and deck construction (rules 1.18–1.29) is already largely enforced in
`deck-validation.ts`. Under-deeps **sites** and **movement** are already implemented
(see `specs/2026-05-11-under-deeps-movement.md` and `specs/2026-06-21-against-the-shadow-rules.md`
§6/§7). This spec closes the remaining **Balrog-specific** gaps.

---

## Summary

| # | MEBA rule | Engine status | Work in this spec |
|---|-----------|---------------|-------------------|
| 1 | Balrog player acts as a Ringwraith | ✓ done | confirmation tests only |
| 2 | The Balrog avatar: ring auto-test −2 | ✓ done | confirmation test |
| 3 | The Balrog avatar: bears but **cannot use** items | ✗ missing | **implement** item-no-effect for Balrog avatar's company |
| 4 | The Balrog avatar: no corruption checks | ✓ done | confirmation test |
| 5 | The Balrog avatar: company always overt | ✓ done | confirmation test |
| 6 | The Balrog avatar: no starter / region movement | △ partial | **implement** region-movement block + Balrog-card test |
| 7 | No Barad-dûr ring auto-test; no storing at Barad-dûr | ✗ missing | **implement** Balrog Barad-dûr exceptions |
| 8 | Victory: Day of Decision via Sudden Call; One-Ring gated by Challenge the Power | △ partial | **complete** Challenge-the-Power win resolution |
| 9 | Deck construction (factions, mind<9, sites, bans) | ✓ done | audit + MEBA-named tests |
| 10 | Starting sites Moria / The Under-gates | ✓ done | confirmation test |
| 11 | Draw cards on **every** Balrog company move (incl. Darkhavens) | △ partial | verify + close gap |
| 12 | The Balrog must enter at The Under-gates (not Moria) | ✗ missing | **implement** avatar entry-site restriction |
| 13 | Two characters per organization phase (2nd non-unique) | ✗ missing | **implement** Balrog double bring-into-play |
| 14 | Non-unique mind ≤ 3 may enter from hand / discard / sideboard | ✗ missing | **implement** alternate source set |
| 15 | "Any Dark-hold" home site → "Any non-Dark-hold Under-deeps site" | ✗ missing | **implement** home-site remap |
| 16 | Agents may not be played as characters; count as hazards | △ partial | confirm play-as-character ban (deck half-creature ✓) |
| 17 | Opponent's banned cards vs a Balrog player + sideboard swap | △ partial | **implement** opponent-conditional bans + swap option |
| 18 | Ignore Balrog automatic-attacks once the Balrog is in play / defeated | ✗ missing | **implement** auto-attack suppression |
| 19 | Spawn creature classification | ✓ done | confirmation test |
| 20 | Defeating a permanent-event yields kill-MP | ✓ done | confirmation test |
| 21 | "Off to the side" placement zone | ✗ missing | cross-ref AS spec §1 — implement there |
| 22 | Cards with multiple actions (reverse-declared chain) | △ partial | verify chain ordering; close if absent |
| 23 | Discard cards played on a card when it leaves play | ✓ done | confirmation test |
| 24 | Tournament: Spawn = ½ creature; Balrog +5 GI | ✓ done | confirmation tests |
| 25 | Under-deeps sites + movement (incl. Drowning/Rusted-deeps roll-13) | ✓ done | cross-ref under-deeps spec |

The structurally new engine work is **§3, §6 (region block), §7, §8, §11–§15,
§17, §18**. Everything else is test-only, already covered, or tracked in another
spec.

---

## What already exists (no implementation work)

- `Alignment.Balrog` (`packages/shared/src/types/common.ts:185`).
- `alignment-rules.ts:44` — Balrog rule row: `maxStartingCompanySize: 6`,
  `defaultStartingSites: [MORIA_BALROG, THE_UNDER_GATES]`, `maxStartingSites: 2`.
- **Corruption immunity** — Balrogs never make corruption checks
  (`rule-10.09-corruption-immunity.test.ts`).
- **Always overt** — a Balrog avatar makes its company overt
  (`reducer-utils.ts:2224`); CvCC alignment matrix handles attacks on/from Balrog
  companies (`rule-8.41-cvcc-alignment-restrictions.test.ts`).
- **Detainment** — Balrog defenders use detainment attacks like Ringwraiths
  (`reducer-site.ts:1186`).
- **Ring auto-test −2** — every gold ring in a Ringwraith/Balrog company is
  auto-tested at end of turn with a base −2 modifier
  (`reducer-site.ts:2845`+; CoE 9.23).
- **Deck construction** — `deck-validation.ts` enforces rules 1.18 (bans),
  1.20–1.22 (minion characters; Orc/Troll only; mind < 9 unless Balrog-specific;
  agents as ½-creature hazards; faction races Orc/Troll/Wolf/Animal/Dragon),
  1.21/1.26/1.27/1.29 (minion resources, hero/minion/balrog site decks).
- **Spawn = ½ creature** toward the 12-creature minimum
  (`deck-validation.ts:633`).
- **+5 general influence** for Balrog players (`rule-1.56-balrog-extra-gi.test.ts`).
- **Spawn keyword** in card data and types; **manifestation cascade** for
  Balrog of Moria (`manifestations.ts`).
- **Permanent-event kill-MP** — defeating a Spawn/Dragon permanent-event awards
  kill-MP to the defender (`combat-finalize.ts:557`).
- **Sudden Call / Day-of-Decision gating** — Minion/Balrog players cannot freely
  call the endgame (`rule-10.41-minion-balrog-sudden-call.test.ts`,
  `end-of-turn.ts:188`); see `specs/2026-04-20-sudden-call-plan.md`.
- **Challenge the Power** win-condition scaffolding
  (`reducer-win-conditions.ts`, ba-52) — see §8.
- **Discard attached cards** when a host leaves play — `discardOrphaned*` sweeps
  in `reducer.ts:43` / `reducer-utils.ts`.
- **Under-deeps sites & movement** — `MovementType.UnderDeeps`, `adjacentSites`,
  2d6 roll, no site path, surface-site adjacency
  (`specs/2026-05-11-under-deeps-movement.md`).

---

## 1. Balrog player acts as a Ringwraith — ✓ DONE

**Rule.** "A Balrog player acts as a Ringwraith player. Any card and rules text
applying to a Ringwraith also applies to The Balrog."

This is realised by `Alignment.Balrog` being treated identically to
`Alignment.Ringwraith` at every minion decision point. The canonical helper is
`isMinionOrBalrog(player)` (`state-utils.ts`), already used in end-of-turn,
detainment, and CvCC code.

**Engine work.** None. Audit every `alignment === Ringwraith` comparison in the
engine and confirm Balrog is folded in (either via `isMinionOrBalrog` or an
explicit `|| Balrog`). Add a lint-style grep test if helpful.

**Tests.** `rule-meba-acts-as-ringwraith.test.ts` — assert a `card-text` reference
to "a Ringwraith" resolves true for a Balrog player in a representative
legal-action computation (e.g. detainment keying, overt-company attack matrix).

---

## 2. Ring auto-test with −2 modifier — ✓ DONE

**Rule.** "Any ring in The Balrog's company at the beginning of the end-of-turn
phase is automatically tested. Any ring test in The Balrog's company has a
modification of −2."

Implemented at `reducer-site.ts:2845`+ (`baseModifier = -2`, applied to every
gold ring borne in a Ringwraith/Balrog company). The −2 is the global modifier
for *any* ring test in the company, not just the auto-test.

**Tests.** Add `rule-meba-ring-autotest.test.ts` asserting (a) every gold ring in
a Balrog company is enqueued for end-of-turn auto-test, and (b) a *sage-tapped*
ring test in a Balrog company also receives −2.

> **Interaction with §7:** the auto-test must be **suppressed at Barad-dûr** for a
> Balrog player. See §7.

---

## 3. The Balrog bears but cannot use items — ✗ MISSING

**Rule.** "The Balrog may carry items (including rings) but may not use them
(i.e., an item has no effect on The Balrog's company or on his attributes and
abilities)."

Currently item effects apply regardless of bearer alignment. `rule-9.20`
("Ringwraiths/Balrogs bear but cannot use") is a `test.todo`.

> **Scope clarification.** This restriction is specific to **The Balrog avatar
> character**, not to every character in a Balrog *player's* company. Orc/Troll
> minions in the Balrog's company use items normally. The text "no effect on The
> Balrog's company" means the *item borne by The Balrog* contributes nothing —
> not that the whole company is item-blind. Model it as: **items borne by the
> Balrog avatar grant no modifiers and provide no abilities.**

### 3.1 Engine work

- Add a predicate `itemHasNoEffect(state, bearerInstanceId)` →
  `true` when the bearer is the Balrog avatar character (`isAvatarCharacter`
  + `alignment === Balrog`). Place it next to `control-cost.ts`'s
  `isAvatarCharacter` usage.
- In every place that reads a character's borne-item modifiers — prowess/body
  derivation in `recompute-derived.ts`, weapon/armour application in combat,
  influence modifiers, and special-ability resolution in `effects/resolver.ts` —
  short-circuit to the unmodified value when `itemHasNoEffect` is true.
- The item still **occupies** the bearer (counts for uniqueness, can be
  carried/transferred, still auto-tested if a ring per §2). Only its *effect* is
  nulled.

### 3.2 Tests

`rule-9.20-alignment-item-usage.test.ts` (convert the `test.todo`):

- A weapon borne by The Balrog gives **no** prowess bonus.
- A gold ring borne by The Balrog is still auto-tested (§2) but grants no ability.
- A weapon borne by an Orc in the Balrog's company **does** apply (negative
  control: company is not item-blind).

---

## 4. The Balrog never makes corruption checks — ✓ DONE

**Rule.** "The Balrog never makes corruption checks and corruption cards may not
be played on The Balrog."

Corruption immunity is implemented (`rule-10.09-corruption-immunity.test.ts`
covers Allies, Ringwraiths, and Balrogs). The "corruption cards may not be played
on The Balrog" half is a **targeting** restriction.

**Engine work.** Confirm the play-target legality computer rejects corruption-card
play on a Balrog avatar. If only the *check* is skipped but the card can still be
attached, add a target filter: a `corruption`-tagged resource/hazard cannot
select the Balrog avatar as target.

**Tests.** `rule-meba-corruption-not-playable-on-balrog.test.ts`.

---

## 5. The Balrog's company is always overt — ✓ DONE

`reducer-utils.ts:2224` forces a Balrog-avatar company overt.
**Tests.** Confirmation test under MEBA naming.

---

## 6. The Balrog cannot use starter or region movement — △ PARTIAL

**Rule.** "Normally, The Balrog may not use starter and region movement (as stated
on his card). However, the play of certain resources can expand his movement
capabilities." The Balrog card itself reads: "He … may not use region or starter
movement." (`ba-characters.json:72`).

- **Starter movement** is already blocked for non-Wizard alignments
  (`rule-3.43`), though there is no Balrog-named test.
- **Region movement** block for a Balrog-avatar company is **not** modelled.

> **Subtlety.** This is a property of the **Balrog avatar character**, not the
> Balrog *player*. A Balrog player's *other* minion companies (without the Balrog
> avatar) move with normal region movement. Only a company **containing The
> Balrog** is restricted to Under-deeps movement (plus whatever resources grant).

### 6.1 Engine work

- In the movement legal-action computer (`legal-actions/movement-hazard.ts`),
  when the moving company contains the Balrog avatar, **suppress region-movement
  and starter-movement** legal actions; leave Under-deeps movement intact.
- Provide an override hook so movement-expanding resources can re-enable region
  movement for that company that turn. Reuse the existing per-company movement
  flag set by *Going Ever Under Dark* (ba-37) / *Gangways over the Fire* (ba-60)
  rather than inventing a Balrog-only flag. Model as a company-scoped
  `movementGrants` set checked alongside the avatar restriction.

### 6.2 Tests

`rule-meba-balrog-movement.test.ts`:

- A company containing The Balrog has **no** region/starter movement legal
  actions, only Under-deeps.
- A Balrog player's Balrog-less Orc company moves with region movement normally
  (negative control).
- With a movement-granting resource flag set, the Balrog company regains the
  granted movement.

---

## 7. No Barad-dûr ring auto-test; no storing at Barad-dûr — ✗ MISSING

**Rule.** "Rings are not automatically tested for a Balrog player at Barad-dûr."
and "A Balrog player may not store anything at Barad-dûr."

The end-of-turn auto-test (§2) currently fires at every site, including a
Barad-dûr override modifier (−3). For a **Balrog** player both of these
Barad-dûr behaviours must change.

### 7.1 Engine work

- **Ring auto-test:** in `reducer-site.ts` (end-of-turn auto-test loop), when
  `resourcePlayer.alignment === Balrog` **and** the company's current site is
  Barad-dûr (`BARAD_DUR_HERO` / `BARAD_DUR_MINION`), skip the auto-test for that
  company. (The −2 company-wide modifier from §2 still applies to ring tests
  triggered by other means.)
- **Storing:** in the site-phase "store at Darkhaven" legal-action computer,
  reject store actions for a Balrog player whose company is at Barad-dûr. Barad-dûr
  is not one of the Balrog's Darkhavens (only Moria and The Under-gates are).

### 7.2 Tests

`rule-meba-barad-dur.test.ts`:

- A Balrog company at Barad-dûr with a gold ring: **no** end-of-turn auto-test
  enqueued.
- A Ringwraith company at Barad-dûr with a gold ring: auto-test **is** enqueued
  (negative control — confirms the exception is Balrog-only).
- A Balrog player at Barad-dûr is offered **no** store-at-Darkhaven action.

---

## 8. Victory conditions — △ PARTIAL

**Rule.** A Balrog wins like a MELE Ringwraith (opponent eliminated / recover The
One Ring / most MP at the Audience), with exceptions:

- **One-Ring win is gated by Challenge the Power**: "at least one Challenge the
  Power card must be played and the conditions outlined on that card must be met."
- The **Audience with Sauron is the Balrog's "Day of Decision"**, called by
  playing **Sudden Call** — already gated (`rule-10.41`).

`reducer-win-conditions.ts` already routes Challenge the Power (ba-52). The full
resolution table is a `test.todo` (`rule-10.39-winning-with-one-ring.test.ts:127`).

### 8.1 Engine work

Implement the Challenge the Power (ba-52) resolution per card text. Roll, adding
+1 per sage in the Balrog's company and +1 per *other* Challenge the Power in play:

| Result | Effect |
|--------|--------|
| < 7 | The Balrog is **eliminated** |
| 7–8 | discard this Challenge the Power |
| 9–10 | gain **2 MP**; The One Ring now affects The Balrog |
| > 10 | **win the game** |

- "Cannot be duplicated on a given turn" — enforce one resolution per turn.
- The win path (>10) must fire only with The One Ring borne by The Balrog (the
  card is "Playable on The Balrog if he bears The One Ring").

### 8.2 Tests

`rule-10.39-winning-with-one-ring.test.ts` — convert the `test.todo`; cover each
result band, the sage / multi-card modifiers, and the once-per-turn limit.

---

## 9. Deck construction — ✓ DONE (audit + tests)

Implemented across `deck-validation.ts` (rules 1.18, 1.20, 1.21, 1.22, 1.26,
1.27, 1.29). Already enforced: minion-only characters; Orc/Troll races only;
mind < 9 unless Balrog-specific; faction races Orc/Troll/Wolf/Animal/Dragon;
agents as ½-creature hazards; Balrog-specific banned-card list
(The Balrog ally, Black Council, Durin's Bane, Balrog of Moria, Helm of Fear,
Kill All But Not the Halflings, etc.); hero/minion/balrog site-deck typing;
"Balrog-specific version required" for Moria/Carn Dûm/Dol Guldur/Minas Morgul/
Dark-holds/Under-deeps.

**Remaining audit items (verify, add tests if absent):**

- **Multiple copies** of The Under-gates and Moria allowed (they are the Balrog's
  only Darkhavens) — confirm the uniqueness/copy-limit check exempts these two
  site IDs for a Balrog location deck.
- **Geann a-Lisch** is a Ruins & Lairs with **no Darkhaven effects** — confirm
  site data carries no Darkhaven site-rules.
- **Non-Balrog player** may include one copy each of the five Balrog sites with no
  hero/minion equivalent (Ancient Deep-hold, The Wind-deeps, The Drowning-deeps,
  The Rusted-deeps, Remains of Thangorodrim) for hazard purposes — confirm
  `deck-validation` permits these in a non-Balrog location deck.

**Tests.** `rule-meba-deck-construction.test.ts` — MEBA-named confirmations for
each of the above (most assert existing behaviour; the three audit items may need
small fixes).

---

## 10. Starting sites Moria / The Under-gates — ✓ DONE

`alignment-rules.ts:44` sets `defaultStartingSites: [MORIA_BALROG, THE_UNDER_GATES]`,
`maxStartingSites: 2`. **Tests.** Confirmation test that a Balrog player may seat
up to two starting companies at Moria and/or The Under-gates.

---

## 11. Draw cards on every Balrog company move — △ PARTIAL

**Rule.** "When one of your Balrog companies moves to a site, you and your opponent
draw cards based upon the site being moved to. **This applies even if moving to one
of your Darkhavens.**"

Standard play already draws on movement to non-Haven sites; the Balrog exception is
that the draw fires **even when moving to a Darkhaven** (normally Haven/Darkhaven
arrival draws nothing).

### 11.1 Engine work

In the movement/draw computation, when the moving player is a Balrog player, do
not skip the both-players draw on arrival at a Darkhaven; use the destination
site's draw count as for any other site.

### 11.2 Tests

`rule-meba-darkhaven-draw.test.ts` — Balrog company moving into Moria / The
Under-gates triggers the normal site-based draw for both players; a Ringwraith
company moving into its Darkhaven does **not** (negative control).

---

## 12. The Balrog must enter at The Under-gates — ✗ MISSING

**Rule.** "The Balrog must come into play at The Under-gates (i.e., he may not
come into play at Moria)." Reinforced by his card's `homesite: "The Under-gates"`
(`ba-characters.json:67`).

### 12.1 Engine work

In the organization-phase bring-into-play legality computer, when the avatar being
brought into play is The Balrog, restrict the eligible company/site to a company
**at The Under-gates**. Drive the restriction from the character's `homesite`
field (already "The Under-gates") rather than hardcoding the card ID — generalises
to manifestations.

### 12.2 Tests

`rule-meba-balrog-entry.test.ts` — The Balrog is a legal bring-into-play target
only for a company at The Under-gates; not at Moria; not at an Under-deeps site.

---

## 13. Two characters per organization phase — ✗ MISSING

**Rule.** "During his organization phase, a Balrog player may bring into play
(and/or remove from play) up to **two** characters — the **second character must
be non-unique**. The normal requirements … must still be met."

The base rule allows one character brought into play per organization phase.
The Balrog player gets a second, constrained to non-unique.

### 13.1 Engine work

- Track per-turn count of characters brought into play / removed for the Balrog
  player (a `broughtIntoPlayThisTurn` counter on `PlayerState`, or reuse an
  existing organization-phase counter).
- Allow a **second** bring-into-play (or removal) action when the player is a
  Balrog player; gate the second action's target to **non-unique** characters.
- All normal requirements (general influence, site, mind limit) still apply to
  both.

### 13.2 Tests

`rule-meba-two-characters.test.ts`:

- First bring-into-play: any eligible character. Second: only non-unique offered.
- A unique character is **not** a legal second bring-into-play.
- A third bring-into-play is not offered.

---

## 14. Non-unique mind ≤ 3 from hand / discard / sideboard — ✗ MISSING

**Rule.** "When a Balrog player brings into play a non-unique character with a
mind of 3 or less, that character may come from his **hand, his discard pile, or
his sideboard**."

Normally characters enter only from hand. This widens the source set for a narrow
class.

### 14.1 Engine work

- In the bring-into-play legal-action computer, when the player is a Balrog player,
  additionally scan the **discard pile** and **sideboard** for non-unique
  characters with `mind ≤ 3` and surface them as bring-into-play candidates (with
  source annotation).
- The reducer must move the chosen card from the correct source pile (hand /
  discard / sideboard) into play — ensure no card-instance is lost
  (`@meccg/shared` no-disappear invariant). Sideboard/discard characters become
  full `CardInstance`s if not already.

### 14.2 Tests

`rule-meba-low-mind-sources.test.ts`:

- A non-unique mind-2 character in the **discard pile** is offered as
  bring-into-play.
- The same from the **sideboard**.
- A mind-4 character in discard is **not** offered (band boundary).
- A **unique** mind-2 character in discard is **not** offered.

---

## 15. "Any Dark-hold" home-site remap — ✗ MISSING

**Rule.** "Characters with a home site of 'Any Dark-hold' have a home site of 'Any
non-Dark-hold Under-deeps site' instead." (Applies to a Balrog player.)

### 15.1 Engine work

- In the home-site resolution used by bring-into-play legality (where a character's
  `homesite` is matched against the company's current site), for a Balrog player
  treat the literal home-site value "Any Dark-hold" as "any Under-deeps site that
  is **not** a Dark-hold." Use the site's `under-deeps` keyword and its site-type
  (`Dark-hold`) to evaluate.
- Keep the remap localised to home-site matching; do not mutate card data.

### 15.2 Tests

`rule-meba-darkhold-homesite.test.ts`:

- For a Balrog player, an "Any Dark-hold" home-site character is bring-into-play
  legal at a non-Dark-hold Under-deeps site, and **illegal** at an actual
  Dark-hold or a surface Dark-hold.
- For a non-Balrog (minion) player, "Any Dark-hold" still means any Dark-hold
  (negative control).

---

## 16. Agents are hazards, not characters — △ PARTIAL

**Rule.** "Agents count as hazards, not as characters." and "Agents may not be
played as characters."

- Deck-side: agents in a Balrog hazard section count as ½ creature
  (`deck-validation.ts:633`) — **done**.
- Play-side: confirm the organization-phase "play character" computer does **not**
  offer agents as characters for a Balrog player. Agents are played through the
  hazard machinery instead.

### 16.1 Engine work

Add a guard in the play-character legality computer: a Balrog player may not bring
an agent into play as a character. (Agents still function as hazards.)

### 16.2 Tests

`rule-meba-agents-as-hazards.test.ts` — an agent is not a legal bring-into-play
character for a Balrog player; it is a legal hazard.

---

## 17. Opponent's banned cards + sideboard swap — △ PARTIAL

**Rule.** "If you are a Balrog player, your opponent may not play any of the
following cards: The Balrog (Ally), The Black Council, Durin's Bane, Balrog of
Moria, Reluctant Final Parting. However, if at any time your opponent has one of
these cards **in his hand**, he may remove it from play and bring one card from
his sideboard into his play deck."

The existing `deck-validation` bans (wh-41 Black Council, dm-107 Durin's Bane,
ba-3/as-71 The Balrog ally, tw-12 Balrog of Moria) are **unconditional deck**
bans. The MEBA rule is an **opponent-conditional play** ban that only applies when
*the opponent is facing a Balrog player*, plus an in-game sideboard-swap option.

### 17.1 Engine work

- **Play ban:** when player A is a Balrog player, suppress legal play of the five
  listed cards by the opponent (player B). This is a runtime play-legality check
  keyed on "the opposing player's alignment is Balrog," not a deck-build check.
  (Add Reluctant Final Parting's card ID to the listed set.)
- **Sideboard swap:** offer player B an action to remove one of these cards from
  hand and fetch one sideboard card into the play deck (a constrained variant of
  the existing organization-phase sideboard-to-deck action,
  `organization-sideboard.ts`).

### 17.2 Tests

`rule-meba-opponent-bans.test.ts`:

- Opponent of a Balrog player cannot play Durin's Bane / Black Council / etc.
- The same cards are playable when the opponent is **not** facing a Balrog player.
- The sideboard-swap action is offered when one of the banned cards is in hand.

---

## 18. Ignore Balrog automatic-attacks once the Balrog is in play / defeated — ✗ MISSING

**Rule.** "If The Balrog is in play or has been defeated, ignore all Balrog
automatic-attacks (i.e., at The Under-gates)."

The Under-gates carries a Balrog automatic-attack that should be suppressed once
the Balrog avatar has entered play (or has been defeated and removed). Distinct
from the Balrog-of-Moria permanent-event handling at `combat-finalize.ts:527`.

### 18.1 Engine work

- Tag the relevant site automatic-attack(s) as "Balrog automatic-attack" in site
  data (or detect by source).
- In the auto-attack generation step (site-arrival combat), suppress Balrog
  automatic-attacks when a flag — "the Balrog avatar is in play, or has ever been
  defeated" — is set. Track Balrog-defeated state on `PlayerState`
  (reuse/extend the avatar-status tracking; the Balrog is the avatar).

### 18.2 Tests

`rule-meba-ignore-balrog-autoattack.test.ts`:

- Before the Balrog is in play: The Under-gates Balrog automatic-attack fires.
- After the Balrog has entered play: suppressed.
- After the Balrog has been defeated: suppressed.

---

## 19. Spawn creature classification — ✓ DONE

Spawn is a creature keyword in card data and types; `manifestations.ts` and
combat treat Spawn permanent-events specially. Shelob, Spider of Môrlat, and
Balrog of Moria are Spawn. **Tests.** Confirmation test that the Spawn keyword is
recognised (creature-count ½ weighting cross-refs §24).

---

## 20. Defeating a permanent-event yields kill-MP — ✓ DONE

`combat-finalize.ts:557` — a defeated permanent-event (Dragon At-Home/At-Hunt,
Spawn) is moved to the defender's kill pile and awards kill-MP.
**Tests.** Confirmation test using a Spawn permanent-event (ba-21/24/27/28).

---

## 21. "Off to the side" placement zone — ✗ MISSING (tracked in AS spec)

The MEBA Clarifications restate the "off to the side" rule verbatim. This is the
**same** mechanic already specced as §1 of
`specs/2026-06-21-against-the-shadow-rules.md` (set-aside zone, host linkage,
discard-on-host-removal, in-play-for-uniqueness, MP-to-owner, prisoner negative-MP
exception). Confirmed not yet implemented (`grep` for `setAside`/`offToSide` in
`state-player.ts`/`reducer-utils.ts` is empty).

**Engine work.** Implement per the AS spec §1; no separate Balrog work.
**Tests.** Add a Balrog-named confirmation once AS §1 lands.

---

## 22. Cards with multiple actions — △ PARTIAL

**Rule.** "If a card specifies that more than one action occurs when the card is
resolved … all of these actions are resolved in the card's chain uninterrupted and
in the order listed … considered to have been declared in the **reverse** order as
printed. As an exception, if one of the effects is an attack, cards may be played
that cancel/modify the attack or a strike during the strike sequence."

### 22.1 Engine work

- Verify the chain reducer (`chain-reducer.ts` / `effects/resolver.ts`) resolves a
  multi-action card's effects as one uninterrupted sequence (no inter-action
  responses) and that the declared/printed ordering matches the "reverse-declared"
  rule.
- Confirm the attack-effect exception: when an action is an attack, the normal
  strike-sequence response window opens (cancel-strike / cancel-attack cards).
- If the engine currently inserts a response window between sub-actions, close that
  gap; otherwise this is verify-only.

### 22.2 Tests

`rule-meba-multiple-actions.test.ts` — a multi-action card resolves its actions in
order with no intervening declarations; an attack sub-action still permits
strike-sequence responses.

---

## 23. Discard cards played on a card when it leaves play — ✓ DONE

`reducer.ts:43` runs `discardOrphaned*` sweeps so that when a host card leaves
active play, attached items/allies/events are discarded.
**Tests.** Confirmation test (host discard → attachments to discard pile).

---

## 24. Tournament rules — ✓ DONE

- **Spawn = ½ creature** toward the Council of Lórien 12-creature minimum
  (`deck-validation.ts:633`, §19).
- **Balrog +5 general influence** that cannot control characters
  (`rule-1.56-balrog-extra-gi.test.ts`).

**Tests.** Both already covered; add MEBA-named aliases if desired.

---

## 25. The Under-deeps (sites + movement) — ✓ DONE (tracked elsewhere)

Under-deeps **sites** (no region, adjacency list, surface site, no eagle-mounts,
no site path, site-type-keyed hazards only, item-play substitution, MP gating) and
Under-deeps **movement** (2d6 roll vs the parenthesised difficulty, surface→deep
needs no roll) are implemented and tracked in
`specs/2026-05-11-under-deeps-movement.md` and AS spec §6/§7.

**MEBA-specific items to confirm against those specs:**

- **Drowning-deeps / Rusted-deeps roll-13:** a Balrog company moving between the
  Blue Mountain Dwarf-hold ↔ The Drowning-deeps (or Iron Hill Dwarf-hold ↔ The
  Rusted-deeps) must roll the number on the site (normally **13**, impossible) —
  the surface→deep "no roll" exception does **not** apply here. Confirm site data
  encodes a 13 for that surface adjacency and the roll logic does not special-case
  it to 0. *(Breach the Hold / Roots of the Earth reduce this to 0 — card-level.)*
- **Modifications scope:** modifiers affecting "movement between two Under-deeps
  sites" do not affect surface↔deep movement; modifiers to adjacent-Under-deeps
  movement do apply. Confirm the roll-modifier source distinguishes the two.
- **Wildcard adjacency** ("Any site in Ûdun", *Caverns Unchoked* ba-51 region
  adjacency) — tracked in the under-deeps spec.

**Tests.** Add `rule-meba-under-deeps-roll13.test.ts` asserting the Dwarf-hold ↔
deep crossing requires the (impossible) roll and stays put on failure.

---

## Implementation order

1. **§3** items-no-effect for the Balrog avatar (self-contained; unblocks combat
   correctness).
2. **§6 / §7** movement region-block + Barad-dûr exceptions (movement + end-of-turn
   touch-points).
3. **§12 / §13 / §14 / §15 / §16** organization-phase bundle (entry site, double
   bring-into-play, low-mind sources, home-site remap, agent ban) — these share the
   bring-into-play computer and are best done together.
4. **§11** Darkhaven draw exception.
5. **§17 / §18** opponent-conditional bans + Balrog auto-attack suppression.
6. **§8** Challenge the Power win resolution.
7. **§21** "off to the side" — land in the AS spec, then add the Balrog
   confirmation test.
8. **§22** multiple-action chain verification.
9. Confirmation/audit tests for the ✓ sections (§1,2,4,5,9,10,19,20,23,24,25).

---

## Tests index

| Test file | Section | Kind |
|-----------|---------|------|
| `rule-meba-acts-as-ringwraith.test.ts` | §1 | confirm |
| `rule-meba-ring-autotest.test.ts` | §2 | confirm |
| `rule-9.20-alignment-item-usage.test.ts` | §3 | implement (un-todo) |
| `rule-meba-corruption-not-playable-on-balrog.test.ts` | §4 | implement |
| `rule-meba-balrog-movement.test.ts` | §6 | implement |
| `rule-meba-barad-dur.test.ts` | §7 | implement |
| `rule-10.39-winning-with-one-ring.test.ts` | §8 | implement (un-todo) |
| `rule-meba-deck-construction.test.ts` | §9 | confirm/audit |
| `rule-meba-darkhaven-draw.test.ts` | §11 | implement |
| `rule-meba-balrog-entry.test.ts` | §12 | implement |
| `rule-meba-two-characters.test.ts` | §13 | implement |
| `rule-meba-low-mind-sources.test.ts` | §14 | implement |
| `rule-meba-darkhold-homesite.test.ts` | §15 | implement |
| `rule-meba-agents-as-hazards.test.ts` | §16 | implement |
| `rule-meba-opponent-bans.test.ts` | §17 | implement |
| `rule-meba-ignore-balrog-autoattack.test.ts` | §18 | implement |
| `rule-meba-spawn-classification.test.ts` | §19 | confirm |
| `rule-meba-permanent-event-killmp.test.ts` | §20 | confirm |
| `rule-meba-multiple-actions.test.ts` | §22 | verify |
| `rule-meba-under-deeps-roll13.test.ts` | §25 | implement |

---

## Out of scope

- Per-card DSL certification of individual BA cards (Challenge the Power's *engine*
  win-path is in §8; the card's full DSL wiring is certification work).
- Populating remaining BA card *definitions*.
- "Off to the side" *implementation* (owned by AS spec §1; §21 only tracks the
  Balrog confirmation test).
- Under-deeps site/movement *core* (owned by `specs/2026-05-11-under-deeps-movement.md`;
  §25 only tracks the MEBA-specific roll-13 confirmation).
- Optional / variant tournament formats.
</content>
</invoke>
