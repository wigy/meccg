# Card Effects DSL

Every card's effects are described declaratively in the JSON card database. A resolver engine evaluates them at each decision point by collecting all in-play effects, filtering by conditions, and computing final values.

## Condition Language

Conditions use MongoDB-style query operators. An object with multiple keys is an implicit AND.

```json
{ "bearer.race": "hobbit" }
{ "reason": "combat", "enemy.race": "orc" }
{ "$and": [{ "reason": "combat" }, { "enemy.race": "orc" }] }
{ "$or": [{ "enemy.race": "undead" }, { "enemy.race": "ringwraith" }] }
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

The four comparison operators (`$gt`, `$gte`, `$lt`, `$lte`) accept either a
number literal or a **context-path string** resolved against the same context
at match time; the comparison fails unless both sides resolve to numbers.
This backs card text comparing two stats — Whip (le-348) "prowess less than
the bearer's": `{ "target.prowess": { "$lt": "bearer.prowess" } }`.

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

During strike resolution the combat context also exposes `combat.strikeMode` —
the way the character is facing the current strike (`"tap"`, `"untap"`,
`"dodge"`, `"reroll"`). It lets a prowess modifier apply only "when tapping to
face a strike": the bonus is threaded through `computeCombatProwess` for the
creature-facing path (and reflected in the tap/untap need shown by the
legal-action computer). Because `combat.strikeMode` is absent outside strike
resolution, such a modifier never leaks into a character's non-combat effective
stats. Example — Stabbing Tongue of Fire (ba-81) / Whip of Many Thongs (ba-82):
"+1 prowess when tapping to face a strike":

```json
{ "type": "stat-modifier", "stat": "prowess", "value": 1,
  "when": { "combat.strikeMode": "tap" } }
```

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
during `recomputeDerived` from an item / attached permanent-event on a character
(Bade to Rule le-167 on the Ringwraith, Great Shadow ba-62 on the Balrog), from an attached
**hazard** (Cruel Claw Perceived wh-16, the opponent's permanent-event played on a Wizard /
Fallen-wizard / Ringwraith), **and** from a bare stage permanent-event sitting in the
player's `cardsInPlay` (Truths of Doom wh-108).
`PlayerState.generalInfluenceBonus` is incremented by `value`; effective GI pool =
`GENERAL_INFLUENCE (20) + generalInfluenceBonus` (for a Fallen-wizard, the avatar's
white-hand number replaces the 20). `value` may be negative, which shrinks the pool.
Example: Bade to Rule (le-167) grants +5 GI to the Ringwraith player while attached to the
Ringwraith.

A `when` on a character-borne general-influence modifier is evaluated against the bearer
context — `bearer.race`, `bearer.stagePoints` (the controller's Fallen-wizard stage-point
total) and the rest of `buildBearerContext`. That lets one card carry a ladder of mutually
exclusive alternatives over disjoint bands, e.g. Cruel Claw Perceived's `-1` for a Wizard or
Ringwraith bearer versus `-9 / -7 / -5 / -3` for a Fallen-wizard by stage points. A bare
`cardsInPlay` card has no bearer, so a bearer-gated `when` never fires from there.

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

For automatic-attacks the resolution context also exposes `site.siteType` — the
defending company's effective current-site type — so a global modifier can gate
on the site type it applies at, e.g. `when: { "site.siteType": { "$in": ["free-hold",
"border-hold"] } }` (Awaken Defenders le-103 / Awaken Denizens / Awaken Minions:
"strikes … at a Free-hold / Ruins & Lairs / Shadow-hold … doubled").

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
- `"company"` — applies to **every** character in the bearer's company,
  **including the bearer** (contrast `company-others`). Collected once per
  company member by `collectCompanyItemEffects`, which scans both the `.items`
  **and** the attached `.hazards` of every company member, so the modifier may
  ride an item (The One Ring's +1 corruption) or an attached hazard perm-event.
  Each effect's `when` is evaluated against the **modified** character's context
  (`bearer.race`, …). Used by *Diminish and Depart* (ba-17): "All Elves and
  Hobbits in the target's company have +1 mind, and a Wizard in the company has
  -1 direct influence" —
  `{ "stat": "mind", "value": 1, "target": "company", "when": { "bearer.race": { "$in": ["elf", "hobbit"] } } }`
  and
  `{ "stat": "direct-influence", "value": -1, "target": "company", "when": { "bearer.race": "wizard" } }`.
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

Both influence-check contexts — the faction-influence check and the
`opponent-influence-check` attempt against a card the opponent controls — also
expose **`influenceTarget`**: `alignment` (`"hero"`, `"minion"`,
`"fallen-wizard"`, `"balrog"`, read off the target's card-type prefix), `kind`
(`"faction"`, `"character"`, `"ally"`, `"item"`), `name`, and `race`. Unlike
`faction` / `target`, which each exist in only one of the two paths, this
sub-object is present in both, so "influence checks against <kind of card>"
needs a single condition. The influencer's **ongoing** influence
check-modifiers — his own and those on his items / attached hazards — are folded
into the opponent-influence attempt as well as the faction attempt, so a card
that modifies "any influence attempt by this character" (Foolish Words td-25)
covers both. The `bearer.stagePoints` path (the controller's MEWH §1 total) is
populated in both contexts too.

Used by Fool's Bane (wh-19): "Influence checks he makes against hero resources
are modified by: -9 if his stage points exceed 18, -7 if … (use the first
modifier that applies)" — five mutually exclusive tiers, each gated on a
half-open `bearer.stagePoints` band plus the hero-resource test. A character is
not a resource card (CoE: "resource cards … and character cards"), hence the
`kind` exclusion:

```json
{ "type": "check-modifier", "check": "influence", "value": -7,
  "when": { "$and": [
    { "influenceTarget.alignment": "hero" },
    { "influenceTarget.kind": { "$ne": "character" } },
    { "bearer.stagePoints": { "$gt": 12 } },
    { "bearer.stagePoints": { "$lte": 18 } } ] } }
```

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

### `grant-ally-play`

Extends ally-play permission from a permanent-event attached to a character (the
*bearer*). While in play, any ally matching `filter` becomes playable in the
bearer's company at its **current site** — bypassing the ally's printed
`playableAt` — and, when `fromDiscard` is set, may be sourced from the player's
**discard pile** as well as the hand. When `excludeBearerControlsCopy` is set, an
ally is excluded if the bearer already controls a copy of it (matched by card
name). `filter` is matched against the candidate ally's definition wrapped as
`{ target: allyDef }` (so `target.unique`, `target.mind`, `target.race`, … are
available).

Implemented in `legal-actions/site.ts` (the ally site-match is relaxed via
`allyPlayGrantAllowsAlly`, and a discard-source loop offers granted allies with
`fromDiscard`) and `reducer-site.ts` (a `fromDiscard` `play-hero-resource`
removes the card from the discard pile instead of the hand). All the normal ally
gates still apply (untapped site, company open to joins, an untapped controller,
manifestation blocks, company duplication limits, MEWH §10 cross-alignment, Eddy
tax). Used by Glove of Radagast (wh-111): "Any non-unique ally with 1 mind (a
copy of which he does not already control) is considered playable with Radagast
at his site. This ally may be taken from your discard pile or hand."

```json
{ "type": "grant-ally-play",
  "filter": { "$and": [ { "target.unique": { "$ne": true } }, { "target.mind": 1 } ] },
  "excludeBearerControlsCopy": true,
  "fromDiscard": true }
```

A **player-scoped, Wizardhaven-keyed** variant (`atProtectedWizardhavens: true`)
lives on a free-standing permanent-event in the player's `cardsInPlay` instead
of on a bearer character. The engine finds it via `findWizardhavenAllyPlayGrant`
and extends playability to a matching ally only when the acting company's
current site is one of the player's own **protected Wizardhavens**
(`siteIsProtectedByPlayer` ∧ `isHavenForPlayer`). `allowTappedSite: true` lifts
the untapped-site requirement (the Wizardhaven may be tapped or untapped);
`oncePerSitePhase: true` limits it to one grant-enabled ally per site phase — the
reducer records a turn-scoped `granted-action-used` lock (action id
`grant-ally-play`) keyed by the granting card, read back via
`grantedActionUsedThisTurn`. The play carries `viaWizardhavenAllyGrant` (the
grant card's instance id) so only a play that actually *depends* on the grant
(i.e. the ally is not independently playable at the site in its current
tapped/untapped state) consumes the allowance. Used by An Untimely Brood (wh-62):
"One non-unique ally with a mind of 1 is playable at one of your tapped or
untapped protected Wizardhavens each of your site phases."

```json
{ "type": "grant-ally-play",
  "filter": { "$and": [ { "target.unique": { "$ne": true } }, { "target.mind": 1 } ] },
  "atProtectedWizardhavens": true,
  "allowTappedSite": true,
  "oncePerSitePhase": true }
```

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

A **player-scoped, ongoing** influence `check-modifier` is instead expressed as
a bare `check-modifier` effect carrying `"target": "player-in-play"`, borne by a
bare permanent-event in the influencing player's `cardsInPlay` (not attached to
any character/item/site/agent/company). It is collected directly from that
player's in-play permanent resource events at every faction-influence check
(`collectPlayerInPlayInfluenceEffects`, `reducer-utils.ts`, called from both the
`legal-actions/site.ts` display and the `reducer-site.ts` roll resolver), gated
by its own `when` against the faction-influence resolver context (`faction.race`
etc.). Unlike the ba-78 constraint form, the bonus lasts exactly as long as the
card stays in play rather than for a fixed scope. Used by Great Army of the
North (ba-38): "As a permanent-event, +1 to your influence attempts against Orc
and Troll factions."

```json
{ "type": "check-modifier", "check": "influence", "value": 1, "target": "player-in-play",
  "when": { "reason": "faction-influence-check", "faction.race": { "$in": ["orc", "troll"] } } }
```

A **game-wide, ongoing** `check-modifier` is expressed with
`"target": "all-in-play"`, borne by a bare in-play event (permanent- or
long-event) in *either* player's `cardsInPlay`. Unlike `player-in-play` (which
benefits only its owner), an `all-in-play` modifier applies to **every** matching
check by **either** player, for as long as the card stays in play. It is summed
by `collectGlobalCheckModifier` (`reducer-utils.ts`) — a both-players scan that
mirrors `collectFactionInfluenceRestriction` — and folded into the influence need
at all three sites (`legal-actions/site.ts` display, `legal-actions/pending.ts`
paused-roll display, `reducer-site.ts` roll resolver), gated by its own `when`
against the check resolver context. Used by Times Are Evil (td-76), a hazard
long-event: "All offering attempts and influence attempts are modified by -3."

```json
{ "type": "check-modifier", "check": ["influence", "offering"], "value": -3, "target": "all-in-play" }
```

### `nullify-influence-modifications` — strip every card modifier from influence attempts

`{ "type": "nullify-influence-modifications" }` is a game-wide environment
effect carried by a bare in-play event. While one is in play in **either**
player's `cardsInPlay`, `influenceModificationsNullified` (`reducer-utils.ts`)
reports true and every influence-check computation in the engine collapses to
the printed target value plus the two contributions the card spares. Used by
Webs of Fear & Treachery (le-150), a hazard long-event: "Except for unused
general influence and unused normal direct influence (including influence
modifications given in a character's card text), all modifications to each
influence attempt are reduced to zero."

**Survives the nullification:** the 2d6 roll(s) and the printed target value (a
faction's influence #, a target's mind, an in-play faction's influence #);
unused **general** influence (including a `generalInfluenceSubstitution`
override, which yields exactly that); unused **normal** direct influence —
computed by `normalUnusedDI` (`legal-actions/organization.ts`) as the
influencer's *printed* `directInfluence` plus the `direct-influence`
`stat-modifier` effects on his **own card** (the `sourceInstance ===
<influencer>` slice of `collectCharacterEffects`), minus his followers' mind
cost, deliberately **not** read off `effectiveStats.directInfluence`; and
rules-level modifications — the cross-alignment penalty and the rule 10.14
agent home-site bonuses. The defender's roll in an opponent-influence attempt
is untouched (Alfano, Worlds 2009).

**Reduced to zero:** every other card-sourced modification — influence
`check-modifier` and `direct-influence` `stat-modifier` effects from items,
attached hazards, allies, `player-in-play` and `all-in-play` events; a faction
card's own printed "Standard Modifications"; one-shot influence
`check-modifier` constraints (Muster, `prowessSubstitution`, the
opponent-influence boosters), which are still **consumed** by the attempt but
worth 0; player-, site- and game-wide influence constraints
(`influence-at-site-modifier`, `site-lock` faction modifiers);
`faction-influence-restriction` environments; the Prophet of Doom region
penalty; and paid `influence-modification` bonuses (which are also no longer
offered, so no item is discarded for nothing).

The flag is consulted at every influence site: `legal-actions/site.ts` (the
faction-influence need and the opponent-influence display), `legal-actions/
pending.ts` (paused faction-influence roll), `reducer-site.ts` (faction roll
resolver and opponent-influence attempt) and `mh-agents.ts` (rule 10.14 agent
attempt).

```json
{ "type": "nullify-influence-modifications" }
```

### `auto-influence-faction` — no-check influence of a named faction

`{ "type": "auto-influence-faction", "faction": "<Faction Name>" }` grants the
carrier the ability to influence a specific named faction with **no 2d6 check** —
the attempt succeeds automatically. It flows to the influencer through
`collectCharacterEffects` in the `faction-influence-check` context, so an item's
grant reaches its bearer. `resolveAutoInfluenceFaction` (`resolver.ts`) tests the
collected effects against the faction being influenced; when it matches, both the
`legal-actions/site.ts` display (`need: 0`, "Automatic influence") and the
`reducer-site.ts` roll resolver skip the roll and treat the attempt as a
guaranteed success (the site still taps as usual). Used by Red Arrow (tw-312):
"Bearer may automatically influence the Riders of Rohan."

```json
{ "type": "auto-influence-faction", "faction": "Riders of Rohan" }
```

A one-shot influence booster may instead be scoped to an **opponent-influence
attempt** (influencing an opponent's in-play card — CoE rule 8, "Mine or No
One's" ba-68) rather than a faction-influence roll. This uses the ordinary
`play-target` + `play-option` → `add-constraint check-modifier check:"influence"`
form (the Muster shape), but the `apply` carries an extra `constraintWhen`
condition. That condition is stored on the resulting one-shot constraint and
evaluated at the influence step against an `opponent-influence-check` resolver
context that exposes `bearer` (the influencer) and `target` (`{ kind, race,
name }`, where `kind` is `"character" | "ally" | "faction" | "item"`). The
modifier is applied — and consumed — only when the condition matches. Two rules
keep the two influence flavours from stealing each other's boosters:

- The **opponent-influence** declaration consumes a one-shot influence
  constraint only when it carries a matching `constraintWhen`. A constraint with
  no `when` is left alone (it belongs to the faction path).
- The **faction-influence** roll consumes a one-shot influence constraint when
  it has no `when`, or when its `when` matches the faction context. A
  `constraintWhen` gated on `reason: "opponent-influence-check"` never matches
  there, so it is not swallowed by an ordinary faction check.

Used by Mine or No One's (ba-68): "+10 to an influence attempt by The Balrog
against an opponent's item, ally, Troll faction, or Orc faction. Cannot be
duplicated on a given attempt." (`duplication-limit` scope `"active-check"`
enforces the last sentence.)

```json
{ "type": "play-option", "id": "influence-boost",
  "apply": { "type": "add-constraint", "constraint": "check-modifier", "check": "influence",
             "scope": "until-cleared", "value": 10,
             "constraintWhen": { "reason": "opponent-influence-check",
               "$or": [ { "target.kind": "item" }, { "target.kind": "ally" },
                        { "$and": [ { "target.kind": "faction" },
                                    { "target.race": { "$in": ["orc", "troll"] } } ] } ] } } }
```

A one-shot faction-influence booster may also change the **fate of the faction
card on failure**: `onFailure: "shuffle-faction-into-deck"` on the
`add-constraint check-modifier` apply is carried onto the constraint, and when
the consuming faction-influence roll fails, the faction is shuffled back into
its player's play deck instead of going to the discard pile
(`resolveInfluenceAttemptRoll` in `reducer-site.ts`). Because such a card boosts
"an influence check" without naming a character, its `play-target` uses the
`target.isInfluencing` context flag — true only for the character whose
influence-attempt is live in the chain (`buildPlayOptionContext`) — so the
constraint lands on, and is consumed by, exactly the check the card was played
on. The "Playable if you are Sauron" gate is a `play-condition` `player-state`
against `player.playsAsSauron`, true while the player counts as Sauron via a
`play-as-sauron` marker in play (The Lidless Eye le-203 / Sauron ba-43). Used by
The Dark Power (as-79): "Playable if you are Sauron. +3 to an influence check
against a faction. If the check is not successful, shuffle the faction into your
play deck."

```json
{ "type": "play-condition", "requires": "player-state",
  "condition": { "player.playsAsSauron": true } },
{ "type": "play-target", "target": "character",
  "filter": { "target.isInfluencing": true } },
{ "type": "play-option", "id": "dark-power-boost",
  "when": { "player.hasFactionInHand": true },
  "apply": { "type": "add-constraint", "constraint": "check-modifier", "check": "influence",
             "value": 3, "scope": "until-cleared", "onFailure": "shuffle-faction-into-deck" } }
```

A one-shot faction-influence constraint may instead carry a
**`prowessSubstitution`** payload: `{ "max": N }` on the `add-constraint
check-modifier` apply (no `value`/`valueExpr` needed). When the
faction-influence check consumes such a constraint, the influencer's whole
unused-direct-influence contribution — free DI plus conditional
`direct-influence` bonuses — is removed from the check and
`min(effective prowess, max)` is added in its place. Unlike Muster's play-time
`valueExpr`, the prowess is read at **resolution** time from the character's
effective stats (CRF 22 on Threats: "your prowess is calculated when it
resolves"), so item prowess bonuses gained or lost between play and roll are
honoured. Applied at all three influence seams: the influence-attempt need
display (`legal-actions/site.ts`), the pending faction-influence-roll need
(`legal-actions/pending.ts`), and the roll resolver (`reducer-site.ts`, which
also consumes the constraint). Used by Threats (le-244): "Warrior only.
Playable on a warrior attempting to influence a faction. Warrior does not use
his unused direct influence for the attempt. Instead he uses his prowess, to a
maximum modifier of +6." — the play-target pins the card to the influencing
warrior via `target.isInfluencing` (the Dark Power shape) AND a warrior skill
filter:

```json
{ "type": "play-target", "target": "character",
  "filter": { "$and": [ { "target.skills": { "$includes": "warrior" } },
                        { "target.isInfluencing": true } ] } },
{ "type": "play-option", "id": "influence-boost",
  "when": { "player.hasFactionInHand": true },
  "apply": { "type": "add-constraint", "constraint": "check-modifier", "check": "influence",
             "scope": "until-cleared", "prowessSubstitution": { "max": 6 } } }
```

Beyond one-shot constraints, a **persistent** `stat-modifier direct-influence`
borne by the influencer is also folded into an opponent-influence attempt when
its `when` matches the `opponent-influence-check` context. `reducer-site.ts`
collects the influencer's `when`-gated stat-modifiers (`collectCharacterEffects`
with the opponent-influence context) and adds them to the influencer's
contribution. Only `when`-gated modifiers are folded in here — an unconditional
`direct-influence` modifier is already baked into effective DI (and thus into
`availableDI`), so including it again would double-count. This is how a "+X
direct influence against characters" item applies to influencing an opponent's
character but not an ally/item/faction. Used by Trifling Ring (le-346):

```json
{ "type": "stat-modifier", "stat": "direct-influence", "value": 3,
  "when": { "reason": "influence-check" } },
{ "type": "stat-modifier", "stat": "direct-influence", "value": 3,
  "when": { "reason": "opponent-influence-check", "target.kind": "character" } }
```

The first entry (`reason: "influence-check"`, no target predicate) covers
*controlling* a character as a follower — that resolver context (`availableDI`
with a target `CharacterCard`) only ever describes a character, so an unqualified
`influence-check` condition means "against any character". The second covers
*influencing* an opponent's character. Neither fires for a faction: the
faction-influence roll uses `reason: "faction-influence-check"`, which matches
neither condition, so the bonus is correctly excluded against factions.

Both influence contexts also expose target and bearer stats for stat-gated
bonuses: `target.mind` (omitted for avatars, so `{ "target.mind": { "$gt": 0 } }`
is a "has a mind" gate), `target.prowess`, and `bearer.prowess` (the bearer's
**effective** prowess, items included). For a character target of an
opponent-influence attempt these are the target's effective stats; in
`availableDI` (follower control) they are the printed stats of the target
definition. Used by Whip (le-348): "Orc or Troll only: provides +2 direct
influence against one character with a mind and prowess less than the bearer's":

```json
{ "type": "stat-modifier", "stat": "direct-influence", "value": 2,
  "when": { "reason": "influence-check", "bearer.race": { "$in": ["orc", "troll"] },
            "target.mind": { "$gt": 0 },
            "target.prowess": { "$lt": "bearer.prowess" } } },
{ "type": "stat-modifier", "stat": "direct-influence", "value": 2,
  "when": { "reason": "opponent-influence-check", "target.kind": "character",
            "bearer.race": { "$in": ["orc", "troll"] },
            "target.mind": { "$gt": 0 },
            "target.prowess": { "$lt": "bearer.prowess" } } }
```

### `play-as-sauron` + Sauron's granted abilities (The Lidless Eye le-203)

`{ "type": "play-as-sauron" }` is a marker on a bare permanent-event in
`cardsInPlay` declaring its controller "is Sauron, not a Ringwraith". While it is
in play the player may not reveal a Ringwraith avatar nor play a Ringwraith
follower — both enforced in `organization-characters.ts` via the
`playerPlaysAsSauron` helper (detected by effect type, not card id). No fields.

`{ "type": "discard-named-in-play", "cardName": "<Card Name>" }` is a triggered
apply used under `on-event: self-enters-play`: when the carrying permanent-event
enters play, every in-play instance of the named card (scanning both players'
`cardsInPlay` and every character's attached `items`/`hazards`) is discarded to
its owner's pile. Pair it with `card-not-in-play` play-conditions on the named
card to also forbid replaying it (le-167 Bade to Rule bars The Lidless Eye and
Sauron).

`{ "type": "no-character-play-limit" }` is a marker on a bare permanent-event in
`cardsInPlay` lifting the one-character-play-per-turn limit for its controller
("there is no limit to the number of characters you may bring into play",
Sauron ba-43). While it is in play the `one-character-per-turn` gate in
`organization-characters.ts` is skipped (via the `playerHasNoCharacterPlayLimit`
helper in `reducer-utils.ts`, detected by effect type); all other character-play
gates (influence, sites, uniqueness, …) still apply. No fields.

`{ "type": "sauron-sideboard-fetch" }` and `{ "type": "peek-opponent-hand",
"count": 5 }` are the two `apply` payloads of the `grant-action`s that back The
Lidless Eye's once-per-organization-phase dual-mode ability
(`sauronOrgGrantActions`, gated by `OrganizationPhaseState.sauronOrgActionUsed`).
`sauron-sideboard-fetch` moves a chosen sideboard resource/character into the
play deck and shuffles; `peek-opponent-hand` discards a chosen hand card and
reveals `min(count, oppHandSize)` random opponent-hand cards (they stay in hand).
The chosen card travels on `activate-granted-action.targetCardId` for both modes.

```json
{ "type": "play-as-sauron" },
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "discard-named-in-play", "cardName": "Bade to Rule" } },
{ "type": "grant-action", "action": "sauron-sideboard-fetch", "cost": {},
  "apply": { "type": "sauron-sideboard-fetch" } },
{ "type": "grant-action", "action": "sauron-peek-hand", "cost": {},
  "apply": { "type": "peek-opponent-hand", "count": 5 } }
```

### 2z. `site-path-reduction` active constraint

A **player-scoped, turn-scoped** constraint that makes each of the player's
companies "considered to have one fewer <region type> in its site path" for the
rest of the turn. Added via `on-event: self-enters-play` → `add-constraint`
carrying `constraint: "site-path-reduction"`, `target: "player"`, `scope`, and
`regionReductions` (a region-type → count map). When a moving company's site
path is resolved (`handleRevealNewSite`, mh-steps.ts), `applySitePathReduction`
removes up to that many tokens of each region type from `resolvedSitePath` (and
the parallel name entry for region movement), so the reduced path flows to
creature keying, ahunt matching, force-return-to-origin, and end-of-company-MH
corruption region counts alike. Reductions from multiple copies stack (summed
per type); a type never drops below zero tokens. Used by Roam the Waste (ba-73):
"Each of your companies this turn is considered to have one fewer Wilderness
[{w}] and one fewer Shadow-land [{s}] in its site path."

```json
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "add-constraint", "constraint": "site-path-reduction",
             "scope": "turn", "target": "player",
             "regionReductions": { "wilderness": 1, "shadow": 1 } } }
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

An optional `scope: "bearer-combat"` makes the modifier apply to body checks
arising from the **bearer's** combat rather than to body checks against the
bearer. It is carried by an item / attached permanent-event on a participating
character and collected by `bearerCombatBodyCheckModifier` in
`combat-actions.ts`. The relevant bearer is chosen per body check:

- for a `creature` / `attacker-character` body check (a strike against the
  bearer *failed* and the striker now body-checks) the bearer is the **parrying
  defender**; and
- for a `character` body check the bearer is the **successful CvCC attacker**.

The `when` context exposes `bodyCheck.target` (`"creature" | "character" |
"attacker-character"`), `bodyCheck.fromFailedStrike` (true for the first case),
and `combat.isCvCC`.

```json
{ "type": "body-check-modifier", "value": 1, "scope": "bearer-combat",
  "when": { "bodyCheck.fromFailedStrike": true } }
```

Used by *Flame of Udûn* (ba-58): "+1 to all body checks resulting from failed
strikes against The Balrog" and, gated on `{ "bodyCheck.target": "character",
"combat.isCvCC": true }`, "+1 to defending character's body check" when The
Balrog attacks successfully in company-vs-company combat.

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

### 3a-ii. `in-play-item-modifier`

A game-wide modifier to the **corruption points** and/or **marshalling points**
of every in-play item matching an item filter, sourced from a permanent-event in
either player's `cardsInPlay`. Unlike `mp-modifier` (which rides the item being
scored and is gated on the *bearer*), this effect lives on a *separate* card and
reaches out to every matching item borne by any character of any player.

`itemFilter` is evaluated against a per-item context `{ item: { keywords, name,
cardType, subtype } }` (absent → matches every item). The `corruptionPoints` delta is
folded into each matching item's bearer corruption total (in `computeEffectiveStats`,
under the same Balrog-avatar exclusion as the item's printed corruption); the
`marshallingPoints` delta is added flat to the item's marshalling category in the
MP tally (independent of the cross-alignment / MEWH §4 clamps applied to the
item's own printed MP). Both collected once per recompute via
`collectInPlayItemModifiers` in `recompute-derived.ts`; the per-item arithmetic
itself lives in `item-corruption.ts`, so the clients can paint an item's CP badge
with the very number the recompute charges its bearer.

```json
{ "type": "in-play-item-modifier",
  "itemFilter": { "item.keywords": { "$includes": "ring" } },
  "corruptionPoints": 1,
  "marshallingPoints": 1 }
```

Used by Rumor of the One (le-224): "+1 to the corruption points and the
marshalling points for all ring items." — paired with an `on-event:
play-deck-exhausted` self-discard `move` and `duplication-limit` scope `game`.
And by Scorba at Home (td-65): "each major item gives an additional corruption
point." — `itemFilter` `{ "item.subtype": "major" }`, `corruptionPoints: 1`.
Also by Itangast at Home (td-38): "each greater item gives an additional
corruption point." — `itemFilter` `{ "item.subtype": "greater" }`,
`corruptionPoints: 1` (matching on the item's `subtype` field).

Two optional fields refine the modifier:

- **`corruptionMultiplier`** (default 1) scales each matching item's corruption
  *after* the `corruptionPoints` delta. Multipliers from several in-play sources
  compound.
- **`bearerFilter`** restricts the whole modifier to items borne by characters of
  a player matching a player-context condition `{ bearer: { alignment, minion } }`
  (`minion` is true for the Ringwraith and Balrog alignments — MEBA: the Balrog
  player is a minion player). Absent → every player's items are affected.

```json
{ "type": "in-play-item-modifier",
  "itemFilter": { "item.keywords": { "$includes": "palantir" } },
  "bearerFilter": { "bearer.minion": false },
  "corruptionMultiplier": 2 }
```

Used by Bane of the Ithil-stone (tw-13): "Corruption points for Palantíri are
doubled. … This card has no effect on a minion player."

### 3a-iii. `corruption-source-multiplier`

A game-wide effect (carried by a permanent/long event in either player's
`cardsInPlay`) that scales **one** of every character's corruption sources by
`multiplier` (default 2 — "doubled"), the controlling player choosing which
source. Since scaling a larger source would add strictly more corruption, the
engine doubles the character's **smallest** source (the only rational choice);
with N copies in play the N smallest distinct sources are scaled (the minimising
assignment, largest multiplier paired with smallest source).

A "corruption source" is a distinct corruption-bearing card the character holds:
a borne item worth corruption points (its printed value plus any
`in-play-item-modifier` delta), an attached `hazard-corruption` card, or a card
contributing corruption via a `stat-modifier` on `corruption-points` (grouped by
source card instance — e.g. The One Ring, Durin's Axe on a Dwarf). A character
with no corruption source is unaffected. The Balrog avatar (whose borne items
contribute no corruption) is excluded. Collected once per recompute via
`collectCorruptionSourceMultipliers`; the extra corruption is computed by
`corruptionSourceMultiplierDelta` in `recompute-derived.ts`.

```json
{ "type": "corruption-source-multiplier", "multiplier": 2 }
```

Used by The Balance of Things (tw-93): "Each character has the corruption points
doubled for one of his sources of corruption (the player controlling the
character chooses)." — "Unique" is deck-level, so no in-play `duplication-limit`.

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
per player from the player's in-play characters, `cardsInPlay`, **and the cards
attached to those characters** — a stage permanent-event played "on the avatar"
lives in the avatar's `items` rather than in `cardsInPlay` (Oromë's Warders
wh-94) — then consumed in `recompute-derived.ts` (`addItemMP`'s
`fwItemMpExempt` path).

The optional `inAvatarCompany: true` restricts the exemption to items borne by
characters in the same company as the player's revealed avatar ("your … items in
Alatar's company"); omit it for a player-wide exemption.

Used by Saruman (wh-9): "Your non-weapon/non-armor/non-shield/non-helmet items
are each worth full marshalling points." (player-wide). Join the Hunt (wh-93)
uses the company-restricted form for its weapon/armor/shield/helmet items, and
Oromë's Warders (wh-94) the player-wide form for the same filter.

```json
{ "type": "fw-item-mp-full",
  "filter": { "$not": { "$or": [
    { "keywords": { "$includes": "weapon" } },
    { "keywords": { "$includes": "armor" } },
    { "keywords": { "$includes": "shield" } },
    { "keywords": { "$includes": "helmet" } } ] } } }
```

### 3b-i. `fw-mp-none`

The mirror of `fw-item-mp-full`: a card carrying this marker gives its
controller **no** marshalling points at all while that controller is a
Fallen-wizard, and no other card can restore them. `deniesFallenWizardMp`
(`recompute-derived.ts`) is consulted **before** every other MP rule — the
Await-the-Onset pin, `noncharacter-mp-override`, the MEWH §4 clamp and its
`fw-item-mp-full` exemptions, and the global `in-play-item-modifier` MP delta —
so the denial is absolute. Players of any other alignment score the card
normally. The effect takes no fields.

Used by the minion Palantír of Elostirion (le-332) and the Palantír of Orthanc
pair (tw-300 / le-334): "This item does not give MPs to a Fallen-wizard
regardless of other cards in play."

```json
{ "type": "fw-mp-none" }
```

### 3b-ii. `fw-ally-mp-full`

Fallen-wizard **ally** marshalling-point exemption (MEWH §4 exception). Like
`fw-item-mp-full` but for allies: each ally matching `filter` scores its **full
printed** MP instead of the §4 flat-1 clamp (distinct from `fw-character-ally-mp`,
which pins a fixed value). The optional `inAvatarCompany: true` restricts the
exemption to allies borne by characters in the player's avatar company. Collected
per player from in-play characters, `cardsInPlay`, and the cards attached to
those characters, then consumed in `recompute-derived.ts` (`addMP`'s `fwFullMp`
path); full-MP takes precedence over any `fw-character-ally-mp` cap and never
applies to stage cards or non-Fallen-wizards.

Used by Join the Hunt (wh-93): "Your allies with a prowess attribute in Alatar's
company are each worth full marshalling points." Oromë's Warders (wh-94) reuses
the same effect player-wide (no `inAvatarCompany`): "Your allies with a prowess
attribute are each worth full marshalling points."

```json
{ "type": "fw-ally-mp-full",
  "filter": { "prowess": { "$exists": true } },
  "inAvatarCompany": true }
