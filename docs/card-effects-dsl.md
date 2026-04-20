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

Stats: `prowess`, `body`, `direct-influence`, `corruption-points`, `strikes`.

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
(faction being influenced) fields.

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

Applies a stat modifier to every character in the bearer's company.

```json
{ "type": "company-modifier", "stat": "corruption-points", "value": 1 }
```

### 5. `enemy-modifier`

Modifies the enemy's stats during combat. The resolver collects
`enemy-modifier` effects from the defending character and their items,
evaluates conditions against the combat context (including `enemy.race`),
and applies operations to the enemy's stat.

Operations: `halve-round-up` — divide by 2, round up.

```json
{ "type": "enemy-modifier", "stat": "body", "op": "halve-round-up",
  "when": { "reason": "combat", "enemy.race": "nazgul" } }
```

### 6. `hand-size-modifier`

Modifies the player's hand size.

```json
{ "type": "hand-size-modifier", "value": 1,
  "when": { "self.location": "Rivendell" } }
```

### 6b. `draw-modifier`

Modifies the number of cards drawn during the movement/hazard draw step
for the bearer's company. The `draw` field selects which pool to modify
(`hazard` or `resource`), and `min` sets a floor (default 0).

```json
{ "type": "draw-modifier", "draw": "hazard", "value": -1, "min": 0 }
```

### 7. `grant-action`

Gives the card bearer a new activated ability. For roll-based actions,
`rollThreshold` specifies the minimum 2d6 total for success.

Actions:

- `test-gold-ring` — tap to test a gold ring; rolls 2d6, discards gold ring
  (implemented in `reducer-organization.ts`)
- `remove-self-on-roll` — tap bearer, roll 2d6, discard this card on
  success (implemented in `reducer-organization.ts`)
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
  end-of-turn phase to take one spell card (keyword `"spell"`) from
  the discard pile to hand. Only available to the resource player
  during the discard step (implemented in `legal-actions/end-of-turn.ts`,
  `reducer-end-of-turn.ts`)
- `cancel-return-and-site-tap` — tap bearer (ranger) during
  organization to add a turn-scoped constraint cancelling hazard
  effects that force return to site of origin or tap the company's
  site. Bearer makes a corruption check (implemented in
  `reducer-organization.ts`)

