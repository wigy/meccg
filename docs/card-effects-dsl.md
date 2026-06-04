# Card Effects DSL

Every card's effects are described declaratively in the JSON card database. A resolver engine evaluates them at each decision point by collecting all in-play effects, filtering by conditions, and computing final values.

## Condition Language

Conditions use MongoDB-style query operators. An object with multiple keys is an implicit AND.

```json
{ "bearer.race": "hobbit" }
{ "reason": "combat", "enemy.race": "orc" }
{ "$and": [{ "reason": "combat" }, { "enemy.race": "orc" }] }
{ "$or": [{ "enemy.race": "undead" }, { "enemy.race": "nazgul" }] }
{ "$not": { "enemy.race": "undead" } }
{ "bearer.skills": { "$includes": "warrior" } }
```

A missing `when` means the effect always applies.

## Keywords

Keywords are string tags on a card's `keywords` array. They drive classification and rule enforcement without dedicated boolean flags.

Character-specific keywords:

- `"Leader"`, `"Uruk-hai"`, `"Olog-hai"` — minion character subgroupings used in condition filters (e.g. faction influence bonuses gated on `"Leader"`).
- `"agent"` — the character is an agent. Agents count as both a character and a hazard for deck-building. They have home sites, can be played as a hazard face-down, and are subject to the 36-mind agent limit. No behaviour is gated on this keyword yet; it is present as a data marker for future rule enforcement (rule 1.05, 3.15, 9.x).

## Value Expressions

Plain numbers for the simple case, string expressions (evaluated with MathJS) when formulas are needed:

```json
"value": 3
"value": "bearer.baseProwess * 2"
"max": 8
"max": "bearer.baseProwess * 2"
```

MathJS gets custom context variables injected: `bearer`, `enemy`, `company`, `self` (the card), `target`, `faction`, etc.

## Effect Types

### 1. `stat-modifier`

Modifies a character stat. Supports optional `max` (cap), `id` (for override targeting), and `overrides` (replaces a named effect when condition matches).

```json
{ "type": "stat-modifier", "stat": "prowess", "value": 3, "max": 8,
  "id": "glamdring-prowess" }
{ "type": "stat-modifier", "stat": "prowess", "value": 3, "max": 9,
  "overrides": "glamdring-prowess",
  "when": { "reason": "combat", "enemy.race": "orc" } }
```

Stats: `prowess`, `body`, `direct-influence`, `corruption-points`, `strikes`, `general-influence`.

The `general-influence` stat is a player-level modifier (not per-character). When a card
carrying `stat: "general-influence"` is attached to a character, `PlayerState.generalInfluenceBonus`
is incremented by `value` during `recomputeDerived`. Effective GI pool = `GENERAL_INFLUENCE (20) +
generalInfluenceBonus`. Example: Bade to Rule (le-167) grants +5 GI to the Ringwraith
player while attached to the Ringwraith.

The `strikes` stat is used with `target: "all-attacks"` to modify the number
of strikes on creature and automatic attacks (e.g. Wake of War).

Optional `target` scopes:

