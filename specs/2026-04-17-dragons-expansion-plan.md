# The Dragons (METD) — Implementation Spec

Status tracker for implementing MECCG *The Dragons* expansion rules. Source: `https://meccg.com/rules/by-expansion/the-dragons/` (mirrored from the METD Insert).

Scope covers rule-engine mechanics only. Per-card DSL wiring is tracked separately in card certification.

**Legend:** ✓ done · △ partial · ✗ missing

---

## 1. Key Words

METD introduces keywords used by card text; most need no engine support beyond being tags. Exceptions are called out.

| Keyword | Status | Notes |
|---|---|---|
| Drake | ✓ | Modeled as `race: "drake"` on creatures. |
| Light enchantment | ✗ | No data tag; no engine hook. |
| Dark enchantment | ✗ | No data tag; no engine hook. |
| Ritual | △ | Tag exists on td-134 only; no consumer. |
| Riddling attempt / riddling roll | ✗ | Card text references this; `check` type absent. |
| Offering attempt | ✗ | No `check` type. |
| Flattery attempt | ✗ | No `check` type. |
| Capture | ✗ | No mechanic yet; reserved per rules text. |
| Helmet | ✓ | A character may only use the effects of one helmet at a time. Implemented via `engine/item-slots.ts` (rule 9.15 helmet case). Weapon/armor/shield enforcement still pending. |

### 1.1 Helmet one-at-a-time constraint

- Add a constraint kind (or extend `item-usage`) that disables additional helmet effects when the bearer already has a tapped/active helmet in effect.
- Enforce at "use effect" time, not at play time — multiple helmets can be carried, only one usable.
- Add rules test under `rule-9.15-item-usage.test.ts`.

### 1.2 Riddling / offering / flattery attempts

- Generalize the current `influence` check into a `check` DSL with a `kind: "influence" | "riddling" | "offering" | "flattery"` discriminator.
- Keep scoring/modifier pipeline identical; different cards target different kinds.
- Add data tags on cards that modify a specific attempt kind (e.g. td-25 "Foolish Words").

---

## 2. Dragon Lairs

Definition: *any site with a Dragon automatic-attack is a Dragon's lair.*

Nine canonical Dragon/lair pairs:

| Dragon | Lair (site) | Region |
|---|---|---|
| Agburanar | Caves of Ulund | Withered Heath |
| Bairanax | Ovir Hollow Grey | Mountain Narrows |
| Daelomin | Dancing Spire | Withered Heath |
| Eärcaraxë | Isle of the Ulond | Andrast Coast |
| Itangast | Gold Hill | Withered Heath |
| Leucaruth | Irerock | Withered Heath |
| Scatha | Gondmaeglom | Grey Mountain Narrows |
| Scorba | Zarak Dum | Angmar |
| Smaug | The Lonely Mountain | Northern Rhovanion |

### 2.1 Gaps

- Only Isle of the Ulond (td-178) exists today. The other eight lair sites must be added to `td-sites.json` with the correct Dragon auto-attack.
- The **"lair has a Dragon auto-attack"** predicate must be derivable from site + active Dragon state, not hard-coded on the site card, because the auto-attack can be suppressed when a manifestation is defeated (see §4) and added when "At Home" is played.

### 2.2 Data model

