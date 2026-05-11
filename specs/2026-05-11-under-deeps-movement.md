# Spec: Under-deeps Movement

## Overview

Under-deeps movement is the special movement mode used when a company travels between an Under-deeps site and an adjacent site (either another Under-deeps site or its surface site). It replaces region/starter movement entirely: no site path is traversed, no region-keyed hazards can be played, and the movement may fail a dice roll that forces the company to stay put.

The engine already has `MovementType.UnderDeeps = 'under-deeps'` and `adjacentSites` on site cards, but nothing in the legal-action computers or reducers acts on them. This spec defines the full implementation.

---

## Rules summary (CoE 2.II.7.iii + 2.IV.i.1)

- **Eligibility**: Under-deeps movement requires that either the origin or the destination is an Under-deeps site, and the destination is listed as an adjacent site on the origin (or vice versa).
- **Movement roll** (origin is Under-deeps only): After the new site is revealed, the resource player rolls 2d6. If the result is less than the number listed next to the new site's name on the origin site card, the company stays — destination is returned to the location deck, but this does **not** count as the company being "returned".
- **No site path**: Under-deeps movement has no region path. No region-keyed hazards can be played. Site-type keyed hazards for the destination site type can still be played.
- **Surface site**: A surface site is any non-Under-deeps site listed with a roll of 0 in an Under-deeps site's `adjacentSites`. Moving from a surface site to an Under-deeps site requires no movement roll (0 always passes).
- **Hazard limit**: Calculated normally — the destination's site type is used for keying, but the site path is empty so no region types.

---

## Data model (already in place)

`HeroSiteCard` / `MinionSiteCard` etc. already have:

```ts
readonly adjacentSites?: Readonly<Record<string, number>>;
// maps adjacent site name → minimum 2d6 roll required (0 = no roll)
readonly keywords?: readonly Keyword[];
// Under-deeps sites carry 'under-deeps' keyword
```

DM sites already have `adjacentSites` and `keywords: ['under-deeps']` populated. BA Under-deeps sites need data files created (they follow the same schema). No type changes are needed.

---

## Special adjacency patterns

Two patterns in the card text require attention:

### "Any site in Ûdun" (DM-37 Under-galleries, BA-99)

The Under-galleries list "Any site in Ûdun (0)" as a surface adjacency. This means any site whose `region === 'Udûn'` is a valid surface site with roll 0.

**Representation**: A sentinel value in `adjacentSites`:
```jsonc
{ "adjacentSites": { "*region:Udûn": 0 } }
```
A key starting with `*region:` is treated as a wildcard matching any site in that region. The adjacency check must scan the card pool for sites in that region.

### Ancient Deep-hold (BA-83)

"no surface site, one Under-deeps Ruins & Lairs [{R}] chosen by you when playing this card (8)". The adjacency is not fixed — it is chosen when the card enters play.

