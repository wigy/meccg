# Taking Prisoner — Feature Plan

**Date:** 2026-05-18  
**Rules:** CoE Rules 8.35 (Prisoners) and 8.36 (Rescuing Prisoners)  
**Sample hazard:** Flies and Spiders (dm-58) — hazard permanent-event  
**Companion certification:** Noble Hound (dm-179) — hero-resource-ally

---

## Rules Summary

### Rule 8.35 — Prisoners

A **hazard host** is a hazard permanent-event that, when the strike it is played
on succeeds, takes the targeted character prisoner at a **rescue site** drawn
from the hazard player's location deck.

**Playability:** A hazard host may only be played if a valid rescue site is
available from the hazard player's location deck, and the rescue site is
geographically reachable:
- **Starter movement:** rescue site must be in the region of origin or new site.
- **Region movement:** rescue site must be in a traversed or adjacent region.
- **Stationary company:** rescue site must be in the same region.
- **Under-deeps adjacency:** the adjacent Under-deeps site is always valid.

**When taken prisoner:**
- Followers revert to general influence (mind not subtracted until next org phase).
- All other non-ring cards on the prisoner are discarded immediately.
- The prisoner costs 0 GI to control (removed from GI accounting).
- The prisoner cannot take any actions (including healing or untapping).
- The prisoner cannot be affected by cards that do not specifically target prisoners.
- The prisoner is worth **negative marshalling points** to their player (and
  remains negative even if eliminated while prisoner).

### Rule 8.36 — Rescuing Prisoners

A company that successfully enters the rescue site during the site phase may
attempt a rescue:

1. Face any **rescue-attacks** listed on the hazard host (these are not
   automatic-attacks and do not count against the hazard limit).
