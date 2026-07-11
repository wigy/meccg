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
{ "lairOf": { "$exists": false } }
```

Operators: `$includes`, `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in`,
`$exists`, `$noConsecutiveOtherThan`, plus the boolean combinators `$and`,
`$or`, `$not`. `$exists` is a presence test: `{ "$exists": true }` matches
when the value is present (not `undefined`/`null`), `{ "$exists": false }`
when it is absent — used to gate on optional card-definition fields (e.g. a
site filter excluding Dragon's lairs via `{ "lairOf": { "$exists": false } }`
and Under-deeps via `{ "adjacentSites": { "$exists": false } }`).

A missing `when` means the effect always applies.

## Keywords

Keywords are string tags on a card's `keywords` array. They drive classification and rule enforcement without dedicated boolean flags.

Character-specific keywords:

- `"leader"`, `"uruk-hai"`, `"olog-hai"` — minion character subgroupings used in condition filters (e.g. faction influence bonuses gated on `"leader"`).
- `"balrog-specific"` — carried by minion characters whose text reads "Balrog specific" (CoE 1.3.4/1.3.B4-5: the card is specific to the Balrog avatar). Exposed as `target.keywords` in the `influence-check` resolver context (`availableDI` in `legal-actions/organization.ts`) so a bonus like `{ "when": { "reason": "influence-check", "target.keywords": { "$includes": "balrog-specific" } } }` can target them the same way `target.race` does. Used by Bûthrakaur (ba-5): "+3 direct influence against Balrog specific characters."
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

Stats: `prowess`, `body`, `direct-influence`, `corruption-points`, `strikes`, `general-influence`, `mind`.

The `mind` stat modifies a character's effective mind — the influence cost
of controlling that character. It is resolved in `recompute-derived.ts` and
consumed as the character's general-influence cost (`generalInfluenceUsed`).
The resolver context exposes `bearer.baseMind` (the printed mind; absent for
avatars), so "halving" effects can be expressed as a value expression. Example
— Awaiting the Call (le-165) halves the bearer's mind, rounded down:

```json
{ "type": "stat-modifier", "stat": "mind",
  "value": "floor(bearer.baseMind / 2) - bearer.baseMind" }
```

Used by the troll triplets (as-1/as-5/as-6, `value: -1`) and Awaiting the
Call (le-165).

The `general-influence` stat is a player-level modifier (not per-character). It is collected
during `recomputeDerived` from **both** an item / attached permanent-event on a character
(Bade to Rule le-167 on the Ringwraith, Great Shadow ba-62 on the Balrog) **and** a bare
stage permanent-event sitting in the player's `cardsInPlay` (Truths of Doom wh-108).
`PlayerState.generalInfluenceBonus` is incremented by `value`; effective GI pool =
`GENERAL_INFLUENCE (20) + generalInfluenceBonus` (for a Fallen-wizard, the avatar's
white-hand number replaces the 20). Example: Bade to Rule (le-167) grants +5 GI to the
Ringwraith player while attached to the Ringwraith.

An optional `controlLimit` caps how many of the added `value` points may be used to
**control characters**. The excess (`value - controlLimit`) is accumulated into
`PlayerState.generalInfluenceControlPenalty`: it still counts toward the player's full pool
(and thus toward *unused* general influence for defensive hazard subtraction) but is
excluded from the character-control budget, which is
`generalInfluenceControlLimit = effectiveGeneralInfluence - generalInfluenceControlPenalty`
(the value every character-play / follower-to-GI gate uses). This mirrors the Ringwraith /
Balrog +5 bonus that "cannot be used to control characters" (CoE 1.12.R1 / 1.12.B1).
Example — Truths of Doom (wh-108): "+6 general influence; you may only use 2 of these 6
points to control characters":

```json
{ "type": "stat-modifier", "stat": "general-influence", "value": 6, "controlLimit": 2 }
```

The `strikes` stat is used with `target: "all-attacks"` to modify the number
of strikes on creature and automatic attacks (e.g. Wake of War), or with
`target: "all-automatic-attacks"` to modify strikes on site automatic-attacks
only — not hazard creatures (e.g. Redoubled Force's +3 strikes to Orc/Troll
automatic-attacks). Both `prowess` and `strikes` honour `all-automatic-attacks`.

The optional `op` field controls how `value` combines with the running stat
total: `"add"` (the default) does `result += value`, while `"multiply"` does
`result *= value`. All multiplicative modifiers are applied **after** every
additive one, so a "doubled"-style effect acts on the already-modified total.
Example — Plague of Wights (le-130) doubles the strikes of each Undead attack
when Doors of Night is in play:

```json
{ "type": "stat-modifier", "stat": "strikes", "op": "multiply", "value": 2,
  "target": "all-attacks",
  "when": { "$and": [ { "enemy.race": "undead" }, { "inPlay": "Doors of Night" } ] } }
```

Optional `target` scopes:

- `"all-characters"` — applies to every character in play. The per-character
  effective-stats `when` context exposes `bearer.atOrMovingUnderDeeps` (true when
  the character's company is at, moving to, or moving from an Under-deeps site —
  its `currentSite`/`destinationSite` carries the `under-deeps` keyword; the
  `currentSite` stays the origin for the whole M/H phase so it covers "moving
  from" too). Used by *The Sun Shone Fiercely* (ba-25): "-1 prowess to all Orc,
  Troll, Dwarf, and Ringwraith characters **not** at, nor moving to or from, an
  Under-deeps site (-2 if Doors of Night is not in play)" — a base -2 prowess
  `{ "target": "all-characters", "when": { "$and": [ { "target.race": { "$in": ["orc","troll","dwarf","ringwraith"] } }, { "bearer.atOrMovingUnderDeeps": { "$ne": true } } ] } }`
  plus a +1 softening gated on `{ "inPlay": "Doors of Night" }` (net -1 with DoN).
- `"own-characters"` — applies to every character controlled by the **player
  who controls the card carrying this effect** (collected per-player in
  `recompute-derived.ts` and filtered in `collectGlobalEffects` by the target
  character's controller). Unlike `"all-characters"`, the opponent's matching
  characters are unaffected. The per-character `when` context exposes
  `target.keywords` (e.g. `"half-orc"`), since Half-orcs have race `"orc"`.
  Used by *A Strident Spawn* (wh-61): "Each of your Half-orcs requires one less
  point of influence to control" —
  `{ "stat": "mind", "value": -1, "target": "own-characters", "when": { "target.keywords": { "$includes": "half-orc" } } }`.
- `"all-attacks"` — applies to every automatic-attack and hazard creature
- `"all-automatic-attacks"` — applies only to site automatic-attacks (not hazard creatures)
- `"company-others"` — applies to every **other** character in the bearer's
  company, excluding the bearer itself. Collected in `collectCharacterEffects`
  by scanning the attached hazards/items of every *other* company member; the
  effect's `when` is evaluated against the **modified** character's context
  (`bearer.*`), and the effective-stats context exposes `bearer.isFollower`
  (true when the character is under another's direct influence). Used by *So
  You've Come Back* (le-138): "the mind of each **other** non-follower,
  non-Ringwraith, non-Wizard character in his company increases by one" —
  `{ "stat": "mind", "value": 1, "target": "company-others", "when": { "$and": [ { "bearer.race": { "$ne": "wizard" } }, { "bearer.race": { "$ne": "ringwraith" } }, { "bearer.isFollower": { "$ne": true } } ] } }`.
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
{ "type": "check-modifier", "check": "corruption", "value": 1,
  "target": "company" }
```

An optional `"target": "company"` broadens the modifier from the bearer alone
to **every character in the bearer's company**. It is collected once per company
(from items / attached permanent-events on any company member) and folded into
each member's check by `resolveCheckModifier`, mirroring the company-scoped
`stat-modifier`. Used by I'll Be At Your Heels (le-195): "+1 to all corruption
checks by characters in his company." (Without `target`, the default scope is
the bearer only.)

