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

### 2. `check-modifier`

Modifies a roll for a specific check type.

Check types: `corruption`, `influence`.

```json
{ "type": "check-modifier", "check": "corruption", "value": 1 }
{ "type": "check-modifier", "check": "influence", "value": 1,
  "when": { "bearer.race": "dunadan" } }
```

The `influence` check type is used on faction cards for standard modifications.
The resolver context includes `bearer` (influencing character) and `faction`
(faction being influenced) fields.

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

```json
{ "type": "grant-action", "action": "test-gold-ring",
  "cost": { "tap": "self" },
  "when": { "company.hasItem": { "subtype": "gold-ring" } } }
{ "type": "grant-action", "action": "remove-self-on-roll",
  "cost": { "tap": "bearer" }, "rollThreshold": 8 }
{ "type": "grant-action", "action": "gwaihir-special-movement",
  "cost": { "discard": "self" } }
```

### 8. `on-event`

Triggered effect that fires when a game event occurs.

```json
{ "type": "on-event", "event": "character-wounded-by-self",
  "apply": { "type": "force-check", "check": "corruption", "modifier": -2 },
  "target": "wounded-character" }
```

Events:

- `character-wounded-by-self` -- fires when a strike wounds a character, forcing a corruption check (implemented for automatic attacks in `reducer-combat.ts` and `reducer-site.ts`, and for creature attacks in `reducer-combat.ts` and `reducer-movement-hazard.ts`)
- `self-enters-play` -- fires when this card enters play. Used by environment permanent events to discard opposing cards (implemented in reducer play handlers)

Apply types:

- `force-check` -- force a check roll on the target
- `discard-cards-in-play` -- discard all cards in play that match the `filter` condition (evaluated against card definitions)

### 9. `cancel-strike`

Pay a cost to cancel an incoming strike, with optional exclusions.

```json
{ "type": "cancel-strike",
  "cost": { "check": "corruption", "modifier": -2 },
  "when": { "$not": { "$or": [
    { "enemy.race": "undead" }, { "enemy.race": "nazgul" }
  ] } } }
```

### 10. `combat-rule`

Overrides a combat mechanic.

```json
{ "type": "combat-rule", "rule": "attacker-chooses-defenders" }
```

### 11. `play-restriction`

Constrains when or where a card can enter play.

```json
{ "type": "play-restriction", "rule": "home-site-only",
  "when": { "$not": { "reason": "starting-character" } } }
```

### 12. `duplication-limit`

Caps how many copies of this card can be in a given scope.

```json
{ "type": "duplication-limit", "scope": "character", "max": 1 }
```

### 13. `play-target`

Declares what this card targets when played. The engine uses this to
generate per-target actions (one per eligible character, company, etc.).

```json
{ "type": "play-target", "target": "character" }
```

Supported targets:

- `character` — targets a single character in the company

### 14. `on-guard-reveal`

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

### 15. `fetch-to-deck`

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

### 16. `site-rule`

Declares a site-specific rule that modifies standard game mechanics
when a company is at this site.

```json
{ "type": "site-rule", "rule": "healing-affects-all" }
```

Rules:

- `healing-affects-all` — wounded characters at this site heal during untap
  as if the site were a haven

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

### Cave-drake

```json
"effects": [
  { "type": "combat-rule", "rule": "attacker-chooses-defenders" }
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
