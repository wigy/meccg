# Spec: Generalized 2nd Auto-Attack — Dynamic (from hand) and Permanent-Event-Sourced

## Problem

Two families of cards create an additional auto-attack beyond a site's printed ones, and neither is fully implemented:

**A. Dynamic (from hand)** — 10 DM Under-deeps sites (DM-30, DM-33–41) print a 2nd auto-attack where the hazard player *may* play one non-unique creature from hand, keyed to specific site/region types. The infrastructure (`dynamic-auto-attack` site-rule + `play-site-auto-attack` step) exists for Framsburg (td-175), but the DM sites carry only their 1st static attack in data — the 2nd is missing entirely.

**B. Permanent-event-sourced** — Several hazard permanent events add a fixed attack to named sites while in play:

| Card | Target sites | Attack |
|------|-------------|--------|
| TW-12 Balrog of Moria | Moria | Spawn — 1 strike 18/- (no body); remove from play on defeat |
| BA-21 Monstrosity of Diverse Shape | Drowning-deeps, Remains of Thangorodrim | Spawn — 2 strikes 15/9 |
| BA-24 Spawn of Ungoliant | Pûkel-deeps, Gem-deeps | Spawn — 3 strikes 15/8 |
| BA-27 Ungoliant's Progeny | Wind-deeps, Rusted-deeps | Spawn — 2 strikes 16/8 |
| BA-28 Ungoliant's Foul Issue | Ancient Deep-hold | Spawn — 2 strikes 17/7 |

The existing `dragon-at-home` effect covers a structurally similar case (Dragon At-Home permanent events), but it is tied to the manifestation-chain mechanism (site identified via `lairOf` + `manifestId`), which these Spawn/Balrog cards don't use.

---

## Solution

### Part A — Data fix for DM sites (no engine change required)

The `play-site-auto-attack` step already runs after all printed attacks complete, and the `dynamic-auto-attack` site-rule already gates the step correctly. The only work is adding the effect to each DM site's JSON:

```jsonc
// Example: The Iron-deeps (dm-33)
{
  "effects": [
    {
      "type": "site-rule",
      "rule": "dynamic-auto-attack",
      "keying": { "siteTypes": ["ruins-and-lairs"] }
    }
  ]
}
```

Each DM site needs its own keying object:

| Site | Keying |
|------|--------|
| DM-30 Gem-deeps | `siteTypes: ["shadow-hold"]` |
| DM-33 Iron-deeps | `siteTypes: ["ruins-and-lairs"]` |
| DM-34 Pûkel-deeps | `siteTypes: ["shadow-hold"]` |
| DM-35 Sulfur-deeps | `siteTypes: ["shadow-hold"]` |
| DM-36 Under-courts | `siteTypes: ["shadow-hold"]` |
| DM-37 Under-galleries | `siteTypes: ["shadow-hold"]` |
| DM-38 Under-gates | `siteTypes: ["ruins-and-lairs"]` |
| DM-39 Under-grottos | `siteTypes: ["shadow-hold"]` |
| DM-40 Under-leas | `siteTypes: ["ruins-and-lairs"]` |
| DM-41 Under-vaults | `siteTypes: ["shadow-hold"]` |

The creature played must be non-unique. Check whether `play-site-auto-attack` currently enforces uniqueness — if not, add that guard to the legal action.

---

### Part B — New `permanent-event-auto-attack` effect type

**New DSL effect type** (added to `effects.ts`):

```ts
export interface PermanentEventAutoAttackEffect extends EffectBase {
  readonly type: 'permanent-event-auto-attack';
  /** Site IDs whose auto-attack list is augmented while this event is in play. */
  readonly siteIds: readonly CardDefinitionId[];
  /** The attack stats contributed to those sites. */
  readonly attack: {
    readonly creatureType: string;
    readonly strikes: number;
    readonly prowess: number;
    readonly body?: number;        // absent = no body (Balrog of Moria "18/-")
    readonly combatRules?: readonly string[];
  };
  /**
   * When `'remove-from-play'`, defeating this auto-attack removes the
   * permanent event from play (Balrog of Moria). The card routes to
   * `outOfPlayPile` and its MP value is awarded to the defeating player.
   * Absent for ordinary Spawn augmentations.
   */
  readonly onDefeat?: 'remove-from-play';
}
```

**`getActiveAutoAttacks` augmentation** (`manifestations.ts`):

After collecting `dragon-at-home` augmentations, add a second pass scanning all `cardsInPlay` for `permanent-event-auto-attack` effects targeting the current site:

```ts
function collectPermanentEventAttacks(
  state: GameState,
  siteDef: SiteCard,
): AutomaticAttack[] {
  const out: AutomaticAttack[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = state.cardPool[card.definitionId as string];
      const effects = (def as { effects?: CardEffect[] }).effects;
      if (!effects) continue;
      for (const e of effects) {
        if (e.type !== 'permanent-event-auto-attack') continue;
        const eff = e as PermanentEventAutoAttackEffect;
        if (!eff.siteIds.includes(siteDef.id)) continue;
        out.push({
          creatureType: eff.attack.creatureType,
          strikes: eff.attack.strikes,
          prowess: eff.attack.prowess,
          body: eff.attack.body,
          combatRules: eff.attack.combatRules,
          sourceInstanceId: card.instanceId,
        });
      }
    }
  }
  return out;
}
```

**`AutomaticAttack` — new optional field** (`cards-sites.ts`):

```ts
export interface AutomaticAttack {
  readonly creatureType: string;
  readonly strikes: number;
  readonly prowess: number;
  readonly body?: number;
  readonly combatRules?: readonly string[];
  /**
   * If this attack originates from a permanent-event in play (not from the
   * site card itself), the instance ID of that event. Used by finalizeCombat
   * to trigger `onDefeat` logic (e.g. Balrog of Moria removal).
   */
  readonly sourceInstanceId?: CardInstanceId;
}
```

**`finalizeCombat` — defeat hook** (`reducer-combat.ts`):

After a successful defeat of an auto-attack, check if the current `AutomaticAttack` entry carries a `sourceInstanceId`. If so, look up the source card's effects for `permanent-event-auto-attack` with `onDefeat: 'remove-from-play'`. If found:

1. Remove the card from its owner's `cardsInPlay` and push it to `outOfPlayPile` (preserves no-card-disappears invariant).
2. Award the card's `marshallingPoints` (kill MPs) to the defeating player.

---

## Ordering

For a site with all three sources of auto-attacks, the resolution order is:

1. **Printed attacks** (from `siteDef.automaticAttacks`)
2. **`dragon-at-home` augments** (if Dragon lair + At-Home in play)
3. **`permanent-event-auto-attack` augments** (Spawn/Balrog)
4. **`play-site-auto-attack` step** (dynamic from-hand, optional)

Steps 1–3 are resolved inside the `automatic-attacks` step using the list returned by `getActiveAutoAttacks`. Step 4 is its own phase step that runs after the list is exhausted — no ordering conflict.

---

## Files to change

| File | Change |
|------|--------|
| `packages/shared/src/types/effects.ts` | Add `PermanentEventAutoAttackEffect` interface and union member |
| `packages/shared/src/types/cards-sites.ts` | Add optional `body`, `combatRules`, `sourceInstanceId` fields to `AutomaticAttack` |
| `packages/shared/src/engine/manifestations.ts` | Add `collectPermanentEventAttacks`; call it from `getActiveAutoAttacks` |
| `packages/shared/src/engine/reducer-combat.ts` | Add `onDefeat: 'remove-from-play'` handling in finalize path |
| `packages/shared/src/engine/legal-actions/site.ts` | Add non-unique enforcement in `play-site-auto-attack` legal action (if missing) |
| `packages/shared/src/data/dm-sites.json` | Add `dynamic-auto-attack` effects to 10 DM Under-deeps sites |
| `packages/shared/src/data/tw-hazards.json` | Add TW-12 Balrog of Moria with `permanent-event-auto-attack` effect |
| `packages/shared/src/data/ba-hazards.json` | Add BA-21, BA-24, BA-27, BA-28 with `permanent-event-auto-attack` effects |
| `docs/card-effects-dsl.md` | Document `permanent-event-auto-attack` effect type |

---

## Card tests to write

- **DM Under-deeps**: entering a site with a static 1st attack + `dynamic-auto-attack` — verify legal actions include `play-site-auto-attack` only after static attacks resolve; verify a unique creature is not a legal play.
- **Balrog of Moria (TW-12)**: Moria with Balrog in play has 2 auto-attacks; defeating the 2nd removes the card from play and awards MPs to the defeating player; when not in play, Moria has 1 auto-attack.
- **Spawn augments (BA-21, BA-24, BA-27, BA-28)**: affected sites gain the additional Spawn attack while the Spawn card is in play; unaffected sites are unchanged.