The `influence` check type is used on faction cards for standard modifications.
The resolver context includes `bearer` (influencing character), `faction`
(faction being influenced, with `name`, `race`, `playableAt` — the flattened
array of site names from the faction's `playableAt` entries, enabling conditions
like `{ "faction.playableAt": "Variag Camp" }` — and `playableRegions` — the
geographic regions in which the faction can be played, resolved from each named
`playableAt` site's `region` plus explicit `region:` entries, enabling conditions
like `{ "faction.playableRegions": { "$includes": "Lamedon" } }`, e.g. Firiel
(dm-10) "+2 direct influence against … factions that can be played in Anfalas,
Anórien, Belfalas, Lamedon, and Lebennin"), and `controller`
(`inPlay` — names of the controller's `cardsInPlay`; `factionRaces`; and
`wizard` — the name of the controller's Wizard avatar in play). `controller.wizard`
backs "Standard Modifications: if <Wizard> is your Wizard (+N)" — e.g. Wild Hounds
(wh-40) `{ "type": "check-modifier", "check": "influence", "value": 3, "when": { "controller.wizard": "Radagast" } }`.
The avatar is a company character, not a `cardsInPlay` entry, so it is reached via
`controller.wizard`, not `controller.inPlay`.

A faction/ally `playableAt` entry may itself carry a `when` clause matched by
`siteMatchesEntry`. Its context exposes `site.name`, `site.siteType`,
`site.region` (the named region), `site.autoAttack.race`, and — for the faction
paths — `site.regionType` (the site's **region type**, folded in from the
separate region card). This lets a faction gate on "Ruins & Lairs [{R}] in a
Wilderness [{w}]" (Wild Hounds wh-40):
`"playableAt": [ { "siteType": "ruins-and-lairs", "when": { "site.regionType": "wilderness" } } ]`.

A `playableAt` entry may also be an **any-site** entry — `{ "any": true, "when": … }`
— matching every site subject only to its `when` condition. Use it when "such a
site" is not a single site type: A Panoply of Wings (wh-37) is playable at "any
non-Haven, non-Shadow-hold, non-Dark-hold site in a Wilderness [{w}]":
`"playableAt": [ { "any": true, "when": { "$and": [ { "$not": { "site.siteType": { "$in": ["haven", "shadow-hold", "dark-hold"] } } }, { "site.regionType": "wilderness" } ] } } ]`.

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

A **player-scoped, non-consumed** influence `check-modifier` may be added as an
active constraint via an `on-event: self-enters-play` → `add-constraint` apply
carrying `"target": "player"` (in addition to `constraint: "check-modifier"`,
`check: "influence"`, `value`, and `scope`). Unlike the one-shot
character-targeted influence constraint (Muster), a player-targeted one applies
to **every** influence attempt by any character of that player for the
constraint's scope and is never consumed — read by both the faction
influence-attempt display (`legal-actions/site.ts`) and the roll resolver
(`reducer-site.ts`). Used by Terror Heralds Doom (ba-78): "+2 to all influence
attempts this turn by any of your characters."

```json
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "add-constraint", "constraint": "check-modifier",
             "check": "influence", "value": 2, "scope": "turn", "target": "player" } }
```

### 2a. `body-check-modifier`

Modifies the 2d6 **body-check** roll made against the bearer during combat
(CoE rule 2.V.2.2). A body check is rolled inside combat resolution — not
through the influence/corruption scoring pipeline — so it is a separate effect
type from `check-modifier`. The `value` is added to the effective body-check
roll; a negative value protects the bearer by lowering the roll (making it less
likely to exceed the bearer's body and eliminate them).

```json
{ "type": "body-check-modifier", "value": -1 }
```

Collected from items attached to the character being body-checked, in
`reducer-combat.ts` (`bodyCheckRollModifier`). Applies in both the
hazard/automatic-attack body check and the CvCC body check (whether the bearer
is attacking or defending). An optional `when` is evaluated against
`{ bearer: { race } }`. Used by *Helm of Fear* (as-126): "All body checks
against the bearer are modified by -1."

An optional `scope: "all-attacks"` makes the modifier **global** instead of
item-bound: it is carried by an in-play permanent-event (either player's
`cardsInPlay`) and applies to **every** combat body check, gated by `when`
against a context exposing `attack.creatureRace` (the attacking creature's
normalized race, e.g. `"spider"`) and `target.race` (the body-checked
character's race). Collected by `globalBodyCheckRollModifier` in
`combat-actions.ts`.

```json
{
  "type": "body-check-modifier",
  "value": 1,
  "scope": "all-attacks",
  "when": {
    "$and": [
      { "attack.creatureRace": "spider" },
      { "target.race": { "$in": ["elf", "dwarf", "hobbit", "dunadan", "man"] } }
    ]
  }
}
```

Used by *Spawn of Ungoliant* (ba-24): "+1 to all body checks for Elves,
Dwarves, Hobbits, Dúnedain, and Men resulting from Spider attacks."

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
  `site.type`, `region.type`, `auto-attack.detainment` (extend as cards
  require).
- `op: 'add' | 'override'` — `add` sums; `override` replaces.
- `value: number | string` — number for `add`; the encoded value
  (SiteType, RegionType, etc.) for `override`.
- `filter?: Condition` — optional per-read gate evaluated against a
  context exposing the entity under inspection
  (`{ site: { type, definitionId }, region: { name, type } }`).

The card-data JSON keeps the legacy constraint names
(`auto-attack-prowess-boost`, `site-type-override`,
`region-type-override`, `auto-attacks-detainment`) — `buildConstraintKind`
translates them into `attribute-modifier` so existing card definitions did
not need to change during the migration.

The `site.type` `override` is honored everywhere a site's effective type is
read via `engine/effective.ts::getEffectiveSiteType`: detainment keying and
movement keying, faction/ally playability (`siteMatchesEntry`), and the
haven/untap check. So a card that overrides a Ruins & Lairs to a Shadow-hold
(Hold Rebuilt and Repaired, as-88) genuinely makes the site behave as a
Shadow-hold for those systems.

The `auto-attack.detainment` `override` (value truthy, filter
`site.definitionId`) forces **every** automatic-attack at that site to be
detainment, for any defending alignment — consulted via
`engine/effective.ts::siteAutoAttacksForcedDetainment` and OR-ed into the
detainment decision at each site automatic-attack call site. The card data
declares it under the constraint name `auto-attacks-detainment` (resolved to
the bound site from the active company's current site during the site phase).
Used by Hold Rebuilt and Repaired (as-88: "all automatic-attacks become
detainment").

### 3. `mp-modifier`

Modifies marshalling points conditionally.

```json
{ "type": "mp-modifier", "value": -3, "when": { "reason": "elimination" } }
```

### 3aa. `mp-in-pile`

Grants a flat marshalling-point value while the carrying card sits in a player's
marshalling-point (kill) pile. Some hazard events place *themselves* into a
marshalling-point pile and score marshalling points from there (rather than as a
stored item or a defeated creature). The value is scored in the killPile loop of
`recompute-derived.ts`, in the declared `category`, for whichever player's pile
holds the card.

```json
{ "type": "mp-in-pile", "category": "item", "value": 2 }
```

Used by Neither so Ancient Nor so Potent (dm-73): after returning an opponent's
stored item to hand, the card is placed in the opponent's marshalling-point pile
where "It gives 2 item marshalling points."

### 3ab. `displace-stored-item`

Resolution effect for a hazard played on an opponent's stored item (paired with a
`play-target` `target: "stored-item"`, which offers one `play-hazard` per stored
item in the opponent's marshalling-point pile during the M/H play-hazards step).
On resolution the engine (`resolveDisplaceStoredItem` in `chain-reducer.ts`):

1. removes the targeted stored item from whichever marshalling-point pile holds
   it and returns it to that pile-owner's hand (`returnItemTo: "owner-hand"`),
   discarding any cards attached to the item; and
2. places the resolving card itself into that same owner's marshalling-point pile
   (`selfTo: "owner-mp-pile"`), where an accompanying `mp-in-pile` effect scores
   its marshalling points.

No instance is lost: the stored item moves killPile → hand and the resolving card
moves chain → killPile. "Owner" is the stored item's owner — i.e. the opponent of
the hazard player.

```json
{ "type": "displace-stored-item", "returnItemTo": "owner-hand", "selfTo": "owner-mp-pile" }
```

Used by Neither so Ancient Nor so Potent (dm-73): "Return item to opponent's hand
(discarding all attached cards). Place this card in opponent's marshalling point
pile."

### 3b. `fw-item-mp-full`

Fallen-wizard item marshalling-point exemption (MEWH §4 exception). MEWH §4
normally clamps every non-stage card a Fallen-wizard controls to a flat **1**
marshalling point. A Fallen-wizard avatar may carry this effect to exempt a
subset of the player's items from that clamp, so they score their full printed
MP instead. The `filter` is matched against each item's card definition (via
`matchesDefinition`); every item the Fallen-wizard player controls — on any
character — that matches scores its printed MP while the card carrying this
effect is in play. Items that do not match remain clamped to 1. Collected once
per player from the player's in-play characters **and** `cardsInPlay` and
consumed in `recompute-derived.ts` (`addItemMP`'s `fwItemMpExempt` path).

The optional `inAvatarCompany: true` restricts the exemption to items borne by
characters in the same company as the player's revealed avatar ("your … items in
Alatar's company"); omit it for a player-wide exemption.

Used by Saruman (wh-9): "Your non-weapon/non-armor/non-shield/non-helmet items
are each worth full marshalling points." (player-wide). Join the Hunt (wh-93)
uses the company-restricted form for its weapon/armor/shield/helmet items.

```json
{ "type": "fw-item-mp-full",
  "filter": { "$not": { "$or": [
    { "keywords": { "$includes": "weapon" } },
    { "keywords": { "$includes": "armor" } },
    { "keywords": { "$includes": "shield" } },
    { "keywords": { "$includes": "helmet" } } ] } } }
```

### 3b-ii. `fw-ally-mp-full`

Fallen-wizard **ally** marshalling-point exemption (MEWH §4 exception). Like
`fw-item-mp-full` but for allies: each ally matching `filter` scores its **full
printed** MP instead of the §4 flat-1 clamp (distinct from `fw-character-ally-mp`,
which pins a fixed value). The optional `inAvatarCompany: true` restricts the
exemption to allies borne by characters in the player's avatar company. Collected
per player from in-play characters and `cardsInPlay` and consumed in
`recompute-derived.ts` (`addMP`'s `fwFullMp` path); full-MP takes precedence over
any `fw-character-ally-mp` cap and never applies to stage cards or non-Fallen-wizards.

Used by Join the Hunt (wh-93): "Your allies with a prowess attribute in Alatar's
company are each worth full marshalling points." Oromë's Warders (wh-94) reuses
the same effect player-wide (no `inAvatarCompany`).

```json
{ "type": "fw-ally-mp-full",
  "filter": { "prowess": { "$exists": true } },
  "inAvatarCompany": true }
```

### 3c. `fw-character-ally-mp`

Fallen-wizard character/ally marshalling-point floor (MEWH §4 exception). MEWH §4
clamps every non-stage card a Fallen-wizard controls to a flat **1** marshalling
point. A stage permanent-event may carry this effect so the player's
**characters and allies** whose *printed* MP is at least `threshold` each score
`value` MP instead of the clamped 1. Cards printed below the threshold keep their
normal value (1 under the §4 clamp). Only characters and allies are affected —
factions, items, and other cards in play keep the §4 clamp. Collected per player
from in-play cards and consumed in `recompute-derived.ts` (`addMP`'s
`fwCharAllyCaps` path; the override never applies to stage cards or to
non-Fallen-wizard players).

Used by Great Patron (wh-72): "Your characters and allies that normally give 2 or
more marshalling points are each worth 2 marshalling points." Both `threshold`
and `value` are 2.

```json
{ "type": "fw-character-ally-mp", "threshold": 2, "value": 2 }
```

### 3d. `fw-kill-mp-full`

Fallen-wizard kill marshalling-point exemption (MEWH §4 exception). MEWH §4 clamps
every creature a Fallen-wizard's companies defeat to a flat **1** kill MP. A
character carrying this effect exempts the player: defeated hazard creatures score
their *full* printed kill MP instead. In addition, a defeated **detainment**
creature — which normally awards 0 kill MP because it is discarded rather than
routed to the kill pile (CoE §3.II.3) — is instead placed in the defending
player's kill pile and scores full kill MP too (the "even with \*" clause; `*`
marks a detainment attack). Both consequences are player-wide ("your companies"),
not limited to the carrier's company. Collected from the player's in-play
characters (`playerHasKillMpExemption` in `reducer-utils.ts`) and consumed in both
`recompute-derived.ts` (kill-MP tally) and `combat-finalize.ts` (detainment
disposition). Only Fallen-wizard players are ever subject to the §4 clamp.

Used by Alatar (wh-1): "Hazards your companies defeat (even with \*) are worth full
kill marshalling points."

```json
{ "type": "fw-kill-mp-full" }
```

### 3e. `detainment-attacks-normal`

Converts every detainment attack against the carrier's player's companies into a
normal attack (CoE §3.II — a detainment attack taps rather than wounds, suppresses
the body check, and awards no kill MP; a normal attack does none of those). While
a character carrying this effect is in play and the player's `stagePoints` total
is strictly greater than `stagePointsAbove` (default 0), any attack the engine
would otherwise treat as detainment — whether from a `combat-detainment` effect, a
site-forced detainment rule, or the alignment-based §3.II keying rules — resolves
as a normal attack instead. Computed per defending player via
`playerConvertsDetainmentToNormal` (`reducer-utils.ts`) and threaded into
`isDetainmentAttack` as `defenderForcesNormalAttacks`, which short-circuits the
whole detainment computation to `false` at every combat-initiation call site.

Used by Alatar (wh-1): "If you have more than 7 stage points, all detainment
attacks against your companies attack normally instead." Here `stagePointsAbove`
is 7.

```json
{ "type": "detainment-attacks-normal", "stagePointsAbove": 7 }
```

### 3a. `stage-points`

Contributes Fallen-wizard **stage points** (MEWH) to the player controlling the
card. Place on a stage resource permanent-event. The controller's running total
is derived in `recompute-derived.ts` by summing this effect across the player's
in-play cards (`PlayerState.stagePoints`), so it stays a single source of truth
rather than a mutable counter. A negative `value` reduces the total. Always 0 for
non-Fallen-wizard players (who never hold stage cards).

```json
{ "type": "stage-points", "value": 3 }
```

The optional `whileCompanyAtSite: true` flag marks a **site** whose stage points
are granted only while one of the Fallen-wizard's companies occupies it (rather
than from being in play). Those points are tallied separately in
`recompute-derived.ts` — once per distinct occupied `currentSite` instance, so two
companies at the same site do not double it, while two different occupied sites
each count. Used by Deep Mines (wh-55): "You receive the three stage points if any
of your companies are at the site."

```json
{ "type": "stage-points", "value": 3, "whileCompanyAtSite": true }
```

### 3c. `faction-mp-override`

Re-values the controlling player's factions while the carrying card is in play
(MEWH Fallen-wizard cards). Carried by a stage resource permanent-event **or by a
character** (Pallando wh-7). Each faction the player controls is scored against
the ordered `rules`: every rule's `when` condition is evaluated against the
per-faction context
`{ faction: { unique, race, normalMp, name }, player: { avatar } }`
(`faction.normalMp` is the faction's printed MP; `player.avatar` is the name of
the controller's revealed avatar, e.g. `"Alatar"`). The **last** matching rule
sets the faction's MP, so order entries from least to most specific. A faction
matching no rule scores normally. The override value replaces both the printed
MP and the Fallen-wizard §4 flat-1 clamp. Collected from the player's in-play
cards **and in-play characters** and consumed in `recompute-derived.ts`.

Used by Gatherer of Loyalties (wh-70): "Your unique factions are each worth 2
marshalling points. If you are Alatar, your unique Dragon factions are each
worth 4 marshalling points. If you are Pallando, your unique factions normally
worth 3 or more marshalling points are each worth 3 marshalling points." Also by
Pallando (wh-7), carried as a character: "Your Man, Dwarf, Elf, Dúnadan, Hobbit,
Orc, and Troll factions are each worth 2 marshalling points."

```json
{ "type": "faction-mp-override",
  "rules": [
    { "when": { "faction.unique": true }, "value": 2 },
    { "when": { "faction.unique": true, "faction.race": "dragon", "player.avatar": "Alatar" }, "value": 4 },
    { "when": { "faction.unique": true, "faction.normalMp": { "$gte": 3 }, "player.avatar": "Pallando" }, "value": 3 }
  ] }
```

### 3d. `permanent-event-mp`

Overrides the marshalling-point value of the controller's in-play
**permanent-events that require a site where a resource category is playable**.
A permanent-event "requires a site where X is playable" iff it carries a
`play-condition` with `requires: 'site-has-resource'` and `subtype: X` (the same
prerequisite the legal-action layer reports as "requires a site where X is
playable"). While the card carrying this effect is in play, every such
permanent-event the player controls scores exactly `value` marshalling points in
its own category, overriding its printed value and — for a Fallen-wizard — the
MEWH §4 flat-1-MP clamp. Collected once per player from `cardsInPlay` and
consumed in `recompute-derived.ts` (`permanentEventMpOverride`).

Used by Man of Skill (wh-119): "Your permanent-events that require a site where
Information is playable are each worth 2 marshalling points."

```json
{ "type": "permanent-event-mp", "value": 2, "requiresResource": "information" }
```

### 4. `company-modifier`

Applies a stat or check modifier to every character in the company the
permanent event was played on. Use `stat` for prowess/body/direct-influence/
corruption-points modifiers, or `check` for check roll modifiers (e.g.
corruption checks).

An optional `when` condition is evaluated at check time against a context
that includes `company.hasTrollLeader` (`true` when any character in the
bound company has race `"troll"` and the `"leader"` keyword) and
`company.characterCount` (number of characters in the company).

```json
{ "type": "company-modifier", "stat": "corruption-points", "value": 1 }
{ "type": "company-modifier", "check": "corruption", "value": 1 }
{ "type": "company-modifier", "check": "corruption", "value": 1, "when": { "company.hasTrollLeader": true } }
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

`stat: "body"` also applies in company-versus-company combat: when the
attacking character's own items carry a matching `enemy-modifier` (gated on
`bearer.skills`, evaluated against the *attacker*), the reduction lowers the
*defending* character's body-check target — the CvCC mirror of a weapon
reducing a hazard creature's body. Implemented in `combat-actions.ts`
(`handleBodyCheckRoll`, `bodyCheckTarget === 'character'` branch, gated on
`combat.isCvCC` and `strike.attackingCharacterId`). Used by Ancient Black Axe
(as-122): "Warrior only: ... -1 to strike's body."

```json
{ "type": "enemy-modifier", "stat": "body", "op": "subtract", "value": 1,
  "when": { "bearer.skills": { "$includes": "warrior" } } }
```

### 6. `hand-size-modifier`

Modifies the player's hand size. Evaluated by `resolveHandSize`, which builds a
per-character context exposing `self.location` (the bearer's current site name)
and `self.atDarkhaven` (`true` when the bearer's current site is a dark-side
haven — a `minion-site` or `balrog-site` with `siteType: "haven"`). Use
`self.location` for a named-site gate (e.g. Elrond at Rivendell) and
`self.atDarkhaven` for the generic "at a Darkhaven" gate (e.g. Hoarmûrath le-53).

```json
{ "type": "hand-size-modifier", "value": 1,
  "when": { "self.location": "Rivendell" } }
```

```json
{ "type": "hand-size-modifier", "value": 1,
  "when": { "self.atDarkhaven": true } }
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
`borderCount`, and `regionCount` — the total number of regions in the
path) derived from the moving company's resolved site path, plus the
top-level `movementType` (`starter`/`region`/`special`/`under-deeps`) —
used by Radagast for "+1 resource draw per Wilderness in the site
path".

Draw-modifiers are collected from **both** a moving company's characters
(items/hazards included) **and** the active (moving) player's own in-play
events/environments in `cardsInPlay`. This lets a resource long-event that
is not carried by any character contribute a draw bonus to every one of
that player's moving companies. Collecting only from the *active* player's
`cardsInPlay` means a long-event lingering across the opponent's turn never
affects the opponent's draws.

```json
{ "type": "draw-modifier", "draw": "hazard", "value": -1, "min": 0 }
{ "type": "draw-modifier", "draw": "resource",
  "value": "sitePath.wildernessCount", "min": 0 }
```

A Short Rest (td-95) is a resource long-event: "Each moving company may
draw an extra card for each region less than four in its site path." It
draws `4 - regionCount` extra resource cards, gated on an actual region
site path — the CRF 22 ruling excludes under-deeps and special movement,
which resolve to an empty path:

```json
{ "type": "draw-modifier", "draw": "resource",
  "value": "4 - sitePath.regionCount", "min": 0,
  "when": { "$and": [
    { "movementType": { "$in": ["region", "starter"] } },
    { "sitePath.regionCount": { "$gt": 0 } },
    { "sitePath.regionCount": { "$lt": 4 } }
  ] } }
```

### 6c. `draw-cards`

Carried by a resource short-event. On play, draws `count` cards from the
top of the playing player's play deck into their hand (stopping early if
the deck runs out — no card disappears). When `removeFromGame` is true,
the spent event card is placed in the player's out-of-play pile instead
of the discard pile, so it can never be recurred. Resolved directly in
`handlePlayResourceShortEvent` (`reducer-events.ts`).

```json
{ "type": "draw-cards", "count": 3, "removeFromGame": true }
```

Used by Dark Tryst (as-80): "Draw three cards and remove this card from
the game."

### 6d. `reshuffle-from-discard`

Carried by a resource short-event. On play, walks each affected player's
discard pile, removes every card whose definition matches `filter`, and
shuffles those cards into that player's play deck. `scope` selects whose
piles are processed: `"all-players"` (default) affects every player,
`"self"` only the playing player. The `filter` is a DSL `Condition`
matched against each candidate card's definition. No card instance is
lost — matched cards move from discard to deck, the rest stay in discard,
and the spent event card lands in the playing player's discard pile.
Resolved directly in `handlePlayResourceShortEvent` (`reducer-events.ts`).

```json
{ "type": "reshuffle-from-discard", "scope": "all-players",
  "filter": { "cardType": { "$in": ["hero-resource-faction", "minion-resource-faction"] } } }
```

Used by Horns, Horns, Horns (dm-140): "Each player removes all factions
from his discard pile and shuffles them into his play deck."

### 6e. `force-opponent-discard`

Hazard short-event effect that forces the card-player's **opponent** (the
resource/active player, in a hazard-play context) to discard one card of a
named category — chosen by the opponent — or, if none is available, reveal
their hand. Resolved when the event resolves on the chain
(`chain-reducer.ts`).

- `match` — the card-category matcher:
  - `"ring"` — any card carrying the `ring` keyword **or** the `gold-ring`
    subtype (the MECCG definition of a ring).
  - `"any"` — any card (used when the discard **count**, not the category,
    matters). Only the `"hand"` source is supported for `"any"`.
- `sources` — where candidate cards are gathered from: `"hand"` (the
  opponent's hand) and/or `"carried"` (cards held by the opponent's in-play
  characters, i.e. "from one of his companies").
- `fallbackRevealHand` — when true and no candidate exists in any source, the
  opponent's current hand identities are revealed to the card-player instead
  (recorded in `GameState.revealedInstances`).
- `count` — how many cards the opponent must discard. Absent = one card (the
  `"ring"` case). A `{ "countCardsInPlay": { "keyword": "<kw>" } }` descriptor
  makes the number equal to the count of cards in play (across both players)
  whose definition carries that keyword. This dynamic count is evaluated at
  **declaration time** — the moment the source permanent event is tapped to
  become the short-event (`handleTapAltPermanentEvent`), while the source card is
  still in play, so "including this one" falls out naturally — and threaded to
  the chain resolution via `ChainEntryPayload.forcedDiscardCount`. This matches
  the CRF ruling that "the number of cards discarded is set at the time of
  declaration".

When at least one candidate exists, a `force-discard-card` pending resolution
is enqueued (actor = the opponent). For the `"ring"` case they pick exactly one
of the pre-computed candidates. For the `"any"` case the resolution is
`anyFromHand` with `remaining = count` (capped by hand size): the opponent
discards one card at a time — any current hand card is a candidate, recomputed
as the hand shrinks — until `remaining` reaches 0 or the hand empties. Each
chosen card is moved from wherever it sits — hand or a character's items — to
the opponent's discard pile (`applyForceDiscardCardResolution`).

```json
{ "type": "force-opponent-discard", "match": "ring",
  "sources": ["hand", "carried"], "fallbackRevealHand": true }
```

```json
{ "type": "force-opponent-discard", "match": "any", "sources": ["hand"],
  "count": { "countCardsInPlay": { "keyword": "Nazgûl" } } }
```

Used by Rolled down to the Sea (wh-29): "Opponent must discard a ring from
his hand or from one of his companies if available. If no rings are available
as such, he must reveal his hand to you."

Used by Khamûl the Easterling (tw-47): when its permanent-event mode is tapped it
"becomes a short-event and forces opponent to discard one card of his choice for
every Nazgûl permanent-event in play (including this one) at the time of
declaration." (See §56c for the dual creature/permanent-event tap machinery.)

### 6f. `cycle-hand`

Carried by a (hazard) short-event. When the event resolves on the chain, the
**playing player** (`entry.declaredBy` — the hazard player, for a hazard event)
cycles their own hand:

1. If `revealHand` is set, their hand identities are revealed to the opponent
   (recorded in `GameState.revealedInstances`).
2. The hand is partitioned: cards whose definition matches `keepInHand` stay in
   hand; the rest are **set aside**.
3. If `drawToHandSize` is true (default), cards are drawn from the top of the
   play deck until the hand reaches the player's effective hand size (stopping
   early if the deck runs out — no card disappears).
4. The set-aside cards are placed face-down on top of the play deck. When two or
   more were set aside, an `arrange-deck-top` pending resolution lets the player
   choose their order ("in any order you choose"), picking one card at a time
   top-first via the `arrange-deck-top-card` action.

The set-aside cards are physically on top of the deck between steps 3 and 4 (the
ordering resolution only permutes them), so no card instance ever floats outside
a pile. The resolution is independent of the chain (like
`force-opponent-discard`): the chain entry is still marked resolved, and the
player resolves the ordering afterward while the opponent waits.

Resolved in `chain-reducer.ts` (`applyCycleHand`); the ordering resolution lives
in `legal-actions/pending.ts` (`arrangeDeckTopActions`) and `pending-reducers.ts`
(`applyArrangeDeckTopResolution`).

```json
{ "type": "cycle-hand", "revealHand": true,
  "keepInHand": { "cardType": { "$in": ["hazard-creature", "hazard-event"] } },
  "drawToHandSize": true, "setAsideTo": "deck-top" }
```

Used by Revealed to all Watchers (dm-85): "Reveal your hand to opponent. Place
all non-hazard cards from your hand off to the side. Draw cards from your play
deck until your hand size is reached. Place the non-hazard cards from off to the
side face down on top of your play deck in any order you choose." Here
`keepInHand` matches the hazard card types, so the *non-hazard* cards are the
ones set aside.

### 6g. `reveal-choose-shuffle`

Carried by a resource short-event. When the event is played (after any
`play-target` tap cost is paid), the **playing player** digs the top of their
play deck:

1. The top `min(count, deckSize)` cards are revealed to the opponent (recorded
   in `GameState.revealedInstances`). They remain physically on top of the play
   deck the whole time, so no instance ever floats.
2. When at least one card is revealed, a `reveal-choose-to-hand` pending
   resolution is enqueued (actor = the playing player). The choice is
   **mandatory**: the player picks one revealed card via a `choose-revealed-card`
   action; it moves to their hand and the remaining play deck is shuffled
   (folding the un-chosen revealed cards back in — "shuffle the remaining ones
   into your play deck"). If the deck is empty nothing is revealed and the event
   simply fizzles.

The event card itself is discarded on play (before the choice resolves). The
resolution lives in `legal-actions/pending.ts` (`revealChooseToHandActions`) and
`pending-reducers.ts` (`applyRevealChooseToHandResolution`); the reveal +
enqueue is in `reducer-events.ts` (`handlePlayResourceShortEvent`).

```json
{ "type": "reveal-choose-shuffle", "count": 8 }
```

Used by Eyes of Mandos (dm-126): "Playable on Pallando during the organization
phase. Tap Pallando and reveal up to 8 cards from the top of your play deck.
Choose one to put into your hand and shuffle the remaining ones into your play
deck." The "playable on Pallando during the organization phase" and "tap
Pallando" clauses are modeled by a `play-window` (`phase: organization`) plus a
`play-target` (`target: character`, `filter: { "target.name": "Pallando" }`,
`cost: { tap: character }`).

### 6h. `reveal-remove-from-discard`

Carried by a **hazard** short-event. When the event resolves un-negated on the
chain, the card-player peeks at a random slice of the **opponent's** discard
pile and may remove one non-unique card from the game:

1. `count` cards are drawn **at random** from the opponent's discard pile (via
   the seeded RNG, so replays stay deterministic) and revealed to the card-player
   (recorded in `GameState.revealedInstances`). If the pile holds fewer than
   `count` cards, all of them are revealed; an empty pile makes the event fizzle.
2. A card is **removable** only if it is non-unique. Per the French errata,
   **sites are treated as unique** (never removable). When at least one revealed
   card is removable, a `reveal-remove-from-discard` pending resolution is
   enqueued (actor = the card-player).
3. The card-player picks one removable card via a `remove-revealed-card` action —
   moving it from the opponent's discard pile to their **out-of-play pile**
   (removed from the game) — or declines with `pass` ("You may choose…"). The
   un-chosen revealed cards stay in the discard pile ("Opponent discards the
   other three").

Like the other discard-pick resolutions the pending resolution is independent of
the chain (the entry is still marked resolved). The resolution lives in
`legal-actions/pending.ts` (`revealRemoveFromDiscardActions`) and
`pending-reducers.ts` (`applyRevealRemoveFromDiscardResolution`); the reveal +
enqueue is in `chain-reducer.ts` (`resolveEntry`).

```json
{ "type": "reveal-remove-from-discard", "count": 4 }
```

Used by Aware of their Ways (dm-46): "Opponent reveals four cards at random from
his discard pile. You may choose a non-unique one and remove it from play.
Opponent discards the other three."

### 6i. `reveal-deck-choose-penalty`

Carried by a **hazard** short-event. When the event resolves un-negated on the
chain, the card-player peeks at the **top** cards of the **opponent's** play
deck and forces the opponent to pay one of two penalties:

1. The reveal count equals the number of cards in play (either player's
   `cardsInPlay`) whose definition matches `countInPlayMatching`. For ba-16 this
   is Spawn cards (`{ "keywords": { "$includes": "spawn" } }`); "eliminated spawn
   do not count" falls out for free — an eliminated card is no longer in
   `cardsInPlay`. The count is capped by the deck length; a zero count (or empty
   deck) makes the reveal fizzle.
2. The top N cards are revealed (recorded in `GameState.revealedInstances`) and a
   `desire-belly-choose-card` pending resolution is enqueued (actor = the
   card-player). The card-player **must** choose one revealed card via a
   `desire-choose-shown-card` action to show to the opponent (no pass).
3. A `desire-belly-choose-penalty` resolution is then enqueued (actor = the
   opponent), who **must** choose (`desire-choose-penalty`) one of:
   - `remove-from-game` — the shown card is moved to the opponent's out-of-play
     pile; the other revealed cards are shuffled back on top of the deck.
   - `reduce-hand-size` — an `until-cleared` player-scoped `hand-size-modifier`
     of `-1` is added to the opponent (permanent, "for the rest of the game");
     **all** revealed cards (including the shown one) are shuffled back on top.
4. In either case the rest of the deck below the revealed cards is left
   untouched, and the event card itself is **removed from the game** (its own
   discard → out-of-play pile) as part of the resolution.

The resolutions live in `legal-actions/pending.ts`
(`desireBellyChooseCardActions` / `desireBellyChoosePenaltyActions`) and
`pending-reducers.ts` (`applyDesireBellyChooseCardResolution` /
`applyDesireBellyChoosePenaltyResolution`); the reveal + first enqueue is in
`chain-reducer.ts` (`resolveEntry`). The "discard a Spawn card to play" cost is a
separate `play-discard-cost` effect (see §6h family / dm-57).

```json
{ "type": "reveal-deck-choose-penalty", "countInPlayMatching": { "keywords": { "$includes": "spawn" } } }
```

Used by Desire All for Thy Belly (ba-16): "Reveal to yourself a number of cards
from the top of opponent's play deck equal to the number of Spawn cards in play.
Eliminated spawn do not count. Choose one card and show it to your opponent. He
must choose to either: remove the card from the game or decrease the number of
cards he may hold in his hand by one for the rest of the game. Shuffle and
replace all remaining cards back on top of his play deck. Remove this card from
the game." (Paired with `play-discard-cost` for "discard a Spawn card from your
hand.")

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
- `sitePhase: true` — the **active** player may activate this ability
  during their own site phase (play-resources step). Used by *Vile Fumes*'
  `transform-site` feature.
- `freeCouncil: true` — either player may activate during the Free
  Council corruption-checks step. Used by *Magical Harp*.
- `activeSitePhase: true` — the active (resource) player may activate
  this ability during the *enter-or-skip* step of their own site phase
  — the decision window immediately before a company commits to facing
  a site's automatic-attacks. Used by *Blasting Fire* (wh-51), discarded
  here to cancel the site's automatic-attacks against the bearer's
  company.

Multiple flags may coexist on the same effect.

**`endOfTurnOnly: true` — restrictive, not additive.** Unlike the flags
above (which *extend* an ability's natural-phase availability), this flag
*removes* the ability from the generic per-phase scanner's organization-phase
default scan entirely (`extractGrantActions` in `legal-actions/organization.ts`
excludes any effect with `endOfTurnOnly: true`, mirroring how it already
excludes `corruptionCheckWindow` effects). The ability is instead emitted
only by the dedicated end-of-turn discard-pile fetch scanner
(`legal-actions/end-of-turn.ts` `endOfTurnGrantActions`), which recognizes
two apply shapes:

- discard-to-hand: `move` with `select: 'target'`, `from: 'discard'`,
  `to: 'hand'` (e.g. Saruman's spell fetch) — one activation per matching
  discard-pile card, since the target is chosen at activation time.
- discard-to-deck: `enqueue-pending-fetch` with `fetchFrom: ['discard-pile']`
  and `fetchTo: 'deck'` (or omitted, since `'deck'` is the default) — a
  single activation whenever at least one card matches, since the specific
  card is chosen afterward via a `fetch-from-pile` pending resolution.

Used by *Great Shadow* (ba-62): "During your end-of-turn phase, you may take
one non-short-event resource or character from your discard pile ... and
shuffle it into your play deck." Contrast with *The Mouth* (le-24)'s
structurally identical `recall-to-deck` ability (same action name, same
`enqueue-pending-fetch` apply), which is organization-phase-only and does
NOT set `endOfTurnOnly`.

```json
{ "type": "grant-action", "action": "recall-to-deck",
  "cost": { "tap": "bearer" }, "endOfTurnOnly": true,
  "apply": { "type": "enqueue-pending-fetch",
    "fetchFrom": ["discard-pile"], "fetchCount": 1, "fetchShuffle": true,
    "fetchTo": "deck",
    "filter": { "$and": [
      { "cardType": { "$in": ["minion-character", "minion-resource-item"] } },
      { "eventType": { "$ne": "short" } } ] } } }
```

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
- `indur-fetch-magic` — tap Indûr the Ringwraith (le-54) at the
  beginning of his end-of-turn phase to take one **magic card** from the
  discard pile to hand. The "magic card" filter is an `$or` over the
  keywords `"spell"`, `"sorcery"`, `"spirit-magic"`, and `"shadow-magic"`
  (every magic/spell card carries one). Gated by the grant-action's
  `when: { "bearer.isRevealedAvatar": true }` so the ability applies only
  while Indûr is the player's own revealed Ringwraith avatar — when he is
  played as a *Ringwraith follower* of another avatar (`controlledBy` set
  to that avatar) the fetch is not offered ("As your Ringwraith"). The
  end-of-turn fetch scanner (`legal-actions/end-of-turn.ts`) now evaluates
  the grant-action's `when` gate via the shared grant-action context,
  which exposes `bearer.isRevealedAvatar` (true only for the character
  returned by `findPlayerAvatar`).
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
- `transform-site` — discard the source item during the active player's
  site phase (declare `sitePhase: true`) to permanently transform the
  bearer's current site. The `apply` (type `"transform-site"`) carries
  `overrideType` (the {@link SiteType} the site becomes, e.g.
  `"ruins-and-lairs"`) and `attack` (the bespoke automatic-attack that
  replaces the site's printed attacks). The reducer
  (`reducer-organization.ts` `runGrantApply`) adds two `until-cleared`
  constraints filtered by the site's definition ID (so "all versions of
  the site" are affected): an `attribute-modifier` on `site.type` and a
  `replace-automatic-attacks`. Gate emission with a `when` on `site.type`
  (e.g. `{ "site.type": { "$in": ["border-hold", "shadow-hold"] } }`).
  Used by *Vile Fumes* (wh-54).

  ```json
  { "type": "grant-action", "action": "transform-site",
    "cost": { "discard": "self" }, "sitePhase": true,
    "when": { "site.type": { "$in": ["border-hold", "shadow-hold"] } },
    "apply": { "type": "transform-site", "overrideType": "ruins-and-lairs",
      "attack": { "creatureType": "Gas", "strikes": 1, "prowess": 7,
        "uncancelable": true, "eachCharacter": true } } }
  ```

- `boost-company-influence` — tap the bearer (a sage carrying a
  permanent enchantment) during the active player's site phase to add
  `+value` to one influence attempt by **another** untapped character in
  his company, after which the bearer makes a corruption check. The
  legal-action generator (`legal-actions/organization.ts`, items loop)
  emits one activation per eligible company-mate, carrying the chosen
  character on `targetCardId`; the bearer is excluded (paying the tap
  cost would leave it unable to make the boosted attempt) and tapped
  mates are skipped. The `apply` is a generic `sequence` of an
  `add-constraint` (`constraint: "check-modifier"`, `check: "influence"`,
  `target: "action-target-character"`, `scope: "turn"`) and an
  `enqueue-corruption-check` (on the bearer). The one-shot influence
  constraint is consumed by the targeted character's next influence
  attempt (`reducer-site.ts` / `legal-actions/site.ts` /
  `legal-actions/pending.ts`). Used by *When You Know More* (dm-163).

  ```json
  { "type": "grant-action", "action": "boost-company-influence",
    "activeSitePhase": true, "cost": { "tap": "bearer" },
    "apply": { "type": "sequence", "apps": [
      { "type": "add-constraint", "constraint": "check-modifier",
        "check": "influence", "value": 2, "scope": "turn",
        "target": "action-target-character" },
      { "type": "enqueue-corruption-check" } ] } }
  ```

- `modify-corruption-check` (with `corruptionCheckWindow: true`) — a tap
  ability activatable **only** while a corruption check by a character in
  the bearer's company is awaiting its roll, in either corruption-check
  window: the unified pending resolution (lure / transfer / wound checks)
  or the Free Council end-of-turn support window. The legal-action layer
  emits it via `modifyCorruptionCheckGrantActions`
  (`legal-actions/organization.ts`) — one activation per untapped bearer in
  the resolving character's company — never via the generic per-phase
  grant-action scanner (which skips `corruptionCheckWindow` effects, see
  `extractGrantActions`). The activation carries the resolving character on
  `targetCardId`. The `apply` is a `sequence`: an `add-constraint` of a
  one-shot `check-modifier` (`target: "action-target-character"` resolves to
  that `targetCardId`) plus an `enqueue-corruption-check` on the bearer. The
  unified window reads the constraint in `corruptionCheckActions`; the Free
  Council window reads and consumes it in `resolveCorruptionCheck`. Used by
  *When I Know Anything* (td-166): "Tap sage to modify one corruption check
  by a character in his company by +3. Sage makes a corruption check."

  ```json
  { "type": "grant-action", "action": "modify-corruption-check",
    "cost": { "tap": "bearer" }, "corruptionCheckWindow": true,
    "apply": { "type": "sequence", "apps": [
      { "type": "add-constraint", "constraint": "check-modifier",
        "check": "corruption", "value": 3, "scope": "until-cleared",
        "target": "action-target-character" },
      { "type": "enqueue-corruption-check" }
    ] } }
  ```

- `auto-pass-corruption-check` — tap this item to grant a character at the
  bearer's current site (any company, any player, excluding the bearer
  itself) an unconditional pass on its next corruption check, then the
  bearer makes a corruption check of their own. Unlike
  `modify-corruption-check`, this is not restricted to a
  `corruptionCheckWindow` — the ability is offered any time the item can pay
  its cost (site-scoped targeting is a dedicated legal-action branch,
  `effect.action === 'auto-pass-corruption-check'` in
  `legal-actions/organization.ts`, mirroring `force-discard-dwarf-at-site`'s
  same-site enumeration), and the granted shield persists (`scope:
  "until-cleared"`) until the target's next corruption check consumes it,
  however later that occurs. The `apply` is a `sequence`: an `add-constraint`
  of a one-shot `check-modifier` carrying `"autoPass": true` (instead of a
  numeric `value`) targeting `action-target-character`, plus an
  `enqueue-corruption-check` on the bearer. `autoPass: true` on a
  `check-modifier` constraint makes both corruption-check resolution paths
  (the unified pending resolution in `pending-reducers.ts`
  `applyCorruptionCheckResolution`, and the Free Council window in
  `reducer-free-council.ts` `resolveCorruptionCheck`) override the roll
  outcome to `'success'` unconditionally, still consuming the constraint and
  rolling the dice (for RNG determinism) but ignoring the result. Used by
  *Ancient Black Axe* (as-122): "tap this item to make a character at the
  same site automatically pass a corruption check. When this item becomes
  tapped, bearer makes a corruption check."

  ```json
  { "type": "grant-action", "action": "auto-pass-corruption-check",
    "cost": { "tap": "self" }, "anyPhase": true,
    "apply": { "type": "sequence", "apps": [
      { "type": "add-constraint", "constraint": "check-modifier",
        "check": "corruption", "value": 0, "autoPass": true,
        "scope": "until-cleared", "target": "action-target-character" },
      { "type": "enqueue-corruption-check" }
    ] } }
  ```

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
    "onSuccess": { "type": "move", "select": "self", "from": "self-location", "to": "discard" }
  } }
{ "type": "grant-action", "action": "gwaihir-special-movement",
  "cost": { "discard": "self" } }
{ "type": "grant-action", "action": "untap-bearer",
  "cost": { "discard": "self" } }
{ "type": "grant-action", "action": "untap-site",
  "cost": { "discard": "self" },
  "when": { "bearer.siteType": "shadow-hold", "site.isTapped": true },
  "apply": { "type": "untap-site" } }
{ "type": "grant-action", "action": "unlock-information-at-shadow-holds",
  "cost": { "discard": "self" },
  "apply": { "type": "add-constraint",
    "constraint": "site-resource-unlocked",
    "scope": "turn", "target": "player",
    "siteType": "shadow-hold", "subtype": "information" } }
// A `site-resource-unlocked` add-constraint may select sites by a compound
// `siteCondition` (evaluated against `site.siteType` / `site.regionType` / …)
// instead of a single `siteType`, for "such a site" rules that are not one type.
// A Panoply of Wings (wh-37): unlock Information at any non-Haven/non-Shadow-hold/
// non-Dark-hold site in a Wilderness. This grant-action rides on an **in-play
// faction** (a card sitting in cardsInPlay, not attached to a character):
// `inPlayFactionGrantActions` offers it during the controller's organization /
// site phase and `handleInPlayCardGrantAction` discards the faction + adds the
// constraint (only the `discard: self` cost + `add-constraint` apply are supported
// for bearer-less in-play sources).
{ "type": "grant-action", "action": "panoply-unlock-information",
  "cost": { "discard": "self" },
  "apply": { "type": "add-constraint",
    "constraint": "site-resource-unlocked",
    "scope": "turn", "target": "player", "subtype": "information",
    "siteCondition": { "$and": [
      { "$not": { "site.siteType": { "$in": ["haven", "shadow-hold", "dark-hold"] } } },
      { "site.regionType": "wilderness" } ] } } }
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

**`enqueue-pending-fetch` extras.** `fetchTo: "hand"` places the picked card in
the player's hand instead of shuffling it into the play deck.
`playableAtBearerSite: true` additionally restricts candidates to cards
*playable at the bearer's company's current site*, captured when the fetch is
enqueued (`grant-action-apply.ts` stores the site definition on the pending
`fetch-to-deck` effect as `playableAtSite`; both the candidate enumeration in
`legal-actions/index.ts` and the reducer validation in `reducer-utils.ts`
`handleFetchFromPile` consult it via `isCardPlayableAtSiteDef`): an item
qualifies when its subtype is in the site's printed `playableResources` (or an
`item-play-site` effect names/matches the site); an ally or faction qualifies
when one of its `playableAt` entries matches the site. The grant-action `when`
context also exposes `site.region`, so a "the site must be in <regions>" clause
gates the activation itself. Used by Strider (ba-1): "Tap Strider to search
your discard pile for any one item, ally, or faction playable at his current
site. You may bring it to your hand. The site must be in Arthedain, Cardolan,
Rhudaur, or The Shire."

```json
{ "type": "grant-action", "action": "fetch-playable-from-discard",
  "cost": { "tap": "self" },
  "when": { "site.region": { "$in": ["Arthedain", "Cardolan", "Rhudaur", "The Shire"] } },
  "apply": {
    "type": "enqueue-pending-fetch",
    "fetchFrom": ["discard-pile"],
    "fetchCount": 1,
    "fetchShuffle": false,
    "fetchTo": "hand",
    "playableAtBearerSite": true,
    "filter": { "cardType": { "$in": [
      "hero-resource-item", "hero-resource-ally", "hero-resource-faction"
    ] } }
  } }
```

**`place-item-on-character` apply.** Fetches one item matching `filter` from the
player's `discard-pile` / `sideboard` / `hand` (named in `fetchFrom`) and places
it, untapped, on a chosen character at the bearer's site. The legal-action
generator enumerates one `activate-granted-action` per (qualifying item ×
recipient) pair — the item rides on `targetCardId`, the recipient on
`recipientCharacterId` — so the player picks both by choosing the action. The
bearer pays the grant-action `cost` (typically `{ "tap": "bearer" }`); the
recipient is **not** tapped. Implemented in `legal-actions/organization.ts`
(emission) and `reducer-organization.ts` (`placeFetchedItemOnCharacter`).

```json
{ "type": "grant-action", "action": "forge-place-item",
  "cost": { "tap": "bearer" },
  "when": { "site.type": "haven" },
  "apply": {
    "type": "place-item-on-character",
    "fetchFrom": ["discard-pile", "sideboard", "hand"],
    "filter": { "$and": [
      { "unique": false },
      { "subtype": "minor" },
      { "$or": [
        { "keywords": { "$includes": "weapon" } },
        { "keywords": { "$includes": "armor" } },
        { "keywords": { "$includes": "shield" } },
        { "keywords": { "$includes": "helmet" } }
      ] }
    ] }
  } }
```

Used by The Forge-master (wh-117): "tap this character to place a non-unique
weapon/armor/shield/helmet minor item with any character at The Forge-master's
site … taken from your discard pile, sideboard, or hand." Wizard-specific
playability (the card's "Saruman specific" line) is enforced generically by the
permanent-event legal-action generator via `wizardSpecificName`: a
`<wizard>-specific` card is playable only while that player's revealed avatar is
the named wizard.

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
  - a self-discard `move` (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`) — removes the card from the bearer's items/hazards/allies and places it in the owner's discard pile. The optional `when` condition gates the discard (e.g. `"when": { "bearer.atHaven": true }` to discard at Darkhavens). Used by *Well-preserved* (as-108).
- `organization-phase-start` -- fires during the Untap → Organization transition immediately after `untap-phase-end` processing. The reducer (`reducer-untap.ts` `advanceToOrganization`) scans **every** player's `cardsInPlay` for company-bound permanent events (cards with a `companyId`) carrying this on-event. The condition is evaluated against a combined context: `{ company: { siteType, atHaven: boolean }, player: { avatarId: string | null } }` where `atHaven` is `true` when the bound company's current site is a haven/darkhaven, and `avatarId` is the definition ID of the player's ringwraith/wizard avatar character (or `null` if none is in play). Supports a self-discard `move` apply (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`) to move the card to its owner's discard pile. Used by *Nothing to Eat or Drink* (le-128), which discards itself when the company is at a haven; and by *Orders from Lugbúrz* (as-94), which discards itself when `player.avatarId` is `"le-56"` (Ren the Ringwraith). The same reducer also scans every active-player character's **attached** hazards/items/allies for `organization-phase-start` self-discards, evaluated against `{ bearer: { siteType, atHaven }, company: { characterCount } }` and routed to each card's **owner** (via `ownerOf`, so an opponent-owned hazard returns to the opponent's pile). Used by *So You've Come Back* (le-138): "Discard this card during the organization phase if target character is in a company by himself and at a Haven [{H}]" — `when: { "$and": [ { "company.characterCount": 1 }, { "bearer.atHaven": true } ] }`. The attached-card scan's context also exposes the **host character's** identity — `bearer.name` and `bearer.mind` — and beyond a self-discard `move` it also supports the `enqueue-opponent-elimination-roll` apply: the active player's **opponent** rolls 2d6, adds the apply's (negative) `modifier`, and the host character is eliminated when the total strictly exceeds `bearer.mind`. It enqueues a generic `dice-check` resolution (roller/actor = the opponent, `threshold = bearer.mind`, `comparison: "gt"`, `onPass: { "type": "eliminate-character" }`) scoped to the Organization phase, so it is offered to the opponent immediately at org-phase start. Used by *Evil Things Lingering* (ba-45): "If this ally's controlling character is not The Balrog, your opponent makes a roll during your organization phase and subtracts four. The controlling character is eliminated if the result is greater than his mind." — `when: { "bearer.name": { "$ne": "The Balrog" } }`, `apply: { "type": "enqueue-opponent-elimination-roll", "modifier": -4 }`. The `eliminate-character` dice-check branch removes the target from its company and sends the character card to its owner's **out-of-play pile** (eliminated, not discarded), discarding its possessions and freeing its followers (`eliminateCharacter` in `pending-reducers.ts`).
- `leader-leaves-company` -- fires in the Organization phase whenever a character with the `leader` keyword departs the bound company, for any reason: `split-company`, `move-to-company` (source company), `merge-companies` (source company), or combat elimination. The reducer calls `sweepLeaderLeavesCompanyEvents(state, [affectedCompanyId])` in `reducer-utils.ts`, which scans every player's `cardsInPlay` for permanent events bound to the affected company carrying this on-event with a self-discard `move` apply and moves matching cards to their owner's discard pile. The "is leader" check uses the card's definition `keywords` array (contains `"leader"`); it is evaluated *before* the state transition so the departing character is still findable. Only supports a self-discard `move` apply (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`). No `when` condition is evaluated. Used by *Orders from Lugbúrz* (as-94).

  ```json
  { "type": "on-event", "event": "leader-leaves-company",
    "apply": { "type": "move", "select": "self", "from": "self-location", "to": "discard" } }
  ```

- `attack-not-defeated` -- fires after combat finalization when the creature's attack was not fully defeated (i.e. not all strikes were won by the defenders). The reducer (`reducer-combat.ts`) checks the creature card for this event and applies its constraint. Used by *Little Snuffler*.
- `attack-defeated` -- fires after combat finalization when **all** strikes of an attack were fully defeated (all results = `success`). Scanned from every player's `cardsInPlay` in `reducer-combat.ts` when `allDefeated` is true. The condition context exposes `enemy.race` (the normalized race of the attack, e.g. `"undead"`) and `attack.isAutomaticAttack` (`true` only when the defeated attack was a site automatic-attack or a played-auto-attack, not a hazard creature). Supports a self-discard `move` apply (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`) to move the source card from `cardsInPlay` to the owning player's discard pile. Used by *The Moon Is Dead* (dm-71) to self-discard when any Undead attack is defeated, and by *Redoubled Force* (dm-83) to self-discard when an Orc/Troll **automatic**-attack is defeated (`when: { "attack.isAutomaticAttack": true, "enemy.race": { "$in": ["orc", "troll"] } }`).
- `company-arrives-at-site` -- fires when a hazard short-event resolves against a company in M/H. The handler (`applyShortEventArrivalTrigger` in `chain-reducer.ts`) iterates every `add-constraint` effect on the card with this event, evaluates the optional `when` against the arrival context, and applies the first matching one. This allows a single card to declare multiple mutually-exclusive modes (e.g. *Choking Shadows*). The arrival context exposes `company.destinationSiteType`, `company.destinationSiteName`, `company.destinationRegionType`, `environment.doorsOfNightInPlay`, and the standard `inPlay` card-name list.
- `end-of-company-mh` -- fires when a company's movement/hazard sub-phase ends (both players pass). For each character with an attached hazard carrying this event, enqueues one `corruption-check` pending resolution per region traversed in the site path. The `perRegion: true` flag on the effect enables the per-region behavior. An optional `regionTypeFilter: [...]` array restricts the iteration to regions whose type appears in the list — e.g. *Lure of Nature* uses `regionTypeFilter: ["wilderness"]` to enqueue a check only for each wilderness in the path. Used by *Alone and Unadvised* and *Lure of Nature*. Implemented in `reducer-movement-hazard.ts`.
- `company-mh-end-at-site` -- fires when a company finishes its movement/hazard phase (`endCompanyMH`, after movement is committed) while at the Haven a permanent event is bound to (`attachedToSite` = the company's final `currentSite` definition id). Scanned over the active player's `cardsInPlay` in `reducer-movement-hazard.ts` (`fireHavenRestoreTriggers`). Supports `apply: { type: "offer-restore-character" }`: when the company has at least one tapped or wounded character, a `haven-restore-character` pending resolution is enqueued for the controlling player, scoped to the upcoming Site phase (the M/H sub-phase boundary would otherwise sweep it before the player acts; pending resolutions short-circuit every phase action, so it is resolved at the very next decision point — immediately following the company's M/H phase). The player may choose one character to untap (tapped → untapped) or heal one step (wounded/inverted → tapped) via a `restore-character-by-effect` action, or pass — the improvement is determined by the chosen character's current status. Used by *Hall of Fire* (dm-134).
- `company-composition-changed` -- fires against every attached hazard whenever a company's character roster changes (play-character, move-to-company, merge-companies, auto-merge at end of MH). The sweeper evaluates the effect's `when` against the bearer's company context and applies the self-discard `move` when the condition is met. Used by *Alone and Unadvised* (discards when company has 4+ characters). Implemented in `reducer-utils.ts` `sweepAutoDiscardHazards()`.
- `bearer-company-moves` -- fires when the company containing the bearer completes movement (M/H step 8). For each character in the moving company, the reducer scans attached **items and allies** for this event and applies the self-discard `move`, moving the card to the owner's discard pile. An effect with no `when` discards unconditionally (e.g. *Align Palantír*, an item that leaves play the moment its company moves). An effect carrying a `when` clause discards only when the clause matches the context `{ movementType, destination: { name, region, siteType } }`, where `movementType` is the movement kind used (`"starter"` / `"region"` / `"special"` / `"under-deeps"`). Used by *Mistress Lobelia* (dm-178), an ally discarded whenever her company moves to a site outside her allowed set (`when: { $not: { $or: [ { "destination.name": { $in: [...] } }, { "destination.region": "The Shire" } ] } }`); and by *Evil Things Lingering* (ba-45), "Discard this ally if its company moves using region or starter movement" — `when: { "movementType": { "$in": ["region", "starter"] } }` (so Under-deeps/special moves keep it). Implemented in `reducer-movement-hazard.ts` (step 8a-2 of `mh-hazard-play.ts`).
- `creature-attack-begins` -- fires when a hazard creature attack is locked onto a defending company, after the creature's combat state has been initialized but before any strike is assigned. The attack was not canceled by the time this event fires (canceling an attack prevents `initiateCreatureCombat` from running entirely). Handled in `chain-reducer.ts` `initiateCreatureCombat()`. Supported apply types:
  - `offer-char-join-attack` — scoped to characters in the defending player's *other* companies that are at a haven; the `when` condition is evaluated against `{ bearer: { atHaven: true, siteType: 'haven' }, attack: { attackedCompanyId, bearerCompanyId } }`. Used by *Alatar* (tw-117).
  - `force-check-all-company` — enqueues a corruption check for every character in the attacked company before defenders are selected. Uses `check` (must be `"corruption"`) and optional `modifier`. Used by *Corpse-candle* (tw-23, le-67).
- `character-body-check-equals-body` -- fires during the body check roll inside `handleBodyCheckRoll` in `reducer-combat.ts` when the effective roll result **exactly equals** (not exceeds) the defending character's body value. The `when` condition is evaluated against `{ target: { race } }` where `race` is the character's race string. Supports `apply: { "type": "discard-character" }`, which removes the character from their company and places them in the defending player's discard pile (rather than the out-of-play pile). Items and allies on the character are discarded immediately (no salvage phase). Does not fire for ally combatants. The `when` condition should exclude Wizard and Ringwraith characters per the card text. Used by *Giant Spiders* (tw-40).

  ```json
  { "type": "on-event", "event": "character-body-check-equals-body",
    "apply": { "type": "discard-character" },
    "when": { "$not": { "target.race": { "$in": ["wizard", "ringwraith"] } } } }
  ```

- `bearer-wounded` -- fires after combat finalization for each ally whose bearer (controlling character) was wounded (result `'wounded'`, not tapped under detainment rules; detainment strikes tap, not wound). Scans every wounded character's attached allies for this event. Supports a self-discard `move` apply (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`), which removes the ally from the bearer and places it in the defending player's discard pile. Implemented in `reducer-combat.ts` combat finalization. Used by *Regiment of Black Crows* (as-76) and *Great Bats* (as-74).

  ```json
  { "type": "on-event", "event": "bearer-wounded",
    "apply": { "type": "move", "select": "self", "from": "self-location", "to": "discard" } }
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
- `add-constraint` -- add an {@link ActiveConstraint} of the named kind to the target. Reserves the entry's `constraint` field for the kind name (e.g. `"site-phase-do-nothing"`, `"no-creature-hazards-on-company"`, `"deny-scout-resources"`, `"auto-attack-prowess-boost"`, `"auto-attack-duplicate"`, `"site-type-override"`, `"region-type-override"`, `"skip-automatic-attacks"`, `"cancel-character-discard"`, `"hazard-draw-multiplier"`, `"haven-return-option"`) and the `scope` field for the auto-clear boundary (e.g. `"company-site-phase"`, `"company-mh-phase"`, `"turn"`, `"until-cleared"`). Constraint-kind-specific fields include `value` + `siteType` for `auto-attack-prowess-boost`, `overrideType` for `site-type-override` (the site is the active company's current site during site phase, or the destination during M/H phase), and `overrideType` + `regionName` for `region-type-override` (use the token `"destination"` as the region name to target the destination region of the active company). The `skip-automatic-attacks` constraint removes all automatic attacks from the bound site (resolved from the active company's current site during site phase). The `replace-automatic-attacks` constraint (scope `"until-cleared"`, added by *Vile Fumes*' `transform-site` action — see above) carries a `siteDefinitionId` and an `attack`; `manifestations.ts` `getActiveAutoAttacks` returns that single attack in place of all printed/augmented attacks for every version of the site. The attack may set `uncancelable` (mapped to the `cannot-be-canceled` combat rule, suppressing cancel-attack) and `eachCharacter` (each character in the company faces one strike). When added via a grant-action `add-constraint` apply (rather than the permanent-event on-event path), both `skip-automatic-attacks` and `influence-at-site-modifier` resolve their `siteDefinitionId` from the *bearer's company's* current site; `influence-at-site-modifier` reads its `+value` from the apply clause and adds that bonus to every faction-influence attempt against a faction at that site for its scope (`turn`). Both are used by *Blasting Fire* (wh-51): its discard ability is a `sequence` of these two `add-constraint` applies. The `company-cannot-move` constraint (scope `"turn"`, target a company) locks that company stationary for the rest of the turn: the org-phase `plan-movement` emitter (`planMovementActions`) skips it and the reducer (`handlePlanMovement`) rejects any movement declaration for it. Used by *Hide in Dark Places* (le-192), which adds it alongside `no-creature-hazards-on-company` (two `on-event: self-enters-play` → `add-constraint` effects) so the protected company cannot carry its hazard-creature immunity onto a moving company. The `cancel-character-discard` constraint is placed by *Magical Harp* on the bearer's company; any future character-discard effect should consult this constraint to short-circuit the discard for the rest of the turn. The `hazard-draw-multiplier` constraint (scope `"company-mh-phase"`) multiplies the hazard draw count during the target company's M/H draw step by the `value` field (e.g. `2` to double opponent draws, as used by *Great-road*). The `haven-return-option` constraint (scope `"turn"`) records the company's origin haven at play time and enables a `haven-return` action during end-of-turn discard and signal-end steps, allowing the company to teleport back to the recorded haven without a new M/H phase (used by *Great-road*). The `check-modifier` constraint kind may also be added via a grant-action `add-constraint` apply (carrying `check` and a numeric `value`): a one-shot bonus/penalty consumed the first time the targeted character makes a matching check — e.g. *When You Know More* (dm-163) adds a `+2` `influence` modifier. Such a grant-action targets the chosen character with `target: "action-target-character"`, which resolves to `{ kind: "character", characterId: <action.targetCardId> }` (the candidate the legal-action generator put on the activation). The constraint filter in `legal-actions/pending.ts` rewrites legal actions for the affected target while the constraint lives.
- self-discard `move` (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`) -- discard the card carrying this effect (typically an ally or attached hazard) from its bearer to the owning player's discard pile. This is the generic `move` primitive in its "discard the bearer" shape — it replaced the former dedicated `discard-self` verb (the legacy→`move` mapping is in the migration table below). Event sweepers detect it via the shared `isSelfDiscardMove` predicate (`reducer-utils.ts`); the slot-specific removal stays inline per sweeper because the move locator does not scan every attachment slot (e.g. allies). Used with `company-arrives-at-site` + a `when` condition on `site.region` to enforce region-based restrictions (e.g. Treebeard), with `company-composition-changed` + a `when` condition on `company.characterCount` to discard on company size (e.g. Alone and Unadvised), and with `untap-phase-end` + `when: { "bearer.atHaven": true }` to discard at the Untap→Organization transition when at a haven (e.g. Well-preserved). Implemented in `reducer-movement-hazard.ts` `fireAllyArrivalEffects()`, `reducer-utils.ts` `sweepAutoDiscardHazards()`, and `reducer-untap.ts` `advanceToOrganization()`.
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

  An optional `onSuccess` field carries a follow-up {@link TriggeredAction}
  that runs when the check **passes** (CoE rule 10.39 hook). It is threaded
  onto the pending `corruption-check` resolution and executed by the
  resolver's pass branch (`pending-reducers.ts`
  `applyCorruptionCheckResolution`). Used by *Cracks of Doom* (tw-205): a
  successful −4 corruption check on the Ring's bearer wins the game.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "enqueue-corruption-check", "modifier": -4,
               "onSuccess": { "type": "win-game", "via": "one-ring" } } }
  ```

- `win-game` -- end the game immediately as a win for the controller of the
  source card (CoE rule 10.39 / MELE §1). `via` is currently always
  `"one-ring"`. Resolves through the shared `endGame` primitive
  (`reducer-free-council.ts`), which forces the winner regardless of
  marshalling points; final scores are still computed for the result screen.
  The recorded {@link WinReason} carries the controller's alignment and the
  source card id. This single apply is the win mechanism behind all four CoE
  10.39 cards — Cracks of Doom (tw-205, via corruption-check `onSuccess`),
  Gollum's Fate (tw-247, directly under `self-enters-play`), A New Ringlord
  (wh-60, via an end-of-turn `roll-then-apply` `onSuccess`), and Challenge the
  Power (ba-52, via an on-play `roll-then-apply` `onSuccess`) — so each card
  declares only its conditions and roll thresholds, never bespoke win
  plumbing. The Ringwraith positional win at Barad-dûr funnels through the
  same `endGame` primitive from `reducer-end-of-turn.ts` (no card, so the
  recorded `card` is `null`). Implemented in `reducer-events.ts`
  (`applyShortEventOnEntersPlay`), `pending-reducers.ts`
  (`applyCorruptionCheckResolution`), and the end-of-turn scanner.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "win-game", "via": "one-ring" } }
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
    a granted action *constraint* (any character in the company taps).
    Also usable as a **static `grant-action` on an in-play ally that
    taps itself** (`cost: { tap: "self" }`): while a chain hazard is
    unresolved during the M/H phase and the ally's `when` matches a
    context exposing the active company's `destinationRegion` and
    `chain.hazardCount`, the ally is offered a self-tap cancellation
    (`legal-actions/chain.ts` `emitAllyCancelChainActions`; the reducer
    taps the ally in place via the shared `handleGrantActionApply`, since
    the source card ≠ the bearer character). Such grant-actions are kept
    out of the generic per-phase scanner (`extractGrantActions` skips any
    grant-action whose apply is `cancel-chain-entry`) because a chain
    cancellation is meaningless outside an active chain. Used by *Tom
    Bombadil* (tw-350): "Tap to cancel a hazard that targets ... a company
    ... moving to a site in: Arthedain, Cardolan, Rhudaur, or The Shire",
    gated by `when: { destinationRegion: { "$in": [...] } }`. The same
    shape fits *Leaflock* (tw-265). The companion self-discard clause
    ("Discard ... if his company moves to a site that is not in [regions]")
    reuses the existing `on-event: company-arrives-at-site` self-discard
    `move` (see *Treebeard* tw-353).
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

When the item has `cost: { "tap": "self" }`, only the item taps — the
bearer's status is irrelevant (it need not be untapped and is not tapped).
The item itself must be untapped. Used by *Helm of Fear* (as-126) — tap the
item to cancel an attack against the Ringwraith's company.

**Dual-mode cancel / reduce-prowess.** A `prowessPenalty: N` field turns the
card into a two-option play: the legal-action emitter offers both the outright
cancellation and a "reduce the attack's prowess by N" variant (carried on the
action as `mode: "reduce-prowess"`). The cancellation routes through the chain
as usual; the reduce-prowess variant is applied immediately (like
`halve-strikes` / `modify-attack`), lowering `combat.strikeProwess` by `N`
without ending combat. Both modes pay the same cost and both record the
attack-scoped `duplication-limit` marker. Used by *The Tormented Earth*
(as-102): "Cancels the attack **or** gives the attack -3 prowess, your choice."

**Cost exemption by race.** A `costExemptRace: "<race>"` field waives the cost
when the cost-paying character is of that race — e.g. The Tormented Earth's
"Unless he is a Ringwraith, character makes a corruption check modified by -4"
(`requiredSkill: "sorcery"`, `cost: { check: "corruption", modifier: -4 }`,
`costExemptRace: "ringwraith"`). A Ringwraith sorcery-user pays nothing; any
other sorcery-user makes the -4 check.

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
- `attack.heroCompany` — `true` only for character-vs-character combat
  in which the attacking company belongs to a hero-side player (Wizard
  or Fallen-wizard avatar). Hazard creature / automatic attacks are
  never a "company" and so are never hero-company. Used by *Helm of
  Fear* (as-126): "May not cancel combat with a hero company" →
  `"when": { "attack.heroCompany": { "$ne": true } }`.
- `attack.siteKeyingTypes` — array of **site types** the creature is
  keyed to (e.g. `["ruins-and-lairs"]`); only populated for creature
  hazards. Lets a card gate on "an attack keyed to Ruins & Lairs".
- `attack.keyingRegionNames` — array of specific **region names** the
  creature is keyed to *by name* (e.g. `["Fangorn"]`); only populated for
  creature hazards. Lets a card gate on "an attack keyed by name to
  <one of these regions>" — e.g. *Beasts of the Wood* wh-38, matched with
  a `$or` of `{ "attack.keyingRegionNames": { "$includes": "<name>" } }`
  clauses (one per region).
- `site.type` — the defending company's current site type (e.g.
  `"ruins-and-lairs"`, `"haven"`). Lets a card gate on "an
  automatic-attack at a Ruins & Lairs".
- `defender.covert` — `true` when the defending company is covert
  (contains no Orc/Troll, Balrog avatar, or `company-overt` source).

The effect may be declared on in-play sources too: an ally attached
to a company character (e.g. The Warg-king), the character card
itself (e.g. Adûnaphel the Ringwraith), or an item with
`cost: { "tap": "self-and-bearer" }` (e.g. Torque of Hues).

**Dual-faction cancel (`handModeRequiresCovert`).** A dual-alignment faction
that cancels an attack has two sources:

- the controlled faction in `cardsInPlay` — paid with the effect's own `cost`
  (available to whoever controls it, no covert/alignment gate); and
- the card in hand — played as a **minion resource**, but only by a
  **covert company** and only by a **minion (Ringwraith) player** when the
  effect carries `"handModeRequiresCovert": true`.

The in-play cost is either `cost: { "discard": "self" }` — discard the faction
to cancel (*Wild Hounds* wh-40) — or `cost: { "tap": "self" }` — tap the faction
in place, leaving it in play (*Beasts of the Wood* wh-38). The hand mode always
spends the card by discarding it from hand regardless of the in-play cost.

Both sources share the same `when` attack filter and are emitted by
`cancelAttackActions` (combat.ts); the in-play source applies immediately,
the hand play routes through the chain. Example (Wild Hounds — discard):

```json
{ "type": "cancel-attack",
  "cost": { "discard": "self" },
  "handModeRequiresCovert": true,
  "when": { "$or": [
    { "$and": [ { "attack.source": "automatic-attack" }, { "site.type": "ruins-and-lairs" } ] },
    { "attack.keying": "wilderness" },
    { "attack.siteKeyingTypes": "ruins-and-lairs" } ] } }
```

Example (Beasts of the Wood — tap, keyed by region name):

```json
{ "type": "cancel-attack",
  "cost": { "tap": "self" },
  "handModeRequiresCovert": true,
  "when": { "$or": [
    { "attack.keyingRegionNames": { "$includes": "Fangorn" } },
    { "attack.keyingRegionNames": { "$includes": "Cardolan" } } ] } }
```

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

### 9c. `convert-creature-to-ally`

Carried by a resource permanent-event that the **defending** player plays
during a creature's attack (the assign-strikes combat window, before any
strikes are assigned). All of the creature's attacks are canceled and the
creature card becomes an ally controlled by a chosen character in the
defending company.

Eligibility (checked in `convertCreatureToAllyActions`,
`engine/legal-actions/combat.ts`):

- the active attack is a single creature (`attackSource.type === 'creature'`),
- the creature's race (lowercased) is one of `races`,
- the creature's printed strike count is ≤ `maxStrikes` ("one strike for
  each of its attacks" → `maxStrikes: 1`), and
- the defending company has at least one untapped character (when
  `controllerTaps` is true) to take control.

One `convert-creature-to-ally` action is offered per (card, eligible
controlling character) pair. On reduce (`handleConvertCreatureToAlly`,
`engine/reducer-combat.ts`):

1. The controlling character taps (when `controllerTaps`).
2. The creature card moves from the attacker's cards-in-play into the
   controlling character's `allies` list with a `statOverride`:
   `mind = ally.mind`, `body = ally.body`,
   `prowess = creature printed prowess + ally.prowessModifier`.
3. The event card moves from the defender's hand into their cards-in-play
   with `attachedTo` set to the new ally ("Place this card with the
   creature"); there it scores its printed ally marshalling point.
4. Combat ends (all attacks canceled), running the same attack-end
   housekeeping as a cancel-attack.

The ally's overridden stats are read via `engine/ally-stats.ts`
(`allyEffectiveProwess` / `allyEffectiveBody` / `allyEffectiveMind`),
which every ally-stat consumer consults before falling back to the card
definition (combat prowess/body, agent influence, Stay Her Appetite). When
the converted-creature ally later leaves play, the orphaned event card is
discarded by the `discardOrphanedConvertedAllyEvents` postReduce sweep
(`engine/reducer-utils.ts`).

```json
{
  "type": "convert-creature-to-ally",
  "races": ["orc", "orcs", "troll", "trolls", "giant", "slayer", "men"],
  "maxStrikes": 1,
  "controllerTaps": true,
  "ally": { "mind": 1, "body": 8, "prowessModifier": -7 }
}
```

Used by Ready to His Will (le-220). Memories of Old Torture (ba-67) uses
the same effect with `controllerTaps: false` and `body: 7`.

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

Example: Dwarven Light-stone (dm-168) — tap to give -2 prowess to one Orc or
Troll attack *or* to one attack for which "weapons do not modify the target's
prowess". The second alternative is expressed by gating on
`attack.weaponsIneffective` (see [Site auto-attack `combatRules`](#site-auto-attack-combatrules)
for how an attack acquires that flag):

```json
{ "type": "modify-attack",
  "cost": { "tap": "self" },
  "prowessModifier": -2,
  "when": { "$or": [
    { "enemy.race": { "$in": ["orc", "orcs", "troll", "trolls"] } },
    { "attack.weaponsIneffective": true }
  ] } }
```

The `when` context for an item `modify-attack` exposes `bearer.*`
(`race`/`skills`/`name`), `enemy.race` (the attacking creature's race), and
`attack.*`: `source` (the attack-source discriminator), `keying`,
`siteKeyed`, and `weaponsIneffective` (true for attacks whose strikes carry the
printed "weapons do not modify prowess" clause — see the `weapons-ineffective`
combat rule below).

- `strikesModifier` — amount added to `strikesTotal` (usually negative);
  clamped so result is never below 1.

The effect may also be declared on an in-play **ally** with
`cost: { "tap": "self" }`: the ally taps to modify an attack against its
controlling character's company, in the same pre-assignment window.

- `removeAttackerChoosesDefenders` — when `true`, activating removes the
  "attacker chooses defending characters" rule from the current attack:
  the combat's `attackerChoosesDefenders` flag is cleared so the defending
  player assigns strikes normally (a pending attacker-assignment sub-phase
  flips back to the defender; in the cancel-window the defender's eventual
  pass routes to defender assignment). The action is only offered while
  the attack actually carries the rule — whether from a creature's
  `combat-attacker-chooses-defenders` effect or a site auto-attack's
  `attacker-chooses-defenders` combat rule.

```json
{ "type": "modify-attack",
  "cost": { "tap": "self" },
  "removeAttackerChoosesDefenders": true }
```

Example: Great Bats (as-74) — tap this ally to remove the effect of an
attack against its controlling character's company that states: "attacker
chooses defending characters."

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

The `when` clause is evaluated against the standard combat context:
`enemy.race`, `enemy.name` (the attacking creature's card name, for
creature attacks), `attack.source`, `attack.automatic` (`true` for a
site automatic-attack or played auto-attack), `attack.keying`, `inPlay`.

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

The from-hand path also honours `strikesModifier` (added to the attack's
`strikesTotal`, clamped to a minimum of 1) and `firstCancelRemovesEffect`.

**`firstCancelRemovesEffect` (cancel protection).** When set on an
attacker-played from-hand `modify-attack`, the buffed attack gains cancel
protection: the modifiers applied (strikes/prowess/body) are recorded in
`CombatState.cancelProtection`, and the **first** attempt to cancel the
attack instead strips those modifiers (reverting the attack to its original
values) rather than ending the attack. The cancel card is still spent; a
later cancellation ends the attack normally. Implemented at the sole
cancel-attack chokepoint `resolveCancelAttackEntry`
(`engine/combat-cancel.ts`), through which every `cancel-attack` short-event
variant resolves.

```json
{ "type": "modify-attack", "fromHand": true,
  "player": "attacker",
  "strikesModifier": 1, "prowessModifier": 1, "bodyModifier": -2,
  "firstCancelRemovesEffect": true,
  "when": { "$or": [
    { "attack.automatic": true }, { "enemy.name": "Shelob" }
  ] } }
```

Example: Unabated in Malice (ba-26) — hazard short event playable on an
automatic-attack or an attack from Shelob (does not count against the
hazard limit); the attack gains +1 strike, +1 prowess, -2 body; the first
attempt to cancel it instead cancels this card's effects; cannot be
duplicated on a given attack (`duplication-limit` scope `attack`).

Implemented in `engine/legal-actions/combat.ts` (`modifyAttackActions`)
and `engine/reducer-combat.ts` (`handleModifyAttack`), with cancel
protection in `engine/combat-cancel.ts` (`resolveCancelAttackEntry`).

### 10f. `face-strike-on-tap`

Activated ability on an in-play item (or character-attached permanent event)
that lets its bearer face one of an attack's strikes **regardless of the
attack's normal capabilities and the bearer's status**. During the
`assign-strikes` defender phase, while the item is untapped, its bearer is in
the defending company, and an unassigned strike remains, the defending player
may tap the item (the new `face-strike-on-tap` action) to add a strike-facing to
the bearer — even if he is tapped or wounded (the ordinary untapped-status gate
is bypassed) and even if the attack's normal rules would not direct a strike at
him.

If `bodyReductionOnParry` is set and the bearer then **parries** that strike (it
fails to wound him — `characterTotal >= creature prowess`), the attack's body
(`CombatState.creatureBody`) is reduced by that amount for the rest of the
combat, applied immediately (including to that strike's own creature body
check), making the creature easier to defeat via its body checks.

```json
{ "type": "face-strike-on-tap", "bodyReductionOnParry": 1 }
```

Example: Bow of Alatar (wh-90) — placed on Alatar (`play-target` `character`
filter `{ "target.name": "Alatar" }`); tap to let Alatar face a strike
regardless of capabilities/status, reducing the attack's body by 1 if he parries
it. The card also carries `stage-points` 2.

Implemented in `engine/legal-actions/combat.ts` (`assignStrikeActions` defender
branch), `engine/combat-actions.ts` (`handleFaceStrikeOnTap`), and the parry
body reduction in `engine/combat-strike.ts` (`resolveStrikeCore`), keyed by
`StrikeAssignment.reduceAttackBodyOnParry`.

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
  the company faces one strike" (e.g. Neeker-breekers). Optional
  `onlyWounded: true` restricts the strikes to **wounded** (inverted)
  characters: `strikesTotal = wounded characters`, one strike pre-assigned
  to each wounded character, unwounded characters never assigned a strike.
  With no wounded characters the creature has no effect and is discarded
  without combat (no trivial "all strikes defeated" kill MP). Card text is
  "Each wounded character faces one strike" (e.g. Carrion Feeders ba-11).
  Mutually exclusive with `excludeAvatars`. (implemented in
  `chain-reducer.ts`, `legal-actions/combat.ts`)
- `combat-body-check-modifier` — attack-wide body-check modifier carried by
  a hazard creature: `value` is added to every character body-check roll this
  attack produces (on top of the already-wounded +1 and any item modifiers).
  Positive values make elimination more likely. Threaded into
  `CombatState.bodyCheckModifier` at combat initiation and consumed in
  `handleBodyCheckRoll`. Card text is "All body checks resulting from
  successful strikes are modified by an additional +1" (e.g. Carrion Feeders
  ba-11). (implemented in `chain-reducer.ts`, `combat-actions.ts`)
- `combat-tap-to-cancel-strike` — the defending company may tap an untapped
  character to cancel one of this attack's strikes against a wounded character.
  Pairs with `combat-one-strike-per-character: onlyWounded` (every strike is
  against a wounded character). On combat initiation the engine opens a
  `cancel-by-tap` sub-phase (`CombatState.cancelStrikeAgainstWounded`): each
  untapped company character may tap to remove one pre-assigned strike (the
  defender chooses which wounded character to protect, via the `cancel-by-tap`
  action's `strikeCharacterId`), or pass to proceed to resolution. Card text is
  "Each untapped character in the company may tap to cancel a strike against a
  wounded character" (e.g. Carrion Feeders ba-11). (implemented in
  `chain-reducer.ts`, `legal-actions/combat.ts`, `combat-cancel.ts`)
- `combat-defender-prowess-from-mind` — each defending character's prowess
  for this attack is replaced by their mind attribute value. Status modifiers
  (tapped −1, wounded −2) and support bonuses still apply on top of the
  mind base. Card text is "His prowess against such a strike is equal to
  his mind attribute" (e.g. Neeker-breekers). (implemented in
  `reducer-combat.ts`)
- `combat-tap-low-mind` — after each strike of this attack resolves, every
  facing **character** (not ally) whose mind attribute is ≤ the attack's
  strike prowess must tap if it is still untapped. Avatars (mind === null) and
  characters who were wounded by the strike (now inverted, hence not untapped)
  are unaffected. A canceled strike never resolves, so it never taps. The
  threshold is the live strike prowess read at resolution time — no fields
  beyond `type`. Card text is "Any character facing a strike whose mind is
  equal to or lower than the strike's prowess must tap if untapped following
  the strike (unless the strike is canceled)" (e.g. Wisp of Pale Sheen,
  dm-113). (implemented in `reducer-combat.ts`, wired in `chain-reducer.ts`)
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
{ "type": "combat-tap-low-mind" }
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

**Starting-company exclusion.** "Cannot be included with a starting
company" (e.g. Records Unread as-130) is modelled with the
`no-starting-company` play-flag, not a play-restriction rule. The
item-draft eligibility ruleset (`ITEM_DRAFT_RULES`) rejects any item
carrying the flag, so it can never be assigned as a starting minor item
but plays normally from hand during the game.

```json
{ "type": "play-flag", "flag": "no-starting-company" }
```

### 13a. `site-resource-unlocked` active constraint

Produced by an `add-constraint` apply (see the Records Unread mode-B
grant-action above). While active, a resource category (`subtype`, e.g.
`"information"`) becomes playable at every site of the given `siteType`
(e.g. `"shadow-hold"`) for the constraint's target player, even when
those sites do not list the category in `playableResources`. Consulted by
the `site-has-resource` play-condition check in
`legal-actions/organization.ts`. Records Unread targets the discarding
`player` and scopes the unlock to `turn`.

### 13b. `cross-alignment-resources-unlocked` active constraint

Produced by an `on-event: self-enters-play → add-constraint` apply on a
stage permanent-event played on a site (`play-target` target `site`). The
constraint kind resolves the bound site from the active company's current
site during the site phase and is filtered by that `siteDefinitionId`,
targeted at the controlling `player`, scoped `until-cleared`. While active,
the MEWH §10 cross-alignment site-tap block in `legal-actions/site.ts`
(`siteTapCrossAlignmentBlocked`) — which normally stops a Fallen-wizard from
playing a hero resource that taps a minion site (or a minion resource at a
hero site) — is lifted at the bound site, so the opposite alignment's
items/allies/factions become playable there. The constraint (and the card)
are cleared by `discardOrphanedSiteAttachedEvents` once no company occupies
the bound site.

```json
{
  "type": "on-event",
  "event": "self-enters-play",
  "apply": {
    "type": "add-constraint",
    "constraint": "cross-alignment-resources-unlocked",
    "scope": "until-cleared"
  }
}
```

Used by Double-dealing (wh-66): "If the site is a minion site, you may play
appropriate hero resources there. If the site is a hero site, you may play
appropriate minion resources there."

### 13c. `site-protected` active constraint

Produced by an `on-event: self-enters-play → add-constraint` apply on a stage
permanent-event played on a Wizardhaven (`play-target` target `site`). The
constraint kind resolves the bound site from the active company's current site
during the site phase and is filtered by that `siteDefinitionId`, targeted at
the controlling `player`, scoped `until-cleared`. While active, any player other
than the protector ("your opponent") is barred — in `legal-actions/site.ts`
(`siteIsProtectedAgainstPlayer` + `givesMarshallingPoints`) — from playing a
marshalling-point card (an item/ally/faction worth ≥1 MP) at any version of the
site. "Any version of the site" is matched by definition id, so the opponent's
own copy of the same site in their location deck is covered too. The constraint
(and the card) are cleared by `discardOrphanedSiteAttachedEvents` once no company
occupies the bound site.

```json
{
  "type": "on-event",
  "event": "self-enters-play",
  "apply": {
    "type": "add-constraint",
    "constraint": "site-protected",
    "scope": "until-cleared"
  }
}
```

Used by Guarded Haven (wh-74): "The site is protected. Cards that give
marshalling points may not be played at any version of the site by your opponent
in all cases." The companion `play-target` filter requires `effectiveSiteType`
`haven` (after any wizardhaven-conversion) and excludes the three named sites:

```json
{
  "type": "play-target",
  "target": "site",
  "filter": {
    "$and": [
      { "effectiveSiteType": "haven" },
      { "$not": { "name": { "$in": ["Isengard", "The White Towers", "Rhosgobel"] } } }
    ]
  }
}
```

The "May not be used as a starting stage card" clause needs no effect: the card
simply omits the `starting-item` keyword that marks a Fallen-wizard Stage
resource as draftable at setup (Thrall of the Voice wh-82, Hidden Haven wh-75
carry it), so the draft layer never offers it as a starting stage card.

### 13d. `technology-item-unlocked` active constraint

Produced by an `on-event: self-enters-play → add-constraint` apply on a stage
permanent-event played on a site (`play-target` target `site`). The constraint
kind resolves the bound site from the active company's current site during the
site phase and is filtered by that `siteDefinitionId`, targeted at the
controlling `player`, scoped `until-cleared`. While active, the owning player may
play **one** item bearing the `Technology` keyword at that site during the site
phase, whether the site is tapped or untapped — the play bypasses both the
site-tap precondition and the item's own `item-play-site` restriction (which
targets Shadow/Dark-holds and so would never match a Wizardhaven). The
one-per-site-phase limit is tracked by `SitePhaseState.technologyItemPlayed`; the
played item does not tap the site and does not count as the company's tapping
resource (`legal-actions/site.ts` offers the play, `reducer-site.ts` records it).
The constraint (and the card) are cleared by `discardOrphanedSiteAttachedEvents`
once no company occupies the bound site.

```json
{
  "type": "on-event",
  "event": "self-enters-play",
  "apply": {
    "type": "add-constraint",
    "constraint": "technology-item-unlocked",
    "scope": "until-cleared"
  }
}
```

Used by Saruman's Machinery (wh-120): "One Technology item is playable at the
site during your site phase whether the site is tapped or untapped." Its
companion `play-target` restricts the site to Isengard / The White Towers and a
`play-condition` `requires: 'site-protected'` requires that site to already be
protected for the player (see §below).

### 14. `duplication-limit`

Caps how many copies of this card can be in a given scope.

Supported scopes:

- `"character"` — one copy per character (e.g. Horn of Anor).
- `"site"` — one copy per site across all companies at the site (e.g. Rescue Prisoners).
- `"game"` — one copy anywhere in play across both players.
- `"player"` — one copy per player across all their characters (e.g. The Windlord Found Me).
- `"company"` — one copy per company (e.g. Orders from Lugbúrz).

```json
{ "type": "duplication-limit", "scope": "character", "max": 1 }
{ "type": "duplication-limit", "scope": "player", "max": 1 }
{ "type": "duplication-limit", "scope": "company", "max": 1 }
```

### 14a. `name-alias`

Makes the card count as another named card for the purpose of `inPlay`
condition checks. While the bearer is in `cardsInPlay`, the alias name is added
to the in-play names list (`buildInPlayNames`), so any DSL `when` clause that
tests `{ "inPlay": "<alias>" }` is satisfied. The card's own name and
duplication counts are unaffected — only the `inPlay` name list gains the
alias, so a card with this effect does not collide with the aliased card for
`duplication-limit` purposes.

```json
{ "type": "name-alias", "as": "Gates of Morning" }
```

Used by Skies of Fire (le-228), the minion environment that "acts as Gates of
Morning for the purposes of interpreting hazards": every existing
Gates-of-Morning-gated hazard interpretation (e.g. Dark Quarrels'
halve-strikes, hand-card attack modifiers, region-keying / movement
play-conditions) fires while Skies of Fire is in play, with no engine code
naming Skies of Fire.

### 14b. `manifestation-swap` (and character manifestation chains)

A character that is a *manifestation* of another character (e.g. Strider
ba-1, "Manifestation of Aragorn II") declares the chain with the
`manifestId` card field (by convention the base form's definition id —
`"tw-120"` for the Aragorn chain; the tag may be one-sided, since a card
naming another as its manifestation makes the relation symmetric —
`sameManifestationEntity` in `engine/manifestations.ts`). The chain drives
two generic rules:

- **g.man.1 in-play uniqueness** — a character cannot be brought into play
  (normal organization-phase play or `recruit-character` events) while a
  manifestation of the same entity is in play for either player
  (`manifestationOfEntityInPlay`, consulted in
  `legal-actions/organization-characters.ts` and `recruit-via-event.ts`).
- **Rule 1.9 draft collisions** — two picks that are manifestations of the
  same entity (or same-named unique reprints) collide in the character
  draft and are both set aside (`resolveDraftRound` in `reducer-setup.ts`).

The `manifestation-swap` effect models the sanctioned replacement play
("You may bring Aragorn II into play with Strider's company, removing
Strider from the game and automatically transferring all cards on Strider
to Aragorn II"):

```json
{ "type": "manifestation-swap", "cardName": "Aragorn II" }
```

While the carrying character is in play in a company, the controller may
play the named character from hand as a `manifestation-swap` action. Per
CRF 22 (Strider) this is a resource-style play — offered wherever a normal
resource could be played (organization, movement/hazard, and site phase
aggregators via `legal-actions/manifestation-swap.ts`), never consuming
the one-character-per-turn slot. The reducer
(`handleManifestationSwap` in `reducer-organization.ts`, routed from all
three phases) brings the new manifestation into the old one's company at
the same position, untapped, transferring every attachment (items, allies,
hazards, trophies) and control relationship (`controlledBy`, followers,
leader-controlled in-play cards); the old manifestation's card goes to its
owner's out-of-play pile ("removed from the game").

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

### 15b. `play-flag: "block-company-joins"`

A `play-flag` carried by a company-bound permanent event (via
`CardInPlay.companyId`). Two effects:

1. **On play** — when the card enters play bound to a company, every ally and
   every direct-influence follower character in that company is discarded
   (`purgeCompanyAlliesAndFollowers` in `reducer-utils.ts`, fired from
   `chain-reducer.ts` `resolvePermanentEvent`).
2. **Ongoing** — while the card is in play, no ally and no DI follower may join
   the company. The ally-play emitter (`legal-actions/site.ts`) and the
   follower-play emitter (`legal-actions/organization-characters.ts`) both
   consult `companyBlocksJoins(state, companyId)`.

Used by Fell Rider (le-183): "Discard all allies and Ringwraith followers in
the company; none may join the company."

```json
{ "type": "play-flag", "flag": "block-company-joins" }
```

### 15c. `play-flag: "bearer-cannot-untap-until-stored"`

A `play-flag` carried by a storable permanent event that attaches to a
character on play. When present, the engine adds a `bearer-cannot-untap`
constraint on the bearer so that character may **not** untap during the untap
phase until the card is stored (the `store-item` handler clears the constraint
automatically). It is applied wherever the card attaches:

- via a `play-target` character tap cost (`chain-reducer.ts`),
- via a direct `storable-at` attachment without a triggered attack
  (`chain-reducer.ts`),
- via post-attack bearer selection for `trigger-attack-on-play` cards
  (`applySelectCardBearerResolution` in `pending-reducers.ts`).

Without the flag, a storable permanent event still taps its bearer on play (if
it declares a tap cost) but the bearer untaps normally next turn. Card-text
gate: "the character may not untap until this card is stored."

Carried by To Satisfy the Questioner (le-246), That's Been Heard Before Tonight
(le-241), Rescue Prisoners (tw-315), and The Windlord Found Me (dm-164).
Deliberately absent on That Ain't No Secret (le-240), whose text omits the
untap lock.

```json
{ "type": "play-flag", "flag": "bearer-cannot-untap-until-stored" }
```

### 15d. `play-flag: "grants-followers"`

Overrides the Balrog's default "may not have any followers" restriction
(CoE-BA rule, carried on The Balrog ba-3's own card text) when carried by an
item attached to the Balrog avatar. The restriction is enforced by
`isBalrogAvatarDef` at three DI-controller eligibility sites
(`legal-actions/organization-characters.ts`, `organization-companies.ts`,
`recruit-via-event.ts`); each now also checks
`hasFollowerGrantPermission(items, cardPool)` (`effects/play-flags.ts`,
scanning the bearer's attached items for this flag) and skips the exclusion
when it is present. Only the Balrog avatar is ever matched by
`isBalrogAvatarDef`, so this flag has no effect on any other character.

```json
{ "type": "play-flag", "flag": "grants-followers" }
```

Used by Great Shadow (ba-62): "The Balrog gains ... and may have followers."

### 15e. `play-flag: "playable-as-event"`

Marks a hazard that may be played either as a creature or as an event — the
Nazgûl (Adûnaphel, Ûvatha, …), the "manifestation" hunter creatures (Alatar the
Hunter, Lord of the Haven, …), Mouth of Sauron, the Wolf-riders, and the
Ungoliant-spawn spiders. Such dual creature/event hazards **count as half a
creature** for the 12-creature deck-construction requirement
(`deck-validation.ts`, CoE rule 1.5.1 / CRF 22 "Deck Construction"), the same
½-weight as an agent or a Dragon "Ahunt"/"At Home" manifestation. The flag is
purely declarative — presence is the whole payload.

```json
{ "type": "play-flag", "flag": "playable-as-event" }
```

### 15a. `extra-troll-leader-slot`

Marker effect on a company-bound permanent event. While this event is in play,
the company it is attached to may contain one Troll-race Leader-keyword character
*in addition to* the single leader normally permitted by CoE rule 3.26. The
exception allows exactly two leaders total, of which at least one must be a Troll.

The engine reads this effect in `organization-companies.ts`
`wouldViolateLeaderRestriction` when evaluating `move-to-company` and
`merge-companies` actions.

No fields beyond `type` are required.

```json
{ "type": "extra-troll-leader-slot" }
```

Used by *Orders from Lugbúrz* (as-94).

### 15b. `starting-company-placement`

Marker effect on a minion permanent event in a player's play deck. During the
item-draft setup step, the engine offers a `place-starting-company-event` action
for each company the player has formed. Executing this action moves the card from
the play deck directly into `cardsInPlay` bound to the chosen company and
increments `ItemDraftPlayerState.startingEventsPlaced`, which counts against the
same `MAX_STARTING_ITEMS` cap as minor items. This lets the card replace a minor
item in starting-company setup (CoE rule equivalent: "May be played with a
starting company in lieu of a minor item").

The effect is a pure marker — no fields beyond `type` are required. The engine
reads it in `legal-actions/item-draft.ts` when generating `place-starting-company-event`
actions, and the corresponding reducer handles placement in `reducer-setup.ts`.

```json
{ "type": "starting-company-placement" }
```

Used by *Orders from Lugbúrz* (as-94).

### 15c. `extra-leader-slot`

Marker effect on a company-bound permanent event. While this event is in play,
the company it is attached to may contain one additional Leader-keyword
character *in addition to* the single leader normally permitted by CoE rule
2.II.3.1.3, with no race restriction on either leader (contrast
`extra-troll-leader-slot`, which requires one of the two leaders to be a
Troll). Additionally, one Leader-keyword character in the company is exempted
from the company-size maximum of CoE rule 2.II.3.1 (max size 7 outside a
haven) — it does not count toward that headcount. Each copy of the carrying
card in play on a company stacks: two copies permit two additional leaders and
exempt two leaders from the size count.

The engine reads this effect in `organization-companies.ts`
`wouldViolateLeaderRestriction` (leader-count exemption, via
`countCompanyCardEffect`) and in `moveToCompanyActions`/`mergeCompaniesActions`
(size-cap exemption, via `companyEffectiveSizeExemptingLeaders` in
`reducer-utils.ts`). The size exemption applies only to the rule-3.24 headcount
cap enforced at those two call sites — it does not affect the hazard limit or
any `maxCompanySize` play-eligibility gate, which are separate mechanics the
card's text does not reference.

No fields beyond `type` are required.

```json
{ "type": "extra-leader-slot" }
```

Used by *Orders from the Great Demon* (ba-70).

### 16. `play-target`

Declares what this card targets when played. The engine uses this to
generate per-target actions (one per eligible character, company, etc.).

Character targeting is driven entirely by the DSL: the coarse `target`
category picks the scope (each character in scope is a candidate) and
an optional `filter` {@link Condition} refines it further. The filter
is evaluated against the per-candidate context
`{ target: { race, status, skills, name, mind, inAvatarCompany, itemKeywords, itemSubtypes, possessions }, company: { skills, siteType, moving, hasShadowMagicUser } }` (`target.mind` is the character's printed mind, null for avatars — e.g. Awaiting the Call le-165 filters `{ "target.mind": { "$lte": 6 } }`; `target.itemKeywords`/`target.itemSubtypes` aggregate the keywords/subtypes of every item the character bears, and `target.possessions` their names — e.g. The Roving Eye le-135 gates on bearing a Palantír (`itemKeywords $includes "palantir"`), a greater item (`itemSubtypes $includes "greater"`), or a non-gold ring (`itemKeywords $includes "ring"` and `$not itemSubtypes $includes "gold-ring"`)), so there are no
card-specific target keywords in the engine — a card declares its
audience directly via a condition expression.

`company.hasShadowMagicUser` is `true` when any character in the company is a
Ringwraith (race `"ringwraith"`) or has the `"shadow-magic"` skill (naturally
or via an item). Populated only for organization-phase permanent event
play-target evaluation. Used by *Well-preserved* (as-108).

`company.moving` is `true` when the candidate's company is moving. During the
**movement/hazard** phase it is the active, site-revealed company; during the
**organization** phase it reflects whether the company has already declared a
destination (`destinationSite` set by `plan-movement`, clearable by
`cancel-movement`). Used by *Hundreds of Butterflies* (dm-142, `true`, M/H
phase) and *Deeper Shadow* (le-179, `true`, M/H phase), and inverted by *Hide
in Dark Places* (le-192, `false`, organization phase — "a scout whose company
is not moving").

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
- `site` — the company's destination/current site (e.g. River). The `filter`
  matches against the site definition's own fields (`siteType`, `region`,
  `lairOf`, `adjacentSites`, `keywords`, …) **plus** a synthetic `regionType`
  field — the {@link RegionType} of the region the site sits in, resolved via
  `siteRegionTypeOf` and injected at match time (the region's type lives on a
  separate region card, not on the site). This lets a site filter gate on the
  site's own region type, e.g. Hidden Haven (wh-75): `{ "$and": [ {
  "siteType": "ruins-and-lairs" }, { "lairOf": { "$exists": false } }, {
  "adjacentSites": { "$exists": false } }, { "regionType": { "$in":
  ["wilderness", "border", "shadow"] } } ] }`.
- `item` — a resource permanent event played "with" / "on" an **item** borne by
  one of the active player's own characters (site-phase only). One
  `play-permanent-event` action is emitted per company-character item whose
  definition matches the `filter` (evaluated against `{ target: { name,
  keywords, subtype } }`); the chosen item rides on the action's
  `targetItemInstanceId`. On resolution the card enters its controller's
  `cardsInPlay` bound via `CardInPlay.attachedToItem`, and its `stat-modifier`
  effects flow to the item's bearer (collected in `collectCharacterEffects`
  exactly as if printed on the item). The card is discarded by the
  `discardOrphanedItemAttachedEvents` post-action sweep once no character bears
  the host item. A companion `play-condition` `requires: "site-type"` gates the
  site (e.g. Ruins & Lairs); `duplication-limit` `scope: "item"` limits copies
  per item; `play-flag: "tap-bearer-on-play"` taps the bearer as the play cost
  (so the bearer must be untapped). Used by Barrow-blade (dm-119): "Tap the
  bearer of a Dagger of Westernesse during the site phase at a Ruins & Lairs
  [{R}] and play this with the Dagger. Dagger receives +1 prowess (+3 versus
  Undead and Nazgûl). Cannot be duplicated on a given Dagger."

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
    check modified by N (e.g. One Ring, Vanishment, Wizard's Laughter). For a
    character-targeting hazard short-event the check is enqueued on the target
    when the chain entry resolves (e.g. Dragon-sickness td-18, modifier -1).
    An optional `failureMode` refines the failure consequence:
    `"discard-ring-only"` discards only the bearer's Ring on a failed check
    (The Ring's Betrayal); `"discard-instead-of-eliminate"` downgrades any
    would-be *elimination* to a plain discard of the character + his
    non-follower possessions (The Roving Eye le-135).
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
  and discards the ring regardless of result (Rule 9.21 / 9.22), then
  unconditionally enqueues a `ring-play-offer` resolution so the player
  may immediately play a matching special ring item in its place (or
  pass), per the replacement step of Rule 9.21 — implemented in
  `applyGoldRingTestResolution`/`applyRingPlayOfferResolution`
  (`engine/pending-reducers.ts`) and `ringPlayOfferActions`
  (`engine/legal-actions/pending.ts`). Requires that the gold-ring item
  also declares `storable-at` for the site.

  ```json
  { "type": "site-rule", "rule": "auto-test-gold-ring", "rollModifier": -2 }
  ```

- `attacks-not-detainment` — forces attacks against a company at this
  site to be resolved as normal attacks rather than detainment,
  overriding the default CoE §3.II.2 R1/R2/R3 and B1/B2/B3 rules and
  any keying-based detainment. The optional `filter` is a standard DSL
  condition evaluated against `{ enemy: { race }, attack: { automatic } }`
  — `enemy.race` is the attacking creature's race; `attack.automatic` is
  `true` only for the site's own listed automatic-attack (static or the
  dynamically-played `dynamic-auto-attack` 2nd attack) and `false` for a
  hazard creature played normally against the company. The override only
  applies when the attack matches. A missing filter applies the override
  to every attack at the site. Consumed by `engine/detainment.ts` (both
  hazard-creature and automatic-attack call sites). Used by *Moria*
  (le-392) and its twin shadow-holds whose text reads "non-Nazgûl
  creatures played at this site attack normally, not as detainment."

  ```json
  { "type": "site-rule", "rule": "attacks-not-detainment",
    "filter": { "enemy.race": { "$ne": "nazgul" } } }
  ```

  `attack.automatic` lets a site's own automatic-attack keep a
  separately-declared `combat-detainment` effect while every other attack
  at the site is exempted — used by *The Under-leas* (ba-102): "Creatures
  keyed to this site attack normally, not as detainment" alongside a 1st
  automatic-attack that is itself unconditionally detainment.

  ```json
  { "type": "site-rule", "rule": "attacks-not-detainment",
    "filter": { "attack.automatic": false } }
  ```

- `keyed-creatures-detainment` — forces attacks at this site to be
  resolved as detainment whenever the attacking hazard creature is keyed
  to the site *by name* (a `keyedTo` entry whose `siteNames` includes
  this site's own name, e.g. Watcher in the Water's "May also be played
  at Moria" alternate keying). Unlike the default CoE §3.II.2 R1-R3/B1-B3
  rules (which only ever produce detainment for Ringwraith/Balrog
  defenders), this rule applies regardless of the defending player's
  alignment — the detainment status is a property of the site, not the
  defender. Consumed by `engine/detainment.ts`
  (`isDetainmentAttack`/hazard-creature call site in
  `chain-reducer.ts::initiateCreatureCombat`). Used by Moria (ba-93):
  "Creatures keyed to this site are/attack as detainment."

  ```json
  { "type": "site-rule", "rule": "keyed-creatures-detainment" }
  ```

- `attacks-are-detainment` — mirror of `attacks-not-detainment`: forces
  every attack against a company at this site to be treated as
  detainment, overriding the default CoE §3.II.2 R1/R2/R3 and B1/B2/B3
  computation even when the attacker's race/keying or the defending
  alignment would not otherwise make it so. Consumed by
  `engine/detainment.ts` (checked before the default computation, same
  call sites as `attacks-not-detainment`). Used by *The Under-gates*
  (ba-100), a Balrog Darkhaven printed as a Haven site type: "Creatures
  keyed to this site attack as detainment."

  ```json
  { "type": "site-rule", "rule": "attacks-are-detainment" }
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

- `sage-tap-ring-test` — an active, player-initiated ring test granted by the
  site. During the **organization phase**, for each of the player's companies
  whose current site declares this rule, any untapped **sage** in that company
  may tap (`test-ring-at-site` action) to test a gold-ring item borne by a
  character in the same company. Tapping the sage is the cost; the test reuses
  the shared `gold-ring-test` resolution (2d6 roll with `rollModifier` applied,
  ring discarded, matching special ring offered). Unlike `auto-test-gold-ring`
  (fires on store) and `site-phase-ring-auto-test` (fires automatically at
  company selection), this rule is optional and chosen by the player. Emitted by
  `legal-actions/organization.ts` `siteSageRingTestActivations()` and consumed by
  `engine/reducer-organization.ts` `handleTestRingAtSite()`. Used by *Mount Doom*
  (le-393) — "Any sage may tap to test a ring at this site, modifying the result
  by -3."

  ```json
  { "type": "site-rule", "rule": "sage-tap-ring-test", "rollModifier": -3 }
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
  entries. The bypass feeds normal hazard-creature play against a company at
  the site (`engine/legal-actions/movement-hazard.ts`
  `siteAllowsCreatureByRace`). It **also** feeds the site's
  `dynamic-auto-attack` eligibility (`engine/legal-actions/site.ts` — such a
  creature becomes a legal choice for the opponent's dynamically-played 2nd
  automatic-attack), but only when that attack keys by **site-type** (being
  keyed to *this site* satisfies a site-type requirement); a **region-type**
  keyed auto-attack (e.g. Coastal Seas) is not fed, since keying to this site
  grants no region keying. Both paths delegate the rule test to
  `reducer-utils.ts` `siteRuleAllowsCreatureByRace`. An optional `except`
  condition (evaluated
  against the creature's card definition via the standard DSL matcher)
  excludes matching creatures from the bypass. Used by *Geann a-Lisch*
  (as-138) — "Any Man hazard creature can be played at this site." — and by
  *The Iron-deeps* (ba-91) — "Any Drake creature (except Sea Serpent) may be
  keyed to this site."

  ```json
  { "type": "site-rule", "rule": "allow-creature-by-race", "race": "men" }
  ```

  ```json
  { "type": "site-rule", "rule": "allow-creature-by-race", "race": "drake",
    "except": { "name": "Sea Serpent" } }
  ```

- `allow-creature-by-keying` — bypasses the normal keying check for hazard
  creatures whose own `keyedTo` names one of the region-types/site-types in
  the rule's `keying` filter (same shape as `dynamic-auto-attack.keying`).
  Such a creature keys as if the site matched its keying, so it may be played
  against a company whose effective site (destination if moving, else current)
  carries this rule. Distinct from `allow-creature-by-race` (which keys on the
  creature's race). Feeds only the normal M/H hazard-creature play path — not
  the site's `dynamic-auto-attack`, whose own `keying` filter already governs
  auto-attack eligibility. Consumed by
  `engine/legal-actions/movement-hazard.ts` `siteAllowsCreatureByKeying`. Used
  by *The Drowning-deeps* (ba-89) and *Remains of Thangorodrim* (ba-95) —
  "Creatures keyed to Coastal Seas may be keyed to this site."

  ```json
  { "type": "site-rule", "rule": "allow-creature-by-keying",
    "keying": { "regionTypes": ["coastal"] } }
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

- `deep-mines-movement` — marks a Fallen-wizard site as an Under-deeps-style
  destination reachable **only** from one of the moving player's *protected
  Wizardhavens* (a Wizardhaven for that player — `isHavenForPlayer` — that also
  carries an active `site-protected` constraint owned by them) and **only** while
  he has more than six stage points. The surface Wizardhaven and the site are
  adjacent with a required movement roll of 0, so the descent auto-succeeds like
  a roll-0 Under-deeps step; the adjacency runs both ways, so a company at the
  site may ascend back to a protected Wizardhaven at roll 0 (no stage-point gate
  on the ascent). The site is never reachable via ordinary starter/region
  movement. The stage-point requirement is enforced at both the plan-movement
  offer and the M/H declare-path (reveal) offer, so a drop below the threshold
  before movement leaves the company put (rule 5.04 / CRF 22: it "does not move
  at all"). The card's "Cannot be duplicated on a given Wizardhaven" clause is
  enforced by rule 2.II.7.1 (no two same-origin companies to the same site
  definition). Descent/ascent legality lives in `legal-actions/organization-companies.ts`
  (`isDeepMinesDescentLegal` / `isDeepMinesAscentLegal`), consumed by the
  plan-movement pass there and the declare-path pass in `legal-actions/movement-hazard.ts`.
  Used by *Deep Mines* (wh-55). Pair with `{ stage-points, whileCompanyAtSite }`
  for the site's occupancy stage points.

  ```json
  { "type": "site-rule", "rule": "deep-mines-movement" }
  ```

### 20. `item-play-site`

Restricts an item to be playable only where the company's current site
satisfies a constraint. Two mutually-exclusive forms:

- `sites`: site name must appear in the list (e.g. Palantír of Orthanc —
  Isengard only).
- `filter`: a generic site-card condition evaluated against
  `{ site: <site definition> }` (e.g. hoard items: any site whose
  definition has `hoard: true`). The site context is augmented with
  `autoAttackRaces` — the normalized races of the site's
  automatic-attacks — so a filter can match "a site with a Dwarf
  automatic-attack" via `{ "site.autoAttackRaces": { "$includes": "dwarf" } }`.

When present, the normal site-type check (`playableResources`) is
bypassed; the item is playable only if its restriction matches.

The optional `allowTapped: true` flag additionally bypasses the
tapped-site gate, so the item may be played even when its company's
current site is Tapped (the site-restriction still gates *which* tapped
sites qualify). Used by *Blasting Fire* (wh-51) and *Vile Fumes* (wh-54):
"Playable at a tapped or untapped Shadow-hold, Dark-hold, or a site with a
Dwarf automatic-attack." Implemented in `legal-actions/site.ts`.

The optional `doesNotTapSite: true` flag suppresses the "playing a resource
taps the site" rule for this play, so the site is left in whatever state it
was. Combine with `allowTapped` for "playable at a tapped or untapped X (does
not tap the site)". Used by *Helm of Fear* (as-126), playable at Barad-dûr.
Implemented in `reducer-site.ts`.

```json
{ "type": "item-play-site", "sites": ["Barad-dûr"],
  "allowTapped": true, "doesNotTapSite": true }
```

```json
{ "type": "item-play-site", "sites": ["Isengard"] }
```

```json
{ "type": "item-play-site", "filter": { "site.hoard": true } }
```

```json
{ "type": "item-play-site", "allowTapped": true,
  "filter": { "$or": [
    { "site.siteType": { "$in": ["shadow-hold", "dark-hold"] } },
    { "site.autoAttackRaces": { "$includes": "dwarf" } }
  ] } }
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

- `card-in-play` — the inverse: the card is only playable while a named
  card **is** in play (as a character or in any player's cardsInPlay). The
  `cardName` field names the required card. Enforced for hazard
  long-events in `legal-actions/movement-hazard.ts`. Used by Snowstorm
  (tw-91): "Playable if Doors of Night is in play." On a **faction** the gate
  is evaluated against the controller's OWN in-play names (so an opponent's
  copy of the named card does not satisfy "if **you** have … in play") —
  used by Half-orcs (wh-87) / Greater Half-orcs (wh-86) ("if you have A
  Strident Spawn in play"). On a **resource short-event** the gate is likewise
  evaluated against the playing player's own in-play cards, *including
  character-attached permanent events* (`isCardNameInPlayForPlayer`,
  `legal-actions/organization.ts`) — used by Terror Heralds Doom (ba-78),
  "Playable during the organization phase if Flame of Udûn is in play" (Flame of
  Udûn is a permanent-event held in The Balrog's items).

```json
{ "type": "play-condition", "requires": "card-in-play", "cardName": "Doors of Night" }
```

- `site-protected` — (takes no extra fields) on a **faction** the influence
  attempt is only offered when the company's current site is **protected by
  the controller**: an active `site-protected` constraint (added by a stage
  permanent-event such as Guarded Haven wh-74) bound to the site's definition
  id and owned by the player attempting the play. Protection by the opponent,
  or no protection, does not qualify. Checked in `legal-actions/site.ts`
  (`siteIsProtectedByPlayer`). Used by Half-orcs (wh-87) / Greater Half-orcs
  (wh-86): "Playable at one of your protected Wizardhavens [{H}]".

```json
{ "type": "play-condition", "requires": "site-protected" }
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

- `active-company` — for site-phase resource short-events **and site-phase
  permanent-events**: a generic DSL `condition` evaluated against the active
  company's aggregate context
  `{ site: { name, type }, company: { itemNames, characterNames, allyNames } }`.
  `itemNames`/`allyNames` are the names of every item / ally borne by any
  character in the company. Lets a card express a positional play
  prerequisite without a per-card keyword. Used by the CoE 10.39 win cards:
  Cracks of Doom (tw-205) requires The One Ring at Mount Doom; Gollum's Fate
  (tw-247) additionally requires Gollum. Implemented in
  `legal-actions/organization.ts` (`playResourceShortEventActions`,
  `buildActiveCompanyContext`).

  A **Stage** permanent-event that carries an `active-company` play-condition
  declares its own site-phase timing, an explicit exception to rule 5.F1 (Stage
  resource permanent-events are otherwise organization-phase only). Such a card
  is evaluated against the active company in the site-phase play path
  (`legal-actions/site.ts`) and is **never** offered during the organization
  phase (`legal-actions/organization-events.ts` skips any permanent-event with
  an `active-company` play-condition). Used by Delver's Harvest (wh-65):
  "Playable during the site phase if one of your companies enters the Deep Mines
  site." — a bare Stage permanent-event worth 1 miscellaneous MP, gated by
  `{ "site.name": "Deep Mines" }`.

```json
{ "type": "play-condition", "requires": "active-company",
  "condition": { "$and": [
    { "site.name": "Mount Doom" },
    { "company.itemNames": { "$includes": "The One Ring" } },
    { "company.allyNames": { "$includes": "Gollum" } }
  ] } }
```

- `company-context` — for **character-targeting permanent-events**: a generic
  DSL `condition` evaluated against the **play-target character's company**
  (per target company in the organization + site phase char-target play paths),
  exposing `{ site: { name, type, isOwnWizardhaven }, company: { characterNames,
  itemNames, allyNames, playedUniqueHeroFactionAtFreeHold } }`. `itemNames`
  aggregates every item / attached permanent event borne by any character in the
  company, so a card can gate on "in the same company as `<named card>`" (the
  named card being attached to a company-mate). `site.isOwnWizardhaven` is `true`
  when the company's current site is one of the **player's own Wizardhavens** (a
  Fallen-wizard haven, or a Hidden-Haven-converted site) — the meaning of "at one
  of your Wizardhavens [{H}]", distinct from a generic METW Haven / MELE Darkhaven
  that merely shares `type: "haven"`. `playedUniqueHeroFactionAtFreeHold` is
  `true` only during the site phase and only once the active company has, this
  site phase, successfully played a unique hero faction at a Free-hold that is
  not Bag End (tracked on `SitePhaseState.uniqueHeroFactionPlayedAtFreeHold`,
  set in `resolveInfluenceAttemptRoll`). Distinct from `active-company` (which is
  for short-events against the site-phase active company); evaluated by
  `matchesCompanyContextCondition` in `legal-actions/organization-events.ts` and
  `legal-actions/site.ts`. Used by To Fealty Sworn (ba-33): "Playable on a
  Hobbit: in the same company as Return of the King or during the same site
  phase his company plays a unique hero faction at a Free-hold [{F}] (not Bag
  End)."; and Squire of the Hunt (wh-95): "Playable on one of your warrior
  characters at one of your Wizardhavens [{H}]" via
  `{ "site.isOwnWizardhaven": true }`.

```json
{ "type": "play-condition", "requires": "company-context",
  "condition": { "$or": [
    { "company.itemNames": { "$includes": "Return of the King" } },
    { "company.playedUniqueHeroFactionAtFreeHold": true }
  ] } }
```

- `player-state` — for resource short-events **and** permanent-events: a
  generic DSL `condition` evaluated against the active player's
  avatar/alignment context, built once by `buildPlayerStateContext`
  (`legal-actions/organization.ts`) and shared across all three evaluation
  sites (organization short-events, organization permanent-events, site phase):
  `{ player: { alignment, avatar, hasRingwraithInPlay, stagePoints, factionCount, hasProtectedWizardhaven }, opponent: { alignment }, inPlay: [<names>] }`.
  - `player.alignment` / `opponent.alignment` — card-text alignment string
    (`"wizard"`, `"ringwraith"`, `"fallen-wizard"`, `"balrog"`).
  - `player.avatar` — the **name** of the player's revealed avatar (e.g.
    `"Pallando"`, `"Saruman"`), or absent if none is in play.
  - `player.hasRingwraithInPlay` — `true` when the player has a Ringwraith-race
    avatar character in play.
  - `player.stagePoints` — the Fallen-wizard's current stage-point total.
  - `player.factionCount` — the number of faction cards the active player
    controls in play (factions held under a leader's control included).
  - `player.hasProtectedWizardhaven` — `true` when the player controls a
    protected Wizardhaven (a Fallen-wizard haven / converted Wizardhaven carrying
    a `site-protected` constraint for that player).
  - `inPlay` — the list of card names the active player has in play, so a
    condition can require a named prerequisite via `{ "inPlay": "<name>" }`.

  Lets a card gate on the opposing player's alignment, the controller's revealed
  avatar, stage points, faction count, a protected Wizardhaven, or named in-play
  prerequisites without a per-card keyword. Used by *Above the Abyss* (as-77):
  "if your opponent is a Wizard and your Ringwraith is in play"; *Gatherer of
  Loyalties* (wh-70): "Playable if you have more than 3 stage points"; *A
  Strident Spawn* (wh-61): "Playable if you are Pallando or Saruman and have 6 or
  more stage points and a protected Wizardhaven"; and *The White Hand* (wh-122):
  "Playable on Saruman if he has … at least 12 stage points, at least 3 factions,
  A Strident Spawn, and Saruman's Machinery." Implemented in
  `legal-actions/organization.ts` (`buildPlayerStateContext`) and consumed by the
  short-event, permanent-event, and site-phase play paths.

```json
{ "type": "play-condition", "requires": "player-state",
  "condition": { "$and": [
    { "opponent.alignment": "wizard" },
    { "player.hasRingwraithInPlay": true }
  ] } }
```

```json
{ "type": "play-condition", "requires": "player-state",
  "condition": { "$and": [
    { "player.avatar": { "$in": ["Pallando", "Saruman"] } },
    { "player.stagePoints": { "$gte": 6 } },
    { "player.hasProtectedWizardhaven": true }
  ] } }
```

- `region-through-or-leave` — for hazard short-events played on a moving
  company during M/H: the company must be using **region** movement
  (`movementType === 'region'`) and must either *leave* one of the named
  `regionNames` (the origin region of the path) or *move through* one
  without stopping at a site therein (an intermediate region). The region
  where the company stops at a site — the **destination region**, i.e. the
  last entry of the resolved region path — never qualifies. Implemented as
  `checkRegionThroughOrLeave` in `legal-actions/movement-hazard.ts`: a named
  region must appear in `resolvedSitePathNames` excluding its last element.
  Used by *Cruel Caradhras* (td-9).

```json
{ "type": "play-condition", "requires": "region-through-or-leave",
  "regionNames": ["High Pass", "Redhorn Gate", "Angmar", "Gundabad",
                  "Grey Mountain Narrows", "Imlad Morgul"] }
```

- `company-site` — for hazard short-events played during the M/H play-hazards
  step: a generic DSL `condition` is evaluated against the active company's
  **relevant site** — its `destinationSite` when moving, otherwise its
  `currentSite` — exposing `{ site: { name, siteType, region, keywords } }`.
  Lets a hazard gate on where the targeted company is (or is moving to) without
  a per-card keyword. Implemented in the play-hazards block of
  `legal-actions/movement-hazard.ts`. Used by *Glance of Arien* (ba-19):
  "Playable on The Balrog at or moving to a non-Under-deeps site."

```json
{ "type": "play-condition", "requires": "company-site",
  "condition": { "$not": { "site.keywords": { "$includes": "under-deeps" } } } }
```

- `site-protected` — for site-attached permanent-events (`play-target` target
  `site`): the site the card is being played on (the active company's current
  site) must already be **protected** for the playing player, i.e. carry an
  active `site-protected` constraint owned by that player (added by The Fortress
  of Isen wh-68 / Fortress of the Towers wh-69 / Guarded Haven wh-74). No extra
  payload. Implemented in `legal-actions/site.ts` alongside the other
  permanent-event play-conditions. Used by *Saruman's Machinery* (wh-120):
  "Playable … on your protected Isengard or your protected The White Towers."

```json
{ "type": "play-condition", "requires": "site-protected" }
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

`body` is **optional**: when omitted the attack has no printed body — a
successful strike still wounds (body check vs the character's own body), but a
defeated strike triggers no "body check vs creature". Region-attack cards whose
attacks list only strikes/prowess (e.g. Mordor in Arms dm-72) use this.

A single card may carry **multiple** `ahunt-attack` effects; each matching
effect fires as its own combat in order-effects sequence. Two optional fields
support grouped multi-attack cards:

- `noEffectOnMinion: true` — the attack is skipped when the moving (defending)
  player is a Ringwraith/Sauron (minion) player. Models "This card has no
  effect on a minion player."
- `groupReward: { toDefenderKillPile: true }` — when **every** ahunt attack
  sourced from this same card instance during a company's order-effects step is
  defeated, the card is moved from play into the defending (moving) player's
  kill pile (where a companion `mp-in-pile` effect scores the reward MPs).
  Models "If all three attacks are defeated by your opponent, he receives this
  card in his MP pile." Per-attack outcomes are recorded by `finalizeCombat`
  into `MovementHazardPhaseState.ahuntGroupOutcomes` and evaluated by
  `handleOrderEffects` (`applyAhuntGroupRewards`) once all attacks resolve.

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

Mordor in Arms (dm-72) — three grouped attacks in Nurn, no body, reward on full
defeat:

```json
[
  { "type": "ahunt-attack", "regionNames": ["Nurn"], "strikes": 5, "prowess": 8, "race": "orc", "noEffectOnMinion": true },
  { "type": "ahunt-attack", "regionNames": ["Nurn"], "strikes": 4, "prowess": 10, "race": "orc", "noEffectOnMinion": true },
  { "type": "ahunt-attack", "regionNames": ["Nurn"], "strikes": 3, "prowess": 12, "race": "troll", "noEffectOnMinion": true, "groupReward": { "toDefenderKillPile": true } },
  { "type": "mp-in-pile", "category": "kill", "value": 2 }
]
```

Implemented in `reducer-movement-hazard.ts` (`handleOrderEffects`,
`collectMatchingAhuntAttacks`), with group rewards in `mh-steps.ts`
(`applyAhuntGroupRewards`) and outcome recording in `combat-finalize.ts`.

### 25a. `faction-influence-restriction`

Environment carried by an in-play hazard permanent-event. While in play, a
character's faction-influence attempt made at a site located in one of
`regionNames` is modified by `modifier` (typically negative), and any one-shot
influence check-modifier boost sourced from a card named in `blockCards` is
suppressed for that attempt ("cannot be done with Muster"). When
`noEffectOnMinion` is set, the restriction is ignored if the influencing
(resource) player is a Ringwraith/Sauron (minion) player.

Applied by both the influence-attempt legal-action generator (so the displayed
`need` reflects the penalty and the suppressed boost) and the roll resolver, via
the shared `collectFactionInfluenceRestriction` helper (`reducer-utils.ts`).

```json
{ "type": "faction-influence-restriction",
  "regionNames": ["Horse Plains", "Khand", "Harondor", "Nurn", "Gorgoroth", "Imlad Morgul", "Udûn"],
  "modifier": -6,
  "blockCards": ["Muster"],
  "noEffectOnMinion": true }
```

Used by Mordor in Arms (dm-72).

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
| `fetch-to-deck` | `{ select: 'target', from: ['sideboard','discard'], to: 'deck', shuffleAfter: true, filter, count }` | Smoke Rings, Longbottom Leaf |
| `bounce-hazard-events` | `{ select: 'filter-all', from: 'attached-to-target-company', to: 'hand', toOwner: 'opponent', filter, corruptionCheck }` | Wizard Uncloaked |
| `sideboard-self-to-deck` | `{ select: 'self', from: ['sideboard'], to: 'deck', shuffleAfter: true }` | Terror Heralds Doom (ba-78) |

A `select: 'self'` move with `from: ['sideboard']`, `to: 'deck'` models the
Balrog sideboard family's "You may bring this card from your sideboard into
your play deck and reshuffle during your organization phase." `locateSelf`
(reducer-move.ts) scans the sideboard for the source card. The organization
phase offers it as a dedicated `card-sideboard-to-deck` action —
`cardSideboardToDeckActions` (legal-actions/organization-sideboard.ts) emits one
per sideboard card carrying such a move; `handleCardSideboardToDeck`
(reducer-organization.ts) applies it. This is card-granted and taps nothing —
distinct from the CoE 2.II.6 avatar-tap sideboard access.

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
- `removeFromGame: true` (fetch-to-deck moves only) — once the interactive
  fetch resolves (whether the player took the maximum, took fewer, or passed
  with none), the spent event card is routed to the owner's out-of-play pile
  instead of the discard pile, so it can never be recurred. Backs "Remove this
  card from the game." on *Longbottom Leaf* (ba-30): "Take up to two resources
  from your sideboard to your play deck and reshuffle. Remove this card from
  the game." (`from: ['sideboard']`, `count: 2`, resources-only filter,
  `removeFromGame: true`).

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
- `controller.factionRaces` — the distinct races of factions the player performing the check already has in play (populated during faction-influence checks; the faction being influenced is in hand and so excluded). Use this for Standard Modifications keyed on the *kind* of faction rather than a specific name, e.g. Uruk-hai (le-291) takes "Any other Orc faction (-2)": `{ "when": { "controller.factionRaces": "orc" } }`. Because a single `check-modifier` contributes its value once, the "applied only once" wording is honoured even with several matching factions in play.
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

**Hazard short-events.** `play-option` is also honoured on character-targeting
*hazard* short-events (e.g. Weariness of the Heart le-149). The legal-action
generator (`legal-actions/movement-hazard.ts`) emits one `play-hazard` action
per (character, option) pair, carrying the chosen `optionId` on the action and
threading it onto the short-event chain payload (`reducer-movement-hazard.ts`).
When the chain entry resolves un-negated, the chain resolver
(`chain-reducer.ts`) dispatches the selected option's `apply`. The two apply
kinds supported on this path are `add-constraint` with
`constraint: "character-stat-modifier"` (a turn-scoped `stat`/`value` modifier
on the targeted character — e.g. le-149's `-1` prowess) and `force-check` with
`check: "corruption"` (enqueues a corruption check on the targeted character).
A Corruption-keyword short-event also marks the target in
`corruptionCardsPlayedPerChar`, so CoE rule 7.2.1 (one corruption card per
character per turn) blocks a second copy — this is how le-149's "this use
cannot be duplicated on a given character" is enforced.

A character-targeting hazard short-event that carries **no** `play-option` (a
fixed, non-choice modifier) applies its `character-stat-modifier` constraints
via `on-event: self-enters-play` → `add-constraint` instead. On chain
resolution `applyShortEventSelfEntersPlayConstraints` (`chain-reducer.ts`)
targets the short-event's chosen character (`targetCharacterId`) and evaluates
each effect's optional `when` clause against `{ inPlay: [...card names...] }`,
so a doubled modifier can be gated on a companion card being out. Used by
*Glance of Arien* (ba-19): two base effects (prowess `-2`, body `-1`) plus two
more gated `when: { "inPlay": "Gates of Morning" }` (a further prowess `-2` /
body `-1`, for `-4`/`-2` total while Gates of Morning is in play). The
turn-scoped constraints stack in the effective-stats resolver, and the
`duplication-limit` `scope: "turn"` (counting active constraints left by a
resolved copy) enforces "Cannot be duplicated on a given turn".

### Weariness of the Heart

```json
"effects": [
  { "type": "play-target", "target": "character" },
  { "type": "play-option", "id": "prowess",
    "apply": { "type": "add-constraint", "constraint": "character-stat-modifier",
               "stat": "prowess", "value": -1, "scope": "turn" } },
  { "type": "play-option", "id": "corruption",
    "apply": { "type": "force-check", "check": "corruption" } }
]
```

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

Overrides who, and at what cost, may control the bearing character (CoE
"influence to control"). Carried by a resource permanent-event played on one of
your own characters (Wizard's Myrmidon wh-84, The Forge-master wh-117) or by an
item. Two independent, optional fields:

- `cost` — replaces the bearer's printed `mind` as the influence-to-control
  value in *every* control context: the general-influence cost to keep the
  character, the direct-influence a controller spends to hold it as a follower,
  the move-to-influence reassignment checks, and the threshold an opponent must
  beat to influence it away. It deliberately does **not** touch the character's
  `mind` for combat/setup purposes (defender-prowess-from-mind, tap-low-mind,
  the Fallen-wizard mind≤5 setup gate).
- `sources` — restricts which control sources may hold the character under
  direct influence. General influence is always permitted; a non-general
  (direct-influence) controller is allowed only when `"fallen-wizard"` is listed
  and that controller is the player's Fallen-wizard avatar. With no `sources`,
  any normal direct-influence controller is allowed.

```json
{ "type": "control-restriction", "cost": 3, "sources": ["general", "fallen-wizard"] }
```

Every influence-to-control read routes through `engine/control-cost.ts`
(`controlCostOf`, `directInfluenceControlAllowed`), consumed in
`recompute-derived.ts` (GI accounting), `legal-actions/organization.ts`
(follower DI), `legal-actions/organization-companies.ts` (move-to-influence),
`reducer-organization.ts` (move-to-influence reducer guard), `reducer-site.ts`
and `reducer-movement-hazard.ts` (opponent/agent influence-away threshold).

> Note: the separate "this character cannot be controlled by direct influence at
> all" rule (Rebel-talk le-132) is the `no-direct-influence` **play-flag**, not
> this effect — see the play-flag list.

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
- `attacks: TriggerAttackEntry[]` — **multi-attack form**: an array of
  `{ creatureType, strikes, prowess }` entries triggered in sequence
  (the top-level `creatureType`/`strikes`/`prowess` are ignored). Each
  entry runs as its own combat; the next starts as the previous
  finalizes (`combat-finalize.ts` chains them via `remainingAttacks`).
- `afterAttack: "attach-with-constraint" | "move-to-mp-pile"` — post-attack
  placement. `"attach-with-constraint"` (default) attaches the card to the
  bearer's items with a `bearer-cannot-untap` constraint (Rescue Prisoners);
  `"move-to-mp-pile"` taps the chosen character and leaves the card in
  `cardsInPlay` (Burning Rick le-173, Descent through Fire ba-56).
- `discardFactionsAtSite: boolean` — after bearer selection, discard any of the
  active player's in-play factions playable at the company's current site.
- `returnFactionsAtSite: boolean` — after the `move-to-mp-pile` keep, return
  every **unique** faction in play — belonging to *either* player — that is
  playable at the company's current site to its **owner's** hand (Tempest of
  Fire ba-77). Distinct from `discardFactionsAtSite`: it scans both players'
  `cardsInPlay`, is limited to unique factions, and returns to hand (via the
  instance-id owner prefix) rather than discarding. No return happens on a
  discard (decline) of the card.
- `creatureTypeBySiteType: Record<siteType, creatureType>` — resolve every
  triggered attack's creature type from the played site's type instead of the
  fixed per-attack `creatureType`, at play time (Tempest of Fire ba-77: "Men at
  a Border-hold, Orcs at a Shadow-hold" → `{ "border-hold": "Men",
  "shadow-hold": "Orcs" }`). A site type absent from the map falls back to the
  attack entry's printed `creatureType`. Applied to the first attack and every
  `remainingAttacks` entry so the whole sequence shares the resolved race.

**Restricting the keep target.** After the attacks, the bearer offered by the
`select-card-bearer` resolution honours the card's `play-target: character`
filter, if any. A card with no filter (Rescue Prisoners, Burning Rick, The
Windlord Found Me) offers every untapped company member; Descent through Fire
(ba-56) carries `{ "target.name": "The Balrog" }` so only The Balrog may be
tapped to keep it ("tap The Balrog or discard this card"). If no untapped
character satisfies the filter, only `pass` (discard) is available.

**Ongoing effects while kept.** A `move-to-mp-pile` card may also carry ongoing
effects (e.g. Descent through Fire's "+1 prowess to all your characters, +1
direct influence to all your leaders" — two `own-characters` `stat-modifier`
effects). Such a card enters `cardsInPlay` *before* the attacks it triggers, so
the entry is flagged `pendingTriggerAttack` (`CardInPlay`) while the attacks
resolve — `collectGlobalEffects` ignores a pending card's effects, so the buff
does **not** help the company survive its own attacks. The flag is cleared when
the card is kept (the bearer is chosen); the card is discarded otherwise. Note
`computeCombatProwess` collects `own-characters` effects (scoped to the
character's controller) so such a buff applies during later real combats too.

Implementation: `chain-reducer.ts` `resolvePermanentEvent()` detects
the effect, places the card, sets `state.combat` with an `attackSource` of type
`card-triggered-attack`, and stamps `pendingTriggerAttack`. `combat-finalize.ts`
`finalizeCombat()` chains the remaining attacks then runs the discard-or-keep
logic (`select-card-bearer` pending resolution). `legal-actions/pending.ts`
`selectCardBearerActions()` applies the bearer filter; `pending-reducers.ts`
`applySelectCardBearerResolution()` taps the bearer, clears
`pendingTriggerAttack` (move-to-mp-pile) or adds `bearer-cannot-untap`
(attach-with-constraint). `reducer-untap.ts` skips characters with an active
`bearer-cannot-untap` constraint; `handleStoreItem()` sweeps it on store.

Used by *Rescue Prisoners* (tw-315, single-attack form):

```json
{ "type": "trigger-attack-on-play", "creatureType": "Spider", "strikes": 2, "prowess": 7 }
```

Used by *Descent through Fire* (ba-56, multi-attack + move-to-mp-pile + buffs):

```json
{
  "type": "trigger-attack-on-play",
  "attacks": [
    { "creatureType": "Trolls", "strikes": 5, "prowess": 8 },
    { "creatureType": "Trolls", "strikes": 4, "prowess": 10 },
    { "creatureType": "Trolls", "strikes": 3, "prowess": 12 }
  ],
  "afterAttack": "move-to-mp-pile"
}
```

Used by *Tempest of Fire* (ba-77, dynamic race by site type + faction return).
Playable at an untapped Border-hold/Shadow-hold that is neither an Under-deeps
site nor the surface site of one — the `play-target: site` filter gates on
`siteType`, `$not keywords $includes under-deeps`, and `isUnderDeepsSurface:
false` (a boolean the site-phase play path adds to the match context via
`isUnderDeepsSurfaceSite`, true for a site named at roll 0 in some Under-deeps
site's `adjacentSites`):

```json
{
  "type": "trigger-attack-on-play",
  "attacks": [
    { "creatureType": "Men", "strikes": 5, "prowess": 8 },
    { "creatureType": "Men", "strikes": 4, "prowess": 9 },
    { "creatureType": "Men", "strikes": 3, "prowess": 10 }
  ],
  "creatureTypeBySiteType": { "border-hold": "Men", "shadow-hold": "Orcs" },
  "afterAttack": "move-to-mp-pile",
  "returnFactionsAtSite": true
}
```

### 35a. `reveal-and-attack`

The Great Hunt (wh-91) — Alatar's signature stage permanent-event. Carried by a
resource permanent-event; on entering play it runs a one-time reveal-and-attack
process, then establishes a persistent "the opponent's discards may attack"
trigger while it stays in play. Two firing modes, both spawning
`great-hunt-attack` combats against the controller's `attackAvatar` company:

1. **On-play reveal.** A `great-hunt-source` pending resolution asks the
   controller which of the opponent's piles to reveal — play deck or discard
   pile. On that choice the engine scans the chosen pile top-down, collecting up
   to `maxCreatures` hazard-creatures; each attacks in turn (one interactive
   combat at a time). The revealed cards are never moved out of their pile
   (exactly like Lucky Search tw-269), so no instance is lost; if the play deck
   was used it is reshuffled when the sequence completes. A `great-hunt-reveal`
   active constraint holds the queue between combats; each combat's finalization
   (or cancellation) advances it.

2. **Ongoing discard trigger.** A `great-hunt-active` tracker constraint records
   every opponent-discarded hazard-creature already offered. On each post-reduce
   pass, during the controller's own turn, `sweepGreatHuntDiscards` offers a
   `great-hunt-discard-attack` for each hazard-creature newly present in the
   opponent's discard pile — "you may have it attack Alatar's company instead".
   The discard pile at play time is seeded as already-processed so only *later*
   discards fire. **Ruling:** each discarded creature instance is offered at most
   once per turn (recorded in the tracker), so the unbounded printed wording
   cannot loop forever; the creature is attacked in place and stays in the
   discard pile.

Fields:

- `maxCreatures: number` — how many revealed creatures may attack (5 for wh-91).
- `attackAvatar: string` — the avatar whose company is attacked, matched by name
  against the controller's in-play avatar (e.g. `"Alatar"`). If that avatar is
  not in a company the process fizzles / the trigger does not fire.

Implementation: `engine/great-hunt.ts` (`kickoffGreatHunt`, `startGreatHuntReveal`,
`buildGreatHuntCombat`, `advanceGreatHuntReveal`, `sweepGreatHuntDiscards`);
`chain-reducer.ts` kicks off the process from `resolvePermanentEvent`;
`combat-finalize.ts` / `combat-cancel.ts` advance the reveal queue; the two
pending kinds live in `legal-actions/pending.ts` + `pending-reducers.ts`; the
`great-hunt-attack` `AttackSource` variant is finalize-safe (the creature is
never disposed or awarded as a trophy). The play gate ("if you are Alatar and
have at least 12 stage points") is a `play-condition` `player-state`; "Cannot be
duplicated" is a `duplication-limit` scope `game`.

```json
{ "type": "reveal-and-attack", "maxCreatures": 5, "attackAvatar": "Alatar" }
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

- `condition?: Condition` — evaluated against company movement context:
  site-path terrain counts (`sitePath.wildernessCount`, `sitePath.shadowCount`,
  `sitePath.darkCount`, etc.), the moving player's alignment (`player.minion`),
  and `underDeepsMove` — a boolean true when the company's origin or destination
  site carries the `under-deeps` keyword. If absent, always applies.
- `rangerException?: boolean` — if true, a company containing at least one
  ranger is exempt from returning.

Used by *Snowstorm* (tw-91), *Foul Fumes* (tw-36), *Long Winter* (le-117), and
*The Way is Shut* (dm-98, `underDeepsMove`).

```json
{ "type": "force-return-to-origin",
  "condition": { "sitePath.wildernessCount": { "$gte": 1 } } }

{ "type": "force-return-to-origin",
  "condition": { "$or": [{ "sitePath.shadowCount": { "$gte": 1 } },
                         { "sitePath.darkCount": { "$gte": 1 } }] },
  "rangerException": true }

{ "type": "force-return-to-origin",
  "condition": { "underDeepsMove": true } }
```

### 36b. `cancel-card-effects`

While the carrying card is in play, any active constraint whose **source card**
is named in `cardNames` is suppressed — its effect is treated as absent for as
long as this card remains in play. This is the generic "cancels the effects of
X" primitive: it neutralizes the named cards' in-play constraints by source card
name, so an unrelated card that happens to use the same constraint kind is
untouched. Consulted at the top of `applyOneConstraint` (`legal-actions/pending.ts`).

Fields:

- `cardNames: string[]` — names of the cards whose in-play constraint effects
  are suppressed.

Used by *The Way is Shut* (dm-98): "cancels the effects of Secret Passage and
Secret Entrance" — while it is in play, Secret Entrance's
`no-creature-hazards-on-company` and Secret Passage's
`only-creatures-keyed-to-site` restrictions on a company are lifted.

```json
{ "type": "cancel-card-effects",
  "cardNames": ["Secret Passage", "Secret Entrance"] }
```

The `only-creatures-keyed-to-site` constraint (added by *Secret Passage* tw-325
via `on-event: self-enters-play` → `add-constraint`) restricts the opponent to
playing only hazard creatures keyed to the target company's destination site (by
site-type or site-name); creatures keyable only via region terrain are dropped
(`legal-actions/pending.ts` `applyOnlyCreaturesKeyedToSite`).

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