```json
{ "type": "grant-action", "action": "test-gold-ring",
  "cost": { "tap": "self" },
  "when": { "company.hasItem": { "subtype": "gold-ring" } } }
{ "type": "grant-action", "action": "remove-self-on-roll",
  "cost": { "tap": "bearer" }, "rollThreshold": 8 }
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
- `untap-phase-end` -- fires once per applicable card during the Untap → Organization transition. The reducer (`reducer-untap.ts`) scans every character of the active player for attached cards (items / hazards / allies) carrying this on-event and enqueues a `corruption-check` pending resolution per match. An optional `when` condition is evaluated against the bearer context `{ bearer: { siteType, atHaven } }`, so cards that only fire at a haven (e.g. *Lure of the Senses*) express that as `"when": { "bearer.atHaven": true }`. Used by *Lure of the Senses* (at-haven only) and *The Least of Gold Rings* (any site).
- `attack-not-defeated` -- fires after combat finalization when the creature's attack was not fully defeated (i.e. not all strikes were won by the defenders). The reducer (`reducer-combat.ts`) checks the creature card for this event and applies its constraint. Used by *Little Snuffler*.
- `company-arrives-at-site` -- fires when a hazard short-event resolves against a company in M/H. The handler (`applyShortEventArrivalTrigger` in `chain-reducer.ts`) iterates every `add-constraint` effect on the card with this event, evaluates the optional `when` against the arrival context, and applies the first matching one. This allows a single card to declare multiple mutually-exclusive modes (e.g. *Choking Shadows*). The arrival context exposes `company.destinationSiteType`, `company.destinationSiteName`, `company.destinationRegionType`, `environment.doorsOfNightInPlay`, and the standard `inPlay` card-name list.
- `end-of-company-mh` -- fires when a company's movement/hazard sub-phase ends (both players pass). For each character with an attached hazard carrying this event, enqueues one `corruption-check` pending resolution per region traversed in the site path. The `perRegion: true` flag on the effect enables the per-region behavior. Used by *Alone and Unadvised*. Implemented in `reducer-movement-hazard.ts`.
- `company-composition-changed` -- fires against every attached hazard whenever a company's character roster changes (play-character, move-to-company, merge-companies, auto-merge at end of MH). The sweeper evaluates the effect's `when` against the bearer's company context and applies `discard-self` when the condition is met. Used by *Alone and Unadvised* (discards when company has 4+ characters). Implemented in `reducer-utils.ts` `sweepAutoDiscardHazards()`.
- `bearer-company-moves` -- fires when the company containing the bearer completes movement (M/H step 8). For each character in the moving company, the reducer scans attached items for this event and applies the `discard-self` action, moving the card to the owner's discard pile. Used by *Align Palantír*. Implemented in `reducer-movement-hazard.ts`.

Apply types:

- `force-check` -- force a check roll on the target. The dispatcher enqueues a {@link PendingResolution} of kind `corruption-check`; the resolver in `engine/pending-reducers.ts` runs the dice roll and applies the standard discard / eliminate consequences when the check fails.
- `discard-cards-in-play` -- discard all cards in play that match the `filter` condition (evaluated against card definitions).
- `discard-non-special-items` -- discard all non-special items (subtype ≠ `"special"`) from the wounded character. Items are moved to the defending player's discard pile. Implemented in `reducer-combat.ts` for the `character-wounded-by-self` event.
- `add-constraint` -- add an {@link ActiveConstraint} of the named kind to the target. Reserves the entry's `constraint` field for the kind name (e.g. `"site-phase-do-nothing"`, `"site-phase-do-nothing-unless-ranger-taps"`, `"no-creature-hazards-on-company"`, `"deny-scout-resources"`, `"auto-attack-prowess-boost"`, `"auto-attack-duplicate"`, `"site-type-override"`, `"region-type-override"`, `"skip-automatic-attacks"`) and the `scope` field for the auto-clear boundary (e.g. `"company-site-phase"`, `"company-mh-phase"`, `"turn"`, `"until-cleared"`). Constraint-kind-specific fields include `value` + `siteType` for `auto-attack-prowess-boost`, `overrideType` for `site-type-override` (the site is the active company's current site during site phase, or the destination during M/H phase), and `overrideType` + `regionName` for `region-type-override` (use the token `"destination"` as the region name to target the destination region of the active company). The `skip-automatic-attacks` constraint removes all automatic attacks from the bound site (resolved from the active company's current site during site phase). The constraint filter in `legal-actions/pending.ts` rewrites legal actions for the affected target while the constraint lives.
- `discard-self` -- discard the card carrying this effect (typically an ally or attached hazard) from its bearer to the owning player's discard pile. Used with `company-arrives-at-site` + a `when` condition on `site.region` to enforce region-based restrictions (e.g. Treebeard), and with `company-composition-changed` + a `when` condition on `company.characterCount` to discard on company size (e.g. Alone and Unadvised). Implemented in `reducer-movement-hazard.ts` `fireAllyArrivalEffects()` and `reducer-utils.ts` `sweepAutoDiscardHazards()`.

### Pending resolutions

The engine carries two top-level lists alongside `phaseState`:

- **`pendingResolutions`** -- discrete pieces of work the engine has queued for a player to resolve before continuing (corruption checks, on-guard reveal windows, opponent-influence defensive rolls, etc.). The first entry whose `actor` matches the player computing legal actions collapses the menu to "resolve the top entry." Drains FIFO per actor; auto-swept at the matching scope boundary.
- **`activeConstraints`** -- scoped restrictions on the legal-action menu of some target (company / character / player). Filters but never blocks. Cross-player constraints are supported (e.g. *Stealth* — placed by the resource player, filtering the hazard player's plays).

Both lists are owned by `engine/pending.ts`; reducers and on-event handlers must go through the helpers (`enqueueResolution`, `addConstraint`, `sweepExpired`, etc.) rather than touching the lists directly.

### 9. `cancel-attack`

Cancels an entire attack against a company. Only playable during combat
before strikes are assigned. The card is played from hand and discarded.

When `cost` and `requiredSkill` are present, requires tapping a character
with the named skill (e.g. Concealment — tap a scout). When `cost` and
`requiredRace` are present, requires a character of that race in the
company — one action is generated per qualifying character. If the cost
is a corruption check (`"check": "corruption"`), the character need not
be untapped (e.g. Vanishment — wizard makes corruption check -2). When
both `requiredSkill` and `requiredRace` are absent, the card is simply
played with no additional cost (e.g. Dark Quarrels — cancel one attack
by Orcs, Trolls, or Men).

A `when` condition filters which attacks qualify (evaluated against
the combat context including `enemy.race`).

```json
{ "type": "cancel-attack",
  "cost": { "tap": "character" },
  "requiredSkill": "scout" }
{ "type": "cancel-attack",
  "requiredRace": "wizard",
  "cost": { "check": "corruption", "modifier": -2 } }
{ "type": "cancel-attack",
  "when": { "enemy.race": { "$in": ["orc", "troll", "men", "man"] } } }