```

### 3b-ii-b. `fw-char-mp-full`

Fallen-wizard **character** marshalling-point exemption (MEWH §4 exception). Like
`fw-ally-mp-full` but for characters: each character matching `filter` scores its
**full printed** character MP instead of the §4 flat-1 clamp. Omit `filter` to
exempt every character the FW controls. The optional `inAvatarCompany: true`
restricts the exemption to characters in the player's avatar company. Collected
per player from in-play characters and `cardsInPlay` and consumed in
`recompute-derived.ts` (`addMP`'s `fwFullMp` path, at the character-scoring loop);
full-MP takes precedence over any `fw-character-ally-mp` cap and never applies to
stage cards or non-Fallen-wizards.

Used by the Fallen-wizard Gandalf (wh-4): "Your characters … are each worth full
marshalling points." — carried player-wide (no `filter`), paired with a
player-wide `fw-ally-mp-full` filtered to `hero-resource-ally` for the "and hero
allies" half of the same clause.

```json
{ "type": "fw-char-mp-full" }
```

### 3b-iii. `ally-movement-restriction-exemption`

Exempts matching allies the source's controller has in play from their printed
"Discard if he/she moves to …" movement restriction. CRF 22 defines an ally's
"movement restriction" as exactly its `bearer-company-moves` self-discard clause
(see `bearer-company-moves`), so this effect makes those clauses not fire for the
matching allies. Collected during the end-of-movement discard sweep
(`mh-hazard-play.ts` step 8a-2) from the moving player's in-play characters and
`cardsInPlay`; when a matching ally would be discarded by a `bearer-company-moves`
self-discard, the discard is skipped and the ally is kept. `filter` matches the
ally's card definition (omit to exempt every ally the controller has in play).

Used by Radagast (wh-8): "Hero allies Radagast controls have no movement
restrictions." — `filter` `{ "cardType": "hero-resource-ally" }`.

```json
{ "type": "ally-movement-restriction-exemption",
  "filter": { "cardType": "hero-resource-ally" } }
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

### 3c-2. `nonhaven-company-mp-pin`

Pins every MP-scoring card **held by a company that is not at one of the
controller's Wizardhavens** to a flat `value` marshalling points, overriding all
other MP computation for those cards ("regardless of other cards in play").
Applies to characters and the items / allies they bear; factions and other
`cardsInPlay` entries are unaffected because they are not "in a company" (a
Fallen-wizard never stores factions at a site). A company counts as at a
Wizardhaven via `isHavenForPlayer` for the controller's alignment (his own
Wizardhaven sites plus any Hidden-Haven conversion); every other site — and a
company with no current site — is treated as outside. Collected per player from
in-play cards (`nonHavenCompanyMpPin`) and applied in the company-scoring loop of
`recompute-derived.ts` (`addPinnedCardMp`), taking precedence over the §4 clamp,
`fw-character-ally-mp`, the `*-mp-full` exemptions, and `noncharacter-mp-override`.

The card's *"when the game ends"* qualifier is modelled as a continuous override
of the running MP total (the engine keeps no separate end-of-game scoring pass).
For a Fallen-wizard this is normally a no-op — the §4 clamp already values each
company-held card at 1 — so the pin only changes a total when another card in
play would otherwise value the card above `value`.

Used by Await the Onset (wh-96): "Each of your marshalling point cards in a
company not in one of your Wizardhavens [{H}] when the game ends is worth 1
marshalling point regardless of other cards in play."

```json
{ "type": "nonhaven-company-mp-pin", "value": 1 }
```

### 3c-2b. `character-mp-override` (and its `noncharacter-mp-override` sibling)

Re-values the controller's cards that match a per-card `when` condition,
overriding their printed marshalling points and every other MP rule in play (the
MEWH §4 flat-1 clamp, a Great Patron wh-72 cap, a wh-4 full-MP exemption, an
Await the Onset wh-96 pin). Two effects share one shape:

- `character-mp-override` — matched against the player's **characters**.
- `noncharacter-mp-override` — matched against his **non-character** MP cards
  (items, allies, factions, misc permanent-events). Used by Give Welcome to the
  Unexpected (wh-99): "your unique non-character cards normally worth 1
  marshalling point are each worth 2 marshalling points."

Both are evaluated against the per-card context
`{ card: { unique, normalMp, cardType, name, race } }`, where `normalMp` is the
card's *printed* MP; the last matching rule wins, and a card with no printed MP
is never overridden. Rules are collected (`mpOverrideRules` in
`recompute-derived.ts`) from three places: the player's `cardsInPlay`, the items
on his characters (a stage permanent-event placed "on the avatar" lives there),
and the **hazards attached to his characters** — which is how an opponent's
hazard re-values the cards of the player it was played on.

Used by Fool's Bane (wh-19): "his Elf characters and Elf factions are each worth
0 marshalling points in all cases" — one effect of each kind, the non-character
one narrowed to faction card types so Elf-named allies/items are untouched.

```json
{ "type": "character-mp-override", "when": { "card.race": "elf" }, "value": 0 }
{ "type": "noncharacter-mp-override",
  "when": { "card.race": "elf",
            "card.cardType": { "$in": ["hero-resource-faction", "minion-resource-faction"] } },
  "value": 0 }
```

### 3c-3. `played-after-faction-mp-pin`

Pins every faction the controller plays **after** this card comes into play to a
flat `value` marshalling points, overriding its printed value, the §4 clamp, and
every faction-MP modifier ("regardless of other cards in play"). The pin is stamped
on the faction instance (`CardInPlay.mpPinned`) when it is influenced into play
(`reducer-site.ts`, via `playedAfterFactionMpPin`), so factions played *before* the
carrier keep their normal value — the "place these factions under Await the Onset"
bookkeeping. A stamped faction is scored at its pinned value at the top of the
`cardsInPlay` loop in `recompute-derived.ts` (`addPinnedCardMp`), ahead of
`noncharacter-mp-override` / `faction-mp-override` / the §4 clamp. A Fallen-wizard
never stores factions at a site, so no location is tracked — the per-instance tag
alone records which factions the clause covers.

Used by Await the Onset (wh-96): "Each faction you play after Await the Onset is
worth 1 marshalling point regardless of other cards in play (place these factions
under Await the Onset)."

```json
{ "type": "played-after-faction-mp-pin", "value": 1 }
```

### 3c-4. `faction-mp-bonus`

Grants an **additional** marshalling point to a whole class of the controller's
in-play factions while a race-diversity **gate** holds. `requireEachRace` is the
gate: the controller must have at least one (non-set-aside) in-play faction of
*each* listed race for the bonus to apply at all (omit/empty = no gate). `races`
lists which controlled factions receive `bonus` MP — a faction gains the bonus
iff its race is in this list. The two lists are independent, so a card may gate
on one set of races while boosting another. Collected by `factionMpBonusEntries`
and applied as a dedicated additive faction-MP pass in `recompute-derived.ts`
(after the leader-control group bonus), scanning only the controller's own
`cardsInPlay` factions — a *separate* pass so the bonus still lands on factions
whose base MP was resolved by an override branch that `continue`d. "Man" is the
literal faction race, so a Dúnadan faction is neither counted toward the gate nor
boosted.

Used by Alliance of Free Peoples (as-45): "If at least one hero Dwarf faction,
one hero Elf faction, and one hero Man faction is in play, all hero Dwarf
factions, hero Elf factions, and hero Man factions give an additional marshalling
point."

```json
{ "type": "faction-mp-bonus", "bonus": 1,
  "requireEachRace": ["dwarf", "elf", "man"],
  "races": ["dwarf", "elf", "man"] }
```

### 3c-5. `discard-on-card-leaves-play`

Discards the **carrying** in-play card the moment another card matching `filter`
leaves its controller's play area (present in the controller's `cardsInPlay`
before an action, absent after). Evaluated as a `postReduce` prev/next diff
(`engine/discard-on-card-leaves.ts::applyDiscardOnCardLeaves`, wired into
`reducer.ts` beside `applyEvilHourTaps`), the same reactive-diff pattern as A More
Evil Hour — so it fires no matter *how* the tracked card left play, and even when
a companion `faction-mp-bonus` gate would still hold afterwards. `filter` is
matched against the leaving card's definition wrapped as `{ card: def }` (so
`card.cardType`, `card.race`, `card.name`, … are available). Distinct from
`discard-self-when` (a single-state player-state condition, Prophet of Doom
wh-106) — this one needs the pre-action state to see which card *left*.

Used by Alliance of Free Peoples (as-45): "Discard when any hero Dwarf faction,
hero Elf faction, or hero Man faction is discarded from play."

```json
{ "type": "discard-on-card-leaves-play",
  "filter": { "$and": [ { "card.cardType": "hero-resource-faction" },
                        { "card.race": { "$in": ["dwarf", "elf", "man"] } } ] } }
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

### 3e-bis. `auto-attacks-normal`

A **global**, site-type-scoped variant of `detainment-attacks-normal`: while a long
hazard-event carrying this effect is in play (either player's `cardsInPlay`), every
automatic-attack at a site whose effective `SiteType` is in `siteTypes` resolves as
a **normal** attack rather than a detainment attack — regardless of which company is
defending. Unlike `detainment-attacks-normal` (carried by a *defending* character,
scoped to that player's companies at any site), this keys on the *site type* of the
attack, so it applies to whichever company enters a matching site. Computed via
`siteTypeForcesAutoAttacksNormal` (`reducer-utils.ts`) and OR-ed with the per-player
conversion into `isDetainmentAttack`'s `defenderForcesNormalAttacks` at every site
automatic-attack call site.

Pair it with a `stat-modifier` on `strikes` (`target: "all-automatic-attacks"`,
gated by `when: { "site.siteType": { "$in": [...] } }`) to model the full "Awaken"
family of hazards — the attack-resolution context now exposes `site.siteType` (the
defending company's effective current-site type) for automatic-attacks.

Used by Awaken Defenders (le-103): "The number of strikes for each automatic-attack
at a Free-hold or Border-hold is doubled. Additionally, each detainment
automatic-attack at a Free-hold or Border-hold becomes a normal automatic-attack."

```json
{ "type": "auto-attacks-normal", "siteTypes": ["free-hold", "border-hold"] }
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

Stage points are also summed from cards **attached to a character** — both the
`items` slot (a stage permanent-event played "on a character", e.g. Wizard's
Myrmidon wh-84) and the `hazards` slot, so an opponent's hazard can force stage
points onto the Fallen-wizard it rides. For those the effect may carry a `when`
condition, evaluated against the bearer context `{ bearer: { race, skills, name,
keywords, … } }`, expressing "he receives these points only if …". A card in a
bare in-play zone has no bearer, so a conditional effect never contributes from
there. Used by Inner Rot (wh-23): "If he is a Fallen-wizard, he receives 2 stage
points."

```json
{ "type": "stage-points", "value": 2, "when": { "bearer.race": "fallen-wizard" } }
```

The player's running total is computed **before** the per-character
effective-stats pass in `recompute-derived.ts` and exposed to it as
`bearer.stagePoints`, so a card can tier its own stat modifiers on the total it
has already contributed to (Inner Rot's corruption tiers).

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
cards, **in-play characters**, and the cards attached to those characters (a
stage permanent-event placed on the avatar — Oromë's Warders wh-94: "Your Elf
factions are each worth 2 marshalling points", a single rule
`{ "faction.race": "elf" } → 2`), and consumed in `recompute-derived.ts`.

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
  "when": { "reason": "combat", "enemy.race": "ringwraith" } }
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

The combat context also exposes `combat.strikeMode` (`"tap"` / `"untap"` /
`"dodge"` / `"reroll"`) during the creature body check, recorded on the strike
assignment when it resolves. A `body` `enemy-modifier` can therefore gate on the
bearer **tapping to face the strike** — the reduction then applies only to the
body check that follows a strike the bearer taps to face, not a stay-untapped
one. Used by Mechanical Bow (wh-53): "-1 to the body of any strike its bearer
faces if he taps to face the strike."

```json
{ "type": "enemy-modifier", "stat": "body", "op": "subtract", "value": 1,
  "when": { "$and": [
    { "bearer.skills": { "$includes": "warrior" } },
    { "combat.strikeMode": "tap" } ] } }
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

The context also carries the full bearer block, including `bearer.race` and
`bearer.stagePoints` (the controller's Fallen-wizard stage-point total), so a card attached
to a character can gate its modifier on who carries it and how far along he is. `value` may
be negative, and independent modifiers on the same card simply sum — Cruel Claw Perceived
(wh-16) reduces the Fallen-wizard's hand size "by 1 if his SPs exceed 10, and by 1 more if
his SPs exceed 20" with two `-1` effects whose bands overlap above 20:

```json
{ "type": "hand-size-modifier", "value": -1,
  "when": { "$and": [{ "bearer.race": "fallen-wizard" },
                     { "bearer.stagePoints": { "$gt": 10 } }] } }
```

The effect may also sit on an **item** rather than on the character, so an item
can raise its holder's hand size only while a qualifying character bears it —
e.g. Palantír of Elostirion (le-332), "If the bearer is a sage: your hand size
increases by one":

```json
{ "type": "hand-size-modifier", "value": 1,
  "when": { "bearer.skills": { "$includes": "sage" } } }
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
- `requiresCardInPlay` *(optional)* — name of a card that must remain in play
  (for the character's owner) for the bonus to apply. Re-checked by the resolver
  on every stat computation via the attachment-aware `isCardNameInPlayForPlayer`,
  so the bonus lapses the instant the named card leaves play. Omit for an
  unconditional bonus (Vilya style).

Emitted via `on-event: self-enters-play` → `add-constraint` with
`constraint: "character-stat-modifier"` when the card is played on its
target character. The target is read from `action.targetCharacterId`.
Swept at turn-end by the existing `scope: { kind: 'turn' }` sweep.

Used by: *Vilya* (+4 prowess / +2 body / +6 direct-influence on Elrond);
*Heart of Dark Fire* (ba-63) — +5 direct influence on The Balrog this turn,
gated `requiresCardInPlay: "Strangling Coils"`.

```json
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "add-constraint", "constraint": "character-stat-modifier",
             "stat": "prowess", "value": 4, "scope": "turn" } }
```

```json
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "add-constraint", "constraint": "character-stat-modifier",
             "stat": "direct-influence", "value": 5, "scope": "turn",
             "requiresCardInPlay": "Strangling Coils" } }
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

`appliesTo` (default `own-companies`) opts a modifier out of that scoping:
with `any-company` the modifier is also collected from the **opponent's**
`cardsInPlay`, for cards worded "each moving company …" where the hazard
player holds the card but the moving player's draws shrink — Smaug at Home
(td-71).

`min` floors a *reduction*; it never grants a draw. A negative net
adjustment is additionally clamped to the unmodified count, so "to a
minimum of one" cannot raise a company's 0 resource draws (no character
with mind ≥ 3, CoE 2.IV.v) to one.

```json
{ "type": "draw-modifier", "draw": "hazard", "value": -1, "min": 0 }
{ "type": "draw-modifier", "draw": "resource",
  "value": "sitePath.wildernessCount", "min": 0 }
{ "type": "draw-modifier", "draw": "resource", "value": -1, "min": 1,
  "appliesTo": "any-company" }
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

`draw-cards` doubles as a `grant-action` **apply** verb, where it draws
`count` cards for the activating player (there is no spent event card, so
`removeFromGame` is ignored). Used by Palantír of Elostirion (le-332):
"tap Palantír of Elostirion to draw a card. Bearer then makes a
corruption check."

```json
{ "type": "sequence", "apps": [
  { "type": "draw-cards", "count": 1 },
  { "type": "enqueue-corruption-check" } ] }
```

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

An optional `altShortEventMode: true` flags the reshuffle as the **alternative
short-event mode of an otherwise `eventType: "permanent"` resource card** — a
"Permanent-event/Short-event" card. Such a card is offered *both* as a
permanent-event (its ongoing effects enter play via
`playPermanentEventActions`) *and*, via this effect, as a resource short-event
in the organization phase (`playResourceShortEventActions`) and every phase a
resource short-event may be played (`heroResourceShortEventActions`). The
short-event mode is viable only when the reshuffle would actually recycle a
card (a matching card sits in the playing player's discard —
`playerHasReshuffleMatch`); playing it resolves the reshuffle and discards the
card. The `altShortEventReshuffleEffect` helper (`reducer-utils.ts`) recognises
the pairing. Used by Great Army of the North (ba-38): "Alternatively, as a
short-event, you may choose any Orc and Troll factions from your discard pile
and shuffle them into your play deck." (`scope: "self"`, filter minion
Orc/Troll factions).

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

**Gating a grant-action to one phase via `when`.** `anyPhase: true` makes an
ability *available* in every non-organization phase, but sometimes a card is
restricted to a single one (e.g. "Once during his movement/hazard phase …").
The grant-action `when` context exposes the current `phase`
(`buildGrantActionContext`), so combine `anyPhase: true` (so the M/H scanner
offers it at all) with `when: { "phase": "movement-hazard" }` (so it is
suppressed everywhere else, including the organization phase's default scan).

**`oncePerTurn: true` — a per-turn usage lock.** When set, the ability may be
activated at most once per turn by that source card. On the first activation
the grant-action reducer records a turn-scoped `granted-action-used` constraint
keyed by the source instance and `action`; the scanner
(`grantedActionActivations`) then suppresses the ability for the rest of the
turn (the constraint clears at turn-end). Independent of the phase-window
flags. Used by *Strangling Coils* (ba-76).

```json
{ "type": "grant-action", "action": "untap-balrog-company",
  "anyPhase": true, "oncePerTurn": true, "cost": {},
  "when": { "phase": "movement-hazard" },
  "apply": { "type": "sequence", "apps": [
    { "type": "set-character-status", "target": "company", "status": "untapped" },
    { "type": "set-character-status", "target": "bearer", "status": "tapped" } ] } }
```

The `set-character-status` apply now accepts `target: "company"`, setting the
status on every character in the bearer's company (untapping is idempotent for
already-untapped members). Sequenced with a `target: "bearer"` tap, this
realizes ba-76's "untap all tapped characters in The Balrog's company; if then
untapped, tap The Balrog" (the empty `cost` lets it fire even when the Balrog is
already tapped).

**Two exclusive modes sharing one action name.** A card granting a choice —
"During your organization phase, you may: A **or** B" — declares **two**
`grant-action` effects with the **same** `action` string, each `oncePerTurn:
true`. Because the `granted-action-used` lock is keyed by (source instance,
action id), activating either mode suppresses both for the rest of the turn —
a single choice per turn, as printed. The dispatcher discriminates the modes
by target presence: an activation carrying a `targetCardId` selects the mode
that declares a `targets` descriptor; one without selects the target-less
mode. Used by *Keys to the White Towers* (wh-89): mode A is an
`enqueue-pending-fetch` (take the named card from play deck **or** discard
pile to hand — the deck reshuffles only when it was the searched source), mode
B targets `scope: "opponent-cards-in-play"` with a name filter and applies
`discard-target-in-play` (below).

**`targets.scope: "opponent-cards-in-play"`.** Enumerates the opponent's
`cardsInPlay` (permanent events, factions, …) matching `targets.filter`, one
activation per candidate carried on `targetCardId`. Not offered when nothing
matches.

**`discard-target-in-play` apply.** Discards the activation's `targetCardId`
from whichever player's `cardsInPlay` holds it and clears every active
constraint that instance sourced (an opponent's *Fortress of the Towers*
wh-69 takes its `site-protected` constraint with it). Implemented in
`grant-action-apply.ts` via the shared `discardCardsInPlayWhere` sweep.

```json
{ "type": "grant-action", "action": "fetch-or-discard-named",
  "cost": {}, "oncePerTurn": true,
  "apply": { "type": "enqueue-pending-fetch",
    "fetchFrom": ["deck", "discard-pile"], "fetchCount": 1,
    "fetchShuffle": true, "fetchTo": "hand",
    "filter": { "name": "Fortress of the Towers" } } }
{ "type": "grant-action", "action": "fetch-or-discard-named",
  "cost": {}, "oncePerTurn": true,
  "targets": { "scope": "opponent-cards-in-play",
    "filter": { "name": "Fortress of the Towers" } },
  "apply": { "type": "discard-target-in-play" } }
```

### `roll-then-apply` as a short-event self-enters-play apply (roll to untap your tapped Ringwraith)

A resource short event may "make a roll" on play and conditionally change a
target character's status. Attach `roll-then-apply` (2d6; `onSuccess` fires when
the total ≥ `threshold`, else `onFailure`) as an `on-event: self-enters-play`
apply, with a `set-character-status` (`target: "target-character"`) branch. Pair
it with a `play-target` whose `filter` selects the qualifying character — e.g.
`target.isRevealedAvatar` + `target.status: "tapped"` for "your tapped
Ringwraith". The emitter (`playResourceShortEventActions`) offers one play action
per eligible target (carried as `targetCharacterId`); `resolveShortEventRollUntap`
(`reducer-events.ts`) rolls 2d6, emits the dice-roll effect, applies the matching
branch to the target, and discards the event.

```json
{ "type": "play-target", "target": "character",
  "filter": { "$and": [ { "target.isRevealedAvatar": true },
                        { "target.status": "tapped" } ] } }
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "roll-then-apply", "threshold": 7,
    "onSuccess": { "type": "set-character-status",
                   "status": "untapped", "target": "target-character" } } }
```

Used by The Ring Leaves Its Mark (le-223): "playable on your tapped Ringwraith.
Make a roll—if the result is greater than 6, untap your Ringwraith" (threshold 7
= "greater than 6"). le-223 combines this with a `move` fetch-to-deck as its
alternative mode; the two modes are discriminated at the reducer by the presence
of a `targetCharacterId` on the play action.

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

- `modify-company-corruption-checks` — a **company-wide, turn-scoped**
  corruption-check modifier chosen during the organization phase. Declared on a
  character with a `targets: { "scope": "player-companies" }` descriptor so the
  scanner emits one activation per company the controller owns (each carrying
  the chosen company on `targetCompanyId`, "any one of your companies"). The
  `apply` is an `add-constraint` of a `check-modifier` (`check: "corruption"`,
  `target: "action-target-company"`, `scope: "turn"`). Unlike the one-shot
  `modify-corruption-check`, this constraint is **not consumed** — both
  corruption-check resolvers collect a company-scoped corruption `check-modifier`
  for every check by a **minion character** (`cardType === "minion-character"`)
  whose company matches the constraint's `companyId`, and it persists for the
  whole turn (`corruptionCheckActions` in `legal-actions/pending.ts` for the
  unified pending window; `resolveCorruptionCheck` in `reducer-free-council.ts`
  for the end-of-turn window). Gate the ability's availability with a `when`
  clause on the grant-action context (`bearer.isRevealedAvatar` for "as your
  Ringwraith", `bearer.atDarkhaven` for "if at a Darkhaven"). Used by *Ren the
  Ringwraith* (le-56): "As your Ringwraith, if at a Darkhaven, he may tap during
  your organization phase to modify all corruption checks made this turn by
  minions in any one of your companies by +2."

  ```json
  { "type": "grant-action", "action": "modify-company-corruption-checks",
    "cost": { "tap": "bearer" },
    "when": { "bearer.isRevealedAvatar": true, "bearer.atDarkhaven": true },
    "targets": { "scope": "player-companies" },
    "apply": { "type": "add-constraint", "constraint": "check-modifier",
      "check": "corruption", "value": 2, "scope": "turn",
      "target": "action-target-company" } }
  ```

  The grant-action context field `bearer.atDarkhaven` is `true` only when the
  bearer's company is at a **minion-aligned Haven** — a `haven` site whose
  `alignment` is `ringwraith` or `balrog` (Minas Morgul / Dol Guldur / Carn Dûm
  / Geann a-Lisch; Moria / The Under-gates). It is deliberately stricter than
  `bearer.atHaven` (any `haven` site): a Ringwraith standing on a METW hero
  Haven (Rivendell etc.) reached via a mode card is at a Haven but **not** at a
  Darkhaven. Implemented in `buildGrantActionContext`
  (`legal-actions/organization.ts`).

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
- `untap-phase-end` -- fires once per applicable card during the Untap → Organization transition. The reducer (`reducer-untap.ts`) scans every character of the active player for attached cards (items / hazards / allies) carrying this on-event. An optional `when` condition is evaluated against the bearer context `{ bearer: { siteType, atHaven } }`. `atHaven` follows the bearer's controller's {H} semantics (`isHavenForPlayer`): any haven-class site for hero/minion players (Haven/Darkhaven), but for a Fallen-wizard player his Wizardhavens — an FW-alignment haven site or a `wizardhaven-conversion` site. Supported apply types:
  - `force-check` (with `check: "corruption"`) — enqueues a `corruption-check` pending resolution per match. Used by *Lure of the Senses* (at-haven only, `"bearer.atHaven": true`), *Longing for the West* wh-25 (away from Haven/Wizardhaven only, `"bearer.atHaven": false`) and *The Least of Gold Rings* (any site).
  - a self-discard `move` (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`) — removes the card from the bearer's items/hazards/allies and places it in the owner's discard pile. The optional `when` condition gates the discard (e.g. `"when": { "bearer.atHaven": true }` to discard at Darkhavens). Used by *Well-preserved* (as-108).
- `stage-card-played` -- fires every time a player brings a **stage card** (any definition with `alignment: "stage"` — the Fallen-wizard progress track, MEWH §1) into play. `fireStageCardPlayedTriggers` (`stage-card-played.ts`) scans that player's own characters for attached items/hazards carrying this on-event; an optional `when` is evaluated against the bearer context `{ bearer: { race, skills, name, keywords, … } }`. The only supported apply is `force-check` with `check: "corruption"` (optional `modifier`), which enqueues a phase-scoped `corruption-check` on the bearer, made by the bearer's *controlling* player even when the card is an opponent's hazard. Fired from every seam a stage card can enter play through: the permanent-event chain resolution (`chain-reducer.ts`, covering the 56 stage permanent-events) and the site-phase item/ally attach and successful faction-influence paths (`reducer-site.ts`, covering wh-88/89/114 and wh-86/87). "Plays a stage card" is read as "a stage card of his enters play", so a faction whose influence attempt fails never triggers it. Used by *Inner Rot* (wh-23): "The target makes a corruption check whenever his controlling player plays a stage card."
- `play-deck-exhausted` -- fires when **any** player completes a play-deck exhaustion (`completeDeckExhaust`, `reducer-utils.ts`): the discard pile is shuffled into a new play deck and the exhaustion count ticks up. The only supported apply is a self-discard `move` (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`); no `when` is evaluated. Both players' `cardsInPlay` are scanned (Safe from the Shadow as-54, Tokens to Show as-101, Bane of the Ithil-stone tw-13), **and** every character's attached `items` / `hazards` (`discardAttachmentsOnDeckExhaust`), so a card played on a character leaves play too — Cruel Claw Perceived (wh-16): "Discard when any play deck is exhausted." Each discarded attachment routes to its own owner's pile: an item to the character's controller, a hazard to the opponent.

  ```json
  { "type": "on-event", "event": "play-deck-exhausted",
    "apply": { "type": "move", "select": "self", "from": "self-location", "to": "discard" } }
  ```

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

- `bearer-wounded` -- fires after combat finalization for each character that was wounded (result `'wounded'`, not tapped under detainment rules; detainment strikes tap, not wound). Scans every wounded character's attached **allies AND items/permanent-events** for this event. Supports a self-discard `move` apply (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`), which removes the card from the bearer and places it in the defending player's discard pile. Implemented in `combat-finalize.ts` combat finalization. Used by *Regiment of Black Crows* (as-76) and *Great Bats* (as-74) — attached allies; and *Await the Advent of Allies* (dm-117) — an attached permanent-event stored in the host character's `items` ("Discard this card when the character … becomes wounded"). A character *eliminated* (not merely wounded) never reaches this scan; its attached cards are already discarded by the elimination / leaves-play path (`eliminateCombatantFromStrike` / `discardCharacter`), so the same self-discard covers "when the character leaves play" for free.

- `resource-taps-or-requires-site` -- fires when a resource play in the site phase **taps** the current site of the company that played it. `fireResourceTapsSiteDiscards` (`reducer-site.ts`) runs on both site-tapping resource paths — the item/ally attach path and the faction-influence path — gated on the site actually tapping (skipped for never-taps sites, Thorough Search, a leader taking a faction under control, etc.). It scans every character in the playing company for an attached card carrying this event with a self-discard `move` apply, and moves each to its owner's discard pile. Models "Discard this card when you play a resource that taps or requires the site (as an active condition of playing the resource itself)". Used by *Await the Advent of Allies* (dm-117).

  ```json
  { "type": "on-event", "event": "resource-taps-or-requires-site",
    "apply": { "type": "move", "select": "self", "from": "self-location", "to": "discard" } }
  ```

  ```json
  { "type": "on-event", "event": "bearer-wounded",
    "apply": { "type": "move", "select": "self", "from": "self-location", "to": "discard" } }
  ```

- `company-member-wounded` -- fires after combat finalization when any character in the defending company was wounded (result `'wounded'`, not tapped under detainment rules). Scans every character in the defending company for attached hazard events carrying this on-event; for each match, enqueues one `corruption-check` pending resolution on the **bearer** (the character bearing the hazard, not the wounded character). Supports `apply: { type: "force-check", check: "corruption" }`. Used by *Despair of the Heart* (tw-27). Implemented in `reducer-combat.ts` combat finalization.
- `character-gains-item` -- fires immediately after any character in the bearer's company gains an item during the site phase (via `play-hero-resource`). For each character bearing a hazard with this event, enqueues one `corruption-check` pending resolution for that character (the bearer, not the character who gained the item). Supports `apply: { type: "force-check", check: "corruption" }`. Used by *Lure of Expedience* (le-122). Implemented in `reducer-site.ts` `fireCharacterGainsItemChecks()`.
- `successful-influence-attempt` -- fires when a **character** completes a successful influence attempt, from both influence-success seams: a faction influence roll (`resolveInfluenceAttemptRoll`) and an opponent-influence resolution (`resolveOpponentInfluenceDefend`) — matching "e.g., against a faction, an opponent's character, etc.". Carried by a **bare in-play event** in either player's `cardsInPlay` (the hazard resolves bare, it is not attached to anyone) and scanned by `fireSuccessfulInfluenceTriggers` in `reducer-site.ts`. The optional `when` is evaluated against `{ target: { race, name } }` built from the influencing character; an ally influencing factions "as if he were a character" (Radagast's Black Bird wh-114) never fires it. Supports an `apply` of `enqueue-corruption-check` (a Site-phase pending corruption check on the influencer — "immediately", since pending resolutions gate all further actions) or a `sequence` combining it with a self-discard `move` ("discard this card after this corruption check"). Duplicate in-play copies of the same definition fire only ONE corruption check but are ALL discarded (official clarification for Lure of Power). Used by *Lure of Power* (tw-59): "The next non-Hobbit character to make a successful influence attempt … must immediately make a corruption check modified by -4."

  ```json
  { "type": "on-event", "event": "successful-influence-attempt",
    "when": { "target.race": { "$ne": "hobbit" } },
    "apply": { "type": "sequence", "apps": [
      { "type": "enqueue-corruption-check", "modifier": -4 },
      { "type": "move", "select": "self", "from": "self-location", "to": "discard" }
    ] } }
  ```

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
- `add-constraint` -- add an {@link ActiveConstraint} of the named kind to the target. Reserves the entry's `constraint` field for the kind name (e.g. `"site-phase-do-nothing"`, `"no-creature-hazards-on-company"`, `"deny-scout-resources"`, `"auto-attack-prowess-boost"`, `"auto-attack-duplicate"`, `"site-type-override"`, `"region-type-override"`, `"skip-automatic-attacks"`, `"cancel-character-discard"`, `"hazard-draw-multiplier"`, `"haven-return-option"`) and the `scope` field for the auto-clear boundary (e.g. `"company-site-phase"`, `"company-mh-phase"`, `"turn"`, `"until-cleared"`). Constraint-kind-specific fields include `value` + `siteType` for `auto-attack-prowess-boost` (when added from a **resource short-event's** `on-event: self-enters-play` — Come By Night Upon Them le-176 — it resolves the active site-phase company itself, bakes a `doublesWithDoorsOfNight` doubling at play time, and is stored as a **persistent** `auto-attack.prowess` `attribute-modifier` that weakens *every* automatic-attack the company faces at the site, not just the first), `overrideType` for `site-type-override` (the site is the active company's current site during site phase, or the destination during M/H phase; an optional `purpose: "healing"` makes the override **healing-only** — `getEffectiveSiteType` ignores it so hazard keying / movement / bring-into-play / playability keep the printed type, while the untap-phase healing sweep still treats the site as a Haven, as used by *Houses of Healing* td-125; an optional `allVersions: true` scopes the override by the site's printed **name** instead of its definition id, so every printing of the location — hero / minion / Fallen-wizard / Balrog, distinct definitions sharing one name — is retyped, as used by *Nature's Revenge* wh-27 "All versions of the site become Ruins & Lairs"), and `overrideType` + `regionName` for `region-type-override` (use the token `"destination"` as the region name to target the destination region of the active company). The `skip-automatic-attacks` constraint removes all automatic attacks from the bound site (resolved from the active company's current site during site phase). The `replace-automatic-attacks` constraint (scope `"until-cleared"`, added by *Vile Fumes*' `transform-site` action — see above) carries a `siteDefinitionId` and an `attack`; `manifestations.ts` `getActiveAutoAttacks` returns that single attack in place of all printed/augmented attacks for every version of the site. The attack may set `uncancelable` (mapped to the `cannot-be-canceled` combat rule, suppressing cancel-attack) and `eachCharacter` (each character in the company faces one strike). When added via a grant-action `add-constraint` apply (rather than the permanent-event on-event path), both `skip-automatic-attacks` and `influence-at-site-modifier` resolve their `siteDefinitionId` from the *bearer's company's* current site; `influence-at-site-modifier` reads its `+value` from the apply clause and adds that bonus to every faction-influence attempt against a faction at that site for its scope (`turn`). Both are used by *Blasting Fire* (wh-51): its discard ability is a `sequence` of these two `add-constraint` applies. The `company-cannot-move` constraint (scope `"turn"`, target a company) locks that company stationary for the rest of the turn: the org-phase `plan-movement` emitter (`planMovementActions`) skips it and the reducer (`handlePlanMovement`) rejects any movement declaration for it. Used by *Hide in Dark Places* (le-192), which adds it alongside `no-creature-hazards-on-company` (two `on-event: self-enters-play` → `add-constraint` effects) so the protected company cannot carry its hazard-creature immunity onto a moving company. The `no-creatures-keyed-to-site` constraint (scope `"turn"`, target a company) is the inverse of `only-creatures-keyed-to-site`: hazard-creature plays keyed *to the target company's new site* (the play action's `keyedBy.method` is `site-type`, `site-name`, `site-keyword`, or `adjacent-to-site-keyword`) are dropped, while region-keyed plays of the same creature survive as their own actions. An optional `unlessSiteRegionType` field (e.g. `"free"`) voids the restriction entirely when the destination site's containing region has that type, resolved via `siteRegionTypeOf`. Used by *Crack in the Wall* (le-177): "Unless the site is in a Free-domain [{f}], no hazard creatures may be played at the company's new site." The `cancel-character-discard` constraint is placed by *Magical Harp* on the bearer's company; any future character-discard effect should consult this constraint to short-circuit the discard for the rest of the turn. The `hazard-draw-multiplier` constraint (scope `"company-mh-phase"`) multiplies the hazard draw count during the target company's M/H draw step by the `value` field (e.g. `2` to double opponent draws, as used by *Great-road*). The `haven-return-option` constraint (scope `"turn"`) records the company's origin haven at play time and enables a `haven-return` action during end-of-turn discard and signal-end steps, allowing the company to teleport back to the recorded haven without a new M/H phase (used by *Great-road*). The `check-modifier` constraint kind may also be added via a grant-action `add-constraint` apply (carrying `check` and a numeric `value`): a one-shot bonus/penalty consumed the first time the targeted character makes a matching check — e.g. *When You Know More* (dm-163) adds a `+2` `influence` modifier. Such a grant-action targets the chosen character with `target: "action-target-character"`, which resolves to `{ kind: "character", characterId: <action.targetCardId> }` (the candidate the legal-action generator put on the activation). The constraint filter in `legal-actions/pending.ts` rewrites legal actions for the affected target while the constraint lives. The `target: "bearer"` selector resolves to the *activating* character himself (`{ kind: "character", characterId: <action.characterId> }`) — used by the `can-use-palantir` constraint kind: Palantír of Elostirion (le-332) grants a `{ tap: "bearer" }` ability to a sage bearer whose apply is `{ "type": "add-constraint", "constraint": "can-use-palantir", "scope": "turn", "target": "bearer" }`, which makes `bearer.canUsePalantir` true for the rest of the turn — but **only** for the Palantír that placed it, since `buildGrantActionContext` matches the constraint's `source` against the card whose ability is being gated ("the bearer is able to use *this* Palantír this turn if he taps").
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
  by default. When `apply.target === "company-member"`, the reducer targets the
  first character in the bearer's company whose card definition matches
  `apply.filter` (a DSL condition over definition fields like `race` and
  `skills`); when no member matches, no corruption check is enqueued. Used by
  *Well-preserved* (as-108) to pick the company's non-Ringwraith shadow-magic
  user — Ringwraiths are exempt from the check, so the filter excludes them.
  Implemented in `chain-reducer.ts` `resolvePermanentEvent()`.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "enqueue-corruption-check", "modifier": -3 } }
  ```

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "enqueue-corruption-check", "modifier": -3,
               "target": "company-member",
               "filter": { "$and": [
                 { "race": { "$ne": "ringwraith" } },
                 { "skills": { "$includes": "shadow-magic" } } ] } } }
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

- `malady-without-healing` -- the bespoke `self-enters-play` orchestrator for
  A Malady Without Healing (le-159). On resolution it locates the target
  (`action.targetCharacterId`, which may be an **opponent's** character) and
  (1) enqueues a corruption check (`targetCorruptionModifier`, -1) on the
  target — rolled by the target's controller — carrying `awardKillMpTo` (the
  caster) and an `enqueue-body-check` `onSuccess` follow-up; and (2) unless the
  caster's shadow-magic user co-located with the target is a Ringwraith,
  enqueues a corruption check (`casterCorruptionModifier`, -5) on that user. The
  enabler is the first co-located controlled shadow-magic user (Ringwraith, or a
  character with the `shadow-magic` skill), preferring a Ringwraith so the
  caster avoids the -5 when possible. Implemented in `reducer-events.ts`
  (`applyShortEventOnEntersPlay`).

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "malady-without-healing",
               "targetCorruptionModifier": -1, "casterCorruptionModifier": -5 } }
  ```