### 40a. `agent-move-restriction`

Restricts the site types this agent may move to while acting as a hazard
(taking an `agent-move` action around the map). Any candidate destination whose
{@link SiteType} appears in `siteTypes` is excluded from the legal `agent-move`
destinations.

Models text such as "Agent only: Cannot move to Free-holds [{F}] and
Border-holds [{B}]." The exclusion is applied in `agentTurnActions()` in
`legal-actions/movement-hazard.ts`, alongside the rule-9.07 haven exclusion and
the rule-9.08 alignment exclusions.

| Field       | Required | Description                                      |
|-------------|----------|--------------------------------------------------|
| `siteTypes` | yes      | Array of {@link SiteType} values the agent may NOT move to. |

Used by *Baugúr* (dm-181): cannot move to free-holds or border-holds.

```json
{ "type": "agent-move-restriction", "siteTypes": ["free-hold", "border-hold"] }
```

### 40b. `agent-discard-return-to-origin`

The agent may be discarded (its controller's choice, not as an agent action,
not against the hazard limit) at the moving company's new site during the
opponent's M/H phase to force that company to return to its site of origin.

The return follows CoE rule 2.IV.4: the company's movement/hazard phase
immediately ends (end-of-M/H corruption triggers still fire), the company is
no longer considered to have a site path nor to have moved to a site this
turn, and the company's player cannot initiate any actions during that
company's site phase (enforced via a `site-phase-do-nothing` constraint,
the same mechanism as `force-return-to-origin` environments).