```

### 9a. `cancel-influence`

Automatically cancels an opponent's influence check against one of the
player's characters, followers, factions, allies, or items. Played from
hand during the opponent's site phase while an `opponent-influence-defend`
resolution is pending. The card is discarded after use.

When `requiredRace` is present, requires a character of that race under
the player's control. The `cost` is typically a corruption check with a
modifier that the cost-paying character must make after the cancellation.

```json
{ "type": "cancel-influence",
  "requiredRace": "wizard",
  "cost": { "check": "corruption", "modifier": -2 } }
```

### 9b. `halve-strikes`

Halves the number of strikes in the current attack (rounded up). Played
from hand as a short event during combat before strikes are assigned;
the card is discarded after use.

A `when` condition gates availability (e.g. requires a specific card
in play).

```json
{ "type": "halve-strikes",
  "when": { "inPlay": "Gates of Morning" } }
```

### 10. `dodge-strike`

Played from hand during strike resolution. The target character resolves
the strike at full prowess without tapping (unless wounded by the strike).
If wounded, a body penalty applies to the resulting body check.

```json
{ "type": "dodge-strike", "bodyPenalty": -1 }
```

The `bodyPenalty` modifies the character's body for the body check only
(negative values reduce body, making elimination more likely).

### 11. `cancel-strike`

Pay a cost to cancel an incoming strike, with optional exclusions.

When `target` is absent or `"self"`, the bearer cancels their own strike
(e.g. The One Ring). When `target` is `"other-in-company"`, the character
taps to cancel a strike against another character in the same company
(e.g. Fatty Bolger). A `filter` condition selects which characters
qualify as valid protection targets.

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

```json
{ "type": "duplication-limit", "scope": "character", "max": 1 }
```

### 15. `play-target`

Declares what this card targets when played. The engine uses this to
generate per-target actions (one per eligible character, company, etc.).

Character targeting is driven entirely by the DSL: the coarse `target`
category picks the scope (each character in scope is a candidate) and
an optional `filter` {@link Condition} refines it further. The filter
is evaluated against the per-candidate context
`{ target: { race, status, skills, name, inAvatarCompany, itemKeywords }, company: { skills } }`, so there are no
card-specific target keywords in the engine — a card declares its
audience directly via a condition expression.

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
  plays scope to the active company's characters.
- `company` — the active company (e.g. Lost in Free-domains).
- `site` — the company's destination/current site (e.g. River).

Optional fields:

- `filter` — DSL condition restricting which candidates qualify. When
  absent every candidate in scope qualifies.
- `maxCompanySize` — maximum effective company size for eligibility
  (hobbits count as half). Used alongside the filter to enforce size
  limits (e.g. Stealth).
- `cost` — cost paid by the targeted character. Currently only
  `{ "tap": "character" }` is supported, which taps the chosen character
  when the card is played (e.g. Stealth taps the targeted scout). When a
  cost is present the engine emits one `play-short-event` action per
  eligible target, each carrying a `targetScoutInstanceId` so the reducer
  knows whom to tap.

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

### 17. `fetch-to-deck`

Fetches a card from one or more source piles into the play deck and shuffles.
Used by resource short events like Smoke Rings.

```json
{ "type": "fetch-to-deck",
  "source": ["sideboard", "discard-pile"],
  "filter": { "cardType": { "$in": ["hero-character", "hero-resource-item",
    "hero-resource-ally", "hero-resource-faction", "hero-resource-event"] } },
  "count": 1,
  "shuffle": true }