- `"all-characters"` — applies to every character in play
- `"all-attacks"` — applies to every automatic-attack and hazard creature
- `"all-automatic-attacks"` — applies only to site automatic-attacks (not hazard creatures)
- *(no target)* on a hazard-creature card — self-modifier applied to the
  creature's own prowess at combat initiation. The context includes
  `company.facedRaces`, derived from `phaseState.hazardsEncountered` by
  looking up each faced hazard's race in the card pool, enabling
  conditions like Orc-lieutenant's +4 prowess. It also includes
  `defender.alignment` — the defending player's alignment in card-text
  terminology (`"hero"` for wizard-avatar players, `"ringwraith"`,
  `"fallen-wizard"`, or `"balrog"`) — so creatures like *Elf-lord
  Revealed in Wrath* can boost prowess against specific alignments
  (e.g. `{ "defender.alignment": "ringwraith" }` for "+4 vs
  Ringwraiths").

### 2. `check-modifier`

Modifies a 2d6 check roll. The `check` discriminator is one of the
{@link CheckKind} string literals — currently `corruption`, `influence`,
`riddling`, `offering`, `flattery`, `gold-ring-test` — and may be either
a single string or an array (logical OR; the modifier fires on any
listed kind). The array form is used by METD cards that read "any
riddling roll, offering attempt, or influence attempt by target
character is modified by -4" (Foolish Words, td-25).

```json
{ "type": "check-modifier", "check": "corruption", "value": 1 }
{ "type": "check-modifier", "check": "influence", "value": 1,
  "when": { "bearer.race": "dunadan" } }
{ "type": "check-modifier",
  "check": ["influence", "riddling", "offering"], "value": -4 }
```

The `influence` check type is used on faction cards for standard modifications.
The resolver context includes `bearer` (influencing character) and `faction`
(faction being influenced, with `name`, `race`, and `playableAt` — the flattened
array of site names from the faction's `playableAt` entries, enabling conditions
like `{ "faction.playableAt": "Variag Camp" }`).

For faction-influence checks the engine also collects `check-modifier` and
`stat-modifier` (`direct-influence`) effects from every ally in the
influencing character's company — e.g. The Warg-king's "+2 to any
influence attempt by a character in his company against a Wolf
faction" applies even when he is attached to a different host. Allies
are not collected for combat or other check contexts.

For corruption-check resolutions the engine also collects
`check-modifier` effects from attached **items** on the character being
checked (previously only the character's built-in `corruptionModifier`
and hazard modifiers were considered). Item modifiers see the same
context as hazard modifiers, plus `source.keywords` — the array of
keywords on the pending resolution's source card — so items can gate
their bonus on *what triggered the check*. Example (Wizard's Staff):

```json
{ "type": "check-modifier", "check": "corruption", "value": 2,
  "when": { "source.keywords": { "$includes": "spell" } } }
```

This fires only for corruption checks whose `source` card (the one that
enqueued the resolution) carries the `"spell"` keyword — e.g. the
check a Wizard makes after playing *Wizard's Laughter*.

### 2b. `attribute-modifier` active constraint

Generic conditional override of an entity attribute. Produced by an
`add-constraint` apply and consumed by read sites that route through
`engine/effective.ts::resolveEffective` (or that filter
`activeConstraints` directly). One kind in the union covers what used
to be three separate constraint kinds
(`auto-attack-prowess-boost`, `site-type-override`,
`region-type-override`); the next attribute is a one-line extension.

Fields:

- `attribute: AttributePath` — closed union: `auto-attack.prowess`,
  `site.type`, `region.type` (extend as cards require).
- `op: 'add' | 'override'` — `add` sums; `override` replaces.
- `value: number | string` — number for `add`; the encoded value
  (SiteType, RegionType, etc.) for `override`.
- `filter?: Condition` — optional per-read gate evaluated against a
  context exposing the entity under inspection
  (`{ site: { type, definitionId }, region: { name, type } }`).

The card-data JSON keeps the legacy constraint names
(`auto-attack-prowess-boost`, `site-type-override`,
`region-type-override`) — `buildConstraintKind` translates them into
`attribute-modifier` so existing card definitions did not need to
change during the migration.

### 3. `mp-modifier`

Modifies marshalling points conditionally.

```json
{ "type": "mp-modifier", "value": -3, "when": { "reason": "elimination" } }
```

### 4. `company-modifier`

Applies a stat or check modifier to every character in the company the
permanent event was played on. Use `stat` for prowess/body/direct-influence/
corruption-points modifiers, or `check` for check roll modifiers (e.g.
corruption checks).

```json
{ "type": "company-modifier", "stat": "corruption-points", "value": 1 }
{ "type": "company-modifier", "check": "corruption", "value": 1 }
```

### 5. `enemy-modifier`

Modifies the enemy's stats during combat. The resolver collects
`enemy-modifier` effects from the defending character and their items,
evaluates conditions against the combat context (including `enemy.race`),
and applies operations to the enemy's stat.

Operations:

- `halve-round-up` — divide by 2, round up.
- `subtract` — subtract `value` from the stat (minimum 0). Requires a `value` field.

```json
{ "type": "enemy-modifier", "stat": "body", "op": "halve-round-up",
  "when": { "reason": "combat", "enemy.race": "nazgul" } }
{ "type": "enemy-modifier", "stat": "body", "op": "subtract", "value": 2,
  "when": { "$or": [{ "enemy.race": "dragon" }, { "enemy.race": "drake" }] } }
```

### 6. `hand-size-modifier`

Modifies the player's hand size.

```json
{ "type": "hand-size-modifier", "value": 1,
  "when": { "self.location": "Rivendell" } }
```

### 6a. `character-stat-modifier` constraint kind

Turn-scoped stat bonus applied to a single named character instance.
Analogous to `company-stat-modifier` (which applies to every character
in a company), but targets exactly one character. Synthesised by
`collectCharacterEffects` in `engine/effects/resolver.ts` into an
equivalent `stat-modifier` effect so caps and overrides work exactly
as for item bonuses.

- `stat` — the stat to boost: `"prowess"`, `"body"`, or `"direct-influence"`.
- `value` — integer bonus (positive to increase).
- `characterId` — the instance ID of the target character.

Emitted via `on-event: self-enters-play` → `add-constraint` with
`constraint: "character-stat-modifier"` when the card is played on its
target character. The target is read from `action.targetCharacterId`.
Swept at turn-end by the existing `scope: { kind: 'turn' }` sweep.

Used by: *Vilya* (+4 prowess / +2 body / +6 direct-influence on Elrond).

```json
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "add-constraint", "constraint": "character-stat-modifier",
             "stat": "prowess", "value": 4, "scope": "turn" } }
```

### 6b. `draw-modifier`

Modifies the number of cards drawn during the movement/hazard draw step
for the bearer's company. The `draw` field selects which pool to modify
(`hazard` or `resource`), and `min` sets a floor (default 0). The
`value` may be a plain number or a {@link ValueExpr} string evaluated
against a context exposing `sitePath` counts (`wildernessCount`,
`shadowCount`, `darkCount`, `coastalCount`, `freeCount`,
`borderCount`) derived from the moving company's resolved site path —
used by Radagast for "+1 resource draw per Wilderness in the site
path".

```json
{ "type": "draw-modifier", "draw": "hazard", "value": -1, "min": 0 }
{ "type": "draw-modifier", "draw": "resource",
  "value": "sitePath.wildernessCount", "min": 0 }
```

### 7. `grant-action`

Gives the card bearer a new activated ability. For roll-based actions,
`rollThreshold` specifies the minimum 2d6 total for success.

**Phase-window flags.** By default a grant-action is emitted only in
its natural phase (organization for item-tap abilities, end-of-turn
for Saruman's spell-fetch, etc.). The following optional booleans
extend the emission window:

- `anyPhase: true` — activatable during any phase of the controller's
  turn (CRF 2.1.1). Used by Cram, Orc-draughts, and *Magical Harp*.
- `opposingSitePhase: true` — the non-active player may activate this
  ability during the active player's site phase (select-company,
  enter-or-skip, play-resources steps). Used by *Magical Harp*.
- `freeCouncil: true` — either player may activate during the Free
  Council corruption-checks step. Used by *Magical Harp*.

Multiple flags may coexist on the same effect.

Actions:

- `test-gold-ring` — tap Gandalf to test a gold ring in his company;
  rolls 2d6, discards the gold ring. Declared with a generic `targets`
  descriptor (`scope: "company-items"`, `filter: { "subtype":
  "gold-ring" }`) so the legal-action generator emits one activation
  per candidate ring. The apply is a generic `sequence` chaining
  `roll-check` and `discard-target-item` (implemented in
  `reducer-organization.ts`).
- `remove-self-on-roll` — roll 2d6, discard this card on success
  (implemented in `reducer-organization.ts`). Supported cost variants:
  `{ "tap": "bearer" }` (bearer taps, e.g. Lure of the Senses),
  `{ "tap": "self" }` (the item taps, e.g. shields / Magical Harp),
  `{ "discard": "self" }` (consumable discards, e.g. Cram) and
  `{ "tap": "sage-in-company" }` (an untapped sage in the bearer's
  company taps — one activation per eligible sage; Dragon's Curse).
- `gwaihir-special-movement` — discard this ally during organization to
  grant the company special movement to any non-Shadow-land/Dark-domain
  site. Only site-keyed hazard creatures may be played. Requires company
  size ≤ 2 (implemented in `reducer-organization.ts`,
  `organization-companies.ts`, `movement-hazard.ts`)
- `untap-bearer` — discard this item during organization to untap its
  bearer. Bearer must be tapped (implemented in `reducer-organization.ts`)
- `extra-region-movement` — discard this item during organization to
  grant the bearer's company +1 max region distance for movement this
  turn (implemented in `reducer-organization.ts`,
  `organization-companies.ts`, `reducer-movement-hazard.ts`)
- `saruman-fetch-spell` — tap Saruman at the beginning of the
  end-of-turn phase to take one spell card from the discard pile to
  hand. Only available to the resource player during the discard step.
  The spell filter is carried on the apply itself as a DSL `filter`
  condition against the candidate card definition (see
  `move-target-from-discard-to-hand` below). Implemented in
  `legal-actions/end-of-turn.ts`, `reducer-end-of-turn.ts`.
- `wizards-staff-fetch` — tap the bearer at the beginning of the
  end-of-turn phase to take one card with keyword `"spell"`,
  `"ritual"`, or `"light-enchantment"` from the discard pile to hand,
  then enqueue a corruption check on the bearer. Used by *Wizard's
  Staff*. Declared on an item with `"cost": { "tap": "bearer" }` and a
  `sequence` apply whose first step is `move-target-from-discard-to-hand`
  carrying a DSL `filter` (an `$or` over the three keywords); the
  second step is `enqueue-corruption-check`. The end-of-turn scanner
  walks both character-direct and attached-item grant-actions, offers
  one activation per discard-pile card matching the apply's filter,
  and requires an untapped bearer.
- `cancel-return-and-site-tap` — tap bearer (ranger) during
  organization to add a turn-scoped constraint cancelling hazard
  effects that force return to site of origin or tap the company's
  site. Bearer makes a corruption check (implemented in
  `reducer-organization.ts`)
- `cancel-character-discard` — tap the source item (cost
  `{ "tap": "self" }`) to add a turn-scoped
  `cancel-character-discard` constraint to the bearer's company and
  enqueue a corruption check on the bearer. The ability combines
  `anyPhase: true`, `opposingSitePhase: true`, and `freeCouncil:
  true` so the item is tappable during any of the owner's phases,
  during the opponent's site phase, and during the Free Council
  corruption-checks step. Used by *Magical Harp*. Implemented via
  the generic `sequence` + `add-constraint` + `enqueue-corruption-check`
  apply dispatch in `reducer-organization.ts`.
- `stinker-discard-with-ring` — discard the ally (Stinker) during
  organization when the bearer's company is at a non-haven site and
  some character at the same site holds *The One Ring*; the ring is
  discarded alongside the ally (regardless of which player owns it).
  Implemented via the `discard-named-card-from-company` apply (see
  below). The `when` condition reads `bearer.atHaven` and
  `site.hasOneRing` from the grant-action context (implemented in
  `legal-actions/organization.ts` context builder).
- `company-prowess-boost` — discard the source item to add a
  turn-scoped `company-stat-modifier` constraint giving `+value`
  prowess to every character in the bearer's company for the rest of
  the turn. Used by Orc-draughts (implemented in
  `reducer-organization.ts`, resolved through `collectCharacterEffects`
  in `engine/effects/resolver.ts`)

Action-less activations may also be declared directly on a character
card via `"apply"` on the grant-action effect, reusing the shared
TriggeredAction apply dispatch. The character's `"cost": { "tap": "self" }`
taps the character itself. Used by *The Mouth* to enqueue a
`fetch-to-deck` sub-flow that moves one resource or character from the
player's discard pile back to the play deck.

**Per-target activations** (`targets` field). A grant-action may carry
a `targets` descriptor that tells the legal-action generator to emit
one activation per matching card, each carrying the candidate's
`instanceId` as `targetCardId` on the resulting action. Fields:

- `scope` — zone to enumerate relative to the bearer. Supported:
  - `"company-items"` — items borne by any character in the bearer's
    company.
- `filter` — optional DSL `Condition` matched against each candidate's
  card definition; candidates that fail the filter are skipped.

Example (Gandalf's gold-ring test):

```json
{ "type": "grant-action", "action": "test-gold-ring",
  "cost": { "tap": "self" },
  "targets": { "scope": "company-items",
               "filter": { "subtype": "gold-ring" } },
  "apply": { "type": "sequence", "apps": [
    { "type": "roll-check", "check": "gold-ring-test" },
    { "type": "discard-target-item" }
  ] } }
```

```json
{ "type": "grant-action", "action": "test-gold-ring",
  "cost": { "tap": "self" },
  "when": { "company.hasItem": { "subtype": "gold-ring" } } }
{ "type": "grant-action", "action": "remove-self-on-roll",
  "cost": { "tap": "bearer" }, "rollThreshold": 8 }
{ "type": "grant-action", "action": "remove-self-on-roll",
  "cost": { "tap": "sage-in-company" },
  "apply": {
    "type": "roll-then-apply", "threshold": 7,
    "onSuccess": { "type": "discard-self" }
  } }
{ "type": "grant-action", "action": "gwaihir-special-movement",
  "cost": { "discard": "self" } }
{ "type": "grant-action", "action": "untap-bearer",
  "cost": { "discard": "self" } }
{ "type": "grant-action", "action": "extra-region-movement",
  "cost": { "discard": "self" } }
{ "type": "grant-action", "action": "saruman-fetch-spell",
  "cost": { "tap": "self" } }
{ "type": "grant-action", "action": "cancel-return-and-site-tap",
  "cost": { "tap": "bearer" } }
{ "type": "grant-action", "action": "cancel-character-discard",
  "cost": { "tap": "self" },
  "anyPhase": true, "opposingSitePhase": true, "freeCouncil": true,
  "apply": {
    "type": "sequence",
    "apps": [
      { "type": "add-constraint",
        "constraint": "cancel-character-discard",
        "scope": "turn", "target": "bearer-company" },
      { "type": "enqueue-corruption-check" }
    ] } }
{ "type": "grant-action", "action": "recall-to-deck",
  "cost": { "tap": "self" },
  "apply": {
    "type": "enqueue-pending-fetch",
    "fetchFrom": ["discard-pile"],
    "fetchCount": 1,
    "fetchShuffle": true,
    "filter": { "cardType": { "$in": [
      "minion-character", "minion-resource-item",
      "minion-resource-ally", "minion-resource-faction",
      "minion-resource-event"
    ] } }
  } }
```

### 8. `on-event`

Triggered effect that fires when a game event occurs.

```json
{ "type": "on-event", "event": "character-wounded-by-self",
  "apply": { "type": "force-check", "check": "corruption", "modifier": -2 },
  "target": "wounded-character" }
```

Events:

- `character-wounded-by-self` -- fires when a strike wounds a character, forcing a corruption check. Wounds enqueue a `corruption-check` pending resolution (see [Pending resolutions](#pending-resolutions) below) for the actor whose character was wounded; the resolution is scoped to the active company's MH or Site sub-phase, so it auto-clears at the company's sub-phase end. Implemented in `reducer-combat.ts`.
- `self-enters-play` -- fires when this card enters play. Used by environment permanent events to discard opposing cards (implemented in reducer play handlers).
- `untap-phase-end` -- fires once per applicable card during the Untap → Organization transition. The reducer (`reducer-untap.ts`) scans every character of the active player for attached cards (items / hazards / allies) carrying this on-event. An optional `when` condition is evaluated against the bearer context `{ bearer: { siteType, atHaven } }`. Supported apply types:
  - `force-check` (with `check: "corruption"`) — enqueues a `corruption-check` pending resolution per match. Used by *Lure of the Senses* (at-haven only) and *The Least of Gold Rings* (any site).
  - `discard-self` — removes the card from the bearer's items/hazards/allies and places it in the owner's discard pile. The optional `when` condition gates the discard (e.g. `"when": { "bearer.atHaven": true }` to discard at Darkhavens). Used by *Well-preserved* (as-108).
- `organization-phase-begins` -- fires during the Untap → Organization transition immediately after `untap-phase-end` processing. The reducer (`reducer-untap.ts` `advanceToOrganization`) scans **every** player's `cardsInPlay` for company-bound permanent events (cards with a `companyId`) carrying this on-event. The condition is evaluated against a company context `{ company: { atHaven: boolean } }` where `atHaven` is `true` when the bound company's current site is a haven/darkhaven. Supports `apply: { type: "move", select: "self", from: "self-location", to: "discard" }` to move the card to its owner's discard pile. Used by *Nothing to Eat or Drink* (le-128), which discards itself at the start of organization phase if the bound company is at a haven.
- `attack-not-defeated` -- fires after combat finalization when the creature's attack was not fully defeated (i.e. not all strikes were won by the defenders). The reducer (`reducer-combat.ts`) checks the creature card for this event and applies its constraint. Used by *Little Snuffler*.
- `attack-defeated` -- fires after combat finalization when **all** strikes of an attack were fully defeated (all results = `success`). Scanned from every player's `cardsInPlay` in `reducer-combat.ts` when `allDefeated` is true. The condition context exposes `enemy.race` (the normalized race of the attack, e.g. `"undead"`). Supports `apply: { "type": "discard-self" }` to move the source card from `cardsInPlay` to the owning player's discard pile. Used by *The Moon Is Dead* (dm-71) to self-discard when any Undead attack is defeated.
- `company-arrives-at-site` -- fires when a hazard short-event resolves against a company in M/H. The handler (`applyShortEventArrivalTrigger` in `chain-reducer.ts`) iterates every `add-constraint` effect on the card with this event, evaluates the optional `when` against the arrival context, and applies the first matching one. This allows a single card to declare multiple mutually-exclusive modes (e.g. *Choking Shadows*). The arrival context exposes `company.destinationSiteType`, `company.destinationSiteName`, `company.destinationRegionType`, `environment.doorsOfNightInPlay`, and the standard `inPlay` card-name list.
- `end-of-company-mh` -- fires when a company's movement/hazard sub-phase ends (both players pass). For each character with an attached hazard carrying this event, enqueues one `corruption-check` pending resolution per region traversed in the site path. The `perRegion: true` flag on the effect enables the per-region behavior. An optional `regionTypeFilter: [...]` array restricts the iteration to regions whose type appears in the list — e.g. *Lure of Nature* uses `regionTypeFilter: ["wilderness"]` to enqueue a check only for each wilderness in the path. Used by *Alone and Unadvised* and *Lure of Nature*. Implemented in `reducer-movement-hazard.ts`.
- `company-composition-changed` -- fires against every attached hazard whenever a company's character roster changes (play-character, move-to-company, merge-companies, auto-merge at end of MH). The sweeper evaluates the effect's `when` against the bearer's company context and applies `discard-self` when the condition is met. Used by *Alone and Unadvised* (discards when company has 4+ characters). Implemented in `reducer-utils.ts` `sweepAutoDiscardHazards()`.
- `bearer-company-moves` -- fires when the company containing the bearer completes movement (M/H step 8). For each character in the moving company, the reducer scans attached items for this event and applies the `discard-self` action, moving the card to the owner's discard pile. Used by *Align Palantír*. Implemented in `reducer-movement-hazard.ts`.
- `creature-attack-begins` -- fires when a hazard creature attack is locked onto a defending company, after the creature's combat state has been initialized but before any strike is assigned. The attack was not canceled by the time this event fires (canceling an attack prevents `initiateCreatureCombat` from running entirely). Handled in `chain-reducer.ts` `initiateCreatureCombat()`. Supported apply types:
  - `offer-char-join-attack` — scoped to characters in the defending player's *other* companies that are at a haven; the `when` condition is evaluated against `{ bearer: { atHaven: true, siteType: 'haven' }, attack: { attackedCompanyId, bearerCompanyId } }`. Used by *Alatar* (tw-117).
  - `force-check-all-company` — enqueues a corruption check for every character in the attacked company before defenders are selected. Uses `check` (must be `"corruption"`) and optional `modifier`. Used by *Corpse-candle* (tw-23, le-67).
- `character-body-check-equals-body` -- fires during the body check roll inside `handleBodyCheckRoll` in `reducer-combat.ts` when the effective roll result **exactly equals** (not exceeds) the defending character's body value. The `when` condition is evaluated against `{ target: { race } }` where `race` is the character's race string. Supports `apply: { "type": "discard-character" }`, which removes the character from their company and places them in the defending player's discard pile (rather than the out-of-play pile). Items and allies on the character are discarded immediately (no salvage phase). Does not fire for ally combatants. The `when` condition should exclude Wizard and Ringwraith characters per the card text. Used by *Giant Spiders* (tw-40).

  ```json
  { "type": "on-event", "event": "character-body-check-equals-body",
    "apply": { "type": "discard-character" },
    "when": { "$not": { "target.race": { "$in": ["wizard", "ringwraith"] } } } }
  ```

- `bearer-wounded` -- fires after combat finalization for each ally whose bearer (controlling character) was wounded (result `'wounded'`, not tapped under detainment rules; detainment strikes tap, not wound). Scans every wounded character's attached allies for this event. Supports `apply: { "type": "discard-self" }`, which removes the ally from the bearer and places it in the defending player's discard pile. Implemented in `reducer-combat.ts` combat finalization. Used by *Regiment of Black Crows* (as-76) and *Great Bats* (as-74).

  ```json
  { "type": "on-event", "event": "bearer-wounded",
    "apply": { "type": "discard-self" } }
  ```

- `company-member-wounded` -- fires after combat finalization when any character in the defending company was wounded (result `'wounded'`, not tapped under detainment rules). Scans every character in the defending company for attached hazard events carrying this on-event; for each match, enqueues one `corruption-check` pending resolution on the **bearer** (the character bearing the hazard, not the wounded character). Supports `apply: { type: "force-check", check: "corruption" }`. Used by *Despair of the Heart* (tw-27). Implemented in `reducer-combat.ts` combat finalization.
- `character-gains-item` -- fires immediately after any character in the bearer's company gains an item during the site phase (via `play-hero-resource`). For each character bearing a hazard with this event, enqueues one `corruption-check` pending resolution for that character (the bearer, not the character who gained the item). Supports `apply: { type: "force-check", check: "corruption" }`. Used by *Lure of Expedience* (le-122). Implemented in `reducer-site.ts` `fireCharacterGainsItemChecks()`.
- `end-of-turn` -- fires when the active player's site phase ends and the game transitions into the End-of-Turn phase (both when all companies have been handled and when the player passes with no active step). The reducer (`reducer-site.ts`) scans every character of the active player for attached hazards carrying this on-event. Supports `apply: { type: "force-check-per-others-item", check: "corruption" }`, which enqueues one `corruption-check` pending resolution per item in the bearer's company that the bearer does not bear; the modifier for each check is the negative corruption-point value of that item (`-item.corruptionPoints`). Used by *Covetous Thoughts* (le-107). Implemented in `reducer-site.ts` `fireEndOfTurnCorruptionChecks()`.
- `site-phase-company-begins` -- fires when a company is selected at the start of the site phase (`select-company` → `enter-or-skip` transition). The reducer (`reducer-site.ts` `fireSitePhaseCompanyBeginsEvents`) scans **all** players' `cardsInPlay` for **global** permanent events (no `companyId`) carrying this on-event. The condition is evaluated against a context including `company.siteRegionType` (the `RegionType` string of the region the company's current site is in, e.g. `"dark"` or `"shadow"`) and the standard `inPlay` card-name list. Currently supports `apply: { type: "tap-one-character" }`, which enqueues a `tap-one-character` pending resolution for the resource player: the player must tap one untapped character in the company, or pass if none are untapped. Used by *Stench of Mordor* (le-141).

  ```json
  { "type": "on-event", "event": "site-phase-company-begins",
    "apply": { "type": "tap-one-character" },
    "when": { "$or": [
      { "company.siteRegionType": "dark" },
      { "$and": [
          { "company.siteRegionType": "shadow" },
          { "inPlay": "Doors of Night" }
        ] }
    ] } }
  ```

- `cvc-combat-pre-strike` -- fires on items attached to attacking-company characters when a company-versus-company attack is declared (`declare-company-attack`), before strikes are assigned. The reducer (`reducer-site.ts` `fireCvccPreStrikeEffects()`) scans attacking characters' items for this event, evaluates the `when` condition against `{ bearer: { race, skills } }`, and for each qualifying item collects every non-unique `minion-resource-ally` in the defending company. For each such ally, one `cvcc-ally-discard-roll` pending resolution is enqueued on the attacking player. Supports `apply: { type: "roll-discard-opponent-non-unique-ally", threshold: N }`. Used by *Bow of the Galadhrim* (as-68).

  ```json
  { "type": "on-event", "event": "cvc-combat-pre-strike",
    "when": { "$and": [{ "bearer.race": "elf" }, { "bearer.skills": { "$includes": "warrior" } }] },
    "apply": { "type": "roll-discard-opponent-non-unique-ally", "threshold": 5 } }
  ```

Apply types:

- `tap-one-character` -- under `on-event: site-phase-company-begins`, enqueue a `tap-one-character` pending resolution for the resource player. The player selects one untapped character in the company to tap (via a `tap-character-by-effect` action), or passes if no untapped characters are available. Implemented in `reducer-site.ts` `fireSitePhaseCompanyBeginsEvents()`, `legal-actions/pending.ts` `tapOneCharacterActions()`, and `pending-reducers.ts` `applyTapOneCharacterResolution()`. Used by *Stench of Mordor* (le-141).
- `roll-discard-opponent-non-unique-ally` -- under `on-event: cvc-combat-pre-strike`, enqueue one `cvcc-ally-discard-roll` pending resolution per non-unique minion ally in the opposing company. The `threshold` field is an integer added to the ally's `mind` value to form the discard threshold; the attacking player rolls 2d6 and the ally is discarded if the roll **strictly exceeds** `mind + threshold`. Used by *Bow of the Galadhrim* (as-68, threshold 5). Implemented in `reducer-site.ts` `fireCvccPreStrikeEffects()` and `pending-reducers.ts` `applyCvccAllyDiscardRollResolution()`.
- `force-check` -- force a check roll on the target. The dispatcher enqueues a {@link PendingResolution} of kind `corruption-check`; the resolver in `engine/pending-reducers.ts` runs the dice roll and applies the standard discard / eliminate consequences when the check fails.
- `force-check-per-others-item` -- under `on-event: end-of-turn`, enqueue one corruption check per item in the bearer's company that the bearer does not bear. The modifier for each check equals the negative corruption-point value of that item. Used by *Covetous Thoughts* (le-107). Implemented in `reducer-site.ts` `fireEndOfTurnCorruptionChecks()`.
- `force-check-all-company` -- under `on-event: creature-attack-begins`, enqueue a corruption check for **every** character in the attacked company before defenders are selected. Uses `check: "corruption"` and optional `modifier`. Implemented in `chain-reducer.ts` `initiateCreatureCombat()`. Used by *Corpse-candle* (tw-23, le-67).
- `discard-cards-in-play` -- discard all cards in play that match the `filter` condition (evaluated against card definitions).
- `discard-non-special-items` -- discard all non-special items (subtype ≠ `"special"`) from the wounded character. Items are moved to the defending player's discard pile. Implemented in `reducer-combat.ts` for the `character-wounded-by-self` event.
- `discard-character` -- discard the affected character to the defending player's discard pile (not the out-of-play pile). The character is removed from their company; all their items and allies are also discarded immediately. No item-salvage phase is offered. Condition context exposes `{ target: { race } }` (evaluated per character). Supported under two events:
  - `on-event: character-body-check-equals-body` — fires when the body check result **exactly equals** the character's body. Implemented in `reducer-combat.ts` `handleBodyCheckRoll()`. Used by *Giant Spiders* (tw-40).
  - `on-event: character-wounded-by-self` — fires after combat finalization for each wounded character. The condition is evaluated per wounded character; any that pass are discarded. Implemented in `reducer-combat.ts` `discardWoundedCharacters()`. Used by *Abductor* (tw-1).
- `add-constraint` -- add an {@link ActiveConstraint} of the named kind to the target. Reserves the entry's `constraint` field for the kind name (e.g. `"site-phase-do-nothing"`, `"no-creature-hazards-on-company"`, `"deny-scout-resources"`, `"auto-attack-prowess-boost"`, `"auto-attack-duplicate"`, `"site-type-override"`, `"region-type-override"`, `"skip-automatic-attacks"`, `"cancel-character-discard"`, `"hazard-draw-multiplier"`, `"haven-return-option"`) and the `scope` field for the auto-clear boundary (e.g. `"company-site-phase"`, `"company-mh-phase"`, `"turn"`, `"until-cleared"`). Constraint-kind-specific fields include `value` + `siteType` for `auto-attack-prowess-boost`, `overrideType` for `site-type-override` (the site is the active company's current site during site phase, or the destination during M/H phase), and `overrideType` + `regionName` for `region-type-override` (use the token `"destination"` as the region name to target the destination region of the active company). The `skip-automatic-attacks` constraint removes all automatic attacks from the bound site (resolved from the active company's current site during site phase). The `cancel-character-discard` constraint is placed by *Magical Harp* on the bearer's company; any future character-discard effect should consult this constraint to short-circuit the discard for the rest of the turn. The `hazard-draw-multiplier` constraint (scope `"company-mh-phase"`) multiplies the hazard draw count during the target company's M/H draw step by the `value` field (e.g. `2` to double opponent draws, as used by *Great-road*). The `haven-return-option` constraint (scope `"turn"`) records the company's origin haven at play time and enables a `haven-return` action during end-of-turn discard and signal-end steps, allowing the company to teleport back to the recorded haven without a new M/H phase (used by *Great-road*). The constraint filter in `legal-actions/pending.ts` rewrites legal actions for the affected target while the constraint lives.
- `discard-self` -- discard the card carrying this effect (typically an ally or attached hazard) from its bearer to the owning player's discard pile. Used with `company-arrives-at-site` + a `when` condition on `site.region` to enforce region-based restrictions (e.g. Treebeard), with `company-composition-changed` + a `when` condition on `company.characterCount` to discard on company size (e.g. Alone and Unadvised), and with `untap-phase-end` + `when: { "bearer.atHaven": true }` to discard at the Untap→Organization transition when at a haven (e.g. Well-preserved). Implemented in `reducer-movement-hazard.ts` `fireAllyArrivalEffects()`, `reducer-utils.ts` `sweepAutoDiscardHazards()`, and `reducer-untap.ts` `advanceToOrganization()`.
- `discard-named-card-from-company` -- find an item attached to any
  character in any company at the bearer's current site (matched by
  site definition ID, so opposing companies co-located at the same
  site are included) whose card definition has the given `cardName`,
  and move it to that player's discard pile. Currently used by
  Stinker's ring-discard grant-action to discard *The One Ring* —
  potentially belonging to the opposing player — when the ally is
  discarded. Implemented in `reducer-organization.ts` `runGrantApply()`.
- `enqueue-corruption-check` -- under `on-event: self-enters-play`, enqueue
  a corruption check. The optional `modifier` integer is added to the check's
  roll threshold.

  **Short events**: targets the character in `action.targetCharacterId`.
  When the same `self-enters-play` handler also enqueues a `move`-based fetch
  sub-flow (a `fetch-to-deck` pending effect), the corruption check is deferred
  until **after** all fetch picks are complete (or the player passes) — the
  reducer embeds it as `postCorruptionCheck` on the pending effect rather than
  pushing it into `pendingResolutions` immediately, so the two resolution queues
  do not conflict. Used by *Vilya* (`modifier: -3` on Elrond). Implemented in
  `reducer-events.ts` (`applyShortEventOnEntersPlay`) and `reducer-utils.ts`
  (`handleFetchFromPile`, `resolvePendingEffect`).

  **Permanent events** (character-attached): targets `action.targetCharacterId`
  by default. When `apply.target === "company-shadow-magic-user"`, the reducer
  finds the first non-Ringwraith character in the bearer's company with the
  `"shadow-magic"` skill and targets them instead; Ringwraith characters are
  silently skipped (no corruption check enqueued). Used by *Well-preserved*
  (as-108). Implemented in `chain-reducer.ts` `resolvePermanentEvent()`.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "enqueue-corruption-check", "modifier": -3 } }
  ```

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "enqueue-corruption-check", "modifier": -3,
               "target": "company-shadow-magic-user" } }
  ```

- `heal-target-character` -- under `on-event: self-enters-play` on a
  character-attached permanent event, changes the target character's status
  from `Inverted` (wounded) to `Tapped`. Has no effect if the character is
  not wounded. Used by *Well-preserved* (as-108). Implemented in
  `chain-reducer.ts` `resolvePermanentEvent()`.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "heal-target-character" } }
  ```

- `cancel-chain-entry` -- negate an unresolved chain entry or discard a
  card in play / remove active constraints sourced from a given card.
  Selectors:
  - `most-recent-unresolved-hazard` -- negate the latest unresolved
    hazard (creature or event) on the chain. Used by *Great Ship* via
    a granted action.
  - `target` -- negate the chain entry (or, if the target is no longer
    on the chain, discard the in-play card or remove active constraints
    whose `source` equals the target instance). The emitter filters
    valid targets using a `requiredSkill` field on the apply: only
    chain entries / active constraints whose source card has at least
    one effect carrying a matching `requiredSkill` (either directly on
    the effect — e.g. `cancel-attack.requiredSkill` on Concealment —
    or as the `requiredSkill` metadata tag on a `play-target` effect —
    e.g. Stealth) are offered. Used by *Searching Eye* with
    `requiredSkill: "scout"`.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "cancel-chain-entry",
               "select": "target",
               "requiredSkill": "scout" } }
  ```