- Add a `lairOf: ManifestId` field on the affected sites pointing to the base-form card of the Dragon (e.g. Smaug's basic creature). The engine derives lair auto-attack state from whether that manifestation is defeated (see §4.3).
- `ManifestId` is a `CardDefinitionId` of the base form (first-released card) of a manifestation chain — see §4.3.

---

## 3. Hoards

**Rule:** hoard items may only be played at a site that contains a hoard. Every Dragon's lair contains a hoard. Hoard **minor** items may not be included in a starting company.

### 3.1 Data

- Add a boolean `hoard: true` flag to item cards that are hoard items.
- The same nine lair sites (§2) have `hoard: true`.

### 3.2 Engine

- **Play-time constraint** on hoard items: the target site must have `hoard: true` (or be derived as a lair currently containing a hoard).
- **Deck-construction constraint:** hoard minor items are rejected from the starting-company pre-placement step — validated where other pre-placement item checks live.
- **Generalize** as a DSL filter `{ "filter": { "site.hoard": true } }` rather than a hardcoded keyword — see `feedback_generalize_card_effects`.

---

## 4. Manifestations of Dragons

Each of the 9 unique Dragons has three distinct cards:

- **Basic** — a standard creature card (e.g. Smaug). Some (Smaug, Agburanar, Daelomin, Leucaruth) shipped in METW.
- **Ahunt** — a hazard *long-event* that attacks any company moving in a set of regions.
- **At Home** — a hazard *permanent-event* that gives the Dragon's lair an additional automatic-attack and applies a global effect.

Multiple manifestations of the same Dragon may be in play simultaneously.

### 4.1 Marshalling-point rule

Only the **opponent** of the player who played a manifestation may earn MPs from defeating it. If the player who played it defeats their own manifestation, it is removed and no MPs are awarded.

**Attribution mechanism.** "Who played it" is derivable directly from the manifestation's `CardInstanceId` via `ownerOf(instanceId)` (defined in `types/state.ts`). All instance IDs are minted as `<playerId>-<counter>` (see `engine/init.ts`), so deck-ownership — which in MECCG is the same as "who played it", since deck-ownership never transfers — is encoded in the prefix and resolves in O(1) without any state lookup or extra field on `CardInstance`. The defeat reducer awards MPs iff `ownerOf(manifestation.instanceId) !== defeater.playerId`.

### 4.2 Defeat cascade

When any manifestation of a Dragon is defeated, or otherwise removed from play:

1. All other manifestations of the same Dragon are removed from the game.
2. No further manifestations of that Dragon may be played this game.
3. The Dragon's lair loses its automatic-attack.

This is a single atomic event — the cascade happens even if the triggering manifestation was already in a pile or discarded via another effect.

### 4.3 State model

**No new top-level state.** The mechanic generalizes: future expansions add manifestations of other entities (Aragorn, Gollum, …), so this section uses `manifestId` rather than a Dragon-specific tag. Both predicates the cascade depends on are derivable from the existing eliminated piles, given a `manifestId` tag on every manifestation card (for Dragons: basic creature, ahunt, at-home all share the basic creature's id):

- **Defeated?** `bothPlayers.eliminated.some(c => defOf(c).manifestId === M)`
- **MP attribution?** `ownerOf(defeated.instanceId) !== defeater.playerId` (see §4.1)
- **Lair M auto-attack active?** `!isManifestationDefeated(M)`
- **Replay blocked?** `isManifestationDefeated(M)`

Rationale: a separate manifestation-status map would be a second source of truth that must stay in sync with pile contents. Deriving from the eliminated pile keeps the no-card-disappears invariant (`feedback_no_card_disappears`) load-bearing — if the cascade reducer fails to move a sister manifestation, the bug is visible in pile contents instead of silently masked by a status flag. Using a card definition id as the key (rather than a parallel `DragonId` enum) means new manifestation chains in future sets need no new types — just the tag on the new cards.

Required data shape:

```ts
// CardDefinitionId of the base-form card of the chain.
// For Dragons: the basic Dragon creature card (e.g. Smaug's basic creature).
// All cards in one chain (basic + ahunt + at-home for Dragons) share the
// same manifestId, and the base-form card's manifestId points to itself.
type ManifestId = CardDefinitionId;

// On manifestation card definitions:
manifestId: ManifestId;
```

All manifestation resolution paths must:

- On play: gate on `!isManifestationDefeated(manifestId)`.
- On defeat/removal: sweep all in-play cards sharing the same `manifestId` (across both players' zones) into the owning player's eliminated pile — no instance is dropped (`feedback_no_card_disappears`). The defeated predicate then flips automatically.
- Lair auto-attack lookup at the site reads `isManifestationDefeated(site.lairOf)` rather than a status field.

Helper to define once and reuse:

```ts
function isManifestationDefeated(state: GameState, m: ManifestId): boolean {
  return state.players.some(p =>
    p.eliminated.some(c => defOf(c).manifestId === m)
  );
}
```

### 4.4 Current state

- Ahunt: ✓ implemented (td-21 Eärcaraxë Ahunt, td-37 Itangast Ahunt) via `ahunt-attack` effect.
- Basic: ✗ missing — none of the nine basic Dragon creatures ship in current data.
- At Home: ✗ missing — no cards, no `at-home` effect, no lair-auto-attack augmentation path.

### 4.5 New DSL work

- New effect type `dragon-at-home` — resolves to (a) registering an extra auto-attack on the lair, and (b) a global-effect modifier keyed on the specific Dragon.
- New reducer path `defeat-dragon-manifestation` handling the cascade and lair-auto-attack suppression.

---

## 5. Hazard Limit Clarification

**Rule:** the base hazard limit is locked at the moment a company reveals its new site / announces its movement-hazard phase. Pre-reveal modifiers apply in the order chosen by the moving player. Post-reveal modifiers apply in resolution order. Hazard-limit modifiers played during the **site phase** are ignored. Reductions during movement-hazard don't affect cards already announced.

### 5.1 Gaps

- The engine currently does not distinguish "pre-reveal" vs "post-reveal" hazard-limit modifiers.
- Add a per-company snapshot `hazardLimitAtReveal` set at reveal time and reference it (instead of recomputing) when validating played hazards.
- Site-phase hazard-limit modifiers must be no-ops: enforce by phase-gating the effect resolver.

---

## 6. Characters Facing Multiple Strikes

**Rule:** certain METD cards assign a character more than one strike from a single attack. The character resolves each strike as its own sequence; tap/wound state updates between sequences; elimination mid-sequence cancels remaining strikes.

### 6.1 Status

- ✓ Implemented — rule 8.05 has passing tests and strike sequence supports serial resolution.

---

## 7. Removing Corruption Cards

**Rule:** a character may ignore the "must tap" printed restriction on a corruption card and instead suffer **−3 to the removal roll**. This permits:

- removing corruption while untapped without tapping (−3 applied),
- attempting removal while already tapped or wounded (−3 applied).

A character may only attempt each corruption card **once per turn** when using this no-tap variant.

### 7.1 Gaps

- Today's engine has a generic "untapped −3" concept but not a corruption-removal specific variant with a per-turn lockout.
- Need: per-character, per-corruption-card `removalAttemptsThisTurn` tracking for the no-tap variant.
- Reset on untap phase.
- UI must offer both options when the character is untapped (tap for normal roll vs. stay untapped for −3).

---

## 8. Sideboard (NOT IMPLEMENTED)

The METD Insert's sideboard rules (size +5, end-of-opponent's-untap swap with Wizard gate, hazard-limit halving) are **not adopted** by this project. We use only the official tournament rules (CRF) for sideboard handling. No work required here.

---

## 9. Region Movement Limit

**Rule:** region movement normally lays down a maximum of **4** region cards. Effects that permit additional region cards cap out at **6** total.

### 9.1 Status

- ✓ Implemented — `MAX_REGION_MOVEMENT = 4`, extra-region effects enforce the 6-ceiling.

---

## 10. Implementation Plan (suggested order)

Sequenced to minimize partial states where manifested cards exist but can't resolve correctly.

1. **Keywords + DSL scaffolding** — add tag support for `light-enchantment`, `dark-enchantment`, `ritual`, `helmet`, `hoard` in card data typings. No behavior yet.
2. **Hazard limit lock at reveal** (§5) — foundational, many later cards depend on correct hazard-limit arithmetic.
3. **Helmet one-at-a-time** (§1.1) — small, self-contained, unblocks basic helmet cards.
4. **Hoards** (§3) — add sites with `hoard: true`, wire hoard-item play constraint + deck-construction rejection.
5. **Manifestation tagging + basic lairs** (§2, §4.3) — add `manifestId` to manifestation card data (for Dragons: the basic creature card's id, shared by basic/ahunt/at-home) and `lairOf: ManifestId` to lair sites; add the eight missing lair sites; implement the `isManifestationDefeated()` helper and wire lair auto-attack through it. No new `GameState` fields.
6. **Basic Dragon creature cards** (§4) — fill the gap for the 9 basic manifestations; verify MP attribution and cascade on defeat.
7. **Dragon "At Home"** (§4) — new `dragon-at-home` effect, lair auto-attack augmentation, per-Dragon global effects.
8. **Cascade on defeat** (§4.2) — atomic removal sweep + replay block + lair-auto-attack suppression; test end-to-end with Ahunt, At Home, and Basic all in play.
9. **Check-kind generalization** (§1.2) — extend influence into `riddling` / `offering` / `flattery` variants.
10. **Corruption no-tap variant** (§7) — per-character, per-card attempt tracking.
11. **Capture** (§1) — defer until a card needs it; rules note that no current card uses it.

---

## 11. Tests

Each of the above rules needs coverage under `packages/shared/src/tests/rules/`:

- `rule-metd-hazard-limit-lock.test.ts`
- `rule-metd-helmet-one-at-a-time.test.ts` (extend rule 9.15)
- `rule-metd-hoard-item-play-site.test.ts`
- `rule-metd-hoard-minor-starting-company.test.ts`
- `rule-metd-dragon-manifestations.test.ts` (cascade, MP attribution, replay block, lair auto-attack)
- `rule-metd-corruption-no-tap-variant.test.ts`

Card tests follow per-card certification, gated on the rule tests above passing.
