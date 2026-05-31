# The Lidless Eye (MELE) — Missing Features

Source: <https://meccg.com/rules/by-expansion/the-lidless-eye/>  
Scope: Ringwraith-alignment mechanics not yet implemented or specced.  
Excludes: items already in the "Done" roadmap section, and features already
covered by existing spec files (CvCC, detainment, dragons, agents).

---

## 1. Ringwraith Modes (Black Rider / Fell Rider / Heralded Lord)

### 1.1 Background

A Ringwraith avatar has three distinct "mode" resource cards that determine
how it may move. Without one of these cards in play, the Ringwraith is
restricted to Darkhaven-to-Darkhaven movement only.

| Mode card     | Movement allowed                              | Company type |
|---------------|-----------------------------------------------|--------------|
| Black Rider   | Darkhaven → any legal site                    | Covert       |
| Fell Rider    | Darkhaven → any legal site                    | **Overt**    |
| Heralded Lord | Darkhaven → any legal site (special alt text) | Covert       |

Ringwraith companies may never move through Coastal Seas region symbols
regardless of which mode is active.

### 1.2 State model

No new state is needed. Modes are standard permanent-event resource cards
played on the Ringwraith; they follow the existing card-in-play model.

The only engine change is in legal-action computation:

- **Movement gate**: before allowing a Ringwraith company to declare a
  non-Darkhaven destination, check that the company has a mode card in play.
- **Fell Rider → overt**: when computing company overt-status (currently
  driven by Balrog avatar, Orc/Troll characters), also mark the company
  overt if the Ringwraith has a Fell Rider card in play.
- **Coastal Seas filter**: when building the list of legal sites for a
  Ringwraith company, exclude any site whose site path contains a
  Coastal Seas (⛵ / `coastal`) region symbol.

### 1.3 DSL support

Mode cards need no new DSL effect type; they are plain permanent-events.
The three movement restrictions above are rule-level constraints, not
card-text effects, so they live in the engine and movement-map logic.

### 1.4 Files to change

- `packages/shared/src/engine/legal-actions/organization.ts` — movement gate
- `packages/shared/src/engine/reducer-utils.ts` — Fell Rider overt flag
- `packages/shared/src/movement-map.ts` — Coastal Seas filter for
  Ringwraith companies
- `packages/shared/src/tests/rules/05-movement-hazard-phase/` — new test
  file for Ringwraith movement restrictions

---

## 2. Ringwraith Body Check — Return to Hand on 7 or 8

### 2.1 Rule

> [MELE §8.R1] If a body-check roll against a Ringwraith is exactly 7 or 8
> (before any modifications), the Ringwraith is returned to its player's
> hand instead of being eliminated. Until it has been re-played:
>
> - That player cannot reveal a different Ringwraith.
> - The opponent cannot reveal that same Ringwraith.

A test skeleton already exists at
`packages/shared/src/tests/rules/08-combat/rule-8.29-ringwraith-body-check.test.ts`
with a single `test.todo`.

### 2.2 Implementation

In `reducer-combat.ts`, in the body-check resolution path:

1. After rolling, before the elimination check, detect whether the wounded
   character is the current Ringwraith avatar.
2. If the **unmodified** roll is exactly 7 or 8:
   - Move the Ringwraith card instance from the field to the player's hand
     (not eliminated, not discarded).
   - Set a flag on the player state (e.g. `ringwraithReturnedToHand: true`)
     that enforces the reveal restriction.
3. Otherwise apply normal body-check elimination rules.

The "cannot reveal a different Ringwraith" restriction blocks reveal actions
in the organization phase; the "opponent cannot reveal same Ringwraith"
restriction is checked when the opponent tries to reveal their avatar.

### 2.3 Files to change

- `packages/shared/src/types/state.ts` (or player-state sub-type) — add
  `ringwraithReturnedToHand?: boolean`
- `packages/shared/src/engine/reducer-combat.ts` — detect 7/8 roll against
  Ringwraith avatar
- `packages/shared/src/engine/legal-actions/organization.ts` — enforce
  reveal restriction
- `packages/shared/src/tests/rules/08-combat/rule-8.29-ringwraith-body-check.test.ts`
  — fill in the todo

---

## 3. Trophies

### 3.1 Rule