- `offer-char-join-attack` -- under `on-event: creature-attack-begins`,
  raises a pending "may join the attacked company" offer for the
  bearer. The defender sees a `haven-join-attack` legal action during
  the assign-strikes cancel-window; accepting moves the bearer into
  the attacked company for this combat and (optionally) discards
  attached allies, forces a strike onto the bearer, and schedules
  post-attack side-effects. After combat finalizes the bearer is
  restored to their origin company. Composable flags:
  - `discardOwnedAllies` (boolean) -- discard allies attached to the
    bearer when they join.
  - `forceStrike` (boolean) -- at least one strike from the attacking
    creature must be assigned to the bearer before any other
    defender-side assignment is legal.
  - `postAttack` (object) -- effects applied at combat finalization
    regardless of outcome. Supports `tapIfUntapped` (boolean) and
    `corruptionCheck` (object with optional `modifier`).

  Implemented in `chain-reducer.ts`
  (`collectHavenJumpOffers()`), `legal-actions/combat.ts`
  (`havenJoinAttackActions()`), `reducer-combat.ts`
  (`handleHavenJoinAttack`, `applyPostAttackEffects`,
  `restoreHavenJumpOrigins`). Used by *Alatar* (tw-117).

- `offer-resource-play` -- under `on-event: self-enters-play`, enqueue
  a `resource-play-offer` pending resolution for the active player.
  The player may pair any resource card from their hand with the
  in-play source card (Crown of Flowers), or pass. When paired, the
  chosen resource is moved from hand directly into `cardsInPlay` with
  three extra fields: `linkedInstanceId` (pointing to the source card),
  `assumeInPlay: ['Gates of Morning']`, and `assumeNotInPlay: ['Doors of Night']`.
  The source card's `cardsInPlay` entry is also updated with `linkedInstanceId`
  pointing back to the paired resource. Both links enable a cascade discard:
  when either linked card leaves `cardsInPlay`, the other is discarded too.
  The `collectGlobalEffects` function in `resolver.ts` reads `assumeInPlay`
  and `assumeNotInPlay` per card and adjusts the `inPlay` names list used
  by `matchesCondition` so GoM-conditional effects on the paired resource
  activate even without a real Gates of Morning on the table.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "offer-resource-play" } }
  ```

  Implemented in `chain-reducer.ts` (`resolvePermanentEvent`),
  `legal-actions/pending.ts` (`resourcePlayOfferActions`),
  `pending-reducers.ts` (`applyResourcePlayOfferResolution`),
  `engine/effects/resolver.ts` (`collectGlobalEffects` — per-card inPlay
  override), and `chain-reducer.ts` (`cascadeLinkedDiscards`).
  Used by *Crown of Flowers* (dm-121).

- `unlock-hoard-bounty` -- under `on-event: self-enters-play`, sets
  `SitePhaseState.hoardBountyAvailable = true`, allowing one additional minor
  or major item to be played at the current tapped hoard site (a site with the
  `hoard` keyword). Only fires during the site phase. The flag is cleared after
  the qualifying item is played. Implemented in `reducer-events.ts`
  (`applyShortEventOnEntersPlay`) and `reducer-site.ts`
  (`handleSitePlayHeroResource`). Used by *Bounty of the Hoard* (td-101).

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "unlock-hoard-bounty" } }
  ```

- `unlock-thorough-search` -- under `on-event: self-enters-play`, sets
  `SitePhaseState.thoroughSearchAvailable = true`, allowing one additional
  minor, major, or gold ring item to be played without tapping the site.
  Unlike `unlock-hoard-bounty`, this bonus applies at any site (tapped or
  untapped); the item must still be normally playable at the site's playable
  resource types. Only fires during the site phase. The flag is cleared after
  the qualifying item is played. Playing via this bonus does not count as the
  "first resource" (no opening minor-item bonus is triggered) and does not tap
  the site. Implemented in `reducer-events.ts` (`applyShortEventOnEntersPlay`)
  and `reducer-site.ts` (`handleSitePlayHeroResource`). Used by
  *Thorough Search* (tw-349).

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "unlock-thorough-search" } }
  ```

### Pending resolutions

The engine carries two top-level lists alongside `phaseState`:

- **`pendingResolutions`** -- discrete pieces of work the engine has queued for a player to resolve before continuing (corruption checks, on-guard reveal windows, opponent-influence defensive rolls, etc.). The first entry whose `actor` matches the player computing legal actions collapses the menu to "resolve the top entry." Drains FIFO per actor; auto-swept at the matching scope boundary.
- **`activeConstraints`** -- scoped restrictions on the legal-action menu of some target (company / character / player). Filters but never blocks. Cross-player constraints are supported (e.g. *Stealth* — placed by the resource player, filtering the hazard player's plays).

Both lists are owned by `engine/pending.ts`; reducers and on-event handlers must go through the helpers (`enqueueResolution`, `addConstraint`, `sweepExpired`, etc.) rather than touching the lists directly.

### 9. `cancel-attack`

Cancels an entire attack against a company. Only playable during combat
before strikes are assigned. The source is normally a short event card
played from hand (and discarded), but the same effect type also covers
in-play "tap to cancel" abilities on allies.

When `cost` and `requiredSkill` are present, requires tapping a character
with the named skill (e.g. Concealment — tap a scout). When `cost` and
`requiredRace` are present, requires a character of that race in the
company — one action is generated per qualifying character. If the cost
is a corruption check (`"check": "corruption"`), the character need not
be untapped (e.g. Vanishment — wizard makes corruption check -2). When
both `requiredSkill` and `requiredRace` are absent, the card is simply
played with no additional cost (e.g. Dark Quarrels — cancel one attack
by Orcs, Trolls, or Men).

When the effect is declared on an in-play ally with
`cost: { "tap": "self" }`, the engine sources the ability from any
untapped ally with this effect attached to a character in the defending
company (e.g. The Warg-king's "tap to cancel a Wolf or Animal attack").
Activating taps the ally and cancels the attack immediately — no chain
entry is created.

When the effect is declared on an in-play **item** with
`cost: { "tap": "self-and-bearer" }`, both the item AND its bearer must
be untapped. Activating taps both the item and the bearer, then cancels
the attack immediately (no chain entry). If `"enqueueCorruptionCheck": true`
is also set on the effect, a corruption check is enqueued on the bearer
after cancellation. Used by *Torque of Hues* (tw-351).

When the item has `cost: { "tap": "bearer" }`, only the bearer must be
untapped; the item itself does not tap. Used by *Star-glass* (tw-330) —
bearer taps to cancel an Undead attack. `"enqueueCorruptionCheck": true`
enqueues a corruption check on the bearer.

A `when` condition filters which attacks qualify, evaluated against a
combat context that includes:

- `enemy.race` — the attacking creature's lowercase race (e.g. `"orc"`).
- `attack.keying` — array of region types the creature is keyed to
  (e.g. `["wilderness", "shadow"]`); only populated for creature hazards.
- `attack.source` — discriminates where the attack originated:
  `"creature"` (a hazard creature played during the movement/hazard
  phase — "not played at a site"), `"on-guard-creature"` (a creature
  placed on-guard at a site and revealed during the site phase), or
  `"automatic-attack"` (the site's own listed attack).
- `bearer.companySize` — the number of characters in the defending
  company (host company of an in-play ally or character source).
- `bearer.atHaven` — `true` when the defending company's current site
  is a haven. Used by Darkhaven-tap abilities (e.g. Adûnaphel the
  Ringwraith).

The effect may be declared on in-play sources too: an ally attached
to a company character (e.g. The Warg-king), the character card
itself (e.g. Adûnaphel the Ringwraith), or an item with
`cost: { "tap": "self-and-bearer" }` (e.g. Torque of Hues).

```json
{ "type": "cancel-attack",
  "cost": { "tap": "character" },
  "requiredSkill": "scout" }
{ "type": "cancel-attack",
  "requiredRace": "wizard",
  "cost": { "check": "corruption", "modifier": -2 } }
{ "type": "cancel-attack",
  "when": { "enemy.race": { "$in": ["orc", "troll", "men", "man"] } } }
{ "type": "cancel-attack",
  "cost": { "tap": "self" },
  "when": { "enemy.race": { "$in": ["wolf", "wolves", "animal", "animals"] } } }
{ "type": "cancel-attack",
  "cost": { "tap": "self" },
  "when": { "$and": [
    { "bearer.companySize": { "$lt": 3 } },
    { "$or": [
      { "attack.keying": "wilderness" },
      { "attack.keying": "shadow" } ] } ] } }
{ "type": "cancel-attack",
  "cost": { "tap": "self" },
  "when": { "$and": [
    { "bearer.atHaven": true },
    { "attack.source": "creature" } ] } }
{ "type": "cancel-attack",
  "cost": { "tap": "self-and-bearer" },
  "enqueueCorruptionCheck": true }
```

### 9a. `wound-target-character`

Wounds the character targeted by a {@link PlayTargetEffect} on the same card
without a body check. Applied after the attack is cancelled when the chain entry
resolves. The targeted character's status is set to `inverted` (wounded). Used
with `cancel-attack` + `play-target` on cards whose text reads "playable on an
unwounded character facing an attack — the attack is cancelled and the character
is wounded (no body check required)".

The legal-action emitter generates one `cancel-attack` action per unwounded
character in the defending company (characters with `status !== inverted`).
The chosen character's instance ID is carried on the action as
`targetCharacterId` and preserved in the chain entry payload.

```json
{ "type": "wound-target-character" }
```

Example: Escape (tw-229) — cancel an attack against an unwounded character;
the character is wounded as the cost.

### 9b. `cancel-influence`

Automatically cancels an opponent's influence check against one of the
player's characters, followers, factions, allies, or items. Played from
hand during the opponent's site phase while an `opponent-influence-defend`
resolution is pending. The card is discarded after use.

When `requiredRace` is present, requires a character of that race under
the player's control. When `requiredSkill` is present, requires a
character who has that skill (either innate or from an item). Both fields
may coexist — when both are set, the character must match both. The `cost`
is typically a corruption check with a modifier that the cost-paying
character must make after the cancellation.

The optional `targetKindFilter` array restricts which target kinds the
card may cancel. When present, the cancel-influence action is only
available when the pending `opponent-influence-defend` resolution's
`targetKind` appears in the list (`"character"`, `"ally"`, or
`"faction"`). When absent, all target kinds are valid. A card may declare
multiple `cancel-influence` effects (e.g. one for a privileged role with
no cost and broader scope, one for a secondary role with a cost and
narrower scope).

```json
{ "type": "cancel-influence",
  "requiredRace": "wizard",
  "cost": { "check": "corruption", "modifier": -2 } }
{ "type": "cancel-influence",
  "requiredRace": "ringwraith" }
{ "type": "cancel-influence",
  "requiredSkill": "shadow-magic",
  "targetKindFilter": ["character", "ally"],
  "cost": { "check": "corruption", "modifier": -3 } }
```

Example: Poisonous Despair (le-219) — Ringwraith cancels any influence
attempt (character, ally, or faction) for free; a non-Ringwraith character
with the `shadow-magic` skill can cancel character/ally attempts at the
cost of a corruption check modified by -3.

### 9b. `halve-strikes`

Halves the number of strikes in the current attack (rounded up). Played
from hand as a short event during combat before strikes are assigned;
the card is discarded after use.

A `when` condition gates availability (e.g. requires a specific card
in play).

Optional fields control the operation mode:

- `op` — `"halve"` (default) or `"subtract"`. When `"subtract"`, reduces
  strikes by a fixed `value` instead of halving.
- `value` — Amount to subtract when `op` is `"subtract"`. Default: `2`.
- `min` — Minimum strikes after modification. Default: `1`.

```json
{ "type": "halve-strikes",
  "when": { "inPlay": "Gates of Morning" } }
```

Subtract variant (e.g. Not at Home — reduces by 2, minimum 1):

```json
{ "type": "halve-strikes",
  "op": "subtract",
  "value": 2,
  "min": 1,
  "when": { "inPlay": "Gates of Morning", "attack.source": "automatic-attack" } }
```

### 10. `strike-modifier`

Played from hand during strike resolution as a short event. Covers three
resolution modes driven by flags on the effect:

**Dodge mode** (`"dodge": true`): the target character resolves the strike
at full prowess without tapping (unless wounded). If wounded, `bodyPenalty`
applies to the resulting body check. The play goes through the chain so the
opponent may respond.

```json
{ "type": "strike-modifier", "dodge": true, "bodyPenalty": -1 }
```

**Reroll mode** (`"reroll": true`): two 2d6 rolls are made and the better
total is used; the character taps normally (tap-to-fight). An optional
`filter` gates availability on the strike target character, evaluated
against a `target.*` context carrying the target's race, skills, and name.

```json
{ "type": "strike-modifier", "reroll": true,
  "filter": { "target.skills": { "$includes": "warrior" } } }
```

**Default (modifier) mode**: accumulates `prowessBonus` and `bodyPenalty`
on the current strike immediately. Optionally gated by a `requiredSkill` on
the struck character (enforces CoE 3.iv.5: only one skill-requiring resource
per strike).

```json
{ "type": "strike-modifier",
  "prowessBonus": 3,
  "bodyPenalty": -1,
  "requiredSkill": "warrior" }
```

**Fields:**

- `dodge` — if `true`, character resolves without tapping (dodge mode).
- `reroll` — if `true`, roll twice and use the better result (reroll mode).
- `prowessBonus` — added to the character's prowess for the strike roll
  (may be negative; used in default and dodge modes). Omit for 0.
- `bodyPenalty` — added to the character's body on the resulting body
  check if wounded (typically negative). Omit for 0.
- `requiredSkill` — the struck character must carry this skill. Omit to
  allow any character (default mode only).
- `filter` — condition on the strike target character (reroll mode only).

All modes emit a `play-strike-event` action during resolve-strike and
discard the card from hand after use. Implemented in
`engine/legal-actions/combat.ts` (availability scan) and
`engine/reducer-combat.ts` (`resolveChainStrikeModifier`).

### 10c. `modify-attack`

Activated ability on an in-play item that modifies the whole attack (not a
single strike). Available to the defending player during the
pre-assignment window of combat (same window as `cancel-attack`). Tapping
the item adds `prowessModifier` to the creature's strike prowess and
`bodyModifier` to its body value, so every strike in the attack and the
creature body check are affected uniformly.

The `cost` is either `{ "tap": "self" }` (the item taps, e.g. Black Arrow)
or `{ "tap": "bearer" }` (the bearer taps, item stays untapped, e.g.
Star-glass). The `when` clause gates availability. An optional
`discardIfBearerNot` lists the races whose bearers may tap a `"self"`-cost
item safely; when the bearer's race is not in the list the item is discarded
instead of tapped (the modifier still applies). `"enqueueCorruptionCheck":
true` enqueues a corruption check on the bearer after the modification (used
by `"bearer"`-cost items like Star-glass).

```json
{ "type": "modify-attack",
  "cost": { "tap": "self" },
  "prowessModifier": -1,
  "bodyModifier": -1,
  "when": { "bearer.skills": { "$includes": "warrior" } },
  "discardIfBearerNot": { "race": ["man", "dunadan"] } }
{ "type": "modify-attack",
  "cost": { "tap": "self" },
  "strikesModifier": -1,
  "when": { "$and": [
    { "bearer.skills": { "$includes": "warrior" } },
    { "attack.source": "creature" }
  ] } }
{ "type": "modify-attack",
  "cost": { "tap": "bearer" },
  "prowessModifier": -2,
  "when": { "enemy.race": { "$in": ["spiders", "animals", "wolves"] } },
  "enqueueCorruptionCheck": true }
