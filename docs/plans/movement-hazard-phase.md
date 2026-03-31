# Movement/Hazard Phase State Design

State structures for tracking the Movement/Hazard phase (CoE rules 2.IV.i–viii).

## Rules Summary (8 Steps per Company)

Companies resolve their M/H phases sequentially. Each company goes through:

| Step | CoE Ref | Interactive? | Description |
|------|---------|-------------|-------------|
| 1 | 2.IV.i | No | Reveal new site; validate movement legality |
| 2 | 2.IV.ii | **Yes** | Resource player declares movement type and site path |
| 3 | 2.IV.iii | No | Set base hazard limit: `max(company_size, 2)`, halved if hazard player accessed sideboard |
| 4 | 2.IV.iv | **Yes** | Hazard player orders ongoing effects (if >1 applicable) |
| 5 | 2.IV.v | No | Both players draw cards based on site card draw boxes |
| 6 | 2.IV.vi | No | Resolve passive conditions |
| 7 | 2.IV.vii | **Yes** | Hazard player plays creatures, events, on-guard cards; both players act until both pass |
| 8 | 2.IV.viii | No | Dispose site of origin; reset hands to 8 |

After all companies: must join companies at same non-haven site; may choose to join at haven.

## Phase Sub-Steps (`MHStep`)

```
'declare-path' → 'order-effects' → 'play-hazards'
```

- **`declare-path`** — Resource player declares `MovementType` (Starter, Region, UnderDeeps, Special) and, for region movement, the specific region path. Skipped if company is not moving.
- **`order-effects`** — Hazard player orders ongoing effects triggered at the start of this company's M/H phase. Skipped when ≤1 applicable effect. Hazard-limit modifications are ordered by the resource player separately.
- **`play-hazards`** — Main interactive step. Ends when both players pass (hazard player may resume if resource player acts after passing).

## State Structures

### `MovementHazardPhaseState`

Located in `packages/shared/src/types/state.ts`.

| Field | Type | Purpose |
|-------|------|---------|
| `phase` | `Phase.MovementHazard` | Discriminant |
| `step` | `MHStep` | Current sub-step |
| `activeCompanyIndex` | `number` | Which company is resolving |
| `movementType` | `MovementType \| null` | Declared at step 2; null before declaration or if not moving |
| `pendingEffectsToOrder` | `readonly CardInstanceId[]` | Ongoing effects awaiting ordering at step 4; empty outside that step |
| `hazardsPlayedThisCompany` | `number` | Count against hazard limit |
| `hazardLimit` | `number` | Fixed for the company's entire M/H phase |
| `resolvedSitePath` | `readonly RegionType[]` | Region types traversed; for creature keying by type |
| `resolvedSitePathNames` | `readonly string[]` | Region names traversed; for creature keying by name |
| `destinationSiteType` | `SiteType \| null` | For creature keying to site type |
| `destinationSiteName` | `string \| null` | For creature keying to site name |
| `resourcePlayerPassed` | `boolean` | Resets if resource player acts again |
| `hazardPlayerPassed` | `boolean` | Hazard player may resume if resource player acts |
| `onGuardPlacedThisCompany` | `boolean` | Limit: one on-guard placement per company per M/H phase |
| `returnedToOrigin` | `boolean` | If true, phase ends immediately; no site phase actions |

### `Company` — M/H-related fields

| Field | Type | Purpose |
|-------|------|---------|
| `siteOfOrigin` | `CardInstanceId \| null` | Set at step 2; used for site disposal at step 8 and draw-card logic |
| `onGuardCards` | `readonly CardInstanceId[]` | Face-down cards placed by hazard player. One per company's M/H phase, but accumulates when companies at the same site are joined. Persists into Site phase for reveal. |

### `PlayerState` — M/H-related field

| Field | Type | Purpose |
|-------|------|---------|
| `sideboardAccessedDuringUntap` | `boolean` | Halves hazard limit when this player is the hazard player. Reset each untap phase. |

### `OpponentCompanyView` — visibility

| Field | Type | Purpose |
|-------|------|---------|
| `hasOnGuardCard` | `boolean` | Resource player knows a face-down card exists but not its identity |

### Site card draw boxes

All site card interfaces (`HeroSiteCard`, `MinionSiteCard`, `FallenWizardSiteCard`, `BalrogSiteCard`) have:

| Field | Type | Purpose |
|-------|------|---------|
| `resourceDraws` | `number` | Lighter box: cards resource player may draw at step 5 |
| `hazardDraws` | `number` | Darker box: cards hazard player may draw at step 5 |

Site JSON data files need population from the authoritative card database.

## Combat (Separate Sub-State)

Combat is a top-level field on `GameState` (`combat: CombatState | null`), not nested inside phase states. It can be triggered from multiple phases and takes priority over the enclosing phase when active.

### `CombatState`

| Field | Type | Purpose |
|-------|------|---------|
| `attackSource` | `AttackSource` | What initiated the combat |
| `companyId` | `CompanyId` | The defending company |
| `strikesTotal` | `number` | Number of strikes |
| `strikeProwess` | `number` | Prowess of each strike |
| `strikeAssignments` | `readonly StrikeAssignment[]` | Per-strike assignment and resolution |
| `currentStrikeIndex` | `number` | Which strike is being resolved |
| `phase` | `'assign-strikes' \| 'resolve-strike' \| 'body-check'` | Combat sub-phase |
| `detainment` | `boolean` | Whether this attack taps instead of wounds/eliminates |

### `AttackSource` variants

| Type | Fields | Trigger |
|------|--------|---------|
| `'creature'` | `instanceId` | Hazard creature played during M/H phase |
| `'automatic-attack'` | `siteInstanceId`, `attackIndex` | Built-in site attack during Site phase |
| `'agent'` | `instanceId` | Agent hazard attacking at its site during Site phase |
| `'company-attack'` | `attackingCompanyId` | Company-vs-company combat (CvCC) |

## Actions

| Action | Phase Step | Player | Purpose |
|--------|-----------|--------|---------|
| `declare-path` | `declare-path` | Resource | Declare movement type and region path |
| `order-effects` | `order-effects` | Hazard | Submit resolution order for ongoing effects |
| `play-hazard` | `play-hazards` | Hazard | Play creature, event, or on-guard card |
| `assign-strike` | Combat | Defending | Assign a strike to a character |
| `resolve-strike` | Combat | Defending | Roll to resolve a strike |
| `support-strike` | Combat | Defending | Tap a character to support another's strike |
| `pass` | `play-hazards` | Either | Declare done with actions |