No fields.

Conditions:

- Agent must have been in play at turn start (`inPlayAtTurnStart`).
- Agent must not be wounded (`CardStatus.Inverted`); tapped agents qualify —
  the ability requires no tap.
- The company must be moving to a new site this turn (a stationary company has
  no "new site") and the agent must be at that destination site.
- A face-down agent may be discarded too (no home-site binding is needed —
  the discard itself reveals the card; its site-stack sites return to the
  location deck).

Implementation:

- Legal actions: `agentDiscardReturnToOriginActions()` in
  `legal-actions/movement-hazard.ts`.
- Reducer: `handleAgentDiscardReturnToOrigin()` in `mh-hazard-play.ts` — it
  discards the agent, adds the `site-phase-do-nothing` constraint, sets
  `returnedToOrigin`, and immediately ends the company's M/H phase via
  `endCompanyMH`.

Used by *Baduila* (dm-2): "Agent only: if you choose to discard Baduila at
target company's new site, company must return to its site of origin."

```json
{ "type": "agent-discard-return-to-origin" }
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
| `attack.combatRules` | no | Array of combat-rule strings (see [Site auto-attack `combatRules`](#site-auto-attack-combatrules) for supported values, e.g. `["attacker-chooses-defenders"]`). |
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

### `grant-creature-keying`

Carried by an in-play permanent-event. While the card is in play (checked
across **both** players' `cardsInPlay`), any hazard creature whose card
definition matches `creatureFilter` may be keyed to any site whose effective
type is one of `siteFilter.siteTypes` **and** which carries every keyword in
`siteFilter.siteKeywords` — regardless of the creature's own `keyedTo`. It is
the in-play (environment-card) analogue of the site-bound
`allow-creature-by-race` / `allow-creature-by-keying` site rules: the grant
travels with the card rather than living on one site, so it applies at every
site of the matching kind for as long as the card stays in play. It feeds the
normal M/H hazard-creature play path via the shared
`keyedBy: { method: "keying-bypass" }` mechanism (`inPlayGrantsCreatureKeying`
in `legal-actions/movement-hazard.ts`). Omit `siteTypes` to match any type;
omit `siteKeywords` to impose no keyword requirement.

Used by Ungoliant's Foul Issue (ba-28): "non-unique Spider creatures can be
keyed to Under-deeps Ruins & Lairs [{R}] and Shadow-holds [{S}]."

```json
{
  "type": "grant-creature-keying",
  "creatureFilter": {
    "$and": [
      { "race": { "$in": ["spider", "spiders"] } },
      { "unique": { "$ne": true } }
    ]
  },
  "siteFilter": {
    "siteTypes": ["ruins-and-lairs", "shadow-hold"],
    "siteKeywords": ["under-deeps"]
  }
}
```

### Site auto-attack `combatRules`

A site's printed `automaticAttacks[]` entries (and the runtime-injected
attacks above) may carry a `combatRules` string array. Each string toggles
one combat override when that attack is initiated in `engine/reducer-site.ts`.
Unlike the `combat-*` effect types in [Combat-rule effects](#12-combat-rule-effects)
— which sit in a card's `effects[]` array — these are bare strings on the
attack record itself. Supported values:

- `"attacker-chooses-defenders"` — the attacking player assigns strikes
  (sets `attackerChoosesDefenders` on the combat).
- `"each-character"` — each character in the company faces one strike
  (`strikesTotal = company size`, strikes pre-assigned one per character).
- `"cannot-be-canceled"` — the attack cannot be canceled by any card effect
  (sets `uncancelable`, suppressing `cancel-attack` actions). Card text:
  "(cannot be canceled)". Used by the Spider at *Shelob's Lair* (le-402).
- `"wound-eliminates"` — any character or ally this attack wounds is
  immediately eliminated instead of merely wounded; no body check is rolled
  (sets `woundEliminates`). Effects that replace the wound entirely
  (absorb-wound, take-prisoner, discard-item) take precedence and suppress
  it; detainment strikes tap rather than wound and never trigger it. Card
  text: "any character wounded is immediately eliminated". Used by the
  Spider at *Shelob's Lair* (le-402). Implemented in `reducer-combat.ts`
  (`resolveStrikeCore` → `eliminateCombatantFromStrike`).
- `"weapons-ineffective"` — weapons do not modify the target's prowess against
  this attack's strikes (sets `weaponsIneffective` on the combat). Card text:
  "(weapons do not modify prowess against these strikes)", used by Trap-style
  and hazard-added attacks (Lava Flows, Rock Fall). Exposed to the item
  `modify-attack` `when` gate as `attack.weaponsIneffective`, so an item can
  target "one attack for which weapons do not modify prowess" (Dwarven
  Light-stone dm-168).

### Site auto-attack `appliesTo` (covert/overt guardians)

A site's printed `automaticAttacks[]` entry may carry an `appliesTo` string
that restricts which companies face it, based on the defending company's
covert/overt status (MELE "good site" guardians). Supported values:

- `"overt"` — only an overt company faces this attack. Card text: "(against
  overt company only)".
- `"covert"` — only a covert company faces this attack.
- *absent* — every company faces the attack.

`engine/reducer-site.ts` (`autoAttackAppliesToCompany`) skips attacks whose
`appliesTo` does not match `isCovertCompany(company, …)` when resolving the
`automatic-attacks` step, preserving the printed-list indices so
`combat.attackSource.attackIndex` still references the right attack.

A "(detainment against covert company)" attack does **not** use `appliesTo`
— it is faced by overt companies too, as a regular (non-detainment) attack.
Its detainment-vs-covert nature is expressed separately by a
[`combat-detainment`](#12-combat-rule-effects) site effect gated on
`defender.covert`; `reducer-site.ts` threads the company's covert status into
`isDetainmentAttack` as `defendingCovert`. Example — *Minas Tirith* (le-391):
a Men attack with `combatRules: ["each-character"]` and no `appliesTo` (plus
the `combat-detainment` site effect), and a Dúnedain attack with
`appliesTo: "overt"`.

```jsonc
"automaticAttacks": [
  { "creatureType": "Men", "strikes": 1, "prowess": 9, "combatRules": ["each-character"] },
  { "creatureType": "Dúnedain", "strikes": 4, "prowess": 10, "appliesTo": "overt" }
],
"effects": [
  { "type": "combat-detainment", "when": { "defender.covert": true } }
]
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