```

Example: Black Arrow (tw-494) — Warrior only, tap to give -1 prowess and
-1 body to one attack against the bearer's company; discard the arrow if
the bearer is not a Man.

Example: Bow of Dragon-horn (td-102) — Warrior only, tap to reduce the
strike count of one hazard creature attack (not keyed to a site) by 1,
minimum 1. Uses `strikesModifier: -1`; result clamped to minimum 1.

Example: Star-glass (tw-330) — tap bearer to give -2 prowess to a Spiders,
Animals, or Wolves attack; bearer makes a corruption check.

- `strikesModifier` — amount added to `strikesTotal` (usually negative);
  clamped so result is never below 1.

Implemented in `engine/legal-actions/combat.ts` (`modifyAttackActions`)
and `engine/reducer-combat.ts` (`handleModifyAttack`).

### 10d. `item-tap-strike-bonus`

Activated ability on an in-play item that boosts the bearer's prowess for
the single strike currently being resolved. Unlike `modify-attack` (which
adjusts the creature's prowess for the whole attack, benefiting all
defenders), this effect targets only the bearer's specific strike assignment
and adds directly to `StrikeAssignment.strikeProwessBonus`. Available
during `resolve-strike` when the item is untapped and the bearer is the
current strike target.

The `cost` must be `{ "tap": "self" }`. An optional `when` gate is
evaluated against a context exposing `bearer.race`, `bearer.skills`,
`bearer.name`, and `enemy.race`.

```json
{ "type": "item-tap-strike-bonus",
  "cost": { "tap": "self" },
  "prowessBonus": 1 }
```

Example: Shield of Iron-bound Ash (tw-327) — tap to gain +1 prowess
against one strike.

Implemented in `engine/legal-actions/combat.ts` (`tapItemForStrikeActions`)
and `engine/reducer-combat.ts` (`handleTapItemForStrike`).

### 10e. `modify-attack` — played from hand (`fromHand: true`)

When `fromHand: true` is set on a `modify-attack` effect, the card is
played from hand as a short event during combat before strikes are
assigned; the card is discarded after use. Modifies the current attack's
strike prowess and/or creature body uniformly — same math as an in-play
item `modify-attack`, but the source is a hand card.

The `player` field (required when `fromHand` is set) selects which side
plays the effect:

- `"attacker"` — the hazard player plays during their attack's
  pre-assignment window (e.g. Dragon's Desolation Mode A).
- `"defender"` — the resource player plays during the same window.

The `when` clause is evaluated against the standard combat context
(`enemy.race`, `attack.source`, `attack.keying`, `inPlay`).

```json
{ "type": "modify-attack", "fromHand": true,
  "player": "attacker",
  "prowessModifier": 2,
  "when": { "enemy.race": "dragon" } }
```

Example: Dragon's Desolation (tw-29) Mode A — hazard short event; +2
strike prowess to one Dragon attack. Per CRF the card is playable even
against automatic-attacks and does not count against the hazard limit
(use `play-flag: no-hazard-limit`).

Implemented in `engine/legal-actions/combat.ts` (`modifyAttackActions`)
and `engine/reducer-combat.ts` (`handleModifyAttack`).

### 11. `cancel-strike`

Pay a cost to cancel an incoming strike, with optional exclusions.

When `target` is absent or `"self"`, the bearer cancels their own strike
(e.g. The One Ring). When `target` is `"other-in-company"`, the character
taps to cancel a strike against another character in the same company
(e.g. Fatty Bolger). A `filter` condition selects which characters
qualify as valid protection targets.

The effect may be declared on an item attached to a character with
`cost: { "tap": "self" }`. Tapping the item cancels a strike against
its bearer; the `when` clause is evaluated against a context exposing
`bearer.skills`, `bearer.race`, `bearer.name`, and `enemy.race`, so
cards can gate the ability on the bearer's skill or race (e.g. Enruned
Shield — Warrior only). The item must be untapped when activated.

```json
{ "type": "cancel-strike",
  "cost": { "check": "corruption", "modifier": -2 },
  "when": { "$not": { "$or": [
    { "enemy.race": "undead" }, { "enemy.race": "nazgul" }
  ] } } }
{ "type": "cancel-strike",
  "cost": { "tap": "self" },
  "target": "other-in-company",
  "filter": { "target.race": "hobbit" } }
{ "type": "cancel-strike",
  "cost": { "tap": "self" },
  "when": { "bearer.skills": { "$includes": "warrior" } } }
```

### 12. Combat-rule effects

Each combat-mechanics override is a distinct effect type. The chain
reducer dispatches on the effect's `type`, so adding a new override is a
one-line union extension plus the matching branch — no opaque rule
strings to chase through the engine.

- `combat-attacker-chooses-defenders` — the attacking player assigns
  strikes instead of the defender (implemented in `chain-reducer.ts`)
- `combat-multi-attack` — the creature makes multiple separate attacks,
  all against the same target character. The `count` field specifies how
  many attacks. Total strikes = count × effective strikes per attack.
  All strikes are auto-assigned to the attacker's chosen target.
  (implemented in `chain-reducer.ts`, `reducer-combat.ts`)
- `combat-cancel-attack-by-tap` — the defending player may tap non-target
  characters in the company to cancel attacks. The `maxCancels` field
  specifies the maximum number of attacks that can be canceled this way.
  (implemented in `reducer-combat.ts`, `legal-actions/combat.ts`)
- `combat-one-strike-per-character` — the creature makes one strike per
  character in the defending company (`strikesTotal =
  company.characters.length`), overriding the card's raw `strikes` value.
  Card text is "Each character in the company faces one strike". Mutually
  exclusive with `combat-multi-attack`. Optional `excludeAvatars: true`
  excludes avatar characters (Wizards and Ringwraiths, `mind === null`)
  from the strike count and assignment: `strikesTotal = non-avatar
  characters`. Card text is "Each non-Wizard/non-Ringwraith character in
  the company faces one strike" (e.g. Neeker-breekers). (implemented in
  `chain-reducer.ts`, `legal-actions/combat.ts`)
- `combat-defender-prowess-from-mind` — each defending character's prowess
  for this attack is replaced by their mind attribute value. Status modifiers
  (tapped −1, wounded −2) and support bonuses still apply on top of the
  mind base. Card text is "His prowess against such a strike is equal to
  his mind attribute" (e.g. Neeker-breekers). (implemented in
  `reducer-combat.ts`)
- `combat-detainment` — marks the attack as detainment (CoE §3.II).
  Detainment strikes tap the character instead of wounding/eliminating,
  suppress the character body check (rule 3.II.1), do not trigger
  `on-wounded` passives (rule 3.II.1.1), and zero kill-MP for the
  defeated creature (rule 3.II.3 — discarded instead of routed to the
  attacked player's kill pile). Accepts the shared optional `when`
  clause, evaluated against `{ defender: { alignment, covert } }` at
  combat-initiation time; use it to express card text like "detainment
  against hero companies" or "detainment against covert and hero
  companies". (implemented in `engine/detainment.ts`,
  `reducer-combat.ts`)

```json
{ "type": "combat-attacker-chooses-defenders" }
{ "type": "combat-multi-attack", "count": 3 }
{ "type": "combat-cancel-attack-by-tap", "maxCancels": 2 }
{ "type": "combat-one-strike-per-character" }
{ "type": "combat-detainment" }
{
  "type": "combat-detainment",
  "when": {
    "$or": [
      { "defender.alignment": "hero" },
      {
        "$and": [
          { "defender.alignment": "fallen-wizard" },
          { "defender.covert": true }
        ]
      }
    ]
  }
}
```

### 13. `play-restriction`

Constrains when or where a card can enter play.

```json
{ "type": "play-restriction", "rule": "home-site-only",
  "when": { "$not": { "reason": "starting-character" } } }
```

### 14. `duplication-limit`

Caps how many copies of this card can be in a given scope.

Supported scopes:

- `"character"` — one copy per character (e.g. Horn of Anor).
- `"site"` — one copy per site across all companies at the site (e.g. Rescue Prisoners).
- `"game"` — one copy anywhere in play across both players.
- `"player"` — one copy per player across all their characters (e.g. The Windlord Found Me).

```json
{ "type": "duplication-limit", "scope": "character", "max": 1 }
{ "type": "duplication-limit", "scope": "player", "max": 1 }
```

### 15. `reduce-attacks-to-one`

Marker effect for *Forewarned Is Forearmed* (dm-132). When a card with this
effect is in play it activates two engine-level reductions:

1. **Site attacks**: At the start of the site phase's automatic-attack
   sequence, if the active company's site (non-Dragon-lair) has more than one
   automatic attack, a `forewarned-select-attack` step is inserted before
   `automatic-attacks`. The **hazard player** selects which single attack to
   retain; all others are skipped. The retained attack is flagged
   `isolated: true` and `uncancelable: true` on `CombatState`.
2. **Creature attacks**: Any hazard creature with a `combat-multi-attack`
   count > 1 is reduced to a single attack when the chain resolves. That
   single attack is also flagged `isolated: true` and `uncancelable: true`.

The `uncancelable` flag suppresses all cancel-attack actions (including
`combat-cancel-attack-by-tap`). The `isolated` flag is used by the
`on-event: attack-defeated` trigger to discard the card when the single
retained attack is defeated (see effect #2 on dm-132).

No fields beyond `type` are required.

```json
{ "type": "reduce-attacks-to-one" }
```

### 16. `play-target`

Declares what this card targets when played. The engine uses this to
generate per-target actions (one per eligible character, company, etc.).

Character targeting is driven entirely by the DSL: the coarse `target`
category picks the scope (each character in scope is a candidate) and
an optional `filter` {@link Condition} refines it further. The filter
is evaluated against the per-candidate context
`{ target: { race, status, skills, name, inAvatarCompany, itemKeywords }, company: { skills, siteType, moving, hasShadowMagicUser } }`, so there are no
card-specific target keywords in the engine — a card declares its
audience directly via a condition expression.

`company.hasShadowMagicUser` is `true` when any character in the company is a
Ringwraith (race `"ringwraith"`) or has the `"shadow-magic"` skill (naturally
or via an item). Populated only for organization-phase permanent event
play-target evaluation. Used by *Well-preserved* (as-108).

```json
{ "type": "play-target", "target": "character" }
{ "type": "play-target", "target": "character",
  "filter": { "target.race": "hobbit" } }
{ "type": "play-target", "target": "character",
  "filter": {
    "$and": [
      { "target.skills": { "$includes": "scout" } },
      { "target.status": "untapped" }
    ]
  },
  "maxCompanySize": 2,
  "cost": { "tap": "character" } }
```

Supported targets:

- `character` — each character in scope is a candidate. Resource-side
  plays implicitly scope to the active player's own characters; hazard
  plays scope to the active company's characters. Also applied on
  **items** to gate which characters may bear them (e.g. Wizard's Staff
  filters to `target.race: "wizard"`): the site-phase item legal-action
  emitter evaluates the filter per-candidate bearer and only offers
  `play-hero-resource` actions for matching characters.
- `company` — the active company (hazard permanent events that target the whole company rather than individual characters). The filter is evaluated against a context `{ company: { alignment: string, destinationSiteType: string } }` where `alignment` is the resource player's alignment (`"wizard"`, `"ringwraith"`, `"fallen-wizard"`, `"balrog"`) and `destinationSiteType` is the site type of the company's current (or destination) site. Used by *Nothing to Eat or Drink* (le-128) to restrict play to minion companies at free-hold/border-hold or hero companies at shadow-hold/dark-hold.
- `site` — the company's destination/current site (e.g. River).

Optional fields:

- `filter` — DSL condition restricting which candidates qualify. When
  absent every candidate in scope qualifies.
- `maxCompanySize` — maximum effective company size for eligibility
  (hobbits count as half). Used alongside the filter to enforce size
  limits (e.g. Stealth).
- `cost` — cost paid when the card resolves. Evaluated by `cost-evaluator.ts`
  via `applyCost`; the same cost shapes are available on every effect type:
  - `{ "tap": "character" }` — taps the targeted character (e.g. Stealth taps
    the targeted scout). The engine emits one `play-short-event` per eligible
    untapped target.
  - `{ "tap": "bearer" }` — taps the character bearing the source card.
  - `{ "tap": "self" }` — taps the source card itself (item/ally/character).
  - `{ "tap": "sage-in-company" }` — one untapped sage in the company taps;
    one action per eligible sage.
  - `{ "discard": "self" }` — detaches and discards the source card.
  - `{ "check": "corruption", "modifier": N }` — the actor makes a corruption
    check modified by N (e.g. One Ring, Vanishment, Wizard's Laughter).
  - `{ "wound": "bearer" | "character" | "self" }` — wounds the specified
    entity (sets status to Inverted) as the cost.

### 16. `on-guard-reveal`

Declares when an on-guard card may be revealed during the site phase.
The `trigger` field specifies the game event that allows the reveal.

```json
{ "type": "on-guard-reveal", "trigger": "influence-attempt" }
```

Supported triggers:

- `influence-attempt` — when a character in the company declares an
  influence attempt (faction play)
- `resource-play` — when the resource player plays any resource that
  taps the site (generic catch-all)

### 19. `site-rule`

Declares a site-specific rule that modifies standard game mechanics
when a company is at this site.

```json
{ "type": "site-rule", "rule": "healing-affects-all" }
{ "type": "site-rule", "rule": "deny-item",
  "when": { "subtype": "greater",
            "name": { "$ne": "Scroll of Isildur" } } }