> [MELE §8.37] After defeating a creature attack, an Orc or Troll character
> that faced one of the creature's strikes may take the creature card as a
> "trophy" by placing it under that character. A trophy is treated as a
> minor item worth 0 CP (cannot be transferred or stored). Half-orcs cannot
> take trophies.
>
> Character attributes are modified by total printed MPs on all trophy cards
> held by that character:
> - 1 MP total → +1 Direct Influence
> - 2 MP total → +1 DI, +1 Prowess (max 9)
> - 3 MP total → +2 DI, +1 Prowess (max 9)
> - 4+ MP total → +2 DI, +2 Prowess (max 9)
>
> Kill-MP from trophies: same as if the creature had not been used as a
> trophy (0 for detainment attacks). If a trophy worth kill-MP is discarded,
> it goes to the MP pile; if not worth kill-MP, it is removed from play.

Test skeleton at `packages/shared/src/tests/rules/08-combat/rule-8.37-trophies.test.ts`.

### 3.2 State model

Trophies are creature card instances placed "under" a character, analogous
to items carried by a character. They can be modelled as a new field:

```typescript
// On CardInstance (or the character's carried-items list)
trophies?: CardInstanceId[];
```

Or reuse the existing item-carried mechanism with a `isTrophy: true` marker
so the shared "minor item" semantics apply automatically.

### 3.3 Engine changes

1. **Legal action — take trophy**: after a creature is defeated in combat
   (non-detainment), offer the active player a `take-trophy` action for each
   eligible Orc/Troll character that faced a strike.
2. **Effective stats**: `effectiveStats()` must sum trophy card MPs and apply
   the bonus table above to DI and Prowess.
3. **Free Council scoring**: trophy kill-MPs flow into the MP pile normally
   (already tracked via `*` on creature cards).
4. **Discard path**: when a trophy would be discarded, branch on whether it
   carries kill-MPs.

### 3.4 Files to change

- `packages/shared/src/types/state.ts` — `trophies` field on card instance
  or character slot
- `packages/shared/src/engine/effective-stats.ts` — trophy bonus table
- `packages/shared/src/engine/reducer-combat.ts` — `take-trophy` action
- `packages/shared/src/engine/legal-actions/combat.ts` — offer action
- `packages/shared/src/tests/rules/08-combat/rule-8.37-trophies.test.ts`
  — fill in todos

---

## 4. Orc Scout Half-Size (Hazard Limit)

### 4.1 Rule

> [MELE §5.R1] Orc scouts count as only 0.5 (rounded up) towards the
> company's size for the purpose of computing the hazard limit.

So a company of 1 Orc scout + 1 regular character has size 2 (0.5 + 1,
rounded up to 2). A company of 2 Orc scouts has size 1 (0.5 + 0.5 = 1).

### 4.2 Implementation

The hazard-limit formula lives in `companySize()` / `hazardLimit()` helpers.
Add a check: if the character's race keyword is `orc-scout`, contribute 0.5
to the running sum; otherwise 1. Apply `Math.ceil` at the end, then
`Math.max(2, ...)` as usual.

`orc-scout` is already a race value on character card definitions.

### 4.3 Files to change

- `packages/shared/src/engine/reducer-utils.ts` (or wherever
  `companySize`/`hazardLimit` is computed) — half-count for orc scouts
- `packages/shared/src/tests/rules/05-movement-hazard-phase/` — new test

---

## 5. Cross-Alignment Item Half-MP

### 5.1 Rule

> [MELE Part IV] When a Ringwraith player plays a hero item (or a Wizard
> player plays a minion item), that item is worth only half its normal
> marshalling points (rounded up). All special abilities on such cross-
> alignment items are ignored; only the raw MP value (halved) is counted.

Test skeleton at
`packages/shared/src/tests/rules/10-corruption-influence-endgame/rule-10.52-alignment-item-mp.test.ts`.

### 5.2 Implementation

In the Free Council / Audience MP counting (and the running-total
projection):

1. For each item in a player's control, check if the item's alignment
   (derived from its card type: `hero-resource-item` vs
   `minion-resource-item`) differs from the controlling player's alignment.
2. If mismatched, count `Math.ceil(item.marshalling_points / 2)` instead of
   the full value.