- `enqueue-body-check` -- a corruption-check `onSuccess` follow-up (A Malady
  Without Healing le-159: "…followed by a body check (modified by +1 if
  tapped)"). When the target survives the corruption check, this enqueues a
  standalone (out-of-combat) body check as a generic `dice-check`: the
  `rollerPlayerId` rolls 2d6, +1 if the target is tapped/wounded, and if the
  modified roll exceeds the target's body the character is eliminated (CoE
  3.I.2.1 — a failed body check eliminates any character, wounded or not). The
  +1-if-tapped is folded into the check threshold (`body - tapMod`, comparison
  `gt`) at enqueue time. `onPass` is an `eliminate-character` carrying
  `awardKillMpTo`. Implemented in `pending-reducers.ts`
  (`applyCorruptionCheckResolution` success branch). This effect is not written
  in card JSON directly — it is synthesised by the `malady-without-healing`
  apply. The `eliminate-character` triggered action gains an optional
  `awardKillMpTo`: when the eliminated character is a **hero-character**, the
  named player is credited the hero's marshalling points as kill MP (via
  `player.bonusKillMarshallingPoints`, folded into `mp.kill` by
  `recompute-derived.ts`). The `corruption-check` pending kind gains the same
  `awardKillMpTo` field for hero eliminations by the corruption check itself.

- `play-target` gains two fields used by A Malady Without Healing (le-159):
  `targetScope: "any-player"` draws `character` candidates from **both** players
  (so a resource event may target an opponent's character), and
  `requiresControlledShadowMagicUserAtSite: true` restricts candidates to those
  co-located with a shadow-magic user the acting player controls. Enumerated by
  `eligibleMaladyTargets` in `legal-actions/organization.ts`.

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
  recorded `card` is `null`); it is declared on the Barad-dûr sites
  themselves via the `end-of-turn-win` site-rule, not hardcoded in the
  engine. A New Ringlord's own gate — "bearing The One Ring at a Ruins &
  Lairs where Information is playable" — is likewise declared as the `when`
  condition on its `owner-end-of-turn` on-event effect, evaluated by the
  end-of-turn scanner (`scanEndOfTurnWinConditions`) against
  `{ bearer: { itemNames }, site: { siteType, playableResources } }`.
  Implemented in `reducer-events.ts` (`applyShortEventOnEntersPlay`),
  `pending-reducers.ts` (`applyCorruptionCheckResolution`), and the
  end-of-turn scanner.

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

- `enqueue-gold-ring-test` -- under `on-event: self-enters-play` on a resource
  short-event, run the full Rule 6.2 gold-ring test on the gold ring named by
  `action.targetGoldRingInstanceId`. The reducer locates the ring's bearer and
  enqueues the shared `gold-ring-test` pending resolution, which rolls 2d6 (plus
  the optional `rollModifier`, default 0), consults the gold ring's own
  `ring-test-table` to map the total to eligible ring categories, discards the
  gold ring regardless of outcome, and then enqueues a `ring-play-offer` so the
  player may play a matching special ring from hand. The card pairs it with a
  `play-target` `character` filtered on `sage` skill and a `play-window`
  (`phase: organization`); the legal-action emitter crosses each eligible sage
  with the gold rings borne in that sage's company, emitting one
  `play-short-event` per gold ring (via `targetGoldRingInstanceId`) — this
  enforces "test a gold ring in a sage's company". Unlike `enqueue-ring-play-offer`
  (Secrets of Their Forging, which bypasses the dice roll and offers every table
  category), this apply performs the actual roll. Used by *Test of Fire*
  (le-239, `rollModifier: 0`); *Test of Lore* (tw-340) would use `rollModifier: -1`.
  Implemented in `reducer-events.ts` (`applyShortEventOnEntersPlay`) and
  `legal-actions/organization.ts` (`playResourceShortEventActions`).

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "enqueue-gold-ring-test", "rollModifier": 0 } }
  ```

  The same apply also works as a `grant-action` apply, where the tested ring is
  the action's `targetCardId` rather than `targetGoldRingInstanceId`. This is the
  Wizard tap-test of Rule 9.21: *Gandalf* (tw-156) and *Gandalf* FW (wh-4) pair
  `cost: { "tap": "self" }` with `targets: { "scope": "company-items", "filter":
  { "subtype": "gold-ring" } }`, so activating the grant taps the Wizard and
  enqueues the shared `gold-ring-test` resolution for the chosen ring. Routing
  the Wizard test through that resolution — rather than rolling inline — is what
  makes the ring's own `ring-test-table` (and the MEWH §10 Fallen-wizard −1)
  apply on the hero path. Implemented in `grant-action-apply.ts`.

  ```json
  { "type": "grant-action", "action": "test-gold-ring",
    "cost": { "tap": "self" },
    "targets": { "scope": "company-items", "filter": { "subtype": "gold-ring" } },
    "apply": { "type": "enqueue-gold-ring-test" } }
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

    Instead of (or in addition to) `requiredSkill`, the apply may carry a
    generic `filter` condition evaluated against the target chain entry's
    context: `{ target: { cardType, eventType, name }, declaredBy:
    { alignment } }`. Only entries matching the filter are offered — the
    chain-declaring emitter (`legal-actions/chain.ts`
    `playSkillCancelChainActions`) covers hazard short-events in hand
    responding to a live chain in any phase. A `removeFromGame: true`
    flag on the apply moves the spent event card from its player's
    discard pile to their out-of-play pile when its own chain entry
    resolves un-negated ("Remove this card from the game"); a negated
    entry leaves the card in the discard pile. Used by *Ire of the East*
    (wh-24): "Targets and cancels one minion short-event played by a
    Fallen-wizard earlier in the same chain of effects. … Remove this
    card from the game." — paired with `play-flag: no-hazard-limit` for
    "does not count against the hazard limit".

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "cancel-chain-entry",
               "select": "target",
               "requiredSkill": "scout" } }
  ```

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "cancel-chain-entry",
               "select": "target",
               "filter": { "target.cardType": "minion-resource-event",
                           "target.eventType": "short",
                           "declaredBy.alignment": "fallen-wizard" },
               "removeFromGame": true } }
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

- `offer-resource-play` -- under `on-event: self-enters-play`, marks the
  source card (Crown of Flowers) as one that lets the active player play one
  resource "with it". The source card simply enters play unlinked; the pairing
  is a **non-blocking** organization-phase action (`pair-resource-with-cof`),
  NOT a blocking pending resolution. This is important: enqueuing a blocking
  resolution when the card enters play would collapse the legal-action menu to
  "pair or pass" and prevent the player from playing/organizing characters for
  the rest of the organization phase. Instead, while an *unpaired* Crown of
  Flowers is in play, `cofPairResourceActions` (in `legal-actions/organization.ts`)
  offers one `pair-resource-with-cof` action per resource card in hand, alongside
  every other normal organization action.

  When paired, the chosen resource is moved from hand directly into
  `cardsInPlay` with three extra fields: `linkedInstanceId` (pointing to the
  source card), `assumeInPlay: ['Gates of Morning']`, and
  `assumeNotInPlay: ['Doors of Night']`. The source card's `cardsInPlay` entry
  is also updated with `linkedInstanceId` pointing back to the paired resource
  (which is also what marks the Crown as "paired" so no further pairing action
  is offered). Both links enable a cascade discard: when either linked card
  leaves `cardsInPlay`, the other is discarded too. The `collectGlobalEffects`
  function in `resolver.ts` reads `assumeInPlay` and `assumeNotInPlay` per card
  and adjusts the `inPlay` names list used by `matchesCondition` so
  GoM-conditional effects on the paired resource activate even without a real
  Gates of Morning on the table.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "offer-resource-play" } }
  ```

  Implemented in `chain-reducer.ts` (`resolvePermanentEvent` — enters play
  unlinked, no resolution enqueued), `legal-actions/organization.ts`
  (`cofPairResourceActions`), `reducer.ts` (dispatch of
  `pair-resource-with-cof`), `pending-reducers.ts` (`applyPairResourceWithCof`),
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

- `set-site-phase-flag` -- under `on-event: self-enters-play`, sets a named
  `SitePhaseState` boolean to `true` (fires only during the site phase). Valid
  `flag` values: `hoardBountyAvailable`, `thoroughSearchAvailable`, and
  `firstItemNoTapAvailable`. The last (Come By Night Upon Them le-176) lets the
  **first item** played at the site this site phase — any subtype — be played
  without tapping the site; `handleSitePlayResources` (`reducer-site.ts`) treats
  it like Thorough Search (leaves the site untapped, does not count as the
  site-tapping resource, consumes the flag), while the item still taps its
  bearer normally.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "set-site-phase-flag", "flag": "firstItemNoTapAvailable" } }
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

When the effect is declared on a **company-bound permanent-event** in
`cardsInPlay` (`CardInPlay.companyId` set — see `play-target` `target: "company"`)
with `cost: { "discard": "self" }`, it is sourced only for the bound company and
only in the pre-strike cancel window. Two extra fields specialize it for *Going
Ever Under Dark* (ba-37):

- `"requiresCvCC": true` — the cancel is offered only against a company-vs-company
  attack (`combat.isCvCC`) — "an attack against them by an opponent's company".
- `"roll": { "threshold": 7, "comparison": "gt", "scoutBonus": true }` — the
  cancel is **not** automatic. Paying the cost discards the card and enqueues a
  2d6 `dice-check` (roller = the defending player) whose modified total must
  satisfy `total comparison threshold` to cancel; `"scoutBonus": true` adds the
  number of Scout-skilled characters in the defending company to the roll. On
  success the check's `onPass: { type: "cancel-current-attack" }` verb cancels the
  combat; on failure combat continues. Backs "Discard this card from play and
  make a roll to attempt to cancel an attack … If the roll plus the number of
  scouts in the company is greater than 7, the attack is canceled."

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
- `defender.companyContainsBalrog` — `true` when the defending company
  contains The Balrog avatar. Lets a card gate on "an attack against The
  Balrog's company" (Darkness Wielded ba-55).
- `defender.inPlay` — attachment-aware list of the defending player's
  in-play card names (`cardsInPlay` plus every character, their items and
  hazards). Unlike the global `inPlay`, this catches a card that lives only
  as a character-attached permanent event (e.g. Great Shadow ba-62, a Demon
  fána on The Balrog). Gate with `{ "$includes": "<name>" }` (Darkness
  Wielded ba-55: "if Great Shadow is in play"). The same two fields are also
  exposed on the from-hand `modify-attack` `when` context.
- `attack.atUnderDeeps` — `true` when the defending company is **at**, or
  **moving to or from**, an Under-deeps site (its current site — the origin
  while moving — or its destination site carries the `under-deeps` keyword).
  Used by *Great Fissure* (ba-61): `"when": { "attack.atUnderDeeps": true }`
  cancels an attack against a company at / moving to-or-from an Under-deeps
  site.

**Deferred free cancel (`alsoCancelLaterAttack`).** When a `cancel-attack`
effect carries `"alsoCancelLaterAttack": true`, cancelling this attack also
grants the defending player a **turn-scoped `free-attack-cancel` constraint**
(installed when the cancel resolves on the chain, in `apply-dispatcher.ts`).
While the grant is active, `cancelAttackActions` offers a costless
`cancel-attack` with `mode: "free-later-cancel"` during any *later* combat this
turn whose defending company contains The Balrog (the constraint's
`restrictToBalrogCompany`); dispatching it consumes one grant and cancels the
attack immediately (no card played, no chain). Used by Darkness Wielded (ba-55):
"cancel this attack and a latter attack of your choice against his company this
turn." — a costless `cancel-attack` (`alsoCancelLaterAttack`) gated on
`defender.companyContainsBalrog` + `defender.inPlay $includes "Great Shadow"`.

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
the hand play routes through the chain.

**Player-state gate on the hand play.** A `play-condition` with
`requires: "player-state"` on a cancel-attack card is honoured by both
from-hand paths in `cancelAttackActions` (evaluated against the same
player-state context as the organization-phase / any-phase short-event
paths). Used by *Eye Never Sleeping* (as-82): "Playable if you are Sauron.
Cancel one hazard creature attack." — the gate is
`{ "player.playsAsSauron": true }` and the cancel is costless, restricted
to hazard creature attacks:

```json
{ "type": "play-condition", "requires": "player-state",
  "condition": { "player.playsAsSauron": true } },
{ "type": "cancel-attack",
  "when": { "attack.source": { "$in": ["creature", "on-guard-creature"] } } }
```

A combat-only short event carrying such a gate is still classified
combat-only (the `play-condition` is a neutral companion effect in both
short-event classifiers), so it is never offered outside combat.

**Site-swap cancel (`siteSwap`).** An in-play resource permanent-event carrying
`cost: { "discard": "self" }` plus a `siteSwap` payload cancels an attack by
*moving the site out from under the company*. Used by *Farmer Maggot* (as-48):
"If one of your companies faces an attack while at a site in The Shire,
Arthedain, or Cardolan, you may immediately replace its site card with another
site card in The Shire, Arthedain, or Cardolan (from your location deck). If your
company takes this option, the attack is canceled and this card is discarded."

```json
{ "type": "cancel-attack",
  "cost": { "discard": "self" },
  "siteSwap": { "regions": ["The Shire", "Arthedain", "Cardolan"] } }
```

`siteSwap.regions` lists the region names (site cards' `region` field) that both
the company's current site and the replacement must belong to.
`siteSwapCancelActions` (`legal-actions/combat.ts`) offers the option only while
the defending company is **at** such a site — a company in the middle of a move
is not "at" a site, so `destinationSite` must be null — and emits one
`cancel-attack` action per eligible site left in the controller's location deck,
each carrying its instance in `replacementSiteInstanceId`.

`handleCancelAttackBySiteSwap` (`combat-cancel.ts`) then, in order: disposes the
replaced site exactly as a departure site (CoE 2.IV.viii — tapped non-haven to
the site discard pile, otherwise back to the location deck; a site still occupied
by a sibling company stays in play), pulls the replacement out of the location
deck as the company's untapped current site, discards the host card, and cancels
the attack through `resolveCancelAttackEntry` (in-play source → immediate, no
chain). Because the company is *placed* at the replacement rather than moving to
it, it never enters that site: during the site phase the remaining
automatic-attack sequence for the company is abandoned via
`SitePhaseState.autoAttacksSkipped`, which also suppresses race-duplicated
attacks (*The Moon Is Dead*) and is cleared when the next company is selected.

Example (Wild Hounds — discard):

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
  "when": { "enemy.race": { "$in": ["orc", "troll", "man"] } } }
{ "type": "cancel-attack",
  "cost": { "tap": "self" },
  "when": { "enemy.race": { "$in": ["wolf", "animal"] } } }
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
- there is at least one eligible controlling character. When
  `controllerTaps` is true (le-220) only **untapped** characters qualify
  (they must be able to tap to take control); when it is false (ba-67,
  "the character need not tap") **any** character in the defending company
  qualifies, tapped or wounded.

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
  "races": ["orc", "troll", "giant", "slayer", "man"],
  "maxStrikes": 1,
  "controllerTaps": true,
  "ally": { "mind": 1, "body": 8, "prowessModifier": -7 }
}
```

Used by Ready to His Will (le-220). Memories of Old Torture (ba-67) uses
the same effect with `controllerTaps: false` and `body: 7`, and adds a
discard-on-move rule: a companion `on-event: bearer-company-moves`
self-discard (`when: { $or: [ { "sitePath.regionTypes": { "$includes":
"free" } }, { "sitePath.regionTypes": { "$includes": "dark" } } ] }`) is
evaluated against the ally's controlling company. Because the rule lives
on the event card (not on the creature-ally's own hazard definition), the
movement-discard sweep (`mh-hazard-play.ts` step 8a-2) also scans each
moving-company ally for an attached `convert-creature-to-ally` event whose
`bearer-company-moves` self-discard fires; when it does, the ally is
discarded and the orphaned event card follows via
`discardOrphanedConvertedAllyEvents`. The `bearer-company-moves` `when`
context exposes `sitePath.regionTypes` (the region types traversed this
move) alongside `movementType` and `destination`.

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
  "when": { "enemy.race": { "$in": ["spider", "animal", "wolf"] } },
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
    { "enemy.race": { "$in": ["orc", "troll"] } },
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
site automatic-attack or played auto-attack), `attack.detainment` (the
live attack's current detainment status), `attack.keying`, `inPlay`,
`defender.covert`, `defender.companyContainsBalrog`, `defender.inPlay`, and
`defender.minionCompany` (`true` when the defending/resource player is a
Ringwraith (minion) player).

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

**`setStrikesTo` (reduce to a fixed count).** Instead of a `strikesModifier`
delta, a from-hand `modify-attack` may *set* the attack's strike count to an
exact value with `"setStrikesTo": N`. The result never exceeds the attack's
current strike count (it only reduces) and is clamped to a minimum of 1 —
i.e. "the attack is reduced to one strike" is `"setStrikesTo": 1`. Used by
Darkness Wielded (ba-55): a defender-played `modify-attack` giving `-2` strike
prowess, `-1` body, and `setStrikesTo: 1`, gated on
`defender.companyContainsBalrog` + `defender.inPlay $includes "Great Shadow"`.

**`removeDetainment` (make a detainment attack normal).** When
`"removeDetainment": true`, applying the effect sets `CombatState.detainment`
to `false`, so the attack's strikes wound (and can eliminate) normally instead
of merely tapping. Gate the play with a `when` on `attack.detainment` so the
card is only offered on a detainment attack. Used by FEAR! FIRE! FOES! (as-29)
Mode B: "playable on a detainment automatic-attack. Against a minion company
the attack becomes normal (not detainment) and has -1 prowess." — an
attacker-played from-hand `modify-attack` with `prowessModifier: -1` and
`removeDetainment: true`, gated on `attack.automatic` + `attack.detainment` +
`defender.minionCompany`.

```json
{ "type": "modify-attack", "fromHand": true, "player": "attacker",
  "prowessModifier": -1, "removeDetainment": true,
  "when": { "$and": [
    { "attack.automatic": true },
    { "attack.detainment": true },
    { "defender.minionCompany": true } ] } }
```

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

### 10f-bis. `counter-cancel-attack-roll`

A hazard short-event the **attacking** (hazard) player plays during a combat
chain to *counter* an opponent-declared chain entry that would cancel a creature
attack of a matching race. Unlike a plain cancel, the counter is roll-gated.

Offered by `counterCancelRollChainActions` (`engine/legal-actions/chain.ts`)
while a chain is active, `state.combat` exists, the acting player is the
attacker, the attack's `combat.creatureRace` is one of the effect's `race`
values, and at least one unresolved opponent chain entry carries a
`cancel-attack` effect. Sources are the attacker's hand **plus** any unrevealed
on-guard cards on the defending company (the "may be revealed as an on-guard
card" clause). Emits one `counter-cancel-roll` action per (source, target
cancel entry) pair.

On play (`handleCounterCancelRoll`, `engine/chain-reducer.ts`) the card is moved
hand/on-guard → discard and pushed onto the chain as a short-event entry carrying
`counterCancelTargetInstanceId` (a dedicated payload field — *not*
`targetInstanceId`, which would trigger the Twilight-style environment-cancel
path). Sitting above the cancel entry (LIFO), it resolves first: `resolveEntry`
enqueues a generic `dice-check` (roll 2d6 + the attack's current
`combat.strikeProwess`, `comparison: "gt"`, `threshold` from the effect). On
success the `counter-cancel-attack` dice-check onPass verb (`applyDiceCheckBranch`,
`engine/pending-reducers.ts`) negates the targeted cancel entry (the attack
survives) and adds `prowessBonus` to `combat.strikeProwess`; on failure the cancel
resolves and ends the attack. The check's `continuation` marks the counter entry
resolved and resumes the chain.

```json
{ "type": "counter-cancel-attack-roll",
  "race": ["spider"],
  "threshold": 14,
  "prowessBonus": 1 }