```

Rules:

- `healing-affects-all` — wounded characters at this site heal during untap
  as if the site were a haven
- `deny-item` — any item whose card definition matches the `when` condition
  cannot be played at this site. The condition is a standard DSL condition
  (MongoDB-style, evaluated against the item card definition), so arbitrary
  combinations of subtype, name, keywords, etc. are supported. Implemented
  in `legal-actions/site.ts` play-resources step — e.g. Tolfalas uses this
  to deny every greater item except Scroll of Isildur.
- `cancel-attacks` — hazard-creature plays targeting a company whose
  effective site (destination if moving, else current) is this site are
  marked non-viable. Used by darkhavens and the fallen-wizard haven
  (Dol Guldur, Minas Morgul, Carn Dûm, The White Towers, Moria, The
  Under-gates). Implemented in `legal-actions/movement-hazard.ts`
  play-hazards step.
- `auto-test-gold-ring` — storing a gold-ring item at this site enqueues
  a `gold-ring-test` pending resolution with the rule's `rollModifier`.
  The gold-ring-test handler rolls 2d6 + modifier, logs the outcome,
  and discards the ring regardless of result (Rule 9.21 / 9.22).
  Requires that the gold-ring item also declares `storable-at` for the
  site. Rule 9.21's replacement-with-special-ring step is not yet
  implemented.

  ```json
  { "type": "site-rule", "rule": "auto-test-gold-ring", "rollModifier": -2 }
  ```

- `attacks-not-detainment` — forces attacks against a company at this
  site to be resolved as normal attacks rather than detainment,
  overriding the default CoE §3.II.2 R1/R2/R3 and B1/B2/B3 rules and
  any keying-based detainment. The optional `filter` is a standard DSL
  condition evaluated against `{ enemy: { race } }`; the override only
  applies when the attacking creature matches. A missing filter applies
  the override to every attack at the site. Consumed by
  `engine/detainment.ts` (both hazard-creature and automatic-attack call
  sites). Used by *Moria* (le-392) and its twin shadow-holds whose text
  reads "non-Nazgûl creatures played at this site attack normally, not
  as detainment."

  ```json
  { "type": "site-rule", "rule": "attacks-not-detainment",
    "filter": { "enemy.race": { "$ne": "nazgul" } } }
  ```

- `deny-character` — during the organization phase, characters whose card
  definition matches the `filter` cannot be brought into play at this site.
  When `exceptHomesite: true`, the rule is waived for a character whose
  `homesite` equals this site's name. Consumed by
  `legal-actions/organization-characters.ts` — the matching sites are
  simply excluded from the character's playable sites (and thus from
  `play-character` legal actions, covering both general-influence and
  direct-influence follower plays). Used by Carn Dûm (le-359): "Unless
  this site is a character's home site, a non-Orc, non-Troll character
  may not be brought into play at this site."

  ```json
  { "type": "site-rule", "rule": "deny-character",
    "filter": { "$not": { "race": { "$in": ["orc", "troll"] } } },
    "exceptHomesite": true }
  ```

- `never-taps` — the site's status never transitions to `Tapped`. The two
  normal tap-sites — a resource (item/ally) being played on a character at
  this site, and an influence attempt resolving at this site — both skip
  the tap when this rule is present. Characters, items, and influencing
  characters still tap as usual; only the site itself is unaffected.
  Consumed by `engine/reducer-site.ts`. Used by *The Worthy Hills*
  (le-415): "This site never taps."

  ```json
  { "type": "site-rule", "rule": "never-taps" }
  ```

- `heal-during-untap` — treats the site as a haven for the untap phase
  only: wounded (inverted) characters at this site heal to tapped as
  they would at a haven. Nothing else about the site (site-type,
  hazard-limit, attack rules, storage rules, …) is affected. Consumed
  by `engine/reducer-untap.ts` during `performUntap`. Used by *Barad-dûr*
  (le-352) — "Treat this site as a Darkhaven during the untap phase."

  ```json
  { "type": "site-rule", "rule": "heal-during-untap" }
  ```

- `site-phase-ring-auto-test` — at company selection during the site phase
  (`select-company` → `enter-or-skip` transition), scans every gold-ring item
  borne by characters in the selected company and enqueues a `gold-ring-test`
  pending resolution for each one. The tests fire before the enter-or-skip
  decision, so even a company that chooses not to enter the site must test its
  borne rings. The `rollModifier` field is applied to every enqueued test's
  2d6 roll. Unlike `auto-test-gold-ring` (which fires on the store/play path),
  this rule targets already-held rings. Consumed by
  `engine/reducer-site.ts` `enqueueSitePhaseRingAutoTests()`. Used by
  *Barad-dûr* (le-352) — "Any gold ring item at this site is automatically
  tested during the site phase (the site need not be entered). All ring tests
  at this site are modified by -3."

  ```json
  { "type": "site-rule", "rule": "site-phase-ring-auto-test", "rollModifier": -3 }
  ```

- `dynamic-auto-attack` — when a company enters this site, the opponent
  may play one non-unique hazard creature from hand as the site's automatic-attack.
  The `keying` filter lists the site-types and region-types that satisfy
  the creature's keying; a creature is eligible iff at least one of its
  `keyedTo` entries names a matching siteType or regionType. The played
  creature attacks with its own prowess/strikes/body and is discarded
  after combat regardless of outcome (no kill-MP, matching standard
  auto-attack semantics). Consumed by `engine/reducer-site.ts` and
  `engine/legal-actions/site.ts` through the new `play-site-auto-attack`
  site-phase step. Used by *Framsburg* (td-175) and all DM under-deeps sites.

  ```json
  { "type": "site-rule", "rule": "dynamic-auto-attack",
    "keying": {
      "siteTypes": ["ruins-and-lairs", "shadow-hold"],
      "regionTypes": ["wilderness", "shadow"]
    } }
  ```

- `always-return-to-deck` — overrides the normal site-of-origin disposal
  rule (CoE 2.IV.vii). Under the base rule, a tapped non-haven site is
  discarded to the site discard pile when the company departs. When this
  site-rule is present, the site is always returned to the player's
  location deck even when tapped. Consumed by
  `engine/reducer-movement-hazard.ts` at M/H step 8. Used by *Buhr Widu*
  (td-173): "This site is always returned to the location deck, never to
  the discard pile."

  ```json
  { "type": "site-rule", "rule": "always-return-to-deck" }
  ```

- `hazard-limit-modifier` — adjusts the hazard limit for any company
  moving to this site. Applied during the `set-hazard-limit` step before
  the snapshot is taken. `value` is the integer adjustment (positive to
  increase, negative to decrease). The floor of zero still applies.
  Consumed by `engine/reducer-movement-hazard.ts` `snapshotHazardLimit`.
  Used by *Barad-dûr* (tw-374) — "Any company moving to this site has
  its hazard limit increased by 2."

  ```json
  { "type": "site-rule", "rule": "hazard-limit-modifier", "value": 2 }
  ```

- `allow-creature-by-race` — bypasses the normal keying check for hazard
  creatures whose race matches `race`. Any creature of that race may be
  played against a company whose effective site (destination if moving,
  else current) carries this rule, regardless of the creature's `keyedTo`
  entries. Consumed by `engine/legal-actions/movement-hazard.ts`
  `siteAllowsCreatureByRace`. Used by *Geann a-Lisch* (as-138) — "Any
  Man hazard creature can be played at this site."

  ```json
  { "type": "site-rule", "rule": "allow-creature-by-race", "race": "men" }
  ```

- `creatures-always-keyed-to-site` — any hazard creature that is keyable
  to the destination site's original type or name (via `siteTypes` or
  `siteNames` in any `keyedTo` entry) may be played even when a
  `no-creature-hazards-on-company` constraint (e.g. from *Stealth*) is
  active. The creature must still satisfy normal keying; only the external
  restriction is bypassed. Consumed by `engine/legal-actions/pending.ts`
  `applyNoCreatureHazardsOnCompany`. Used by *Mount Doom* (tw-414).

  ```json
  { "type": "site-rule", "rule": "creatures-always-keyed-to-site" }
  ```

- `allow-items-when-tapped` — items may be played at this site even when
  its status is Tapped. The normal tapped-site gate in
  `legal-actions/site.ts` is bypassed for item plays (but the subtype
  check from `playableResources` still applies). Consumed by
  `engine/legal-actions/site.ts` items evaluation. Used by *Tharbad*
  (td-180) — "Items may be played here even if the site is tapped."

  ```json
  { "type": "site-rule", "rule": "allow-items-when-tapped" }
  ```

- `cancel-first-attack-if-in-play` — cancels the first automatic attack
  at this site when the permanent-event card identified by `definitionId`
  is currently in any player's `cardsInPlay`. If the referenced card is
  not in play, all attacks are resolved normally. Consumed by
  `getActiveAutoAttacks()` in `engine/manifestations.ts`, which slices off
  the first element from the combined auto-attack list. Used by
  *The Under-gates* (dm-38) — "If Balrog of Moria is in play ... the first
  automatic attack is canceled."

  ```json
  { "type": "site-rule", "rule": "cancel-first-attack-if-in-play", "definitionId": "tw-12" }
  ```

### 20. `item-play-site`

Restricts an item to be playable only where the company's current site
satisfies a constraint. Two mutually-exclusive forms:

- `sites`: site name must appear in the list (e.g. Palantír of Orthanc —
  Isengard only).
- `filter`: a generic site-card condition evaluated against
  `{ site: <site definition> }` (e.g. hoard items: any site whose
  definition has `hoard: true`).

When present, the normal site-type check (`playableResources`) is
bypassed; the item is playable only if its restriction matches.
Implemented in `legal-actions/site.ts`.

```json
{ "type": "item-play-site", "sites": ["Isengard"] }
```

```json
{ "type": "item-play-site", "filter": { "site.hoard": true } }
```

### 21. `storable-at`

Declares that an item can be stored during the Organization phase when
the bearer's company is at a matching site. Storing moves the item from
the character to the player's stored-items pile, where it earns
marshalling points safely. After storage the initial bearer makes a
corruption check.

A site matches if its name is in `sites` OR its `siteType` is in
`siteTypes`. At least one of the two lists must be present. `sites`
targets specific sites (e.g. Minas Tirith); `siteTypes` targets a whole
class (e.g. any Haven).

When `marshallingPoints` is present, the stored item uses that value
instead of the card's base MP. Implemented in
`legal-actions/organization-companies.ts` (legal action),
`reducer-organization.ts` (handler), and `recompute-derived.ts` (MP).

```json
{ "type": "storable-at", "sites": ["Minas Tirith"], "marshallingPoints": 2 }
{ "type": "storable-at", "siteTypes": ["haven"], "marshallingPoints": 1 }
```

### 22. `company-rule`

Declares a company-level rule carried by a character. While this character
is in play, the rule applies to their entire company.

```json
{ "type": "company-rule", "rule": "healing-affects-all" }
```

Rules:

- `healing-affects-all` — when a healing effect (e.g. `set-character-status`
  from inverted to untapped) targets a character in this character's company,
  the healing extends to all wounded characters in the company. Implemented in
  `reducer-events.ts` (play-option healing spread). Example: Ioreth.

### 23. `call-of-home-check`

Forces a "Call of Home" style roll check on the targeted character. When
the hazard short event resolves against a character (selected via
`play-target`), the character's player rolls 2d6. If roll + unused
general influence < `threshold`, the character returns to the player's
hand. All items, allies, and hazards attached to the character are
discarded; followers fall to GI if room, otherwise are discarded.

Used with a `play-target` effect that selects the target character.

```json
{ "type": "call-of-home-check", "threshold": 10 }
```

Implemented in `chain-reducer.ts` (enqueue pending resolution on
short-event resolution), `legal-actions/pending.ts` (generate roll
action), and `pending-reducers.ts` (execute roll and apply consequences).

### 24. `mass-body-check`

Forces a body check modified by `modifier` (typically negative) on **every
character** in the active company when the hazard short event resolves. For
each character the resource player rolls 2d6:

- Roll ≥ (body + modifier): no effect.
- Roll < (body + modifier), character is Orc or Troll: character returned to
  hand (discarded per normal body-check rules for Orcs/Trolls).
- Roll < (body + modifier), character is any other race, untapped: character
  becomes tapped.
- Roll < (body + modifier), character is any other race, already tapped: no
  effect.

```json
{ "type": "mass-body-check", "modifier": -1 }
```

Implemented in `chain-reducer.ts` (detect effect on short-event resolution,
enqueue one `body-check-company` pending resolution per character),
`legal-actions/pending.ts` (generate `body-check-company-roll` action per
queued resolution), and `pending-reducers.ts` (execute roll, apply
race-based consequence, resume chain auto-resolution after all checks
resolve).

### Grant-Action: `palantir-fetch-discard`

Tap the Palantír item to choose one card from the player's discard pile
and shuffle it into the play deck. Bearer makes a corruption check after
the fetch resolves. Requires the bearer to be able to use a Palantír
(Saruman's innate ability or Align Palantír attached) and at least 5
cards in the play deck.

```json
{ "type": "grant-action", "action": "palantir-fetch-discard",
  "cost": { "tap": "self" },
  "when": { "$and": [
    { "bearer.canUsePalantir": true },
    { "player.playDeckSize": { "$gte": 5 } }
  ] } }
```

Context variables for grant-action `when` conditions:

- `bearer.canUsePalantir` — true if the bearer's card text includes
  palantír-use ability or has Align Palantír attached
- `player.playDeckSize` — number of cards in the player's play deck

Implemented in `reducer-organization.ts` (handler), `legal-actions/organization.ts`
(scanner + context), `reducer-utils.ts` (fetch completion with corruption check).

### Grant-Action: `palantir-peek-shuffle`

Tap the Palantír item to shuffle the top 5 cards of both players' play
decks (keeping them at the top in a new random order). Bearer makes a
corruption check after the shuffle. Requires the bearer to be able to
use a Palantír. Used by *Palantír of Minas Tirith* (le-333).

```json
{ "type": "grant-action", "action": "palantir-peek-shuffle",
  "cost": { "tap": "self" },
  "when": { "bearer.canUsePalantir": true },
  "apply": {
    "type": "sequence",
    "apps": [
      { "type": "shuffle-deck-top", "count": 5 },
      { "type": "shuffle-deck-top", "count": 5, "toOwner": "opponent" },
      { "type": "enqueue-corruption-check" }
    ]
  } }
```

**Apply type `shuffle-deck-top`:** Shuffles the top `count` (default 5) cards
of the target player's play deck, keeping them at the top in a new random order.
`toOwner` controls the target: omitted or `"source-owner"` = bearer's player;
`"opponent"` = the opposing player. If the deck has fewer than `count` cards, all
available cards are shuffled. Implemented in `reducer-organization.ts`
`runGrantApply()`.

### 23. `play-condition`

Gates playability on a game-state condition. The `requires` field names
the context source.

Requires:

- `site-path` — the company's resolved site path during M/H. The
  condition is evaluated against a context exposing:
  - `sitePath.*Count` — region-type counts from the resolved site path
    (`wildernessCount`, `shadowCount`, `darkCount`, `coastalCount`,
    `freeCount`, `borderCount`).
  - `destinationSiteType` — the site type of the destination
    (`ruins-and-lairs`, `shadow-hold`, etc.), enabling cards that gate
    on both path composition and destination site type (e.g. Dragon's
    Desolation tw-29 Mode B: R&L destination + 2W in path).
  - `inPlay` — names of all cards currently in play, matching the
    shared `inPlay` condition semantics (e.g. *Doors of Night* as an
    alt-keying relaxation).

```json
{ "type": "play-condition", "requires": "site-path",
  "condition": {
    "$or": [
      { "sitePath.wildernessCount": { "$gte": 2 } },
      { "sitePath.shadowCount": { "$gte": 1 } },
      { "sitePath.darkCount": { "$gte": 1 } }
    ]
  } }
```

Implemented in `legal-actions/movement-hazard.ts` (`checkSitePathCondition`).

- `discard-named-card` — requires discarding a specific named card as a
  play prerequisite. The `cardName` field names the card, and `sources`
  lists where to look: `character-items` (items on characters at the
  current site) and/or `out-of-play-pile` (stored items in the player's
  out-of-play pile). One legal action is generated per available discard
  candidate, carrying the `discardCardInstanceId` on the action.

```json
{ "type": "play-condition", "requires": "discard-named-card",
  "cardName": "Sapling of the White Tree",
  "sources": ["character-items", "out-of-play-pile"] }
```

Implemented in `legal-actions/site.ts` (permanent event play-condition
check) and `reducer-events.ts` (discard execution).

- `site-type` — restricts the card to companies whose current site type
  is in the `siteTypes` array. For character-targeting permanent events
  (org phase), the check is applied per company in
  `legal-actions/organization-events.ts`; only characters in a qualifying
  company are offered as targets. For short/long events and site-phase
  events, the check is in `legal-actions/organization.ts` and
  `legal-actions/site.ts` respectively.

  Minion haven sites (Dol Guldur, Minas Morgul, Carn Dûm, etc.) use
  `siteType: "haven"` — there is no separate `"darkhaven"` type.

```json
{ "type": "play-condition", "requires": "site-type", "siteTypes": ["haven"] }
```

  Example: Bade to Rule (le-167) — requires the Ringwraith's company to
  be at a Darkhaven (haven-type site).

- `card-not-in-play` — blocked if a named card is currently in play (as
  a character or in any player's cardsInPlay). The `cardName` field names
  the blocking card.

```json
{ "type": "play-condition", "requires": "card-not-in-play", "cardName": "Balrog" }
```

- `same-site-has-character-race` — for character-targeting permanent events
  (org phase): the target character's company's current site must also be
  the site of at least one other of the controller's companies that contains
  a character of the specified `race`. Used by *By the Ringwraith's Word*
  (le-174) to enforce "at the same Darkhaven as your Ringwraith".

  Implemented in `legal-actions/organization-events.ts` alongside the
  `site-type` company-loop check.

```json
{ "type": "play-condition", "requires": "same-site-has-character-race", "race": "ringwraith" }
```

### 24. `creature-race-choice`

Requires the player to choose a creature race when playing the card.
The `exclude` array lists races that may not be chosen. The legal-action
emitter produces one `play-hazard` action per eligible race, each
carrying the chosen race on `chosenCreatureRace`. The `apply` clause
describes the constraint added for the chosen race.

When `fixedRace` is present no choice is offered: a single action is
emitted with that race and the apply resolves directly. Used by
Dragon's Desolation (tw-29) Mode B — always Dragon.

Supported `apply.constraint` values:

- `creature-type-no-hazard-limit` — creatures of the chosen race played
  against the target company do not count against the hazard limit for
  the constraint's scope (e.g. Two or Three Tribes Present).
- `creature-keying-bypass` — ONE creature of the chosen race may be
  played on the target company ignoring its normal keying. The
  constraint carries a `remainingPlays` counter (default 1); each
  creature of that race played against this company consumes one
  charge, and the constraint clears at zero. The M/H legal-action
  emitter treats a matching bypass as an extra `keyedBy` method
  (`keying-bypass`) when path-based keying fails (Dragon's Desolation
  tw-29 Mode B).

```json
{ "type": "creature-race-choice",
  "exclude": ["nazgul", "undead", "dragon"],
  "apply": {
    "type": "add-constraint",
    "constraint": "creature-type-no-hazard-limit",
    "scope": "company-mh-phase"
  } }
```

```json
{ "type": "creature-race-choice",
  "exclude": [],
  "fixedRace": "dragon",
  "apply": {
    "type": "add-constraint",
    "constraint": "creature-keying-bypass",
    "scope": "company-mh-phase"
  } }
```

Implemented in `legal-actions/movement-hazard.ts` (action generation,
`hasCreatureKeyingBypass`, keying-bypass fallthrough),
`reducer-movement-hazard.ts` (constraint creation + consumption via
`consumeCreatureKeyingBypass`).

### 25. `ahunt-attack`

Declares that while this hazard long-event is in play, any company whose
movement path crosses the listed region names (or region types) faces a
creature-like attack during the order-effects step (CoE step 4). The
attack uses the specified strikes, prowess, body, and race. Combat rules
(e.g. `attacker-chooses-defenders`) are declared in `combatRules`.

The optional `extended` clause adds extra region names and/or region
types when a condition is met (typically Doors of Night in play).

```json
{ "type": "ahunt-attack",
  "regionNames": ["Andrast Coast", "Bay of Belfalas", "Eriadoran Coast", "Andrast"],
  "strikes": 3,
  "prowess": 15,
  "body": 6,
  "race": "dragon",
  "combatRules": ["attacker-chooses-defenders"],
  "extended": {
    "when": { "inPlay": "Doors of Night" },
    "regionNames": ["Old Pûkel-land", "Enedhwaith", "Anfalas"],
    "regionTypes": ["coastal-sea"]
  } }