### 52b. `discard-for-hazard-limit`

Marks a permanent hazard event that may be **discarded from play** during the
opponent's movement/hazard phase (not counting against the hazard limit) to
increase the hazard limit against one company by `value`.

| Field | Required | Description |
|-------|----------|-------------|
| `value` | yes | Hazard limit slots added to the target company when the card is discarded. |

Unlike `hazard-limit-swap`, the boost is paid once by removing the card from
play (cardsInPlay → discard pile), not by tapping — there is no way to recover
it. The `discard-card-for-hazard-limit` action is offered to the hazard player
for any in-play card carrying this effect while a company is being processed;
the reducer discards the card (a routine discard that does **not** break the
Dragon manifestation chain) and adds a `hazard-limit-modifier` constraint scoped
to the target company's current M/H phase.

Implementation: `legal-actions/movement-hazard.ts` `discardForHazardLimitActions`;
`mh-hazard-play.ts` `handleDiscardCardForHazardLimit`.

Used by the 9 Dragon "At Home" permanent-events (METD §4), e.g. *Daelomin at
Home* (td-11):

```json
{ "type": "discard-for-hazard-limit", "value": 2 }
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

### 53a. `assign-strike-when-tapped`

Marks an ally as always a **legal strike target** during the defender's
strike-assignment phase, even while it is tapped or wounded — its status is
treated as untapped for assignability only.

Unlike `strike-shield` with `alwaysCountsAsUntapped`, this effect does **not**
force strikes onto the ally before its controlling character (no allied
protection); the ally simply remains a voluntary strike target regardless of
its combat status. The defender-phase ally offer in
`legal-actions/combat.ts` treats such an ally as untapped.

No fields beyond `type`.

```json
{ "type": "assign-strike-when-tapped" }
```

Used by Great Troll (ba-46): "Even if tapped or wounded, you may assign a strike
to this ally as though it were untapped."

---

### 53a-bis. `company-combat-boost`

Played from hand as a resource **short event during combat** (the pre-assignment
window of the defending company's `assign-strikes` phase). Applies an
attack-scoped stat modifier to characters in the **defending** company. The
boost is realised as one `character-stat-modifier` active constraint per boosted
character with `scope: { kind: 'attack' }`, swept when the attack finalizes.

| Field | Required | Description |
|-------|----------|-------------|
| `stat` | yes | `"prowess"` or `"body"`. |
| `value` | yes | Modifier value (positive boosts, negative penalises). |
| `filter` | no | Per-character grant filter, matched against `{ target: { race, name, skills, keywords } }`. Only matching characters receive the boost; the card is offered when at least one member matches. When absent (and no `companyFilter`), every member is boosted. |
| `companyFilter` | no | Company-level eligibility gate. When present, the event may be played only if at least one member satisfies it — and then **every** character in the company is boosted (the per-character `filter` is not used). Distinguishes "boost characters that are X" (`filter`) from "boost the whole company if it contains an X" (`companyFilter`). |

```json
{ "type": "company-combat-boost", "stat": "prowess", "value": 1,
  "companyFilter": { "$or": [
    { "target.keywords": { "$includes": "leader" } },
    { "target.name": "The Balrog" } ] } }
