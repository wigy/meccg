# Against the Shadow (MEAS) — Rules Implementation Spec

Status tracker for implementing the MECCG *Against the Shadow* expansion rules.
Source: `https://meccg.com/rules/by-expansion/against-the-shadow/` (text extracted
verbatim from the MEAS Insert, no modifications).

Scope is rule-engine mechanics only. Per-card DSL wiring is tracked separately under
card certification. Card **data** files already exist (`as-characters.json`,
`as-sites.json`, `as-items.json`, `as-creatures.json`, `as-hazards.json`,
`as-resources.json`); the full "Define all AS cards" commit was reverted (5eb27e26),
so populating remaining AS card definitions is out of scope here.

**Legend:** ✓ done · △ partial · ✗ missing

The Insert defines seven rule sections. Five are already wholly or largely satisfied
by prior METD / Under-deeps work; this spec closes the two genuine gaps
(**off to the side**, and the **Under-deeps site sub-rules**) and adds the AS-named
rule tests that are currently absent for the "done" sections.

---

## Summary

| # | AS rule | Engine status | Work in this spec |
|---|---------|---------------|-------------------|
| 1 | Placement of cards "off to the side" | ✗ missing | **Implement** set-aside zone + host linkage + discard-on-host-removal + uniqueness/MP rules |
| 2 | Hoards | ✓ done (METD) | Add AS-named confirmation test |
| 3 | Region movement limitation (4 / 6) | ✓ done | Add AS-named confirmation test |
| 4 | Characters facing multiple strikes | △ partial | Complete rule-8.05 test (currently `test.todo`) |
| 5 | Creatures as automatic-attacks | ✓ done | Add AS-named confirmation test (discard, not MP pile) |
| 6 | The Under-deeps (site rules) | △ partial | Close sub-rules 6b/6d/6e/6f |
| 7 | Under-deeps site movement (2d6 roll) | ✓ done | Add adjacency/roll regression test under AS naming |

The two structurally new pieces of engine work are **§1** and **§6**. Everything else is
test-only or already covered.

---

## 1. Placement of cards "off to the side" — ✗ MISSING

**Rule (verbatim intent).** Certain cards/effects place other cards "off to the side"
(e.g. *Sack Over the Head*). Such cards:

- are placed off to the side of the normal play area and **kept with the host
  permanent-event** that caused the effect;
- **cannot be targeted or affected** by the game except by cards that specifically
  affect cards "off to the side";
- **are in play for the purposes of uniqueness**;
- are **discarded when the host permanent-event leaves the playing surface** (unless the
  host states otherwise);
- **give their marshalling points to their owner** (unless the host states otherwise).