```

Example: Black Vapour (ba-14) — "Target any effect (declared earlier in the same
chain of effects) that would cancel a Spider attack. Make a roll and add the
attack's prowess. If the result is greater than 14, the effect is canceled and
the attack receives +1 prowess." Its second mode ("+1 prowess to a Spider
attack") is a plain `modify-attack` (`fromHand`, `player: "attacker"`,
`when: { "enemy.race": { "$in": ["spider"] } }`), which also carries
the on-guard-reveal behaviour for that mode.

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

### 10f-bis. `combat-cancel-weapon`

Activated ability on an in-play item, usable **only during a company-vs-company
combat (CvCC)** in which the item's bearer's company is a participant. The
controller pays the `cost` (tapping the item — `{ "tap": "self" }`) and chooses
one weapon (a `weapon`-keyword item) borne by a character in the **opposing**
company; that weapon's effects are cancelled for the rest of the combat and the
weapon is **not** discarded.

```json
{ "type": "combat-cancel-weapon", "cost": { "tap": "self" } }
```

The chosen weapon's instance ID is added to
`CombatState.suppressedWeaponInstanceIds`. While it sits there,
`collectCharacterEffects` (`engine/effects/resolver.ts`) drops every effect the
weapon sources and `computeEffectiveStats` (`engine/recompute-derived.ts`) skips
its structural `prowessModifier`/`bodyModifier`, so the weapon contributes
nothing to its bearer's combat stats (CvCC reads `effectiveStats.prowess`). The
list lives on the combat state, so the cancellation clears automatically when
combat finalizes ("until the end of the combat"). Because a weapon's
contribution is always evaluated live from the item on the character, a weapon
just declared onto a character during the current chain of effects is suppressed
identically to one already in play — backing "(even declared in the same chain
of effects)" with no extra chain plumbing.

The `cancel-weapon-effects` action (`{ cardInstanceId, weaponInstanceId }`) is
generated by `cancelWeaponActions` in `engine/legal-actions/combat.ts` and
applied by `handleCancelWeaponEffects` in `engine/combat-cancel.ts`. It is
offered only to the controller of the item, whichever side the bearer is on.

Example: Whip of Many Thongs (ba-82) — a Balrog-specific "special" item borne by
The Balrog (exempt from the usual MEBA "items on the Balrog have no effect"
ban): "If The Balrog is in company vs. company combat, tap this item to cancel
all effects of one weapon of your choice … in an opponent's company until the
end of the combat. This does not discard the weapon."

### 10g. `join-combat-force-strike`

A **resource short-event** played by the defending player in the pre-assignment
window of the `assign-strikes` combat sub-phase (the same window as
`company-combat-boost` — `combat.phase === 'assign-strikes'` with no strikes yet
assigned). It brings a named character into the defending company if absent,
forces that character to face a strike from the current attack, and optionally
taps it after the attack.

```json
{
  "type": "join-combat-force-strike",
  "characterName": "The Balrog",
  "tapAfterAttack": true,
  "requiresSiteKeyword": "under-deeps",
  "notInPlay": "Flame of Udûn"
}
```

Fields:

- `characterName` — the character (by name) who joins the defending company and
  must face a strike (e.g. The Balrog).
- `tapAfterAttack` — when true, tap the character after the attack if still
  untapped (a `PostAttackEffect` with `tapIfUntapped`, the same mechanism as the
  Alatar haven-join "following the attack" tap).
- `requiresSiteKeyword` — playability gate: the defending company must be at
  (`currentSite`) or moving to (`destinationSite`) a site carrying this keyword
  (e.g. `under-deeps`).
- `notInPlay` — playability gate: the named card must not be in play
  (`buildInPlayNames`), e.g. Flame of Udûn.

On play, if the named character is not already in the attacked company it is
moved there — "considered movement with no movement/hazard phase", so only the
company membership arrays change (the `CharacterInPlay` entry is untouched, and
it is **not** restored after combat, unlike an Alatar haven-jump). The character
is added to `CombatState.forcedStrikeTargets`, whose defender-assignment status
gate is bypassed for a forced target so it must face a strike "regardless of any
conflicting effects" even while tapped or wounded.

Example: Vanguard of Might (ba-79) — "Playable if a company at or moving to an
Under-deeps site is facing an attack and Flame of Udûn is not in play. If not in
the company, The Balrog immediately joins the company. … The Balrog must face a
strike from the attack, regardless of any conflicting effects. Following the
attack, if untapped, tap The Balrog." ("Balrog specific" is a deck-construction
keyword, no play-time gate.)

Implemented in `engine/legal-actions/combat.ts` (`joinCombatForceStrikeActions`
offering + the forced-target status bypass in `assignStrikeActions`) and
`engine/reducer-events.ts` (`handlePlayResourceShortEvent` join / force-strike /
post-attack-tap block). Reuses `CombatState.forcedStrikeTargets` and
`PostAttackEffect` from the Alatar haven-join primitive.

### 10g-bis. `combat-discard-opponent-item`

A **Balrog resource short-event** played during a company-vs-company combat in
which The Balrog is untapped and a participant on the acting player's side. On
play the card-player chooses one item borne by any character in the *opposing*
company and discards it (to the opponent's discard pile).

```json
{ "type": "combat-discard-opponent-item" }
```

The effect carries no fields — the opposing company and the Balrog-untapped gate
are resolved from the live combat state. It is paired on the card with:

- the `balrog-specific` keyword (deck-construction restriction, no play-time
  gate);
- `{ "type": "play-window", "phase": "combat" }` so the generic resource
  short-event emitters (organization / M-H / long-event) never offer it outside
  combat;
- `{ "type": "play-condition", "requires": "card-in-play", "cardName": "Flame of
  Udûn" }` — playable only while Flame of Udûn is in play
  (`isCardNameInPlayForPlayer`, attachment-aware);
- `{ "type": "duplication-limit", "scope": "turn", "max": 1 }` — "cannot be
  duplicated on a given turn";
- optionally a `select: "self"` sideboard→deck `move` (the shared Balrog
  sideboard-access clause, see Terror Heralds Doom ba-78).

The legal-action emitter `combatDiscardOpponentItemActions`
(`engine/legal-actions/combat.ts`, wired into the CvCC windows of
`combatActions` alongside the Whip's `cancel-weapon` actions) offers one
`play-short-event` per eligible hand card when: the combat is CvCC and the acting
player owns one of the two companies with The Balrog untapped in it; the opposing
company bears at least one genuine item; Flame of Udûn is in play; and the
turn-scoped duplication limit is not yet reached
(`countConstraintsFromDefinition`). It is offered to whichever side The Balrog is
on (attacker or defender), mirroring `cancelWeaponActions`.

On play, `handlePlayResourceShortEvent` (`engine/reducer-events.ts`) discards the
spent event to the player's discard pile, records a turn-scoped
`attack-card-played` marker constraint (swept at `turn-end`, so a second copy is
blocked all turn), and enqueues a `discard-one-company-item` pending resolution
on the opposing company with the card-player as `actor` (the same resolution
Brigands uses on a wound). The card-player then picks one item via a
`discard-item-from-company` action; the item is removed from its bearer and moved
to the **opponent's** discard pile. Because a pending resolution takes priority
over combat routing, the top-level reducer skips the combat handler while the
resolution is queued for the acting player (otherwise `discard-item-from-company`
— shared with An Article Missing's combat sub-phase — would be misrouted).

Example: Scourge of Fire (ba-75) — "Playable if Flame of Udûn is in play. …
Choose and discard one item an opponent's company bears if The Balrog is untapped
and in company vs. company combat with that company. Cannot be duplicated on a
given turn."

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
`bearer.skills`, `bearer.race`, `bearer.name`, `enemy.race`, and the
attack's keying (`attack.source`, `attack.keying` — region types,
`attack.siteKeyingTypes` — site types, `attack.keyingRegionNames` —
region names), so cards can gate the ability on the bearer's skill or
race (e.g. Enruned Shield — Warrior only) or on where the hazard
creature was keyed (e.g. Shadow-cloak le-344 — a strike from a creature
keyed to a Shadow-land [{s}], Shadow-hold [{S}], Dark-domain [{d}], or
Dark-hold [{D}]). The keying fields mirror the ones already exposed to
`cancel-attack` conditions; automatic attacks leave them empty, so a
keying-gated cancel-strike never fires against a site auto-attack. A
tap-cost (`cost: { "tap": "self" }`) item must be untapped when activated.

Alternatively the cost may be a **corruption check** on the bearer
(`cost: { "check": "corruption", "modifier": <n> }`) rather than a tap —
The One Ring (tw-347): "Bearer may make a corruption check modified by -2
to cancel a strike against himself; this does not work against Undead and
Nazgûl strikes." Nothing taps; instead `handleCancelStrike`
(`combat-actions.ts`) cancels the strike and enqueues a `corruption-check`
{@link PendingResolution} for the bearer carrying the effect's `modifier`.
The strike is canceled regardless of the check's outcome — the check is the
cost/risk, not a condition — and it surfaces as the bearer's next legal
action (combat yields to the pending resolution before further combat
actions; see `computeLegalActions`' combat/pending ordering). Because the
source's tapped status is irrelevant to this variant, it is offered even
when the ring is tapped. The `when` clause gates the exclusions (Undead /
Nazgûl above).

```json
{ "type": "cancel-strike",
  "cost": { "check": "corruption", "modifier": -2 },
  "when": { "$not": { "$or": [
    { "enemy.race": "undead" }, { "enemy.race": "ringwraith" }
  ] } } }
{ "type": "cancel-strike",
  "cost": { "tap": "self" },
  "target": "other-in-company",
  "filter": { "target.race": "hobbit" } }
{ "type": "cancel-strike",
  "cost": { "tap": "self" },
  "when": { "bearer.skills": { "$includes": "warrior" } } }
```

### 11a. `flee-from-strike`

A from-hand combat **permanent-event** the defender plays to make a named
character "flee" a strike he would likely lose. Offered (to the defending
player) during the `resolve-strike` sub-phase when the current strike is
assigned to a character whose name equals `characterName` and the strike's
prowess is **strictly higher** than that character's effective prowess. The
struck target must be a real character (not an ally) — only characters untap,
which the delayed skip needs. Gate "Cannot be duplicated" with a
`duplication-limit` (scope `game`, checked by name via `countCopiesInPlay`).

On play (`flee-from-strike` action → `handleFleeFromStrike` in
`combat-actions.ts`):

- the current strike is canceled (marked `'canceled'`, combat advances via
  `nextStrikePhase`);
- the named character taps if untapped;
- the card leaves hand and enters the controller's `cardsInPlay` (attached to
  the character), carrying a one-shot **`skip-next-untap`** active constraint
  (`scope: until-cleared`).

The next time that character would untap during the untap phase,
`performUntap` (`reducer-untap.ts`) holds him tapped, removes the constraint,
and discards the in-play card to its owner's discard pile — a single-use lock.

```json
{ "type": "flee-from-strike", "characterName": "The Balrog" }
```

Used by Fled into Darkness (ba-18): "Playable before the strike sequence on
The Balrog facing a strike with a prowess higher than his. The strike is
canceled and The Balrog taps, if untapped. The next time The Balrog would
otherwise untap, make him tapped instead and discard this card. Cannot be
duplicated." — `flee-from-strike` `{ characterName: "The Balrog" }` +
`duplication-limit` scope `game` max 1.

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

**`unplayable-when`** — the card cannot be played while the `when` condition
matches the play context `{ actor: { alignment }, opponent: { alignment } }`
(the acting player and their opponent). The `reason` field is the
human-readable explanation surfaced in the not-playable tooltip. Applied by
`applyDeclaredPlayRestrictions` in `legal-actions/index.ts`, which rewrites
any `play-*` action for a matching card into a not-playable entry. This
carries the opponent-conditional play bans: MEBA's "if you are a Balrog
player, your opponent may not play any of the following cards" list (The
Balrog ally as-71, The Black Council wh-41, Durin's Bane dm-107, Balrog of
Moria tw-12, Reluctant Final Parting dm-84) and CoE 1.35's cards with no
effect against a Ringwraith player (Bane of the Ithil-stone tw-13, The Black
Enemy's Wrath dm-47, Foul Fumes tw-36, In the Heart of his Realm dm-67,
Mordor in Arms dm-72, Mûmak tw-66, Worn and Famished td-89). The CoE 3.10
mirror-match exemption — in a Balrog mirror both players keep their
Balrog-specific cards — is expressed in the condition itself via
`actor.alignment: { "$ne": "balrog" }`, not by engine special-casing.

```json
{ "type": "play-restriction", "rule": "unplayable-when",
  "when": { "opponent.alignment": "balrog",
            "actor.alignment": { "$ne": "balrog" } },
  "reason": "cannot be played against a Balrog player (MEBA)" }
```

The CoE 1.35 clause "hazards that require an agent (as an active condition)"
is not yet covered — no hazard cards currently declare a machine-readable
agent-requirement.

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

### 14a-iii. `avatar-home-site-restriction`

Marker effect on an in-play permanent-event. While the carrying card is in its
controller's `cardsInPlay`, that player's own **avatar** may only be *brought
into play* at its home site — the extra-haven reveal option (a Wizard avatar's
Rivendell, a Ringwraith avatar's Minas Morgul / Dol Guldur; see
`avatarExtraHavenNames`, rule 2.II.2.1.W1/R1) is suppressed. Consulted by the
play-character legal action (`legal-actions/organization-characters.ts`, via
`playerHasAvatarHomeSiteRestriction` → `findPlayableSites`'s new
`avatarHomeSiteOnly` flag) only when the character being played is the acting
player's avatar; non-avatar character play is unaffected.

```json
{ "type": "avatar-home-site-restriction" }
```

Paired with the `avatar-enters-play` on-event (below), the `general-influence`
`stat-modifier`, the `player.avatarInPlay` play-condition, and a `player`-scope
`duplication-limit` on Saw Further and Deeper (dm-156): "Your Wizard may only be
brought into play at his home site."

The companion **`on-event: avatar-enters-play`** trigger fires the moment the
controller brings *their own* avatar (mind === null) into play — distinct from
`self-enters-play`, which fires for the entering card itself. It runs a `move`
apply (self → discard) in `handlePlayCharacter` (`reducer-organization.ts`,
`applyAvatarEntersPlayEffects`), used for dm-156's "Discard when you bring your
Wizard into play."

```json
{ "type": "on-event", "event": "avatar-enters-play",
  "apply": { "type": "move", "select": "self", "from": "self-location", "to": "discard" } }
```

The "not revealed" gate is the standard `play-condition` `player-state` against
the new `player.avatarInPlay` context field (`false` while no avatar is in play):

```json
{ "type": "play-condition", "requires": "player-state",
  "condition": { "player.avatarInPlay": false } }
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

### 14a-ii. `environment-override`

Reshapes, game-wide, which named environment cards are *considered* in or out of
play while the bearer is itself in play. Where `name-alias` only *adds* the
bearer's alias, this can both add names (`considerInPlay`) and remove names
(`considerNotInPlay`) from every "is X in play?" query — the `inPlay` context
built by `buildInPlayNames` **and** the name-in-play predicates that back
`card-in-play` / `card-not-in-play` play-conditions
(`isCardNameInPlayOrCharacters`, `isCardNameInPlayForPlayer`,
`inPlayNamesForPlayerDeep`). Removals are applied before additions, so a name in
both lists ends up considered in play.

```json
{
  "type": "environment-override",
  "considerInPlay": ["Doors of Night"],
  "considerNotInPlay": ["Gates of Morning"]
}
```

Used by Peril Returned (td-54): "If Gates of Morning is not in play, Doors of
Night is considered to be in play. If Gates of Morning is in play, it is
considered to be out of play while Peril Returned is in play." Both branches net
to the same unconditional state (Doors of Night in, Gates of Morning out), so
the card carries the fixed override above. The Gates of Morning *card* is not
removed — it stays in `cardsInPlay` and may still be removed normally (Twilight,
Doors of Night, etc.); only its interpretation is suppressed. Because the
override touches only the named environments (not `countCopiesInPlay`), it never
blocks playing an actual Doors of Night or duplicates.

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

#### `discard-to-recruit` — discard the bearer to play a character from hand

A generalized cousin of `manifestation-swap` for abilities of the form
"discard <bearer> to play a character from your hand with his company"
(Folco Boffin dm-180: "You may discard Folco Boffin at a Haven to play any
Hobbit from your hand with his company").

```json
{ "type": "discard-to-recruit", "requireHaven": true,
  "filter": { "target.race": "hobbit" } }
```

- `requireHaven` (optional) — when `true`, the bearer's company must currently
  be at a Haven for the action to be offered.
- `filter` (optional) — a `Condition` matched against the **incoming hand
  character's definition**, exposed as `target` (e.g. `{ "target.race":
  "hobbit" }`). Only character cards satisfying it may be brought in.

While the bearer is in a company (and, with `requireHaven`, at a Haven), the
controller may play a matching character from hand as a `discard-to-recruit`
action. Per CRF 22 (Folco Boffin) this replacement "can be done at any time
that a normal resource could be played", so — like `manifestation-swap` — the
emitter (`legal-actions/discard-to-recruit.ts`) is wired into the organization,
movement/hazard, and site phase aggregators and never consumes the
one-character-per-turn slot. The reducer (`handleDiscardToRecruit` in
`reducer-organization.ts`, routed from all three phase reducers) brings the
incoming character into the bearer's company at the same position untapped,
transferring every attachment (items/allies/hazards/trophies) and control
relationship exactly as a manifestation swap does — but the discarded bearer's
card goes to its owner's **discard pile** (recyclable), not out-of-play. The
discard is the cost, so the incoming character bypasses the usual play gates
(influence, home-site, once-per-turn).

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

The related `play-flag: "no-allies-in-company"` is carried instead by an **item /
attached permanent-event on a character**: while any company member bears it, no
ally may be played to that company (`companyHasNoAllyRestriction` in
`reducer-utils.ts`, consulted by the ally-play emitter in `legal-actions/site.ts`).
Allies are only ever played during the site phase, so this realizes "no allies in
his company outside the organization phase" without a phase gate. To discard the
allies already on the bearer, pair it with an `on-event: self-enters-play`
`move` from `allies-on-target` to `discard`. Used by Flame of Udûn (ba-58).

```json
{ "type": "play-flag", "flag": "no-allies-in-company" }
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

### 15e-bis. `play-flag: "remove-from-game"`

"Remove this card from the game." — carried by a **short-event**. A hazard short
event is discarded at play time, so once its own chain entry resolves un-negated
`chain-reducer.ts` moves the spent card on from the declaring player's discard
pile to their `outOfPlayPile`, where nothing can recur it. A **negated** entry
leaves the card in the discard pile (the card never took effect).

This is the generic form of the same clause already expressed per-effect by
`draw-cards.removeFromGame` (Dark Tryst as-80) and
`cancel-chain-entry.removeFromGame` (Ire of the East wh-24); reach for the flag
when the removal is a standalone sentence rather than a rider on one verb. Used
by *Echoes of the Song* (wh-17).

```json
{ "type": "play-flag", "flag": "remove-from-game" }
```

### 15f. Radagast's Black Bird primitives (`no-tap-on-play`, `influences-factions`, `return-to-hand`)

A cluster of ally primitives introduced for Radagast's Black Bird (wh-114), a
`radagast-specific` unique ally with `directInfluence` (a new optional field on
the ally card types) and `playableAt: [{ "any": true }]`.

- **Wizard-specific ally control** — a `<wizard>-specific` ally may only be
  controlled by the matching Fallen-wizard avatar. The ally-play emitter
  (`legal-actions/site.ts`) restricts the controlling-character candidates to
  the avatar named by `wizardSpecificName` (from the `radagast-specific`
  keyword). No new effect — the keyword drives it.

- **`play-flag: "no-tap-on-play"`** — playing the ally taps neither the
  controlling character nor the site ("need not tap himself or the site").
  The emitter additionally lets a **tapped** controller play it (it never
  taps), and `handlePlayHeroResource` (`reducer-site.ts`) leaves character and
  site untapped and does not consume the site's resource slot / opening
  minor-item bonus. Combine with `playableAt: [{ "any": true }]` and
  `playable-at-tapped-site` for "may play this ally at any site (tapped or
  untapped)".

  ```json
  { "type": "play-flag", "flag": "no-tap-on-play" }
  ```

- **`play-flag: "influences-factions"`** — the ally "may attempt to influence
  factions as if he were a character". Untapped company allies carrying this
  flag (with a printed `directInfluence`) are added to the faction-influence
  emitter's influencer list (`legal-actions/site.ts`), and the declare/resolve
  reducers (`reducer-site.ts`) plus the pending `faction-influence-roll` legal
  action (`legal-actions/pending.ts`) tap the ally and compute its DI-based
  need when the `influencingCharacterId` resolves to an ally.

  ```json
  { "type": "play-flag", "flag": "influences-factions" }
  ```

- **`return-to-hand`** — the ally's controller "may return it to hand" under
  the listed triggers, instead of it being discarded:
  - `organization` — a `return-attached-to-hand` action offered during the
    owner's organization phase (`returnAttachedToHandActions` in
    `legal-actions/organization.ts`; reducer in `reducer-organization.ts`).
  - `controller-leaves-play` — when the controlling character leaves active
    play, the ally goes to the owner's hand rather than the discard pile. The
    shared `partitionLeavingAllies` (`reducer-utils.ts`) routes it at every
    character-leaves-play site (`discardCharacter`, combat body-check discard,
    combat elimination, card-discard elimination).

  ```json
  { "type": "return-to-hand", "during": ["organization", "controller-leaves-play"] }
  ```

Radagast's Black Bird also carries a `cancel-strike` (`cost: { tap: self }`,
no `when`), reusing the self-tap cancel-strike primitive (§11) so it cancels any
strike directed against it (creature or automatic-attack), tapping afterwards.

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

For **hazard** character-targeting plays during the movement/hazard phase
(`movement-hazard.ts`), the filter context additionally exposes
`company.siteType` and `company.atHaven` — resolved from the target company's
**destination** site when it is moving (a moving company is "at" its new site
for hazard purposes), falling back to its current site otherwise. `atHaven` is
`true` when that site's type is `haven` (covers both Havens and Darkhavens).
Used by *The Burden of Time* (tw-94): "Playable on an Elf not in a
Haven/Darkhaven" — `filter: { "$and": [ { "target.race": "elf" },
{ "company.atHaven": false } ] }`.

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
  `lairOf`, `adjacentSites`, `keywords`, …) **plus** four synthetic fields
  injected at match time by the shared `buildSiteFilterContext`
  (`engine/effective.ts`), used identically by the site, organization and
  movement/hazard play paths:
  - `regionType` — the {@link RegionType} of the region the site sits in
    (`siteRegionTypeOf`); the region's type lives on a separate region card,
    not on the site. Hidden Haven (wh-75): `{ "$and": [ { "siteType":
    "ruins-and-lairs" }, { "lairOf": { "$exists": false } }, {
    "adjacentSites": { "$exists": false } }, { "regionType": { "$in":
    ["wilderness", "border", "shadow"] } } ] }`.
  - `effectiveSiteType` — the type after any `site-type-override` /
    `wizardhaven-conversion`, so "your Wizardhaven [{H}]" also matches a
    dynamically converted haven (Guarded Haven wh-74).
  - `isWizardhaven` — the site is a Fallen-wizard haven for some player,
    printed (a `fallen-wizard`-alignment haven) or converted. Distinguishes a
    Wizardhaven from a METW Haven / MELE Darkhaven.
  - `isProtected` — the site is a protected site for some player, whether via
    a `site-protected` constraint (The Fortress of Isen wh-68, Guarded Haven
    wh-74) or inherently (Rhosgobel wh-57). Nature's Revenge (wh-27),
    "a site in a Wilderness that normally is a Border-hold or a Shadow-hold,
    or a non-protected Wizardhaven in a Wilderness": `{ "$and": [ {
    "regionType": "wilderness" }, { "$or": [ { "siteType": { "$in":
    ["border-hold", "shadow-hold"] } }, { "$and": [ { "isWizardhaven": true },
    { "isProtected": false } ] } ] } ] }`.

  A site-targeting **hazard** binds to the company's *destination* site, which
  the site-attached orphan sweep (`discardOrphanedSiteAttachedEvents`) counts
  as occupied alongside current sites — a revealed destination site card is on
  the table from the moment the path is declared.
- `faction` — for **resource permanent events**, one of the controller's own
  in-play factions (Long Grievous Siege ba-40, "Playable on a unique non-Dragon
  faction"). One `play-permanent-event` action is emitted per faction in the
  player's `cardsInPlay` matching the `filter`, evaluated against
  `{ target: { name, race, unique } }` (e.g. `{ "$and": [ { "target.unique":
  true }, { "target.race": { "$ne": "dragon" } } ] }`); the chosen faction rides
  on `targetFactionInstanceId` and the resolved card is bound via
  `CardInPlay.attachedTo`. When the card also carries a `faction-siege` effect,
  the action cross-product includes one eligible location-deck site per action
  (`besiegedSiteInstanceId`). `duplication-limit` `scope: "faction"` limits
  copies per faction instance ("Cannot be duplicated on your faction",
  counted by `countFactionAttachedCopies`). Hazard-side short events (Muster
  Disperses) use the same target kind against in-play factions of both players.
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
  influence attempt (faction play). Revealed on the influence **chain**
  (`onGuardRevealChainActions` in `legal-actions/chain.ts`), never in the
  resource-play window.
- `resource-play` — when the resource player plays any resource that
  taps the site (generic catch-all). An optional `playedFilter` condition is
  matched directly against the played card's definition, restricting which
  plays allow the reveal — e.g. Heedless Revelry (le-114) uses
  `{ "cardType": { "$in": ["hero-resource-item", "minion-resource-item",
  "hero-resource-ally", "minion-resource-ally"] } }` for "in response to the
  play of an item, ally, or faction" (the faction leg is its separate
  `influence-attempt` trigger).
- `resource-short-event` — when a resource short event whose `requiredSkill`
  matches the enclosed `apply.requiredSkill` is about to resolve
  (Searching Eye).

An optional `apply` runs when the revealed card's effect fires:
`cancel-chain-entry` (Searching Eye) cancels the deferred play outright;
`company-tap-characters` (Heedless Revelry) taps every untapped company
character matching its `filter` when the revealed short-event's chain entry
resolves — the deferred play is **not** interfered with (it still runs when
the on-guard window closes). A revealed **short** event is moved to the
revealing player's discard pile at reveal time, mirroring hand-played shorts.

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
    "filter": { "enemy.race": { "$ne": "ringwraith" } } }
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

  The optional `skipForAlignments` field lists player alignments for which
  the end-of-turn automatic test (rule 9.23) is skipped entirely at this
  site — MEBA: "Rings are not automatically tested for a Balrog player at
  Barad-dûr" (Barad-dûr is not one of the Balrog's Darkhavens), encoded as
  `"skipForAlignments": ["balrog"]` on le-352. The default rule-9.23 company
  modifier still applies to ring tests triggered by other means.

  ```json
  { "type": "site-rule", "rule": "site-phase-ring-auto-test", "rollModifier": -3,
    "skipForAlignments": ["balrog"] }
  ```

- `end-of-turn-win` — declares a positional win condition checked at the
  start of each of the active player's end-of-turn phases
  (`checkEndOfTurnSiteWin` in `reducer-end-of-turn.ts`): if a company of the
  active player is at this site and the `when` condition matches the context
  `{ player: { alignment }, company: { itemNames } }` (the active player's
  alignment and the names of every item borne by the company's characters),
  that player immediately wins via the shared `endGame` one-ring primitive.
  Used by *Barad-dûr* (tw-374 / le-352) for the MELE §1 Ringwraith win: a
  Ringwraith player whose company bears The One Ring at Barad-dûr wins
  immediately.

  ```json
  { "type": "site-rule", "rule": "end-of-turn-win",
    "when": { "player.alignment": "ringwraith",
              "company.itemNames": { "$includes": "The One Ring" } } }
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

- `allow-agent-play` — lets agent characters be brought into play at this
  site under a character's **direct influence** (as a follower joining a
  company already at the site), overriding rule 2.II.2.2.5 which otherwise
  confines an agent played as a character to its own home site. Only
  Ringwraith/Fallen-wizard players may play agents as characters at all, and
  only direct influence is granted here — general-influence play at the site
  is not. Consumed by `legal-actions/organization-characters.ts`
  (`findPlayableSites` widens agent eligibility; the general-influence branch
  skips such sites). Used by *Bree* (le-356): "Agent minions may be brought
  into play under direct influence at this site."

  ```json
  { "type": "site-rule", "rule": "allow-agent-play" }
  ```