```

Used by The Dwarves Are upon You! (dm-124): `filter: { "target.race": "dwarf" }`
(+2 prowess / −1 body to the Dwarves only), and by Foe Dismayed (ba-59):
`companyFilter` gating +1 prowess for **all** characters in a company that
contains a Leader or The Balrog. Implemented in
`engine/legal-actions/combat.ts` (`companyCombatBoostActions`) and
`engine/reducer-events.ts` (the `company-combat-boost` block of
`handlePlayResourceShortEvent`).

---

### 53b. `combat-tap-company-boost`

Tap an in-play ally **during combat** to grant an attack-scoped stat boost to
every character in the ally's own company that satisfies the optional `filter`.
The boost lasts only for the current attack: it is applied as one
`character-stat-modifier` active constraint per matching character with
`scope: { kind: 'attack' }`, swept when the attack finalizes (`attack-end`
boundary) — the same machinery as `company-combat-boost`, but triggered by
tapping an in-play ally rather than playing a short event from hand.

Unlike `company-combat-boost` (which always targets the *defending* company and
is played from hand), this applies to the ally's **own** company whichever side
of the combat it is on: the defending company in creature combat, or either
company in company-vs-company combat. This covers card text of the form
"against one attack **or** in company versus company combat".

The owning player may tap the ally during the assign-strikes and resolve-strike
windows when the ally is untapped, its company is involved in the current
combat, and at least one company member matches the filter. Each ally may apply
its boost only once per attack (a second activation is rejected while an
attack-scoped constraint from that ally instance is live).

| Field | Required | Description |
|-------|----------|-------------|
| `stat` | yes | `"prowess"` or `"body"`. |
| `value` | yes | Modifier value (positive boosts, negative penalises). |
| `filter` | no | DSL condition matched against `{ target: { race, name, skills } }` per company member. When absent, every member is boosted. |
| `cost` | yes | Always `{ "tap": "self" }` (the ally taps itself). |

```json
{ "type": "combat-tap-company-boost", "stat": "prowess", "value": 2,
  "filter": { "target.race": "orc" },
  "cost": { "tap": "self" } }
```

Used by Great Lord of Goblin-gate (as-75): "Tap to give +2 prowess to all Orcs
in its company: against one attack or in company versus company combat."

Implemented in `engine/legal-actions/combat.ts` (`tapAllyCombatBoostActions`,
wired into the assign-strikes and resolve-strike windows of `combatActions`),
`engine/reducer-combat.ts` (`handleTapAllyCombatBoost`), and `engine/reducer.ts`
(`tap-ally-combat-boost` routed to the combat handler).

---

### 53c. `ally-body-check-boost`

Tap an in-play ally during the `body-check` combat phase to add its `value`
to its controlling character's effective body for the pending body check —
but only when the ally itself was also struck by a strike from the same
attack (both the ally and its controlling character are targets of strikes
from the same attack). Unlike `body-check-modifier` (a static, always-on item
effect added to the roll), this is a one-shot, tap-activated ally ability the
player chooses whether to use.

The bonus is applied directly to `StrikeAssignment.strikeBodyPenalty` on the
character's current strike (the same field used by `strike-modifier`
`bodyPenalty`, e.g. Risky Blow), so it is read by both the `bodyCheckActions`
legal-action generator (which shows the updated "need" before the roll) and
the roll resolution in `handleBodyCheckRoll`.

| Field | Required | Description |
|-------|----------|--------------|
| `value` | yes | Amount added to the controlling character's effective body (positive protects). |
| `cost` | yes | Always `{ "tap": "self" }` (the ally taps itself). |

```json
{ "type": "ally-body-check-boost", "value": 2, "cost": { "tap": "self" } }
```

Used by War-warg (le-156): "If the War-warg and its controlling character
are both targets of strikes from the same attack, you may tap War-warg to
give +2 body to its controlling character."

Eligibility (checked structurally, not via `when`): the ally must be
untapped, its controlling character must be the character currently facing
the pending body check (`combat.strikeAssignments[combat.currentStrikeIndex]`),
and the ally's own instance ID must also appear among `combat.strikeAssignments`
for the same attack.

Implemented in `engine/legal-actions/combat.ts` (`tapAllyBodyCheckBoostActions`,
wired into the `body-check` phase of `combatActions`), `engine/reducer-combat.ts`
(`handleTapAllyBodyCheckBoost`), and `engine/combat-actions.ts`.

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

### 54a. `item-slot-modifier`

Adjusts how many items of a given slot the bearing character may have **in use**
at once (rule 9.15). By default each item slot — `weapon`, `armor`, `shield`,
`helmet` — admits exactly one in-use item per character (the first borne item of
that slot, in carrying order); items beyond capacity are silenced (their
prowess/body modifiers and effects do not apply). This effect changes the
capacity for the slot it names on the character bearing the carrying item.

| Field | Required | Description |
|-------|----------|-------------|
| `slot` | yes | The item-slot keyword whose in-use capacity is modified (e.g. `"weapon"`). |
| `delta` | yes | Capacity change; `+1` lets a second item of `slot` be in use simultaneously. |
| `requiresNaturalSkill` | no | If set, the modifier applies only when the bearer has this skill *naturally* (on its card definition), not merely granted by an item — mirrors the "already a *X*" convention. |
| `excludesSlotWhenExtraUsed` | no | If set, whenever the extra capacity is actually consumed (more than one item of `slot` in use), the named slot drops to capacity 0 and its items are no longer in use. |

```json
{
  "type": "item-slot-modifier",
  "slot": "weapon",
  "delta": 1,
  "requiresNaturalSkill": "warrior",
  "excludesSlotWhenExtraUsed": "shield"
}
```

Used by Swordmaster (tw-498): an already-warrior sage may use two weapons (both
modifiers count), but using two weapons means he can't use a shield. The active
player's rule-9.16 election (forgoing the second weapon to keep a shield) is not
modeled — the engine prefers consuming the extra weapon slot.

---

### 55. `ringwraith-mode`

Marks a permanent-event resource card as a Ringwraith mode card (Black Rider,
Fell Rider, or Heralded Lord). When this card is in play bound to a Ringwraith
company (`CardInPlay.companyId`), the company may move to non-Darkhaven sites.
Without a mode card in play, a Ringwraith company is restricted to
Darkhaven-to-Darkhaven movement only (MELE §1.2).

The engine reads its presence when computing legal movement actions. The
optional `mode` field identifies which mode the card establishes; it is exposed
to the effective-stats resolver as `bearer.ringwraithMode` (via
`resolveCompanyRingwraithMode` in `recompute-derived.ts`), so a Ringwraith avatar
can carry per-mode `stat-modifier` effects gated on the current mode.

| Field | Required | Description |
|-------|----------|-------------|
| `mode` | optional | `"black-rider"`, `"fell-rider"`, or `"heralded-lord"`. Surfaced as `bearer.ringwraithMode` during effective-stats resolution. |

```json
{ "type": "ringwraith-mode", "mode": "fell-rider" }
```

A Ringwraith avatar then gates per-mode stat changes on the bound mode card, e.g.
Hoarmûrath (le-53): `+1 direct influence in Heralded Lord mode`, `+2 prowess in
Fell Rider mode`:

```json
{ "type": "stat-modifier", "stat": "direct-influence", "value": 1,
  "when": { "bearer.ringwraithMode": "heralded-lord" } }
```

Used by: Black Rider (le-170), Fell Rider (le-183), Heralded Lord (le-190). The
`bearer.ringwraithMode` context path is consumed by Ringwraith avatar cards such
as Hoarmûrath (le-53).

---

### 55a. `ringwraith-follower-slots`

Carried by a Ringwraith avatar. While this avatar is the player's revealed
Ringwraith, up to `count` other Ringwraith avatar cards may be played as
**Ringwraith followers** in his company, controlled with no influence.

CoE 2.II.2.1.R4–R5: a Ringwraith follower may only be played when an ability
allows it (this effect is that ability) and when the player's revealed
Ringwraith is at a Darkhaven or the follower's home site (region-form home
sites like `"Any site in Khand"` match any site whose `region` is that
region). The follower joins the revealed Ringwraith's company under his
control (`CharacterInPlay.controlledBy` = the avatar's instance ID), bypassing
the rule-2.II.2.1.1 prohibition on playing a second avatar. Because a
Ringwraith follower's `mind` is `null`, it consumes none of the controlling
avatar's direct influence (`availableDI` skips null-mind followers). Follower
plays go through the normal one-character-per-turn organization-phase flow,
which enforces the card's "separate organization phases" clause, and a
follower does not count as its player's avatar (`findPlayerAvatar` only
matches avatars under general influence).

Evaluated in `legal-actions/organization-characters.ts`
(`ringwraithFollowerPlayAction`); the play itself reuses the standard
`play-character` reducer with `controlledBy` set to the avatar's instance.

| Field | Required | Description |
|-------|----------|-------------|
| `count` | yes | Maximum number of Ringwraith followers this avatar may control. |

```json
{ "type": "ringwraith-follower-slots", "count": 2 }
```

Used by: The Witch-king (le-58) — "As your Ringwraith, up to two Ringwraith
followers in his company may be controlled with no influence. You may bring
these followers into play during separate organization phases."

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

The bearer counts as having the named keyword for all purposes — e.g. the "leader"
keyword makes the bearer subject to the one-leader-per-company rule (CoE 3.26) and
eligible for faction-influence bonuses gated on Leader status.

```json
{ "type": "grant-keyword", "keyword": "leader" }
```

Fields:

- `keyword` — the keyword to grant (e.g. `"leader"`).

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

---

### 40. `summons-from-long-sleep`

Marks a hazard permanent-event as a Dragon/Drake reservation card (AS-39 mechanic).

While this card is in the hazard player's `cardsInPlay` with an empty reservation slot,
the hazard player may take a free `reserve-creature` action to move any Dragon or Drake
hazard creature from their hand into the slot (not counting against the hazard limit).

While a creature is reserved, the hazard player may play it via `play-reserved-creature`
as if it were in hand (counts one against the hazard limit, subject to normal keying
checks). The reserved creature gains +2 prowess when attacking.

After the reserved creature attacks, this permanent-event is discarded from `cardsInPlay`.
The reservation slot only holds one creature at a time.

No additional fields beyond `type`.

```json
{ "type": "summons-from-long-sleep" }
```

Implemented in:

- `engine/legal-actions/movement-hazard.ts` (`summonsFromLongSleepActions`): generates
  `reserve-creature` and `play-reserved-creature` legal actions.
- `engine/reducer-movement-hazard.ts` (`handleReserveCreature`, `handlePlayReservedCreature`):
  moves creatures between `hand` and `player.reservedCreatures`, initiates the chain with
  `prowessBonus: 2`.
- `engine/reducer-combat.ts` (`finalizeCombat`): discards the AS-39 permanent-event after
  the reserved creature's attack completes (detects `reservingCardInstanceId` on the
  `creature` attack source).

State model: `player.reservedCreatures` is a `readonly` array of
`{ sourceCardInstanceId, creature: CardInstance }` entries, keyed by the AS-39 instance.

Used by: *Summons from Long Sleep* (as-39).

---

### 41. `stay-her-appetite`

Marks a hazard short-event as the Stay Her Appetite (le-140) detainment mechanic.
Must be combined with `{ "type": "play-target", "target": "ally" }` on the same card
so the legal-action computer offers one `play-hazard` action per ally in the active
company (the ally's instance ID is carried in `action.targetAllyId`).

When the chain entry resolves, the engine:

1. Looks up the ally's host character in the resource player's company.
2. Computes the threshold: `opponentUnusedGI + controllerUnusedDI + 5`.
3. Enqueues a `stay-her-appetite-roll` pending resolution (hazard player rolls).

At roll time a 2d6 **condition roll** is made. If `roll + ally.mind > threshold` a
second 2d6 **prowess roll** determines the attack's prowess (`ally.prowess + roll2`),
and a 1-strike detainment attack against the host character is initiated.

After combat, if the attack was not fully defeated, the ally is discarded from the
host character.

```json
{ "type": "stay-her-appetite" }
```

`play-target` entry for the same card:

```json
{ "type": "play-target", "target": "ally" }
```

Implemented in:

- `engine/legal-actions/movement-hazard.ts`: generates `play-hazard` actions with
  `targetAllyId` for each ally in the active company when the card has `play-target
  target:ally`.
- `engine/chain-reducer.ts`: detects `targetAllyId` + `stay-her-appetite` effect on
  short-event resolution; enqueues `stay-her-appetite-roll` pending resolution.
- `engine/legal-actions/pending.ts` (`stayHerAppetiteRollActions`): offers the roll
  action to the hazard player.
- `engine/pending-reducers.ts` (`applyStayHerAppetiteRollResolution`): resolves the
  condition and prowess rolls, optionally initiating `CombatState`.
- `engine/reducer-combat.ts` (`finalizeCombat`): discards the ally when the attack
  source is `stay-her-appetite-attack` and `!allDefeated`.

Used by: *Stay Her Appetite* (le-140).

Used by: *By the Ringwraith's Word* (le-174).

---

### 42. `play-creature-from-discard`

Marks a hazard short-event that plays a hazard creature from the hazard
player's **own discard pile** as an immediate attack against the active
company, **without counting against the hazard limit**. Models the Exhalation
of Decay (dm-55) mechanic.

| Field | Required | Description |
|-------|----------|-------------|
| `filter` | yes | A {@link Condition} matched against each candidate creature's card definition (e.g. `{ "race": "undead" }`). Reuses the shared condition-matcher rather than a card-specific keyword. |
| `prowessModifier` | yes | Signed integer added to the spawned attack's prowess (e.g. `-1`). |

```json
{ "type": "play-creature-from-discard",
  "filter": { "race": "undead" },
  "prowessModifier": -1 }
```

Legal actions: during the hazard player's M/H play-hazards window, the emitter
(`playCreatureFromDiscardActions` in `engine/legal-actions/movement-hazard.ts`)
walks the player's discard pile for `hazard-creature` cards matching `filter`,
runs the standard creature keying check against the active company ("if target
Undead can attack"), and emits one `play-creature-from-discard` action per
(creature, keying-match) pair. The chain must be null (creatures initiate a new
chain). Because the play is hazard-limit-exempt, no limit gating is applied. The
generic short-event path skips any card carrying this effect (it is offered
only through the dedicated emitter).

Reducer (`handlePlayCreatureFromDiscard` in `engine/reducer-movement-hazard.ts`):
discards the driving short-event card from hand, removes the chosen creature
from the discard pile, leaves `hazardsPlayedThisCompany` unchanged, and
initiates the creature chain with `prowessBonus: prowessModifier` and no
`reservingCardInstanceId`. After the attack resolves, the creature is disposed
by the normal `finalizeCombat` rules (defender's kill pile if fully defeated,
otherwise back to the hazard player's discard pile).

Used by: *Exhalation of Decay* (dm-55).

### 43. `region-keying-boost`

A turn-scoped environment effect that softens creature **keying** by letting one
region in a company's resolved site path count as additional regions of another
type. Carried by a hazard short-event environment; on play the card adds a
`region-keying-boost` active constraint (scope `turn`) carrying the boosts, and
the card is discarded.

Each entry in `boosts` is an independent alternative — `{ from, asType, count }`
means "treat one region of type `from` in the path as `count` regions of type
`asType`". At most **one** boost is applied per keying check (the boosts are
never combined), and the underlying site path is never mutated.

```json
{ "type": "region-keying-boost",
  "boosts": [
    { "from": "wilderness", "asType": "wilderness", "count": 2 },
    { "from": "shadow", "asType": "wilderness", "count": 2 },
    { "from": "border", "asType": "wilderness", "count": 2 }
  ] }