```

Implemented in `reducer-movement-hazard.ts` (`handleOrderEffects`,
`collectMatchingAhuntAttacks`).

### 26. `call-council`

Triggers the "call the council" endgame transition from a card, as the
card-based equivalent of the `call-free-council` action. Used by Sudden
Call (le-235) per CoE rule 10.41: Ringwraith and Balrog players cannot
freely call the endgame and must play Sudden Call instead.

```json
{ "type": "call-council", "lastTurnFor": "opponent" }
{ "type": "call-council", "lastTurnFor": "self" }
```

- `lastTurnFor: "opponent"` — resource-side play on the card-player's
  own turn; the opponent gets one last turn.
- `lastTurnFor: "self"` — hazard-side play during the opponent's turn;
  the card-player gets one last turn.

Both modes set `freeCouncilCalled` on the caller, advance the turn, and
set `state.lastTurnFor` accordingly. Implemented in `reducer-end-of-turn.ts`
(`triggerCouncilCall`).

### 27. `move`

Generic card-movement primitive. A `move` picks card instance(s) by
selector, removes them from a source zone, and appends them to a
destination zone. Implemented in `engine/reducer-move.ts`
(`applyMove`).

Replaces the eleven per-move effect types that existed before the
card-move plan (`specs/2026-04-23-card-move-primitive-plan.md`). The
following table shows the old types and their current `move` shapes
for reference:

| Old effect | New shape | Example card |
|---|---|---|
| `discard-self` | `{ select: 'self', from: 'self-location', to: 'discard' }` | Treebeard, Align Palantír |
| `discard-target-item` | `{ select: 'target', from: 'in-play', to: 'discard' }` | Gandalf's test-gold-ring |
| `discard-named-card-from-company` | `{ select: 'named', from: 'in-play', to: 'discard', cardName }` | Stinker / Gollum |
| `move-target-from-discard-to-hand` | `{ select: 'target', from: 'discard', to: 'hand', filter }` | Saruman |
| `discard-in-play` | `{ select: 'target', from: 'in-play', to: 'discard', filter }` | Marvels Told |
| `discard-cards-in-play` | `{ select: 'filter-all', from: 'in-play', to: 'discard', filter }` | Doors of Night |
| `discard-non-special-items` | `{ select: 'filter-all', from: 'items-on-wounded', to: 'discard', toOwner: 'defender', filter }` | creature wound triggers |
| `reshuffle-self-from-hand` | `{ select: 'self', from: 'hand', to: 'deck', shuffleAfter: true }` | Sudden Call |
| `fetch-to-deck` | `{ select: 'target', from: ['sideboard','discard'], to: 'deck', shuffleAfter: true, filter, count }` | Smoke Rings |
| `bounce-hazard-events` | `{ select: 'filter-all', from: 'attached-to-target-company', to: 'hand', toOwner: 'opponent', filter, corruptionCheck }` | Wizard Uncloaked |

**Shape**

```json
{
  "type": "move",
  "select": "self | target | filter-all | named",
  "from": "<MoveZone> | [<MoveZone>, …]",
  "to": "<MoveZone>",
  "toOwner": "source-owner | opponent | defender",
  "filter": { "…": "…" },
  "count": 1,
  "shuffleAfter": false,
  "corruptionCheck": { "modifier": 0 },
  "cardName": "…",
  "when": { "…": "…" }
}
```

**Selectors**

- `self` — the card carrying the effect; the engine locates it wherever
  it currently lives (hand, discard, cardsInPlay, attached to a character).
- `target` — the user-selected target carried on the triggering action
  (`action.targetCardId`). Must be found in one of the declared `from`
  zones.
- `filter-all` — every instance in the declared `from` zones whose
  definition matches `filter`. `count` optionally caps the result.
- `named` — the first instance whose definition name equals `cardName`.

**Zones (`MoveZone`)**

Named piles: `hand`, `deck`, `discard`, `sideboard`, `out-of-play`,
`kill-pile`. Contextual locators: `self-location` (wherever the source
card lives), `in-play` (any player's `cardsInPlay`),
`items-on-target` (items on the action's target character),
`items-on-wounded` (items on the combat-wounded character),
`attached-to-target-company` (items + hazards attached to any character
in the target company).

Contextual locators are introduced by the migration phase that first
uses them — not all are available in Phase 1.

**Destination owner**

- `source-owner` (default) — push to the pile of whoever owned the
  source instance.
- `opponent` — push to the other player's pile (bounce).
- `defender` — combat context; push to the defender's pile
  (wound-triggered item loss).

**Conditional execution (`when`)**

An optional `when` condition gates whether the fetch sub-flow is offered to
the player at all. Evaluated at enqueue time (when the card enters play, not
when the player picks), against a context exposing:

- `target.siteName` — the site name of the character targeted by the action
  (`action.targetCharacterId`); empty string when there is no target character.
- `player.deckCount` — number of cards currently in the resource player's
  play deck.

If the condition fails, no `fetch-to-deck` pending effect is pushed and the
sub-flow is silently skipped. Used by *Vilya* to gate the fetch on
`{ "$and": [{ "target.siteName": "Rivendell" }, { "player.deckCount": { "$gte": 5 } }] }`.

**Multi-pick fetch (`count > 1`)**

When `count > 1`, the engine offers the player one pick at a time. After each
successful pick, `handleFetchFromPile` decrements `count` and re-enqueues the
effect with the new count so the player is offered another selection. The loop
continues until `count` reaches 0 or the player passes (action type
`resolve-pending-effect` with no `targetCardId`). Passing cancels all
remaining picks. Any deferred `postCorruptionCheck` fires after the last pick
completes or when the player passes.

**Side effects**

- `shuffleAfter: true` shuffles the destination pile after pushing.
- `corruptionCheck: { modifier: n }` enqueues a corruption check on
  the bearer after the move resolves.

## Resolver Architecture

The engine calls a resolver at each decision point:

```text
resolve(context, stat) → final value
```

The context carries everything relevant to the current calculation:

- `reason` — what is being calculated (`"combat"`, `"faction-influence-check"`, `"corruption-check"`, etc.)
- `bearer` / `character` — the character involved
- `enemy` — the creature or hazard (in combat)
- `faction` — the faction (in influence checks). Exposes `faction.name`, `faction.race`, and `faction.playableAt` — an array of the sites/site-types listed on the faction card's `playableAt`, enabling conditions like `{ "faction.playableAt": "Dunnish Clan-hold" }` (AS-4 Perchen).
- `company` — all characters at the same site
- `cardsInPlay` — all cards in play for both players
- `inPlay` — names of all events/cards in play (for `target: "all-attacks"` and `"all-characters"` contexts)
- `controller.inPlay` — names of cards in play controlled by the player performing the check (populated during faction-influence checks). Use this when an effect depends on the *same* player controlling another card, e.g. Standard Modifications like "Grey Mountain Goblins (+2)" on LE factions, which apply only when the controller has both factions in play: `{ "when": { "controller.inPlay": "Grey Mountain Goblins" } }`.
- `enemy.race` — the creature's race (for `target: "all-attacks"` contexts, e.g. `"wolf"`, `"orc"`)

The resolver:

1. Collects all effects from all cards in play
2. Filters by `when` conditions against the context
3. Resolves `overrides` chains (specific beats general)
4. Evaluates value expressions via MathJS with context variables
5. Applies modifiers and caps
6. Returns the final computed value

## Full Card Examples

### Alatar

```json
"effects": [
  { "type": "draw-modifier", "draw": "hazard", "value": -1, "min": 0 },
  { "type": "on-event", "event": "creature-attack-begins",
    "apply": {
      "type": "offer-char-join-attack",
      "discardOwnedAllies": true,
      "forceStrike": true,
      "postAttack": { "tapIfUntapped": true, "corruptionCheck": {} }
    } }
]
```

Reduces opponent draws from Alatar's company's movement by one (floored at zero). When a hazard creature attacks any of the controller's companies and Alatar is at a haven in a different company, the controller may accept the haven-join offer: Alatar joins the attacked company for this combat, his attached allies are discarded, the creature must strike him, and after combat he taps (if untapped) and makes a corruption check. He returns to the haven company at combat finalization.

### Aragorn II

```json
"effects": [
  { "type": "stat-modifier", "stat": "direct-influence", "value": 2,
    "when": { "reason": "faction-influence-check", "faction.name": "Rangers of the North" } },
  { "type": "mp-modifier", "value": -3, "when": { "reason": "elimination" } }
]
```

### Gimli

```json
"effects": [
  { "type": "stat-modifier", "stat": "direct-influence", "value": 2,
    "when": { "reason": "faction-influence-check", "faction.name": "Iron Hill Dwarves" } },
  { "type": "stat-modifier", "stat": "direct-influence", "value": 1,
    "when": { "reason": "influence-check", "target.race": "elf" } },
  { "type": "stat-modifier", "stat": "direct-influence", "value": 1,
    "when": { "reason": "faction-influence-check", "faction.race": "elf" } },
  { "type": "stat-modifier", "stat": "prowess", "value": 2,
    "when": { "reason": "combat", "enemy.race": "orc" } }
]
```

### Glamdring

```json
"effects": [
  { "type": "stat-modifier", "stat": "prowess", "value": 3, "max": 8,
    "id": "glamdring-prowess" },
  { "type": "stat-modifier", "stat": "prowess", "value": 3, "max": 9,
    "overrides": "glamdring-prowess",
    "when": { "reason": "combat", "enemy.race": "orc" } }
]
```

### Sting

```json
"effects": [
  { "type": "stat-modifier", "stat": "prowess", "value": 1, "max": 8,
    "id": "sting-prowess" },
  { "type": "stat-modifier", "stat": "prowess", "value": 2, "max": 8,
    "overrides": "sting-prowess",
    "when": { "bearer.race": "hobbit" } }
]
```

### The One Ring

```json
"effects": [
  { "type": "stat-modifier", "stat": "prowess", "value": 5,
    "max": "bearer.baseProwess * 2" },
  { "type": "stat-modifier", "stat": "body", "value": 5, "max": 10 },
  { "type": "stat-modifier", "stat": "direct-influence", "value": 5 },
  { "type": "company-modifier", "stat": "corruption-points", "value": 1 },
  { "type": "cancel-strike",
    "cost": { "check": "corruption", "modifier": -2 },
    "when": { "$not": { "$or": [
      { "enemy.race": "undead" }, { "enemy.race": "nazgul" }
    ] } } }
]
```

### Eowyn

```json
"effects": [
  { "type": "stat-modifier", "stat": "prowess", "value": 6,
    "when": { "reason": "combat", "enemy.race": "nazgul" } },
  { "type": "enemy-modifier", "stat": "body", "op": "halve-round-up",
    "when": { "reason": "combat", "enemy.race": "nazgul" } }
]
```

### Gandalf

```json
"effects": [
  { "type": "check-modifier", "check": "corruption", "value": 1 },
  { "type": "grant-action", "action": "test-gold-ring",
    "cost": { "tap": "self" },
    "when": { "company.hasItem": { "subtype": "gold-ring" } } }
]
```

### Elrond

```json
"effects": [
  { "type": "hand-size-modifier", "value": 1,
    "when": { "self.location": "Rivendell" } },
  { "type": "mp-modifier", "value": -3, "when": { "reason": "elimination" } }
]
```

### Barrow-wight

```json
"effects": [
  { "type": "on-event", "event": "character-wounded-by-self",
    "apply": { "type": "force-check", "check": "corruption", "modifier": -2 },
    "target": "wounded-character" }
]
```

### Gates of Morning

```json
"effects": [
  { "type": "duplication-limit", "scope": "game", "max": 1 },
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "discard-cards-in-play",
               "filter": { "cardType": "hazard-event", "keywords": { "$includes": "environment" } } } }
]
```

### Eye of Sauron

```json
"effects": [
  { "type": "stat-modifier", "stat": "prowess", "value": 1,
    "target": "all-automatic-attacks", "id": "eye-of-sauron-prowess" },
  { "type": "stat-modifier", "stat": "prowess", "value": 3,
    "target": "all-automatic-attacks",
    "overrides": "eye-of-sauron-prowess",
    "when": { "inPlay": "Doors of Night" } }
]
```

### Assassin

```json
"effects": [
  { "type": "combat-attacker-chooses-defenders" },
  { "type": "combat-multi-attack", "count": 3 },
  { "type": "combat-cancel-attack-by-tap", "maxCancels": 2 }
]
```

### Cave-drake

```json
"effects": [
  { "type": "combat-attacker-chooses-defenders" }
]
```

### Dodge

```json
"effects": [
  { "type": "strike-modifier", "dodge": true, "bodyPenalty": -1 }
]
```

### Horn of Anor

```json
"effects": [
  { "type": "stat-modifier", "stat": "direct-influence", "value": 2,
    "when": { "reason": "faction-influence-check" } },
  { "type": "duplication-limit", "scope": "character", "max": 1 }
]
```

### Wake of War

```json
"effects": [
  { "type": "duplication-limit", "scope": "game", "max": 1 },
  { "type": "stat-modifier", "stat": "prowess", "value": 1,
    "target": "all-attacks", "id": "wake-of-war-prowess",
    "when": { "enemy.race": { "$in": ["wolf", "spider", "animal"] } } },
  { "type": "stat-modifier", "stat": "prowess", "value": 2,
    "target": "all-attacks", "overrides": "wake-of-war-prowess",
    "when": { "$and": [{ "enemy.race": "wolf" }, { "inPlay": "Doors of Night" }] } },
  { "type": "stat-modifier", "stat": "strikes", "value": 1,
    "target": "all-attacks", "id": "wake-of-war-strikes",
    "when": { "enemy.race": { "$in": ["wolf", "spider", "animal"] } } },
  { "type": "stat-modifier", "stat": "strikes", "value": 2,
    "target": "all-attacks", "overrides": "wake-of-war-strikes",
    "when": { "$and": [{ "enemy.race": "wolf" }, { "inPlay": "Doors of Night" }] } }
]
```

### Foolish Words

```json
"effects": [
  { "type": "on-guard-reveal", "trigger": "influence-attempt" },
  { "type": "duplication-limit", "scope": "character", "max": 1 },
  { "type": "check-modifier", "check": "influence", "value": -4 },
  { "type": "grant-action", "action": "remove-self-on-roll",
    "cost": { "tap": "bearer" }, "rollThreshold": 8 }
]
```

### Halfling Strength

```json
"effects": [
  { "type": "play-target", "target": "character",
    "filter": { "target.race": "hobbit" } },
  { "type": "play-option", "id": "untap",
    "when": { "target.status": "tapped" },
    "apply": { "type": "set-character-status", "status": "untapped" } },
  { "type": "play-option", "id": "heal",
    "when": { "$and": [ { "target.status": "inverted" }, { "phase": "organization" } ] },
    "apply": { "type": "set-character-status", "status": "untapped" } },
  { "type": "play-option", "id": "corruption-check-boost",
    "apply": { "type": "add-constraint",
               "constraint": "check-modifier",
               "check": "corruption",
               "scope": "until-cleared", "value": 4 } }
]
```

`play-option` declares one of several mutually-exclusive choices the
player may take when playing a card. Each option has an `id`, an optional
`when` evaluated against the target context (`target.race`,
`target.status`, `target.skills`, `inPlay`, `phase`), and an `apply` clause
resolved by the generic reducer.

The `when` context includes `inPlay` — an array of all card names
currently in play — so conditions like `{ "inPlay": "Gates of Morning" }`
work. It also includes `phase` — the current game phase string (e.g.
`"organization"`, `"site"`, `"movement-hazard"`) — so options can be
restricted to specific phases: `{ "phase": "organization" }`.

Supported `apply` kinds today:

- `set-character-status` — mutates the target character's status
  (`tapped` / `untapped` / `inverted`). Untap and heal both map here.
- `add-constraint` — attaches an {@link ActiveConstraint} to the target.
  When `constraint: "check-modifier"` is used, the constraint behaves as
  a one-shot bonus (`check`, `value`) to the target's next check of the
  named type, consumed automatically on resolution. Future cards granting
  one-shot bonuses to influence or other checks reuse the same kind
  unchanged. When `constraint: "hazard-limit-modifier"` is used, the
  target is resolved to the company containing the targeted character and
  the constraint modifies the hazard limit during the company's M/H phase.
  The `scope` should be `"company-mh-phase"`.

### Marvels Told

```json
"effects": [
  { "type": "play-target", "target": "character",
    "filter": { "target.skills": { "$includes": "sage" } },
    "cost": { "tap": "character" } },
  { "type": "discard-in-play",
    "filter": {
      "$and": [
        { "cardType": "hazard-event" },
        { "eventType": { "$in": ["permanent", "long"] } },
        { "$not": { "keywords": { "$includes": "environment" } } }
      ]
    },
    "corruptionCheck": { "modifier": -2 } }
]
```

### Dark Quarrels

```json
"effects": [
  { "type": "cancel-attack",
    "when": { "enemy.race": { "$in": ["orc", "troll", "man"] } } },
  { "type": "halve-strikes",
    "when": { "inPlay": "Gates of Morning" } }
]
```

### Many Turns and Doublings

```json
"effects": [
  { "type": "cancel-attack", "requiredSkill": "ranger",
    "when": { "enemy.race": { "$in": ["wolf", "spider", "animal", "undead"] } } },
  { "type": "play-target", "target": "character",
    "filter": { "$and": [
      { "target.skills": { "$includes": "ranger" } },
      { "target.status": "untapped" }
    ] },
    "cost": { "tap": "character" } },
  { "type": "play-option", "id": "decrease-hazard-limit",
    "when": { "inPlay": "Gates of Morning" },
    "apply": { "type": "add-constraint",
               "constraint": "hazard-limit-modifier",
               "scope": "company-mh-phase", "value": -1 } }
]
```

### Palantír of Orthanc

```json
"effects": [
  { "type": "item-play-site", "sites": ["Isengard"] },
  { "type": "grant-action", "action": "palantir-fetch-discard",
    "cost": { "tap": "self" },
    "when": { "$and": [
      { "bearer.canUsePalantir": true },
      { "player.playDeckSize": { "$gte": 5 } }
    ] } }
]
```

### Sapling of the White Tree

```json
"effects": [
  { "type": "storable-at", "sites": ["Minas Tirith"], "marshallingPoints": 2 }
]
```

### Wizard Uncloaked

```json
"effects": [
  { "type": "play-target", "target": "character",
    "filter": { "target.race": "wizard" } },
  { "type": "move",
    "select": "filter-all",
    "from": "attached-to-target-company",
    "to": "hand",
    "toOwner": "opponent",
    "filter": { "$and": [
      { "cardType": "hazard-event" },
      { "eventType": "permanent" }
    ] },
    "corruptionCheck": { "modifier": -2 } }
]
```

### Orc-lieutenant

```json
"effects": [
  { "type": "stat-modifier", "stat": "prowess", "value": 4,
    "when": { "company.facedRaces": { "$includes": "orc" } } }
]
```

### Choking Shadows

Three `on-event: company-arrives-at-site` modes tried in order; the first
whose `when` matches is the mode that applies. Modes B1/B2 require
*Doors of Night* in play and can rewrite the destination site or region
type until end of turn; Mode A is the fallback +2 prowess boost applied
to the next automatic-attack at a Ruins & Lairs site.

```json
"effects": [
  { "type": "duplication-limit", "scope": "turn", "max": 1 },
  { "type": "on-event", "event": "company-arrives-at-site",
    "when": { "$and": [
      { "environment.doorsOfNightInPlay": true },
      { "company.destinationSiteType": "ruins-and-lairs" }
    ] },
    "apply": { "type": "add-constraint", "constraint": "site-type-override",
      "overrideType": "shadow-hold", "scope": "turn" } },
  { "type": "on-event", "event": "company-arrives-at-site",
    "when": { "$and": [
      { "environment.doorsOfNightInPlay": true },
      { "company.destinationRegionType": "wilderness" }
    ] },
    "apply": { "type": "add-constraint", "constraint": "region-type-override",
      "overrideType": "shadow", "regionName": "destination", "scope": "turn" } },
  { "type": "on-event", "event": "company-arrives-at-site",
    "when": { "company.destinationSiteType": "ruins-and-lairs" },
    "apply": { "type": "add-constraint", "constraint": "auto-attack-prowess-boost",
      "value": 2, "siteType": "ruins-and-lairs", "scope": "company-site-phase" } }
]
```

### Two or Three Tribes Present

```json
"effects": [
  { "type": "play-condition", "requires": "site-path",
    "condition": {
      "$or": [
        { "sitePath.wildernessCount": { "$gte": 2 } },
        { "sitePath.shadowCount": { "$gte": 1 } },
        { "sitePath.darkCount": { "$gte": 1 } }
      ]
    } },
  { "type": "creature-race-choice",
    "exclude": ["nazgul", "undead", "dragon"],
    "apply": {
      "type": "add-constraint",
      "constraint": "creature-type-no-hazard-limit",
      "scope": "company-mh-phase"
    } }
]
```

### 28. `control-restriction`

Restricts how the bearer character can be controlled.

Rules:

- `no-direct-influence` — the character cannot be controlled by direct
  influence. On attachment, any existing DI control is reverted to general
  influence. During organization, the character cannot be moved to DI.
  Used by Rebel-talk (le-132). Implemented in `chain-reducer.ts`
  (attachment revert) and `organization-companies.ts` (block
  move-to-influence).

```json
{ "type": "control-restriction", "rule": "no-direct-influence" }
```

### 30. `dragon-at-home`

Augments a Dragon's lair with an additional automatic-attack while this
"At-Home" permanent-event is in play. The carrying card's `manifestId`
identifies which Dragon — the lair is found by matching `lairOf`. The
augmentation is suppressed for as long as the same Dragon's Ahunt
long-event is also in play (the rule's "Unless [Dragon] Ahunt is in
play" clause).

```json
{ "type": "dragon-at-home",
  "attack": { "creatureType": "Dragon", "strikes": 2, "prowess": 18 } }