- `dynamic-under-deeps-adjacency` — an Under-deeps site whose adjacency is
  *chosen when it is played* rather than fixed on the card ("one Under-deeps
  <type> chosen by you when playing this card (N)"). The engine has no
  unoccupied-in-play site zone in which to record the once-chosen connection,
  so the site is treated as Under-deeps-adjacent — at `roll` — to any **other**
  Under-deeps site whose (printed) type is one of `siteTypes`. The connected
  site must carry the `under-deeps` keyword, so no *surface* site is ever
  adjacent ("no surface site"). Symmetric and player-agnostic; consumed by
  `isUnderDeepsAdjacent` (plan-movement / declare-path reachability) and
  `getUnderDeepsRequiredRoll` (the required roll). Used by *Ancient Deep-hold*
  (ba-83): "no surface site, one Under-deeps Ruins & Lairs [{R}] chosen by you
  when playing this card (8)."

  ```json
  { "type": "site-rule", "rule": "dynamic-under-deeps-adjacency",
    "siteTypes": ["ruins-and-lairs"], "roll": 8 }
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

- `deny-company-move` — forbids a company matching the optional `when`
  condition from declaring movement **to** this site. Enforced at
  organization-phase plan-movement (`engine/legal-actions/organization-companies.ts`
  drops the destination from the company's candidate list across the
  regular/starter, Eagle/Gwaihir, Under-deeps and Deep Mines passes), with a
  reducer backstop in `engine/reducer-organization.ts` `handlePlanMovement`.
  Both delegate to `reducer-utils.ts` `siteDeniesCompanyMove`. The `when`
  condition is evaluated against `{ company: { hasRingwraith } }` —
  `hasRingwraith` is true when any character in the moving company has
  `race: ringwraith` (avatar or follower). Absent `when` bars every company.
  Used by *Rivendell* (as-160) — "A Ringwraith may not move to this site."

  ```json
  { "type": "site-rule", "rule": "deny-company-move",
    "when": { "company.hasRingwraith": true } }
  ```

- `deny-company-attack` — forbids company-vs-company attacks at this site.
  Checked wherever a CvCC attack is offered or declared
  (`engine/legal-actions/site.ts` `declareCompanyAttackActions`,
  `engine/reducer-site.ts` `opponentHasAttackableCompanyAtSite` and
  `handleDeclareCompanyAttack`), all delegating to `reducer-utils.ts`
  `siteDeniesCompanyAttack`. Because each player holds his own version of the
  shared location (hero/minion twins share a name), the rule is looked up on
  **both** companies' current site cards; a match denies the attack outright,
  beating any `cvcc-attack-permission` grant. The optional `when` condition is
  evaluated against the same context as `cvcc-attack-permission`:
  `{ attacker: { alignment, isMinion, hasRingwraith }, defender: { … } }`.
  Absent `when` bars every CvCC attack here. Used by *Rivendell* (as-160) —
  "A minion company may not attack another company at this site."

  ```json
  { "type": "site-rule", "rule": "deny-company-attack",
    "when": { "attacker.isMinion": true } }
  ```

- `ringwraith-reanimate-from-discard` — grants the player whose Ringwraith is
  at this site an organization-phase ability: the Ringwraith may tap to bring
  one character matching `filter` from that player's discard pile into play
  **at this site, as another company**. An org-phase emitter
  (`siteRingwraithReanimateActivations` in
  `engine/legal-actions/organization.ts`) offers one `reanimate-from-discard`
  action per (untapped Ringwraith avatar of race `ringwraith` present at the
  site, eligible discard-pile character) pair — skipping uniques already in
  play and manifestations of an in-play entity. The reducer
  (`handleReanimateFromDiscard`, `engine/reducer-organization.ts`) taps the
  Ringwraith, removes the character from the discard pile, and mints it under
  general influence into a new company sharing the in-play site instance
  (`siteCardOwned: false`), tagged with a `reanimatedRingwraithId` marker; the
  play does not consume the one-character-per-turn slot (the tap is the cost).
  At the M/H→Site boundary, `discardStrandedReanimatedCompanies`
  (`engine/mh-hazard-play.ts`, run from `finalizeCompanyMH`) enforces "must move
  to a different site from that of your Ringwraith this turn or be discarded":
  a reanimated company still sharing a site (by definition id) with its
  Ringwraith's company has its character(s) discarded to the owner's discard
  pile; one that reached a different site keeps its character(s) and has the
  turn-scoped marker cleared. `filter` is matched against the discard-pile
  character's card definition. Used by *Urlurtsu Nurn* (le-409, minion) —
  "If your Ringwraith is at this site, he may tap during the organization phase
  to bring one Orc or Troll character from your discard pile into play at this
  site (as another company)."

  ```json
  { "type": "site-rule", "rule": "ringwraith-reanimate-from-discard",
    "filter": { "race": { "$in": ["orc", "troll"] } } }
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
  { "type": "site-rule", "rule": "allow-creature-by-race", "race": "man" }
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

- `cancel-attacks-if-character-in-play` — removes ALL of this site's
  *printed* automatic-attacks while a character whose card name equals
  `characterName` is in play for either player (present in a player's
  `characters` record). Matched by name rather than definition ID so every
  version of the card counts (Wizard avatars exist in multiple sets — e.g.
  Radagast is tw-178 as a hero Wizard and wh-8 as a Fallen-wizard). Only the
  printed attacks are removed; attacks added to the site by hazard effects
  (Spawn permanent-events, `extra-automatic-attack` constraints) are separate
  hazard attacks and are unaffected. Consumed by `getActiveAutoAttacks()` in
  `engine/manifestations.ts`. Used by *Rhosgobel* (as-159) — "If the Wizard
  card Radagast is in play, the automatic-attacks are removed."

  ```json
  { "type": "site-rule", "rule": "cancel-attacks-if-character-in-play", "characterName": "Radagast" }
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

- `no-storage` — "Resources may never be stored at this site." Suppresses every
  `store-item` offer for a company whose current site carries this rule (both the
  organization-phase generator and any `allow-store-eot` end-of-turn window in
  `storeItemActions`), and the store-item reducer (`handleStoreItem`) rejects a
  store attempt as a backstop. Used by *Geann a-Lisch* (le-374), a minion Haven
  that would otherwise permit storing regular items.

  ```json
  { "type": "site-rule", "rule": "no-storage" }
  ```

- `hazard-site-type-override` — a site that "counts as a `<site type>` for the
  purposes of playing and interpreting hazards". Overrides the site-type — and,
  when declared, the site path — the engine uses for the *creature-keying pass*
  against a company whose effective site (destination if moving, else current)
  carries the rule; every other purpose (movement, healing/untap, draws, storage)
  keeps the printed type. A Haven normally blocks hazards emergently (its `haven`
  type and empty path match no keying), so this re-exposes a company here to
  hazards keyed to the override type / path. Applied in
  `enterSetHazardLimitAndAutoAdvance` (`mh-steps.ts`): `siteType` replaces
  `mhState.destinationSiteType` and `sitePath` (optional) replaces
  `mhState.resolvedSitePath`. Used by *Geann a-Lisch* (le-374): "counts as a
  Ruins & Lairs [{R}] … its site path for this purpose … is the one from Carn
  Dûm [{s}{w}{w}{w}{w}]."

  ```json
  { "type": "site-rule", "rule": "hazard-site-type-override",
    "siteType": "ruins-and-lairs",
    "sitePath": ["shadow", "wilderness", "wilderness", "wilderness", "wilderness"] }
  ```

- `protected-wizardhaven` — the site is an **inherently protected Wizardhaven**:
  a Wizardhaven that is always protected for the Fallen-wizard who controls it,
  with no card needing to establish protection on it (unlike Isengard / The
  White Towers, which only become protected once *The Fortress of Isen* wh-68 /
  *Guarded Haven* wh-74 are played on them). It behaves exactly as if it carried
  an active `site-protected` constraint owned by its controller: the shared
  `isSiteProtectedForPlayer` / `inherentProtectedWizardhavenOwner` helpers
  (`reducer-utils.ts`) fold it into every protected-site consumer — the Deep
  Mines (wh-55) descent source, the "at a protected Wizardhaven" play conditions
  (A Strident Spawn wh-61 / An Untimely Brood wh-62, Half-orcs wh-86/87), the
  `player.hasProtectedWizardhaven` player-state flag, and the marshalling-point
  block a protected site imposes on the opponent. The controller is the
  Fallen-wizard for whom the site is a Wizardhaven and who satisfies the site's
  `<wizard>-specific` keyword, if any. Used by *Rhosgobel* (wh-57): "This site is
  a protected Wizardhaven [{H}]." (`radagast-specific`, so only Radagast controls
  it).

  ```json
  { "type": "site-rule", "rule": "protected-wizardhaven" }
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

The store handler stamps the stored pile entry with `storedAtSite` (the site
definition it was stored at), which "stored there" references such as
`play-with-stored-card` match against.

### 21a. `storage-site-transfer`

Carried by a permanent event whose play *is* the act of storing one
marshalling-point card at a site it could not normally be stored at — "any
reference to the site where the card can normally be stored are transferred
instead" (Wizard's Trove wh-85, "Alternatively" mode). Offered during the
controller's organization phase (Stage resource timing) for every
(item, bearer) pair where the bearer's company is at a site matching
`siteFilter` (the site definition extended with `regionType` and
`effectiveSiteType`, exactly like a site `play-target` filter) and the item
carries a `storable-at` effect with an explicit `marshallingPoints` override
(a card that scores its own MP from storage — the "marshalling point card"
reading; regular minor/major/greater items stored at any Haven do not
qualify).

On chain resolution the item is stored exactly like a `store-item` action
(marshalling-point pile, initial-bearer corruption check,
`bearer-cannot-untap` cleanup), the stored entry is stamped with
`storedAtSite` = the chosen site, and the event enters play with
`attachedToStored` pointing at the stored card ("Place Wizard's Trove with
the stored card"). While the event is in play and `fullMarshallingPoints` is
set, the stored card scores its full declared storage MP — exempt from the
MEWH §4 Fallen-wizard flat-1 clamp and the MELE cross-alignment halving
("which is worth full marshalling points"). The event is discarded by a
post-reduce sweep if the stored card ever leaves the marshalling-point pile.

```json
{ "type": "storage-site-transfer",
  "siteFilter": { "effectiveSiteType": "haven" },
  "fullMarshallingPoints": true }
```

Implemented in `legal-actions/organization-events.ts` (mode actions),
`chain-reducer.ts` (`resolveStoredComboEvent`), `recompute-derived.ts`
(full-MP exemption), and `reducer-utils.ts`
(`discardOrphanedStoredAttachedEvents`).

### 21b. `play-with-stored-card`

Plays a named card from hand together with the carrying permanent event at a
site where another named card is stored (Wizard's Trove wh-85, primary mode:
"You may play The White Tree at one of your Wizardhavens [{H}] if Sapling of
the White Tree is stored there"). Offered during the controller's
organization phase when a card named `cardName` is in hand and the
marshalling-point pile holds a card named `requiresStored` whose
`storedAtSite` matches `siteFilter` (same matching context as a site
`play-target` filter). Since `storedAtSite` is only stamped by the storage
flows, the combo naturally requires the stored piece to have been stored at a
qualifying site first (for wh-85: a Sapling stored at a Wizardhaven via a
previous Wizard's Trove `storage-site-transfer`).

On chain resolution both cards enter play, mutually linked via
`linkedInstanceId` ("Place Wizard's Trove with The White Tree" — when either
is discarded the other follows). The companion:

- is stamped `mpPinned` = its printed MP when `fullMarshallingPoints` is set
  ("worth full marshalling points" — overrides the MEWH §4 clamp), and
- is stamped `textIgnored` when `ignoreCardText` is set ("Ignore the text of
  The White Tree (including the Unique keyword)"): its effects are never
  collected and its name is excluded from the in-play names list, so
  uniqueness neither blocks nor is blocked by it.

When `siteBecomesProtected` is set, an `until-cleared` `site-protected`
constraint bound to the chosen site is added for the controller ("Your
Wizardhaven [{H}] becomes protected" — the Guarded Haven wh-74 machinery),
sourced from the carrying card so it is cleared if that card leaves play.
Neither card is stamped `attachedToSite`, so the orphaned-site sweep never
discards them: the combo parks its cards at the Wizardhaven permanently.

```json
{ "type": "play-with-stored-card",
  "cardName": "The White Tree",
  "requiresStored": "Sapling of the White Tree",
  "siteFilter": { "effectiveSiteType": "haven" },
  "fullMarshallingPoints": true,
  "siteBecomesProtected": true,
  "ignoreCardText": true }
```

Implemented in `legal-actions/organization-events.ts` (mode actions) and
`chain-reducer.ts` (`resolveStoredComboEvent`); `textIgnored` is honoured in
`recompute-derived.ts` (`playerCardsInPlayDefs`).

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

### 23a. `protect-from-removal`

Resource-mode companion to a `playable-as-resource` hazard-event: played on
one of the controller's own characters (target selected by the companion
`play-target` `filter`), it protects that character from being **discarded or
returned to hand** for the rest of the turn "for any reason". Resolution
installs a turn-scoped `character-removal-protected` active constraint on the
target (`engine/removal-protection.ts`); the central `returnCharacterToHand`
and `discardCharacter` helpers (`pending-reducers.ts`) fizzle any such removal
while the constraint is active. An elimination to out-of-play (combat/corruption
death) is a distinct removal and is not blocked. The `turn` scope auto-clears at
turn end.

```json
{ "type": "protect-from-removal", "duration": "turn" }
```

Used by Tookish Blood (tw-104): the hazard mode (`call-of-home-check`) returns a
Hobbit to hand; the resource mode protects your own Hobbit from that same return
(and any discard) for the rest of the turn. Offered as a `play-short-event` by
`playShortEventActions` (`legal-actions/organization-events.ts`) and resolved in
`handlePlayShortEvent` (`reducer-events.ts`).

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
  Udûn is a permanent-event held in The Balrog's items). On a **resource
  permanent-event** the same own-play-area, attachment-aware check runs in
  `legal-actions/organization-events.ts` (`playPermanentEventActions`), ahead of
  every play-target branch, and **every** `card-in-play` condition on the card
  must hold (`findPlayConditionEffects`) — used by Oromë's Warders (wh-94),
  "Playable on Alatar if Join the Hunt is in play."

```json
{ "type": "play-condition", "requires": "card-in-play", "cardName": "Doors of Night" }
```

- `card-attached-to-site` — a site-phase permanent-event is only playable when a
  card named `cardName` is in play **attached to the active company's current
  site** (a kept, `!pendingTriggerAttack` card whose `attachedToSite` matches
  the current site, in either player's `cardsInPlay`). Checked in the
  permanent-event block of `legal-actions/site.ts`. Used by Lord and Usurper
  (ba-65): "Playable … on Invade Their Domain" (which must already sit on the
  Dwarf-hold).

```json
{ "type": "play-condition", "requires": "card-attached-to-site", "cardName": "Invade Their Domain" }
```

- `card-on-adjacent-under-deeps` — a site-phase permanent-event is only playable
  when a card named `cardName` is in play attached to an **Under-deeps site
  adjacent to the current site** (an in-play card whose `attachedToSite` names an
  `under-deeps` site whose `adjacentSites` map includes the current site's
  name — looked up in `state.cardPool`). Used by Invade Their Domain (ba-64):
  "… if … Breach the Hold is on its adjacent Under-deeps site" (The Drowning-deeps
  for the Blue Mountain Dwarf-hold, The Rusted-deeps for the Iron Hill
  Dwarf-hold).

```json
{ "type": "play-condition", "requires": "card-on-adjacent-under-deeps", "cardName": "Breach the Hold" }
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
  - `player.playsAsSauron` — `true` while the player counts as Sauron via a
    `play-as-sauron` marker in play (The Lidless Eye le-203 / Sauron ba-43).
    Used by *The Dark Power* (as-79): "Playable if you are Sauron."
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

- `supporters-in-region` — for org-phase site-target Stage permanent-events
  (`play-target` target `site`): the combined count of the player's **allies in
  play** (every `CharacterInPlay.allies` entry) plus their **unique factions in
  play** that can be played at a site in the anchor Wizardhaven's region or an
  adjacent region (`buildFactionPlayableRegions` ∩ the region + its
  `adjacentRegions`) must reach `min`. The parenthetical region restriction
  applies **only to the factions** — allies always count. Checked in
  `legal-actions/organization-events.ts` inside the site-target branch, so it is
  evaluated against the specific candidate Wizardhaven. Used by *Girdle of
  Radagast* (wh-110): "… have at least 12 SPs and 6 allies and/or unique factions
  in play (the factions must be playable at sites in the Wizardhaven's [{H}]
  region or adjacent regions)."

```json
{ "type": "play-condition", "requires": "supporters-in-region", "min": 6 }
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
  "exclude": ["ringwraith", "undead", "dragon"],
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

### 25b. `influence-modification`

An optional, cost-bearing modification the influencer may apply when attempting
to bring **this faction** into play. Each `options` entry lets the influencing
character discard one of its carried items of a given subtype in exchange for a
positive modifier to the influence check. The influencer applies at most one
option; the discard is paid whether or not the check then succeeds.

```json
{ "type": "influence-modification",
  "options": [
    { "discardItemSubtype": "major", "value": 3 },
    { "discardItemSubtype": "greater", "value": 6 }
  ] }
```

The faction-influence legal-action generator (`legal-actions/site.ts`) emits one
extra `influence-attempt` per eligible carried item — its `need` is already
lowered by the option's `value`, and it carries a `discardForBonus`
`{ itemInstanceId, value }` payload. On declare (`reducer-site.ts`
`handleInfluenceAttemptDeclare`) the named item is discarded and the modifier is
threaded onto the chain payload → `faction-influence-roll` pending kind → the
roll resolver (`resolveInfluenceAttemptRoll` adds `bonusModifier`). Used by the
Dragons "Roused" factions — Smaug Roused (le-285): "Modifications: influencer
discards a major item (+3) or a greater item (+6)."

### 25c. `cancel-manifestation-attacks`

A passive, in-play cancellation of every attack sourced from a **manifestation
of the named entity** against the controller's own companies. `manifestId`
identifies the manifestation chain (by convention the basic form's id, e.g.
`tw-90` for Smaug).

```json
{ "type": "cancel-manifestation-attacks", "manifestId": "tw-90" }
```

Consumed in `mh-steps.ts` `collectMatchingAhuntAttacks`: while the carrier's
controller is the moving/defending player, any Ahunt whose source card's
`manifestId` matches is skipped (`playerCancelsManifestationAttacks`). This
covers a "Roused" faction's own region attack against its controller and any
same-chain Ahunt an opponent has in play. Under manifestation uniqueness
(g.man.1) no other form of the entity can be simultaneously in play to generate
a site/creature attack, so the Ahunt path is the reachable attack vector. Used
by Smaug Roused (le-285): "All attacks by manifestations of Smaug against any of
your companies are canceled."

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
| `fetch-to-deck` | `{ select: 'target', from: ['sideboard','discard','deck'], to: 'deck' \| 'hand', shuffleAfter: true, filter, count }` | Smoke Rings, Longbottom Leaf, Akhôrahil Unleashed |
| `bounce-hazard-events` | `{ select: 'filter-all', from: 'attached-to-target-company', to: 'hand', toOwner: 'opponent', filter, corruptionCheck }` | Wizard Uncloaked |
| `sideboard-self-to-deck` | `{ select: 'self', from: ['sideboard'], to: 'deck', shuffleAfter: true }` | Terror Heralds Doom (ba-78) |

A `select: 'target'` fetch move may also draw from the player's own **play
deck** (`from` includes `'deck'`) — a self-tutor. When the chosen card is
searched out of the play deck, the reducer reshuffles the deck after removing
it (`handleFetchFromPile`, reducer-utils.ts); a card taken from the discard
pile is not reshuffled. Combined with `to: 'hand'` this models *Akhôrahil
Unleashed* (le-162): "take a magic card from your play deck or discard pile to
your hand (reshuffle play deck if searched)." `from: ['deck','discard']` offers
one `fetch-from-pile` per matching card in either pile — the play-deck cards
carry `source: 'deck'`, discard cards `source: 'discard-pile'`. The magic-card
filter is an `$or` over the keywords `spell` / `sorcery` / `spirit-magic` /
`shadow-magic` (the same "magic card" filter used by Indûr's end-of-turn fetch).
The play restriction "on Akhôrahil the Ringwraith (as your Ringwraith)" is a
`play-target` (`target: character`) filtered to `target.name === "Akhôrahil the
Ringwraith"` **and** `target.isRevealedAvatar` — playable only on the player's
own revealed Ringwraith avatar, never a follower.

A `select: 'self'` move with `from: ['sideboard']`, `to: 'deck'` models the
Balrog sideboard family's "You may bring this card from your sideboard into
your play deck and reshuffle during your organization phase." `locateSelf`
(reducer-move.ts) scans the sideboard for the source card. The organization
phase offers it as a dedicated `card-sideboard-to-deck` action —
`cardSideboardToDeckActions` (legal-actions/organization-sideboard.ts) emits one
per sideboard card carrying such a move; `handleCardSideboardToDeck`
(reducer-organization.ts) applies it. This is card-granted and taps nothing —
distinct from the CoE 2.II.6 avatar-tap sideboard access.

**Dual-mode "tap your Ringwraith" short-event** (Ancient Secrets ba-36). A
resource short-event may pair a `discard-in-play` move (mode 1) with a
`select: 'target'`, `from: ['sideboard']`, `to: 'deck'`, `count: N` fetch move
(mode 2), both keyed to tapping the player's own revealed avatar. The
`play-target` (`target: character`, `cost: { tap: character }`) filters to the
avatar via the new `target.isRevealedAvatar` filter field — `true` only for the
player's own revealed avatar (`findPlayerAvatar`), never a Ringwraith follower
controlled by that avatar. The emitter (`playResourceShortEventActions`,
`legal-actions/organization.ts`) offers **both** modes: one
`(tap × hazard-permanent-event)` discard action per in-play target (carrying
`discardTargetInstanceId`), and — during the organization phase only, when a
matching sideboard card exists — a `sideboard-fetch` action (carrying the avatar
to tap and no discard target). A card whose discard mode has no legal target is
still playable when the sideboard mode is available (mode 2 only). The reducer
(`handlePlayResourceShortEvent`, `reducer-events.ts`) discriminates purely by
`discardTargetInstanceId`: present → resolve the discard inline and skip the
fetch; absent → enqueue the count-N sideboard fetch sub-flow. Ancient Secrets
discards **any** hazard permanent-event (environments included, no corruption
check — contrast Marvels Told), and fetches up to two minion resources
sideboard → play deck.

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
`allies-on-target` (allies borne by the action's target character),
`hazards-on-target` (hazard permanent-events attached to the action's
target character; each routes to its owner — the opposing hazard player —
resolved from the instance-id prefix),
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
      { "enemy.race": "undead" }, { "enemy.race": "ringwraith" }
    ] } } }
]
```

### Eowyn

```json
"effects": [
  { "type": "stat-modifier", "stat": "prowess", "value": 6,
    "when": { "reason": "combat", "enemy.race": "ringwraith" } },
  { "type": "enemy-modifier", "stat": "body", "op": "halve-round-up",
    "when": { "reason": "combat", "enemy.race": "ringwraith" } }
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

**Untargeted modes.** An option may set `untargeted: true` to declare that *it*
needs no target, even though the card carries a `play-target` for its other
modes. The hazard short-event emitter then offers it exactly **once** (a
`play-hazard` action with `optionId` and no `targetCharacterId`) instead of once
per candidate, and evaluates its `when` against a card-level context —
`{ opponent: { stagePoints, stageCardCount }, inPlay }`, describing the
resource player this hazard is being played against — rather than a per-target
one. `chain-reducer.ts` dispatches untargeted options from their own branch, so
the two mode families never collide: an action with a `targetCharacterId` takes
the targeted path, one without takes the untargeted path. If *every* option on a
card is untargeted, the per-character loop is skipped entirely (no bare
option-less action is emitted).

The untargeted apply kind supported today is:

- `force-discard-stage-card` — "your opponent must discard one stage card of
  his choice." Collects every **Stage card** the opponent has in play
  (`stageCardsInPlay`, `reducer-utils.ts`: any definition with
  `alignment: "stage"`, whether it sits in `cardsInPlay`, in a bearer's `items`
  as a stage permanent-event played on a character, or in a bearer's `allies`)
  and raises a `force-discard-card` pending resolution **actored by the
  opponent**, so the choice is theirs. The discard re-derives their stage-point
  total. Fizzles with a log line when the opponent has no stage card in play.

Used by *Echoes of the Song* (wh-17): "If your opponent has more than one stage
card and 4 or more stage points, he must discard one stage card of his choice.
Alternatively, force a target character to make a corruption check. Remove this
card from the game."

```json
"effects": [
  { "type": "play-flag", "flag": "remove-from-game" },
  { "type": "play-target", "target": "character" },
  { "type": "play-option", "id": "discard-stage-card", "untargeted": true,
    "when": { "opponent.stageCardCount": { "$gt": 1 },
              "opponent.stagePoints": { "$gte": 4 } },
    "apply": { "type": "force-discard-stage-card" } },
  { "type": "play-option", "id": "corruption-check",
    "apply": { "type": "force-check", "check": "corruption" } }
]
```

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
    "exclude": ["ringwraith", "undead", "dragon"],
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

### 29. `general-influence-exempt` / `own-mp-not-counted`

Two field-less **marker** effects carried by a resource permanent-event attached
to a character (stored in the host's `items`, like `control-restriction`). Each
is read off the host by `characterBearsAttachedEffect` (`reducer-utils.ts`,
scanning `char.items` by effect type) and consumed in `recompute-derived.ts`:

- `general-influence-exempt` — the host character "does not count against general
  influence": its mind is skipped in the `generalInfluenceUsed` accumulator while
  the card is attached. Unlike a `control-restriction` `cost: 0`, it touches
  **only** general influence — the direct-influence-to-control cost and the
  opponent's influence-away threshold are unchanged.
- `own-mp-not-counted` — the host character's **own** printed character MP does
  not count (nullified in the character-scoring loop). The items and allies the
  character bears still score normally — only "its" (the character's own) MP is
  dropped.

Both markers vanish the instant the card leaves the host's `items` (any of its
discard triggers), so the character reverts to an ordinary company member with no
lifecycle to unwind. Used together by *Await the Advent of Allies* (dm-117),
alongside the `play-flag: bearer-cannot-move` movement lock and the
`bearer-wounded` / `resource-taps-or-requires-site` self-discard triggers.

```json
{ "type": "general-influence-exempt" }
{ "type": "own-mp-not-counted" }
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

#### 32a. After-attack resource window (`step: "after-attack"`)

A **resource permanent-event** may declare

```json
{ "type": "play-window", "phase": "combat", "step": "after-attack",
  "when": { "$and": [
    { "attack.source": { "$in": ["creature", "on-guard-creature"] } },
    { "enemy.race": { "$in": ["elf", "dunadan", "man"] } } ] } }
```

for card text of the form "Playable … **immediately after** his company faces a
&lt;race&gt; hazard creature". Per CoE rule 8.03 a company has "faced" an attack
once combat is initiated — even if the attack is then canceled — so the window
opens on **every** way an attack can end.

The trigger lives in `engine/post-attack-play.ts` as a prev/next diff
(`enqueuePostAttackPlayOffers`, called from `postReduce` in `reducer.ts`), the
same reactive pattern as `evil-hour` / `discard-on-card-leaves`; hooking the
`prev.combat → next.combat` transition covers strikes-resolved, canceled-on-the-
chain, and canceled-by-tap teardowns alike. The optional `when` is matched
against the ended attack's context — `{ enemy: { race }, attack: { source } }`,
the same discriminators a `cancel-attack` `when` sees, so one expression can gate
both a card's play window and the ability it grants.

The window itself is a `post-attack-play-offer` pending resolution owned by the
defending player: `play-permanent-event` (naming one offered card and a legal
bearer) plays it, `pass` declines. The play is delegated to the ordinary
`handlePlayPermanentEvent`, so it routes through the chain — the opponent keeps
their response window, the `play-target` `cost: { tap: "character" }` is paid on
resolution, and the card attaches to the chosen character. Bearer eligibility
(`play-target` character `filter`, plus untapped when a tap cost is declared) is
recomputed live by `afterAttackPlayTargets`, and a `duplication-limit` scope
`"company"` closes the window while a copy is already borne in that company.

A permanent-event carrying **any** `play-window` is now offered only in that
window: both the organization-phase emitter (`legal-actions/organization-events.ts`)
and the site-phase one (`legal-actions/site.ts`) skip permanent-events whose
`play-window.phase` is not the current phase.

Used by No News of Our Riding (le-211): "Playable on an untapped character
immediately after his company faces an Elf, Dúnadan, or Man hazard creature. Tap
the character. The character can later tap to cancel an Elf, Dúnadan, or Man
hazard creature attack against his company. Cannot be duplicated in a given
company." — the window above, a `play-target` character (`target.status:
"untapped"`, `cost: { tap: "character" }`), `duplication-limit` scope `company`
max 1, and a `cancel-attack` `cost: { tap: "bearer" }` under the identical attack
filter. A resource permanent-event played on a character attaches into that
character's `items`, so the existing in-play-item `cancel-attack` path
(`legal-actions/combat.ts` → `handleCancelAttackByInPlayItem`) provides the
"later tap to cancel" with no further engine work: the bearer must be untapped
and taps, while the card itself stays untapped and in play for later turns.

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
- `discardUniqueFactionsAtSite: boolean` — after the `move-to-mp-pile` keep,
  discard every **unique** faction in play — belonging to *either* player —
  that is playable at the company's current site to its **owner's** discard
  pile (Invade Their Domain ba-64, Lord and Usurper ba-65: "discard all unique
  factions playable at the site"). Distinct from `discardFactionsAtSite`
  (active player, all factions) and `returnFactionsAtSite` (returns unique to
  hand). No discard happens on a decline of the card.
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

The `only-creatures-keyed-to-site-at-ruins-lairs` constraint (added by *Down
Down to Goblin-town* le-181, the minion twin of Secret Passage, via the same
`on-event: self-enters-play` → `add-constraint` shape) is the **R&L-gated**
variant: the same drop of region-keyed creatures applies, but **only when** the
protected company's destination is a Ruins & Lairs [{R}]. When the company moves
anywhere else the constraint imposes nothing (`applyOnlyCreaturesKeyedToSiteAtRuinsLairs`).
It is kept distinct from `only-creatures-keyed-to-site` because that (ungated)
kind blocks region-keyed creatures at any destination (a difference enshrined by
the dm-98 test). le-181's `play-target` is a `company` filtered by
`{ "company.moving": true }` ("on a moving company") — the org-phase company
filter context exposes `company.moving` (the company has a declared destination
or special movement this org phase) alongside `company.atHaven`.

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

### 37a. `cancel-chain-attack-cancel`

Marker on a Balrog resource short-event. While a chain is active during a
**company-vs-company attack made by The Balrog's company** against an opponent
(the combat is a CvCC whose `attackingPlayerId` is the Balrog player and whose
attacking company contains The Balrog avatar), the card may be played from hand
to **target and negate** an unresolved chain entry — declared by the opponent —
that would cancel that attack (i.e. carries a `cancel-attack` effect). It is the
counter-cancel counterpart of `cancel-chain-return-to-origin` (Goldberry): a
chain-declaring response, but sourced from a discarded hand card rather than a
tapped in-play ally.

Only the CvCC **attacker** (the priority player during the chain) is offered the
action; one `counter-cancel-attack` action is emitted per (hand card, target
entry) pair. On dispatch the card is moved hand → discard, the target entry is
marked `negated: true` (so its `cancel-attack` never fires and the attack
survives), and priority flips to the opponent so they may respond.

Implementation: `legal-actions/chain.ts` `counterCancelAttackChainActions()`
emits the legal actions; `chain-reducer.ts` `handleCounterCancelAttack()` applies
them. Used by *Great Fissure* (ba-61), whose other mode is a plain
`cancel-attack` gated on `attack.atUnderDeeps`.

```json
{ "type": "cancel-chain-attack-cancel" }
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

### 40.1. `agent-attack-modifier`

Modifies how the agent's own **standard site-phase attack** (rule 2.V.iii, the
`declare-agent-attack` step) is declared and resolved. Unlike
`agent-tap-attack` (a special M/H-phase attack granted by card text), this
effect alters the normal agent-hazard attack every agent already has.

| Field             | Required | Description                                                    |
|-------------------|----------|----------------------------------------------------------------|
| `attackerAssigns` | no       | If true, the attacking player assigns strikes regardless of the agent's face-down/at-home state (overrides rule 3.ii.4, which otherwise grants attacker assignment only to a face-down agent at its home site). |
| `strikeEffect`    | no       | `"discard-item"`: a successful strike does not wound the defending character; instead the company must discard one item (defender's choice) via the `discard-item-from-company` combat phase. Detainment attacks (vs Ringwraith/Balrog defenders) tap as usual and never trigger the discard, matching the `tap-agent-at-site` precedent (dm-43). |
| `tapForExtraStrike` | no     | If true, an **untapped** agent may tap as part of declaring the attack to gain an extra strike (2 strikes instead of 1). The legal-action generator offers each declare action in two variants — with and without the tap — and the hazard player chooses; declining keeps the normal 1-strike attack and leaves the agent untapped. Tapped or wounded agents only get the plain attack. |

Implementation:

- Legal actions: `declareAgentAttackActions()` in `legal-actions/site.ts`
  duplicates each `declare-agent-attack` action with `tapForExtraStrike: true`
  when the effect carries the field and the agent is untapped.
- Reducer: `handleDeclareAgentAttack()` in `reducer-site.ts` reads the effect
  from the agent's card definition when the attack is declared, ORs
  `attackerAssigns` into the rule-3.ii.4 computation, threads `strikeEffect`
  onto the `CombatState`, and on a `tapForExtraStrike` declaration taps the
  agent and sets `strikesTotal: 2`. `forceSingleTarget` is only set for
  1-strike attacks with attacker assignment — a 2-strike attack follows the
  standard assignment rules (each strike to a different character where
  possible).
- Strike resolution: the generic `CombatState.strikeEffect === 'discard-item'`
  path in `combat-strike.ts` (shared with `tap-agent-at-site`, dm-43).

Used by *Taladhan* (dm-25): "Agent only: chooses defending characters; for
each successful strike, the company must discard one item (of defender's
choice), but the defending character is not harmed."

```json
{ "type": "agent-attack-modifier", "attackerAssigns": true, "strikeEffect": "discard-item" }
```

Used by *Elerína* (dm-7): "Agent only: may tap for an extra strike."

```json
{ "type": "agent-attack-modifier", "tapForExtraStrike": true }
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
| `siteIds` | yes | Array of site definition IDs to augment (e.g. `["tw-413", "le-392"]`). May be empty (`[]`) when `siteType` targets a whole class of site instead. |
| `siteType` | no | Augment **every** site of this printed type (e.g. `"border-hold"`), in addition to any `siteIds`. Used by *Fell Winter* (le-111): "Each Border-hold receives an additional automatic-attack." |
| `boundSite` | no | When `true`, augment the site the card was **played on** (`CardInPlay.attachedToSite`, set by the play action's `targetSiteDefinitionId`) and every other printing of that same named location — the hero / minion / Fallen-wizard / Balrog versions are distinct definitions sharing one name. Used by *Nature's Revenge* (wh-27): "All versions of the site … each gains an additional automatic-attack: Animals." |
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

### `faction-siege`

A minion resource permanent-event played on one of the controller's own
in-play **factions** (via `play-target` `target: "faction"`) that besieges a
site chosen from the controller's location deck at play time. Used by *Long
Grievous Siege* (ba-40).

| Field | Required | Description |
|-------|----------|-------------|
| `siteType` | yes | Printed type of the location-deck site to besiege (`"border-hold"`). |
| `factionInfluenceModifier` | yes | Modifier to every faction-play influence attempt at any version of the besieged site (`-5`). |
| `attack.strikes` / `attack.prowess` | yes | The additional automatic-attack every version of the besieged site gains. Its `creatureType` is **derived from the target faction's race** at collection time (`factionRaceToAttackType`, e.g. a Man faction → `"Men"`). |

```json
{ "type": "faction-siege",
  "siteType": "border-hold",
  "factionInfluenceModifier": -5,
  "attack": { "strikes": 5, "prowess": 9 } }
```

Play-time mechanics:

- **Eligibility** — one `play-permanent-event` action per (faction ×
  location-deck site) pair; the site must be of `siteType` and lie in the same
  region as a site where the target faction is playable, or a region adjacent
  thereto (`factionSiegeEligibleSites`, `reducer-utils.ts`; playability via
  `isCardPlayableAtSiteDef`, adjacency from the region cards). CRF: "There
  must be an eligible borderhold for this card to be played" — no eligible
  site, no action.
- **Resolution** (`chain-reducer.ts`) — the host enters `cardsInPlay` with
  `attachedTo` = the faction instance and `attachedToSite` = the chosen site's
  definition id; the site card moves from the `siteDeck` off to the side with
  the host (standard set-aside machinery); every in-play faction (either
  player's) playable at the site is returned to its owner's hand.

Ongoing behaviour — "any version" of the besieged site is matched by printed
site **name** (hero/minion twins use distinct definition ids):

- `factionInfluenceModifier` is summed by `siteFactionInfluenceModifier`
  (shared with `site-lock`, People Diminished ba-72) in both the
  influence-attempt legal-action `need` and the roll resolver.
- The extra automatic-attack is injected by `collectPermanentEventAttacks`
  (`manifestations.ts`) carrying `detainmentAgainstPlayer` — the attack is
  **detainment only when the defending player is the siege controller**
  ("detainment against your companies") and normal against the opponent
  (consumed at the site auto-attack detainment seams in `reducer-site.ts`).

Lifecycle: the host is exempt from the site-attached orphan sweep
(`cardKeepsBoundSitePermanent`). When the target faction leaves play the host
is discarded (`discardOrphanedFactionAttachedEvents`, wired in `postReduce`),
and the set-aside site card returns to its owner's **location deck** — the
site-card branch of `sweepSetAside` (a site card is never discarded).
"Cannot be duplicated on your faction" is `duplication-limit`
`scope: "faction"` max 1, counted per target faction instance.

### `attacker-attack-option`

Grants the controller of the carrying in-play card an **optional, per-attack**
combat modifier: for each attack whose creature race equals `creatureRace` that
their **opponent** faces, the controller (the attacking / hazard player) may
choose to apply `prowessModifier` (added to every strike) and/or make the attack
`detainment`.

The choice is offered as an `apply-attacker-attack-option` combat action in the
attacking player's Step 1 priority window (CoE rule 3.iv.1), before any of the
attack's strikes have resolved — so the modifier, once applied, affects the
whole attack. It is a genuine option: the controller may simply pass, leaving
the attack unmodified. Applying it once flags the combat
(`attackerAttackOptionApplied`) so it cannot be applied again.

| Field | Required | Meaning |
|-------|----------|---------|
| `creatureRace` | yes | Normalized (lowercase, singular) creature race the faced attack must have, e.g. `"spider"`. Matched against `combat.creatureRace`. |
| `prowessModifier` | no | Prowess added to every strike when the option is applied. |
| `detainment` | no | When `true`, applying the option makes the attack detainment. |

Implemented by `attackerAttackOptionActions` (`engine/legal-actions/combat.ts`)
and `handleApplyAttackerAttackOption` (`engine/reducer-combat.ts`).

Used by *Ungoliant's Progeny* (ba-27): "for each Spider attack your opponent
faces, you can choose for it to be at +1 prowess and detainment."

```json
{
  "type": "attacker-attack-option",
  "creatureRace": "spider",
  "prowessModifier": 1,
  "detainment": true
}
```

### `site-instance-transform`

Carried by a **kept** resource permanent-event bound to a site
(`attachedToSite`). It splits a site's effective type and automatic-attacks
between the **one instance the card is attached to** ("the associated site" —
the controller's own current site) and **every other in-play copy of the same
site definition** ("all other versions").

Unlike the generic `site-type-override` `attribute-modifier` (Hold Rebuilt and
Repaired, as-88), this effect **bypasses the MEAS §6(d) Under-deeps
type-immutability short-circuit** — it exists precisely to retype an Under-deeps
site — and it discriminates by *instance* rather than applying uniformly to every
copy. Both `getEffectiveSiteType()` (`engine/effective.ts`) and
`getActiveAutoAttacks()` (`engine/manifestations.ts`) take an optional site
**instance** id; `resolveSiteInstanceTransform()` (`engine/effective.ts`) decides
`associated` vs `other` by whether that instance is the current site of one of
the carrying card's controller's companies. The transformation is dormant while
the card is still `pendingTriggerAttack` (i.e. before its keep is confirmed). The
bound site is permanent: it is exempt from the site-attached orphan sweep and is
always returned to the owner's location deck rather than discarded (shared with
`surface-region-adjacency`).

| Field | Required | Description |
|-------|----------|-------------|
| `associated.siteType` | yes | Effective `SiteType` of the associated instance. |
| `associated.removeAllAutoAttacks` | no | When `true`, the associated instance loses all automatic-attacks. |
| `associated.removeAutoAttacksByRace` | no | When set, the associated instance loses every automatic-attack of this creature race (matched on `creatureType`). |
| `others.siteType` | yes | Effective `SiteType` of every other version. |
| `others.addAutoAttack` | no | `{ creatureType, strikes, prowess }` added to every other version. |
| `others.removeAutoAttacksByRace` | no | When set, every other version loses every automatic-attack of this creature race *before* `addAutoAttack` is applied. |
| `noFactions` | no | When `true`, no faction may be played at any version of the transformed site (checked in the `legal-actions/site.ts` faction branch). |

Used by *Roots of the Earth* (ba-74): the associated Under-deeps Ruins & Lairs
becomes a Darkhaven [{H}] that loses all automatic-attacks, while every other
version becomes a Shadow-hold [{S}] that gains an Orcs 5-strike/9-prowess
automatic-attack.

```json
{
  "type": "site-instance-transform",
  "associated": { "siteType": "haven", "removeAllAutoAttacks": true },
  "others": {
    "siteType": "shadow-hold",
    "addAutoAttack": { "creatureType": "Orcs", "strikes": 5, "prowess": 9 }
  }
}
```

Used by *Lord and Usurper* (ba-65): both the associated and the other versions
become a Shadow-hold that loses its Dwarf automatic-attacks and admits no
factions, and the other versions additionally gain an Orcs 4/7 attack:

```json
{
  "type": "site-instance-transform",
  "associated": { "siteType": "shadow-hold", "removeAutoAttacksByRace": "dwarf" },
  "others": {
    "siteType": "shadow-hold",
    "removeAutoAttacksByRace": "dwarf",
    "addAutoAttack": { "creatureType": "Orcs", "strikes": 4, "prowess": 7 }
  },
  "noFactions": true
}
```

### `conditional-mp`

Adds a fixed bonus to the carrying in-play card's own marshalling-point value
when its gate holds. Folded into the `cardsInPlay` marshalling-point tally in
`engine/recompute-derived.ts` on top of the card's printed `marshallingPoints`.
Exactly one of the two gate fields is set.

| Field | Required | Description |
|-------|----------|-------------|
| `bonus` | yes | Points added when the gate holds. |
| `requiresCardOnSameSite` | one-of | Card name that, in play on the same site, grants the bonus. |
| `requiresFactionCount` | one-of | Faction-count gate: `{ min, races, unique?, excludePlayableAtSiteType? }`. |

`requiresCardOnSameSite` (Roots of the Earth ba-74): printed 1 MP, +2 when
*Breach the Hold* is on the same site.

```json
{ "type": "conditional-mp", "bonus": 2, "requiresCardOnSameSite": "Breach the Hold" }
```

`requiresFactionCount` grants the bonus while the carrying card's controller has
at least `min` factions of one of `races` in their own `cardsInPlay`, counting
only `unique` factions when set and excluding any faction playable at a site of
`excludePlayableAtSiteType` (a named site's type is resolved from the card
pool). Used by Great Army of the North (ba-38): "If you have at least 4 unique
Orc and/or Troll factions —none playable at a Darkhold [{D}]—you receive this
card's marshalling points" (printed `marshallingPoints: 0`, so the card scores
only via this bonus).

```json
{ "type": "conditional-mp", "bonus": 2,
  "requiresFactionCount": { "min": 4, "races": ["orc", "troll"],
                            "unique": true, "excludePlayableAtSiteType": "dark-hold" } }
```

### `agent-home-site-faction-lock`

A permanent-event kept attached to an **agent character** (in `char.items`)
whose ongoing effect switches on only while the bearer is **unwounded and
standing at one of his home sites** of a type in `homeSiteTypes`. While active it:

1. Bars **every** faction play at any version of that site — matched by the
   site's printed *name*, so all in-play copies of the same site card are
   covered ("any version of that site"). Enforced in the site-phase faction
   legal-action gate (`legal-actions/site.ts`), beside the
   `site-instance-transform` `noFactions` branch (ba-65), via
   `siteFactionLockedByAgentHomeSite`.
2. Credits the carrying card's printed marshalling points to its controller
   ("you receive this card's marshalling points"). The MP is therefore
   **conditional**: the card's own printed MP is suppressed in the normal
   item-MP tally (`recompute-derived.ts`) and added back only while the lock is
   active. (No `conditional-mp` effect is needed — the printed MP stays on the
   card and is gated by the same predicate.)

When the bearer is wounded, moves off its home site, or the current site is not
of a qualifying type, the lock and its MP switch off; the card stays attached
and re-activates dynamically. It is discarded only when the bearer leaves play.

The play restriction ("Playable on an agent character at a Darkhaven who has a
Border-hold or Free-hold as a home site") is expressed with a `play-target`
`character` filter — `target.keywords` `$includes` `"agent"` AND a `$or` over
`target.homeSiteTypes` `$includes` `"border-hold"` / `"free-hold"` (the
`target.homeSiteTypes` play-target context field lists the printed site types of
the character's home sites) — plus a `play-condition` `site-type: ["haven"]`
(a minion company at a haven is at a Darkhaven).

| Field | Required | Description |
|-------|----------|-------------|
| `homeSiteTypes` | yes | Printed `SiteType`s that qualify (e.g. `["border-hold", "free-hold"]`). |

```json
{ "type": "agent-home-site-faction-lock", "homeSiteTypes": ["border-hold", "free-hold"] }
```

Used by Faithless Steward (as-83).

### `evil-hour-tap-trigger`

Marks an in-play permanent-event that **taps itself** when the controller's
opponent plays a card whose printed `marshallingPoints` meet `mpThreshold` ("Tap
this card when an opponent plays a card normally giving him three or more
marshalling points"). The tap is a passive reaction applied after every reducer
step by `applyEvilHourTaps` (`engine/evil-hour.ts`, wired into `postReduce` with
the pre-action state): it diffs the opponent's in-play scoring zones (bare
cards-in-play, characters, and their items/allies) and, when a fresh card with
printed MP ≥ `mpThreshold` entered play, taps each untapped copy of the carrying
card. Idempotent — an already-tapped copy is untouched. Pair with `play-flag:
no-auto-untap` so the card "does not untap".

| Field | Required | Description |
|-------|----------|-------------|
| `mpThreshold` | yes | Minimum printed marshalling points of the opponent's played card. |

```json
{ "type": "evil-hour-tap-trigger", "mpThreshold": 3 }
```

### `evil-hour-grant-movement`

Grants an in-play permanent-event a once-only **organization-phase** ability,
usable only while the card is **tapped**, to discard itself and mark one of the
controller's companies with a persistent conditional region-movement bonus ("If
tapped, you may discard this card during your organization phase to target a
company allowed to move with region movement"). Eligible targets are the
controller's non-empty companies that may use region movement — i.e. any company
not locked to Under-deeps-only movement by containing the Balrog avatar. The
legal action (`evilHourGrantMovementActions`, `legal-actions/organization.ts`)
offers one `discard-for-evil-hour-movement` per (tapped source × eligible
company); the reducer (`reducer-organization.ts`) discards the card and sets
`Company.evilHourMovementBonus`.

While set, the marked company may move up to `extraRegions` additional regions
when it moves **to** — or away **from** — a site currently holding an opponent's
company (`evilHourRegionBonus`, applied both at the organization-phase
plan-movement pass and the Movement/Hazard declare-path). This is the symmetric
practical reading of "if moving to a site where an opponent's company is present
— and also, thereafter, when leaving this site".

| Field | Required | Description |
|-------|----------|-------------|
| `extraRegions` | yes | Additional region distance granted (ba-48: 2). |

```json
{ "type": "evil-hour-grant-movement", "extraRegions": 2 }

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

`siteFilter.regionTypes` opens an additional **region-type** branch, OR'd with
the site-type branch: the grant matches when the moving company's resolved site
path contains a region of one of those types (Border-lands [{b}] etc.). The
optional `requiresNonCoastalKeying` restricts the grant to creatures whose own
printed `keyedTo` offers at least one non-Coastal-Sea region — "the creature
must be playable in a non-Coastal Sea [{c}] region" — excluding Coastal-Sea-only
creatures (e.g. Fell Turtle tw-34).

Used by Ungoliant's Foul Issue (ba-28): "non-unique Spider creatures can be
keyed to Under-deeps Ruins & Lairs [{R}] and Shadow-holds [{S}]."

```json
{
  "type": "grant-creature-keying",
  "creatureFilter": {
    "$and": [
      { "race": { "$in": ["spider"] } },
      { "unique": { "$ne": true } }
    ]
  },
  "siteFilter": {
    "siteTypes": ["ruins-and-lairs", "shadow-hold"],
    "siteKeywords": ["under-deeps"]
  }
}
```

Used by A Pack at the Door (tw-497): "Each non-unique Animal, Spider and Wolf
creature may be played in Border-lands [{b}], Border-holds [{B}] or Ruins &
Lairs [{R}]. The creature must be playable in a non-Coastal Sea [{c}] region."

```json
{
  "type": "grant-creature-keying",
  "creatureFilter": {
    "$and": [
      { "race": { "$in": ["animal", "spider", "wolf"] } },
      { "unique": { "$ne": true } }
    ]
  },
  "siteFilter": {
    "regionTypes": ["border"],
    "siteTypes": ["border-hold", "ruins-and-lairs"]
  },
  "requiresNonCoastalKeying": true
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
  "handCardFilter": { "cardType": "hazard-creature", "race": "man" }
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
    "filter": { "cardType": "hazard-creature", "race": "man" },
    "count": 1
  }
}
```

Used by Thrice Outnumbered (le-142) to let both players fetch a Man
hazard creature from their own discard pile at the end of each turn.

### `on-event: corruption-check-failed` + `traitor-attack`

A hazard permanent-event trigger that fires when **any** character (either
player's) fails a corruption check, regardless of the failure outcome
(discard, eliminate, Press-gang capture, or a softened `discard-ring-only`
failure). Fired from every failed-check path of the unified corruption-check
resolver (`applyTraitorTrigger` in `engine/pending-reducers.ts`).

The `traitor-attack` apply makes the failed character a "traitor": an attack
is immediately made against a character in the traitor's company.

| Field | Required | Description |
|-------|----------|-------------|
| `prowessBonus` | no | Added to the traitor's printed prowess to form the attack prowess (default 10). |
| `strikes` | no | Number of strikes (default 1). |
| `bodyCheckModifier` | no | Added to any character body-check roll the attack produces (default 0). |

Semantics:

- Firing **consumes the source card**: every in-play copy carrying the trigger
  (both players' `cardsInPlay`) is discarded on the one failed check, and
  duplicates have no extra effect (CRF erratum).
- The attack has the **traitor's race** (CRF) and no creature body.
- The character to be attacked is chosen by the player who does **not**
  control the traitor's company — the attack uses the
  attacker-chooses-defenders machinery (`assignmentPhase: 'cancel-window'` →
  `'attacker'`), with the opponent as the attacking player.
- If the traitor's company has no surviving character, the card is still
  discarded but no attack is made.
- If a combat is already active when the check fails (e.g. a Corpse-candle
  pre-defense check), the attack is queued as a `traitor-attack-queued`
  active constraint and initiated by `initiateQueuedTraitorAttack`
  (`combat-finalize.ts`) as soon as that combat ends — the CRF "chain
  immediately following" timing.

```json
{
  "type": "on-event",
  "event": "corruption-check-failed",
  "apply": {
    "type": "traitor-attack",
    "prowessBonus": 10,
    "strikes": 1,
    "bodyCheckModifier": 1
  }
}
```

Used by Traitor (tw-105).

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

### 49a. `create-site-auto-attack`

A hazard **short-event** played during the M/H phase on a company **moving to**
a site whose type is one of `siteTypes` ("Playable on a Free-hold [{F}] or
Border-hold [{B}]"). Unlike `duplicate-site-auto-attacks`, it does **not**
create an immediate M/H combat — it installs one **additional real
automatic-attack** the company faces in the *site* phase.

**Play restriction**: emitted by the M/H short-event path
(`legal-actions/movement-hazard.ts`) only when the target company has a
`destinationSite` whose `siteType` ∈ `siteTypes`.

**Resolution**: when the short-event resolves, `chain-reducer.ts` installs a
turn-scoped `extra-automatic-attack` active constraint keyed to the destination
site *instance* (which becomes the company's `currentSite` on arrival). The
constraint carries an {@link AutomaticAttack} (with `creatureType: ""` for "no
attack type" and `forceDetainment` when the effect's `attack.detainment` is set).

**Consumption**: `manifestations.ts` `getActiveAutoAttacks` appends the
constraint's attack whenever the queried site instance matches. The company
therefore faces it in the site phase as a genuine `automatic-attack` (it counts
for the enter/skip decision and for any card that references automatic-attacks),
resolved through the normal `reducer-site.ts` auto-attack flow. `forceDetainment`
forces detainment for the injected attack (which has no race/keying to derive it
from), still overridden to normal by a defender's `detainment-attacks-normal`
effect (Alatar wh-1).

| Field | Required | Description |
|-------|----------|-------------|
| `siteTypes` | yes | Destination site types the company may be moving to (e.g. `["free-hold", "border-hold"]`). |
| `attack` | yes | `{ creatureType, strikes, prowess, body?, detainment? }` — the created attack. |

```json
{ "type": "create-site-auto-attack",
  "siteTypes": ["free-hold", "border-hold"],
  "attack": { "creatureType": "", "strikes": 5, "prowess": 8, "detainment": true } }
```

Used by FEAR! FIRE! FOES! (as-29) Mode A: "An additional automatic-attack is
created at the site this turn: 5 strikes with 8 prowess (detainment, no attack
type)." (Its Mode B is a `modify-attack` from-hand — see [`modify-attack` —
played from hand](#10e-modify-attack--played-from-hand-fromhand-true).)

### 49b. `auto-attack-boost`

A hazard **short-event** played during the M/H phase on a company **moving to**
a site whose type is one of `siteTypes` ("Playable on a Free-hold [{F}] or
Border-hold [{B}]"). It boosts **one** of the target site's automatic-attacks —
the attacker's choice, modelled as the **first** attack the company faces (the
same rule Choking Shadows tw-21 uses) — by adding `prowessBonus` to its prowess
and, when `uncancelable` is set, making that attack impossible to cancel, for
this turn only.

**Play restriction**: same gate as `create-site-auto-attack` — the M/H
short-event path (`legal-actions/movement-hazard.ts`) offers it only when the
target company has a `destinationSite` whose `siteType` ∈ `siteTypes`.

**Resolution**: on chain resolution (`chain-reducer.ts`) it installs a single-use
`auto-attack-boost` active constraint against the moving company, scope
`company-site-phase`, carrying `prowessBonus`, `uncancelable`, and the
destination `siteDefinitionId`.

**Consumption**: the site auto-attack initiation (`reducer-site.ts`) finds the
first matching constraint on the company, adds `prowessBonus` to the attack's
effective prowess, sets the combat uncancelable when flagged, then removes the
constraint — so exactly one attack is affected. Pair with
`{ "type": "duplication-limit", "scope": "site", "max": 1 }` for "Cannot be
duplicated on a given site" (the per-site counter also tallies resolved
`auto-attack-boost` constraints bound to that site).

| Field | Required | Description |
|-------|----------|-------------|
| `siteTypes` | yes | Destination site types the company may be moving to (e.g. `["free-hold", "border-hold"]`). |
| `prowessBonus` | yes | Prowess added to the boosted automatic-attack. |
| `uncancelable` | yes | When `true`, the boosted attack cannot be canceled that turn. |

```json
{ "type": "auto-attack-boost",
  "siteTypes": ["free-hold", "border-hold"],
  "prowessBonus": 2,
  "uncancelable": true }
```

Used by Arouse Defenders (le-101): "This turn, the prowess of one
automatic-attack (your choice) at target site is increased by 2 and cannot be
canceled. Cannot be duplicated on a given site."

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

### 55b. `ringwraith-self-follower`

Marker effect carried by a Ringwraith avatar **card that may join another
Ringwraith's company on its own initiative**. It is the follower-side
counterpart of [`ringwraith-follower-slots`](#55a-ringwraith-follower-slots):
that effect lets a *host* Ringwraith control followers, whereas this effect
lets *this* card be played as a follower of the player's already-revealed
Ringwraith **regardless** of whether that host carries a
`ringwraith-follower-slots` effect. The card grants its own slot, so it does
not draw from the host's `count` budget.

All other follower rules are identical to the slot-enabled path (evaluated by
the same `ringwraithFollowerPlayAction` in
`legal-actions/organization-characters.ts`): the revealed Ringwraith must be at
a Darkhaven or this card's home site; the card joins that company under the
avatar's control (`controlledBy` = the avatar's instance); a `null`-mind
follower consumes no influence; and the play uses the normal
one-character-per-turn organization-phase flow.

This effect has no fields.

```json
{ "type": "ringwraith-self-follower" }
```

Used by: Ûvatha the Ringwraith (le-57) — "He may join another Ringwraith's
company during your organization phase and requires no influence to control."

---

### 55c. `magic-discard-to-deck`

Passive marker carried by a Ringwraith avatar card. While that avatar is a
player's **revealed Ringwraith** (its own avatar in play, controlled by general
influence), any *magic card* that player casts is **shuffled back into their
play deck** (and the deck reshuffled) when it would otherwise be discarded,
rather than going to the discard pile.

A "magic card" is any card whose `keywords` include `spell`, `sorcery`,
`spirit-magic`, or `shadow-magic` (`isMagicCard`, `reducer-utils.ts`). The
redirect is applied by the single helper `discardOrRecyclePlayedEvent(state,
playerIndex, card)`: for a non-magic card, or a magic card cast by a player
whose avatar lacks this flag, the card discards normally; otherwise it lands in
the play deck. The helper is wired into every point a just-played magic event
reaches the caster's discard pile — the resource short-event fall-through
(`reducer-events.ts`), the cancel-attack discard (`combat-cancel.ts`), and the
cancel-influence discard (`pending-reducers.ts`). No card instance is ever lost:
it moves to exactly one of `playDeck` / `discardPile`.

This effect has no fields.

```json
{ "type": "magic-discard-to-deck" }
```

Used by: Akhôrahil the Ringwraith (le-51) — "As your Ringwraith, when a magic
card used by him has to be discarded, return it to the play deck and reshuffle."

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

### 42a. `grant-replay-attacked-creature`

Carried by an **in-play hazard permanent-event** and grants its controller a
**once-per-turn "replay"** of a creature from their own discard pile against a
moving company. Models the second ability of Monstrosity of Diverse Shape
(ba-21): "once per turn the hazard player may use one against the hazard limit
to play a Wolf or Animal hazard creature from his discard pile. This card must
have already attacked the company this turn."

Unlike [`play-creature-from-discard`](#42-play-creature-from-discard) (a hand
short-event, hazard-limit-exempt), this replay:

- is granted by a card already **in play** (`cardsInPlay`), not from hand,
- **counts one against the hazard limit**, and
- may be used only **once per company's M/H phase** per source permanent-event.

The gate "This card must have already attacked the company this turn" is read
as *the creature being replayed* must have already attacked the target company
this M/H phase — its name appears in
`MovementHazardPhaseState.hazardsEncountered` (confirmed by the French text,
"Cette créature doit déjà avoir attaquée cette compagnie ce tour-ci"). This is
also what makes the ability temporally reachable: site automatic-attacks resolve
in the site phase, after the M/H hazard window, so the gate cannot refer to the
permanent-event's own auto-attack.

| Field | Required | Description |
|-------|----------|-------------|
| `filter` | yes | A {@link Condition} matched against each candidate creature's card definition (e.g. `{ "race": { "$in": ["wolf", "animal"] } }`). Reuses the shared condition-matcher rather than a card-specific keyword. |

```json
{ "type": "grant-replay-attacked-creature",
  "filter": { "race": { "$in": ["wolf", "animal"] } } }
```

Legal actions: during the hazard player's M/H play-hazards window,
`spawnReplayCreatureFromDiscardActions`
(`engine/legal-actions/movement-hazard.ts`) walks the hazard player's
`cardsInPlay` for permanent-events carrying this effect, and for each one (not
already used this company M/H phase, tracked in `spawnReplayUsedSources`) walks
their discard pile for `hazard-creature` cards matching `filter` whose name is
in `hazardsEncountered`, runs the standard creature keying check against the
active company, and emits one `spawn-replay-creature` action per (creature,
keying-match) pair. The chain must be null and the hazard limit not reached
(this play counts against it).

Reducer (`handleSpawnReplayCreature` in `engine/mh-hazard-play.ts`): validates
the source, the once-per-turn/limit/gate conditions, removes the chosen creature
from the discard pile, records the source in `spawnReplayUsedSources`,
increments `hazardsPlayedThisCompany`, and initiates the creature chain. After
the attack resolves, the creature is disposed by the normal `finalizeCombat`
rules.

Used by: *Monstrosity of Diverse Shape* (ba-21).

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

### 43a. `region-type-remap`

A creature-**keying** environment that reinterprets whole classes of region.
Unlike `region-keying-boost` (an additive alternative applied to one region of
the path), this is a wholesale **replacement**: every region matching a `from`
type on a company's traversed site path is treated as its `to` type. All entries
apply **simultaneously** — each region is mapped from its *printed* type, so a
table listing both `border→wilderness` and `free→border` turns
`[free, border]` into `[border, wilderness]`, never cascading a Free-domain all
the way to a Wilderness.

The optional `when` clause (evaluated against `{ inPlay }`) gates the remap
dynamically while the carrying card is in play, so it activates/deactivates as
its gating card enters or leaves play.

```json
{ "type": "region-type-remap",
  "when": { "inPlay": "Doors of Night" },
  "remap": [
    { "from": "free", "to": "border" },
    { "from": "border", "to": "wilderness" }
  ] }
```

The two creature-keying matchers — `findCreatureKeyingMatches`
(`legal-actions/movement-hazard.ts`, read path) and `checkCreatureKeying`
(`mh-hazard-play.ts`, write path) — call the shared helpers in
`engine/region-keying.ts`: `collectRegionTypeRemaps(state, inPlayNames)` scans
both players' `cardsInPlay` for the effect (applying each whose `when` gate
holds) and `applyRegionTypeRemaps(path, remaps)` transforms the effective
region-type path before matching (and before any `region-keying-boost`
variants). The underlying site path is never mutated.

Used by: *Fell Winter* (le-111) — "if Doors of Night is in play, treat all
Free-domains as Border-lands and all Border-lands as Wildernesses."

### 43b. `region-type-conversion`

A **persistent** environment effect that converts a set of *named* regions to a
region type for creature keying — the region of the site the carrying card is
bound to (`attachedToSite`) and, when `includeAdjacent` is set, every region in
that region card's `adjacentRegions`. Unlike `region-type-remap` (whole *type
classes* along a path), this replaces specific regions **by name**, so it
depends on the card being anchored to a site whose `region` names the origin.

```json
{ "type": "region-type-conversion", "to": "wilderness", "includeAdjacent": true }
```

The conversion is read live from either player's `cardsInPlay` — active for
exactly as long as the card is in play with its `attachedToSite` set.
`collectRegionTypeConversions(state)` / `applyRegionTypeConversions(pathTypes,
pathNames, conversions)` (`engine/region-keying.ts`) are consulted by both
creature-keying matchers (`checkCreatureKeying`, `findCreatureKeyingMatches`)
after the `region-type-remap` step; the underlying site path is never mutated. A
card carrying this effect is exempt from the site-attached orphan sweep
(`cardKeepsBoundSitePermanent`), so a permanent stage marshalling-point card
persists when its company leaves the anchored (Wizard)haven.

Used by: *Girdle of Radagast* (wh-110) — "The Wizardhaven's region and all
adjacent regions become Wilderness [{w}]."

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

`mindBelow` is **optional**: when absent no mind gate applies — every untapped
character matching `filter` is tapped. Used by the `company-tap-characters`
**on-guard-reveal apply** of Heedless Revelry (le-114, "Tap all untapped
non-Ringwraith, non-Wizard characters in the company"), resolved during the
**site phase** when the revealed card's chain entry resolves (`chain-reducer.ts`).
The per-character filter context there also exposes `target.cardType`.

### 44b. `company-tap-roll`

A hazard short-event effect that, on chain resolution during the M/H phase,
**rolls 2d6 for each untapped character** in the active company matching the
optional `filter`; if roll + the character's `rollModifiers` sum is strictly
greater than the character's effective mind, the character becomes tapped.
Played on the company as a whole via a `play-target` `target: "company"`.

| Field | Required | Description |
|-------|----------|-------------|
| `filter` | no | DSL condition evaluated per character against `{ target: { race, mind, name, skills, cardType } }`. Only matching untapped characters roll. |
| `rollModifiers` | no | List of `{ when, value }` entries. Each entry's `when` is evaluated against the same `{ target }` context; the values of all matching entries are added to that character's roll. |

```json
{
  "type": "company-tap-roll",
  "filter": { "target.race": { "$ne": "wizard" } },
  "rollModifiers": [
    { "when": { "target.cardType": "hero-character" }, "value": -2 }
  ]
}
```

**Resolution**: `chain-reducer.ts` finds the effect on a bare (no
`targetCharacterId`) short-event entry during the M/H phase, collects every
qualifying untapped character with its precomputed modifier, and enqueues one
`company-tap-roll` {@link PendingResolution} (`pending-reducers.ts`). The
company's controller rolls the characters one at a time (`company-tap-roll`
actions); after the last roll the source chain entry resolves and the chain
continues. With no qualifying characters the entry resolves as a no-op.

The **company** `play-target` filter context (movement-hazard legal actions)
additionally exposes `target.moving` (the company has a declared destination)
and `target.hasRingwraith` (any company character has race `ringwraith`) for
the "Playable on a non-Ringwraith company that is not moving" gate.

The card's alternative **on-guard mode** is modeled with two `on-guard-reveal`
effects (see §16): trigger `resource-play` with a `playedFilter` restricting
the reveal to item/ally plays, and trigger `influence-attempt` for faction
plays — each with an `apply` of type `company-tap-characters` (tap all matching,
no roll, no mind gate).

Used by: *Heedless Revelry* (le-114).

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

### 49a. `press-gang-capture` — hold a would-be-discarded character off to the side

Carried by a hazard permanent-event (Press-gang, ba-22). While the card is in
play, whenever a character owned by the card controller's **opponent** would
otherwise be *discarded* from play, it is intercepted: instead of reaching its
owner's discard pile it is held "off to the side" with this card.

```json
{ "type": "press-gang-capture" }
```

Behaviour (engine mechanics in `engine/press-gang.ts`):

- **Which removals.** Only removals to the **discard** pile are caught — a
  character *eliminated* to the out-of-play pile (combat death, corruption
  hard-fail) is untouched (the card says "discarded", not "eliminated").
  `findCapturingPressGang(state, ownerIndex)` locates an in-play
  `press-gang-capture` card belonging to the character owner's opponent, and
  `capturePressGang` is invoked in place of the discard at every "discard from
  play" seam: `discardCharacter` (dice-check discards), the corruption-check
  `discard` outcome, the voluntary organization-phase discard (rule 3.22), the
  combat body-check discard band, and the Abductor "discard wounded character"
  effect.
- **Capture.** The character is stripped of all possessions — items and allies go
  to its owner's discard pile, attached hazards to their owners' discards — while
  its **followers revert to general influence** rather than being discarded (CRF:
  "Followers controlled by the character placed off to the side are not
  discarded"). The bare character card stays in its owner's `characters` map in
  no company, marked with a `character-pressed` active constraint pointing back at
  the Press-gang card.
- **Scoring / lock.** A `character-pressed` character is scored like a prisoner
  (CoE 8.35): it costs 0 general influence, is worth **negative** character
  marshalling points to its owner (`recompute-derived.ts`), and never untaps or
  heals (`reducer-untap.ts`).
- **One at a time.** The card holds at most one character; capturing a second
  returns the prior one to its owner's hand.
- **Host removal.** `sweepPressGang` (a `postReduce` sweep, mirroring
  `sweepSetAside`) returns the held character to its owner's hand when the
  Press-gang card leaves play — "off to the side" is never a silent drop.

"Cannot be duplicated" is the standard `duplication-limit` scope `game` max 1.

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
Meeting (tw-188), We Have Come to Kill (le-252). Playing the event brings one
character from hand into play in an existing company under relaxed recruitment
rules.

| Field | Required | Description |
|-------|----------|-------------|
| `controlledBy` | yes | Which influence pays for the recruit: `"direct-influence"` (a character in the company with enough unused DI controls it as a follower), `"general-influence"` (the player's unused general influence), or `"either"`. |
| `siteTypes` | yes | {@link SiteType} values where the recruit may enter play (e.g. `["free-hold", "border-hold", "ruins-and-lairs"]`). |
| `filter` | no | DSL `Condition` matched against the recruit's card definition (e.g. `{ "$not": { "race": "wizard" } }` to bar Wizards). |
| `allowAgents` | no | When `true`, an **agent** may be recruited, overriding rule 2.II.2.2.5 (an agent played as a character otherwise enters play only at its home site). Alignment gating is unchanged: Wizard and Balrog players treat agent cards as hazards (1.3.W2/1.3.B2). |
| `allowRingwraithFollowers` | no | When `true`, the event is "a card or ability that allows a Ringwraith follower to be played" (rule 2.II.2.1.R4) — see below. |
| `bypassOneCharacterLimit` | no | When `true`, the play does **not** consume the one-character-per-turn slot. |

```json
{ "type": "recruit-character", "controlledBy": "either",
  "siteTypes": ["shadow-hold", "ruins-and-lairs", "border-hold"],
  "filter": { "$not": { "race": { "$in": ["ringwraith", "fallen-wizard"] } } },
  "allowAgents": true,
  "allowRingwraithFollowers": true,
  "bypassOneCharacterLimit": true }
```

Behaviour:

- **Eligibility (legal actions, `legal-actions/recruit-via-event.ts`).** For the
  active player, `recruitViaEventActions` finds in-hand events carrying this
  effect and emits one `play-character` action — carrying `viaEventInstanceId`
  (the event card) — per eligible (recruit-in-hand, company at a `siteTypes`
  site, permitted influence source) combination. Recruits failing `filter`, the
  uniqueness rule, or the g.man.1 manifestation rule are skipped, as is any
  company closed to joins (`block-company-joins`). The helper is wired into the
  organization, movement/hazard, and site phase aggregators, so the event "may
  be played on your turn during any phase the company is at a site"; it
  self-gates on a company actually being at a qualifying site.
- **Influence.** A direct-influence play emits `controlledBy` = the controlling
  character's instance (the recruit becomes their follower); a general-influence
  play emits `controlledBy: "general"` and is gated on the player's unused
  general influence (`generalInfluenceControlLimit − generalInfluenceUsed`),
  overriding rule 2.II.2.2's "only at the avatar's site" restriction exactly as
  `siteTypes` overrides the haven / home-site restriction.
- **Avatars.** Avatars (null mind) are never ordinary recruits — they enter play
  by their own reveal rules. The one exception is `allowRingwraithFollowers`: a
  **Ringwraith** avatar card in hand may be brought in as a Ringwraith follower
  of the player's revealed Ringwraith, whose company must be at a `siteTypes`
  site (in place of the usual Darkhaven / home-site condition). Per rule
  2.II.2.1.R5 the follower costs one point of the revealed Ringwraith's unused
  direct influence, unless a no-influence ability covers it — a free
  `ringwraith-follower-slots` slot on the revealed Ringwraith (The Witch-king
  le-58) or `ringwraith-self-follower` on the card played (Ûvatha le-57).
  A player who counts as Sauron (The Lidless Eye le-203 / Sauron ba-43) may
  never play Ringwraith followers.
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

The same effect also opens the **character draft** (rule 1.43 / CoE 1.9.F2,
"…and include them in your starting company"): a Fallen-wizard may draft an
Orc/Troll only once they have drafted a Stage resource whose
`allow-character-play` filter matches that candidate. Enforced in
`legal-actions/draft.ts` *and* in the `draft-pick` reducer (`reducer-setup.ts`).
The `not-starting-character` play-flag is never lifted by it ("You cannot start
with a character that says he cannot be in the starting company").

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

### 52a. `prohibit-company-events`

Carried by an in-play hazard permanent-event; suppresses **resource
permanent-events played on a company as a whole** (Fellowship tw-240, played via
`play-target: "company"` so its `CardInPlay.companyId` is set) for every company
containing a character of `companyHasRace`. It applies game-wide (either player's
companies).

| Field | Required | Description |
|-------|----------|-------------|
| `companyHasRace` | yes | Only companies containing a character of this printed `race` (e.g. `"wizard"`) are affected. |

```json
{ "type": "prohibit-company-events", "companyHasRace": "wizard" }
```

Two faces (both driven by `collectProhibitedCompanyEventRaces` in
`reducer-utils.ts`, which scans both players' `cardsInPlay`, skipping any card
still resolving a `trigger-attack-on-play` keep):

- **Discard** — `sweepProhibitedCompanyEvents` (a `postReduce` sweep in
  `reducer.ts`) discards every `companyId`-bound resource permanent-event
  (cardType `hero-resource-event`/`minion-resource-event`, `eventType:
  "permanent"`) whose bound company contains a prohibited race to its owner's
  discard pile (clearing its `activeConstraints`). Running continuously, it also
  catches a matching character joining a company that already carries such an
  event.
- **Prohibition** — `isCompanyEventPlayProhibited` stops the organization-phase
  `play-target: "company"` emitter (`legal-actions/organization-events.ts`) from
  offering such a card on a matching company.

Character-attached permanent-events (which set `attachedTo`, not `companyId`) are
untouched — matching "on the company as a whole, not individual characters."
Used by Stormcrow (td-73): "Discard all resource permanent-events that have been
played on each company with a Wizard … No such cards may be played on each
Wizard's company." — combined with two `all-characters` `direct-influence`
`stat-modifier`s (net -2, or -4 with Doors of Night), an `on-event
play-deck-exhausted` self-discard, and `duplication-limit` scope `game`.

### 52b. `company-movement-restriction`

Carried by a permanent-event **bound to a company** (`play-target`
`target: "company"`, so `CardInPlay.companyId` is set). Constrains how the bound
company may move and how many hazards it faces while region-moving. Multiple
restriction cards on one company stack: `noStarterMovement` OR-s, the region cap
takes the strictest declared maximum, and hazard modifiers sum.

| Field | Required | Description |
|-------|----------|-------------|
| `noStarterMovement` | no | When `true`, the bound company may not use starter movement. |
| `regionMovementMax` | no | Hard cap on the number of regions the company may span in region movement ("limited in all cases to N regions maximum"). |
| `hazardLimitModifier` | no | Added to the company's hazard limit **only when it moves via region movement** (negative reduces it). |
| `hazardLimitFloor` | no | Floor the hazard limit is never reduced below by `hazardLimitModifier`. |

```json
{ "type": "company-movement-restriction", "noStarterMovement": true, "regionMovementMax": 3, "hazardLimitModifier": -1, "hazardLimitFloor": 2 }
```

Behaviour (`effects/company-restrictions.ts` `companyMovementRestrictions`): the
aggregate is read at four sites — organization plan-movement
(`organization-companies.ts`, drops starter destinations and caps region
distance), M/H select-company (`mh-steps.ts`, caps `phaseState.maxRegionDistance`),
M/H declare-path (`legal-actions/movement-hazard.ts`, suppresses the starter
path), and the hazard-limit snapshot (`mh-steps.ts` `snapshotHazardLimit`, applies
the floored hazard modifier). The hazard modifier is gated on a region-moving
company (`movementType === region`), per CRF 22: "The hazard limit reduction only
works if the company is moving." Used by Going Ever Under Dark (ba-37).

### 52b-i. `company-movement-tax`

Carried by a permanent-event **bound to a company** (`CardInPlay.companyId`) that
taxes the company's *voluntary* movement and splitting during the organization
phase. Before the bound company may declare movement (`plan-movement`) or split
(`split-company`), the controlling player must first tap up to `taxTapCharacters`
of its untapped characters ("tap all of its untapped characters to a maximum of
two"). The tax is satisfied when that many have been tapped toward it this org
phase **or** the company has no untapped character left to tap. Unlike
`company-movement-restriction` (a same-player resource event), this is a *hazard*
played by the opponent onto the resource player's company, so the reader
(`effects/company-restrictions.ts` `companyMovementTax` / `isMovementTaxSatisfied`)
scans **both** players' `cardsInPlay`; the largest declared `taxTapCharacters`
wins when several are bound.

| Field | Required | Description |
|-------|----------|-------------|
| `taxTapCharacters` | yes | Maximum number of untapped characters that must be tapped before the company may move/split. |

```json
{ "type": "company-movement-tax", "taxTapCharacters": 2 }
```

Behaviour: `companyMovementTaxUnpaid` (`legal-actions/organization-companies.ts`)
gates both `planMovementActions` and `splitCompanyActions`, skipping the bound
company while unpaid; `payMovementTaxActions` (`legal-actions/organization.ts`)
offers one `pay-movement-tax` action per untapped character, and the reducer
(`reducer-organization.ts` `handlePayMovementTax`) taps the chosen character and
increments `OrganizationPhaseState.movementTaxPaid[companyId]` (reset each org
phase). Used by Enchanted Stream (as-27), paired with a `play-condition`
`requires: "site-path"` (`sitePath.wildernessCount > 0`, now enforced in the
long/permanent-event branch of `playHazardsActions`), a `grant-action`
`cancel-chain-entry` gated on `actor.skills $includes "ranger"` (a ranger in the
company may tap to cancel the card before it resolves — offered to the active
player during M/H chain declaring by `emitHazardSelfCancelBySkillActions` in
`legal-actions/chain.ts`), and an `on-event organization-phase-start`
self-discard `when: { "company.atHaven": true }` (the shared company-bound
org-phase-start sweep in `reducer-untap.ts`).

### 52c. `voluntary-discard`

Lets the controller voluntarily discard the carrying in-play permanent-event
during their own organization phase ("Discard during your organization phase if
you choose"). One `voluntary-discard-in-play` action is offered per matching
card in the organization aggregator (`legal-actions/organization.ts`
`voluntaryDiscardInPlayActions`); the reducer
(`reducer-organization.ts` `handleVoluntaryDiscardInPlay`) moves the card to the
discard pile, severing any company binding and lifting its restrictions.

| Field | Required | Description |
|-------|----------|-------------|
| `phase` | yes | The phase during which the discard may be chosen (currently `"organization"`). |

```json
{ "type": "voluntary-discard", "phase": "organization" }
```

Used by Going Ever Under Dark (ba-37).

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

### 52b-i. `grant-extra-mh-phase`

Carried by a **resource short-event** played at the end of a company's
movement/hazard phase; grants that company **one** additional movement/hazard
phase this turn (Forced March le-185, Bridge tw-202, Leg It Double Quick le-202,
Ûvatha Unleashed le-248). The company may move to an additional site: another
site card is played and a fresh movement/hazard phase immediately follows for
that company.

Optional fields gate the play window to the qualifying move:

- `requiresDestinationSiteType` — the moving company's destination must be this
  `SiteType` (e.g. `"haven"` for Forced March / Bridge, which trigger on a move
  to a Darkhaven / Haven).
- `requiresDestinationAlignment` — the destination site must carry this
  alignment (e.g. `"ringwraith"` — a Darkhaven — for Forced March). Distinguishes
  the minion "Darkhaven" card from the hero "Haven" version.

With neither field set, any moving company qualifies (Leg It Double Quick).

```json
{ "type": "grant-extra-mh-phase", "requiresDestinationSiteType": "haven", "requiresDestinationAlignment": "ringwraith" }
```

Behaviour: the card is offered during the play-hazards step by
`extraMHPhaseResourceActions` (`legal-actions/movement-hazard.ts`) only when the
active company is moving and its destination meets the requirements; it is
excluded from the generic resource-short-event path
(`heroResourceShortEventActions`). Resolving it (`handlePlayResourceShortEvent`,
`reducer-events.ts`) sets `extraMHPhasePending` on the active company. After the
company commits its move (`endCompanyMH`), `advanceAfterCompanyMH`
(`mh-hazard-play.ts`) consumes the flag and enters the dedicated
`extra-mh-move-offer` step: the active player either chooses a new destination
reachable from the current site (`extra-mh-move`, `handleExtraMHMoveOffer`
re-enters `reveal-new-site` with the per-phase state reset) or passes to finalize
the company. Unlike `extra-under-deeps-mh-phase`, the extra move is a normal
starter/region movement (not restricted to Under-deeps), grants exactly one extra
phase (a one-shot short-event, not a persistent in-play effect), and carries no
roll penalty.

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

### 52d. `surface-site-roll-zero`

Carried by a Balrog **`trigger-attack-on-play` permanent-event** played on an
Under-deeps site during the **site phase** (paired with a
`play-target: { target: "site" }` filtered by name and kept via
`afterAttack: "move-to-mp-pile"`). Used by Breach the Hold (ba-50): "The roll
required to move to the surface site is reduced to zero. This site is never
discarded or returned to its location deck."

```json
{
  "type": "surface-site-roll-zero"
}
```

Behaviour, while the card is in play bound to Under-deeps site `U`
(`CardInPlay.attachedToSite`):

- **Surface-site roll zero** — when one of the owner's companies at `U` ascends
  to `U`'s **surface site** (the single non-Under-deeps site listed in `U`'s
  `adjacentSites`), the required Under-deeps movement roll is `0` instead of the
  printed value. The reduction is added by `breachTheHoldSurfaceRoll`
  (`legal-actions/organization-companies.ts`) and consulted by
  `getUnderDeepsRequiredRoll` via the moving player (`forPlayer`), so only the
  owner's own companies benefit; a move to a *different* Under-deeps site is
  unaffected.
- **Permanence** — identical to `surface-region-adjacency` (§52c): the card is
  exempt from the site-attached orphan sweep (`discardOrphanedSiteAttachedEvents`)
  so it persists while `U` is unoccupied, and when a company leaves `U`, `U` is
  always returned to the owner's location deck rather than discarded
  (`mh-hazard-play.ts` step 8). Both this effect and `surface-region-adjacency`
  are recognised by the shared `cardKeepsBoundSitePermanent` predicate
  (`reducer-utils.ts`).

### 52d-ii. `eddy-lock`

Carried by a Balrog **site-phase permanent-event** (no trigger-attack) played on
the untapped site of the company holding The Balrog. The card attaches to the
site (`play-target: { target: "site" }`) and is gated by
`play-flag: untapped-site-required`, `play-flag: tap-site-on-play` (taps the site
on play), a `play-target` site filter excluding Under-deeps sites and their
surface sites (`$not keywords $includes under-deeps` + `isUnderDeepsSurface $ne
true`), and a `play-condition: company-context` requiring The Balrog in the
company (`company.characterNames $includes "The Balrog"`). On resolution the
`eddy-lock` handler in `chain-reducer.ts` taps The Balrog in the active company
(a play cost — the card still attaches to the site, not to the character).

```json
{
  "type": "eddy-lock",
  "taxTapCharacters": 2
}
```

Behaviour, while the card is in play bound to site `S`
(`CardInPlay.attachedToSite` = `S`'s definition id):

- **Permanence** — "This site is never discarded." Like `surface-region-adjacency`
  (§52c), the card is exempt from the site-attached orphan sweep
  (`discardOrphanedSiteAttachedEvents`) and `S` is always returned to the owner's
  location deck rather than discarded when a company leaves it. Recognised by the
  shared `cardKeepsBoundSitePermanent` predicate (`reducer-utils.ts`).
- **Never untaps for the owner** — "never untaps for you." When the Eddy owner's
  company moves to a version of the bound site definition, the destination is
  placed **tapped** rather than untapped (`mh-hazard-play.ts` step 8, gated by
  `siteEddyLock(state, destDef, movingPlayer)`). The engine never untaps a
  stationary site, so re-placement on movement is the only refresh point.
- **Two-character tax** — "Before a company can play any ally or item at any
  version of this site, it must tap two characters during the site phase." Any
  company (either player) at any version of the bound site definition must tap
  `taxTapCharacters` of its characters this site phase before it may play an ally
  or item there. `siteEddyLock` (`reducer-utils.ts`) scans both players'
  `cardsInPlay` for an `eddy-lock` card whose `attachedToSite` matches the active
  company's current site definition; `SitePhaseState.eddyTaxTapped` tracks how
  many tax characters have been tapped (reset per company); the item and ally
  play paths (`legal-actions/site.ts`) are barred while the count is below
  `taxTapCharacters`; and a `pay-site-tax` action (one per untapped company
  member) taps a character and increments the count (`reducer-site.ts`).

Used by Eddy in Fate's Tide (ba-57). "Balrog specific" is a deck-construction
keyword with no play-time gate.

### 52d-iii. `site-lock`

A generic Balrog site-domination lock — the tax-free sibling of `eddy-lock`
(§52d-ii). Carried by a **`trigger-attack-on-play`** permanent-event played on
the untapped site (`play-target: { target: "site" }`) that is *kept* in the
marshalling-point pile after its self-inflicted attacks (`afterAttack:
"move-to-mp-pile"`); the card stays bound to the site (`attachedToSite` = the
site definition id). Unlike `eddy-lock`, `site-lock` taps no character on play
(the site is tapped by the companion `play-flag: tap-site-on-play`) and levies no
per-company tax.

```json
{
  "type": "site-lock",
  "factionInfluenceModifier": -5
}
```

```json
{
  "type": "site-lock",
  "convertDetainmentVsMinion": true,
  "duplicateFirstAutoAttackVsMinion": true
}
```

Behaviour, while the card is in play bound to site `S` and no longer
`pendingTriggerAttack` (its ongoing effects are suppressed until the keep is
resolved):

- **Permanence** — "This site is never discarded." Recognised by the shared
  `cardKeepsBoundSitePermanent` predicate (`reducer-utils.ts`), exactly like
  `eddy-lock` / `surface-region-adjacency`: the card is exempt from the
  site-attached orphan sweep and `S` is always returned to the owner's location
  deck rather than discarded when a company leaves it.
- **Never untaps for the owner** — "never untaps for you." When the owner's
  company re-enters a version of the bound site definition, the destination is
  placed **tapped** rather than untapped (`mh-hazard-play.ts` step 8, gated by
  the shared `siteNeverUntapsForOwner(state, destDef, movingPlayer)` predicate,
  which recognises both `eddy-lock` and `site-lock`).
- **Faction-influence modifier** (optional `factionInfluenceModifier`) — "-N to
  each attempt against any faction at any version of this site." Summed live
  from bound in-play `site-lock` cards (either player) via
  `siteFactionInfluenceModifier(state, siteDefId)` (`reducer-utils.ts`) and
  added to the faction-influence need in the site-phase influence path
  (`legal-actions/site.ts`), alongside the turn-scoped `influence-at-site-modifier`
  constraint. A negative value raises the roll the influencer must beat.
- **Detainment → normal vs minion** (optional `convertDetainmentVsMinion`) — "All
  detainment attacks at all versions of this site against minion companies instead
  attack normally." When the company facing `S`'s automatic-attacks is a **minion**
  (Ringwraith) company and a bound copy carries this flag, the auto-attacks are
  forced non-detainment — folded into the `forcesNormalAttacks` gate in
  `reducer-site.ts` (via `siteLockAntiMinion(state, siteDefId)`), the same gate
  used by Alatar wh-1 / Awaken Defenders le-103.
- **Extra first auto-attack vs minion** (optional
  `duplicateFirstAutoAttackVsMinion`) — "Against minion companies, each version of
  this site has an additional automatic-attack: an exact copy including all
  modifications of the first automatic-attack listed on its card." After every
  printed automatic-attack (and any race/incite duplicate) is resolved, a minion
  company faces one more combat that copies `S`'s first automatic-attack; the copy
  re-resolves through `resolveAttack*`, so its runtime modifications are re-applied.
  Faced exactly once, guarded by `SitePhaseState.siteLockMinionAttackDone`
  (`handleSiteAutomaticAttacks` done-branch, `reducer-site.ts`).

Used by People Diminished (ba-72): "Playable during the site phase on an untapped
Free-hold [{F}] or Border-hold [{B}]. Tap the site. The company faces 3 attacks
(Men — 4/8, 3/10, 2/12). Following the attacks, tap a character or discard this
card. If this card is not discarded, discard all unique factions playable at the
site. -5 to each attempt against any faction at any version of this site. This
site is never discarded and never untaps for you. Cannot be duplicated on a given
site." — `play-target: site` (`siteType $in [free-hold, border-hold]`) +
`play-flag untapped-site-required` + `play-flag tap-site-on-play` +
`duplication-limit` scope site + `trigger-attack-on-play` (3× Men,
`move-to-mp-pile`, `discardUniqueFactionsAtSite`) + `site-lock`
(`factionInfluenceModifier` -5). ("Balrog specific" is a deck-construction
keyword with no play-time gate.)

Also used by No Strangers at this Time (as-51), the **hero** counterpart:
"Playable during the site phase on a Free-hold [{F}] or Border-hold [{B}] if you
have played a faction there. This site is never discarded and never untaps for
you. All detainment attacks at all versions of this site against minion companies
instead attack normally. Against minion companies, each version of this site has
an additional automatic-attack: an exact copy including all modifications of the
first automatic-attack listed on its card. Cannot be duplicated on a given site."
— it carries no `trigger-attack-on-play` and no `factionInfluenceModifier`.
Instead it is gated by `play-target: site` (`siteType $in [free-hold,
border-hold]`) + a `play-condition: company-context`
(`company.playedFactionHere` — a new `SitePhaseState.factionPlayedThisSitePhase`
flag set by `resolveInfluenceAttemptRoll` when any faction resolves at the
company's site) + `duplication-limit` scope site + `site-lock`
(`convertDetainmentVsMinion` + `duplicateFirstAutoAttackVsMinion`). The site is
already tapped by the required faction play, so there is no `tap-site-on-play` /
`untapped-site-required`.

### 52e. `balrog-surface-region-movement`

Carried by a bare Balrog **permanent-event** in the player's `cardsInPlay`. While
in play (and the card named in `suppressedByInPlay` is **not** in play), a company
containing The Balrog avatar may use **region** movement — overriding his printed
"may not use region or starter movement" lock — provided at least one endpoint
(its current site or its planned destination) is an Under-deeps **surface site**
(the roll-0 non-Under-deeps site listed in some Under-deeps site's
`adjacentSites`). Starter movement stays blocked; this is a region-only grant.

```json
{
  "type": "balrog-surface-region-movement",
  "suppressedByInPlay": "Great Shadow",
  "regionAllowanceByMp": [[8, 1], [16, 2], [24, 3], [25, 4]],
  "modifiableBy": "A More Evil Hour"
}
```

- `regionAllowanceByMp` — ascending `[maxMp, regions]` bands; the region span the
  company may move is chosen by the first band whose `maxMp` is ≥ The Balrog
  player's marshalling-point total (`totalMarshallingPoints`, the sum of all six
  MP categories). The final band applies to any higher total. For Out He Sprang:
  0–8 MPs → 1 region, 9–16 → 2, 17–24 → 3, 25+ → 4.
- This allowance **replaces** every other region-distance effect — environment
  reductions (No Way Forward), extra-region grants, etc. cannot modify it ("may
  not be modified by any other effects except A More Evil Hour"); `modifiableBy`
  records the only card permitted to adjust it (not yet ported).

The grant is computed by `balrogOutHeSprangRegionAllowance`
(`legal-actions/organization-companies.ts`) and consumed at the two
Movement/Hazard movement-legality gates: `handleSelectCompany` (`mh-steps.ts`)
fixes `MovementHazardPhaseState.maxRegionDistance` at the MP-derived allowance,
and `revealNewSiteActions` (`legal-actions/movement-hazard.ts`) lifts the region
half of the Balrog lock and caps region paths at that same allowance. Used by
Out He Sprang (ba-71).

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

Carried by an in-play permanent or long event (hazard **or** resource);
modifies companies' hazard limits by `value` while the card is in play.
It applies game-wide (to every player's companies) and is evaluated
independently for each company at the moment its hazard limit is snapshotted
(site revelation in the Movement/Hazard phase). By default only **moving**
companies count (the snapshot requires a `destinationSite`); with
`appliesTo: "all"` stationary companies are reached too.

| Field | Required | Description |
|-------|----------|-------------|
| `value` | yes | Amount added to a matching company's hazard limit (once per matching in-play card). |
| `when` | no | Condition over the per-company context gating whether `value` applies. Absent = every company. |
| `floor` | no | For a negative `value`: the limit is never reduced below this floor. A limit already at or below the floor is left unchanged (the effect never raises it). |
| `appliesTo` | no | `"moving"` (default) — moving companies only; `"all"` — stationary companies too. |

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

Behaviour (`mh-steps.ts` `snapshotHazardLimit` /
`buildCompanyHazardContext`): when a company's hazard limit is snapshotted,
both players' `cardsInPlay` are scanned for this effect; each card whose `when`
matches the company context adds `value` to the snapshot (folded in alongside the
base size limit, sideboard halving, `hazard-limit-modifier` constraints and
site-rule modifiers). Used by Eyes of the Shadow (dm-56): "The hazard limit is
increased by two for each moving company with a size of less than four that also
contains a Wizard or a non-ranger character with a mind of 6 or more." Also used
by The Great Eye (as-85): "The hazard limit against all companies is decreased
by one (to a minimum of two)" — `value: -1, floor: 2, appliesTo: "all"`, no
`when`.

### 54b. `cancel-hazard-event-play`

Marker effect on an in-play permanent or long event: while the carrying card is
in play, its controller may **discard it** during chain declaring to negate an
unresolved hazard **event** entry (short, long, or permanent event — never a
creature) declared by the opponent, before it resolves. An event revealed from
on-guard is never a legal target (its chain entry carries
`payload.fromOnGuard`), matching "cannot be used against an on-guard card".

```json
{ "type": "cancel-hazard-event-play" }
```

Behaviour: `cancelHazardEventChainActions` (`legal-actions/chain.ts`) emits one
`cancel-hazard-event` action per (in-play source, eligible target entry) pair to
the priority player during any `normal`-restriction chain.
`handleCancelHazardEvent` (`chain-reducer.ts`) discards the source card from
`cardsInPlay` to its owner's discard, marks the target entry negated, and flips
priority. The negated event's card is routed to its owner's discard by the
chain-completion flush (which skips instances already discarded at play time,
so short events are not duplicated). Used by The Great Eye (as-85).

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

### 56b-iii. `run-home-to-haven`

An **ally** ability that lets its company retreat to safety at the end of the
turn. During the controlling player's end-of-turn phase (the `discard` and
`signal-end` steps), while the ally is in a company at a **non-Haven,
non-Under-deeps** site whose character count is `maxCompanySize` or fewer and the
site's printed `nearestHaven` is known, the player may discard the ally and move
its company to that nearest Haven. Per the card errata this is considered
movement with no movement/hazard phase, so the departure site follows the
ordinary site-card lifecycle (haven/untapped → location deck, tapped → site
discard pile), exactly like Great-road's `haven-return`.

```json
{
  "type": "run-home-to-haven",
  "maxCompanySize": 3
}
```

- `maxCompanySize` — the largest company (character count) for which the option
  is offered.

`runHomeActions` (`legal-actions/end-of-turn.ts`, resource player only) emits a
`run-home` action per eligible ally; `handleRunHome` (`reducer-end-of-turn.ts`)
discards the ally and relocates the company (sharing the haven with a sibling
company when one is already there). Pair with `play-flag:
playable-at-tapped-site` when the card is also "playable even if the site is
tapped". Used by **Bill the Pony (tw-198)**: "Playable at Bree or Bag End;
playable even if the site is tapped. If at a non-Haven/non-Under-deeps site and
if his company's size is three or less, you may discard Bill the Pony at the end
of his company's turn and replace its site with the nearest Haven [{H}]."

### 56b-ii. `company-site-phase-do-nothing`

Forbids the active movement/hazard company from doing anything during its
**upcoming site phase this turn** — a `site-phase-do-nothing` constraint is added
to the target company (the same constraint `company-return-to-origin` uses to
block a returned company's site phase), but the company keeps its destination
site and its movement is unaffected (only the site phase is blocked). Carried by
a hazard short-event and applied on chain resolution
(`applyCompanySitePhaseDoNothing`, `chain-reducer.ts`).

```json
{ "type": "company-site-phase-do-nothing" }
```

Playability is expressed with a companion **`play-target: "company"` filter**.
The short-event company-target path (`legal-actions/movement-hazard.ts`) exposes,
for the active company (using its destination site if moving, else its current
site), the context:

- `target.siteType` — the site's type (`ruins-and-lairs`, `shadow-hold`, …);
- `target.siteKeywords` — the site's keywords (e.g. `under-deeps`);
- `target.characterCount` — number of characters in the company (allies excluded);
- `target.spawnInPlayCount` — Spawn cards **in play** across both players
  (`countSpawnCardsInPlay`: cards carrying the `spawn` keyword in any
  `cardsInPlay`, plus Spawn characters in companies and Spawn allies attached to
  characters — cards in a discard / elimination pile are **not** counted);
- `target.moreSpawnThanCompany` — the precomputed boolean
  `spawnInPlayCount > characterCount` (the condition-matcher's `$gt` compares a
  field to a literal, not two fields, so the comparison is precomputed here).

Used by **Darkness Made by Malice (ba-15)**: "Playable on a company at or moving
to a Ruins & Lairs [{R}] or Under-deeps site, if there are more Spawn cards in
play than characters in the company. Eliminated Spawn do not count. The company
must do nothing during its site phase this turn." — a `play-target: "company"`
whose filter is `$and[ $or[ target.siteType == ruins-and-lairs,
target.siteKeywords $includes under-deeps ], target.moreSpawnThanCompany ]`, plus
the `company-site-phase-do-nothing` effect.

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

- `filter` (optional) — a condition on the target character definition (evaluated
  via `matchesDefinition`, so `{ "race": "elf" }` matches `def.race`); absent =
  any character in play. The legal-action generator emits one action per
  eligible untapped target; the choice rides on the action's `targetCharacterId`
  and is applied on chain resolution (`applyTapCharacter`, `chain-reducer.ts`).

Used by Adûnaphel tw-2's on-tap: "When tapped, … causes any one character to tap."

`tap-character` also works as a **top-level effect on a plain short hazard-event**
(not only via `creature-alt-event`). The M/H legal-action generator
(`legal-actions/movement-hazard.ts`, short-event section) emits one `play-hazard`
action per eligible untapped, filter-matching character in the resource player's
companies (targeting any company, mirroring tw-2's "any one character"). When the
card **also** carries `on-event company-arrives-at-site` override modes (Doors-of-
Night alternatives — see §43 / `site-type-override` / `region-type-override`), the
two are mutually exclusive: a `targetCharacterId` on the play action selects the
tap mode, and `applyShortEventArrivalTrigger` skips the arrival-override modes
whenever the resolving short-event carries both a `tap-character` effect and a
`targetCharacterId`. New Moon (tw-68): "Tap one Elf character. Alternatively, if
Doors of Night is in play, treat one Free-domain as a Border-land or one Free-hold
as a Border-hold until the end of the turn."

### 56d. Persistent permanent-event mode + `cancel-deck-search`

The permanent-event mode (§56c) additionally supports `persistent: true` for
dual cards whose permanent-event form has **no tap-to-short-event conversion**
— it simply stays in play carrying passive effects (Lady of the Golden Wood
as-13):

```json
{ "type": "creature-alt-event", "mode": "permanent-event", "persistent": true }
```

`tapAltPermanentEventActions` never offers tapping a persistent one, and
`handleTapAltPermanentEvent` rejects a forged tap. The card leaves play only
via its own rules — as-13 pairs it with an `on-event: play-deck-exhausted`
self-discard `move` ("Discard when any play deck is exhausted", the same
mechanism as Safe from the Shadow / Tokens to Show, fired by
`completeDeckExhaust`).

**`cancel-deck-search`** is the passive as-13 carries in this mode:

```json
{ "type": "cancel-deck-search" }
```

While the card is in either player's `cardsInPlay`, all effects that would let
an affected player search through or look at any portion of **his own** play
deck or discard pile outside of the normal sequence of play are automatically
canceled. Enforcement is centralised in `gateDeckSearchFetch`
(`reducer-utils.ts`), called at every point that enqueues a `fetch-to-deck`
pending effect: the `deck` / `discard-pile` sources are stripped from the
fetch for such a player (a sideboard source survives — e.g. Weigh All Things
to a Nicety le-253 keeps its sideboard arm); when no source remains the fetch
fizzles entirely (e.g. Akhôrahil Unleashed le-162, Inner Cunning dm-68's agent
tutor, grant-action and org-phase fetches). The normal sequence of play
(end-of-turn draws, the deck-exhaustion reshuffle and its sideboard exchange)
is never affected.

Which players are hit is chosen by the optional **`affects`** field:

- `"minion"` (the default) — Ringwraith and Balrog players (MEBA: the Balrog
  player is a minion player). Hero and fallen-wizard players are unaffected.
  Lady of the Golden Wood (as-13).
- `"non-minion"` — Wizard and Fallen-wizard players; minion players are
  unaffected. Bane of the Ithil-stone (tw-13), whose blanket "Automatically
  cancels any effect that causes a player to search through or look at any
  portion of a play deck or a discard pile outside of the normal sequence of
  play" is narrowed by its own "This card has no effect on a minion player".
- `"all"` — every player, whatever his alignment. Flotsam and Jetsam (wh-18).

```json
{ "type": "cancel-deck-search", "affects": "non-minion" }
```

The standard `when` narrows the cancel further. It is evaluated once per
*acting* player — the one whose search is about to happen — against

- `player.alignment` — his alignment (`wizard` / `ringwraith` /
  `fallen-wizard` / `balrog`)
- `player.minion` — `true` for a Ringwraith or Balrog player
- `player.playDeckSize` — the number of cards currently in his play deck

Because the gate is re-read at every search, a player slides in and out of the
cancel as his deck runs down. Flotsam and Jetsam (wh-18) — "If a player has 15
or fewer cards in his play deck (20 or fewer if a Fallen-wizard), all effects
are automatically canceled which allow him to search through or look at any
portion of his play deck or discard pile outside of the normal sequence of
play" — is `affects: "all"` plus the two-branch threshold:

```json
{
  "type": "cancel-deck-search",
  "affects": "all",
  "when": {
    "$or": [
      { "$and": [
        { "player.alignment": { "$ne": "fallen-wizard" } },
        { "player.playDeckSize": { "$lte": 15 } }
      ] },
      { "$and": [
        { "player.alignment": "fallen-wizard" },
        { "player.playDeckSize": { "$lte": 20 } }
      ] }
    ]
  }
}
```

The card's "Manifestation of Galadriel" line is the `manifestId` chain tag
(§ manifestations): `manifestId: "tw-153"` on as-13 blocks playing the Lady —
in both modes, via `manifestationOfEntityInPlay` in the creature play path —
while Galadriel is in play, and blocks playing the character Galadriel while
the Lady sits in `cardsInPlay` (`blockingManifestationForCharacterPlay`,
which honours g.man.1's "would leave play" clause for chains like The Balrog
ba-3 / Balrog of Moria tw-12). A unique creature already in `cardsInPlay` as a
permanent-event likewise blocks a second copy's play in either mode.

### 56e. `force-check-all-in-play`

When this hazard short-event resolves — including a dual-mode creature's
tap-to-short-event conversion (§56c) — **every character in play, both
players'**, must make a check. Used by Ren the Unclean (tw-83)'s on-tap
conversion: "each character in play must make a corruption check. If you tap
Ren the Unclean, then you cannot play resources to aid your character's
corruption checks. Your characters may tap in support. The moving player makes
corruption checks first. Each player decides the order of the corruption
checks for their characters."

```json
{
  "type": "force-check-all-in-play",
  "check": "corruption",
  "declarerMayTapSupport": true,
  "declarerNoResourceAid": true
}
```

- `check` — which check each character makes (`"corruption"`).
- `modifier` (optional) — roll modifier applied to every check (default 0).
- `declarerMayTapSupport` — the declaring player's characters' checks allow
  tap-in-support: each untapped company mate may tap for +1 (the Free
  Council / CoE 7.1.1 mechanic, granted mid-game).
- `declarerNoResourceAid` — the declaring player may not play resource cards
  from hand to aid their characters' checks (activating an in-play grant is a
  *use*, not a play, and stays legal).

Resolution (`applyForceCheckAllInPlay`, `chain-reducer.ts`) enqueues one
`corruption-check` pending resolution per character in play, actor = the
character's controller, honouring the printed sequencing via three new
fields on the `corruption-check` pending kind plus one on
{@link PendingResolution} itself:

- **`blockedBy`** (on `PendingResolution`) — a scheduling gate: while any
  listed resolution ID is still queued, `topResolutionFor` skips the entry.
  The non-moving player's checks are blocked by every moving-player check ID
  ("the moving player makes corruption checks first"); entries dropped by
  scope sweeps also unblock their dependents.
- **`selectableOrder`** — the actor may resolve any of their same-source
  queued checks, not just the head: `corruptionCheckActions` offers one roll
  action per selectable sibling ("each player decides the order of the
  corruption checks for their characters"), and the apply half swaps the
  head for the sibling matching the rolled character.
- **`allowSupport`** — untapped company mates may tap for +1 each before the
  roll, via `support-corruption-check` (whose optional `targetCharacterId`
  names which queued check is being supported). Each support tap adds a
  one-shot corruption `check-modifier` constraint on the checking character,
  which the roll action re-reads and the roll resolution consumes.
- **`noResourceAid`** — suppresses reactive resource short-event plays from
  hand for this check (Halfling Strength-style boosts); in-play
  corruption-check grant activations (When I Know Anything td-166) remain
  legal.

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

The player-state context also carries `inPlayAnywhere` — the **game-wide**
in-play card-name list (`buildInPlayNames`, honouring `environment-override`), as
opposed to the controller-scoped `inPlay`. It backs "Discard this card if
&lt;named card&gt; is not in play" wordings, which do not care which player put the
named card on the table — The Will of Sauron (tw-100):

```json
{ "type": "discard-self-when",
  "condition": { "$not": { "inPlayAnywhere": "Doors of Night" } } }
```

### 62a. `retain-hazard-long-events`

Suspends the normal end-of-long-event-phase discard of hazard long-events
([2.III.3]) while the carrying card is in play, and discards every hazard
long-event in play the moment the carrier leaves. Takes no fields.

Two halves, both in `engine/retain-hazard-long-events.ts`:

- `hazardLongEventsRetained(state)` — a single-state query consulted by the
  long-event phase handler (`reducer-events.ts`) before it sweeps the hazard
  player's long-events. A retainer in **either** player's `cardsInPlay` counts
  (the effect is game-wide); `pendingTriggerAttack` and set-aside cards do not.
  While one is in play the sweep is skipped and hazard long-events accumulate
  across turns.
- `sweepRetainedHazardLongEvents(prev, next)` — a `postReduce` prev/next diff
  (the reactive-diff pattern of `discard-on-card-leaves-play`) that fires when
  the **last** retainer just left play, discarding every `hazard-event` with
  `eventType: "long"` from both players' `cardsInPlay`. Being a diff, it fires
  however the retainer left: its own `discard-self-when`, deck exhaustion,
  cancellation. It runs after the single-state sweeps in `postReduce`, so a
  retainer discarded by `sweepDiscardSelfWhen` in the same step is already gone
  from the state being compared.

```json
{ "type": "retain-hazard-long-events" }
```

Used by The Will of Sauron (tw-100): "All hazard long-events remain in play until
this card is discarded. … When this card is discarded, all hazard long events are
discarded."

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

### 64. `left-behind-split` (Left Behind)

A hazard **short-event** the attacking (hazard) player plays *during a combat* on
a non-Wizard character whose company is facing an attack of `minStrikes` or more
strikes. "Following the attack" the targeted character **splits off into a
separate company** that has the same site path as the company he was in; that
company faces its own (separate) movement/hazard phase this turn with a **hazard
limit of one**, after which the character **may rejoin** his original company.

| Field | Required | Description |
|-------|----------|-------------|
| `minStrikes` | yes | The attack must deliver at least this many strikes for the card to be playable (five for Left Behind). |

```json
{ "type": "left-behind-split", "minStrikes": 5 }
```

Paired with a `play-target` `target: 'character'` (`{ "target.race": { "$ne":
"wizard" } }`). The full flow:

- **Playability / offer** — `leftBehindActions` (`legal-actions/combat.ts`)
  offers the attacking player one `play-hazard` per non-Wizard member of the
  defending company, in the attacker's Step-1 window of the `resolve-strike`
  sub-phase, only while the attack's strike count (`strikesPerAttack ??
  strikesTotal`) is ≥ `minStrikes` and the company's hazard limit has room (rule
  8.12). Only the attacking player sees the offer.
- **Play** — `handleLeftBehindPlay` (`combat-hazard-play.ts`) discards the card,
  counts it against the hazard limit, and schedules a {@link PostAttackEffect}
  with `leftBehindSplit: true` on the targeted character.
- **Split** — at combat finalization `applyLeftBehindSplit` (`combat-finalize.ts`)
  peels the character into a new `leftBehind` {@link Company} carrying the same
  `currentSite` / `destinationSite` / `movementPath` ("same site path"),
  `siteCardOwned: false`, and `leftBehindOriginCompanyId` set to the original
  company. If the character was **alone**, his own company is instead flagged
  `leftBehindExtraPhasePending` for one extra (separate) M/H phase.
- **Separate M/H phase, limit 1** — the new company is created *unhandled*, so
  the M/H loop's `select-company` naturally gives it its own phase;
  `enterSetHazardLimitAndAutoAdvance` (`mh-steps.ts`) forces a `leftBehind`
  company's hazard-limit snapshot to 1. The lone-character extra phase is granted
  by `advanceAfterCompanyMH` (re-running the flagged company once).
- **Rejoin** — at the M/H→Site transition, `enqueueLeftBehindRejoins`
  (`mh-hazard-play.ts`) enqueues a `left-behind-rejoin` pending resolution for
  each `leftBehind` company still at the same site as its original company; the
  player either merges (`left-behind-rejoin`) or declines (`pass`). To keep the
  "may rejoin" optional, `autoMergeNonHavenCompanies` skips `leftBehind`
  companies.

Used by: *Left Behind* (td-41).

### 65. `cvcc-attack-permission` (Prone to Violence)

An in-play permanent-event that grants an **extra** Company-vs-Company-combat
(CvCC) attack permission *beyond* the default alignment matrix
(`canAttackAlignment`, CoE rule 8.41). While any in-play permanent-event on
either player's `cardsInPlay` carries this effect, a CvCC attack the matrix would
otherwise forbid is allowed when the effect's optional `when` condition matches
the attacker→defender pair.

| Field | Required | Description |
|-------|----------|-------------|
| `type` | yes | `"cvcc-attack-permission"` |
| `when` | no | Condition matched against the CvCC attack context. Omitting it permits every CvCC attack while the card is in play. |

The `when` context describes both companies:

```jsonc
{
  "attacker": { "alignment": "ringwraith", "isMinion": true, "hasRingwraith": false },
  "defender": { "alignment": "ringwraith", "isMinion": true, "hasRingwraith": false }
}
```

- `alignment` — the owning player's engine alignment (`"wizard"` / `"ringwraith"`
  / `"fallen-wizard"` / `"balrog"`).
- `isMinion` — `true` for the two minion player alignments (Ringwraith and
  Balrog).
- `hasRingwraith` — `true` when any character in that company has the Ringwraith
  race (a Ringwraith avatar or a Ringwraith follower).

Collected by `cvccAttackPermitted` (`reducer-utils.ts`) and consulted at all
three CvCC-declaration gates: the legal-action generator
(`declareCompanyAttackActions`), the reducer's declare-step transition
(`hasCvCCAttackTargets`), and the declare-attack validator
(`handleDeclareCompanyAttack`).

Used by **Prone to Violence** (ba-42): "Any minion company without a Ringwraith
may attack another minion company without a Ringwraith. The attacking company
may contain The Balrog." — expressed as a single `cvcc-attack-permission` whose
`when` requires both companies to be `isMinion` with `hasRingwraith: false` (the
Balrog attacker is covered by `isMinion`). The card's remaining text reuses
shipped primitives: `duplication-limit` (scope `game`, max 1) for "Cannot be
duplicated", and `on-event: play-deck-exhausted` → `move` self to `discard` for
"Discard when any play deck is exhausted".

### 66. `site-storm-devastation`

A Balrog CvCC resource short-event (Crowned with Storm, ba-54) that devastates
**everyone at the site** — both companies participating in the
company-vs-company combat. When it resolves (during the combat, via the same
CvCC action windows as `combat-discard-opponent-item`), it applies, in this
fixed order:

1. **Discard all no-body allies** at the site — any ally whose effective body is
   `0`/absent (Great Bats as-74, Regiment of Black Crows as-76, Goldberry
   tw-245, Nenseldë td-142). Each goes to its owner's discard pile.
2. **Tap** every untapped ally and every untapped character *with a mind stat*.
   Avatars (Balrog/Wizard/Ringwraith — printed mind `null`) are left untapped;
   all other untapped characters and all remaining untapped allies are tapped.
3. **Roll** for each character whose mind is `< characterMindBelow` and each ally
   normally worth `< allyMpBelow` marshalling points (the ally card's printed
   MP). The Balrog's controller rolls 2d6 per target; on `roll - 1 > body` the
   target is **wounded**, or **eliminated** if already wounded. Each roll is a
   separate explicit action.

```json
{ "type": "site-storm-devastation", "characterMindBelow": 8, "allyMpBelow": 3 }
```

| Field | Required | Description |
|-------|----------|-------------|
| `characterMindBelow` | yes | Characters with a mind stat strictly below this are rolled against. |
| `allyMpBelow` | yes | Allies whose printed MP is strictly below this are rolled against. |

The tap (step 2) is applied at play time before the rolls are enqueued; because
tapping only ever affects untapped cards and the roll outcome does not depend on
status, the observable end-state is identical to applying it after the rolls
(and an already-wounded target is never re-tapped).

**Roll mechanic.** Each roll is enqueued as a generic `dice-check`
(`comparison: 'gt'`, `threshold = body`, a constant `-1` modifier, so the pass
condition is `roll - 1 > body`) with `requireTargetPresent: true` and a
`wound-or-eliminate` onPass verb. `wound-or-eliminate` is roller-agnostic — it
locates the target's actual owner (the roller controls only one of the two
companies) and acts on a character (`targetCharacterId`) or ally
(`targetInstanceId`): not-yet-wounded → status `inverted` (a wound);
already-wounded (`inverted`) → eliminated (a character to its owner's out-of-play
pile, an ally to its owner's discard pile). If a target has already left play
when its roll comes up (e.g. an ally discarded when its host was eliminated by an
earlier roll), the roll is skipped.

**Playability** is gated by the `site-storm-devastation` legal-action emitter
(`legal-actions/combat.ts`): the combat must be CvCC, the Balrog's controller
must own one of the two companies with The Balrog in it, that company's current
site must **not** carry the `under-deeps` keyword, and the opposing company must
contain a Wizard (a character of race `wizard`). Offered to whichever side The
Balrog is on.

Implemented in `reducer-events.ts` (`handlePlayResourceShortEvent` — discard /
tap / enqueue rolls), `pending-reducers.ts` (`applyDiceCheckBranch` —
`wound-or-eliminate`), and `legal-actions/combat.ts` (`siteStormAtSiteActions`,
wired into the CvCC combat action windows). Used by *Crowned with Storm* (ba-54).

### 67. `roll-untap-site` + `skip-next-untap-on-play`

A pair of on-play effects on a resource permanent-event played on a character at
a site during the site phase. Used by **Fireworks** (dm-130): "Ritual. Playable
on an untapped sage at a tapped Border-hold [{B}] or Free-hold [{F}]. Tap sage.
Make a roll and add the mind of the sage (+10 if a Wizard) — if the result is
greater than 12, the site untaps. The next time the sage would otherwise become
untapped make him tapped instead and discard this card."

```json
{ "type": "roll-untap-site", "threshold": 12, "wizardBonus": 10 },
{ "type": "skip-next-untap-on-play" }
```

**`roll-untap-site`** — when the card enters play (`resolvePermanentEvent`,
`chain-reducer.ts`) on the target character, a generic `dice-check` is enqueued:
the card player rolls 2d6, adds the target character's **effective mind**
(`effectiveStats.mind`, falling back to the printed mind — a Wizard's printed
mind is `null` → `0`), plus `wizardBonus` when the character's race is `wizard`.
If the modified total is strictly greater than `threshold`, the onPass verb
`untap-site` untaps the site the character's company currently occupies (new
branch in `applyDiceCheckBranch`, `pending-reducers.ts`, locating the company by
the target character). The roll surfaces as its own explicit `resolve-dice-check`
action.

| Field | Required | Description |
|-------|----------|-------------|
| `threshold` | yes | The modified 2d6 total must be strictly greater than this to untap the site. |
| `wizardBonus` | yes | Bonus added to the roll when the target character is a Wizard. |

**`skip-next-untap-on-play`** — a marker installed on play that adds a one-shot
`skip-next-untap` active constraint on the target character (the same constraint
kind Fled into Darkness ba-18 uses). The next time the character would otherwise
untap he stays tapped once, then `performUntap` (`reducer-untap.ts`) removes the
constraint and discards the source card. `performUntap`'s discard sweep was
generalized to find the source card whether it sits in the owner's `cardsInPlay`
(ba-18) or attached to a character's `items` (a resource permanent-event,
dm-130). The sage is tapped as the play cost (`play-flag: tap-character-on-play`)
so the constraint holds him tapped for one extra untap before discarding.

Playability rides the existing site-phase permanent-event path (`legal-actions/
site.ts`): `play-target character` (sage skill + untapped status), `play-target
site` (siteType Border-hold/Free-hold), and `play-flag: tapped-site-only`.

### 22. Radagast Shapeshifter primitives

A cluster introduced for the Shapeshifter family (Master of Shapes wh-112,
Shifter of Hues wh-115, Winged Change-master wh-116) — permanent-events placed
on Radagast via `play-target` `{ "target.name": "Radagast" }`. A permanent-event
played on a character is stored in that character's `items`, so these primitives
all read that array.

#### `stat-modifier` `op: "set"`

An **absolute override** of the printed base, applied before every `add` and
`multiply` modifier so ordinary bonuses stack on the adopted value. Last `set`
wins. This is how "in addition to adopting the given attributes" is modelled:
the form's printed attribute line replaces Radagast's own.

```json
{ "type": "stat-modifier", "stat": "prowess", "op": "set", "value": 6 }
```

The reading is forced by the data rather than chosen: Winged Change-master
prints prowess 3 against Radagast's printed 6, and Shifter of Hues prints direct
influence 3 against his printed 5 — a delta cannot lower a stat from a positive
attribute line.

For `stat: "general-influence"` (a player-level pool, not a per-character stat)
the override is recorded as `PlayerState.generalInfluenceOverride` and
substituted by `effectiveGeneralInfluence` for the Fallen-wizard avatar's
printed white-hand number, with `generalInfluenceBonus` still added on top.

A printed `corruption -N` in the attribute box is ordinary corruption **points**
— the same meaning it carries on every other card (Bow of Alatar wh-90's
`corruption 1` is 1 CP); the Shapeshifter forms are just the only ones printing
a negative one:

```json
{ "type": "stat-modifier", "stat": "corruption-points", "value": -2 }
```

#### `override-skills`

**Replaces** the bearer's printed skills — the counterpart to the additive
`grant-skill`. "Radagast's skills become Warrior/Diplomat" strips his printed
Scout and Ranger:

```json
{ "type": "override-skills", "skills": ["warrior", "diplomat"] }
```

Both primitives compose in `getEffectiveSkills(state, char, charDef)`
(`effects/resolver.ts`), which every engine consumer asks instead of spreading
`charDef.skills` by hand. Skills granted by other cards still stack on top of an
override: the override speaks for the character card, not for other cards.

#### `play-flag: "bearer-cannot-move"`

Character-level immobility ("Radagast may not move") — every other movement
restriction in the engine is company-scoped. A company is stationary while it
contains such a character (`companyHasImmobileCharacter`, checked at both
movement-planning sites); splitting the other characters off is the intended
escape hatch.

```json
{ "type": "play-flag", "flag": "bearer-cannot-move" }
```

#### `play-flag: "bearer-cannot-use-items"`

The card-driven form of the Ringwraith/Balrog avatar item bans: every effect
sourced from an item on the bearer is dropped and structural
`prowessModifier`/`bodyModifier` skipped, while borne items' **corruption points
still apply** — the "may bear, but may not use" wording of MEWH §9 / rule 9.20
(unlike the Balrog ban, which also suppresses CP).

```json
{ "type": "play-flag", "flag": "bearer-cannot-use-items" }
```

#### `return-to-hand` `replaced-by-keyword`

With `replacedByKeyword`, the card returns to its owner's **hand** (never the
discard pile) when a later card carrying that keyword is placed on the same
character — "Return this card to your hand when you play another Shapeshifter
card". Both the card and its replacement must declare the keyword.

```json
{ "type": "return-to-hand",
  "during": ["organization", "replaced-by-keyword"],
  "replacedByKeyword": "shapeshifter" }
```

Swept in `postReduce` by `sweepKeywordReplaced` (`engine/keyword-replaced.ts`):
array order in `char.items` is arrival order, so the most recently placed
carrier stays and every earlier one that declares the trigger goes to hand. The
`organization` trigger (an optional `return-attached-to-hand` action) covers
attached permanent-events as well as allies.

#### Lasting company check-modifier + `next-organization-phase` scope

"Radagast can tap [to] give +2 to the corruption checks of the characters in one
company through your next organization phase (this company must be moving with
at least one Wilderness [{w}] in their site path)":

```json
{ "type": "grant-action",
  "action": "shifter-of-hues-corruption-aid",
  "cost": { "tap": "bearer" },
  "targets": { "scope": "player-companies", "movingThroughRegionType": "wilderness" },
  "apply": {
    "type": "add-constraint",
    "constraint": "check-modifier",
    "check": "corruption",
    "value": 2,
    "lasting": true,
    "scope": "next-organization-phase",
    "target": "action-target-company"
  } }
```

- **`targets.movingThroughRegionType`** narrows a `player-companies` enumeration
  to companies that have declared movement whose destination's printed site path
  crosses that region type. Movement is planned during the organization phase,
  so the destination is already known when the ability is offered.
- **`lasting: true`** makes the resulting `check-modifier` constraint apply to
  every matching check without being consumed by the first one (the default is
  the one-shot "add +N to *one* check" behaviour).
- **`scope: "next-organization-phase"`** stamps the current turn number at
  creation. The `organization-phase-end` boundary — raised when the owner leaves
  their organization phase — drops the constraint only once it sees a strictly
  greater turn number, so the phase it was created in does not expire it while
  the player's next one does.
- **`constraintWhen`** on a company-targeted corruption `check-modifier` narrows
  which of the company's characters benefit, evaluated against a
  `{ target: { cardType, race, name } }` context. Ren the Ringwraith (le-56)
  carries `{ "target.cardType": "minion-character" }` for its "by minions"
  clause; Shifter of Hues omits it, aiding "the characters in one company"
  wholesale.

### 68. `site-phase-start-attack` + `company-movement-roll` (Siege)

The two ongoing rules of a card that **besieges a site**: a card in play bound
to a site location (`CardInPlay.attachedToSite`, established by
`play-target: { target: "site" }`) that punishes every company standing there.
Both effects are read off the bound card by `siteStartOfPhaseAttacks` /
`siteMovementRolls` (`reducer-utils.ts`), which scan **both** players'
`cardsInPlay` for a non-`pendingTriggerAttack` card whose `attachedToSite`
matches the queried site definition.

#### `site-phase-start-attack`

The company faces the given attack **at the beginning of its site phase** —
before the enter-or-skip decision, so doing nothing at the site does not avoid
it. This is what distinguishes it from a site automatic-attack (avoidable by
skipping the site) and from `permanent-event-auto-attack` (which augments the
printed attack list of a whole class of sites).

| Field | Required | Description |
|-------|----------|-------------|
| `attack.creatureType` | yes | Creature type, normalized to a race for combat. |
| `attack.strikes` | yes | Number of strikes. |
| `attack.prowess` | yes | Strike prowess. |
| `attack.body` | no | Creature body (omit for "no body", i.e. auto-defeated on a win). |

```json
{ "type": "site-phase-start-attack",
  "attack": { "creatureType": "Orcs", "strikes": 3, "prowess": 7 } }
```

Behaviour: `handleSiteSelectCompany` (`reducer-site.ts`) collects the sieges on
the selected company's current site and, when any exist, enters the new
`siege-attacks` site sub-step instead of `enter-or-skip`, initiating the first
attack. `handleSiteSiegeAttacks` sequences the rest one per `pass` (mirroring
`automatic-attacks` / `troll-purse-attacks`) and hands control to
`enter-or-skip` when all are faced; a company wiped out mid-sequence finishes
its slot through `finishDissolvedCompanySlot`. The combat carries a
`siege-attack` {@link AttackSource} and is deliberately **not** an
automatic-attack: `detainment` is false, no auto-attack prowess/duplicate
constraint applies, and the home-site tap-to-cancel option is not offered.
Global race-keyed attack modifiers still resolve through `resolveAttack*`.
Combat finalization disposes of nothing — the besieging card stays in play
until its bound site leaves play.

#### `company-movement-roll`

At the **end of the controller's organization phase** each of that player's
companies standing at the besieged site rolls to keep its movement.

| Field | Required | Description |
|-------|----------|-------------|
| `threshold` | yes | The company may move when the modified 2d6 total is ≥ this. |
| `penaltyPerCharacterWithoutSkill` | yes | Skill a character must have to avoid the penalty. |
| `penalty` | no | Roll penalty per character lacking the skill (default 1). |

```json
{ "type": "company-movement-roll", "threshold": 5,
  "penaltyPerCharacterWithoutSkill": "scout", "penalty": 1 }
```

Behaviour: `handleOrganizationPass` (`reducer-organization.ts`) enqueues one
generic `dice-check` resolution per besieged company after the phase transition,
scoped to the following long-event phase — pending resolutions outrank phase
actions, so the rolls are resolved before anything else can happen. The penalty
is a `constant` modifier computed at enqueue from `getEffectiveSkills` (company
membership cannot change in between). Failing the check runs the new
`lock-company-movement` `dice-check` verb (`pending-reducers.ts`), which uses
the extracted `clearPlannedMovement` helper to drop the company's declared
destination (returning the site card to its location deck) and installs a
turn-scoped `company-cannot-move` constraint — the same constraint Hide in Dark
Places (le-192) uses, so a fresh declaration is barred too. The verb reads the
company from the new `dice-check` field `targetCompanyId`.

Used by Siege (tw-87): "Playable on a Border-hold [{B}] or Free-hold [{F}] site.
A company at this site must face an Orc attack of three strikes at 7 prowess at
the beginning of its site phase. At the end of its organization phase, a company
at a site with Siege on it must make a roll and subtract one from the result for
every non-scout character it contains. If this result is less than 5, the
company may not move this turn. Discard when the site card is discarded or when
the site card is returned to the location deck. Cannot be duplicated on a given
site." The discard clause is the shared site-attached orphan sweep
(`discardOrphanedSiteAttachedEvents`), which now also counts a company's
declared `destinationSite` as occupying that site location — otherwise a
site-targeting hazard played during the M/H phase would be swept before the
company it targets ever arrives.

### 68. `site-entry-roll-attack` (Doubled Vigilance)

Carried by a hazard **permanent-event** attached to a site (via
`play-target: { target: "site" }`). It gates *entering* the bound site behind a
dice roll: when a company chooses to enter, its controller rolls 2d6 and — with
`subtractCompanySize` — subtracts the company's effective size (CoE 3.24, so
Hobbits and Orc scouts count as half). If the modified total beats `threshold`
(per `comparison`) the company enters as normal; otherwise it faces `attack`
**before** any of the site's automatic-attacks.

| Field | Required | Description |
|-------|----------|-------------|
| `threshold` | yes | The number the modified roll must beat. |
| `comparison` | no | `"gt"` (default) or `"gte"`. |
| `subtractCompanySize` | no | Subtract the entering company's effective size from the roll. |
| `attack` | yes | `{ creatureType, strikes, prowess, body? }` — the attack faced on a failed roll. |

```json
{
  "type": "site-entry-roll-attack",
  "subtractCompanySize": true,
  "threshold": 6,
  "comparison": "gt",
  "attack": { "creatureType": "Orcs", "strikes": 4, "prowess": 9 }
}
```

Behaviour:

- **The gate** (`reducer-site.ts` `advanceThroughSiteEntryGates`): every step
  that would hand the company on to the site's attack sequence — the
  `enter-or-skip` → `enter-site` transition and the close of
  `reveal-on-guard-attacks` — first looks for a host bound to the company's
  current site (`attachedToSite`, either player's `cardsInPlay`) that this
  company has not yet rolled against. When one is found, the site step parks at
  the new `site-entry-attack` sub-step, the step it was heading for is recorded
  in `SitePhaseState.siteEntryReturnStep`, and the host is appended to
  `SitePhaseState.siteEntryGatesFaced` so each copy fires exactly once per
  company site phase (both fields are cleared when a new company is selected).
- **The roll** is a generic `dice-check` pending resolution owned by the
  company's controller, with the company size as a negative `constant` modifier.
  Its `onFail` is the `site-entry-attack` triggered action.
- **The attack** (`pending-reducers.ts` `applyDiceCheckBranch` →
  `buildSiteEntryAttackCombat`): a combat with `attackSource`
  `{ type: "site-entry-attack", eventInstanceId }`. It is *not* an
  automatic-attack — it carries no site keying, so automatic-attack modifiers
  and the §3.II site-type detainment branch do not apply; detainment is still
  derived from the attacking race, the defender's alignment/covert status, and
  the site's own `combat-detainment` rules. Because the site step is parked at
  `site-entry-attack`, the combat resolves ahead of every automatic-attack.
- **Continuing**: once neither the roll nor its combat is outstanding, the
  active player passes; a further unfired gate at the site opens next, otherwise
  the company continues to `siteEntryReturnStep`.
- **On-guard reveal** (`legal-actions/site.ts`): an event carrying this effect
  is revealable in the `reveal-on-guard-attacks` window (CoE 2.V.i.1 — adding an
  attack counts as affecting the site's automatic-attacks; the CRF confirms
  Doubled Vigilance "can be revealed on-guard"). The reveal is only offered when
  the card's `play-target` site filter matches the company's site, and the
  revealed permanent event enters play with `attachedToSite` set, exactly as a
  hand-played copy would.
- **Discard when the site leaves play** needs no effect: the generic
  `discardOrphanedSiteAttachedEvents` sweep discards every `attachedToSite` card
  once no company occupies the bound site.

A `play-target` `target: "site"` filter is evaluated against
`sitePlayTargetContext` (`recompute-derived.ts`): the site definition's own
fields at the top level plus `environment.doorsOfNightInPlay`, so the common
"…or on X if Doors of Night is in play" alternative is expressible directly:

```json
{
  "type": "play-target",
  "target": "site",
  "filter": {
    "$or": [
      { "siteType": "shadow-hold" },
      {
        "$and": [
          { "environment.doorsOfNightInPlay": true },
          { "siteType": { "$in": ["ruins-and-lairs", "border-hold"] } }
        ]
      }
    ]
  }
}
```

Used by Doubled Vigilance (dm-51): "Playable on a Shadow-hold [{S}] (or on a
Ruins & Lairs [{R}] or Border-hold [{B}] if Doors of Night is in play). If the
company chooses to enter the site, its player must make a roll and subtract its
company size. If the result is greater than 6, the company may enter the site as
normal. Otherwise, the company must face an attack to be resolved before any
automatic-attacks: Orcs — 4 strikes at 9 prowess. Discard when the site card is
discarded or returned to its location deck. Can be revealed on-guard."

### 68. `opposed-roll` (No More Nonsense)

An **opposed roll**: two characters each make a 2d6 roll, a stat is added to
each total, and the totals are compared. The *challenger* is the card's
`play-target`; the *opponent* is a second character chosen when the card is
played. The two rolls are made one at a time through an `opposed-roll`
{@link PendingResolution}, so each is a distinct, modifiable game event rather
than a hidden pair of RNG draws — and so a test can pin each roll separately.

| Field | Required | Description |
|-------|----------|-------------|
| `opponent` | yes | How the second roller is picked. `"chosen-company-member"` — the playing player selects any **other** character in the challenger's company at play time. |
| `addStat` | yes | `"prowess" \| "body" \| "mind"` — added to each side's 2d6 total (effective, not printed). |
| `comparison` | no | `"gt"` (default, "is greater than") or `"gte"` (ties go to the challenger). |
| `onWin` | no | Ordered list of {@link OpposedRollOutcome}s applied when the challenger wins. |
| `onLose` | no | Ordered list applied when the challenger does not win. |

**Outcomes** (`OpposedRollOutcome`) each name the roller they act on via
`on: "challenger" | "opponent"`:

| `type` | Fields | Effect |
|--------|--------|--------|
| `discard-attached` | `on`, `filter?` | Routes every attached hazard matching `filter` to its **owner's** discard pile (reuses the `move` primitive's `hazards-on-target` locator, so ownership routing matches *The Sun Unveiled* as-56). |
| `stat-modifier` | `on`, `stat`, `value` | Installs an `until-cleared` `character-stat-modifier` constraint flagged `requiresSourceBorne`, so the modifier lasts exactly as long as the source card stays attached to that character. |

```json
{ "type": "opposed-roll",
  "opponent": "chosen-company-member",
  "addStat": "prowess",
  "comparison": "gt",
  "onWin": [
    { "type": "discard-attached", "on": "opponent",
      "filter": { "$and": [ { "cardType": "hazard-event" }, { "eventType": "permanent" } ] } },
    { "type": "stat-modifier", "on": "challenger", "stat": "direct-influence", "value": 2 }
  ],
  "onLose": [
    { "type": "stat-modifier", "on": "challenger", "stat": "direct-influence", "value": -2 }
  ] }
```

**Playability**: the organization-phase permanent-event emitter
(`legal-actions/organization-events.ts`) crosses each `play-target` candidate
with every *other* character in its company, emitting one `play-permanent-event`
action per pair with the second roller in `opposedCharacterId`. A leader with no
company mate offers no play at all.

**Resolution**: `chain-reducer.ts` enqueues the `opposed-roll` resolution when
the card enters play. The controller dispatches one `opposed-roll` action for
the challenger (its total is stored on the requeued resolution), then one for the
opponent; the second roll compares the totals and applies the branch
(`pending-reducers.ts`). A roller who has left play in the meantime forfeits the
contest — it is dropped with no outcome.

Used by: *No More Nonsense* (le-210).

### 69. `play-condition` `requires: "phase"`

Restricts a card to the phase(s) its text names. A permanent resource-event is
otherwise offered in the organization phase, the movement/hazard phase (rule
2.1.1) **and** the site phase; a card reading "Playable … during the
organization phase" declares the window explicitly.

| Field | Required | Description |
|-------|----------|-------------|
| `phases` | yes | Phase strings the card may be played in (e.g. `["organization"]`). |

```json
{ "type": "play-condition", "requires": "phase", "phases": ["organization"] }
```

Checked by `playPermanentEventActions` (`legal-actions/organization-events.ts`,
which also serves the M/H phase) against `state.phaseState.phase`, and by the
site-phase permanent-event branch in `legal-actions/site.ts`.

Used by: *No More Nonsense* (le-210).