Card text already references the mechanic in data — confirming it is load-bearing:
`as-hazards.json` (AS-39 *Summons from Long Sleep* — "place it face up 'off to the
side' with this card"), `tw-resources.json` (*Sacrifice of Form*), `dm-hazards.json`
(several "considered off to the side" creatures). None of it is wired.

### 1.1 Data model — reuse, do not add a top-level array

Per `feedback_reuse_pending_shapes` / `feedback_no_card_disappears`, do **not** add a new
top-level `GameState` pile. Off-to-the-side cards are still "in play" (uniqueness, MP),
so they live attached to their host card instance rather than in a separate redacted pile.

Model the linkage on the host `CardInstance`:

```ts
// On CardInstance (host permanent-event)
/**
 * Instance IDs of cards placed "off to the side" with this host permanent-event.
 * These cards remain reachable in state via the host; they are in play for
 * uniqueness, untargetable except by cards that name "off to the side", and are
 * discarded when the host leaves play (unless the host card says otherwise).
 */
readonly setAside?: readonly CardInstanceId[];
```

The set-aside instances themselves remain registered in the same `cardsInPlay`
collection as the host (so `resolveInstanceId` always succeeds and no card disappears),
but carry a back-reference and a flag so visibility/targeting logic can exclude them:

```ts
// On the set-aside CardInstance
readonly setAsideHost?: CardInstanceId; // the host this card is kept with
```

Rationale: storing only an ID list on the host plus a back-pointer keeps a single source
of truth for "what is set aside" and lets the no-card-disappears invariant stay
load-bearing — if a host-removal sweep forgets a child, it shows up as an orphaned
`setAsideHost` with a missing host, not a silently dropped instance.

### 1.2 Engine work

1. **New DSL effect `set-aside`** (in `effects.ts`): moves one or more target instances
   into the host's `setAside` list and stamps `setAsideHost` on each. The host is the
   permanent-event currently being resolved. Add to the effect union and document in
   `docs/card-effects-dsl.md` (`feedback_dsl_docs`).
2. **Targeting exclusion**: in the play-target / legal-action target collectors, exclude
   any instance with `setAsideHost` set, *unless* the playing card's effect declares it
   targets set-aside cards (a `targetsSetAside: true` flag on the relevant
   `play-target`). This is the "cannot be targeted except by cards that specifically
   affect off-to-the-side cards" clause.
3. **Uniqueness**: the uniqueness checker must continue to count set-aside instances as
   in play. Verify the existing uniqueness scan walks `cardsInPlay` (it does) so set-aside
   instances are already counted — add a test rather than new code if so; otherwise
   include `setAside` children explicitly.
4. **Host removal sweep** (`postReduce` or the host's removal path in
   `reducer-events.ts`): when a host permanent-event moves to any off-board pile, route
   each `setAside` child to its **owner's** discard (via `ownerOf`), unless the host card
   carries an override effect (e.g. *Sacrifice of Form* keeps items in play). Never filter
   a child out without pushing it somewhere (`feedback_no_card_disappears`).
5. **MP attribution**: set-aside cards award MPs to their **owner** (`ownerOf(child)`),
   independent of the host's owner, in the scoring layer — mirror the manifestation
   `ownerOf` attribution pattern.

### 1.3 Tests (`packages/shared/src/tests/rules/`)

`rule-meas-off-to-the-side.test.ts`:

- a `set-aside` effect moves the target out of normal play and onto the host
  (`setAside` populated, `setAsideHost` stamped);
- a set-aside character/faction is **not** offered as a legal target by an ordinary
  targeting card;
- a card declaring `targetsSetAside` **can** target it;
- a second copy of a set-aside unique card is rejected by deck/play uniqueness
  (still "in play");
- removing the host permanent-event discards each set-aside child to its owner's
  discard pile, and no instance disappears (every input instance resolvable after);
- a host whose card overrides the default (keeps children in play) does **not** discard
  them on removal;
- MP from a set-aside card is attributed to its owner.

---

## 2. Hoards — ✓ DONE (METD)

**Rule.** Hoard items may only be played at a site containing a hoard (every Dragon's
lair). Hoard **minor** items may not be in a starting company nor played at a non-hoard
site.

Implemented under the METD plan: site `keywords: ["hoard"]` gate in
`legal-actions/site.ts`, hoard-item `keywords: ["hoard"]` play filter, and the
`not-hoard` starting-company draft rule in `legal-actions/item-draft.ts`. Covered by
`rule-metd-hoard-item-play-site.test.ts` and `rule-metd-hoard-minor-starting-company.test.ts`.

**Work here:** add `rule-meas-hoard-item.test.ts` exercising an **AS** hoard item (minion
fixtures per the package testing convention) at a hoard site vs a non-hoard site, so the
AS rule has explicit coverage. No engine change.

---

## 3. Region movement limitation — ✓ DONE

**Rule.** Region movement lays down a maximum of **4** region cards; effects that allow
extra regions cap at **6** total.

Implemented: `BASE_MAX_REGION_DISTANCE = 4` in `rules/definitions/movement.ts`;
`effectiveMaxRegions = BASE + extraRegionDistance + passiveBonus` with the 6-ceiling in
`legal-actions/organization-companies.ts`.

**Work here:** add `rule-meas-region-movement-limit.test.ts` asserting (a) a 5-region
plan is rejected at base, and (b) with an extra-region effect a 6-region plan is allowed
but a 7-region plan is not. No engine change.

---

## 4. Characters facing multiple strikes — △ PARTIAL

**Rule.** An effect may assign a character more than one strike from one attack. The
character faces a separate strike sequence per strike; tap/wound state updates between
sequences and modifies prowess for the following ones; elimination mid-sequence cancels
the remaining strikes.

The serial-strike machinery exists (`CombatState.strikeAssignments` /
`currentStrikeIndex`; elimination cancels remaining strikes in `reducer-combat.ts`), but
the spec test is a stub: `tests/rules/08-combat/rule-8.05-multiple-strikes-assignment.test.ts`
is `test.todo()`.

**Work here (test-only unless a gap surfaces):** complete `rule-8.05`:

- a character assigned two strikes faces two sequences in order;
- a wound taken in the first sequence lowers prowess for the second;
- elimination during the first sequence cancels the second (no further effect);
- (if the engine mishandles any of the above, fix the reducer path and note it here).

---

## 5. Creatures as automatic-attacks — ✓ DONE

**Rule.** Any hazard creature you play **as an automatic-attack** is **discarded if
defeated** — it is **not** placed in your opponent's marshalling-point pile.

Implemented: `CombatState.attackSource.type === 'played-auto-attack'`; on defeat the
creature is routed to the attacker's discard with no kill-MP awarded
(`reducer-combat.ts`, the `isPlayedAutoAttack` branch). Related dynamic / permanent-event
auto-attack work is in `2026-05-11-generalized-auto-attack.md`.

**Work here:** add `rule-meas-creature-as-auto-attack.test.ts`: a creature played as an
auto-attack and defeated lands in the **playing (hazard) player's discard**, and the
defending (resource) player gains **no** MP. Contrast with a normal hazard creature
defeated in the movement/hazard phase (which does award the opponent kill-MPs). No engine
change expected.

---

## 6. The Under-deeps (site rules) — △ PARTIAL

**Rule.** An Under-deeps site has "Under-deeps" where a site normally lists its region,
and its name contains "…-deeps" or "Under-…". It behaves like any site except:

- **(a)** it is not in a region — it is *below* a surface site; it lists **Adjacent
  Sites** (first = its surface site) instead of a nearest Haven;
- **(b)** **Eagle-mounts and Gwaihir cannot move to/from** an Under-deeps site;
- **(c)** a company moving to/from it has **no site path** — hazards may only be keyed to
  the new site (site-type), not regions;
- **(d)** an environment card that **changes site type** (Choking Shadows, Quiet Lands…)
  **cannot** change an Under-deeps site's type;
- **(e)** MPs of a company at an Under-deeps site are **not counted** toward calling the
  **Free Council** or **Audience with Sauron** (they still count in the final tally);
- **(f)** the normal "site taps; one extra character may tap to play a **minor** item"
  becomes: at an Under-deeps site the extra character may play **any item playable at the
  site** (minor, major, or gold ring).

### 6.1 Status of sub-rules

| Sub-rule | Status | Evidence / gap |
|---|---|---|
| (a) not-in-region, `adjacentSites`, surface site | ✓ | `cards-sites.ts` `adjacentSites` field; DM/BA Under-deeps sites carry `keywords:["under-deeps"]` + `adjacentSites`. AS Under-deeps sites in `as-sites.json` must follow same schema (data, not engine). |
| (b) no Eagle/Gwaihir to/from Under-deeps | ✗ | Gwaihir filter (`organization-companies.ts:263-294`) only excludes `shadow`/`dark` **regions**; it does **not** exclude `keywords.includes('under-deeps')`. Eagle-mount path needs the same exclusion. |
| (c) no site path → only site-keyed hazards | ✓ | Under-deeps movement sets `resolvedSitePath: []`; `reducer-movement-hazard.ts` logs "no region path — only site-keyed hazards apply". |
| (d) environment can't change Under-deeps site type | ✗ | No guard preventing a `site-type-change` effect from applying to an `under-deeps` site. |
| (e) MP exclusion for Free Council / Audience with Sauron | ✗ | No Under-deeps exclusion in the threshold tally. (Deferred in the Under-deeps movement spec to a scoring spec; tracked here.) |
| (f) "play any item" instead of minor item | ✗ | `legal-actions/site.ts` grants only a `minorItemAvailable && subtype==='minor'` bonus; no Under-deeps branch widening this to any site-playable item. |

### 6.2 Engine work

**(b) Eagle/Gwaihir exclusion.** In the Gwaihir branch
(`organization-companies.ts:264-294`) and the Eagle-mount movement path, skip any
candidate site with `keywords?.includes('under-deeps')`, and also forbid these special
movements when the **origin** is an Under-deeps site. Log the exclusion
(`logDetail("… under-deeps — excluded from Eagle/Gwaihir movement")`).

**(d) site-type-change guard.** Where a `site-type-change` environment effect resolves
against a site, short-circuit when the target site has `keywords.includes('under-deeps')`
— the effect is a no-op on that site. Centralize in the site-type resolution helper so
every consumer (hazard keying, item playability) sees the unchanged type.

**(e) MP exclusion at threshold.** In the scoring/threshold computation for Free Council
/ Audience with Sauron, exclude MPs from cards held by companies whose `currentSite` has
`keywords.includes('under-deeps')`; still include them in the final score. (The Balrog
exception 10.2.B2 — Balrog players *do* count Under-deeps MPs toward threshold — is noted
but deferred with the rest of Balrog scoring.)

**(f) "play any item" at Under-deeps.** In `legal-actions/site.ts`, where the
`minorItemBonus` is computed (around the `minorItemAvailable && subtype === 'minor'`
check), broaden the bonus when the current site has `keywords.includes('under-deeps')`:
the extra-character item play accepts any subtype the site itself allows (minor / major /
gold-ring), not just minor. Keep it gated on the same "site already tapped, one extra
character taps" condition.

### 6.3 Tests

`rule-meas-under-deeps-site.test.ts`:

- **(b)** a Gwaihir/Eagle company is **not** offered an Under-deeps destination, and a
  company at an Under-deeps site is **not** offered Eagle/Gwaihir movement;
- **(c)** during Under-deeps movement only site-keyed hazards are legal plays (no
  region-keyed creature) — may reference the existing rule-5.03 coverage;
- **(d)** a site-type-change environment effect targeting an Under-deeps site leaves its
  site type unchanged;
- **(e)** MPs at an Under-deeps site are excluded from the Free Council / Audience with
  Sauron threshold but present in the final tally;
- **(f)** at an Under-deeps site the extra character may play a major item / gold ring (an
  item playable at the site), not only a minor item; at a non-Under-deeps site the same
  extra play is still restricted to minor.

---

## 7. Under-deeps site movement — ✓ DONE

**Rule.** A company at the surface site may move normally or to its adjacent Under-deeps
site (no roll). A company at an Under-deeps site may move only to a listed adjacent site;
each adjacency lists a required number; the mover rolls 2d6 and on a result **≥** the
number the move proceeds, otherwise the company **returns to origin with no cards drawn**
and the phase proceeds as if it had not moved (no "returned" trigger fires).

Implemented (`2026-05-11-under-deeps-movement.md`): `MovementType.UnderDeeps`,
`getUnderDeepsReachable`, `declare-path` with no region path, the `under-deeps-roll` step,
`underDeepsRollRequired` phase field, and `handleUnderDeepsRoll`
(`reducer-movement-hazard.ts`) including the failure path that returns the destination
without a "returned" trigger. Covered by
`tests/rules/05-movement-hazard-phase/rule-5.03-under-deeps-roll.test.ts`.

**Work here:** ensure an AS-named regression exists (or extend rule-5.03) covering: roll-0
surface→Under-deeps needs no roll; roll success advances with empty site path; roll
failure returns destination and fires no "returned" effect; wildcard `*region:` adjacency
(Under-galleries → any site in Ûdun) is offered. No engine change.

---

## Implementation order

1. **§6(b) Eagle/Gwaihir exclusion** — small, self-contained legal-action guard.
2. **§6(f) "play any item" at Under-deeps** — localized `site.ts` branch.
3. **§6(d) site-type-change guard** — centralized in site-type resolution.
4. **§1 off to the side** — the one substantial new mechanic (zone linkage, targeting
   exclusion, host-removal sweep, MP/uniqueness). Sequenced after the Under-deeps fixes so
   it lands as an isolated, reviewable change.
5. **§6(e) MP threshold exclusion** — scoring-layer; coordinate with the existing
   one-ring / end-game scoring spec.
6. **§4 rule-8.05 test completion** (+ any reducer fix it surfaces).
7. **Confirmation tests** for §2, §3, §5, §7 under AS naming.

---

## Tests index

New / completed test files under `packages/shared/src/tests/rules/`:

| File | Covers |
|---|---|
| `rule-meas-off-to-the-side.test.ts` | §1 (new) |
| `rule-meas-hoard-item.test.ts` | §2 (AS confirmation) |
| `rule-meas-region-movement-limit.test.ts` | §3 (AS confirmation) |
| `08-combat/rule-8.05-multiple-strikes-assignment.test.ts` | §4 (complete `test.todo`) |
| `rule-meas-creature-as-auto-attack.test.ts` | §5 (AS confirmation) |
| `rule-meas-under-deeps-site.test.ts` | §6 (b/d/e/f) |
| `05-movement-hazard-phase/rule-5.03-under-deeps-roll.test.ts` | §7 (extend if needed) |

Use minion (AS/LE) fixtures for AS-card tests per the package testing convention. All test
changes go through a PR for wigy's review — never committed directly to master.

---

## Out of scope

- Populating remaining AS card definitions (the reverted "Define all AS cards" work) and
  per-card certification of AS-specific cards.
- Ancient Deep-hold (BA-83) dynamic adjacency chosen at play time.
- Balrog-specific Under-deeps MP threshold exception (10.2.B2) and other Balrog scoring.
- Roll-modifier card certifications affecting the Under-deeps roll (The Balrog, Cave
  Troll, Maker's Map, Reach of Ulmo).