```

Implemented in `engine/manifestations.ts` (`getActiveAutoAttacks`).

### 31. `ward-bearer`

Attaches a "cancels hazard X" ward to the bearer of the card carrying
this effect (an item on a character, typically). The `filter` is a
standard DSL condition evaluated against each *hazard* card definition;
any hazard whose definition matches the filter is:

- **On-entry swept**: when the ward-bearing card attaches to a character,
  every hazard already on that character whose definition matches is
  discarded to the hazard owner's discard pile.
- **Continuously cancelled**: while the ward-bearing card remains on the
  character, any hazard permanent-event that would attach to the
  character is routed to its owner's discard pile instead. The
  movement/hazard legal-action computer also suppresses the character
  as a play target for matching hazards, so the hazard player never
  sees a pointless "attach" offer in the first place.

```json
{ "type": "ward-bearer",
  "filter": { "keywords": { "$includes": "dark-enchantment" } } }
```

Used by Adamant Helmet (td-96) — "Cancels all dark enchantments
targetting bearer." Implemented in `engine/effects/ward.ts` with call
sites in `engine/reducer-site.ts` (`handleSitePlayHeroResource`),
`engine/chain-reducer.ts` (`resolvePermanentEvent`), and
`engine/legal-actions/movement-hazard.ts` (character-target emission).

### 32. Combat-time permanent-event play

A hazard permanent-event can declare `play-window` with `phase:
"combat"` and `step: "resolve-strike"` to be offered during combat
instead of the movement/hazard phase. The combat legal-action emitter
in `engine/legal-actions/combat.ts` (`combatHazardPermanentPlays`)
picks up matching cards in the attacker's hand and offers a
`play-hazard` action against the defender currently facing the strike.

`play-condition` with `requires: "combat-creature-race"` and a
`race` field gates the play on the attacking creature's race (read
from `combat.creatureRace`). A standard `play-target` with a
character filter further refines which defenders the card may be
played on.

A companion `on-event` with trigger `"self-enters-play-combat"` and
apply `{ type: "modify-current-strike-prowess", value: -1 }` adjusts
the current strike's prowess at play time. The engine encodes a -1 to
the attacker's strike as a +1 bonus on the defender's
`StrikeAssignment.strikeProwessBonus`, so it integrates with the
existing per-strike prowess machinery.

```json
{ "type": "play-window", "phase": "combat", "step": "resolve-strike" }
{ "type": "play-condition", "requires": "combat-creature-race", "race": "dragon" }
{ "type": "on-event", "event": "self-enters-play-combat",
  "apply": { "type": "modify-current-strike-prowess", "value": -1 } }
```

Used by Dragon's Curse (td-16). The movement/hazard legal-action
emitter skips cards whose `play-window.phase` is not
`"movement-hazard"`, so a combat-tagged hazard is not accidentally
offered during the M/H phase.

Resource short-events may also declare `play-window` with `phase:
"site"` and `step: "play-resources"` to restrict play to the site
phase. An optional `siteTypes` array further restricts the card to
companies whose current site is one of the listed types:

```json
{ "type": "play-window", "phase": "site", "step": "play-resources",
  "siteTypes": ["shadow-hold", "dark-hold"] }
```

The site phase legal-action emitter in `engine/legal-actions/site.ts`
evaluates `siteTypes` against the active company's current site type
(via `company.siteType` in the `play-target` filter context). Used by
Lucky Search (tw-269).

### 33. `combat-protection`

Protects the bearing card (typically an ally) from being assigned
strikes during combat. Only `protection: "no-attack"` is defined.

When an ally carries this effect, it is excluded from the
strike-assignment pool for both the defending player (defender's choice
of who takes each strike) and the attacking player (who assigns
remaining or excess strikes). The ally remains in the company and can
still tap for other purposes (e.g. cancel-attack).

```json
{ "type": "combat-protection", "protection": "no-attack" }
```

Used by Goldberry (tw-245) — "May not be attacked." Implemented in
`engine/legal-actions/combat.ts` (`allyHasCombatProtection()`),
checked in both the defender-assigns and attacker-assigns loops.

### 34. `auto-attack-race-duplicate`

When this effect appears on a permanent hazard event in `cardsInPlay`,
every automatic-attack of the specified `race` at the active company's
site must be faced a second time after all regular automatic-attacks
are resolved. The duplication uses the same modified prowess and strikes
(including all in-play modifiers) as the original attack.

Fields:

- `race: string` — lowercase race to match (e.g. `"undead"`). Matched
  against `normalizeCreatureRace(aa.creatureType)` for each auto-attack.

Implementation: `reducer-site.ts` `handleSiteAutomaticAttacks()`. After
all regular attacks are resolved, the handler scans every player's
`cardsInPlay` for this effect type, collects matching auto-attacks, and
processes them one per `pass` action (ordered by their original index).
The counter `duplicatesRun = automaticAttacksResolved - autoAttacks.length`
tracks how many race-based duplicates have been initiated; this count
grows naturally with `automaticAttacksResolved`. Race-based duplicates
are processed before any `auto-attack-duplicate` constraint (Incite Defenders).

Used by *The Moon Is Dead* (dm-71):

```json
{ "type": "auto-attack-race-duplicate", "race": "undead" }
```

### 35. `trigger-attack-on-play`

When present on a resource permanent event, the company immediately
faces an automatic attack of the given type after the card attaches to
its bearer character. The attack flows through the normal combat
sub-system. At combat finalization:

- If **all characters in the company are tapped**, the card is
  discarded from the bearer's items and the play has no lasting effect.
- If **any character remains untapped**, the bearer is tapped and
  gains a `bearer-cannot-untap` active constraint (scoped
  `until-cleared`). The constraint is swept when the item is stored
  via `store-item` during the organization phase.

Fields:

- `creatureType: string` — e.g. `"Spider"`. Normalised with
  `normalizeCreatureRace()` for combat-modifier lookups.
- `strikes: number` — number of strikes the attack delivers.
- `prowess: number` — prowess of each strike.

Implementation: `chain-reducer.ts` `resolvePermanentEvent()` detects
the effect and sets `state.combat` with an `attackSource` of type
`card-triggered-attack`. `reducer-combat.ts` `finalizeCombat()` handles the
discard-or-keep logic and adds the `bearer-cannot-untap` constraint.
`reducer-untap.ts` `performUntap()` skips characters with an active
`bearer-cannot-untap` constraint. `reducer-organization.ts`
`handleStoreItem()` sweeps matching constraints when the card is stored.

Used by *Rescue Prisoners* (tw-315):

```json
{ "type": "trigger-attack-on-play", "creatureType": "Spider", "strikes": 2, "prowess": 7 }
```

### 36. `force-return-to-origin`

Tags a hazard long-event (environment) whose resolution causes any moving
company satisfying the optional `condition` to return to its site of origin.

This tag is **consumed by the chain engine** (not an enforcement mechanism
itself): when an ally with `cancel-chain-return-to-origin` looks for valid
targets, it matches unresolved chain entries whose source card carries this
effect. The actual enforcement of the return is handled separately in the
order-effects resolution path (rule-5.31, currently `test.todo`).

Fields:

- `condition?: Condition` — evaluated against company site-path context
  (`sitePath.wildernessCount`, `sitePath.shadowCount`, `sitePath.darkCount`,
  etc.). If absent, always applies.
- `rangerException?: boolean` — if true, a company containing at least one
  ranger is exempt from returning.

Used by *Snowstorm* (tw-91), *Foul Fumes* (tw-36), *Long Winter* (le-117).

```json
{ "type": "force-return-to-origin",
  "condition": { "sitePath.wildernessCount": { "$gte": 1 } } }

{ "type": "force-return-to-origin",
  "condition": { "$or": [{ "sitePath.shadowCount": { "$gte": 1 } },
                         { "sitePath.darkCount": { "$gte": 1 } }] },
  "rangerException": true }