```

The creature-keying matchers — `findCreatureKeyingMatches`
(`legal-actions/movement-hazard.ts`, read path) and `checkCreatureKeying`
(`reducer-movement-hazard.ts`, write path) — call the shared helpers in
`engine/region-keying.ts`: `collectRegionKeyingBoosts(state)` gathers every
active boost, and `regionPathsWithBoosts(path, boosts)` returns the base path
plus one variant per applicable boost (each replacing a single `from` region
with `count` `asType` regions). A creature keys if its `regionTypes` match
**any** candidate path. Because the base path is always a candidate, the
environment never removes existing keying options.

The constraint is added at play time in the short-event reducer (alongside
`creature-keying-bypass`), so an environment-cancel targeting the source card
removes it. The corresponding constraint kind is `region-keying-boost` in
`types/pending.ts`.

Used by: *Withered Lands* (td-85) — gated on *Doors of Night* in play via a
`play-condition` `requires: site-path` clause (`{ "inPlay": "Doors of Night" }`).

### 44. `company-strike`

A hazard short-event effect that makes **each character** in the target
company face one strike (not part of a creature attack — "not an attack").
The strike carries a fixed prowess, no creature race, and resolves through
the normal combat machinery (one strike per character, then a body check on a
successful strike). Models the Cruel Caradhras (td-9) mechanic.

| Field | Required | Description |
|-------|----------|-------------|
| `prowess` | yes | Prowess of the single strike each character faces (e.g. `8`). |
| `uncancelable` | no | When `true`, the strikes cannot be canceled — maps to combat `uncancelable`, which suppresses `cancel-attack` actions for the defender (`legal-actions/combat.ts`). |
| `bodyCheckModifier` | no | Signed integer added to every resulting character body-check roll. Positive values make elimination more likely (Cruel Caradhras: `+1`). Threaded onto `CombatState.bodyCheckModifier` and applied in `handleBodyCheckRoll` (`reducer-combat.ts`). |

```json
{ "type": "company-strike", "prowess": 8, "uncancelable": true, "bodyCheckModifier": 1 }
```

**Combat creation**: When the chain resolves during the M/H phase,
`chain-reducer.ts` finds the `company-strike` effect and builds a single
`CombatState` against the active company with
`attackSource: { type: 'company-strike-event', ... }`,
`strikesTotal = company.characters.length`, `strikeProwess = prowess`, no
creature race or body, and the `uncancelable` / `bodyCheckModifier` flags. The
combat then surfaces from `state.combat` (mirrors Tidings of Bold Spies). The
defender assigns one strike per character, each strike resolves, and any
wound triggers a body check modified by `bodyCheckModifier`.

**Key property**: The attack has no creature race and is uncancelable, so
creature-attack triggers and cancel-attack cards do not apply — matching the
card's "not an attack" wording.

Used by: *Cruel Caradhras* (td-9).

### 44a. `company-tap-characters`

A hazard short-event effect that, on chain resolution during the M/H phase,
**taps every untapped character** in the active company whose effective mind is
strictly below a computed threshold and that matches an optional per-character
`filter`. Already-tapped/wounded characters are left as-is. Models the The Reek
(ba-23) mechanic. The event is played on the company as a whole via a
`play-target` with `target: "company"` (site filter) — there is no per-character
target.

| Field | Required | Description |
|-------|----------|-------------|
| `mindBelow` | yes | A [value expression](#value-expressions). A character is tapped only if its effective mind is strictly below this value. The expression context exposes `spawnCardsInPlay` — the number of `spawn`-keyword cards currently in play across both players (characters, allies, attached hazards/items, and bare permanent-events in `cardsInPlay`), per "the number of Spawn cards in play". "Eliminated Spawn do not count" is automatic: eliminated cards leave the in-play zones. |
| `filter` | no | A DSL condition evaluated per character against `{ target: { race, mind, name, skills } }`. Only matching characters are tapped. The Reek uses it to exclude the `wizard` and `ringwraith` races. |

```json
{
  "type": "company-tap-characters",
  "mindBelow": "2 + spawnCardsInPlay",
  "filter": {
    "$and": [
      { "target.race": { "$ne": "wizard" } },
      { "target.race": { "$ne": "ringwraith" } }
    ]
  }
}
```

**Resolution**: `chain-reducer.ts` finds the `company-tap-characters` effect on a
bare (no `targetCharacterId`) short-event entry during the M/H phase, computes
`spawnCardsInPlay` via `countSpawnCardsInPlay` (`reducer-utils.ts`), evaluates
`mindBelow`, and taps each qualifying untapped character in the active company.
Wizards and Ringwraiths are avatar races with a `null` printed mind (treated as
`0`, so always under the threshold) — the `filter` is what keeps them from being
tapped.

**Play cost**: The Reek pairs this with a `play-discard-cost` (discard an
Animal/Spider hazard-creature from hand) and the company `play-target` site
filter (`ruins-and-lairs` site type **or** the `under-deeps` site keyword).

Used by: *The Reek* (ba-23).

### 45. `force-return-to-origin`

Hazard environment (long-event) clause enforcing **CoE rule 5.31 — Company
Returned to Origin**: each moving company whose site path matches the
effect's `condition` must return to its site of origin (it does not move).

| Field | Required | Description |
|-------|----------|-------------|
| `condition` | no | Company-context condition evaluated against `{ sitePath: { wildernessCount, shadowCount, darkCount, coastalCount, borderCount, freeCount, length }, player: { minion } }`. When omitted, the effect always applies. `player.minion` is `true` for Ringwraith/Balrog players (used by "no effect on a minion player"). |
| `rangerException` | no | When `true`, a company containing at least one ranger (printed skill or item-granted) is exempt. |

```json
{ "type": "force-return-to-origin",
  "condition": { "sitePath.wildernessCount": { "$gte": 2 } },
  "rangerException": true }
```

**Enforcement**: at the end of each moving company's M/H phase
(`endCompanyMH` in `reducer-movement-hazard.ts`), every in-play environment
carrying this effect is evaluated against the company. On a match the company
keeps its current site, `moved` stays false, its site path is cleared, and a
`site-phase-do-nothing` constraint blocks its site phase. The effect tag is
also a cancellation target for `cancel-chain-return-to-origin` (Goldberry,
tw-245) while the environment is still an unresolved chain entry.

Used by: *Snowstorm* (tw-91, ≥1 Wilderness, no ranger exception),
*Long Winter* (le-117, ≥2 Wildernesses), *Foul Fumes* (tw-36, Shadow-land or
Dark-domain, no effect on minion players).

### 46. `tap-sites-in-play`

Hazard environment clause: when the environment resolves and enters play,
tap every distinct site currently in play (a company's current site, on
either side) whose attributes satisfy `condition`. One-time effect applied at
resolution — sites entering play later are unaffected.

| Field | Required | Description |
|-------|----------|-------------|
| `requiresInPlay` | no | Name of a card that must be in play for the tapping to occur (e.g. `"Doors of Night"`). When omitted, the tapping always applies on resolution. |
| `condition` | no | Per-site condition evaluated against `{ site: { type }, sitePath: { wildernessCount, shadowCount, darkCount }, player: { minion } }`. The site-path terrain counts are the site's printed `sitePath`; `player.minion` is the owning player's alignment (Ringwraith/Balrog), so a card with "no effect on a minion player" can exclude minion-owned sites (Foul Fumes tw-36). A site is tapped only when it matches. |

```json
{ "type": "tap-sites-in-play", "requiresInPlay": "Doors of Night",
  "condition": { "$and": [
    { "site.type": { "$ne": "haven" } },
    { "sitePath.wildernessCount": { "$gte": 2 } } ] } }
```

**Note**: Minion Darkhavens use `siteType: "haven"`, so `{ "site.type": { "$ne": "haven" } }`
excludes both Havens and Darkhavens (the "non-Haven/non-Darkhaven" wording).

Implemented in `applyTapSitesInPlayOnResolve` (`chain-reducer.ts`), invoked
from `resolveLongEvent`.

Used by: *Long Winter* (le-117, ≥2 Wildernesses), *Foul Fumes* (tw-36,
Shadow-land or Dark-domain) — both gated on Doors of Night.

### 47. `tap-discard-attached-hazard`

In-play ally ability: tap this ally (cost `{ "tap": "self" }`) to discard one
hazard permanent-event attached to the ally's company or to a character in it.
Offered during the company's M/H phase to the active (resource) player; one
action per (ally, eligible target) pair. The discarded hazard returns to its
owner's discard pile (no-card-disappears invariant).

| Field | Required | Description |
|-------|----------|-------------|
| `cost` | yes | `{ "tap": "self" }` — tap the bearer ally. |
| `when` | no | Gate evaluated against `{ bearer: { destinationRegion } }` — the region the bearer's company is moving to. When absent, offered whenever an eligible target exists. |

```json
{ "type": "tap-discard-attached-hazard",
  "cost": { "tap": "self" },
  "when": { "bearer.destinationRegion": { "$in": ["Imlad Morgul", "Ithilien", "Gorgoroth"] } } }
```

Eligible targets are hazard permanent-events (`cardType: "hazard-event"`,
`eventType: "permanent"`) attached to the company (`company.hazards`) or to any
of its characters (`character.hazards`). Implemented by
`tapDiscardAttachedHazardActions` (legal-actions/movement-hazard.ts) and
`handleTapAllyDiscardHazard` (reducer-movement-hazard.ts).

**Related cancel-attack context**: the combat `cancel-attack` `when` context
also exposes `bearer.destinationRegion` (the defending company's destination
site region, undefined when not moving), so an ally can cancel a hazard
creature attack only when its company is moving to a qualifying region. Used
together by Last Child of Ungoliant (le-153).

### 48. `leader-control`

Faction "control by a leader" mechanic carried by the LE *Orcs of Udûn*-style
factions: **le-262** (Black Trolls), **le-275** (Orcs of Gorgoroth), **le-279**
(Orcs of the Ash Mountains), **le-281** (Orcs of the Red Eye), **le-282** (Orcs
of Udûn), **le-291** (Uruk-hai). Card text: *"If this influence attempt is made
by an Orc or Troll leader, you may place this faction under the control of that
leader and not tap the site. Discard the faction if the leader moves or leaves
play. Three or more factions controlled by the same leader give 2 extra
marshalling points."*

| Field | Required | Description |
|-------|----------|-------------|
| `races` | yes | Races whose characters may take control, e.g. `["orc", "troll"]`. Matched against the influencing character's `race`. |
| `requiresKeyword` | yes | Keyword the controlling character must carry, e.g. `"leader"`. |
| `groupBonus` | yes | `{ "count": N, "mp": M }` — a single leader controlling `N`+ such factions earns `M` extra marshalling points (counted once per leader). |

```json
{ "type": "leader-control",
  "races": ["orc", "troll"],
  "requiresKeyword": "leader",
  "groupBonus": { "count": 3, "mp": 2 } }
```

Behaviour (all implemented in the engine):

- **Optional control at influence time.** When an eligible Orc/Troll leader can
  influence the faction, the legal-action generator emits two
  `influence-attempt` actions for that character — a normal one and a variant
  carrying `placeUnderLeaderControl: true` (`legal-actions/site.ts`). The player
  chooses ("you may"). The flag is threaded onto the chain entry and read by
  `resolveInfluenceAttemptRoll` (`reducer-site.ts`).
- **On success with control:** the faction enters `cardsInPlay` with
  `controlledBy` = the leader's instance ID, and the influence **site is left
  untapped** (no minor-item window opens). Eligibility is re-validated on
  resolution via `leaderControlEligibility` (`reducer-utils.ts`).
- **Discard when the leader moves:** at M/H step 8, any faction whose
  `controlledBy` leader is in the moving company is discarded
  (`reducer-movement-hazard.ts`).
- **Discard when the leader leaves play:** the post-action sweep
  `discardOrphanedControlledFactions` (`reducer-utils.ts`, called from
  `postReduce` in `reducer.ts`) discards any controlled faction whose leader is
  no longer in its owner's `characters` (elimination, influenced away, etc.).
- **Group marshalling bonus:** `recompute-derived.ts` counts controlled factions
  per leader and adds `groupBonus.mp` to the faction category for each leader
  meeting `groupBonus.count`.

The "Standard Modifications" line on these cards (e.g. *Orcs of Gorgoroth (+2),
Orcs of the Red Eye (-2)*) is modeled separately with `check-modifier` effects
gated on `controller.inPlay`, exactly as for the simpler LE factions.

### 49. `set-aside` — placement of cards "off to the side" (MEAS §1)

Carried by a host permanent-event whose resolution places one or more target
cards "off to the side" and keeps them with the host (e.g. *Sack Over the Head*,
*Summons from Long Sleep*, *Sacrifice of Form*). A set-aside card:

- is kept with the host — the host's `cardsInPlay` entry lists it in `setAside`,
  and the child is stamped with `setAsideHost` (both on `CardInPlay`);
- remains registered in the host player's `cardsInPlay`, so no instance
  disappears and it stays **in play for uniqueness** (`countCopiesInPlay`);
- **cannot be targeted** except by cards whose `play-target` declares
  `targetsSetAside: true` (`cardTargetsSetAside`, `engine/set-aside.ts`);
- is **discarded to its owner** when the host leaves the playing surface, unless
  the host states otherwise via `keepOnHostRemoval` (captured on the child as
  `setAsideKeepOnRemoval`);
- awards its **marshalling points to its owner** (`ownerOf`), not the host's
  player (`recompute-derived.ts`).

| Field | Required | Description |
|-------|----------|-------------|
| `keepOnHostRemoval` | no | When `true`, the set-aside cards are **not** discarded when the host leaves play — they remain in play under their owner (e.g. *Sacrifice of Form* keeps the converted item). Defaults to `false`. |

```json
{ "type": "set-aside" }
```

The target(s) to set aside are chosen by the host's accompanying `play-target`
effect; this effect only declares the off-to-the-side disposition.

Behaviour (engine mechanics in `engine/set-aside.ts`):

- **Placement.** `placeCardSetAside` registers a child as an untapped
  `CardInPlay` in the host player's `cardsInPlay` with `setAsideHost`, and
  appends its id to the host's `setAside`. `setAsideCompanyCharacter` performs
  the *Sack Over the Head* shape — a company character (with its items/allies)
  leaves its owner's company and is set aside; its attached hazards return to
  their owners' discards.
- **Targeting exclusion.** Target collectors skip `setAsideHost` cards unless
  the playing card's `play-target` declares `targetsSetAside`.
- **Host-removal sweep.** `sweepSetAside` (called from `postReduce`) discards
  every orphaned set-aside child to its owner when the host has left play, or —
  for `keepOnHostRemoval` children — detaches them and keeps them in play. It
  also prunes dangling ids from surviving hosts' `setAside` lists. This is the
  single load-bearing disposition point: a forgotten child surfaces here as an
  orphan, never a silently dropped instance.
- **Marshalling points.** `recompute-derived.ts` skips set-aside cards in the
  host player's tally and credits their MPs to `ownerOf` instead.

Per-card wiring of *which* cards a given host sets aside is card-certification
work; the mechanics above are alignment-agnostic.

### 50. `recruitment-vehicle`

Marks a permanent resource-event as a "recruitment vehicle" — Thrall of the
Voice (wh-82). During the organization phase its Fallen-wizard controller may
bring **one** otherwise-ineligible character into play "instead of a normal
character" (it consumes the one-character-per-turn slot), placing this card with
that character.

| Field | Required | Description |
|-------|----------|-------------|
| `maxMind` | yes | Maximum **printed** mind of a character the vehicle may bring in (above the Fallen-wizard maximum of 5). |
| `agentRecruit` | no | Agent-summons variant — Open to the Summons (wh-46). See below. |

```json
{ "type": "recruitment-vehicle", "maxMind": 6 }
{ "type": "recruitment-vehicle", "maxMind": 99, "agentRecruit": true }
```

Behaviour:

- **Eligibility (legal actions, `legal-actions/organization-characters.ts`).**
  When the Fallen-wizard holds the vehicle, `playCharacterActions` emits a
  `play-character` carrying `viaRecruitmentInstanceId` for any in-hand character
  whose printed mind is above 5 and ≤ `maxMind` and whose race is **not** Orc or
  Troll (CRF: the vehicle alone cannot bring an Orc/Troll into play). The recruit
  may be a minion **agent**. The influence cost uses the *reduced* mind (the
  vehicle's accompanying `stat-modifier`, "-1 … min 1").
- **Resolution (`reducer-organization.ts`).** `handlePlayCharacter` moves the
  vehicle from hand and attaches it to the recruit (in the character's `items`),
  so the mind reduction resolves against the recruit during `recomputeDerived`,
  and consumes the one-character-per-turn slot.
- **Starting company (`reducer-setup.ts`).** When the card also declares
  `starting-company-placement`, placing it on a starting character (a
  `place-starting-company-event` with `targetCharacterInstanceId`) attaches it to
  that character and reduces its mind — "such a character may also be in your
  starting company."

**`agentRecruit` (Open to the Summons, wh-46).** With this flag the vehicle is an
*agent-summons* vehicle rather than a plain one:

- Brings **one agent** character (not any character up to `maxMind`) into the
  controller's own company **at a Darkhaven** [{DH}] — a dark-side haven, e.g.
  Minas Morgul — rather than the agent's home site. Offered only when a Darkhaven
  is available (company site or site deck), never at other sites.
- Usable by a **Ringwraith or Fallen-wizard** player (the plain variant is
  Fallen-wizard-only). It does **not** lift the Fallen-wizard mind-5 cap (CRF:
  "Does not allow a Fallen-wizard to play a 6-mind character"), so a
  Fallen-wizard may summon only an agent of mind ≤ 5; `maxMind` is left high (99)
  and unused on this path.
- **Draft gate (`legal-actions/draft.ts`, `reducer-setup.ts`).** Each copy sitting
  in the play deck during the character draft lifts the Ringwraith/Fallen-wizard
  agent draft-gate (rules 1.41/1.42) for **one** agent, so the agent may be a
  starting character. `countAgentSummonsEnablersInDeck` / `countDraftedAgents`
  (`reducer-utils.ts`) meter it: the gate is lifted while fewer agents have been
  drafted than enablers held. During the item draft the copy is placed with that
  agent "in lieu of a minor item" (offered only on an agent character).
- The `-1` mind reduction (`stat-modifier`, min 1) and `starting-company-placement`
  behaviour are shared with the plain variant. "Cannot be duplicated on a given
  character" is declared via `duplication-limit` (scope `character`); structurally
  each agent instance receives at most one vehicle. "Cannot be included in a
  Balrog's deck" is enforced by deck validation (banned-id list), not a runtime
  effect.

### 51. `recruit-character`

Marks a **short** resource-event as a character-recruitment event — A Chance
Meeting (tw-188). Playing the event brings one character from hand into play in
an existing company under relaxed recruitment rules.

| Field | Required | Description |
|-------|----------|-------------|
| `controlledBy` | yes | How the recruit is controlled. Only `"direct-influence"` is supported (the event does not allow general-influence play). |
| `siteTypes` | yes | {@link SiteType} values where the recruit may enter play (e.g. `["free-hold", "border-hold", "ruins-and-lairs"]`). |
| `filter` | no | DSL `Condition` matched against the recruit's card definition (e.g. `{ "$not": { "race": "wizard" } }` to bar Wizards). |
| `bypassOneCharacterLimit` | no | When `true`, the play does **not** consume the one-character-per-turn slot. |

```json
{ "type": "recruit-character", "controlledBy": "direct-influence",
  "siteTypes": ["free-hold", "border-hold", "ruins-and-lairs"],
  "filter": { "$not": { "race": "wizard" } },
  "bypassOneCharacterLimit": true }
```

Behaviour:

- **Eligibility (legal actions, `legal-actions/recruit-via-event.ts`).** For the
  active player, `recruitViaEventActions` finds in-hand events carrying this
  effect and emits one `play-character` action — carrying `viaEventInstanceId`
  (the event card) — per eligible (recruit-in-hand, company at a `siteTypes`
  site, direct-influence controller with enough unused DI) combination. Avatars
  (null mind) and recruits failing `filter` or the uniqueness rule are skipped.
  The helper is wired into the organization, movement/hazard, and site phase
  aggregators, so the event "may be played on your turn during any phase the
  company is at a site"; it self-gates on a company actually being at a
  qualifying site.
- **Resolution (`reducer-organization.ts`).** `handlePlayCharacter` (now shared
  by the site and movement/hazard reducers for this path) brings the recruit into
  the company under the controller's direct influence, discards the enabling
  event to the discard pile, and — when `bypassOneCharacterLimit` is set — skips
  the one-character-per-turn bookkeeping (and the organization-phase state is only
  touched when actually in the organization phase).

### 51a. `allow-character-play`

Lifts the Fallen-wizard Orc/Troll character-play restriction (CoE 2.II.2.2.F2:
"A Fallen-wizard player cannot play Orc or Troll characters unless they have a
Stage resource in play that specifically allows them to play Orc or Troll
characters"). Carried by a **stage permanent-event** the Fallen-wizard controls.
The legal-action layer bars a Fallen-wizard from playing any Orc or Troll
character (Half-orcs are race `"orc"`) unless some in-play `allow-character-play`
effect's `filter` matches that character's card definition.

| Field | Required | Description |
|-------|----------|-------------|
| `filter` | yes | DSL `Condition` matched against the candidate character's card definition. |
| `atOwnWizardhavens` | no | When `true`, matching characters may also be played at the controller's **Wizardhavens** even when the Fallen-wizard avatar is not at that site (relaxing CoE 2.II.2.2's avatar-site restriction for those characters). |

```json
{ "type": "allow-character-play", "filter": { "race": { "$in": ["orc", "troll"] } } }
```

```json
{ "type": "allow-character-play",
  "filter": { "keywords": { "$includes": "half-orc" } },
  "atOwnWizardhavens": true }
```

- Used by *Bad Company* (wh-63): "You may play Orc and Troll characters …" (any
  Orc/Troll, played under the normal avatar-site rules).
- Used by *A Strident Spawn* (wh-61): "You may play Half-orc characters at your
  Wizardhavens, even if your Fallen-wizard is not there or Bad Company is not in
  play" (only Half-orcs, with the `atOwnWizardhavens` location relaxation).

Implemented in `legal-actions/organization-characters.ts`: the
`orcTrollPlayPermission` helper plus the Orc/Troll gate in
`playCharacterActions`, and the `isOwnWizardhaven` relaxation of the
GI-allowed-at-site check.

### 51b. `org-phase-fetch`

Grants the controlling player an optional **once-per-organization-phase** action
to take one card matching `filter` from a pile into their hand. Carried by a
permanent-event the player controls.

| Field | Required | Description |
|-------|----------|-------------|
| `from` | yes | Piles to fetch from: any of `"discard-pile"`, `"sideboard"`, `"deck"`. |
| `filter` | yes | DSL `Condition` matched against each candidate card's definition. |

```json
{ "type": "org-phase-fetch", "from": ["discard-pile"],
  "filter": { "keywords": { "$includes": "half-orc" } } }