```

Sources: `sideboard`, `discard-pile`.

The `filter` is a standard DSL condition evaluated against each card definition.

### 18. `discard-in-play`

Forces the compulsory discard of an in-play card matching a filter.
The target is chosen at play time: the legal-action emitter produces
one `play-short-event` action per eligible discard target (cross-product
with any `play-target` tap target), and the reducer resolves the
discard inline — there is no separate sub-flow. If no valid target
exists, the card is not playable. Optionally enqueues a corruption
check on the tapped character after resolution.

```json
{ "type": "discard-in-play",
  "filter": {
    "$and": [
      { "cardType": "hazard-event" },
      { "eventType": { "$in": ["permanent", "long"] } },
      { "$not": { "keywords": { "$includes": "environment" } } }
    ]
  },
  "corruptionCheck": { "modifier": -2 } }
```

The `filter` is a standard DSL condition evaluated against each card
definition in play (both players' `cardsInPlay`). The chosen target is
carried on the action's `discardTargetInstanceId` field. The optional
`corruptionCheck.modifier` is applied to the tapped character's
corruption check after the discard resolves.

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

Declares that an item can be stored at specific named sites during the
Organization phase. Storing moves the item from the character to the
player's stored-items pile, where it earns marshalling points safely.
After storage the initial bearer makes a corruption check.

When `marshallingPoints` is present, the stored item uses that value
instead of the card's base MP. Implemented in
`legal-actions/organization-companies.ts` (legal action),
`reducer-organization.ts` (handler), and `recompute-derived.ts` (MP).

```json
{ "type": "storable-at", "sites": ["Minas Tirith"], "marshallingPoints": 2 }
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

### 23. `play-condition`

Gates playability on a game-state condition. The `requires` field names
the context source.

Requires:

- `site-path` — the company's resolved site path during M/H. The
  condition is evaluated against
  `{ sitePath: { wildernessCount, shadowCount, darkCount, coastalCount, freeCount, borderCount } }`.

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

### 24. `creature-race-choice`

Requires the player to choose a creature race when playing the card.
The `exclude` array lists races that may not be chosen. The legal-action
emitter produces one `play-hazard` action per eligible race, each
carrying the chosen race on `chosenCreatureRace`. The `apply` clause
describes the constraint added for the chosen race.

```json
{ "type": "creature-race-choice",
  "exclude": ["nazgul", "undead", "dragon"],
  "apply": {
    "type": "add-constraint",
    "constraint": "creature-type-no-hazard-limit",
    "scope": "company-mh-phase"
  } }
```

Implemented in `legal-actions/movement-hazard.ts` (action generation),
`reducer-movement-hazard.ts` (constraint creation).

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

### 27. `reshuffle-self-from-hand`

The card returns from the player's hand to their play deck, which is
then reshuffled. "Show opponent" — the action is public via the game log.
Used by Sudden Call (le-235) as a safety valve for when the endgame
conditions never materialize.

```json
{ "type": "reshuffle-self-from-hand" }
```

Triggered by the `reshuffle-card-from-hand` action, not by short-event
play resolution. Implemented in `reducer-end-of-turn.ts`
(`reshuffleCardFromHand`).

## Resolver Architecture

The engine calls a resolver at each decision point:

```text
resolve(context, stat) → final value
```

The context carries everything relevant to the current calculation:

- `reason` — what is being calculated (`"combat"`, `"faction-influence-check"`, `"corruption-check"`, etc.)
- `bearer` / `character` — the character involved
- `enemy` — the creature or hazard (in combat)
- `faction` — the faction (in influence checks)
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
  { "type": "dodge-strike", "bodyPenalty": -1 }
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
    "when": { "target.status": "inverted" },
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
`target.status`, `target.skills`, `inPlay`), and an `apply` clause
resolved by the generic reducer.

The `when` context includes `inPlay` — an array of all card names
currently in play — so conditions like `{ "inPlay": "Gates of Morning" }`
work.

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
  { "type": "bounce-hazard-events",
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

### 29. `bounce-hazard-events`

Returns all hazard permanent-event cards attached to characters in the
targeted wizard's company to the opponent's hand, then enqueues a
corruption check on the wizard. The target wizard is determined by the
`play-target` effect (filter `target.race: wizard`).

```json
{ "type": "bounce-hazard-events",
  "corruptionCheck": { "modifier": -2 } }
```

Implemented in `reducer-events.ts` (`handlePlayResourceShortEvent`).

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