```

### 37. `cancel-chain-return-to-origin`

In-play ally ability: tap this ally during the M/H chain declaring window
to negate an unresolved chain entry that carries a `force-return-to-origin`
effect and would apply to the ally's company.

Only the resource (active) player may use this ability. Only untapped allies
qualify. One `cancel-return-to-origin` action is emitted per eligible (ally,
target entry) pair.

Fields:

- `cost: { tap: "self" }` — tapping the ally is the cost.

Implementation: `legal-actions/chain.ts` `cancelReturnToOriginChainActions()`
emits the legal actions. `chain-reducer.ts` `handleCancelReturnToOrigin()`
taps the ally, marks the chain entry as `negated: true`, and flips priority
to the opponent.

Used by *Goldberry* (tw-245).

```json
{ "type": "cancel-chain-return-to-origin", "cost": { "tap": "self" } }
```

### 38. `fetch-wizard-on-store`

Trigger: when a permanent event carrying this effect is stored at a Haven
during the organization phase, if the resource player's Wizard is **not**
already in play, a `wizard-search-on-store` pending resolution is enqueued.
The player may then search their play deck or discard pile for any Wizard and
play him at that Haven, free of the one-character-per-turn limit. The player
may also skip the search.

Fields: none.

Implementation:

- `reducer-organization.ts` `handleStoreItem()` detects the effect after
  clearing `bearer-cannot-untap` constraints and enqueues the resolution.
- `engine/legal-actions/pending.ts` `wizardSearchOnStoreActions()` emits one
  `play-wizard-from-search` action per eligible Wizard in the deck/discard
  plus a `skip-wizard-search` action.
- `engine/pending-reducers.ts` `applyWizardSearchOnStoreResolution()` handles
  both actions.

Used by *The Windlord Found Me* (dm-164).

```json
{ "type": "fetch-wizard-on-store" }
```

### 39. `extra-agent-actions`

Grants each agent an additional agent action per turn. Applied during the
Untap phase: when any player has a card with this effect in their
`cardsInPlay`, every agent's `remainingActions` is set to `1 + Σ(value)`
instead of the default 1.

Fields:

| Field   | Type   | Description                                |
|---------|--------|--------------------------------------------|
| `value` | number | Number of extra actions granted (usually 1)|

Implementation:

- `reducer-untap.ts` scans all players' `cardsInPlay` for `extra-agent-actions`
  effects and sums their `value` fields. Each agent's `remainingActions` is
  set to `1 + extraAgentActions` during the resource-player untap step.

Used by *Great Need or Purpose* (dm-62).

```json
{ "type": "extra-agent-actions", "value": 1 }
```

### 40. `agent-tap-attack`

An agent character taps itself (not as an agent action, not against the hazard
limit) during the opponent's M/H phase to attack the active company. Prowess
is computed before reveal (rule 9.06), exactly like `tap-agent-at-site`.

Fields:

| Field             | Type    | Description                                              |
|-------------------|---------|----------------------------------------------------------|
| `prowessBonus`    | number  | Added to the agent's base + face-down/home prowess.      |
| `attackerAssigns` | boolean | If true, attacker chooses defenders. Default: false.     |

Conditions:

- Agent must have been in play at turn start (`inPlayAtTurnStart`).
- Agent must not be wounded (`CardStatus.Inverted`).
- Agent must be at the active company's destination site (or current site if
  stationary).

Prowess modifiers applied before reveal:

- Face-down, not at home: base + 2
- Face-down, at home: base + 5
- Face-up, at home: base + 2
- Face-up, not at home: base + 0
- Then `prowessBonus` is added.

Implementation:

- Legal actions: `agentTapAttackActions()` in `legal-actions/movement-hazard.ts`.
- Reducer: `handleAgentTapAttack()` in `reducer-movement-hazard.ts`.

Used by *The Grimburgoth* (dm-15).

```json
{ "type": "agent-tap-attack", "prowessBonus": 2 }
```

### 41. `permanent-event-auto-attack`

While this hazard permanent event is in play, each site listed in `siteIds`
gains an additional automatic-attack with the given stats. This is the DSL
primitive for **Spawn-type** events that augment specific sites without using
the Dragon manifestation chain (`dragon-at-home` requires `lairOf` + `manifestId`).

The augmented attacks appear after all printed site attacks and any
`dragon-at-home` augmentations, but before the `play-site-auto-attack`
dynamic step.

| Field | Required | Description |
|-------|----------|-------------|
| `siteIds` | yes | Array of site definition IDs to augment (e.g. `["tw-413", "le-392"]`). |
| `attack.creatureType` | yes | Creature race label (e.g. `"Balrog"`, `"Spawn"`). |
| `attack.strikes` | yes | Number of strikes. |
| `attack.prowess` | yes | Prowess of each strike. |
| `attack.body` | no | Body value for body checks. Absent = no body check (e.g. Balrog of Moria `18/-`). |
| `attack.combatRules` | no | Array of combat-rule strings (e.g. `["attacker-chooses-defenders"]`). |
| `onDefeat` | no | `"remove-from-play"`: defeating this attack moves the card from play to the defeating player's kill pile (awarding kill MPs). Absent = card stays in play. |
| `discardAfterUse` | no | When `true`, after this auto-attack resolves (regardless of win or loss), the permanent event card is moved from the hazard player's `cardsInPlay` to their discard pile. No kill MPs are awarded. Used by Nazgûl permanent-events at Under-deeps sites ("discard after use — ignore result of defeat"). |

Implementation:

- `collectPermanentEventAttacks()` in `engine/manifestations.ts` scans all `cardsInPlay` for matching effects; called from `getActiveAutoAttacks()`.
- `finalizeCombat()` in `engine/reducer-combat.ts` handles `onDefeat: "remove-from-play"` after all strikes are defeated, and `discardAfterUse: true` (regardless of outcome) after all strikes resolve.
- The `body` and `combatRules` fields are propagated to `CombatState` via the updated auto-attack setup in `engine/reducer-site.ts`.

Used by *Balrog of Moria* (tw-12), *Monstrosity of Diverse Shape* (ba-21),
*Spawn of Ungoliant* (ba-24), *Ungoliant's Progeny* (ba-27), and
*Ungoliant's Foul Issue* (ba-28) for `onDefeat: "remove-from-play"`.

Used by *Witch-king of Angmar* (tw-113), *Khamûl the Easterling* (tw-47), and
*Adûnaphel* (tw-2) for `discardAfterUse: true`.

```json
{
  "type": "permanent-event-auto-attack",
  "siteIds": ["tw-413", "le-392"],
  "attack": { "creatureType": "Balrog", "strikes": 1, "prowess": 18 },
  "onDefeat": "remove-from-play"
}
```

```json
{
  "type": "permanent-event-auto-attack",
  "siteIds": ["dm-33", "dm-40", "dm-36"],
  "attack": { "creatureType": "Nazgûl", "strikes": 1, "prowess": 17, "body": 12 },
  "discardAfterUse": true
}
```

### 42. `deck-search-attack`

Used by hero resource short-events whose text reads "turn over cards
from your play deck one at a time until you reveal a non-special item
(not a unique item already in play) or reach the end, then the acting
character faces a single-strike attack."

When the card is played, `handlePlayResourceShortEvent` in
`engine/reducer-events.ts`:

1. Scans the acting player's `playDeck` for the first eligible item
   (non-special, non-duplicate unique).
2. Computes `strikeProwess = baseProwess + revealedCount`.
3. Sets `state.combat` to a `CombatState` with `attackSource.type:
   "lucky-search-attack"`, recording the scout's instance ID, the
   found item's instance ID (or `null`), and the revealed card IDs.
   Revealed cards remain in `playDeck` during combat so no instance
   ever disappears from state.

After combat resolves, `finalizeCombat` in `engine/reducer-combat.ts`
handles the `lucky-search-attack` source:

- If the scout was **not** wounded and an item was found, attaches the
  item to the scout's `items` list.
- If the scout was **wounded** and an item was found, moves the item to
  the player's `discardPile`.
- Reshuffles all non-item revealed cards (and any remaining deck cards)
  back into `playDeck` via `shuffle()`.

| Field | Required | Description |
|-------|----------|-------------|
| `baseProwess` | yes | Base prowess before the revealed-card bonus. |
| `strikes` | yes | Number of strikes (typically `1`). |
| `uncancelable` | yes | Whether the attack/strike can be canceled. |

```json
{
  "type": "deck-search-attack",
  "baseProwess": 3,
  "strikes": 1,
  "uncancelable": true
}
```

Used by Lucky Search (tw-269).

### 43. `take-prisoner`

Marks a hazard permanent-event as a **hazard host** (CoE rule 8.35).
Played during the `resolve-strike` combat window on a character facing
a matching attack. If the strike succeeds (creature wins), instead of
wounding the character:

1. The rescue site is drawn from the hazard player's location deck
   (first site matching `rescueSiteTypes`).
2. All non-ring items on the prisoner are discarded immediately.
3. Followers revert to general influence.
4. A `character-is-prisoner` active constraint is added to the prisoner.
5. A `HazardHost` record is created in `state.hazardHosts`.

Playability gate (checked in `combatHazardPermanentPlays`): the hazard
player must have at least one matching rescue site in their location
deck.

The card must also carry `play-window { phase: "combat", step:
"resolve-strike" }` and a `play-target` effect with a filter matching
the attack's race (e.g. `{ "attack.race": "Spider" }`).

| Field | Required | Description |
|-------|----------|-------------|
| `rescueSiteTypes` | yes | Array of site type strings (e.g. `["ruins-and-lairs"]`). |
| `rescueAttacks` | yes | Rescue-attack list (shape: `{ race, strikes, prowess }`). |
| `autoRescue` | no | Auto-rescue spec: `{ bodyCheckModifier, autoRescueThreshold }`. |

```json
{
  "type": "take-prisoner",
  "rescueSiteTypes": ["ruins-and-lairs"],
  "rescueAttacks": [{ "race": "Spider", "strikes": 3, "prowess": 9 }],
  "autoRescue": { "bodyCheckModifier": 1, "autoRescueThreshold": 15 }
}
```

Used by Flies and Spiders (dm-58).

---

### 44. `strike-shield`

Forces the carrier to receive at least one strike before any strike
may be assigned to its `controlling-character`. Enforced in
`assignStrikeActions` (defender phase) in `legal-actions/combat.ts`.

If `alwaysCountsAsUntapped` is true, the carrier is treated as untapped
for strike assignment even when tapped or wounded, ensuring the shield
is never bypassed by the ally's combat status.

| Field | Required | Description |
|-------|----------|-------------|
| `scope` | yes | `"controlling-character"` — the character controlling this ally. |
| `alwaysCountsAsUntapped` | no | When true, the carrier is always assignable regardless of status. |

```json
{
  "type": "strike-shield",
  "scope": "controlling-character",
  "alwaysCountsAsUntapped": true
}
```

Used by Noble Hound (dm-179).

---

### 45. `cancel-prisoner-taking`

When the bearer's controlling character would be taken prisoner, the
player may discard this card to cancel that prisoner-taking outcome.
The character is then resolved normally (wounded or tapped per combat
result). Does not protect other characters in the company.

| Field | Required | Description |
|-------|----------|-------------|
| `scope` | yes | `"controlling-character"` or `"company"`. |

```json
{
  "type": "cancel-prisoner-taking",
  "scope": "controlling-character"
}
```

Used by Noble Hound (dm-179).

### 46. `event-play-site`

Restricts a short-event resource card to companies whose current site
type matches one of the listed types. If the active company is not at
a matching site type during the site phase, the card cannot be played.

| Field | Required | Description |
|-------|----------|-------------|
| `siteTypes` | yes | Array of site-type strings. Allowed values: `"haven"`, `"free-hold"`, `"border-hold"`, `"ruins-and-lairs"`, `"shadow-hold"`, `"dark-hold"`. |

```json
{ "type": "event-play-site", "siteTypes": ["border-hold", "free-hold"] }
```

Used by Glamour of Surpassing Excellance (as-49).

### 47. `roll-remove-hazard-events`

When this short-event resource card is played at a matching site, the
engine enqueues one `glamour-hazard-roll` pending resolution per hazard
permanent-event attached to any character in the active company. For
each roll, the player rolls 2d6; if the result strictly exceeds the
hazard's `removalNumber` (or 8 if the field is absent), the hazard
permanent-event is discarded.

| Field | Required | Description |
|-------|----------|-------------|
| *(none)* | — | No additional fields. |

```json
{ "type": "roll-remove-hazard-events" }
```

Used by Glamour of Surpassing Excellance (as-49). The `removalNumber`
field on hazard permanent-event card data sets each hazard's threshold;
cards without this field default to 8.

### 48. `hazard-maintenance`

A hazard permanent-event that requires the hazard player to pay an upkeep
cost at the end of the resource player's long-event phase. When the
resource player passes the long-event phase, the engine scans all
`cardsInPlay` for `hazard-maintenance` effects and enqueues one
`hazard-event-maintenance` pending resolution per card found.

The hazard player resolves each pending resolution by choosing one of:

- **`discard-self`** — discard the permanent event from `cardsInPlay`.
- **`discard-from-hand`** — discard a hand card that matches `handCardFilter`.

If no matching hand card is available, only the `discard-self` option is offered.

| Field | Required | Description |
|-------|----------|-------------|
| `trigger` | yes | When this maintenance fires. Currently only `"opponent-long-event-end"`. |
| `handCardFilter` | yes | DSL condition evaluated against hand card definitions. Matching cards may be discarded as payment alternatives. |

```json
{
  "type": "hazard-maintenance",
  "trigger": "opponent-long-event-end",
  "handCardFilter": { "cardType": "hazard-creature", "race": "men" }
}
```

Used by Thrice Outnumbered (le-142).

### `on-event` — `actor` field

The `on-event` effect type supports an optional `actor` field that controls
which player(s) the event fires for. This is currently used for `end-of-turn`
events only.

| Value | Description |
|-------|-------------|
| `"both"` | The effect fires once per player — one pending effect per player is enqueued. |
| `"hazard"` | The effect fires only for the hazard (non-active) player. |
| `"resource"` | The effect fires only for the resource (active) player. |

When absent, the effect fires for the source card's owner only.

```json
{
  "type": "on-event",
  "event": "end-of-turn",
  "actor": "both",
  "apply": {
    "type": "move",
    "select": "target",
    "from": "discard",
    "to": "deck",
    "shuffleAfter": true,
    "filter": { "cardType": "hazard-creature", "race": "men" },
    "count": 1
  }
}
```

Used by Thrice Outnumbered (le-142) to let both players fetch a Man
hazard creature from their own discard pile at the end of each turn.

### 49. `duplicate-site-auto-attacks`

A hazard short-event effect that creates immediate M/H-phase combat attacks
mirroring every automatic-attack at the target company's destination site.
Used by Tidings of Bold Spies (le-143).

**Play restriction**: The card also declares `{ "type": "play-restriction", "rule": "only-at-site-with-auto-attack" }` in its effects array. The M/H legal-action emitter (`movement-hazard.ts`) reads this annotation and only offers the card when the destination site has at least one auto-attack (via `getActiveAutoAttacks`).

**Combat creation**: When the chain resolves, `chain-reducer.ts` finds the `duplicate-site-auto-attacks` effect, reads all auto-attacks from the destination site, creates `CombatState` for the first attack (using `attackSource: { type: 'tidings-attack', ... }`), and stores remaining attacks in a `tidings-attacks-queue` active constraint scoped to the company's M/H subphase. After each combat ends, `finalizeCombat` in `reducer-combat.ts` detects the constraint and initiates the next attack.

**Key property**: The attacks use `attackSource.type === 'tidings-attack'` — they are NOT `automatic-attack`. This means:

- Auto-attack modifiers (e.g. `auto-attack.prowess` attribute-modifiers) do NOT apply.
- The attacks do not trigger site-phase auto-attack flow.
- Kill-MP and on-defeat effects do not fire (no creature card exists to move).

| Field | Required | Description |
|-------|----------|-------------|
| *(none)* | — | All parameters are derived from the destination site at resolution time. |

```json
{
  "type": "duplicate-site-auto-attacks"
}
```

Used by Tidings of Bold Spies (le-143).

### 50. `ring-test-table`

Declares the roll-result → ring-category mapping for a gold-ring item (Rule 9.21).
When the gold ring is tested the engine rolls 2d6 + modifier, looks up the total in
this table, and computes the set of `eligibleCategories` for the `ring-play-offer`
pending resolution. Each row has an inclusive `min` and/or `max` bound; either may
be `null` meaning "no lower / upper bound" (`lesser-ring` is always eligible
regardless of total).

| Field | Required | Description |
|-------|----------|-------------|
| `table` | yes | Array of `{ category, min, max }` rows. |

`category` is one of: `lesser-ring`, `magic-ring`, `dwarven-ring`, `the-one-ring`, `spirit-ring`.

```json
{
  "type": "ring-test-table",
  "table": [
    { "category": "lesser-ring",  "min": null, "max": null },
    { "category": "magic-ring",   "min": 1,    "max": 5    },
    { "category": "dwarven-ring", "min": 8,    "max": null },
    { "category": "the-one-ring", "min": 10,   "max": null }
  ]
}
```

Used by Precious Gold Ring (tw-306), Beautiful Gold Ring (tw-196), Gleaming Gold Ring (le-311),
and The One Ring (le-315).

### 51. `ring-test-search`

Supplements a gold-ring card to offer a deck-search step after the ring test.
Used by Gleaming Gold Ring (le-311) which lets the player search the deck for a
`lesser-ring` card and immediately play it as the replacement (in addition to the
normal hand-play offer).

| Field | Required | Description |
|-------|----------|-------------|
| `category` | yes | The ring category to search for (`RingCategory`). |

```json
{ "type": "ring-test-search", "category": "lesser-ring" }
```

Used by Gleaming Gold Ring (le-311).

### 52. `hazard-limit-swap`

Marks a permanent hazard event as a bidirectional hazard-limit exchanger: the
card can be tapped to raise the hazard limit, and hazard limit slots can be
spent to untap it. Both directions are always present together because the two
abilities are inherently coupled (the same card oscillates between the tapped
and untapped states at a hazard-limit cost/gain).

| Field | Required | Description |
|-------|----------|-------------|
| `tapValue` | yes | Hazard limit slots added when the card is tapped. |
| `untapCost` | yes | Hazard limit slots consumed to untap the card. |

Tapping (`tap-hazard-card-for-limit` action) is offered when the card is
untapped; does **not** count against the hazard limit itself.
Untapping (`pay-hazard-limit-to-untap-card` action) is offered when the card
is tapped and the remaining hazard limit is ≥ `untapCost`; consumes `untapCost`
slots by incrementing `hazardsPlayedThisCompany`.

Pair with `play-flag: "no-auto-untap"` to prevent the card from being
automatically untapped during the controller's untap phase.

Implementation: `legal-actions/movement-hazard.ts` `tapHazardCardForLimitActions`;
`reducer-movement-hazard.ts` `handleTapHazardCardForLimit` /
`handlePayHazardLimitToUntapCard`.

Used by *Power Built by Waiting* (as-34):

```json
{ "type": "hazard-limit-swap", "tapValue": 1, "untapCost": 2 }
```

### 53. `company-overt`

Marks the bearing character's company as **overt** as long as this ally is in play.

Certain allies explicitly state "its controlling character's company is overt." When
`isCovertCompany` is evaluated for the bearer's company, the presence of this ally
overrides the race-based calculation and makes the company overt regardless of
character races.

No fields beyond `type`.

```json
{ "type": "company-overt" }
```

Used by: Regiment of Black Crows (as-76), Great Bats (as-74), Great Lord of
Goblin-gate (as-75), Last Child of Ungoliant (le-153).

---

### 54. `grant-skill`

Grants a named character skill to the item's bearer while the item is in play.
The bearer counts as having the skill for all purposes that read `target.skills`
in DSL filter conditions — play-target filters, sage+scout pair checks, etc.

**Natural vs. granted skills**: The cancel-strike ability on Magic Ring of Stealth
reads `bearer.skills.$includes.scout` in its `when` condition. That condition is
evaluated against the bearer's *natural* skills (from the character card definition),
not the granted skills. This correctly implements the card text "if the bearer is
*already* a scout."

| Field | Required | Description |
|-------|----------|-------------|
| `skill` | yes | The skill name to grant (e.g. `"scout"`, `"sage"`, `"warrior"`). |

```json
{ "type": "grant-skill", "skill": "scout" }
```

Used by Magic Ring of Stealth (tw-274).

---

### 55. `ringwraith-mode`

Marks a permanent-event resource card as a Ringwraith mode card (Black Rider,
Fell Rider, or Heralded Lord). When this card is in play bound to a Ringwraith
company (`CardInPlay.companyId`), the company may move to non-Darkhaven sites.
Without a mode card in play, a Ringwraith company is restricted to
Darkhaven-to-Darkhaven movement only (MELE §1.2).

This effect carries no additional data — its presence is the entire payload.
The engine reads it when computing legal movement actions.

| Field | Required | Description |
|-------|----------|-------------|
| (none) | — | Presence of the effect is the payload. |

```json
{ "type": "ringwraith-mode" }
```

Used by: Black Rider (le-170), Fell Rider (le-183), Heralded Lord (le-190).

---

### 56. `absorb-wound`

When a strike against the bearer succeeds (would wound), the wound is prevented.
Instead, combat transitions to a `'shield-discard-roll'` phase in which the
**attacking player** rolls 2d6. If the roll strictly exceeds `rollThreshold`,
the item is discarded from the bearer. If the roll does not exceed the threshold,
the item stays in play.

The bearer is still **tapped** (the strike "succeeded" against them), but they are
not wounded. The creature is **not** considered defeated — the result of the strike
assignment is recorded as `'absorbed'` rather than `'success'`, so `finalizeCombat`
does not route the creature to the kill pile or trigger a trophy offer.

| Field | Required | Description |
|-------|----------|-------------|
| `rollThreshold` | yes | Item is discarded if attacker's 2d6 roll **strictly exceeds** this value (e.g. `6` means "discard on 7–12"). |

```json
{ "type": "absorb-wound", "rollThreshold": 6 }
```

Used by *Sable Shield* (le-341): "If a strike against the bearer is successful, he
is not wounded. Instead, the attacker makes a roll—if this result is greater than 6,
discard Sable Shield."

Implemented in `engine/reducer-combat.ts` (`resolveStrike` absorb-wound detection,
`handleShieldDiscardRoll`) and `engine/legal-actions/combat.ts`
(`shieldDiscardRollActions` for the `'shield-discard-roll'` phase).

---

## Creature Keying — `keyedTo` extended fields

The `keyedTo` array on a hazard-creature card describes where the creature can be
played. Each entry is a `CreatureKeyRestriction` object; a creature is playable if
**any** entry matches. The following fields extend the base set (regionTypes,
regionNames, siteTypes, siteNames, when):

### `siteKeywords`

```json
{ "siteKeywords": ["under-deeps"] }
```

Matches when the destination site carries at least one of the listed keywords in its
`keywords` array. Evaluated in `findCreatureKeyingMatches` (movement-hazard.ts) and
`checkCreatureKeying` (reducer-movement-hazard.ts). Also checked in
`playSiteAutoAttackActions` (site.ts) when resolving dynamic auto-attack eligibility:
a creature keyed to `["under-deeps"]` is eligible as a dynamic auto-attack at any
under-deeps site regardless of its specific `siteType`.

Used by: *Nameless Thing* (dm-109) — "Playable at any Under-deeps site."

### `adjacentToSiteKeywords`

```json
{ "adjacentToSiteKeywords": ["under-deeps"], "when": { "inPlay": "Doors of Night" } }
```

Matches when the destination site is adjacent (in the under-deeps movement sense —
bidirectional via `adjacentSites`) to any site carrying one of the listed keywords.
Implemented using `isUnderDeepsAdjacent` against all matching sites in
`state.cardPool`. Typically gated by a `when` condition (e.g. Doors of Night) since
this is an alternate keying that only fires under specific circumstances.

The keying method recorded in `keyedBy.method` is `"adjacent-to-site-keyword"`.

Used by: *Nameless Thing* (dm-109) — "If Doors of Night is in play, also playable at
an adjacent site of any Under-deeps site."

### 38. `grant-keyword`

Grants a keyword tag to the item's bearer while the item/event is attached.

The bearer counts as having the named keyword for all purposes — e.g. the "Leader"
keyword makes the bearer subject to the one-leader-per-company rule (CoE 3.26) and
eligible for faction-influence bonuses gated on Leader status.

```json
{ "type": "grant-keyword", "keyword": "Leader" }
```

Fields:
- `keyword` — the keyword to grant (e.g. `"Leader"`).

Implemented in `engine/legal-actions/organization-companies.ts`
(`wouldViolateLeaderRestriction` now also checks attached items for this effect).

Used by: *By the Ringwraith's Word* (le-174).

### 39. `protect-from-body-check`

Protects the bearer from being eliminated by a failed body check. When a body check
roll would normally eliminate the bearer (`effectiveRoll > body`), the negative result
is suppressed and the bearer remains in play in their current status (typically
wounded/inverted after the strike).

No fields beyond `type`.

```json
{ "type": "protect-from-body-check" }
```

Implemented in `engine/reducer-combat.ts` (`handleBodyCheckRoll`): before the standard
elimination path, items on the target character are scanned for this effect; if found,
the result is recorded as `'wounded'` (the character already is wounded from the strike)
and the elimination is skipped.

Used by: *By the Ringwraith's Word* (le-174).

### `on-event: company-composition-changed` — items (resource events)

The `company-composition-changed` event fires against **items** (resource permanent
events attached to `character.items`) as well as hazards. When an item carries this
event with `apply: { type: "move", select: "self", from: "self-location", to: "discard" }`
and a `when` condition that evaluates to true, the item is discarded to the owner's
discard pile.

The context passed to the condition includes:

- `company.characterCount` — number of characters in the company.
- `company.hasHigherMindThanBearer` — `true` when any other character in the bearer's
  company has a non-null `mind` value strictly greater than the bearer's own non-null
  `mind`. Both sides must have numeric minds; null-mind avatars do not participate.

Implemented in `engine/reducer-utils.ts` (`sweepAutoDiscardResourceEvents`), called
after any company composition change (merge, split, character play) and after permanent
event resolution.

```json
{
  "type": "on-event",
  "event": "company-composition-changed",
  "apply": { "type": "move", "select": "self", "from": "self-location", "to": "discard" },
  "when": { "company.hasHigherMindThanBearer": true }
}
```

Used by: *By the Ringwraith's Word* (le-174).