```

Used by *A Strident Spawn* (wh-61): "During your organization phase, you may take
one Half-orc character from your discard pile to your hand."

Behaviour: `organizationActions` (`orgPhaseFetchActivations` in
`legal-actions/organization.ts`) emits one `activate-org-fetch` action per source
card that still has its activation available this turn and has at least one
matching candidate. Activating (`handleActivateOrgFetch` in
`reducer-organization.ts`) enqueues the shared `fetch-to-deck` pending effect
(`to: "hand"`), which drives the existing pick-one-or-pass sub-flow, and records
the source in `OrganizationPhaseState.discardFetchUsedThisTurn` so it cannot be
re-activated until the next turn.

### 52. `region-movement-limit`

Carried by an in-play **environment** hazard permanent-event; reduces the
maximum number of regions any moving company may traverse with region movement,
game-wide (it affects every player's companies, not just the controller's).

| Field | Required | Description |
|-------|----------|-------------|
| `reduce` | yes | Regions subtracted from the max region distance for every moving company. |
| `reduceWithDoorsOfNight` | no | Reduction applied **instead of** `reduce` while *Doors of Night* is in play. |
| `min` | yes | Floor below which the reduced max region distance may never drop. |

```json
{ "type": "region-movement-limit", "reduce": 1, "reduceWithDoorsOfNight": 2, "min": 2 }
```

Behaviour (`recompute-derived.ts` `collectRegionMovementReduction` /
`applyRegionMovementReduction`): both players' `cardsInPlay` are scanned for this
effect; each contributes `reduceWithDoorsOfNight` (if present and Doors of Night
is in play) or `reduce`, summed across cards, and the largest `min` becomes the
floor. The reduction is applied to the candidate max region distance — after the
base/extra/passive bonuses and the hard cap of six — never lowering it below the
floor. Consumed both at movement-plan time (`organization-companies.ts`
`planMovementActions`) and at company selection in the Movement/Hazard phase
(`reducer-movement-hazard.ts` `handleSelectCompany`, which sets
`phaseState.maxRegionDistance` used by `declare-path`). Used by No Way Forward
(dm-75): "The number of region cards that may be played by a moving company
using region movement is reduced by one (by two if Doors of Night is in play) to
a minimum of two."

### 52a. `under-deeps-roll-modifier`

Bonus to the 2d6 roll required for a company to move between adjacent
Under-deeps sites (CoE 2.IV.i.1). Carried by an item, ally, or character card;
while the source card is present on any character in the moving company,
`value` is added to the roll.

| Field | Required | Description |
|-------|----------|-------------|
| `value` | yes | Bonus added to the roll. |
| `scope` | no | `"minion-companies"` makes the effect a game-wide environment that applies to every Ringwraith-minion company (collected from either player's `cardsInPlay`). Omitted = carried by an item/ally/character and applies only to that company. |

```json
{ "type": "under-deeps-roll-modifier", "value": 2 }
{ "type": "under-deeps-roll-modifier", "value": 3, "scope": "minion-companies" }
```

Behaviour (`mh-steps.ts`, at the `getUnderDeepsRequiredRoll` call site): modeled
as an equivalent reduction of the *required* roll (floored at 0) — the same
trick already used for the Balrog's built-in "+3 to the roll for his company to
move between adjacent Under-deeps sites" (`companyContainsBalrogAvatar`).
Collected via `collectCharacterEffects` over every character in the moving
company, so modifiers from multiple company members stack. Allies travelling
with a character are collected separately (their card definitions are scanned
directly at the same call site, since `collectCharacterEffects` does not descend
into `char.allies`). Used by Iron Shield of Old (as-127): "+2 to all rolls
required for bearer's company to move to adjacent Under-deeps sites" (an item),
and by Cave Troll (ba-35): "+1 to rolls required for its controller's company to
move to adjacent Under-deeps sites" (an ally).

With `scope: "minion-companies"` the modifier is instead a global environment:
collected from either player's `cardsInPlay` and applied only when the moving
player's alignment is Ringwraith. Multiple in-play copies stack. Used by The
Under-roads (as-106): "The roll required for minions to move between adjacent
Under-deeps sites is decreased by 3" (`value: 3`).

### 52a-1. `prohibit-card-play`

While the carrying card is in play, the named cards may not be played, and any
copy already in play is discarded the moment this card enters play. The generic
"discards and prohibits the subsequent play of X" primitive — a hard play-lock
keyed by card name, distinct from `cancel-card-effects` (which only suppresses
an in-play card's *constraints* while leaving it in play and re-playable).

| Field | Required | Description |
|-------|----------|-------------|
| `cardNames` | yes | Names of the cards discarded on entry and barred from play. |

```json
{ "type": "prohibit-card-play", "cardNames": ["The Way is Shut"] }
```

Behaviour: on enter-play the resolving long-event discards every matching card
from either player's `cardsInPlay` to its owner's discard pile
(`resolveLongEvent` → `applyProhibitCardPlayOnResolve`, `chain-reducer.ts`). The
ongoing play-lock is enforced in the hazard legal-action layer
(`playHazardsActions` → `isCardPlayProhibited`, `legal-actions/movement-hazard.ts`),
which refuses to offer any prohibited card while the source remains in play.
Used by The Under-roads (as-106): "Discards and prohibits the subsequent play of
The Way is Shut."

### 52b. `extra-under-deeps-mh-phase`

Carried by an in-play permanent-event; grants repeated Under-deeps
movement/hazard phases (Gangways over the Fire, ba-60). While the controlling
player has any card with this effect in play, each of their **moving** companies
may — at the end of its movement/hazard phase — attempt another Under-deeps
movement to a site it has **not used yet this turn**; a new site card is played
and a fresh movement/hazard phase immediately follows for that company. The
Under-deeps roll for each such extra phase is penalised by the number of
complete movement/hazard phases the company has already taken this turn (the
first extra move is at −1, the second at −2, and so on).

This effect has no fields:

```json
{ "type": "extra-under-deeps-mh-phase" }
```

Behaviour: after a company finishes its M/H phase, `advanceAfterCompanyMH`
(`mh-hazard-play.ts`) records the completed-phase count and the site now
occupied on the phase state (`gangwaysPhaseCounts` / `gangwaysSitesUsed`, keyed
by company id). If `playerHasExtraUnderDeepsMH` holds, the company moved this
turn, and a new Under-deeps-adjacent site remains in the site deck, the engine
enters the dedicated `gangways-offer` step (`legal-actions/movement-hazard.ts`
`gangwaysOfferActions`); the active player either selects a destination
(`gangways-extra-move`, `handleGangwaysOffer` re-enters `reveal-new-site` with
the per-phase state reset) or passes to finalize the company
(`finalizeCompanyMH`). The roll penalty is applied in `handleRevealNewSite` from
`gangwaysPhaseCounts` (only where an actual roll is required). Ba-60 also carries
`starting-company-placement` (it "may start the game … in lieu of playing a minor
item", via the `starting-item` keyword) and `duplication-limit` scope `game`
("Cannot be duplicated").

### 52c. `surface-region-adjacency`

Carried by a Balrog **permanent-event** played on an Under-deeps site during the
organization phase (paired with a `play-target: { target: "site" }` filtered to
the `under-deeps` keyword). Used by Caverns Unchoked (ba-51): "Playable on an
Under-deeps site during the organization phase. This site is never discarded or
returned to its location deck. Each other site (of yours) in the same region as
its surface site is considered adjacent to this Under-deeps site … only if the
other site is normally a Shadow-hold [{S}], Ruins & Lairs [{R}], or Border-hold
[{B}]."

```json
{
  "type": "surface-region-adjacency",
  "siteTypes": ["shadow-hold", "ruins-and-lairs", "border-hold"]
}
```

`siteTypes` lists the **printed** site types a same-region site must have to
become adjacent. Behaviour, while the card is in play bound to Under-deeps site
`U` (`CardInPlay.attachedToSite`):

- **Permanence** — the card is exempt from the site-attached orphan sweep
  (`discardOrphanedSiteAttachedEvents`, `reducer-utils.ts`), so it persists even
  while `U` is unoccupied; and when a company leaves `U`, `U` is always returned
  to the owner's location deck (never discarded — `mh-hazard-play.ts` step 8),
  keeping it re-accessible ("never discarded or returned to its location deck").
- **Adjacency** — each *other* site of the card's owner that is normally one of
  `siteTypes` and lies in `U`'s region is treated as Under-deeps-adjacent to `U`
  at a required roll of 0. (An Under-deeps site and its surface site always share
  a region, so `U`'s own `region` names the surface region.) The dynamic
  adjacency is added by `cavernsUnchokedAdjacencyRoll`
  (`legal-actions/organization-companies.ts`) and consulted by
  `isUnderDeepsAdjacent` and `getUnderDeepsRequiredRoll` via the moving player
  (`forPlayer`), so only the owner's own companies benefit ("of yours"). Because
  the movement-destination enumeration and the required-roll both bottom out in
  those two helpers, both org-phase plan-movement and the M/H declare-path pick
  it up automatically.

### 53. `site-item-trap`

Carried by a hazard **permanent-event** attached to a site (via
`play-target: { target: "site" }`). The card is playable only on a site that
has an Orc or Troll automatic-attack. When the resource player plays **any item**
at the bound site during the site phase, the company must face all of that
site's automatic-attacks **again**, each with prowess raised by `prowessBonus`.
A successful strike does not wound the character; instead the character is taken
**prisoner at the site** (CoE rule 8.35), with the rescue-attack being the site's
automatic-attacks at the time of rescue.

| Field | Required | Description |
|-------|----------|-------------|
| `prowessBonus` | yes | Prowess added to each re-faced automatic-attack. |

```json
{ "type": "site-item-trap", "prowessBonus": 3 }
```

Behaviour:

- **Playability** (`legal-actions/movement-hazard.ts`): the site-targeting play
  path additionally requires the candidate site to have at least one Orc/Troll
  automatic-attack (`getActiveAutoAttacks` + `normalizeCreatureRace`).
- **Trigger** (`reducer-site.ts` `maybeTriggerSiteItemTrap`): after an item is
  attached during `play-resources`, the engine scans the opponent's `cardsInPlay`
  for a card bound to the company's current site (`attachedToSite`) carrying this
  effect. If found, it initiates the first re-faced automatic-attack (prowess
  `+prowessBonus`) and enters the `troll-purse-attacks` site sub-step; the
  remaining attacks are sequenced by `handleSiteTrollPurseAttacks`, and control
  returns to `play-resources` once all are re-faced.
- **Prisoner-on-success** (`reducer-combat.ts` `resolveStrike`): the re-faced
  combat carries `CombatState.trollPursePrisoner`; a successful strike takes the
  character prisoner at the bound site instead of wounding
  (`applyTakePrisonerAtSite`), creating a `HazardHost` whose `rescueSiteCard` is
  the bound site and a `character-is-prisoner` constraint. The host (the trap)
  stays in play and is exempt from the orphan-discard sweep while it holds
  prisoners.
- **Rescue** (CoE rule 8.36): while a company is at the site holding its own
  prisoners, the legal-action layer offers a `rescue-prisoner` action
  (`rescuablePrisonersAtSite`). Declaring it makes the company face the
  rescue-attack — the site's automatic-attacks at the time of rescue — sequenced
  through the `rescue-attacks` site sub-step (`handleSiteRescueAttacks`) with
  normal wound semantics and the held prisoners protected from strike
  assignment. Once the rescue-attack is faced, the prisoners are freed
  (`freePrisonersOfHost`: their `character-is-prisoner` constraints are removed
  and the host record is dropped) and control returns to `play-resources`.

Used by Troll-purse (dm-95): "Playable on a site with an Orc or Troll
automatic-attack. When any item is played at this site, the company must face all
automatic-attacks of the site again with the attack's prowess modified by +3. Any
successful strike does not harm the character, but rather the character is taken
prisoner at the site. The rescue-attack equals all automatic-attacks of the site
at the time of rescue."

### 54. `hazard-limit-environment`

Carried by an in-play **environment** hazard permanent-event; raises a moving
company's hazard limit by `value` when the company matches the `when` condition.
It applies game-wide (to every player's companies) and is evaluated
independently for each company at the moment its hazard limit is snapshotted
(site revelation in the Movement/Hazard phase). Only **moving** companies count
(the snapshot requires a `destinationSite`).

| Field | Required | Description |
|-------|----------|-------------|
| `value` | yes | Amount added to a matching company's hazard limit (once per matching in-play card). |
| `when` | yes | Condition over the per-company context gating whether `value` applies. |

The `when` condition is evaluated against a per-company context exposing:

- `company.size` — effective size (CoE rule 3.24: Hobbits and Orc scouts count ½).
- `company.hasWizard` — `true` if a Wizard avatar is in the company.
- `company.maxNonRangerMind` — the highest mind among the company's characters
  that are **not** rangers (`0` if none; Wizards have no mind and never count here).

```json
{
  "type": "hazard-limit-environment",
  "value": 2,
  "when": {
    "$and": [
      { "company.size": { "$lt": 4 } },
      { "$or": [
        { "company.hasWizard": true },
        { "company.maxNonRangerMind": { "$gte": 6 } }
      ] }
    ]
  }
}
```

Behaviour (`reducer-movement-hazard.ts` `snapshotHazardLimit` /
`buildCompanyHazardContext`): when a moving company's hazard limit is snapshotted,
both players' `cardsInPlay` are scanned for this effect; each card whose `when`
matches the company context adds `value` to the snapshot (folded in alongside the
base size limit, sideboard halving, `hazard-limit-modifier` constraints and
site-rule modifiers). Used by Eyes of the Shadow (dm-56): "The hazard limit is
increased by two for each moving company with a size of less than four that also
contains a Wizard or a non-ranger character with a mind of 6 or more."

### 55. `withdraw-agent`

Carried by a resource short-event. Removes an opponent's **face-up agent** from
play, judged by the agent's printed mind, or — as an alternative mode — discards
one of the opponent's **unrevealed on-guard** cards.

| Field | Required | Description |
|-------|----------|-------------|
| `returnMindThreshold` | yes | Printed-mind boundary: an agent whose mind is **≥** this value is returned to its owner's hand; a lower-mind agent is discarded to its owner's discard pile. |
| `alternativeDiscardOnGuard` | yes | When `true`, the card may instead discard an unrevealed on-guard card. |

```json
{
  "type": "withdraw-agent",
  "returnMindThreshold": 6,
  "alternativeDiscardOnGuard": true
}
```

The play mode is selected by which target the `play-short-event` action carries:

- **Agent mode** (`targetAgentId`): the legal-action generator
  (`withdrawAgentTargetActions` in `legal-actions/organization.ts`) emits one
  play action per **revealed** agent the opponent has in play. On resolution
  (`handlePlayResourceShortEvent` in `reducer-events.ts`) the agent is looked up
  by printed mind: mind `< returnMindThreshold` → agent card to its owner's
  discard pile; mind `≥ returnMindThreshold` → agent card back to its owner's
  hand. Either way the agent leaves the `agents` list, its face-down site stack
  returns to the location deck, and any (rare) attachments go to their owners'
  discard piles — no card instance is lost.
- **On-guard mode** (`discardTargetInstanceId`): when `alternativeDiscardOnGuard`
  is set, one play action is emitted per **unrevealed** on-guard card on the
  player's own companies. On resolution the card is removed from the company and
  discarded to its owner (the opponent who placed it). Per CRF 22 this must
  happen *before* the card is revealed, and the primary "playable on a face-up
  agent" condition does **not** gate this mode.

Used by Withdrawn to Mordor (dm-165): "Playable on a face-up agent. If the agent
has a mind of 5 or less, it is discarded. If its mind is 6 or greater, return the
agent to its owner's hand. Alternatively, an on-guard card is discarded."

### 56a. `creature-alt-event`

Marks a hazard-creature card as **dual-mode** — playable either in the normal
keyed-creature way *or* as an event. MECCG has ~20 such cards (Nazgûl, hunter
manifestations, Wolf-riders, spiders): "May be played as a hazard creature or as
a short-event/permanent-event."

```json
{ "type": "creature-alt-event", "mode": "short-event" }
```

- `mode` — the alternative event mode the creature may also be played in:
  `"short-event"` or `"permanent-event"`.

The effect is purely the **mode declaration**. It carries no behaviour of its
own: the alternative mode's actual effects are the card's *other* top-level
effects, which resolve through the ordinary event chain path once the card is
played in event mode. This keeps dual-mode cards fully declarative and reuses
existing primitives rather than duplicating them.

- The **legal-action generator** (`playHazardsActions` in
  `legal-actions/movement-hazard.ts`) offers the alternative event as its own
  `play-hazard` action carrying `altEventMode`, alongside the keyed-creature
  actions. The event mode needs **no creature keying** and — unlike a
  race-exempt creature — is **not** exempt from the hazard limit.
- The **play reducer** (`handlePlayHazardCard` in `mh-hazard-play.ts`) routes an
  `altEventMode: "short-event"` play of a hazard-creature through the same
  bookkeeping as any hazard short-event (card → discard, hazard-limit tally,
  short-event chain entry), so the card's top-level effects then resolve
  normally.

For **Mouth of Sauron (tw-65)** ("or as a short-event; if played as a
short-event, bring any hazard card from your discard pile back into your hand"),
the companion effect is a `move` (`from: "discard"`, `to: "hand"`, filtered to
any hazard `cardType`), which the short-event chain resolution bridges into the
existing fetch-to-hand pending sub-flow.

This effect is distinct from `play-flag: playable-as-event`, which only feeds
the deck-construction ½-creature weighting (`deck-validation.ts`) and carries no
mode; both may coexist on a card.

### 56b. `company-return-to-origin`

Forces the active movement/hazard company back to its **site of origin** (CoE
rule 2.IV.4 mechanism, shared with `agent-discard-return-to-origin`): the
company keeps its origin site instead of its destination and may not act during
its site phase (a `site-phase-do-nothing` constraint is added). Carried by a
hazard short-event — including a dual-mode creature played as a short-event (see
`creature-alt-event`) — and applied on chain resolution.

```json
{
  "type": "company-return-to-origin",
  "unless": {
    "$or": [
      { "company.characterNames": { "$includes": "Beorn" } },
      { "company.maxUntappedWarriorProwess": { "$gt": 4 } }
    ]
  }
}
```

- `unless` (optional) — a DSL condition evaluated against the target company
  (context from `buildTargetCompanyConditionContext`: `company.alignment`,
  `company.characterNames`, `company.maxUntappedWarriorProwess`, …). When it
  matches, the return is **skipped** and the card resolves with no effect.

The resolution lives in `applyCompanyReturnToOrigin` (`chain-reducer.ts`), which
sets `MovementHazardPhaseState.returnedToOrigin` (honoured by `endCompanyMH`)
and adds the `site-phase-do-nothing` constraint.

Used by **Beorning Skin-changers (ba-10)**, played as a short-event against a
moving hero company: "Unless the company contains Beorn or an untapped warrior
with prowess greater than 4, it must return to its site of origin." Its
`creature-alt-event` (mode `short-event`) additionally carries
`requiresMovingCompany: true` and `targetCompany: { "company.alignment": "hero" }`
so the short-event mode is only offered against a *moving hero* company (whereas
its creature mode targets minion companies).

### 56c. `creature-alt-event` permanent-event mode + `tap-character`

The `creature-alt-event` primitive (§56a) also supports `mode: "permanent-event"`
for dual creature/permanent-event cards (Ûvatha tw-107, Adûnaphel tw-2, Khamûl
the Easterling tw-47):

```json
{ "type": "creature-alt-event", "mode": "permanent-event" }
```

Played in this mode, the creature enters the hazard player's `cardsInPlay`
untapped (via the standard permanent-event chain path). It sits there until the
hazard player **taps** it during the opponent's movement/hazard phase with a
`tap-alt-permanent-event` action — which "becomes a short-event": the card is
removed from play and discarded, **counts one against the hazard limit**, and
its on-tap effects resolve through the ordinary short-event chain path. Legal
actions: `tapAltPermanentEventActions` (`legal-actions/movement-hazard.ts`);
reducer: `handleTapAltPermanentEvent` (`mh-hazard-play.ts`).

The on-tap behaviour is the card's other top-level effects:

- **tw-107** — a `move` (`from: "discard"`, `to: "hand"`, filter
  `{ "cardType": "hazard-creature" }`): fetch one hazard creature from the
  discard pile to hand (shared fetch-to-hand sub-flow).
- **tw-2** — a `tap-character` effect (below).
- **tw-47** (Khamûl the Easterling) — a `force-opponent-discard` effect
  (`match: "any"`) with a dynamic `count` (§6e): the opponent discards one card
  per Nazgûl permanent-event in play, the number fixed at tap-declaration time.

**`tap-character`** taps one chosen character in play:

```json
{ "type": "tap-character" }
```

- `filter` (optional) — a condition on the target character definition; absent =
  any character in play. The legal-action generator emits one action per
  eligible untapped target; the choice rides on the action's `targetCharacterId`
  and is applied on chain resolution (`applyTapCharacter`, `chain-reducer.ts`).

Used by Adûnaphel tw-2's on-tap: "When tapped, … causes any one character to tap."

### 57. `agent-tap-return-character`

Hazard short-event played on one of the hazard player's **untapped agents**. The
card taps the agent and rolls to bounce an opponent character — chosen by the
card player — whose **home site matches the agent's current site** back to its
owner's hand.

| Field | Required | Description |
|-------|----------|-------------|
| `atHomeSiteBonus` | yes | Added to the 2d6 roll when the agent's current site is also one of its own home sites. |
| `mindBonus` | yes | Added to the target character's mind to form the roll threshold. |

```json
{ "type": "agent-tap-return-character", "atHomeSiteBonus": 5, "mindBonus": 5 }
```

- **Legal actions** (`movementHazardActions` short-event branch,
  `legal-actions/movement-hazard.ts`): offered whenever the hazard player has an
  untapped agent and the opponent (resource player) has a character in play whose
  parsed home sites include the agent's current site (top of its site stack, or
  its first home site for a face-down agent sitting at home). One `play-hazard`
  action is emitted per `(agent, target character)` pair, carrying
  `agentInstanceId` + `targetCharacterId`. Independent of the active company (the
  target may be in any of the opponent's companies). Blocked when the opponent is
  a minion/Balrog player (`isMinionOrBalrog`), matching "Cannot be played if your
  opponent is a minion player."
- **Reducer** (`handleAgentTapReturnCharacter`, `mh-agents.ts`, dispatched from
  `mh-hazard-play.ts`): taps the agent, discards the event, counts it against the
  hazard limit, and enqueues a generic `dice-check` pending resolution — roller =
  the hazard player, `comparison: "gt"`, `threshold = targetMind + mindBonus`,
  and a `constant` `atHomeSiteBonus` modifier when the agent is at home. Its
  `onPass` is `return-character-to-hand` with `allowItemTransfer: true`.
- **Return + item transfer**: the `return-character-to-hand` branch
  (`applyDiceCheckBranch`) locates the target's actual owner (the returned
  character belongs to the *opponent* of the roller) and calls
  `returnCharacterToHand`. With `allowItemTransfer`, the character's items are
  discarded but a `transfer-returned-item` pending resolution lets the owner pull
  **one** item back onto a remaining company-mate ("one item may be transferred
  to another character in the same company"), or decline; the rest stay
  discarded. Legal actions / reducer: `transferReturnedItemActions`
  (`legal-actions/pending.ts`) / `applyTransferReturnedItemResolution`
  (`pending-reducers.ts`).

Used by Pilfer Anything Unwatched (as-33): "Playable on an untapped agent. Tap
the agent. Make a roll for a character in play of your choice with a home site
the same as the agent's current site. To the roll add 5 if the agent's current
site is also the agent's home site. If the result is greater than the
character's mind plus 5, the character is returned to his player's hand (one item
may be transferred to another character in the same company). Cannot be played if
your opponent is a minion player."

### 58. `agent-reveal-site-override` + `fetch-agent-to-hand` (dual-mode agent card)

Two effects that together model Inner Cunning (dm-68), a hazard-event playable
**either** as a permanent-event on one of the hazard player's own face-down
agents **or** as a short-event agent tutor. Both modes are blocked when the
opponent (resource player) is a minion/Balrog player (`isMinionOrBalrog`),
matching "Cannot be played if your opponent is a minion player."

The Shadow-hold / Dark-hold classification of an agent's printed home site is
keyed off the agent's own **alignment** map: a single site name can exist in
more than one alignment with different types (e.g. Dol Guldur is a minion
*haven* but a hero *dark-hold*). The shared helper
`agentHomeSiteMatchesTypes(state, def, types)` (`reducer-utils.ts`) resolves each
`homesite` name to a site of the character's alignment (falling back to any) and
checks its `siteType`.

#### `agent-reveal-site-override` (mode 1 — permanent-event)

| Field | Required | Description |
|-------|----------|-------------|
| `homeSiteTypes` | yes | Site types the reveal site may be broadened to (e.g. `["shadow-hold", "dark-hold"]`). |

```json
{ "type": "agent-reveal-site-override", "homeSiteTypes": ["shadow-hold", "dark-hold"] }
```

- **Legal actions** (`legal-actions/movement-hazard.ts`): during the hazard
  player's play-hazards window the card is offered as a `play-hazard` action with
  `altEventMode: "permanent-event"` + `targetAgentId`, one per **face-down agent
  brought into play this turn** (`!agent.inPlayAtTurnStart` and not revealed).
- **Reducer** (`mh-hazard-play.ts` → `chain-reducer.ts`): plays as a permanent
  event (counts against the hazard limit) that enters the hazard player's
  `cardsInPlay` bound to the agent via `CardInPlay.attachedToAgentId`.
- **Reveal broadening**: while attached — **and** if the agent's printed home
  site is one of `homeSiteTypes` — `revealAgentActions` (via
  `agentRevealSiteOverrideTypes`) offers the agent's reveal at **any**
  location-deck site of those types, not only at a site matching the agent's
  printed home-site name ("the site where he came into play … may legally be any
  Shadow-hold or Dark-hold").
- **Discard on reveal**: once the agent is revealed it is no longer face-down, so
  the post-reduce sweep `discardOrphanedAgentAttachedEvents` (`reducer-utils.ts`,
  wired into `postReduce`) discards the card ("Discard when the agent is
  revealed"). The same sweep discards it if the agent leaves play unrevealed.

#### `fetch-agent-to-hand` (mode 2 — short-event tutor)

| Field | Required | Description |
|-------|----------|-------------|
| `homeSiteTypes` | yes | Home-site types an eligible agent's printed home site must be one of. |

```json
{ "type": "fetch-agent-to-hand", "homeSiteTypes": ["shadow-hold", "dark-hold"] }
```

- **Legal actions**: offered as a `play-hazard` action with
  `altEventMode: "short-event"`, viable only when the play deck holds a matching
  agent.
- **Reducer** (`mh-hazard-play.ts` short branch → `chain-reducer.ts`): plays as a
  short-event (counts against the hazard limit). On chain resolution it enqueues a
  `fetch-to-deck` pending effect (`source: ["deck"]`, `to: "hand"`,
  `shuffle: true`, `revealToOpponent: true`, `filter` requiring the `agent`
  keyword, `homeSiteTypes` set, `actor` = the hazard player). The hazard player
  then picks one matching agent via a `fetch-from-pile` pending resolution (or
  passes); the deck is reshuffled and the fetched agent is revealed to the
  opponent (`handleFetchFromPile`, `reducer-utils.ts`).
- The `homeSiteTypes` and `revealToOpponent` fields are generic additions to
  `FetchToDeckEffect`, honoured by both the fetch enumerator
  (`legal-actions/index.ts`) and `handleFetchFromPile`.

Used by Inner Cunning (dm-68): "As a permanent-event, playable on a face-down
agent who was brought into play this turn. When the agent is revealed, and if his
home site is a Shadow-hold or a Dark-hold, the site where he came into play …
may legally be any Shadow-hold or a Dark-hold. Discard when the agent is
revealed. Alternatively, as a short-event, take any agent who has a home site
that is a Shadow-hold or Dark-hold from your play deck into your hand (reveal it
to your opponent and reshuffle your play deck). Cannot be played if your opponent
is a minion player."

### 59. `seized-by-terror-check`

Hazard short-event check played on a **character** in the active Movement/Hazard
company (paired with a `play-target` `target: 'character'` and, typically, a
`play-condition` `requires: 'site-path'`). When the short-event chain entry
resolves un-negated (`chain-reducer.ts`), the engine enqueues a
`seized-by-terror-roll` pending resolution: the targeted character's player rolls
2d6 and adds the character's mind. If `roll + mind < threshold`, the character
**splits off into a new company** that immediately returns to the original
company's site of origin (`splitCharacterToOrigin` in `pending-reducers.ts` — a
lone character's whole company returns to origin; otherwise the character forms a
new solo company at the origin site). No card instance is lost.

| Field | Required | Description |
|-------|----------|-------------|
| `threshold` | yes | Roll + character mind must be **≥** this to keep the character in the moving company. |

```json
{ "type": "seized-by-terror-check", "threshold": 12 }
```

Used by Seized by Terror (dm-88, threshold 12, keyed to Shadow-land/Dark-domain)
and Faces of the Dead (dm-57, threshold 13, keyed to two Wildernesses — see
`play-discard-cost` below).

### 60. `play-discard-cost`

A **play cost** requiring the playing player to discard a card matching `filter`
from the named `source` pile as part of playing the card. The legal-action layer
offers one action per matching candidate (cross-multiplied with any character
target) so the player chooses which card to sacrifice; if no candidate is
available, the card is not playable at all. When `revealToOpponent` is set, the
discarded card's identity is revealed to the opponent (`revealInstances`),
satisfying a "show opponent" clause. The chosen card is carried on the
`play-hazard` action as `costDiscardInstanceId`; the reducer
(`mh-hazard-play.ts`) validates it against `filter`, moves it to the discard
pile, and rejects the play if the cost was not paid. The cost is offered on both
**character-targeting** short events (dm-57) and **untargeted** short events
(Desire All for Thy Belly ba-16, "discard a Spawn card from your hand").

| Field | Required | Description |
|-------|----------|-------------|
| `source` | yes | Pile the cost card is discarded from. Currently only `"hand"`. |
| `filter` | yes | DSL condition matched against candidate card definitions in the source. |
| `revealToOpponent` | no | When `true`, the discarded card's identity is revealed to the opponent. |

```json
{ "type": "play-discard-cost",
  "source": "hand",
  "filter": { "cardType": "hazard-creature", "race": "undead" },
  "revealToOpponent": true }
```

Used by Faces of the Dead (dm-57): "Playable on a non-Wizard character moving
with at least two Wildernesses [{w}] in his site path **if you discard any Undead
hazard creature from your hand (show opponent)**." Modeled as a `play-condition`
(`site-path`, `sitePath.wildernessCount >= 2`), this `play-discard-cost`, a
`play-target` (`character`, `target.race != wizard`), and a
`seized-by-terror-check` (`threshold: 13`).

### 61. `opponent-influence-override` (Prophet of Doom)

Modifies a **named influencer's** opponent-influence attempts (CoE rule 10.10 —
influencing away an opponent's in-play character/ally/faction during your site
phase). Carried by an in-play stage permanent-event; while the card is in play,
every opponent-influence attempt made by the influencer whose name matches
`influencer` (the active player's avatar) is modified:

- `fromAnySite` — the influencer "need not be at the appropriate site": the
  normal same-site requirement is lifted, so he may target the opponent's cards
  in any of their companies (and any of their in-play factions), regardless of
  where his own (active) company stands. The legal-action generator
  (`opponentInfluenceActions` in `legal-actions/site.ts`) offers the override
  influencer targets at every opponent company / faction; other influencers stay
  bound to the same site.
- `generalInfluenceSubstitution` — the influence check adds a value derived from
  the influencer's *player's unused general influence* (`unusedGI / divisor`,
  rounded up when `roundUp`, capped at `max`) **instead of** the influencer's
  unused direct influence.
- `regionDistancePenalty` — subtract the number of regions between the
  influencer's site and the site where the attempt would normally be made (for a
  character/ally, the opponent company's site; for a faction, the nearest region
  it is playable in). Per CRF 22 the count is **inclusive** of both endpoint
  regions (same region = 1, adjacent = 2, …).

The reducer (`handleOpponentInfluenceAttempt` in `reducer-site.ts`) detects the
override from state (matching `influencer` to the tapping character's name and
finding the card in play), substitutes the general-influence contribution for
the influencer's DI in the queued `opponent-influence-defend` payload, and
records the `regionPenalty`, which `resolveOpponentInfluenceDefend` subtracts
from the attacker's final result.

| Field | Required | Description |
|-------|----------|-------------|
| `influencer` | yes | Name of the influencer this override applies to (e.g. `"Pallando"`). |
| `fromAnySite` | no | Lift the same-site requirement — target opponents at any site. |
| `generalInfluenceSubstitution` | no | `{ divisor, roundUp?, max }` — substitute the influencer's DI with `unusedGI / divisor` (rounded up / down), capped at `max`. |
| `regionDistancePenalty` | no | Subtract the inclusive region distance to the target's site. |

```json
{ "type": "opponent-influence-override",
  "influencer": "Pallando",
  "fromAnySite": true,
  "generalInfluenceSubstitution": { "divisor": 2, "roundUp": true, "max": 10 },
  "regionDistancePenalty": true }
```

Used by Prophet of Doom (wh-106).

### 62. `discard-self-when`

Discards the carrying in-play card the moment a player-state condition holds.
Evaluated as `postReduce` housekeeping (`sweepDiscardSelfWhen` in
`discard-self-when.ts`) against the card controller's player-state context — the
same context used by `play-condition` `requires: "player-state"`
(`player.avatar`, `player.stagePoints`, `player.factionCount`, …). Distinct from
the play-condition, which gates *entry* to play; this gates *staying* in play.

| Field | Required | Description |
|-------|----------|-------------|
| `condition` | yes | DSL condition (against the player-state context) that forces the discard. |

```json
{ "type": "discard-self-when",
  "condition": { "player.factionCount": { "$lt": 5 } } }
```

Used by Prophet of Doom (wh-106): "Discard if you have fewer than 5 factions in
play."

### 63. `item-play-corruption-check` (Greed)

A hazard **short-event** played on a company's site (`play-target: site`) that,
until the end of the turn, forces the characters at that site to make a
corruption check whenever an item is played there. On resolution the short-event
installs a turn-scoped `item-play-corruption-check` {@link ActiveConstraint}
bound to the target site (threaded via the chain payload's
`targetSiteDefinitionId`) and targeting the resource (item-playing) player; the
card itself goes to discard as a normal short event.

During the site phase, when an item is played at the bound site, the item-play
handler `fireItemPlayCorruptionChecks` (`reducer-site.ts`) enqueues one
corruption check per character in the company **except** the character playing
the item and any character matching `exemptFilter`. Each check is modified by
subtracting the item's printed `corruptionPoints` (so a cp-2 item ⇒ `modifier
-2`). Per CRF 22, the trigger fires only on item *play* (including a special
ring item) — never on item *transfer*, since transfers do not route through the
item-play handler.

| Field | Required | Description |
|-------|----------|-------------|
| `exemptFilter` | no | DSL condition on the `target.*` character context (race/skills/name). Matching characters make no check. Absent ⇒ every character (other than the item-player) checks. |

```json
{ "type": "item-play-corruption-check",
  "exemptFilter": { "target.race": { "$in": ["hobbit", "wizard", "ringwraith"] } } }
```

The companion effects on the card are `play-target: site` (the site the event is
played on) and `duplication-limit` scope `site` — "Cannot be duplicated on a
given site" is enforced by the hazard short-event dup-limit check in
`legal-actions/movement-hazard.ts`, which counts the resolved copy's active
`item-play-corruption-check` constraint bound to the same site. The constraint
kind is `item-play-corruption-check` in `types/pending.ts`, swept at turn-end via
its `scope: "turn"`.

Used by: *Greed* (le-113 / tw-42) — "each non-Hobbit, non-Wizard, non-Ringwraith
character at the site must make a corruption check each time an item is played at
the site … modified by subtracting the corruption points the item would normally
give the character."