**Out of scope for this spec.** Ancient Deep-hold requires a separate mechanism (a play-time choice that writes dynamic adjacency into the card's instance state). Defer to a future spec.

---

## Phase 1 — Organization: plan-movement legal actions

`planMovementActions` in `legal-actions/organization-companies.ts` currently uses `getReachableSites`, which only covers starter and region movement.

**Change**: Add a second pass that offers Under-deeps destinations.

```ts
function getUnderDeepsReachable(
  state: GameState,
  currentSiteDef: SiteCard,
  candidateSites: readonly SiteCard[],
): SiteCard[] {
  const results: SiteCard[] = [];
  const currentIsUD = currentSiteDef.keywords?.includes('under-deeps') ?? false;

  for (const dest of candidateSites) {
    if (dest.name === currentSiteDef.name) continue;
    const destIsUD = dest.keywords?.includes('under-deeps') ?? false;

    // At least one side must be Under-deeps
    if (!currentIsUD && !destIsUD) continue;

    // Check adjacency: origin lists dest, OR dest lists origin
    if (isUnderDeepsAdjacent(state, currentSiteDef, dest)) {
      results.push(dest);
    }
  }
  return results;
}

function isUnderDeepsAdjacent(
  state: GameState,
  origin: SiteCard,
  dest: SiteCard,
): boolean {
  if (resolveAdjacency(state, origin, dest.name) !== undefined) return true;
  if (resolveAdjacency(state, dest, origin.name) !== undefined) return true;
  return false;
}

/**
 * Resolves a site name (possibly a wildcard like "*region:Udûn") against
 * the adjacentSites map on the given site card.
 * Returns the required roll, or undefined if not adjacent.
 */
function resolveAdjacency(
  state: GameState,
  site: SiteCard,
  targetName: string,
): number | undefined {
  const adj = site.adjacentSites;
  if (!adj) return undefined;

  // Direct match
  if (adj[targetName] !== undefined) return adj[targetName];

  // Wildcard: "*region:<regionName>"
  for (const [key, roll] of Object.entries(adj)) {
    if (!key.startsWith('*region:')) continue;
    const regionName = key.slice('*region:'.length);
    // Find the target site's region
    const targetCard = findSiteByName(state, targetName);
    if (targetCard?.region === regionName) return roll;
  }
  return undefined;
}
```

The Under-deeps destinations are added to the action list alongside starter/region destinations. The `plan-movement` action itself is unchanged — no new fields needed.

---

## Phase 2 — Movement/Hazard: reveal-new-site

### Legal actions for Under-deeps movement

`revealNewSiteActions` in `legal-actions/movement-hazard.ts` currently offers starter and region `declare-path` actions. Under-deeps movement has no region path to choose — it is automatically determined from the two sites. Add:

```ts
// Under-deeps movement
if (isUnderDeepsAdjacent(state, originDef, destDef)) {
  logDetail(`Under-deeps movement available: ${originDef.name} → ${destDef.name}`);
  actions.push({
    type: 'declare-path',
    player: playerId,
    movementType: MovementType.UnderDeeps,
  });
}
```

No `regionPath` field is included — Under-deeps movement has no region path.

### Handling `declare-path` with Under-deeps in `handleRevealNewSite`

Currently the reducer advances directly to `set-hazard-limit` after `declare-path`. For Under-deeps:

```ts
} else if (action.movementType === 'under-deeps') {
  // No region path — resolvedSitePath stays empty
  logDetail(`Under-deeps movement: no region path — only site-keyed hazards apply`);

  // Determine required roll
  const required = getUnderDeepsRequiredRoll(state, originDef, destDef);
  logDetail(`Under-deeps roll required: ${required}`);

  if (required === 0) {
    // Surface → Under-deeps (or explicit 0): no roll needed, proceed directly
    logDetail(`Under-deeps: roll not required (0) — advancing to set-hazard-limit`);
    return advanceToSetHazardLimit(state, mhState, action, destDef, []);
  } else {
    // Roll required: advance to new under-deeps-roll step
    logDetail(`Under-deeps: roll required (>= ${required}) — advancing to under-deeps-roll`);
    return {
      state: {
        ...state,
        phaseState: {
          ...mhState,
          step: 'under-deeps-roll' as const,
          movementType: MovementType.UnderDeeps,
          resolvedSitePath: [],
          resolvedSitePathNames: [],
          destinationSiteType: destDef.siteType,
          destinationSiteName: destDef.name,
          underDeepsRollRequired: required,
        },
      },
    };
  }
}
```

**`getUnderDeepsRequiredRoll`**: Look up the required roll from the origin's `adjacentSites` for the destination name (checking wildcard patterns). If origin does not list destination, check the reverse (destination lists origin). When origin is not Under-deeps (surface → Under-deeps), the roll is always 0.

---

## Phase 3 — New step: `under-deeps-roll`

### Phase state field

Add to `MovementHazardPhaseState`:

```ts
/**
 * Present during the `under-deeps-roll` step only.
 * The minimum 2d6 result required for the company to successfully move.
 */
readonly underDeepsRollRequired?: number;
```

### Legal actions

During the `under-deeps-roll` step, the resource player must roll dice:

```ts
{ type: 'roll-dice', player: playerId }
```

This is the existing dice-roll mechanism used elsewhere in the engine.

### Reducer handling

When the dice roll resolves:

- **Roll ≥ required** (success): Advance to `set-hazard-limit`. The move proceeds normally with empty `resolvedSitePath`.
- **Roll < required** (failure): Company stays. Return destination site to location deck (same logic as `cancel-movement` in the organization reducer, minus the reverse-action bookkeeping). Advance to the next company (same step transition used when a company has no movement declared).

The failure case does **not** count as the company being "returned to its current site" (CRF ruling) — no effects triggered by "returned" fire.

```ts
function handleUnderDeepsRoll(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'roll-dice') {
    return { state, error: `Expected 'roll-dice' during under-deeps-roll step` };
  }

  // Apply roll modifier effects (see roll modifier section below)
  const rollResult = computeDiceRoll(state, action); // 2d6 total
  const required = mhState.underDeepsRollRequired!;
  logDetail(`Under-deeps roll: ${rollResult} vs required ${required}`);

  if (rollResult >= required) {
    logDetail(`Under-deeps roll SUCCESS — advancing to set-hazard-limit`);
    return advanceToSetHazardLimit(state, mhState, action, ...);
  } else {
    logDetail(`Under-deeps roll FAILURE — company stays at ${originName}, returning destination to site deck`);
    return returnDestinationAndAdvance(state, mhState, action);
  }
}
```

---

## Roll modifiers

Several cards modify the under-deeps roll. The mechanism must support a modifier that is computed at roll time by scanning active constraints/in-play cards. Cards are certified separately; the engine needs a query point:

```ts
/**
 * Compute the total modifier to the under-deeps movement roll for a company.
 * Positive modifiers help the roller; negative modifiers hurt.
 * Scans active permanent events and character items for roll-modifier effects.
 */
function computeUnderDeepsRollModifier(
  state: GameState,
  companyId: CompanyId,
): number
```

Known modifier sources (certified as individual cards):

| Card | Effect on roll |
|------|---------------|
| The Balrog (BA-3) | +3 to roll for his company |
| Cave Troll (BA-35) | +1 to required roll (i.e. -1 effective for the mover) |
| Maker's Map (BA-66) | +2 to roll |
| The Reach of Ulmo (DM-82) | +2 to required number |

`Cave Troll` and `The Reach of Ulmo` increase the required number (harder to move); `The Balrog` and `Maker's Map` increase the roll result (easier). The net comparison is `rollResult + positiveModifiers >= required + negativeModifiers`.

---

## Hazard limit and site path

Under-deeps movement sets `resolvedSitePath: []`. Existing hazard limit and keying logic already handles empty site paths correctly (only site-type keyed creatures apply). No change needed in that layer.

---

## MP exclusion at end of game

Rules 10.2.1–10.2.3: MPs from cards at Under-deeps sites are excluded when tallying the threshold for calling the Free Council (but included in the final count). This is a scoring layer concern, deferred to a separate scoring spec.

Balrog exception (10.2.B2): Balrog players include Under-deeps MPs in their threshold too. Also deferred.

---

## Files to change

| File | Change |
|------|--------|
| `engine/legal-actions/organization-companies.ts` | Add `getUnderDeepsReachable`, call alongside `getReachableSites`; add `isUnderDeepsAdjacent` and `resolveAdjacency` helpers |
| `engine/legal-actions/movement-hazard.ts` | Add Under-deeps `declare-path` option in `revealNewSiteActions`; add TODO removal |
| `engine/reducer-movement-hazard.ts` | Handle `movementType === 'under-deeps'` in `handleRevealNewSite`; add `handleUnderDeepsRoll` handler; register step |
| `types/state-phases.ts` | Add `underDeepsRollRequired?: number` to `MovementHazardPhaseState`; add `'under-deeps-roll'` to step union |
| `data/ba-sites.json` | Create with BA Under-deeps sites (BA-83, BA-89–BA-104) including `adjacentSites` and `keywords: ['under-deeps']` |
| `types/cards-sites.ts` | Document wildcard adjacency key convention in `adjacentSites` JSDoc |

---

## Tests to write

- **plan-movement legal actions**: company at Under-deeps site is offered adjacent Under-deeps destinations; company at surface site adjacent to Under-deeps (roll 0) is offered that Under-deeps destination; surface site not adjacent to any Under-deeps site is not offered Under-deeps destinations.
- **declare-path Under-deeps**: `reveal-new-site` step offers `declare-path(movementType: 'under-deeps')` when moving to/from Under-deeps; does not offer it otherwise.
- **No roll needed (roll 0)**: Moving surface → Under-deeps advances directly to `set-hazard-limit` with empty `resolvedSitePath`.
- **Roll success**: Roll ≥ required → company moves to Under-deeps site, `set-hazard-limit` step entered with empty site path.
- **Roll failure**: Roll < required → destination returned to site deck, company stays, no "returned" trigger fires.
- **Wildcard adjacency**: Company at Under-galleries can plan movement to any site in Ûdun region.
- **No region hazards**: During Under-deeps movement, creatures keyed only to region types (not site type) are not legal plays.

---

## Out of scope

- Ancient Deep-hold dynamic adjacency (chosen at card play time)
- Roll modifier card certifications (The Balrog, Cave Troll, Maker's Map, Reach of Ulmo, Earth-tremors, Way is Shut)
- Under-deeps MP scoring exclusion / Balrog MP exception
- Balrog-specific movement restrictions (no region/starter movement — The Balrog character card certification)