2. **Tap one character** in the company to rescue all prisoners of that host.
3. Rescued characters immediately join the company under general influence.
4. The rescue site taps (if untapped) and one **minor item** may be played as
   the next declared resource action (tap an untapped company member to enable
   playing, then place the item under that character's control).

**Resource player's location deck:** A resource player without the rescue site
in their location deck may use the hazard player's rescue site card to move
there (for rescue only — no other site-phase actions at that card apply).

**Host discarded:** If a hazard host is discarded (by any means), its prisoner
is automatically rescued and forms a new company at the rescue site (rather
than going to the discard pile per normal rules).

**Allies:** Allies cannot be taken prisoner. An ally facing an untargeted
strike from a prisoner-taking attack is neither tapped nor wounded.

---

## Architecture

### New State: Hazard Hosts

Add a top-level `hazardHosts` array to `GameState` (not per-player — hazard
hosts span both players' concerns):

```typescript
// packages/shared/src/types/state.ts

export interface HazardHost {
  /** The hazard permanent-event card instance (stays here — does not disappear). */
  readonly hostCard: CardInstance;
  /** The rescue site card instance (drawn from hazard player's location deck). */
  readonly rescueSiteCard: CardInstance;
  /** Instance IDs of characters currently held prisoner by this host. */
  readonly prisoners: readonly CardInstanceId[];
  /** PlayerId of the hazard player who controls this host. */
  readonly ownedBy: PlayerId;
}

// In GameState:
readonly hazardHosts: readonly HazardHost[];
```

Prisoner characters remain in `player.characters` (the "no card disappears"
invariant is preserved). They gain an `activeConstraints` entry of type
`character-is-prisoner` that links back to the host card's instance ID.

### New Constraint: `character-is-prisoner`

```typescript
// packages/shared/src/types/pending.ts  (add to ActiveConstraint union)

{
  readonly type: 'character-is-prisoner';
  /** The hazard host's instance ID — used to locate the HazardHost record. */
  readonly hostInstanceId: CardInstanceId;
}
```

The constraint enforcer (in the legal-action computer and reducer) gates:
- Untapping the character.
- The character taking any action.
- Non-prisoner-specific cards targeting the character.
- GI accounting (subtract 0 mind instead of normal mind value).

### New DSL Effect: `take-prisoner`

Carried by hazard permanent-event cards. Marks the card as a hazard host.

```typescript
// packages/shared/src/types/effects.ts

export interface TakePrisonerEffect extends EffectBase {
  readonly type: 'take-prisoner';
  /**
   * Site types that are valid rescue sites (e.g. ["ruins-and-lairs"]).
   * The hazard player must have a matching site available in their location deck.
   */
  readonly rescueSiteTypes: readonly string[];
  /**
   * Rescue-attacks that must be faced before rescuing.
   * Each entry is the same shape as a CreatureAttack.
   */
  readonly rescueAttacks: readonly RescueAttack[];
  /**
   * Card condition restricting which attack types this card can be played on.
   * e.g. { "attack.race": "Spider" }
   */
  readonly playableOn?: Condition;
  /**
   * Optional auto-rescue mechanic checked during the prisoner's untap phase.
   * If present, a body check (modified by `bodyCheckModifier`) is made;
   * then if the character survives, a roll + body > `autoRescueThreshold`
   * frees the prisoner automatically.
   */
  readonly autoRescue?: {
    readonly bodyCheckModifier: number;
    readonly autoRescueThreshold: number;
  };
}
```

### New DSL Effect: `cancel-prisoner-taking`

Carried by resource cards (typically allies). Allows the card to be discarded
to cancel a prisoner-taking effect on the bearer's controlling character.

```typescript
// packages/shared/src/types/effects.ts

export interface CancelPrisonerTakingEffect extends EffectBase {
  readonly type: 'cancel-prisoner-taking';
  /**
   * Whether protection extends to all characters in the company or
   * only the controlling character.  Noble Hound: "controlling-character".
   */
  readonly scope: 'controlling-character' | 'company';
}
```

---

## Sample Hazard: Flies and Spiders (dm-58)

### Card Text

> **Playable on a character facing a Spider attack.** If the strike is
> successful, target character is not harmed and is taken prisoner at a
> Ruins & Lairs [{R}]. During his untap phase, make a body check for that
> character modified by +1. If not eliminated, his player then makes a roll
> adding his body. If the result is greater than 15, the character is
> automatically rescued into his own company located at the rescue site.
>
> Rescue-attack: Spiders — 3 strikes with 9 prowess.

### Card Data (to add to `dm-hazards.json`)

```json
{
  "cardType": "hazard-event",
  "id": "dm-58",
  "name": "Flies and Spiders",
  "image": "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/FliesandSpiders.jpg",
  "unique": false,
  "eventType": "permanent",
  "text": "Playable on a character facing a Spider attack. If the strike is successful, target character is not harmed and is taken prisoner at a Ruins & Lairs [{R}]. During his untap phase, make a body check for that character modified by +1. If not eliminated, his player then makes a roll adding his body. If the result is greater than 15, the character is automatically rescued into his own company located at the rescue site. Rescue-attack: Spiders — 3 strikes with 9 prowess.",
  "effects": [
    {
      "type": "play-target",
      "target": "character",
      "filter": { "attack.race": "Spider" }
    },
    {
      "type": "take-prisoner",
      "rescueSiteTypes": ["ruins-and-lairs"],
      "rescueAttacks": [
        { "race": "Spider", "strikes": 3, "prowess": 9 }
      ],
      "autoRescue": {
        "bodyCheckModifier": 1,
        "autoRescueThreshold": 15
      }
    }
  ]
}
```

### Rule-by-Rule Implementation Mapping

| Rule | DSL / Engine Mechanism |
|------|------------------------|
| Playable on Spider strike only | `play-target` with `filter: { "attack.race": "Spider" }` |
| Rescue site must be R&L and geographically reachable | `take-prisoner.rescueSiteTypes` validated in legal-action computer during M/H phase |
| Character not harmed, taken prisoner | `take-prisoner` effect: on strike success, skip wound/tap; add to `hazardHosts[n].prisoners`; add `character-is-prisoner` constraint |
| Followers revert to GI | Handled by reducer when `character-is-prisoner` constraint added |
| Non-ring items discarded | Handled by reducer when constraint added |
| Prisoner cannot act/heal/untap | `character-is-prisoner` constraint checked in all relevant legal-action computers |
| Prisoner worth negative MP | MP computation reads `character-is-prisoner` constraint, uses negative sign |
| Body check +1 during untap | `autoRescue.bodyCheckModifier: 1` — triggered during untap phase for each prisoner |
| Auto-rescue if roll + body > 15 | `autoRescue.autoRescueThreshold: 15` — if threshold met, remove from host, form new company |
| Rescue-attack: Spiders 3/9 | `rescueAttacks: [{ race: "Spider", strikes: 3, prowess: 9 }]` |
| Rescue: enter site, face rescue-attacks, tap character | New legal actions in site-phase handler |

---

## Companion Certification: Noble Hound (dm-179)

### Card Text

> **Playable at any tapped or untapped Border-hold [{B}].** In all cases,
> Noble Hound must be assigned a strike before any strike can be assigned to
> its controlling character. If Noble Hound is tapped or wounded, treat it as
> though it were untapped for the purposes of assigning strikes. Discard Noble
> Hound to cancel any effect that would take its controlling character prisoner
> (does not protect other characters from being taken prisoner).

### Card Data (update `dm-resources.json` — add effects to dm-179)

```json
{
  "effects": [
    {
      "type": "play-target",
      "target": "site",
      "filter": { "site.type": "border-hold" },
      "requireTapped": false
    },
    {
      "type": "strike-shield",
      "scope": "controlling-character",
      "alwaysCountsAsUntapped": true
    },
    {
      "type": "cancel-prisoner-taking",
      "scope": "controlling-character"
    }
  ]
}
```

### New DSL Effect: `strike-shield`

```typescript
// packages/shared/src/types/effects.ts

export interface StrikeShieldEffect extends EffectBase {
  readonly type: 'strike-shield';
  /**
   * The carrier must be assigned at least one strike before any strike
   * may be assigned to the named entity.
   * "controlling-character" = the character who controls this ally.
   */
  readonly scope: 'controlling-character';
  /**
   * If true, this card always counts as untapped when determining
   * whether it can be assigned a strike (Noble Hound: even if tapped
   * or wounded, it is still assignable and protects the character).
   */
  readonly alwaysCountsAsUntapped?: boolean;
}
```

### Rule-by-Rule Implementation Mapping (Noble Hound)

| Rule | DSL / Engine Mechanism |
|------|------------------------|
| Playable at any border-hold (tapped or untapped) | `play-target` with `filter: { "site.type": "border-hold" }`, `requireTapped: false` |
| Must be assigned strike before controlling character | `strike-shield` effect, enforced in assign-strikes legal-action computer |
| Counts as untapped for strike assignment even if tapped/wounded | `alwaysCountsAsUntapped: true` on `strike-shield` |
| Discard to cancel prisoner-taking on controlling character | `cancel-prisoner-taking` — offered as a reactive option during strike resolution when a `take-prisoner` hit would apply |

---

## Implementation Steps

### Phase 1 — Core Prisoner State

1. **`state.ts`** — Add `HazardHost` interface and `hazardHosts: readonly HazardHost[]` to `GameState`.
2. **`pending.ts`** — Add `character-is-prisoner` to `ActiveConstraint` union.
3. **`state-player.ts`** / `resolveInstanceId` — Verify prisoner characters remain reachable (they already stay in `player.characters`; no change needed, but add a search through `hazardHosts[].prisoners` as a cross-reference sanity check in dev mode).
4. **MP computation** — When summing character MPs, check `character-is-prisoner` constraint; if present, apply negative sign.
5. **GI accounting** — When computing `generalInfluenceUsed`, exclude characters with `character-is-prisoner` constraint.

### Phase 2 — Prisoner Constraints in Legal Actions

6. **Untap phase** — Skip untap for characters with `character-is-prisoner` (unless auto-rescue fires).
7. **All action computers** — Gate any action that requires the acting character to not be a prisoner.
8. **Hazard targeting** — Cards that do not specifically target prisoners may not target prisoner characters.

### Phase 3 — `take-prisoner` DSL Effect (Hazard Host Mechanic)

9. **`effects.ts`** — Add `TakePrisonerEffect` interface.
10. **`types/cards-hazards.ts`** card data** — `HazardEventCard.effects` already accepts `CardEffect[]`; no type change needed.
11. **Legal actions (M/H phase)** — When computing playable hazard events, check `take-prisoner` cards: verify a valid rescue site exists in the hazard player's location deck and is geographically reachable. If not, card is not legal to play.
12. **Strike resolution** — When a `take-prisoner` hazard event is attached to a character and that character's strike is successful:
    - Skip the normal wound/tap outcome.
    - Draw the rescue site card from the hazard player's location deck.
    - Create a new `HazardHost` entry with the host card, rescue site, and prisoner.
    - Add `character-is-prisoner` constraint to the prisoner character.
    - Discard all non-ring items from the prisoner.
    - Revert followers to GI (mind not subtracted until next org phase — use a deferred `pending` marker).
13. **Auto-rescue (Flies and Spiders special)** — During the untap phase, for each prisoner with `autoRescue` on its host card:
    - Trigger a body check modified by `bodyCheckModifier`.
    - If the character survives: trigger a dice roll; if `roll + body > autoRescueThreshold`, auto-rescue (remove from host, form new company at rescue site).

### Phase 4 — Rescue Mechanics (Rule 8.36)

14. **Site phase legal actions** — When a company successfully enters the rescue site of an active `HazardHost`:
    - Present rescue-attacks (from `rescueAttacks` on the host's `take-prisoner` effect). These are not automatic-attacks.
    - After rescue-attacks, if any character is untapped: offer a `tap-to-rescue` action.
15. **`tap-to-rescue` action** — Tap one character; move all prisoners out of the host's `prisoners` list; add them to the rescuing company under general influence; remove their `character-is-prisoner` constraints. Tap the rescue site if untapped. Offer play-minor-item as the next declared resource action.
16. **Host discard** — When a hazard host card is discarded by any means, rescue all prisoners and form a new company at the rescue site instead of discarding the prisoner characters.

### Phase 5 — Noble Hound Certification

17. **`effects.ts`** — Add `StrikeShieldEffect` interface.
18. **`effects.ts`** — Add `CancelPrisonerTakingEffect` interface.
19. **`docs/card-effects-dsl.md`** — Document `strike-shield`, `cancel-prisoner-taking`, and `take-prisoner` in the DSL reference.
20. **Assign-strikes legal-action computer** — When a company with an ally carrying `strike-shield` is being assigned strikes, enforce that the ally receives at least one strike before its controlling character can be assigned.
21. **Strike resolution (cancel window)** — When a `take-prisoner` hit resolves and the prisoner character's controller has an ally with `cancel-prisoner-taking` in play, offer a reactive discard option. If accepted: discard the ally; cancel the prisoner-taking outcome (character is instead handled normally — wounded or tapped per standard combat result).
22. **`dm-resources.json`** — Add `effects` array to `dm-179` (Noble Hound).
23. **`dm-hazards.json`** — Add `dm-58` (Flies and Spiders) card entry.

---

## Rule Tests

### `rule-8.35-prisoners.test.ts` (fill in the existing `.todo`)

```typescript
test('Hazard hosts take characters prisoner at rescue site; followers revert to GI; prisoner cannot act; worth negative MP', () => {
  // Build state: company moving through a region with a Spider attack.
  // Hazard player has a valid R&L rescue site.
  // Play Flies and Spiders on a character facing the spider strike.
  // Resolve strike as successful.
  // Assert:
  //   - hazardHosts has one entry with the character's instanceId.
  //   - character has character-is-prisoner activeConstraint.
  //   - non-ring items on character are in discard pile.
  //   - followers are back under general influence.
  //   - computeLegalActions for prisoner character: no available actions.
  //   - MP computation: prisoner character contributes negative MP.
  //   - generalInfluenceUsed: prisoner's mind is excluded.
});
```

### `rule-8.36-rescuing-prisoners.test.ts` (fill in the existing `.todo`)

```typescript
test('Company enters rescue site, faces rescue-attacks, taps character to rescue all prisoners from host; may play minor item', () => {
  // Build state: hazardHost in play with one prisoner at R&L rescue site.
  // Company successfully enters the rescue site during site phase.
  // Assert: rescue-attacks are offered (not automatic-attacks).
  // After company survives rescue-attacks:
  // Assert: tap-to-rescue action is legal.
  // Apply tap-to-rescue.
  // Assert:
  //   - hazardHosts entry is empty (or removed).
  //   - former prisoner is in rescuing company under general influence.
  //   - character-is-prisoner constraint is removed.
  //   - rescue site is tapped.
  //   - play-minor-item is offered as next declared action.
});
```

### `dm-58.test.ts` (new card test)

```typescript
describe('dm-58: Flies and Spiders', () => {
  test('Not playable on non-Spider attack', () => { ... });
  test('Playable only if valid R&L rescue site is in hazard location deck', () => { ... });
  test('On successful strike: character taken prisoner, not wounded', () => { ... });
  test('Auto-rescue: body check +1; if roll + body > 15 → freed', () => { ... });
  test('Auto-rescue: body check +1; if roll + body ≤ 15 → stays prisoner', () => { ... });
  test('Rescue-attack: Spiders 3/9 offered at rescue site', () => { ... });
});
```

### `dm-179.test.ts` (new card test — Noble Hound)

```typescript
describe('dm-179: Noble Hound', () => {
  test('Playable at tapped border-hold', () => { ... });
  test('Playable at untapped border-hold', () => { ... });
  test('Noble Hound must be assigned a strike before controlling character', () => { ... });
  test('Noble Hound counts as untapped for strike assignment even when tapped', () => { ... });
  test('Noble Hound counts as untapped for strike assignment even when wounded', () => { ... });
  test('Discard Noble Hound cancels prisoner-taking on controlling character', () => { ... });
  test('Noble Hound does not protect other characters from prisoner-taking', () => { ... });
});
```

---

## Risks and Open Questions

1. **Location-deck reachability check** — The hazard host legality check (Phase 3,
   step 11) requires knowing which region the company is moving through or
   currently at. This data is available in `phaseState` during M/H computation,
   but the rescue-site geographic restriction is multi-clause. Needs careful
   implementation to match all four movement types (starter, region, stationary,
   under-deeps).

2. **Ally allies as prisoners** — The rules explicitly say allies cannot be taken
   prisoner. The strike-targeting computer must exclude allies from `take-prisoner`
   assignment, and the assign-strikes computer must expose the untargeted-ally
   behavior (ally faces strike but is neither tapped nor wounded).

3. **Deferred GI for followers** — Followers of a captured character revert to GI
   immediately but mind is not subtracted until the next org phase. This requires a
   pending marker (likely a new `ActiveConstraint` or a deferred action), similar
   in shape to how existing org-phase deferrals work.

4. **Prisoner forms new company on host discard** — The "forms a new company at
   rescue site" behavior for discarded hosts is unusual. The company factory
   (wherever new companies are created) needs a variant that places a character
   at a specific site without requiring site-phase entry.

5. **`cancel-prisoner-taking` timing** — The cancel window must be clearly defined
   relative to the combat chain. A sensible slot: after the strike roll is confirmed
   successful and before the "take prisoner" outcome is applied, the defender is
   offered a cancel opportunity if a `cancel-prisoner-taking` ally is available.

6. **Noble Hound `alwaysCountsAsUntapped`** — This is a character-in-company check,
   not a standard untap-state check. The assign-strikes computer needs to treat the
   ally's tap/wound state as irrelevant for assignability when this flag is set.