The "no special abilities" rule is largely self-enforcing because DSL effects
already require an alignment match to fire; but any effect that explicitly
checks items may need a guard.

### 5.3 Files to change

- `packages/shared/src/engine/reducer-free-council.ts` — halved MP for
  cross-alignment items
- `packages/shared/src/engine/reducer-utils.ts` — running-total projection
  (so the in-game MP display is accurate)
- `packages/shared/src/tests/rules/10-corruption-influence-endgame/rule-10.52-alignment-item-mp.test.ts`

---

## 6. Audience with Sauron — MP Type Modifications

### 6.1 Rule

> [MELE Standard Rules §1] At the Audience with Sauron (endgame), before
> tallying final marshalling points:
>
> 1. **Type doubling**: if your opponent has 0 or fewer MPs in a given type
>    (character, ally, item, faction, kill, miscellaneous), your MPs of that
>    same type are doubled. (Exception: kill MPs and miscellaneous MPs are
>    never doubled.)
>
> 2. **Type cap**: no single MP type may contribute more than half of your
>    final total. Any excess is discarded.
>
> 3. **Unique card reveal**: you may reveal unplayed unique resource cards
>    from your hand/sideboard that match unique cards your opponent has in
>    play. Each such reveal reduces your opponent's final total by 1 MP.

### 6.2 Implementation

These modifications apply at Free Council / Audience resolution only (not
during play). Add a post-corruption-check step in
`reducer-free-council.ts`:

1. Categorise each player's MP pile by type (character MPs, ally MPs, item
   MPs, faction MPs, kill MPs, misc MPs).
2. For each non-kill, non-misc type: if opponent's typed total ≤ 0, double
   your total for that type.
3. Apply the 50% cap: if any type exceeds `floor(totalMPs / 2)`, reduce it
   to that cap.
4. Offer the `reveal-unique-card` action to each player (no existing action
   type for this — needs a new one). Each played unique card in opponent's
   zone that matches a revealed card reduces opponent's final total by 1.

### 6.3 Files to change

- `packages/shared/src/engine/reducer-free-council.ts` — type doubling,
  capping, unique reveal action
- `packages/shared/src/types/actions-free-council.ts` (or equivalent) —
  `reveal-unique-card` action
- `packages/shared/src/tests/rules/10-corruption-influence-endgame/` —
  new test file for audience MP modifications

---

## 7. The One Ring — Barad-dûr Win Condition

### 7.1 Rule

> [MELE §1] If a player moves The One Ring to Barad-dûr during their turn,
> Sauron is reunited with the One Ring and that player wins immediately.

### 7.2 Current state

The game already has a Sudden Call / deck-exhaustion win path. The One Ring
is a named card (`le-*`). No instant-win check exists for it arriving at
Barad-dûr.

### 7.3 Implementation

Add an end-of-site-phase check (or end-of-turn check):

1. Look for a card instance whose definition is The One Ring in any company
   at the Barad-dûr site.
2. If found, call `triggerImmediateWin(player)`, analogous to the existing
   path that handles the Sudden Call audience trigger.

Barad-dûr's site id is `le-363` (confirm against card data before coding).

### 7.4 Files to change

- `packages/shared/src/engine/reducer-site.ts` or
  `reducer-end-of-turn.ts` — win condition check
- `packages/shared/src/card-ids.ts` — export `THE_ONE_RING` and
  `BARAD_DUR` constants
- New test file under
  `packages/shared/src/tests/rules/10-corruption-influence-endgame/`

---

## 8. Suggested Implementation Order

1. **Ringwraith body check return-to-hand** (§2) — small, self-contained,
   unblocks Ringwraith card certification
2. **Ringwraith modes** (§1) — unblocks Black Rider / Fell Rider /
   Heralded Lord card certification and correct movement for all Ringwraith
   decks
3. **Orc Scout half-size** (§4) — one-line formula change, high reward
4. **Trophies** (§3) — moderate scope, needed for Orc/Troll card
   certification
5. **Cross-alignment item half-MP** (§5) — needed for mixed-alignment games
6. **The One Ring win condition** (§7) — small, high narrative value
7. **Audience MP modifications** (§6) — most complex; affects final scoring
   only so low urgency until endgame is otherwise complete
