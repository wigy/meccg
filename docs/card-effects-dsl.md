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

Cross-card fetch-filter keywords — tags with no behavior of their own, existing
solely so a `fetch-to-deck`/`enqueue-pending-fetch` `filter` on one card can
find another card across the whole pool by a property its printed text calls
out (`matchesDefinition` matches `Condition`s against any definition field,
but has no substring/text search, so cards needing to be found this way carry
an explicit tag):

- `"environment"` — the card is a hazard environment card. Used by "discard a
  non-environment permanent/long-event" fetch filters (e.g. Marvels Told
  td-134).
- `"palantir"` — the card is a Palantír item. Used by "any Palantír in play"
  checks (e.g. Palantír of Osgiliath's ability to duplicate any other
  Palantír).
- `"sage-only"` — the card's printed text begins "Sage only" (a play
  restriction to a Sage character or company). Tagged on every such resource
  item/event across TW/LE/TD/WH so `enqueue-pending-fetch` filters like
  `{ "keywords": { "$includes": "sage-only" } }` can find them — used by
  Palantír of Amon Sûl (tw-296), borrowing Palantír of Annúminas' "search …
  for a 'sage only' card."

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

Stats: `prowess`, `body`, `direct-influence`, `corruption-points`, `strikes`, `general-influence`, `mind`, `untap-penalty`.

A `when` condition sees `bearer.skills` — the bearer's *effective* skills,
printed plus every item/effect grant, including the modifier's own card (see
`grant-skill` §54). A card that both grants a skill and conditions a bonus on
already having it must instead read `bearer.naturalSkills` (printed skills
only) to implement the "already a *X*" convention — see §54's "Same
convention for `stat-modifier`" note.

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

The `untap-penalty` stat is not a printed attribute but the prowess penalty the
bearer suffers when he chooses **not** to tap to face a strike (CoE rule
3.iv.3: base 3, base 1 for The Balrog avatar via his own card text). It is
resolved only by `computeStayUntappedPenalty` (`recompute-derived.ts`) — which
feeds both the reducer's strike resolution (`combat-strike.ts`, creature and
CvCC paths) and the tap/untap "need" shown by the legal-action computer
(`legal-actions/combat.ts`) — and is never folded into `effectiveStats`. The
resolved penalty is floored at 0, so cancelling it yields full prowess while
staying untapped, never a bonus. Example — Thong of Fire (as-132), "if bearer
chooses not to tap against a strike, he receives no prowess penalty":

```json
{ "type": "stat-modifier", "stat": "untap-penalty", "op": "set", "value": 0,
  "when": { "bearer.skills": { "$includes": "warrior" } } }
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

`"all-attacks"` also covers **agent hazard attacks** (rule 2.V.iii): an agent
attacks as a member of its own race, so a race-keyed modifier reaches it exactly
as it reaches a hazard creature — e.g. *Chill Them with Fear* (le-106) boosts a
Dwarf agent's attack. The attack-stat context exposes `attack.isAgentAttack`
(`true` only for an agent attack, absent otherwise) so a card whose text covers
only creature attacks can opt out with
`when: { "attack.isAgentAttack": { "$ne": true } }` — used by *Rank upon Rank*
(dm-80, "All **non-agent** Man attacks…") and *Sun* (tw-335, "the prowess of each
automatic-attack and hazard creature…").

The context also exposes `attack.isAutomaticAttack` (`true` only for a site
automatic-attack — including its dynamic variants, tidings-queued and
duplicated attacks — absent otherwise), the counterpart flag for cards that
name only **hazard creatures** and explicitly exclude automatic-attacks (and
agents): `when: { "$and": [ { "attack.isAutomaticAttack": { "$ne": true } },
{ "attack.isAgentAttack": { "$ne": true } } ] }` — used by *Clouds* (tw-22,
"the prowess of each hazard creature is modified by +2"), gated on
`{ "inPlay": "Doors of Night" }`. A creature card played as a site's dynamic
auto-attack is *not* flagged automatic — it is still fundamentally a hazard
creature, so Clouds' bonus reaches it. This flag is scoped to the
`all-attacks`/`all-automatic-attacks` stat-modifier context — the
similarly-named `attack.isAutomaticAttack` built for `on-event:
attack-defeated` and `attack.automatic` built for `modify-attack` both count a
played auto-attack as automatic instead, a deliberate difference for those
triggers.

For automatic-attacks the resolution context also exposes `site.siteType` — the
defending company's effective current-site type — so a global modifier can gate
on the site type it applies at, e.g. `when: { "site.siteType": { "$in": ["free-hold",
"border-hold"] } }` (Awaken Defenders le-103 / Awaken Denizens / Awaken Minions:
"strikes … at a Free-hold / Ruins & Lairs / Shadow-hold … doubled"). Both
`resolveAttackStrikes` and `resolveAttackProwess` thread the site type in, so
the same gate works on either stat.

**`activeWhileStored: true` — an "if stored" ongoing effect.** A card *stored*
in its controller's marshalling-point pile has left `cardsInPlay`, where
`collectGlobalEffects` normally looks. Marking a modifier `activeWhileStored`
inverts that: it is skipped while the card sits in play and collected instead
from the stored-card scan (a `killPile` entry carrying `storedAtSite` — the
marker that separates a stored card from a defeated creature). Used by Pass the
Doors of Dol Guldur (dm-154): "**If stored**, all automatic-attacks at all
Dark-holds [{D}] and all Shadow-holds [{S}] are with one less prowess and one
less strike (to a minimum of one)" — the "minimum of one" is the ordinary `min`
floor:

```json
{ "type": "stat-modifier", "stat": "prowess", "target": "all-automatic-attacks",
  "value": -1, "min": 1, "activeWhileStored": true,
  "when": { "site.siteType": { "$in": ["dark-hold", "shadow-hold"] } } }
```

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
- `"all-attacks"` — applies to every automatic-attack and hazard creature.
  For `stat: "body"`, `resolveAttackBody` (`engine/effects/resolver.ts`) treats
  a bodyless attack (printed body `null`) specially: ordinary additive/
  multiplicative modifiers have nothing to add to and are skipped, but an
  `op: "set"` modifier gives the attack a *default* body instead — the only
  way an `all-attacks` effect can turn a bodyless attack into one with a body
  check. Once a body value exists (either printed or defaulted this way),
  further `all-attacks` modifiers apply normally. Used by Helms of Iron
  (dm-64): "All Orc, Troll, and Man attacks with body have their body
  modified by +1; and all Orc, Troll, and Man attacks with no body have 4
  body" — a plain `+1` (`op` absent) for the first clause plus a `op: "set",
  "value": 4` for the second, both gated on the same
  `{ "enemy.race": { "$in": ["orc", "troll", "man"] } }`:

  ```json
  { "type": "stat-modifier", "stat": "body", "value": 1, "target": "all-attacks",
    "when": { "enemy.race": { "$in": ["orc", "troll", "man"] } } }
  { "type": "stat-modifier", "stat": "body", "op": "set", "value": 4, "target": "all-attacks",
    "when": { "enemy.race": { "$in": ["orc", "troll", "man"] } } }
  ```

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

A third, simpler player-scoped variant keys on the acting company's size
instead of a Wizardhaven: `maxCompanySize` grants `allowTappedSite` to any
company whose `companyEffectiveSize` (CoE 3.24 half-Hobbit/Orc-scout rounding)
is at most the given value, at **any** site. Unlike the other two variants it
never relaxes *which* allies are playable (no `filter`-driven bypass of
`playableAt`) — it only lifts the untapped-site requirement. Found via
`findCompanySizeAllyPlayGrant` (`reducer-utils.ts`) and applied in
`legal-actions/site.ts` alongside the other `allyAllowsTappedSite` sources.
Used by Friend of Secret Things (wh-109): "Your companies with a company size
of 2 or less may play allies at tapped sites."

```json
{ "type": "grant-ally-play", "maxCompanySize": 2, "allowTappedSite": true }
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

Symmetrically, a one-shot faction-influence booster may change the **fate of
the influencer's controller on success**: `onSuccess: "draw-card"` on the
`add-constraint check-modifier` apply is carried onto the constraint, and when
the consuming faction-influence roll succeeds, the influencer's controller
draws one card from the top of their play deck (`drawCardsExhausting`, the
same exhaust-and-reshuffle helper used by `draw-cards`) before the
`successful-influence-attempt` triggers fire. Used by the Muster shape (a
skill-filtered `play-target`, not `target.isInfluencing`) by Lordly Presence
(tw-267): "Diplomat only. +5 to an influence check against a faction. If the
influence check is successful, draw a card."

```json
{ "type": "play-target", "target": "character",
  "filter": { "target.skills": { "$includes": "diplomat" } } },
{ "type": "play-option", "id": "lordly-presence-boost",
  "when": { "player.hasFactionInHand": true },
  "apply": { "type": "add-constraint", "constraint": "check-modifier", "check": "influence",
             "value": 5, "scope": "until-cleared", "onSuccess": "draw-card" } }
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

**Where a `direct-influence` modifier is counted.** Every influence path starts
from the influencer's `effectiveStats.directInfluence` (computed with no target
in context) and then folds in the *target-conditional* modifiers on top. The
split is decided by what the effect's `when` reads: a condition mentioning
`reason`, `target.*` or `faction.*` is a per-check bonus and is folded in by the
influence path; a modifier with no `when`, or one gated only on its bearer, is
already inside the effective stat and is **not** folded again
(`checkConditionalEffects`, `engine/effects/resolver.ts`). So write a
target-specific bonus with an explicit `reason` (as above), and write a flat or
bearer-scaled modifier without one — e.g. Power Relinquished to Artifice
(wh-28), whose `-1` scales off `bearer.race` / `bearer.stagePoints` and applies
once, everywhere direct influence is used.

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

### `reveal-opponent-hand` + `discard-target-corruption-card` + `player.inPlayNames` (Palantír of Amon Sûl tw-296)

`{ "type": "reveal-opponent-hand" }` is a `grant-action` apply (type-only
marker) that reveals **every** card currently in the opponent's hand to the
activating player via `revealInstances` — the cards stay in the opponent's
hand, only visibility changes. Unlike `peek-opponent-hand` (a random subset,
paid by discarding a hand card), this is the whole hand with no extra cost
beyond the granting card's own tap. Used for "look at your opponent's hand".

`{ "type": "discard-target-corruption-card" }` is a `grant-action` apply that
discards the `hazard-corruption` card named by `activate-granted-action.targetCardId`
from whichever of the activating player's own characters bears it, to that
corruption card's owner's discard pile. Its candidates come from a
`targets: { scope: "own-hazard-corruption-cards" }` descriptor — see below.

**`targets.scope: "own-hazard-corruption-cards"`** scans every one of the
activating player's own characters (all companies, not just the bearer's) for
attached `hazard-corruption` cards. Unlike every other `targets` scope,
`filter` here is matched against the **bearer character's** definition
(e.g. `race`), not the corruption card's own — corruption cards carry almost
no distinguishing data, so filtering by who they're attached to is what cards
actually need ("remove one corruption card from an Elf or a Wizard under your
control").

**`targets.scope: "company-hazard-corruption-cards"`** (Athelas tw-195) is the
company-scoped counterpart: it scans only characters in the *bearer's own
company* for attached `hazard-corruption` cards, backing "remove a corruption
card from a character in his company" (narrower than `own-hazard-corruption-cards`'s
"any character under your control"). Pairs with the same
`discard-target-corruption-card` apply.

```json
{ "type": "grant-action", "action": "athelas-remove-corruption",
  "when": { "bearer.name": "Aragorn II" },
  "cost": { "tap": "bearer", "discard": "self" },
  "targets": { "scope": "company-hazard-corruption-cards" },
  "apply": { "type": "discard-target-corruption-card" } }
```

**`player.inPlayNames`** is a grant-action `when`-context field (alongside
`bearer`/`company`/`site`/`phase`) listing the names of every card the
activating player has in play — their `cardsInPlay` **plus** items borne by
their characters (`buildPlayerItemNamesInPlay`, broader than
`buildControllerInPlayNames`/`controller.inPlay`, which intentionally covers
only bare `cardsInPlay`). It lets a grant-action gate on one specific *other*
named card being in play — including an item like a second Palantír — distinct
from the global `inPlay` context (which merges both players).

```json
{ "type": "grant-action", "action": "amon-sul-peek-hand",
  "cost": { "tap": "self" },
  "when": { "bearer.canUsePalantir": true },
  "apply": { "type": "sequence", "apps": [
    { "type": "reveal-opponent-hand" },
    { "type": "enqueue-corruption-check" }
  ] } },
{ "type": "grant-action", "action": "amon-sul-use-elostirion",
  "cost": { "tap": "self" },
  "when": { "$and": [
    { "bearer.canUsePalantir": true },
    { "bearer.skills": { "$includes": "sage" } },
    { "player.inPlayNames": { "$includes": "Palantír of Elostirion" } }
  ] },
  "targets": { "scope": "own-hazard-corruption-cards",
               "filter": { "race": { "$in": ["elf", "wizard"] } } },
  "apply": { "type": "sequence", "apps": [
    { "type": "discard-target-corruption-card" },
    { "type": "enqueue-corruption-check" }
  ] } }
```

Palantír of Amon Sûl "tap it to use the abilities of either the Palantír of
Annúminas or the Palantír of Elostirion if either one is in play" is modeled
as **borrowed abilities**: each borrowed ability is its own `grant-action` on
Amon Sûl itself (not a lookup into the other card's own `effects`), gated by
`player.inPlayNames` naming the specific Palantír. The borrowed ability's own
extra requirement ("if the bearer is a sage") evaluates against **Amon Sûl's**
bearer — the character actually performing the action — since "with its
bearer able to use a Palantír" in Amon Sûl's own text already scopes the whole
ability to Amon Sûl's bearer before the borrowing clause is reached. The
Annúminas-flavored ability ("search … for a 'sage only' card") reuses
`enqueue-pending-fetch` with `filter: { "keywords": { "$includes": "sage-only" } }`
— see [Keywords](#keywords): every card whose text begins "Sage only" carries
that tag precisely so cross-card fetch filters like this one can find it.

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

### 3b. `fw-mp-full`

Fallen-wizard marshalling-point exemption (MEWH §4 exception). MEWH §4
normally clamps every non-stage card a Fallen-wizard controls to a flat **1**
marshalling point — including his characters, which normally score their
printed character MP. A card carrying this effect exempts a subset of the
player's cards from that clamp, so they score their full printed MP instead.
`cards` selects the kind the exemption reaches — `"characters"`, `"items"`, or
`"allies"` — and the optional `filter` is matched against each such card's
definition (via `matchesDefinition`); omit `filter` to exempt every card of
the kind. Cards that do not match remain clamped to 1. Collected once per
player from the player's in-play characters, `cardsInPlay`, **and the cards
attached to those characters** — a stage permanent-event played "on the
avatar" lives in the avatar's `items` rather than in `cardsInPlay` (Oromë's
Warders wh-94) — then consumed in `recompute-derived.ts`
(`cardExemptFromFwClamp` at each of the three scoring loops); full-MP takes
precedence over any `fw-character-ally-mp` cap and never applies to stage
cards or non-Fallen-wizards.

The optional `inAvatarCompany: true` restricts the exemption to cards borne by
characters in the same company as the player's revealed avatar ("your … items
in Alatar's company"); omit it for a player-wide exemption.

Uses: Saruman (wh-9) — "Your non-weapon/non-armor/non-shield/non-helmet items
are each worth full marshalling points." (`cards: "items"`, player-wide). The
Fallen-wizard Gandalf (wh-4) — "Your characters and hero allies are each worth
full marshalling points." (an unfiltered `cards: "characters"` entry plus a
`cards: "allies"` entry filtered to `hero-resource-ally`). Radagast (wh-8) —
hero allies player-wide. Join the Hunt (wh-93) — weapon/armor/shield/helmet
items and prowess-bearing allies, both `inAvatarCompany`; Oromë's Warders
(wh-94) repeats both player-wide.

```json
{ "type": "fw-mp-full", "cards": "items",
  "filter": { "$not": { "$or": [
    { "keywords": { "$includes": "weapon" } },
    { "keywords": { "$includes": "armor" } },
    { "keywords": { "$includes": "shield" } },
    { "keywords": { "$includes": "helmet" } } ] } } }
{ "type": "fw-mp-full", "cards": "characters" }
{ "type": "fw-mp-full", "cards": "allies",
  "filter": { "prowess": { "$exists": true } },
  "inAvatarCompany": true }
```

### 3b-i. `fw-mp-none`

The mirror of `fw-mp-full`: a card carrying this marker gives its
controller **no** marshalling points at all while that controller is a
Fallen-wizard, and no other card can restore them. `deniesFallenWizardMp`
(`recompute-derived.ts`) is consulted **before** every other MP rule — the
Await-the-Onset pin, `noncharacter-mp-override`, the MEWH §4 clamp and its
`fw-mp-full` exemptions, and the global `in-play-item-modifier` MP delta —
so the denial is absolute. Players of any other alignment score the card
normally. The effect takes no fields.

Used by the minion Palantír of Elostirion (le-332) and the Palantír of Orthanc
pair (tw-300 / le-334): "This item does not give MPs to a Fallen-wizard
regardless of other cards in play."

```json
{ "type": "fw-mp-none" }
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

### 6d-bis. `new-hand`

Carried by a resource short-event. On chain resolution (the play is declared
on the chain of effects per CoE 9.4/9.5, like `draw-cards`), shuffles the
playing player's entire hand and discard pile into their play deck, then draws
a fresh hand of `handSize` cards from the top. Site cards are structurally
unaffected — they live in the separate `siteDeck`/`siteDiscardPile` zones,
never in the play-deck discard pile — so "site cards remain in the discard
pile" needs no filter. Drawing stops at deck exhaustion (no card instance is
conjured or lost), and the card-driven reshuffle does not count as a rule-1.31
deck exhaustion (`deckExhaustionCount` is untouched). The spent event card rode
on the chain entry, so it is never swept into the deck; it lands in the discard
pile after the shuffle — pair with `play-flag: "remove-from-game"` (§15e-bis)
when the text also removes the card from the game. Resolved in `resolveEntry`
(`chain-reducer.ts`); play routed through the chain by
`handlePlayResourceShortEvent` (`reducer-events.ts`).

```json
{ "type": "new-hand", "handSize": 8 }
```

Used by Favor of the Valar (tw-239): "Playable during your organization phase.
Shuffle your hand and your discard pile into your play deck (site cards remain
in the discard pile). Draw a new hand of 8 cards. Remove Favor of the Valar
from the game." — with `play-window` phase `organization` and `play-flag:
"remove-from-game"`.

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

### 6g-bis. `peek-shuffle-deck-top`

Carried by a resource short-event. When the event is played the card-player
looks at the opponent's hand and then picks **one** play deck whose top `count`
cards they look at and shuffle back on top:

1. If `revealOpponentHand` is set, every card in the opponent's hand is recorded
   in `GameState.revealedInstances` — the cards stay in the opponent's hand,
   exactly as the `peek-opponent-hand` grant-action apply does for The Lidless
   Eye (le-203). This is a "may" with no cost or downside to the playing player,
   so the engine always takes it.
2. A `choose-peek-deck` pending resolution is enqueued (actor = the playing
   player), so the deck is chosen **after** the hand has been seen — the
   ordering the card text prescribes. The player answers with a
   `choose-peek-deck` action naming `'self'` or `'opponent'`, or declines with
   `pass` ("You **may** … choose to look at …"). Only decks allowed by
   `deckChoice` **and** holding at least one card are offered; when neither deck
   qualifies, no resolution is enqueued at all (the deck step fizzles, the hand
   look still happened). An in-play `cancel-deck-search` (Bane of the
   Ithil-stone tw-13 against a non-minion, Lady of the Golden Wood as-13 against
   a minion) additionally withholds the actor's **own** deck — those cards cover
   "any portion of *his* play deck", never the opponent's — enforced by the
   shared `deckSearchCancellerFor` helper at enqueue, legal-action, and reduce
   time.
3. On resolution the top `min(count, deckSize)` cards of the chosen deck are
   shuffled among themselves and returned to the top; cards beneath never move.

The deck look itself is deliberately **not** recorded in `revealedInstances`:
that map is public to both players, so recording it would show the peeked cards
to the player who may not see them. This matches the certified Palantír of Minas
Tirith (tw-299 / le-333), which models "look at the top five cards …; shuffle
these 5 cards and return them to the top" as the `shuffle-deck-top` alone.

The event card itself is discarded on play (before the choice resolves). The
resolution lives in `legal-actions/pending.ts` (`choosePeekDeckActions`) and
`pending-reducers.ts` (`applyChoosePeekDeckResolution`); the reveal + enqueue is
in `reducer-events.ts` (`handlePlayResourceShortEvent`).

```json
{ "type": "peek-shuffle-deck-top", "count": 5,
  "revealOpponentHand": true, "deckChoice": "any" }
```

`deckChoice` is `"any"` (default — either player's, "any one play deck"),
`"self"`, or `"opponent"`.

Used by Mirror of Galadriel (tw-282): "Only playable if any of your characters
are at Lórien. You may look at your opponent's hand and then choose to look at
the top five cards of any one play deck. Shuffle those 5 cards and return them
to the top of their play deck." The play gate is a `play-condition`
`player-state` on `player.characterSiteNames` (see §23).

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

### 6i-bis. `opponent-choose-tap-or-roll`

Carried by a **hazard** short-event playable on an untapped character (a
`play-target` `target: "character"` sibling effect). When the event resolves
un-negated on the chain, the character's **controller** (the defending
player — "your opponent" from the card-player's perspective) is forced to
choose one of three responses via a two-stage {@link PendingResolution}:

1. `tap-or-roll-choice` — offered to the defender: tap the targeted
   character; tap one **untapped** ally the character controls (one action
   per eligible ally, the option omitted entirely when none is untapped); or
   let the card-player roll. The choice is mandatory (no pass — "Your
   opponent may either...").
2. Picking **roll** enqueues a follow-up generic `dice-check` resolution
   (roller = the card-player): 2d6, `comparison: "gt"`, `threshold` = the
   character's effective mind + `rollAddend`, `onPass: { "type":
   "discard-character" }`. Tapping the character or an ally resolves
   immediately with no roll.

`rollAddend` is the only field — the three responses themselves are fixed
(this mirrors `reveal-deck-choose-penalty`'s precedent of a card-specific
pending-resolution shape rather than a fully generic N-way choice DSL).

```json
{ "type": "play-target", "target": "character",
  "filter": { "$and": [
    { "target.status": "untapped" },
    { "target.race": { "$ne": "wizard" } },
    { "target.race": { "$ne": "ringwraith" } } ] } }
{ "type": "opponent-choose-tap-or-roll", "rollAddend": 6 }
```

**Implementation**: `chain-reducer.ts` `resolveEntry` detects the effect on a
character-targeted short-event chain entry and enqueues `tap-or-roll-choice`
(actor = the character's controller) without marking the entry resolved —
mirroring `call-of-home-check`. `legal-actions/pending.ts`
`tapOrRollChoiceActions` offers the three `choose-tap-or-roll` actions.
`pending-reducers.ts` `applyTapOrRollChoiceResolution` resolves
tap-character/tap-ally immediately (tapping the target and marking the chain
entry resolved via the same `'target-character'` match `dice-check`'s
`chain-entry` continuation uses) or, for `roll`, enqueues the `dice-check`
described above. The `discard-character` `dice-check` branch verb
(`applyDiceCheckBranch` in `pending-reducers.ts`) is owner-agnostic (locates
the target's actual controller rather than assuming the roller is the
owner), matching `eliminate-character`/`return-character-to-hand` — needed
here because the roller (card-player) is not the target's controller.

The hazard character-targeting play-target filter context
(`legal-actions/movement-hazard.ts`, "Character-targeting short events"
block) additionally exposes `target.status`, so a hazard short-event can gate
on "playable on an **untapped** character" the same way a resource-side
`play-target` does.

Used by *A Lie in Your Eyes* (as-23): "Playable on an untapped
non-Ringwraith, non-Wizard character. Your opponent may either: tap the
character, tap an ally the character controls, or choose for you to make a
roll. If the result is greater than the character's mind plus 6, the
character is discarded (along with all non-follower cards he controls)."

### 6i-ter. `reveal-deck-choose-set-aside`

Carried by a **hazard permanent-event** (typically paired with a `play-flag`
`playable-as-resource` alt-mode and a `play-condition` `active-player-deck-size`
gate — see §24 above). Once the host card itself enters play (the normal
permanent-event placement into `cardsInPlay`, unaffected by this effect), it
reveals the top `count` cards of `GameState.activePlayer`'s play deck (see the
`active-player-deck-size` doc above for why `activePlayer` is always the
correct target regardless of hazard-mode vs. resource self-cast mode):

1. The reveal count is capped by the deck length; an empty deck fizzles with
   no further effect.
2. Revealed cards are recorded in `GameState.revealedInstances`. Each is
   checked against `itemFilter` (a card-definition condition, e.g. non-special
   non-hoard items via `{ "$and": [{ "cardType": { "$in": [...] } },
   { "$not": { "subtype": { "$in": ["special", "hoard"] } } }] }`).
3. If at least one revealed card is eligible, a `great-secrets-choose-item`
   pending resolution is enqueued (actor = the deck owner — **not** the
   card-player): they **must** choose one (`choose-set-aside-item`, no pass).
   The chosen card is placed "off to the side" under the host via
   `placeCardSetAside` (§module `engine/set-aside`); the remaining revealed
   cards are shuffled and returned to the top of the deck.
4. If no revealed card is eligible, the reveal itself already showed the cards
   to both players — nothing more happens beyond shuffling every revealed card
   back to the top of the deck (no pending resolution).

The reveal + immediate fizzle path lives in `chain-reducer.ts` (`resolveEntry`,
right after the generic permanent-event placement); the choice resolves via
`legal-actions/pending.ts` (`greatSecretsChooseItemActions`) and
`pending-reducers.ts` (`applyGreatSecretsChooseItemResolution`).

A set-aside item placed this way scores no marshalling points at all — the
`CardInPlay.setAsideNoMp` flag (stamped via `placeCardSetAside`'s `noMp`
argument) overrides the MEAS §1 default of crediting them to the owner. The
deck owner may later play it "as though it were in hand" via
`PlayHeroResourceAction.fromSetAside` (see `legal-actions/site.ts`'s
Under-deeps set-aside item merge and `reducer-site.ts`'s
`handleSitePlayHeroResource`), which pulls it back out via
`removeItemFromSetAside`.

```json
{
  "type": "reveal-deck-choose-set-aside",
  "count": 10,
  "itemFilter": {
    "$and": [
      { "cardType": { "$in": ["hero-resource-item", "minion-resource-item"] } },
      { "$not": { "subtype": { "$in": ["special", "hoard"] } } }
    ]
  }
}
```

Used by *Great Secrets Buried There* (dm-63): "Opponent reveals the top ten
cards of his play deck to himself. If one is available, opponent must choose a
non-special, non-hoard item from the revealed cards to place off to the side
under this card (item does not give marshalling points and is considered out
of play). If none are available, opponent must show you the cards he revealed
to himself. Opponent shuffles all remaining revealed cards into his play deck.
Opponent may play this item as though it were in his hand at any Under-deeps
site where it could be normally playable."

### 6j. `enqueue-reveal-hazards-choice`

Carried by a **resource** short-event's `on-event: self-enters-play` (`target:
"target-company"`). When the event resolves, enqueues a `reveal-hazards-choice`
pending resolution for the **opponent** (the hazard player) on the targeted
company:

1. The opponent may reveal any number of hazard cards from hand — one
   `reveal-hazard-for-snake` action per not-yet-revealed hazard-creature or
   hazard-event card, repeatable. Each reveal is recorded immediately in
   `GameState.revealedInstances` (the card stays in hand) and appended to the
   resolution's accumulator.
2. **While nothing has been revealed yet**, the opponent may instead take
   `tap-reveal-agent-for-snake` on an eligible face-down, untapped agent — the
   printed alternative ("Alternatively, a face-down agent is tapped and
   revealed"). This resolves exactly like the standalone `reveal-agent` action
   (rule 9.04 home-site placement, movement-history and uniqueness checks) and
   additionally taps the agent (CoE rule 4.3: a face-down agent tapped to
   initiate a hazard effect is revealed as part of that action). No constraint
   is added — the resolution simply dequeues.
3. The opponent finalizes with `pass`. Whatever was revealed (even nothing)
   becomes the allow-list of an `only-revealed-hazards-on-company` active
   constraint on the target company, scoped `company-mh-phase` (auto-clears
   at the end of the company's movement/hazard phase). The constraint drops
   every `play-hazard` action against the company (creature or event) not in
   the allow-list. An empty allow-list (the opponent revealed nothing and
   didn't tap an agent) blocks every hazard play against the company for the
   rest of its M/H phase. "including on-guard cards": `onGuardWindowActions`
   separately looks up this constraint for the on-guard window's company and
   skips any not-yet-revealed on-guard card outside its allow-list — checked
   there rather than via the generic constraint post-filter, because
   `computeLegalActions` short-circuits straight to a pending resolution's own
   legal-action function (never reaching that post-filter) whenever any
   resolution is queued for the actor.

Enqueue is in `reducer-events.ts` (`applyShortEventOnEntersPlay`); the
resolution lives in `legal-actions/pending.ts` (`revealHazardsChoiceActions`)
and `pending-reducers.ts` (`applyRevealHazardsChoiceResolution`); the
constraint filter is `applyOnlyRevealedHazardsOnCompany` in
`legal-actions/pending.ts`.

```json
{ "type": "play-window", "phase": "movement-hazard", "step": "play-hazards" }
{ "type": "play-target", "target": "company" }
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "enqueue-reveal-hazards-choice" }, "target": "target-company" }
```

Used by Here Is a Snake! (dm-137): "Playable on a company during its
movement/hazard phase after cards have been drawn. Opponent may reveal to you
any number of hazards from his hand. He may only play hazards he revealed to
you (including on-guard cards) for the remainder of target company's
movement/hazard phase. Alternatively, a face-down agent is tapped and
revealed."

### 7. `grant-action`

Gives the card bearer a new activated ability. For roll-based actions,
`rollThreshold` specifies the minimum 2d6 total for success.

**Composable `cost`.** `ActionCost`'s `tap`, `discard`, `check`, and `wound`
fields are independent and may be combined on one `cost` object — `applyCost`
(`cost-evaluator.ts`) pays `tap` first, then falls through to pay
`discard`/`check`/`wound` against the post-tap state, rather than the first
paid component short-circuiting the rest. Used by Healing Herbs (tw-255):
`{ "tap": "bearer", "discard": "self" }` for "tap and discard this item" —
the bearer taps AND the item is discarded, not one or the other.

```json
{ "type": "grant-action", "action": "heal-company-character",
  "cost": { "tap": "bearer", "discard": "self" },
  "apply": { "type": "set-character-status", "target": "target-character", "status": "untapped" } }
```

**`heal-company-character`** (le-310 precedent) targets a wounded (Inverted)
character in the bearer's company; **`untap-company-character`** (tw-255)
targets a Tapped, non-wounded company member instead — both implemented in
`legal-actions/organization.ts`'s item grant-action scan, emitting one
activation per matching candidate on `targetCardId`, and sharing the same
`set-character-status` apply. A bearer able to pay a `tap: "bearer"` cost is
by definition Untapped at legal-action-generation time, so it can never
qualify as its own `untap-company-character` target.

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

**Bearer-less sources: `cost: { "tap": "self" }` and an optional `apply`.**
A card sitting in `cardsInPlay` with no bearer (an in-play faction, or a
permanent event bound to a company) routes to `handleInPlayCardGrantAction`.
Two costs are supported there: `discard: "self"` (the source leaves play for
its controller's discard pile — A Panoply of Wings wh-37) and `tap: "self"`
(the source is set to `Tapped` **in place** and stays in `cardsInPlay`). With
`tap: "self"` the `apply` may be omitted entirely, for a card where becoming
tapped *is* the whole effect — Pass the Doors of Dol Guldur (dm-154), whose
tapped status is what later unlocks `storable-at` `requiresTapped` and what
`play-flag: "no-auto-untap"` then preserves ("this card never untaps").

The site-phase emitter for a **company-bound** source (one carrying a
`CardInPlay.companyId`, e.g. a `play-target: "company"` resource like dm-154)
is `inPlayCompanyTapGrantActions` (`legal-actions/site.ts`), which offers the
ability to the company currently taking its site phase, for an `Untapped`
source whose `when` matches the per-company site-phase context. An
**uncompany-bound** bare source (a faction, or a permanent event with no
`play-target` at all — e.g. Earth-eater wh-67) instead rides
`bareCardGrantActions` (`legal-actions/organization.ts`), offered during both
the organization and active-player site phases regardless of company; besides
`add-constraint` its `apply` may also be `enqueue-pending-fetch` (see below).

**`singletonLock: true` — "no other copy of this card can be tapped".** The
first activation records the source's card **name** in
`GameState.singletonTapLocks`, which is never cleared; both the emitter and
the reducer refuse the ability for every copy of that name thereafter. Keyed
by name (not instance) so multi-set printings share one lock, and stored in
`GameState` rather than derived from any card's status because the locking
copy may leave `cardsInPlay` afterwards (dm-154 is subsequently *stored*).

```json
{ "type": "grant-action", "action": "tap-pass-the-doors",
  "cost": { "tap": "self" }, "singletonLock": true,
  "when": { "company.prisonersRescuedAtDolGuldurThisSitePhase": true } }
```

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

The same `target: "company"` shape is also reachable from a resource
**short-event**'s `on-event: self-enters-play` (not just a `grant-action`
apply): `applyShortEventOnEntersPlay` (`reducer-events.ts`) resolves the
company from the played-on character (`action.targetCharacterId`, the card's
own `play-target`) and applies the identical tapped-only gate — an
`Inverted` (wounded) member or an already-`Untapped` member is left alone, so
"untap all unwounded characters in the company" needs no separate
wounded-exclusion clause. Used by Narya (tw-290): "Immediately untap all
unwounded characters in Gandalf's company."

```json
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "set-character-status", "target": "company", "status": "untapped" } }
```

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
  `reducer-organization.ts`). The constraint is consulted at every
  point the engine can force a return-to-origin or a site tap — see
  `docs/certification-engine-support.md` for the full list of call
  sites. The same constraint kind can also be added directly by a
  short event's `on-event: self-enters-play` → `add-constraint`
  (`reducer-events.ts`, company resolved from
  `action.targetCharacterId`, no `grant-action`/tap-bearer step) — used
  by Govern the Storms (wh-45) on a sorcery-using character rather than
  a tapping ranger.
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

- `defeat-attack-strikes` (`add-constraint` kind) — discard the source item
  during the active player's site phase (`activeSitePhase: true`, offered at
  the enter-or-skip decision window, same as `skip-automatic-attacks`) to add
  a single-use `defeat-attack-strikes` constraint to the bearer's company.
  Consumed by the site's automatic-attack initiation in `reducer-site.ts`:
  the next automatic-attack the company faces whose creature race is **not**
  in `excludeRaces` has every one of its strikes automatically resolve as
  defeated (as if parried), regardless of the roll — threaded onto the combat
  as `forcedStrikeDefeat: true` and consumed in `combat-strike.ts`'s
  `resolveStrikeCore` (short-circuits the roll comparison; skipped entirely
  by the `discardItemEffect`/`takePrisonerResult`/absorb-wound overrides,
  which only fire on a `'wounded'` result). A forced-defeat strike still
  triggers the normal creature body check when the creature has body, but
  that check is penalized by `value` (the constraint's `bodyCheckModifier`,
  typically negative) — threaded as `forcedDefeatBodyCheckModifier` and added
  into `effectiveRoll` alongside the wounded-agent bonus and
  `bearerCombatBodyCheckModifier` in `handleBodyCheckRoll`
  (`combat-actions.ts`). If the attack's race *is* excluded, the constraint
  is left untouched so it can still apply to a later qualifying
  automatic-attack at the same site visit (it does not consume on a
  non-match). `excludeRaces` and `value` are read off the `add-constraint`
  apply clause by `buildPayloadConstraintKind` (`grant-action-apply.ts`).
  Used by *Liquid Fire* (wh-52): "Discard to cause all strikes from all
  attacks of a non-Dragon, non-Nazgûl, non-Balrog creature keyed to a site to
  fail (resulting body checks for the creature are modified by -2)."

  ```json
  { "type": "grant-action", "action": "liquid-fire-defeat-attack",
    "activeSitePhase": true, "cost": { "discard": "self" },
    "apply": { "type": "add-constraint", "constraint": "defeat-attack-strikes",
      "scope": "company-site-phase", "target": "bearer-company", "value": -2,
      "excludeRaces": ["dragon", "ringwraith", "balrog"] } }
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
  - `"company-characters"` — characters in the bearer's own company
    (including the bearer). Already-untapped candidates are skipped
    (untapping one is pointless).
  - `"own-hazard-corruption-cards"` — every `hazard-corruption` card attached
    to any of the activating player's own characters (all companies). `filter`
    for this scope is matched against the **bearer character's** definition
    instead of the corruption card's own (see above).
- `filter` — optional DSL `Condition` matched against each candidate's
  card definition (or, for `"own-hazard-corruption-cards"`, the candidate's
  bearer character's definition); candidates that fail the filter are skipped.
- `excludeBearer` — for scope `"company-characters"`, drops the bearer from
  the enumerated candidates, leaving only company-mates. Used when the
  `apply` already untaps the bearer directly via `target: "bearer"` and the
  per-target loop should only offer the *other* company member.

Example (Waybread td-165 — discard to untap the bearer, or the bearer **and**
one other company-mate; the same `discard: "self"` cost across all three
modes means using any one of them consumes the item, naturally ruling out
the others — no `oncePerTurn` lock needed):

```json
{ "type": "grant-action", "action": "untap-bearer",
  "anyPhase": true, "cost": { "discard": "self" },
  "when": { "bearer.status": "tapped" },
  "apply": { "type": "set-character-status", "target": "bearer", "status": "untapped" } }
{ "type": "grant-action", "action": "untap-bearer-and-company-character",
  "anyPhase": true, "cost": { "discard": "self" },
  "targets": { "scope": "company-characters", "excludeBearer": true },
  "apply": { "type": "sequence", "apps": [
    { "type": "set-character-status", "target": "bearer", "status": "untapped" },
    { "type": "set-character-status", "target": "target-character", "status": "untapped" }
  ] } }
```

Example (The Arkenstone tw-341 — tap to untap a Dwarf company-mate, who
then makes a corruption check modified -2; `enqueue-corruption-check`'s
`target: "target-character"` reads the chosen candidate instead of the
bearer):

```json
{ "type": "grant-action", "action": "untap-company-dwarf",
  "cost": { "tap": "self" },
  "targets": { "scope": "company-characters",
               "filter": { "race": "dwarf" } },
  "apply": { "type": "sequence", "apps": [
    { "type": "set-character-status", "target": "target-character", "status": "untapped" },
    { "type": "enqueue-corruption-check", "target": "target-character", "modifier": -2 }
  ] } }
```

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
// `bareCardGrantActions` offers it during the controller's organization /
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

**Bearer-less `enqueue-pending-fetch`.** A `grant-action` with no bearer
character — a bare permanent event sitting in `cardsInPlay`, not attached to
anyone — may also carry an `enqueue-pending-fetch` apply. It is offered by
`bareCardGrantActions` (`legal-actions/organization.ts`, wired into both the
organization and active-player site phases) and resolved by
`handleInPlayCardGrantAction` (`grant-action-apply.ts`), which mirrors the
bearer-borne handling above minus `playableAtBearerSite` (there is no bearer
company to derive a site from). Used by Earth-eater (wh-67): "Tap Earth-eater
to take a minion non-unique weapon/armor/shield/helmet major item from your
sideboard or discard pile to your hand."

```json
{ "type": "grant-action", "action": "earth-eater-fetch",
  "cost": { "tap": "self" },
  "apply": {
    "type": "enqueue-pending-fetch",
    "fetchFrom": ["discard-pile", "sideboard"],
    "fetchCount": 1,
    "fetchShuffle": false,
    "fetchTo": "hand",
    "filter": { "$and": [
      { "unique": false },
      { "subtype": "major" },
      { "$or": [
        { "keywords": { "$includes": "weapon" } },
        { "keywords": { "$includes": "armor" } },
        { "keywords": { "$includes": "shield" } },
        { "keywords": { "$includes": "helmet" } }
      ] }
    ] }
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

**`fromStored: true` — a grant-action sourced from a stored card, not a bearer.**
A card stored in the controller's marshalling-point pile (`killPile`, a
`storedAtSite` entry) has left both `cardsInPlay` and any character's
attachment lists — the `grant-action` counterpart to a `stat-modifier`'s
`activeWhileStored` (§ above). Marking a `grant-action` effect `fromStored`
routes it to a dedicated scanner, `storedCardGrantActions`
(`legal-actions/organization.ts`), which reads `killPile` entries' own
definitions directly; the ordinary attached-card scans (`extractGrantActions`)
explicitly skip `fromStored` effects, so the ability never fires while the
card is merely in play (before storage) and is never offered twice.

Because a stored card has no bearer, its cost cannot use a bearer-relative
`tap` variant. `cost.tap: "sage-at-haven"` instead enumerates every one of
the acting player's own untapped sage characters currently at a Haven [{H}],
independent of company; the chosen sage becomes the activation's
`characterId` and — for a `place-item-on-character` apply — also supplies the
company whose members are offered as recipients (scoped to just that one
company, unlike the attached-card form's site-wide search, since there is no
bearer/site to search from). `cost.discard: "self"` discards the stored card
itself, paid by a `killPile` fallback in `applyDiscardSelf`
(`cost-evaluator.ts`): when the source instance isn't found on the paying
actor's `items`/`allies`/`hazards`, it is looked up in the player's `killPile`
instead and removed from there into the discard pile.

```json
{ "type": "grant-action", "action": "reforging-retrieve-item",
  "fromStored": true,
  "cost": { "tap": "sage-at-haven", "discard": "self" },
  "apply": {
    "type": "place-item-on-character",
    "fetchFrom": ["discard-pile"],
    "filter": { "$and": [
      { "subtype": { "$in": ["minor", "major"] } },
      { "$or": [
        { "keywords": { "$includes": "weapon" } },
        { "keywords": { "$includes": "armor" } },
        { "keywords": { "$includes": "shield" } }
      ] }
    ] }
  } }
```

Used by Reforging (tw-314): "During your organization phase, you may tap a
sage at a Haven [{H}] and discard a stored Reforging to retrieve any minor or
major weapon, armor, or shield (even a hoard item) from your discard pile.
The item must be placed under the control of a character in the sage's
company." A hoard item still qualifies since the filter carries no `hoard`
exclusion, and this path bypasses the ordinary site-based `item-play-site`
gate entirely (there is no site check here), which is exactly what "even a
hoard item" needs — the item is placed directly, not played at a hoard site.

**`cost.discard: "named-stored-card"` + `place-source-with-item` apply — a
no-tap `fromStored` combine.** Some `fromStored` abilities need neither a tap
nor a bearer at all: the cost is simply discarding a *different* stored card
by name, and the effect relocates the source itself (not a fetched item) onto
whichever character already bears a named item. `cost.discard:
"named-stored-card"` reads `discardCardName` and finds a match among the
player's own other `killPile` entries (also `storedAtSite`) — unlike
`discard: "self"`'s `killPile` fallback, this never touches the source. The
`place-source-with-item` apply then moves the source card out of `killPile`
and onto the chosen recipient's `items`, untapped, alongside the item named
`itemName` (which must already be attached to that character — both items
end up on the same bearer). Scanned by a dedicated emitter,
`storedCombineGrantActions` (`legal-actions/organization.ts`), which offers
one `activate-granted-action` per (discard candidate × recipient) pair;
`characterId` self-references the source's own instance ID (the bearer-less
convention), so `handleGrantActionApply` routes activation to
`handleStoredCardGrantAction` (`grant-action-apply.ts`) rather than the
generic bearer-relative cost/apply dispatch.

```json
{ "type": "grant-action", "action": "anduril-combine-with-narsil",
  "fromStored": true,
  "cost": { "discard": "named-stored-card", "discardCardName": "Reforging" },
  "apply": { "type": "place-source-with-item", "itemName": "Narsil" } }
```

Used by Andúril, the Flame of the West (tw-192): "Once stored, you may
discard a stored Reforging and place Andúril with Narsil." Andúril's
post-combine stat bonuses (+4 marshalling points, +4 prowess, +1 direct
influence, +1 corruption point) and its tap-to-untap-a-Dúnadan ability are not
yet certified — only the combine action itself (moving the card out of
storage and onto Narsil's bearer) is implemented here.

### 8. `on-event`

Triggered effect that fires when a game event occurs.

```json
{ "type": "on-event", "event": "character-wounded-by-self",
  "apply": { "type": "force-check", "check": "corruption", "modifier": -2 },
  "target": "wounded-character" }
```

Events:

- `character-wounded-by-self` -- fires when a strike wounds a character, forcing a corruption check. Wounds enqueue a `corruption-check` pending resolution (see [Pending resolutions](#pending-resolutions) below) for the actor whose character was wounded; the resolution is scoped to the active company's MH or Site sub-phase, so it auto-clears at the company's sub-phase end. Implemented in `reducer-combat.ts`. Also supports `apply: { "type": "force-discard-one-company-item", "chooser"?: "attacker" | "defender" }` (`combat-finalize.ts`): the defending company must discard one item, once per attack. `chooser` picks who selects the item (default `"defender"`) — Brigands (tw-17/le-64) and Pirates (le-88) leave the choice to the defender; Were-worm (td-80) sets `"chooser": "attacker"` for "discard one item of attacker's choice".
- `self-enters-play` -- fires when this card enters play. Used by environment permanent events to discard opposing cards (implemented in reducer play handlers).
- `untap-phase-end` -- fires once per applicable card during the Untap → Organization transition. The reducer (`reducer-untap.ts`) scans every character of the active player for attached cards (items / hazards / allies) carrying this on-event. An optional `when` condition is evaluated against the bearer context `{ bearer: { siteType, atHaven } }`. `atHaven` follows the bearer's controller's {H} semantics (`isHavenForPlayer`): any haven-class site for hero/minion players (Haven/Darkhaven), but for a Fallen-wizard player his Wizardhavens — an FW-alignment haven site or a `wizardhaven-conversion` site. Supported apply types:
  - `force-check` (with `check: "corruption"`) — enqueues a `corruption-check` pending resolution per match. Used by *Lure of the Senses* (at-haven only, `"bearer.atHaven": true`), *Longing for the West* wh-25 (away from Haven/Wizardhaven only, `"bearer.atHaven": false`) and *The Least of Gold Rings* (any site).
  - a self-discard `move` (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`) — removes the card from the bearer's items/hazards/allies and places it in the owner's discard pile. The optional `when` condition gates the discard (e.g. `"when": { "bearer.atHaven": true }` to discard at Darkhavens). Used by *Well-preserved* (as-108).
- `play-deck-exhausted` -- fires when a play deck is exhausted and the exhaustion completes (the discard pile is reshuffled into a new play deck; `completeDeckExhaust` in `reducer-utils.ts`). Models "Discard when any play deck is exhausted". The only supported apply is a self-discard `move` (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`); no `when` is evaluated. Both placements are swept: **bare** permanent events in either player's `cardsInPlay` (Safe from the Shadow as-54, Stormcrow td-73, The Will of Sauron tw-100), and permanent events **attached to a character** — `discardAttachedOnDeckExhaust` scans every character's `hazards` and `items`, routing an attached hazard to the *opposing* player's discard pile and an attached item/event to the holder's, matching the `move` zone conventions. Used in the attached form by *Power Relinquished to Artifice* (wh-28).

  ```json
  { "type": "on-event", "event": "play-deck-exhausted",
    "apply": { "type": "move", "select": "self", "from": "self-location", "to": "discard" } }
  ```

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
- `attack-not-canceled` -- fires after combat finalization on the **attack source card** (creature, on-guard creature, or played auto-attack). Canceling an attack ends it before `finalizeCombat` runs (`combat-cancel.ts` returns straight to the enclosing phase), so reaching finalization *is* the "not canceled" test and the event fires unconditionally there. Models the "Unless this attack is canceled, …" clause. Implemented in `combat-finalize.ts`. Supported apply types:
  - `add-constraint` with `constraint: "creature-attack-boost"` — a turn-scoped `race`/`strikes`/`prowess` boost bound to the defending company.
  - `company-tap-characters` — taps every still-**untapped** character in the defending company (optional `filter`, context `{ target: { race, mind, name, skills, cardType } }`; no mind gate). Characters that tapped to face a strike are already tapped and wounded ones are `Inverted`, so only the survivors that stayed untapped and the bystanders who never faced a strike are affected. Used by *Wild Fell Beast* (td-81): "Unless this attack is canceled, all untapped characters in defending company are tapped following attack."
  - `reveal-hand-cards-per-character` — picks `min(defending company's post-attack character count, defender's hand size)` random cards from the defending player's hand (seeded shuffle, same pattern as `reveal-remove-from-discard`) and reveals their identity via `revealInstances` (`GameState.handRevealedInstances`) — the cards stay in hand, only visibility changes. Zero defending characters or an empty hand reveals nothing (no error). Type-only marker; no fields. Used by *Crebain* (tw-25): "After the attack, the defender must reveal one random card from his hand for each character in the defending company."

  ```json
  { "type": "on-event", "event": "attack-not-canceled",
    "apply": { "type": "company-tap-characters" } }
  ```

  ```json
  { "type": "on-event", "event": "attack-not-canceled",
    "apply": { "type": "reveal-hand-cards-per-character" } }
  ```

- `attack-defeated` -- fires after combat finalization when **all** strikes of an attack were fully defeated (all results = `success`). Scanned from every player's `cardsInPlay` in `reducer-combat.ts` when `allDefeated` is true. The condition context exposes `enemy.race` (the normalized race of the attack, e.g. `"undead"`) and `attack.isAutomaticAttack` (`true` only when the defeated attack was a site automatic-attack or a played-auto-attack, not a hazard creature). Supports a self-discard `move` apply (`{ "type": "move", "select": "self", "from": "self-location", "to": "discard" }`) to move the source card from `cardsInPlay` to the owning player's discard pile. Used by *The Moon Is Dead* (dm-71) to self-discard when any Undead attack is defeated, and by *Redoubled Force* (dm-83) to self-discard when an Orc/Troll **automatic**-attack is defeated (`when: { "attack.isAutomaticAttack": true, "enemy.race": { "$in": ["orc", "troll"] } }`).
- `attack-strike-successful` -- fires in `finalizeCombat` (`combat-finalize.ts`) when at least one of **this attack's own strikes** wounded or eliminated a defender (the same `struckCharIds` set used for wound-triggered passives — detainment strikes excluded, since they tap rather than wound) while the defending company is still in its movement/hazard phase. Self-bound to the attack source card; no `scope`. Supports the `company-return-to-origin` apply verb, which forces the defending company back to its site of origin (CoE rule 2.IV.4 — the same mechanism as the short-event `company-return-to-origin` card effect and `agent-discard-return-to-origin`): sets `MovementHazardPhaseState.returnedToOrigin` (skipped if already set, or if the company has no `destinationSite` — i.e. it already isn't moving) and adds a `site-phase-do-nothing` constraint scoped to the company's upcoming site phase. Unlike the short-event version there is no `unless` exception. Used by *Fell Turtle* (tw-34): "One strike. If any strike is successful, the defending company must return to its site of origin (defending characters are wounded normally)."

  ```json
  { "type": "on-event", "event": "attack-strike-successful",
    "apply": { "type": "company-return-to-origin" } }
  ```

- `company-arrives-at-site` -- fires when a hazard short-event resolves against a company in M/H. The handler (`applyShortEventArrivalTrigger` in `chain-reducer.ts`) iterates every `add-constraint` effect on the card with this event, evaluates the optional `when` against the arrival context, and applies the first matching one. This allows a single card to declare multiple mutually-exclusive modes (e.g. *Choking Shadows*). The arrival context exposes `company.destinationSiteType`, `company.destinationSiteName`, `company.destinationRegionType`, `environment.doorsOfNightInPlay`, and the standard `inPlay` card-name list.
- `end-of-company-mh` -- fires when a company's movement/hazard sub-phase ends (both players pass). For each character with an attached hazard carrying this event, enqueues one `corruption-check` pending resolution per region traversed in the site path. The `perRegion: true` flag on the effect enables the per-region behavior. An optional `regionTypeFilter: [...]` array restricts the iteration to regions whose type appears in the list — e.g. *Lure of Nature* uses `regionTypeFilter: ["wilderness"]` to enqueue a check only for each wilderness in the path. Used by *Alone and Unadvised* and *Lure of Nature*. Implemented in `reducer-movement-hazard.ts`.
- `company-mh-end-at-site` -- fires when a company finishes its movement/hazard phase (`endCompanyMH`, after movement is committed) while at the Haven a permanent event is bound to (`attachedToSite` = the company's final `currentSite` definition id). Scanned over the active player's `cardsInPlay` in `reducer-movement-hazard.ts` (`fireHavenRestoreTriggers`). Supports `apply: { type: "offer-restore-character" }`: when the company has at least one tapped or wounded character, a `haven-restore-character` pending resolution is enqueued for the controlling player, scoped to the upcoming Site phase (the M/H sub-phase boundary would otherwise sweep it before the player acts; pending resolutions short-circuit every phase action, so it is resolved at the very next decision point — immediately following the company's M/H phase). The player may choose one character to untap (tapped → untapped) or heal one step (wounded/inverted → tapped) via a `restore-character-by-effect` action, or pass — the improvement is determined by the chosen character's current status. Used by *Hall of Fire* (dm-134). The same event name also fires for **character-attached** hazards (as opposed to Hall of Fire's site-attached `attachedToSite` form): `fireCharacterCorruptionAtSiteTriggers` in `mh-hazard-play.ts` (called from `endCompanyMH` immediately after `fireHavenRestoreTriggers`) scans every character in the company that just ended its M/H phase for attached hazards carrying this event, and supports `apply: { type: "force-check", check: "corruption" }` gated by an optional `when` evaluated against `{ bearer: { atHaven } }` (the same context shape `untap-phase-end` uses, via `isHavenForPlayer`). Used by *Lure of Creation* (tw-56): "…makes a corruption check at the end of any movement/hazard phase in a turn during which his company moved to a Haven [{H}]" — `when: { "bearer.atHaven": true }`.
- `company-composition-changed` -- fires against every attached hazard whenever a company's character roster changes (play-character, move-to-company, merge-companies, auto-merge at end of MH). The sweeper evaluates the effect's `when` against the bearer's company context and applies the self-discard `move` when the condition is met. Used by *Alone and Unadvised* (discards when company has 4+ characters). Implemented in `reducer-utils.ts` `sweepAutoDiscardHazards()`.
- `bearer-company-moves` -- fires when the company containing the bearer completes movement (M/H step 8). For each character in the moving company, the reducer scans attached **items and allies** for this event and applies the self-discard `move`, moving the card to the owner's discard pile. An effect with no `when` discards unconditionally (e.g. *Align Palantír*, an item that leaves play the moment its company moves). An effect carrying a `when` clause discards only when the clause matches the context `{ movementType, destination: { name, region, siteType }, sitePath: { regionTypes }, company: { characterCount } }`, where `movementType` is the movement kind used (`"starter"` / `"region"` / `"special"` / `"under-deeps"`) and `company.characterCount` is how many characters the moving company holds on completing the move. Used by *Mistress Lobelia* (dm-178), an ally discarded whenever her company moves to a site outside her allowed set (`when: { $not: { $or: [ { "destination.name": { $in: [...] } }, { "destination.region": "The Shire" } ] } }`); and by *Evil Things Lingering* (ba-45), "Discard this ally if its company moves using region or starter movement" — `when: { "movementType": { "$in": ["region", "starter"] } }` (so Under-deeps/special moves keep it); and by the *Palantír of Amon Sûl* (tw-296 / le-330) and *Palantír of Osgiliath* (tw-301 / le-335), "If the bearer's company is ever below 2 (resp. 4) characters and it moves, discard this item" — `when: { "company.characterCount": { "$lt": 2 } }`. Implemented in `reducer-movement-hazard.ts` (step 8a-2 of `mh-hazard-play.ts`).
- `host-item-stored` -- fires from `handleStoreItem` (`reducer-organization.ts`) when an item is stored at a Haven. After removing the target item from the bearer, the reducer scans the bearer's **remaining items** for this event and applies the self-store `move` (`apply: { type: "move", select: "self", to: "kill-pile" }`), moving the companion card into the same marshalling point pile alongside the stored item (with the same `storedAtSite` binding). An effect carrying a `when` clause fires only when it matches the context `{ storedItem: { itemKeywords } }`, where `itemKeywords` is the combined `keywords` of the item being stored (via `itemKeywordsOf`). Used by *Align Palantír* (tw-190), CRF 22 errata "If the Palantír is stored, this card is stored too" — `when: { "storedItem.itemKeywords": { "$includes": "palantir" } }` so it follows only a Palantír-keyword item into storage, not an unrelated item stored from the same bearer. Skipped entirely when the item is stored via the item-cache alternate destination (Armory dm-116) — that path is scoped to true minor items, not their companion permanent events.
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
- `add-constraint` -- add an {@link ActiveConstraint} of the named kind to the target. Reserves the entry's `constraint` field for the kind name (e.g. `"site-phase-do-nothing"`, `"no-creature-hazards-on-company"`, `"deny-scout-resources"`, `"auto-attack-prowess-boost"`, `"auto-attack-duplicate"`, `"site-type-override"`, `"region-type-override"`, `"skip-automatic-attacks"`, `"cancel-character-discard"`, `"hazard-draw-multiplier"`, `"haven-return-option"`) and the `scope` field for the auto-clear boundary (e.g. `"company-site-phase"`, `"company-mh-phase"`, `"turn"`, `"until-cleared"`). Constraint-kind-specific fields include `value` + `siteType` for `auto-attack-prowess-boost` (when added from a **resource short-event's** `on-event: self-enters-play` — Come By Night Upon Them le-176 — it resolves the active site-phase company itself, bakes a `doublesWithDoorsOfNight` doubling at play time, and is stored as a **persistent** `auto-attack.prowess` `attribute-modifier` that weakens *every* automatic-attack the company faces at the site, not just the first), `overrideType` for `site-type-override` (the site is the active company's current site during site phase, or the destination during M/H phase; an optional `purpose: "healing"` makes the override **healing-only** — `getEffectiveSiteType` ignores it so hazard keying / movement / bring-into-play / playability keep the printed type, while the untap-phase healing sweep still treats the site as a Haven, as used by *Houses of Healing* td-125; an optional `purpose: "healing-and-hazards"` makes the override apply everywhere *except* character recruiting — `getEffectiveSiteType` callers that decide whether a character may be played/recruited pass `excludeCharacterPlayOverrides` to skip it, while hazard keying, movement, bring-into-play, item/faction/ally playability, and healing all still see the Haven, as used by *The White Tree* tw-348 ("Minas Tirith becomes a Haven for the purposes of healing and playing hazards" — not for playing characters); an optional `allVersions: true` scopes the override by the site's printed **name** instead of its definition id, so every printing of the location — hero / minion / Fallen-wizard / Balrog, distinct definitions sharing one name — is retyped, as used by *Nature's Revenge* wh-27 "All versions of the site become Ruins & Lairs"), and `overrideType` + `regionName` for `region-type-override` (use the token `"destination"` as the region name to target the destination region of the active company). The `skip-automatic-attacks` constraint removes all automatic attacks from the bound site (resolved from the active company's current site during site phase). The `replace-automatic-attacks` constraint (scope `"until-cleared"`, added by *Vile Fumes*' `transform-site` action — see above) carries a `siteDefinitionId` and an `attack`; `manifestations.ts` `getActiveAutoAttacks` returns that single attack in place of all printed/augmented attacks for every version of the site. The attack may set `uncancelable` (mapped to the `cannot-be-canceled` combat rule, suppressing cancel-attack) and `eachCharacter` (each character in the company faces one strike). When added via a grant-action `add-constraint` apply (rather than the permanent-event on-event path), both `skip-automatic-attacks` and `influence-at-site-modifier` resolve their `siteDefinitionId` from the *bearer's company's* current site; `influence-at-site-modifier` reads its `+value` from the apply clause and adds that bonus to every faction-influence attempt against a faction at that site for its scope (`turn`). Both are used by *Blasting Fire* (wh-51): its discard ability is a `sequence` of these two `add-constraint` applies. The `company-cannot-move` constraint (scope `"turn"`, target a company) locks that company stationary for the rest of the turn: the org-phase `plan-movement` emitter (`planMovementActions`) skips it and the reducer (`handlePlanMovement`) rejects any movement declaration for it. Used by *Hide in Dark Places* (le-192), which adds it alongside `no-creature-hazards-on-company` (two `on-event: self-enters-play` → `add-constraint` effects) so the protected company cannot carry its hazard-creature immunity onto a moving company. Installing the constraint also **strips a destination the company already declared** (`clearPlannedMovement`, `reducer-utils.ts`, returning the site card to the location deck) — end-of-org cards are played alongside the rest of the organization phase, so a company may already be moving when the card resolves. That matters for *Hiding* (tw-256), the hero counterpart, which carries no "not moving" precondition and instead grounds its target outright ("Scout’s company may not move to another site this turn"); for le-192 the strip is a no-op because its `play-target` filter already requires `company.moving: false`. The `no-creatures-keyed-to-site` constraint (scope `"turn"`, target a company) is the inverse of `only-creatures-keyed-to-site`: hazard-creature plays keyed *to the target company's new site* (the play action's `keyedBy.method` is `site-type`, `site-name`, `site-keyword`, or `adjacent-to-site-keyword`) are dropped, while region-keyed plays of the same creature survive as their own actions. An optional `unlessSiteRegionType` field (e.g. `"free"`) voids the restriction entirely when the destination site's containing region has that type, resolved via `siteRegionTypeOf`. Used by *Crack in the Wall* (le-177): "Unless the site is in a Free-domain [{f}], no hazard creatures may be played at the company's new site." Also used (with no `unlessSiteRegionType`) by *Secret Entrance* (tw-324): "no hazard creatures keyed to the site may be played on the company" — unlike Stealth/Sneakin's `no-creature-hazards-on-company`, region-keyed creature plays against the protected company remain legal, only the site-keyed variants are dropped. The `cancel-character-discard` constraint is placed by *Magical Harp* on the bearer's company; any future character-discard effect should consult this constraint to short-circuit the discard for the rest of the turn. The `hazard-draw-multiplier` constraint (scope `"company-mh-phase"`) multiplies the hazard draw count during the target company's M/H draw step by the `value` field (e.g. `2` to double opponent draws, as used by *Great-road*). The `haven-return-option` constraint (scope `"turn"`) records the company's origin haven at play time and enables a `haven-return` action during end-of-turn discard and signal-end steps, allowing the company to teleport back to the recorded haven without a new M/H phase (used by *Great-road*). The `check-modifier` constraint kind may also be added via a grant-action `add-constraint` apply (carrying `check` and a numeric `value`): a one-shot bonus/penalty consumed the first time the targeted character makes a matching check — e.g. *When You Know More* (dm-163) adds a `+2` `influence` modifier. Such a grant-action targets the chosen character with `target: "action-target-character"`, which resolves to `{ kind: "character", characterId: <action.targetCardId> }` (the candidate the legal-action generator put on the activation). The constraint filter in `legal-actions/pending.ts` rewrites legal actions for the affected target while the constraint lives. The `target: "bearer"` selector resolves to the *activating* character himself (`{ kind: "character", characterId: <action.characterId> }`) — used by the `can-use-palantir` constraint kind: Palantír of Elostirion (le-332) grants a `{ tap: "bearer" }` ability to a sage bearer whose apply is `{ "type": "add-constraint", "constraint": "can-use-palantir", "scope": "turn", "target": "bearer" }`, which makes `bearer.canUsePalantir` true for the rest of the turn — but **only** for the Palantír that placed it, since `buildGrantActionContext` matches the constraint's `source` against the card whose ability is being gated ("the bearer is able to use *this* Palantír this turn if he taps"). The `mirror-automatic-attacks` constraint kind (scope `"turn"`, added via a `company-arrives-at-site` on-event) replaces a site's entire automatic-attack list, for one company's one visit only, with the automatic-attacks printed on the **corresponding site card of the other alignment** (same printed name, hero-site ↔ minion-site — every hero Border-hold/Free-hold and every minion Shadow-hold/Dark-hold has exactly one such sibling), each boosted by the apply's `value` (added to prowess). `constraint-kind.ts` resolves the destination site (M/H phase only, mirroring `site-type-override`'s resolution), looks up the same-named opposite-alignment definition in `state.cardPool`, and bakes in the applicable detainment mode: visiting a **hero** site bakes `detainmentAgainstPlayer` set to the hero-aligned player's id ("detainment against hero companies" — reusing the same field *Long Grievous Siege* ba-40 uses for its "detainment against your companies" `faction-siege` attacks); visiting a **minion** site bakes `detainmentAgainstOvert: true` on the {@link AutomaticAttack}, a new field consulted alongside `forceDetainment`/`detainmentAgainstPlayer` at every site auto-attack combat-initiation site in `reducer-site.ts` — the attack is detainment specifically when the defending company is racially overt (Orc/Troll/Balrog avatar), normal otherwise ("detainment against overt companies"). Consumed in `manifestations.ts` `getActiveAutoAttacks`, matched by `siteInstanceId` (not definition id, so only the targeted company's own site copy is affected — other companies' copies of the same site are untouched). Used by *Whole Villages Roused* (wh-31).
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

  **Hero-resource-items** (site phase): targets the character the item was
  just attached to (its bearer). Fired immediately after the item is attached
  in `handleSitePlayHeroResource`, not deferred through the chain resolver —
  items attach directly rather than passing through a chain entry. Used by
  *Wizard's Ring* (tw-363): "Bearer makes a corruption check when this item
  is played." Implemented in `reducer-site.ts`
  (`fireItemSelfPlayCorruptionCheck`).

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

- `offer-corruption-removal-at-site` -- under `on-event: self-enters-play` on a
  resource long-event/permanent-event, offer every character — either
  player's — currently standing at a site whose effective type is in
  `siteTypes` and bearing at least one corruption card (a hazard whose card
  definition has `cardType: "hazard-corruption"` or carries the `"corruption"`
  keyword) the one-time option to remove one of them. One
  `remove-corruption-offer` pending resolution is enqueued per eligible
  character; the character's controller either removes one of its corruption
  cards (their choice, if more than one — sent to that card's own owner's
  discard pile) or declines, mirroring `transfer-returned-item`'s always-offered
  decline. Implemented in `chain-reducer.ts`
  (`applyOfferCorruptionRemovalOnResolve`, called from both `resolveLongEvent`
  and the generic `resolvePermanentEvent` self-enters-play loop), with the
  resolution's legal actions/apply in `legal-actions/pending.ts`
  (`removeCorruptionOfferActions`) and `pending-reducers.ts`
  (`applyRemoveCorruptionOfferResolution`).

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "offer-corruption-removal-at-site", "siteTypes": ["haven"] } }
  ```

  Used by *Elf-song* (tw-223): "each character at a Haven [{H}] may
  immediately remove one corruption card."

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

- `whip-discipline` -- an `on-event: self-enters-play` apply for a resource
  short event with a character `play-target` (Where There's a Whip le-254:
  "Each tapped character in the bearer's company with a mind and prowess less
  than the bearer's makes a body check modified by -2..."). Every other
  character in the target's company that is tapped, has a printed mind greater
  than 0, and has a lower effective prowess than the target enqueues a generic
  `dice-check` (roll modifier `modifier`, `comparison: 'gt'`, threshold the
  character's effective body — or, for an Orc/Troll, the minimum of its
  printed `discardBodyCheck` array, the same approximation `force-check-all-
  company` uses). `onPass` (the check "fails", CoE 3.I.1: higher than body is
  bad) discards an Orc/Troll (CoE 3.I.3) or wounds anyone else via
  `set-character-status inverted`; `onFail` (safe) untaps them. Company members
  never checked (already untapped, no mind, or prowess not lower than the
  target's) are untapped immediately, so together with the passing branch every
  unwounded company member ends up untapped without a separate sweep step.
  Implemented in `applyShortEventOnEntersPlay` (`reducer-events.ts`).

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "whip-discipline", "modifier": -2 } }
  ```

- `enqueue-site-wound-rolls` -- an `on-event: end-of-turn` apply carried by a
  permanent hazard **attached to a character**, for plague-style contagion that
  afflicts everybody standing at the bearer's site rather than just the bearer.
  The scan (`fireEndOfTurnSiteWoundRolls`, `reducer-site.ts`) walks the
  **active** player's characters, so it fires exactly at the end of the turn in
  which the bearer's controller is active — "the end of your opponent's turn"
  from the hazard player's seat. For every character standing at the same site
  as the bearer (matched by site *name*, so hero/minion versions of a location
  count as one place; both players' companies are scanned; the bearer himself
  is included) whose definition matches the optional `filter`, it enqueues one
  generic `dice-check`: the character's **own controller** rolls 2d6, adds
  `modifier`, and on a total strictly greater than the character's *effective*
  body the `wound-or-eliminate` verb (ba-54) wounds him — or eliminates him if
  he was already wounded. `filter` is matched against the bare card definition
  (`race`, `cardType`, …), not the `target.*` namespace.

  ```json
  { "type": "on-event", "event": "end-of-turn",
    "apply": { "type": "enqueue-site-wound-rolls", "modifier": -2,
               "filter": { "$and": [ { "race": { "$ne": "ringwraith" } },
                                     { "race": { "$ne": "wizard" } },
                                     { "race": { "$ne": "fallen-wizard" } },
                                     { "race": { "$ne": "elf" } } ] } } }
  ```

  Used by Plague (le-129): "At the end of your opponent's turn, each
  non-Ringwraith, non-Wizard, non-Elf character at the same site as the target
  must make a roll modified by -2. If the result is greater than the
  character's body, he is wounded or he is eliminated if he is already
  wounded."

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

  The optional `destroysOneRing` flag implements the "**The One Ring is
  destroyed**" clause the two Mount Doom cards print (Cracks of Doom tw-205,
  Gollum's Fate tw-247), which A New Ringlord and Challenge the Power — wins
  *with* the Ring — do not. When set, `oneRingWin` first sweeps every in-play
  item borne by the winner's characters whose definition carries the
  `the-one-ring` keyword into that player's `outOfPlayPile` (removed from the
  game, the terminal pile — not the recyclable discard pile). The sweep runs
  *before* `endGame` computes final scores, so the destroyed Ring contributes
  no item marshalling points to the result screen.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "win-game", "via": "one-ring" } }
  ```

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "enqueue-corruption-check", "modifier": -4,
               "onSuccess": { "type": "win-game", "via": "one-ring",
                              "destroysOneRing": true } } }
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

  The optional `rollCount` (default 1) makes the test roll more than once and
  let the player **choose** which total it is read with — *Wizard's Test*
  (tw-365): "make two rolls and choose one result to use for the test". The
  `gold-ring-test` resolution stays queued **in place** (so nothing the same
  card enqueued behind it can jump the queue mid-test), emitting one
  `gold-ring-test-roll` per outstanding roll and recording each modified total
  in `rolledTotals`; once every roll is in, it emits one
  `choose-gold-ring-test-roll` per **distinct** total, each explaining which
  ring categories that total opens. The engine never picks for the player:
  higher is not automatically better, since a ring's table can map low totals to
  Magic Rings and high totals to Dwarven Rings. Because the play-target of such
  a card also travels on the play action as `targetCharacterId`, the card can
  pair the test with a `enqueue-corruption-check` on the same target — tw-365's
  "Wizard makes a corruption check modified by -1".

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "enqueue-gold-ring-test", "rollModifier": 0, "rollCount": 2 } }
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

  A `threshold` field on the apply gates the cancel behind a 2d6 roll
  instead of applying it unconditionally: as this card's own chain entry
  resolves (`resolveEntry`, `chain-reducer.ts`), the engine rolls 2d6
  (honouring `cheatRollTotal` for deterministic tests) and only negates the
  target entry when the total is at or above `threshold` — a failed roll
  still discards this card normally, leaving the target untouched. The roll
  is surfaced as a `dice-roll` {@link GameEffect}. Used by *Wrath of the
  West* (le-151): "Playable on a minion resource short-event declared
  earlier in the same chain of effects. Make a roll—if the result is
  greater than 6, the event is canceled and discarded" (`threshold: 7` =
  "greater than 6"). Unlike Ire of the East, le-151 carries no
  `declaredBy.alignment` restriction (any minion alignment qualifies) and
  no `removeFromGame` (the target is discarded normally on success).

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "cancel-chain-entry",
               "select": "target",
               "filter": { "target.cardType": "minion-resource-event",
                           "target.eventType": "short" },
               "threshold": 7 } }
  ```

- `offer-char-join-attack` -- under `on-event: creature-attack-begins`,
  raises a pending "may join the attacked company" offer for the
  bearer. The defender sees a `haven-join-attack` legal action during
  the assign-strikes cancel-window; accepting moves the bearer into
  the attacked company for good (this is a join, not a temporary
  visit) and (optionally) discards attached allies, forces a strike
  onto the bearer, and schedules post-attack side-effects. Composable
  flags:
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
  (`handleHavenJoinAttack`, `applyPostAttackEffects`). Used by
  *Alatar* (tw-117).

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
  source card) plus the `assumeInPlay` / `assumeNotInPlay` card-name lists the
  effect declares (Crown of Flowers: `["Gates of Morning"]` in,
  `["Doors of Night"]` out). The source card's `cardsInPlay` entry
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
    "apply": { "type": "offer-resource-play",
      "assumeInPlay": ["Gates of Morning"],
      "assumeNotInPlay": ["Doors of Night"] } }
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
  `flag` values: `hoardBountyAvailable`, `thoroughSearchAvailable`,
  `firstItemNoTapAvailable`, and `hoardKeywordGranted`. The third (Come By Night
  Upon Them le-176) lets the **first item** played at the site this site phase
  — any subtype — be played without tapping the site; `handleSitePlayResources`
  (`reducer-site.ts`) treats it like Thorough Search (leaves the site untapped,
  does not count as the site-tapping resource, consumes the flag), while the
  item still taps its bearer normally. The fourth (Dwarven Hoard td-109) makes
  the active site-phase company's current site "considered to contain a hoard
  until the end of the turn" regardless of its printed keywords: while set,
  `buildActiveCompanyContext` (`legal-actions/organization.ts`) and the item
  `item-play-site` keyword computation (`legal-actions/site.ts`, both the
  `itemOwnSiteRestrictionMatches` filter context and the `hoardBountyBonus`
  `siteIsHoard` check) synthesize a `hoard` keyword onto the site, exactly like
  the existing Deep Mines `under-deeps` synthesis. Absent (undefined → false);
  reset when a new company's site phase begins, which is what bounds it to
  "until the end of the turn" in practice.

  ```json
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "set-site-phase-flag", "flag": "firstItemNoTapAvailable" } }
  { "type": "on-event", "event": "self-enters-play",
    "apply": { "type": "set-site-phase-flag", "flag": "hoardKeywordGranted" } }
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
When both `requiredSkill` and `requiredRace` are absent AND `cost` is also
absent, the card is simply played with no additional cost (e.g. Dark
Quarrels — cancel one attack by Orcs, Trolls, or Men). When `cost` **is**
present but `requiredSkill`/`requiredRace` are both absent, any character in
the defending company may pay it — one action is generated per untapped
qualifying character, same as the skill/race-gated shape. Used by Praise to
Elbereth (tw-305): `cost: { "tap": "character" }`, `when: { "enemy.race":
"ringwraith" }` — "for each of your characters ... cancel one Nazgûl attack",
no skill or race requirement.

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
Ever Under Dark* (ba-37) and *Crept Along Carefully* (ba-29):

- `"requiresCvCC": true` — the cancel is offered only against a company-vs-company
  attack (`combat.isCvCC`) — "an attack against them by an opponent's company".
- `"roll": { "threshold": 7, "comparison": "gt", "skillBonus": "scout" }` — the
  cancel is **not** automatic. Paying the cost discards the card and enqueues a
  2d6 `dice-check` (roller = the defending player) whose modified total must
  satisfy `total comparison threshold` to cancel; `skillBonus` (a {@link Skill})
  adds the number of characters with that skill in the defending company to the
  roll — `"scout"` for ba-37 ("the number of scouts in the company"), `"ranger"`
  for ba-29 ("the number of rangers in the company"). On success the check's
  `onPass: { type: "cancel-current-attack" }` verb cancels the combat; on failure
  combat continues.

**Forced automatic-attack re-face (`forceSiteAutoAttacksNormalReface`).** When a
`cancel-attack` effect (paired with `"requiresCvCC": true`) carries
`"forceSiteAutoAttacksNormalReface": true`, cancelling the CvCC attack does not
just end combat: the attacking company must instead face all of its current
site's automatic-attacks again — this time as **normal** (non-detainment)
attacks, regardless of any `combat-detainment` site effect, forced-detainment
site rule, or the usual §3.II alignment-based computation — before it may
declare the CvCC attack again. `applyEffect`'s `cancel-attack` branch
(`apply-dispatcher.ts`) captures the attacking player/company off the combat
before it is cleared, then calls `triggerBellsRingingReface` (`combat-cancel.ts`):
with no automatic-attacks at the site, `opponentInteractionThisTurn` is reset
to `null` immediately; otherwise a repeated-attack combat is built via
`buildSiteRepeatedAttackCombat` (`site-repeated-attack.ts`, shared with the
Troll-purse dm-95 re-face and the rescue-attack) with `forceNormalOverride:
true`, and the site phase enters `'bells-ringing-attacks'` (mirroring
`'troll-purse-attacks'`) — sequencing the site's automatic-attacks one at a
time and, once all are faced, returning to `'declare-company-attack'` with the
interaction marker cleared rather than to `'play-resources'`. Used by *All the
Bells Ringing* (as-44): "Playable during opponent's site phase before strikes
are assigned on a hero company at a Free-hold [{F}] or Border-hold [{B}] if a
minion company attacks. The attack is canceled and the minion company must
face all automatic-attacks of the site—which attack normally, not as
detainment. Afterwards, the minion company may attack the hero company
again." — `cancel-attack` (`requiresCvCC: true`,
`forceSiteAutoAttacksNormalReface: true`, `when: { "$and": [{
"attack.minionCompany": true }, { "site.type": { "$in": ["free-hold",
"border-hold"] } }] }`).

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
- `enemy.unique` — the attacking creature's printed uniqueness, resolved
  from its CardDefinition. Only populated for creature-sourced attacks
  (`attack.source` of `"creature"`, `"on-guard-creature"`, or
  `"played-auto-attack"`); absent for site automatic-attacks and other
  sources, which have no creature card. Used by *Fifteen Birds in Five
  Firtrees* (dm-129): "Playable on a moving company facing a non-unique
  hazard creature if Gates of Morning is in play" →
  `"when": { "$and": [ { "attack.source": { "$in": ["creature", "on-guard-creature", "played-auto-attack"] } }, { "enemy.unique": { "$ne": true } }, { "defender.inPlay": { "$includes": "Gates of Morning" } } ] }`.
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
- `attack.minionCompany` — the Ringwraith-alignment counterpart of
  `attack.heroCompany`: `true` only for a CvCC combat whose attacking
  company's player is a Ringwraith (minion). Used by *All the Bells
  Ringing* (as-44): "if a minion company attacks" →
  `"when": { "attack.minionCompany": true }`.
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
turn that the grant's restrictions allow; dispatching it consumes one grant and
cancels the attack immediately (no card played, no chain). Three optional
sibling flags on the `cancel-attack` effect control which restrictions the
installed constraint carries:

- `alsoCancelLaterAttackRestrictToBalrogCompany` — the later attack must be
  against a company containing The Balrog avatar ("against his company"). Used
  by Darkness Wielded (ba-55): "cancel this attack and a latter attack of your
  choice against his company this turn." — a costless `cancel-attack`
  (`alsoCancelLaterAttack` + `alsoCancelLaterAttackRestrictToBalrogCompany`)
  gated on `defender.companyContainsBalrog` + `defender.inPlay $includes
  "Great Shadow"`.
- `alsoCancelLaterAttackSameCompanyOnly` — the later attack must be against the
  *same* company that played this card (captured from `combat.companyId` at
  grant time as `restrictToCompanyId`).
- `alsoCancelLaterAttackRequireNonUnique` — the later attack must be sourced
  from a non-unique hazard creature (`enemy.unique !== true`).

Used together by Fifteen Birds in Five Firtrees (dm-129): "all attacks of the
next non-unique hazard creature the company faces this turn are also
canceled" — `alsoCancelLaterAttackSameCompanyOnly` +
`alsoCancelLaterAttackRequireNonUnique`, no Balrog restriction.

**Tap-on-strike-assignment (`installsTapOnStrikeAssignment`).** When a
`cancel-attack` effect carries `"installsTapOnStrikeAssignment": true`,
cancelling this attack also installs a **turn-scoped `tap-on-strike-assignment`
constraint** on the defending company. For the rest of the turn, whenever the
`assign-strike` reducer (`reducer-combat.ts`) assigns a *new* (not excess)
strike to a defending character during a hazard-creature-sourced combat
(`attack.source` in `creature` / `on-guard-creature` / `played-auto-attack`)
against that company, the assigned character is tapped in place if it was
untapped — `applyTapOnStrikeAssignment`, called from both the normal
assignment branch and the force-single-target (multi-attack) branch. A no-op
constraint from the legal-action layer's point of view (`applyOneConstraint`
passes it straight through) — it only affects the reducer's state mutation on
assignment, never which actions are offered. Used by Fifteen Birds in Five
Firtrees (dm-129): "An untapped character in the company must tap to face any
strike from a subsequent hazard creature attack for the rest of the turn."

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

**Cancel the rest of the site's attack sequence (`cancelsRemainingSiteAttacks`).**
When true, cancelling this attack also abandons any not-yet-faced
automatic-attacks in the site's sequence for this company's visit — "All
automatic-attacks at the site are canceled." `applyEffect`'s `cancel-attack`
branch (`apply-dispatcher.ts`), after calling `resolveCancelAttackEntry`, sets
`SitePhaseState.autoAttacksSkipped = true` when `state.phaseState.phase ===
Phase.Site` — the same "sequence abandoned" flag Farmer Maggot's site-swap and
Burglary's success use (§9e); `handleSiteAutomaticAttacks` then treats the
company's remaining automatic-attack steps as done with no further combat. A
no-op outside the Site phase (i.e. for a card that only ever fires against a
site automatic-attack, this is always in Site phase). Paired with
`influenceAtSiteModifier` below and `costExemptRace`, this backs Riven Gate
(as-98): "Magic. Sorcery. Playable on a sorcery-using character when facing the
automatic-attack at a Border-hold. All automatic-attacks at the site are
canceled, and any influence attempt against a faction at the site this turn is
modified by +2. Unless he is a Ringwraith, he makes a corruption check modified
by -4."

```json
{ "type": "cancel-attack",
  "requiredSkill": "sorcery",
  "cost": { "check": "corruption", "modifier": -4 },
  "costExemptRace": "ringwraith",
  "cancelsRemainingSiteAttacks": true,
  "influenceAtSiteModifier": 2,
  "when": { "$and": [
    { "attack.source": "automatic-attack" },
    { "site.type": "border-hold" } ] } }
```

**Site-wide influence bonus (`influenceAtSiteModifier`).** A numeric field that
adds a turn-scoped `influence-at-site-modifier` {@link ActiveConstraint} (the
same constraint kind Blasting Fire wh-51 installs via `add-constraint`) bonusing
every faction-influence attempt against a faction at the defending company's
current site for the rest of the turn (`legal-actions/site.ts` sums every
matching constraint's `value` into the influence roll, keyed by
`siteDefinitionId`, regardless of who is influencing). Resolved from the
defending company captured before the cancel clears `state.combat` — a no-op if
the site can't be resolved (defensive; never hit in practice since a
`cancel-attack` `when` clause always requires an active combat with a defending
company at a site).

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

### 9a2. `tap-discard-in-play`

Repeatable "for each of your characters you choose to tap, discard one
matching in-play card belonging to your opponent" resource short-event
ability (Praise to Elbereth tw-305: "For each of your characters in play
that you choose to tap ... cancel one Nazgûl event ... against that
character's company").

- `filter` — DSL condition each target card's `CardDefinition` must match
  (e.g. `{ "keywords": { "$includes": "Nazgûl" } }`).

Unlike `cancel-chain-entry`'s `discard the in-play card` fallback (which
rides the chain, giving the opponent a response window before the target is
discarded — CoE 9.4/9.5), `tap-discard-in-play` resolves through the same
loop-until-pass sub-flow `fetch-to-deck` uses (`GameState.pendingEffects`):
`handlePlayResourceShortEvent` (`reducer-events.ts`) queues one `card-effect`
pending effect when the card is played; while it is active,
`tapDiscardInPlayLegalActions` (`legal-actions/index.ts`) offers one
`tap-discard-in-play` action per (own untapped character × opponent's
untapped `cardsInPlay` card matching `filter`) pair, plus `pass`. Each pick
(`applyTapDiscardInPlay`, `short-event-discard.ts`) taps the character and
discards the target **immediately, with no chain entry** — the pending
effect stays queued for the next pick. Because there is no chain entry, the
opponent has no window to declare a response between a card being chosen as
a pick's target and its discard (e.g. tapping a Nazgûl permanent-event to
convert it into its short-event mode first) — this is what "may not be
tapped in response to its play" means in this engine. The discard never
triggers the target's own on-tap ability ("Nazgûl events discarded ... have
no effect"). `pass` ends the sub-flow via the generic `resolvePendingEffect`,
which discards the source card.

`heroResourceShortEventActions` (`legal-actions/long-event.ts`) gates the
card's playability (CoE 9.1, "may not play a card with no effect") on there
being either a live target for this effect or an unconditional companion
effect on the card (e.g. a `when`-less `on-event: self-enters-play`, or one
whose `when` is currently satisfied).

```json
{ "type": "tap-discard-in-play",
  "filter": { "keywords": { "$includes": "Nazgûl" } } }
```

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

### 9d. `riddling-attempt`

A resource short event playable on a character whose company is facing a
creature attack, offering a two-stage attempt to cancel it by riddling —
distinct from `flattery-cancel-attack` / `goodwill-cancel-attack` in that a
successful roll only earns the *chance* to cancel; a second, independent
guess must also succeed.

```json
{
  "type": "riddling-attempt",
  "sageBonus": 2,
  "hobbitBonus": 1,
  "hazardLimitReduction": 3,
  "thresholds": [
    { "races": ["dragon", "drake"], "threshold": 8 },
    { "races": ["man", "giant"], "threshold": 10 },
    { "races": ["slayer", "awakened-plant", "orc", "spider", "troll"], "threshold": 12 }
  ]
}
```

Used by Riddling Talk (td-148): "Character makes a roll modified by: +2 for
each sage and +1 for each Hobbit in his company. If the result is greater
than [race-keyed threshold]; then name a card and opponent must reveal his
hand. If the named card is in opponent's hand, the creature's card is
discarded (all of its attacks are canceled) and the hazard limit against the
character's company is decreased by three."

**Offering** (`legal-actions/combat.ts`): mirrors `flattery-cancel-attack` —
one `cancel-attack` action per character in the defending company, gated on
the attacking creature's race having a `thresholds` entry.

**Stage 1 — the roll** (`chain-reducer.ts` enqueues a `riddling-attempt`
pending resolution when the chain entry resolves un-negated; resolved by
`applyRiddlingAttemptResolution` in `pending-reducers.ts`). The roll is 2d6 +
`sageBonus` for each Sage-skilled character in the maker's company +
`hobbitBonus` for each Hobbit-race character in the company (company found
via `findCharacterCompany`, not just the acting character). On success —
roll > threshold — a `riddling-guess` resolution is enqueued *instead of*
resolving the cancel; the attack is not yet cancelled. On failure the chain
entry resolves normally and combat continues.

**Stage 2 — the guess** (`applyRiddlingGuessResolution`). One
`riddling-guess` action exists per distinct card name among
`hazard-event`/`hazard-creature` definitions in the card pool
(`riddlingGuessActions`, `legal-actions/pending.ts`) — the player names any
card, blind. On resolution the opponent's entire hand is revealed
(`revealInstances`, recorded in `GameState.revealedInstances`) and checked
for a card whose definition name matches the guess. A match cancels the
attack (`resolveCancelAttackEntry`) and decreases `hazardLimitAtReveal` by
`hazardLimitReduction` (Movement/Hazard phase only, floored at 0); no match
leaves the attack in effect. Either way the guess resolution dequeues and
the chain entry resolves.

### 9e. `burglary-attempt`

A site-phase alternative to facing a site's automatic-attacks.

```json
{
  "type": "burglary-attempt",
  "threshold": 10,
  "scoutBonus": 2,
  "hobbitBonus": 3
}
```

Used by Burglary (td-103): "Tap a character to make a burglary attempt at a
site in lieu of facing its automatic-attacks. Tap the site and make a roll
modified by +2 if the character is a scout and by +3 if he is a Hobbit. If
the result is greater than 10, an item normally playable at the site may be
played with the character. If the attempt fails, the character must face
all automatic-attacks alone."

**Offering** (`legal-actions/site.ts`, `automaticAttacksActions`): one
`declare-burglary` action per untapped character in the active company,
while the `automatic-attacks` step has not yet faced any attack this slot
(`automaticAttacksResolved === 0`, no earlier burglary success/failure), the
site has at least one active automatic-attack, and a card carrying this
effect is in hand.

**Declaration** (`reducer-site.ts`, `handleSiteAutomaticAttacks`): taps the
character and the site (unless `never-taps`), discards the card, and
enqueues a `burglary-attempt` pending resolution — kept separate from the
site step so a future on-guard interaction (Half an Eye Open, td-29: "may be
revealed as an on-guard card when a burglary attempt is announced" to modify
the roll by -5) can hook the same window later.

**The roll** (`legal-actions/pending.ts` `burglaryAttemptRollActions`,
`pending-reducers.ts` `applyBurglaryAttemptResolution`): 2d6 + `scoutBonus`
if the character has the Scout skill + `hobbitBonus` if he is a Hobbit,
compared against `threshold`.

- **Success** sets `SitePhaseState.autoAttacksSkipped = true` (the existing
  Farmer Maggot as-48 "sequence abandoned" flag — `handleSiteAutomaticAttacks`
  already treats it as "all attacks resolved" with no combat) and
  `SitePhaseState.burglaryItemUnlock = characterInstanceId`: `playResourcesActions`
  and `handleSitePlayHeroResource` let that one (already-tapped) character
  receive one item normally playable at the site, consuming the allowance.
- **Failure** sets `SitePhaseState.soloAutoAttackCharacterId = characterInstanceId`,
  threaded into every automatic-attack `CombatState` built for this company
  slot (including the race-duplicate, Incite Defenders, and No Strangers at
  this Time copies) as `CombatState.soloDefenderInstanceId`. Both halves of
  `assignStrikeActions` (`legal-actions/combat.ts`) restrict the defending
  company to just that character when the field is set — no other company
  member (nor an ally hosted by one) can be assigned a strike — and the
  "each character faces one strike" pre-assignment in `reducer-site.ts` is
  restricted the same way. On-guard creature combat is untouched (a separate
  code path from `handleSiteAutomaticAttacks`), matching the CRF ruling that
  on-guard creatures are still faced by the whole company regardless of a
  burglary attempt's outcome.

Both `SitePhaseState.soloAutoAttackCharacterId` and `burglaryItemUnlock` are
explicitly reset to absent whenever a fresh `SitePhaseState` is built for a
new company slot.

### 10. `strike-modifier`

Played from hand during strike resolution as a short event. Covers four
resolution modes driven by flags on the effect:

**Cancel mode** (`"cancel": true`): the current strike is canceled outright,
no roll made. An optional `filter` gates availability on the strike target
character, evaluated against the same `target.*` context as reroll mode.
Resolves immediately — no chain, matching the item-based `cancel-strike`
(§11) and `flee-from-strike` (§11a) precedent of not offering the opponent
a response window.

```json
{ "type": "strike-modifier", "cancel": true,
  "filter": { "$and": [
    { "target.race": "orc" },
    { "target.skills": { "$includes": "scout" } }
  ] } }
```

Used by Orc Stealth (le-217): "Orc scout only. Cancel one strike against an
Orc scout." — the target must be both race `orc` and carry the `scout` skill.

**Dodge mode** (`"dodge": true`): the target character resolves the strike
at full prowess without tapping (unless wounded). If wounded, `bodyPenalty`
applies to the resulting body check. The play goes through the chain so the
opponent may respond. Optionally gated by a `requiredSkill` on the struck
character (enforces CoE 3.iv.5: only one skill-requiring resource per
strike, same as default mode; e.g. Blow Turned: "Warrior only").

```json
{ "type": "strike-modifier", "dodge": true, "bodyPenalty": -1 }
```

```json
{ "type": "strike-modifier", "dodge": true, "bodyPenalty": -1,
  "requiredSkill": "warrior" }
```

**Item-tap dodge** (`"dodge": true` plus `"cost": { "tap": "self" }`): the
effect lives on an in-play item/ally instead of a hand card — the source
taps itself to dodge the current strike for its own bearer. Resolves
immediately, no chain (matching the item-based `cancel-strike` precedent),
and emits a `dodge-strike` action instead of `play-strike-event`.

```json
{ "type": "strike-modifier", "dodge": true,
  "cost": { "tap": "self" },
  "when": { "bearer.skills": { "$includes": "warrior" } } }
```

Used by Great-shield of Rohan (tw-250): "Warrior only: tap Great Shield of
Rohan to remain untapped against one strike (unless the bearer is wounded by
the strike)."

**Reroll mode** (`"reroll": true`): two 2d6 rolls are made and the better
total is used. The card's text says nothing about tapping, so it doesn't
override the defender's independent CoE 3.iv.3 choice — two `play-strike-event`
actions are offered, mirroring plain `resolve-strike`: tap to fight at full
prowess (`tapToFight: true`), or stay untapped with the usual -3 prowess
penalty (`tapToFight: false`, only while the combatant is untapped). An
optional `filter` gates availability on the strike target character,
evaluated against a `target.*` context carrying the target's race, skills,
and name.

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

- `cancel` — if `true`, the strike is canceled outright, no roll made (cancel mode).
- `dodge` — if `true`, character resolves without tapping (dodge mode).
- `reroll` — if `true`, roll twice and use the better result (reroll mode).
- `prowessBonus` — added to the character's prowess for the strike roll
  (may be negative; used in default and dodge modes). Omit for 0.
- `bodyPenalty` — added to the character's body on the resulting body
  check if wounded (typically negative). Omit for 0.
- `requiredSkill` — the struck character must carry this skill. Omit to
  allow any character (default and dodge modes; enforces CoE 3.iv.5 in both).
- `filter` — condition on the strike target character (reroll and cancel modes only).
- `cost` — if `{ "tap": "self" }`, this is an item/ally-tap dodge ability
  (item-tap dodge, see above) rather than a hand-played short event. Only
  meaningful combined with `dodge: true`.

Hand-played modes emit a `play-strike-event` action during resolve-strike
and discard the card from hand after use. The item-tap dodge variant emits a
`dodge-strike` action and taps the item/ally instead. Implemented in
`engine/legal-actions/combat.ts` (availability scan) and
`engine/combat-actions.ts` / `engine/combat-cancel.ts`
(`resolveChainStrikeModifier`).

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

### 10d. `modify-attack` — `scope: "current-strike"` (item, single-strike modifier)

Activated ability on an in-play item that modifies only the single strike
currently being resolved — not the whole attack (contrast with the
whole-attack `modify-attack` of §10c, which adjusts `CombatState.strikeProwess`
/ `creatureBody` for every defender). `prowessModifier` is added directly to
`StrikeAssignment.strikeProwessBonus` (a positive value benefits the bearer,
mathematically equivalent to reducing the creature's prowess for this one
comparison); `bodyModifier`, if present, is added to a per-strike
`StrikeAssignment.strikeCreatureBodyModifier`, affecting only this strike's
own creature body check (not persisted to `CombatState.creatureBody`, so
later strikes of the same attack see the unmodified body). Available during
`resolve-strike` while the item belongs to the current strike target
character.

Two cost variants:

- `cost: { "tap": "self" }` — the item must be untapped; taps on activation.
  Used by Shield of Iron-bound Ash (tw-327): tap to gain +1 prowess against
  one strike.
- `cost: { "discard": "self" }` — no status requirement (the item leaves
  play either way); discarded to the owner's discard pile on activation.
  Used by Arrows Shorn of Ebony (td-99, see `cascadeDefeatOnSuccess` below).

An optional `when` gate is evaluated against a context exposing `bearer.race`,
`bearer.skills`, `bearer.name`, `enemy.race`, and `attack.*` (`source`,
`keying`, `siteKeyed`, `weaponsIneffective` — the same fields the whole-attack
scope exposes, built by the shared `modifyAttackWhenContext` helper).

```json
{ "type": "modify-attack", "scope": "current-strike",
  "cost": { "tap": "self" },
  "prowessModifier": 1 }
{ "type": "modify-attack", "scope": "current-strike",
  "cost": { "discard": "self" },
  "prowessModifier": 1,
  "bodyModifier": -2,
  "cascadeDefeatOnSuccess": true,
  "when": { "$and": [
    { "bearer.skills": { "$includes": "warrior" } },
    { "attack.source": "creature" },
    { "attack.siteKeyed": false }
  ] } }
```

**`cascadeDefeatOnSuccess`** (current-strike scope only): when `true`, if
this modified strike ultimately resolves as defeated
(`StrikeAssignment.result` ends as `'success'` — including passing any
creature body check this strike triggers), every other still-unresolved
strike of the same attack automatically resolves as defeated too, by setting
`CombatState.forcedStrikeDefeat` (the same flag Liquid Fire wh-52 sets at
combat *initiation* — here it is set *mid-combat*, once the triggering
strike's fate is known). The decision is made where `'success'` becomes
final: immediately in `resolveStrikeCore` when the creature has no body (no
body check needed), or in `handleBodyCheckRoll`'s creature branch once that
strike's own body check confirms the creature died. Used by Arrows Shorn of
Ebony (td-99): "Warrior only: discard Arrows Shorn of Ebony to modify a
strike from a hazard creature attack not keyed to a site by -1 prowess, -2
body. If this strike is defeated, all other subsequent failed strikes from
this attack are automatically defeated."

Implemented in `engine/legal-actions/combat.ts` (`tapItemForStrikeActions`,
`modifyAttackWhenContext`) and `engine/combat-actions.ts`
(`handleTapItemForStrike`, `handleBodyCheckRoll`) and
`engine/combat-strike.ts` (`resolveStrikeCore`).

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

### 10e-bis. `modify-attack` — tapped in play (`fromAltPermanentEvent: true`)

A third source for the same modifier math: an **in-play dual-mode creature
permanent-event** (`creature-alt-event` mode `permanent-event`, not
`persistent`) that the hazard player converts to a short-event during the
opponent's movement/hazard phase. Set `fromAltPermanentEvent: true` alongside
`player` instead of `fromHand`.

The conversion is offered in the same pre-assignment combat window as a
from-hand `modify-attack` — that is where "any one attack" has an attack to
name — and applying it:

- removes the card from `cardsInPlay` and discards it ("becomes a short-event"),
- charges **one hazard-limit slot** against the defending company (unless the
  card carries `play-flag: no-hazard-limit`), and
- applies `strikesModifier` / `prowessModifier` / `bodyModifier` to the live
  attack exactly as the from-hand path does.

Because the tap happens here, `tap-alt-permanent-event` is neither offered
(`tapAltPermanentEventActions`) nor accepted (`handleTapAltPermanentEvent`) for
such a card — the M/H play-hazards step has no attack to modify.

```json
{ "type": "modify-attack", "fromAltPermanentEvent": true,
  "player": "attacker", "strikesModifier": 1 }
```

Example: Hoarmûrath of Dír (tw-44) — "If played as a permanent-event, it will
remain in play until tapped during the opponent's movement/hazard phase
(tapping counts against the hazard limit). When tapped, Hoarmûrath of Dír
becomes a short-event and gives +1 strike to any one attack."

Implemented in `engine/legal-actions/combat.ts`
(`altPermanentEventModifyAttackActions`) and `engine/combat-actions.ts`
(`handleModifyAttack`).

### 10e-ter. `modify-attack` `attachCorruptionOnWound` (dynamic post-attack corruption attachment)

A from-hand `modify-attack` (attacker-played) may carry
`"attachCorruptionOnWound": true` to additionally attach *itself*, as a
corruption card, to whichever character the attack ends up wounding — a
target that isn't known until after combat resolves, unlike every other
corruption card (which is played onto a specific character up front). Used
by Icy Touch (td-33): "Playable on a company facing an Undead attack. The
prowess of the attack is modified by +1. Corruption. The next character
wounded by the attack (on whom a corruption card has not already been
played this turn) receives 2 corruption points (place this card with the
character). Discard Icy Touch if it is not played with a character."

```json
{ "type": "modify-attack", "fromHand": true, "player": "attacker",
  "prowessModifier": 1,
  "attachCorruptionOnWound": true,
  "when": { "enemy.race": "undead" } }
```

The card is still discarded immediately when played, exactly like any other
from-hand `modify-attack` (`handleModifyAttack`, `combat-actions.ts`) — the
only addition is that `CombatState.pendingCorruptionAttach` is set to
`{ sourceCardInstanceId, sourceCardDefinitionId, ownerPlayerIndex }`, marking
the just-discarded instance as eligible for reattachment.

At combat finalization (`finalizeCombat`, `combat-finalize.ts`), the engine
reuses the `woundedCharIds` list it already computes for
`woundedByRaceThisTurn` (strike-array order; empty under detainment, since a
detainment strike taps rather than wounds). It scans that list for the
first character who (a) is still in play and (b) has not already had a
corruption card played on him this turn — checked against
`MovementHazardPhaseState.corruptionCardsPlayedPerChar`, when the phase state
is available (Movement/Hazard phase only, matching every other consumer of
that field; site-phase automatic attacks have no such bookkeeping, so every
wounded character there is treated as eligible). If a match is found, the
card is spliced out of `ownerPlayerIndex`'s discard pile and pushed onto the
matched character's `hazards`, and `corruptionCardsPlayedPerChar` is updated.
If no eligible character was wounded, the card simply remains in the discard
pile — "discard if not played with a character" requires no separate code
path. The corruption-point value itself is an ordinary `stat-modifier`
effect on the card (`{ "type": "stat-modifier", "stat": "corruption-points",
"value": 2 }`), picked up automatically once the instance sits in
`char.hazards` — the same mechanism every other corruption card uses.

Note: "the *next* character wounded" is read as strike-array order, not
strict dice-roll chronology — when a multi-strike attack has more than one
strike outstanding, the defender may choose to resolve them in a different
order (`combat-strike.ts` `choose-strike-order`), which this simplification
does not track. This mirrors the existing precision of `woundedCharIds`
itself (also array order) and is judged an acceptable approximation given
how rarely multi-strike Undead attacks occur and how rarely a defender would
deliberately reorder them.

Implemented in `engine/combat-actions.ts` (`handleModifyAttack`) and
`engine/combat-finalize.ts` (`finalizeCombat`).

### 10e-quater. `modify-attack` `grantAttackerChoosesDefenders` / `bodyCheckModifier`, and multiple from-hand modes on one card

A card may declare **more than one** `modify-attack` (`fromHand: true`)
effect — distinct modes gated by different `player`/`when` combinations, one
per printed "Alternatively, playable on ..." clause. Both the offering
(`modifyAttackActions`, `legal-actions/combat.ts`) and the reducer
(`handleModifyAttack`, `combat-actions.ts`) select the **first** effect whose
`player` matches the acting side and whose `when` (if any) matches — the same
"modes tried in order" convention used elsewhere for on-event effects
(Choking Shadows). In practice each mode's `when` describes a mutually
exclusive combat (e.g. "attack *against* her" vs. "attack *by* her"), so at
most one ever matches at a time; the reducer reuses the exact same context
builder (`buildPlayedModifyAttackContext`) as the legal-action generator, so
it always applies whichever effect was actually offered.

Two additional fields, usable on any from-hand mode:

- `grantAttackerChoosesDefenders: true` — sets
  `CombatState.attackerChoosesDefenders`. Since a from-hand `modify-attack`
  can only be played before any strike is assigned, `assignmentPhase` is
  still `'defender'` (the normal CvCC/creature start) — the effect redirects
  it straight to `'attacker'` rather than waiting for a defender pass. The
  existing assignment machinery (`cvccAttackerAssignActions` for CvCC,
  ordinary attacker-assignment for creature attacks) then runs unmodified
  from a cold start, exactly as it already does when a creature's own
  `combat-attacker-chooses-defenders` effect sets the flag at combat
  creation. The opposite of `removeAttackerChoosesDefenders` (§10c).
- `bodyCheckModifier: N` — adds to `CombatState.bodyCheckModifier`, the
  pre-existing attack-wide body-check modifier (§12 `combat-body-check-modifier`)
  that `handleBodyCheckRoll` already folds into every body check of the
  combat — creature and character alike. Distinct from `bodyModifier`, which
  changes the creature's own body *stat*, not the body-check roll.

The `when` context (`buildPlayedModifyAttackContext`) gained
`defender.companySize` / `defender.characterNames` (any attack — the
defending company's roster) and, for CvCC attacks only,
`attacker.companySize` / `attacker.characterNames` (resolved from
`attackSource.attackingCompanyId`), letting a card gate on "the only
character in her company" from either side without a hardcoded name/race
keyword.

```json
{ "type": "modify-attack", "fromHand": true, "player": "defender",
  "setStrikesTo": 1, "bodyModifier": -2,
  "when": { "$and": [
    { "defender.companySize": 1 },
    { "defender.characterNames": { "$includes": "Adûnaphel the Ringwraith" } }
  ] } }
{ "type": "modify-attack", "fromHand": true, "player": "attacker",
  "grantAttackerChoosesDefenders": true, "bodyCheckModifier": 2,
  "when": { "$and": [
    { "attacker.companySize": 1 },
    { "attacker.characterNames": { "$includes": "Adûnaphel the Ringwraith" } }
  ] } }
```

Example: Adûnaphel Unleashed (le-161) — "Playable on any attack against
Adûnaphel the Ringwraith (as your Ringwraith) if she is the only character in
her company. The number of strikes of the attack is reduced to one and the
attack's body is modified by -2. Alternatively, playable on any attack by a
lone Adûnaphel the Ringwraith (as your Ringwraith). You choose defending
characters. Any resulting body checks for defending characters are modified
by +2. Cannot be duplicated on a given attack." — Mode A (defender play)
reduces the attack against her; Mode B (attacker play) grants her the
attacker-chooses-defenders rule and boosts the resulting body checks; a
shared `duplication-limit` (`scope: "attack"`) covers both modes since it is
keyed by card definition ID, not by which mode was played.

Implemented in `engine/legal-actions/combat.ts` (`modifyAttackActions`,
`buildPlayedModifyAttackContext`) and `engine/combat-actions.ts`
(`handleModifyAttack`).

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

### 11a-2. `sacrifice-of-form`

A from-hand **Wizard-only** combat permanent-event, offered to the defending
player once strikes are assigned against a company containing their Wizard
avatar and before any strike of that attack has resolved (`combat.phase` is
`choose-strike-order`, or `resolve-strike` with every `strikeAssignment`
still `resolved: false`). Not offered when the attack source is
`company-attack` ("cannot be used in company vs. company combat"), or when
any in-play card already carries `sacrificeOfFormCharacterInstanceId` for
that Wizard's instance ("cannot be duplicated on a given Wizard").

```json
{ "type": "sacrifice-of-form" }
```

On play (`play-sacrifice-of-form` action → `handleSacrificeOfForm` in
`combat-actions.ts`):

- the card leaves hand and enters the controller's `cardsInPlay` stamped
  with `sacrificeOfFormCharacterInstanceId` (the Wizard's instance ID) — not
  yet `attachedTo` him, since he is about to leave play;
- `CombatState.forcedStrikeDefeat` is set and `forcedDefeatBodyCheckModifier`
  raised by `+3` — the same mechanism Liquid Fire (wh-52) uses, so every
  remaining strike of the attack auto-resolves as defeated and any creature
  body check it produces is modified by `+3` ("all strikes … fail; +3 to any
  body checks made to determine if the attack is defeated");
- `CombatState.pendingSacrificeOfForm` records the host and Wizard instance
  IDs for the deferred discard below.

The Wizard is **not** discarded immediately — his `CharacterInPlay` data must
stay available while any other strikes of the same attack (assigned to him or
to company-mates) still resolve, per the CRF ruling that he "faces any
effects of a failed strike that was assigned to him" (e.g. Dragon's Blood).
Instead, `sweepSacrificeOfForm` (`engine/sacrifice-of-form.ts`, hooked into
`postReduce` in `reducer.ts` via the same prev/next `combat` diff
`enqueuePostAttackPlayOffers` uses to detect "an attack just ended" — see
§ Pending resolutions) fires once the whole attack has concluded:

- his allies are discarded (or returned to hand, per the normal
  `partitionLeavingAllies` rule), his attached hazards return to their own
  owners, and his followers disperse to general influence (`freeOrDiscardFollowers`
  — **not** discarded, per CRF);
- his items are placed "off to the side" with the host card via `placeCardSetAside`
  (MEAS §1, `set-aside.ts`) with `keepOnHostRemoval: true` — they stay in play
  even if the host itself is later discarded;
- the Wizard card itself goes to his owner's discard pile ("he becomes
  unrevealed");
- `PlayerState.wizardSacrificed` is set to the Wizard's definition ID (once,
  never cleared — see below).

If the same Wizard is ever put back into play by any means, `sweepSacrificeOfFormReturn`
(same module, same prev/next-diff pattern watching for a `characters` map
entry newly appearing for an instance ID some in-play host still names with no
`attachedTo` yet) reattaches the host (`attachedTo` set to him) and moves every
item from the host's `setAside` list onto his `items[]`. Because
`collectCharacterEffects` (`effects/resolver.ts`) has no generic pathway that
turns a plain `attachedTo`-attached permanent-event's own `effects` into
bearer stat modifiers (unlike `attachedToItem`, which does), the host's own
`+1 prowess/body/direct-influence` `stat-modifier` effects are synthesised at
reattach time into `until-cleared` `character-stat-modifier` active
constraints on him — the same delivery mechanism opposed-roll outcomes and
Vilya-style bonuses use.

"You may not play a different Wizard" is enforced via `PlayerState.wizardSacrificed`
(mirroring the Ringwraith `ringwraithReturnedToHand` restriction, but never
cleared — CoE 2.II.2.1.1 bars a *different* avatar reveal for the rest of the
game, not just until the same one replays) and two `CHARACTER_PLAY_RULES`
gates (`rules/definitions/character-play.ts`): `differentWizardBlockedBySacrifice`
blocks this player from revealing a different Wizard avatar, and
`opponentSacrificedThisWizard` blocks the opponent from revealing this exact
one — though ordinary ownership invariants (a player can never play a card
from another player's discard pile) already make the opponent clause
unreachable in practice; the gate exists for symmetry with the ruling text.

```json
{ "type": "sacrifice-of-form" }
{ "type": "stat-modifier", "stat": "prowess", "value": 1 }
{ "type": "stat-modifier", "stat": "body", "value": 1 }
{ "type": "stat-modifier", "stat": "direct-influence", "value": 1 }
```

Used by Sacrifice of Form (tw-321): "Spell. Wizard only. All of the strikes
from one attack against your Wizard's company fail; +3 to any body checks
made to determine if the attack is defeated. Discard the Wizard … Place any
items he controls under this card and keep these off to the side … If the
Wizard is put back into play, return his items to him and place Sacrifice of
Form with him. Wizard receives +1 to his prowess, body, and direct
influence. Cannot be duplicated on a given Wizard. Cannot be used in company
vs. company combat. After Sacrifice of Form is played, you may not play a
different Wizard and your opponent may not play the Wizard you sacrificed.
This card is played after strikes are assigned."

### 11b. `protect-from-strike-assignment`

A short event played from hand during the **defending** player's
`assign-strikes` sub-phase — "before strikes are assigned" — that shields one
company member from receiving any strike of the current attack for the rest
of that sub-phase. Unlike `cancel-attack` (cancels the whole attack) this
only removes one character from the assignable pool; other characters may
still be assigned strikes normally.

Eligibility is checked per candidate character in the defending company:

- `requiredSkill` (optional) — the *target* character must have this skill
  (Ruse le-225 mode B: "playable on a scout facing an attack").
- `filter` (optional, a `Condition`) — a generic eligibility gate evaluated
  against `{ target: { race, status, skills, name }, company: { hasShadowMagicUser } }`
  (the same context shape `organization-events.ts`'s play-target filter
  uses). Combined with `requiredSkill` via AND when both are present.

At least one of `requiredSkill`/`filter` should be present, or every company
member is a valid target unconditionally.

An optional `corruptionCheck: { modifier, on: "shadow-magic-user" }` forces a
corruption check as a side effect of playing the card — on the target's
company's shadow-magic user (Ringwraith by race, or `skills` includes
`"shadow-magic"`), not on the protected target itself. If **any** qualifying
company member is a Ringwraith, the whole company is exempt and no check is
made; otherwise the first non-Ringwraith shadow-magic user checks. `on:
"shadow-magic-user"` is currently the only supported source.

```json
{ "type": "protect-from-strike-assignment", "requiredSkill": "scout" }
{ "type": "protect-from-strike-assignment",
  "filter": { "company.hasShadowMagicUser": true },
  "corruptionCheck": { "modifier": -4, "on": "shadow-magic-user" } }
```

Used by Ruse (le-225) mode B: "Alternatively, playable on a scout facing an
attack. No strikes of the attack may be assigned to the scout." —
`requiredSkill: "scout"`, no corruption check.

Used by Sojourn in Shadows (wh-49): "Playable before strikes are assigned on
a character facing an attack in a shadow-magic using character's company.
Target character cannot be assigned a strike from the attack. Unless he is a
Ringwraith, the shadow-magic using character makes a corruption check
modified by -4." — `filter: { "company.hasShadowMagicUser": true }` (any
company member is a valid target, not just the shadow-magic user) +
`corruptionCheck: { modifier: -4, on: "shadow-magic-user" }`.

### 12. Combat-rule effects

Each combat-mechanics override is a distinct effect type. The chain
reducer dispatches on the effect's `type`, so adding a new override is a
one-line union extension plus the matching branch — no opaque rule
strings to chase through the engine.

- `combat-attacker-chooses-defenders` — the attacking player assigns
  strikes instead of the defender (implemented in `chain-reducer.ts`).
  Without `scope` the rule is **self-bound**: it belongs to the creature
  card carrying it and applies only when that creature attacks. With
  `scope: "all-attacks"` it becomes **global** while the carrying card
  sits in either player's `cardsInPlay` — every attack (hazard creature
  *and* site automatic-attack) whose race satisfies `when` hands strike
  assignment to the attacker. The `when` context exposes
  `attack.creatureRace` (the attacking creature's normalized race), the
  same vocabulary as the global `body-check-modifier`. Collected by
  `globalAttackerChoosesDefenders` / `resolveAttackerChoosesDefenders`
  (`reducer-utils.ts`), which every combat-creation site consults.
  Used by the permanent-event half of Alatar the Hunter (as-7): "all
  Maia attacks: … attacker chooses defending characters."
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
- `combat-body-per-defender-skill` — self-bound to the creature: its own
  `body` is adjusted by `value` for each defending company member with the
  given `skill` (their effective skills, including `grant-skill` /
  `override-skills` contributions), resolved once at combat initiation and
  floored at 0. Card text is "Each ranger in attacked company lowers [the
  creature]'s body by 2" (e.g. Little Snuffler dm-108: `skill: "ranger"`,
  `value: -2`). (implemented in `chain-reducer.ts`)
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
  companies". Also accepts an optional `awardsKillMp: true` for a
  creature whose own printed text produces the tap-instead-of-wound
  outcome without the card ever using the "detainment" keyword (per the
  glossary, "detainment" is a keyword that must appear on the card) — the
  strike still resolves as detainment, but rule 3.II.3 does not apply, so
  a defeated creature still routes to the attacked player's kill pile and
  awards its printed kill-MP (e.g. Neeker-breekers, tw-493: "...is only
  tapped instead—no body checks are made" never says "detainment").
  (implemented in `engine/detainment.ts`, `reducer-combat.ts`,
  `combat-finalize.ts`)
- `combat-strike-effect` — self-bound creature version of the agent-attack
  `strikeEffect: "discard-item"` precedent (§40.1 `agent-attack-modifier`).
  A successful strike does not wound the defending character; instead an
  item must be discarded (defender's choice) via the `discard-item-from-company`
  combat phase. Only field beyond `type` is `strikeEffect`, one of:
  `"discard-item"` (the discard pool is every item held anywhere in the
  defending **company**) or `"discard-item-character"` (the pool is scoped
  to items borne by the **struck character** alone). Threaded onto
  `CombatState.strikeEffect` at combat initiation (`initiateCreatureCombat`,
  `chain-reducer.ts`) and resolved by the same generic path in
  `combat-strike.ts` shared with agent attacks — detainment strikes never
  trigger it. `combat-strike.ts` reads `combat.strikeEffect` to decide the
  discard pool (whole company vs. `[strike.characterId]`) when building
  `discardItemOptions`; the rest of the flow (legal actions, reducer) is
  scope-agnostic. Card text is "For each successful strike, an item held by
  the defending company must be discarded (defender's choice); the
  defending character is not harmed" (e.g. Thief, tw-102) for the company
  variant, or "For each successful strike, an item the defending character
  bears must be discarded (defender's choice); he is not harmed" (e.g.
  Pick-pocket, tw-79) for the character-scoped variant.

```json
{ "type": "combat-attacker-chooses-defenders" }
{
  "type": "combat-attacker-chooses-defenders",
  "scope": "all-attacks",
  "when": { "attack.creatureRace": "maia" }
}
{ "type": "combat-multi-attack", "count": 3 }
{ "type": "combat-cancel-attack-by-tap", "maxCancels": 2 }
{ "type": "combat-one-strike-per-character" }
{ "type": "combat-body-per-defender-skill", "skill": "ranger", "value": -2 }
{ "type": "combat-tap-low-mind" }
{ "type": "combat-detainment" }
{ "type": "combat-detainment", "awardsKillMp": true }
{ "type": "combat-strike-effect", "strikeEffect": "discard-item" }
{ "type": "combat-strike-effect", "strikeEffect": "discard-item-character" }
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

### 13-bis. `deck-restriction`

The build-time sibling of `play-restriction`: a restriction the *deck
validator* enforces, not the engine. `validateDeck`
(`packages/shared/src/deck-validation.ts`) is the only consumer — a card
carrying one of these rules is rejected (or admitted) while the deck list is
checked, so the situation never reaches the table.

**`excluded-from-deck`** — the card may not appear in any non-location section
of a deck whose alignment matches the effect's `when` condition, evaluated
against `{ deck: { alignment } }` (`"hero"`, `"minion"`, `"fallen-wizard"`,
`"balrog"`). `reason` names the CoE rule and is quoted in the error message
(`<alignment> deck: "<name>" is not allowed (<reason>)`).

This carries the rule 1.18 Fallen-wizard ban list (Bade to Rule, The Balrog,
Cracks of Doom, Favor of the Valar, Gollum's Fate, …) and the rule 1.23 Balrog
ban list (Above the Abyss, Balrog of Moria, the Ringwraith *Unleashed* cards,
…). A card banned by **both** rules declares one effect per rule rather than a
single `$in` condition, so each error still cites the rule that produced it.

```json
{ "type": "deck-restriction", "rule": "excluded-from-deck",
  "when": { "deck.alignment": "fallen-wizard" }, "reason": "rule 1.18" }
```

**`any-location-deck`** — a Balrog site with no hero or minion counterpart
(Ancient Deep-hold ba-83, The Wind-deeps ba-104, The Drowning-deeps ba-89, The
Rusted-deeps ba-96, Remains of Thangorodrim ba-95). Rule 1.25 / CoE 1.4.1 lets
*any* player put one copy in their location deck, so the hero (rule 1.26) and
minion (rule 1.27) location-deck checks admit it despite its `balrog-site` card
type. Every other Balrog site still requires a Balrog player's deck.

```json
{ "type": "deck-restriction", "rule": "any-location-deck" }
```

**`superseded-by-balrog-site`** — a **minion** site that has a Balrog-specific
reprint (Moria le-392, Carn Dûm le-359, Dol Guldur le-367, Minas Morgul
le-390). Rule 1.29: a Balrog player must use the Balrog version, so the minion
original is rejected from a Balrog location deck.

```json
{ "type": "deck-restriction", "rule": "superseded-by-balrog-site" }
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
- `"agent"` — one copy per agent, counted by name across `cardsInPlay` entries
  sharing the target agent's `attachedToAgentId` (e.g. Never Seen Him dm-74,
  "Cannot be duplicated on a given agent").

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

The `move` apply's `to` need not be `discard`: *Bade to Rule* (le-167) instead
declares `to: "in-play-on-character"`, so instead of discarding itself the bare
card **attaches** itself onto the just-entered avatar ("Place this card with
your Ringwraith when he comes into play"). `applyAvatarEntersPlayEffects`
threads the newly-played character's instance id through as
`ctx.targetCharacterId`, which `in-play-on-character` resolves as its bearer:

```json
{ "type": "on-event", "event": "avatar-enters-play",
  "apply": { "type": "move", "select": "self", "from": "self-location", "to": "in-play-on-character" } }
```

Getting the card into `cardsInPlay` bare in the first place — before the
avatar exists to attach to — is handled by an `untargeted: true` `play-option`
on the same card (see `play-option`'s "Organization-phase permanent events"
paragraph below): when its `play-target: character` effect finds no
qualifying character, the untargeted option's `when` is consulted instead of
rejecting the play.

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

### 15c-bis. `play-flag: "rescues-prisoners"`

Marks a card whose successful play *is* a prisoner rescue — carried by Rescue
Prisoners (tw-315). When such a card is **kept** (a bearer is assigned in the
`select-card-bearer` resolution; the declined branch discards it and does not
count), `markPrisonersRescuedAtDolGuldur` records the rescue on the current
`SitePhaseState`. The same helper is called from the generic CoE 8.36
`rescue-prisoner` paths (immediate free, and after the rescue-attack is faced),
so every route to "characters taken prisoner were freed" is covered by one
marker.

Today the marker is site-specific: it sets
`SitePhaseState.prisonersRescuedAtDolGuldurThisSitePhase` only when the
rescuing company stands at a site **named** "Dol Guldur" (any printing).
`legal-actions/site.ts` exposes it to `when` clauses as
`company.prisonersRescuedAtDolGuldurThisSitePhase`, which is how Pass the Doors
of Dol Guldur (dm-154) gates its tap ability on "during the same site phase the
company successfully plays Rescue Prisoners at Dol Guldur (or rescues
characters taken prisoner if the rescue site is Dol Guldur)". Because the flag
lives on the per-company site-phase state (rebuilt for every company's site
phase), it is company- *and* site-phase-scoped for free.

```json
{ "type": "play-flag", "flag": "rescues-prisoners" }
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
`{ target: { race, status, skills, name, mind, inAvatarCompany, itemKeywords, itemSubtypes, possessions }, company: { skills, siteType, siteName, moving, hasShadowMagicUser } }` (`company.siteName` is the candidate's company's current site's printed name, `null` when the company has no current site — e.g. Paths of the Dead tw-302 gates on `{ "company.siteName": "Dunharrow" }` alongside `{ "target.name": "Aragorn II" }`; `target.mind` is the character's printed mind, null for avatars — e.g. Awaiting the Call le-165 filters `{ "target.mind": { "$lte": 6 } }`; `target.itemKeywords`/`target.itemSubtypes` aggregate the keywords/subtypes of every item the character bears, and `target.possessions` their names — e.g. The Roving Eye le-135 gates on bearing a Palantír (`itemKeywords $includes "palantir"`), a greater item (`itemSubtypes $includes "greater"`), or a non-gold ring (`itemKeywords $includes "ring"` and `$not itemSubtypes $includes "gold-ring"`)), so there are no
card-specific target keywords in the engine — a card declares its
audience directly via a condition expression.

`target.isRevealedAvatar` is `true` only for the player's **own revealed
avatar** — the generally-controlled avatar character returned by
`findPlayerAvatar` — and never for a Ringwraith *follower* controlled by that
avatar. It is what distinguishes "playable on **your Ringwraith**" from
"playable on a Ringwraith". Populated for organization-phase permanent-event
play-target evaluation (`legal-actions/organization-events.ts`) and for
short-event play options (`buildPlayOptionContext`). Used by *While the Yellow
Face Sleeps* (le-255): `filter: { "$and": [ { "target.race": "ringwraith" },
{ "target.isRevealedAvatar": true } ] }`.

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

`company.destinationSiteRegionType` is the {@link RegionType} of the region
containing the candidate's company's **declared destination site**
(`charCompany.destinationSite`, resolved via `siteRegionTypeOf`), or `null`
when the company has no declared destination. Unlike `destinationRegionTypes`
(the M/H-only array of regions *traversed* along the resolved path), this
field is available in the **organization** phase — as soon as `plan-movement`
sets a destination — because it is derived from the destination site's own
printed `region`, not from a resolved travel path. Used by *Secret Entrance*
(tw-324): "may not be played on a company moving to a site in a Dark-domain
[{d}]" — `filter: { "company.destinationSiteRegionType": { "$ne": "dark" } }`.

For **hazard** character-targeting plays during the movement/hazard phase
(`movement-hazard.ts`), the filter context additionally exposes
`company.siteType` and `company.atHaven` — resolved from the target company's
**destination** site when it is moving (a moving company is "at" its new site
for hazard purposes), falling back to its current site otherwise. `atHaven` is
`true` when that site's type is `haven` (covers both Havens and Darkhavens).
Used by *The Burden of Time* (tw-94): "Playable on an Elf not in a
Haven/Darkhaven" — `filter: { "$and": [ { "target.race": "elf" },
{ "company.atHaven": false } ] }`.

**Per-mode phase gate.** An optional `phases` array restricts the *targeted*
play mode to the named phases (e.g. `["organization"]`). Unlike the card-level
`play-condition requires:phase` — which suppresses the card in every other
phase — this gates only the per-target candidates; an `untargeted: true`
`play-option` on the same card keeps its rule-2.1.1 any-phase allowance. Used
by *Bade to Rule* (le-167): "Playable at a Darkhaven during the organization
phase on your Ringwraith. … Alternatively, playable if your Ringwraith is not
in play." — the targeted mode is organization-phase-only while the alternative
mode may be played during any phase of the turn. Enforced in
`legal-actions/organization-events.ts` (the character-target candidate loop).

```json
{ "type": "play-target", "target": "character" }
{ "type": "play-target", "target": "character",
  "phases": ["organization"],
  "filter": { "target.race": "ringwraith" } }
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
  `play-hero-resource` actions for matching characters. The item bearer
  context is `{ target: { race, skills, status, name, prowess, baseProwess } }`,
  where `skills` are the candidate's *effective* skills (including skills
  granted by items already borne), `prowess` his *effective* prowess (printed
  plus the modifiers of items already borne — the item being played is not
  attached yet, so its own bonus never feeds its own gate) and `baseProwess`
  the printed value. Thong of Fire (as-132), "May only be borne by a character
  with a prowess of 6 or more": `filter: { "target.prowess": { "$gte": 6 } }`.
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
- `long-event` — a resource permanent event played "on" one of the active
  player's own in-play **resource long-events** (any phase, via the chain of
  effects — not gated to the organization phase). One `play-permanent-event`
  action is emitted per own in-play `hero-resource-event` with `eventType:
  "long"` matching the optional `filter` (evaluated against `{ target: { name
  } }`); the chosen instance rides on `targetLongEventInstanceId`. On
  resolution the card enters its controller's `cardsInPlay` bound via
  `CardInPlay.attachedToLongEvent`. While so attached, the target long-event
  is exempt from the rule 4.01 beginning-of-long-event-phase discard sweep
  (`isLongEventProtected`, consulted by `handleOrganizationPass` in
  `reducer-organization.ts`); whichever of the pair leaves play first (its own
  `discard-self-when` / `play-deck-exhausted` self-discard, or the target
  being discarded by some other means) takes the other with it
  (`protected-long-event.ts`: `sweepProtectedLongEventCascade` for the
  protector-leaves-first direction, `discardOrphanedLongEventAttachedEvents`
  for the target-leaves-first direction). Used by Echo of All Joy (td-110):
  "Play on a resource long-event if Doors of Night is not in play. The
  long-event is not discarded as normal during a long-event phase. Discard
  Echo of All Joy and target long-event when any play deck is exhausted or
  when Doors of Night comes into play." — paired with `play-condition
  requires: "card-not-in-play", cardName: "Doors of Night"` (the play-time
  gate) and `discard-self-when condition: { "inPlayAnywhere": "Doors of
  Night" }` (the ongoing trigger, since not every resource long-event carries
  the `environment` keyword that Doors of Night's own entry sweep checks).
- `agent` — a **hazard** permanent event played on one of the hazard player's
  own agents (`player.agents`), any status — face-up or face-down. One action
  is emitted per agent, carrying `targetAgentId`. On resolution the card
  enters the hazard player's `cardsInPlay` bound via
  `CardInPlay.attachedToAgentId` (the same generic permanent-event binding
  `agent-reveal-site-override` uses). `duplication-limit` `scope: "agent"`
  limits copies bound to one agent instance, counted by name across
  `cardsInPlay` entries sharing that `attachedToAgentId`. Cannot be played
  against a minion/Balrog opponent (checked directly via `isMinionOrBalrog`,
  matching the other agent-related hazard cards' convention rather than a
  generic `play-restriction`). The card stays attached for as long as the
  bound agent remains in play — see `discardOrphanedAgentAttachedEvents`
  (only a card also carrying `agent-reveal-site-override` discards early, on
  reveal). Used by Never Seen Him (dm-74): "Playable on an agent. Target
  agent may take an extra agent action … each time he normally takes an
  agent action. Cannot be duplicated on a given agent." — paired with
  `extra-agent-actions` (below), scoped to the bound agent via
  `countExtraAgentActions(state, agentId)`.
- `nazgul-permanent-event` — a **hazard** permanent event playable only while
  the hazard player has a Nazgûl permanent-event of their own in play (the
  Nine's dual creature/permanent-event cards, once played in permanent-event
  mode, or a plain Nazgûl-keyword hazard-event — `isNazgulPermanentEvent`,
  `reducer-utils.ts`). One `play-hazard` action is emitted per matching
  instance in the hazard player's own `cardsInPlay`
  (`legal-actions/movement-hazard.ts`); with none, no action is emitted at
  all — this structurally implements a "Playable only if you have a Nazgûl
  permanent-event in play" condition without a separate `play-condition`.
  The chosen instance rides on `PlayHazardAction.targetNazgulInstanceId`,
  threaded through the permanent-event chain payload
  (`ChainEntryPayload.targetNazgulInstanceId`) into the resolving card's
  `self-enters-play` move as `MoveContext.targetCardId` — so a plain
  `{ "type": "move", "select": "target", "from": "in-play", "to": "discard" }`
  discards exactly the chosen candidate (no `filter` needed; `toOwner`
  defaults to the located card's own owner). Used by Helms of Iron (dm-64):
  "Playable only if you have a Nazgûl permanent-event in play. Discard the
  Nazgûl when this card is brought into play."

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
- `itemFilter` — restricts a `target: "character"` play-target to a
  character bearing at least one item matching this condition, evaluated
  per-item against the item's own card definition (`matchesDefinition`) —
  distinct from `filter`, which is evaluated against the candidate
  character's aggregate context (`target.itemKeywords`). Also designates
  *which* of that character's items the played card resolves against: the
  legal-action emitter (`long-event.ts` for the long-event phase,
  `organization.ts`'s `playResourceShortEventActions` for every other
  phase per CoE 2.1.1) crosses each eligible character with every item
  matching `itemFilter`, emitting one `play-short-event` action per pair
  and carrying the chosen item's instance as `targetItemInstanceId`. Used
  by Use Palantír (tw-355): "Tap sage to enable him to use **one** Palantír
  he bears" — a sage bearing two Palantíri is offered one action per item
  instead of enabling both at once. `itemFilter: { "keywords": {
  "$includes": "palantir" } }`.

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

- `cancel-auto-attacks` — cancels this site's automatic-attacks while the
  rule's `when` condition holds. The condition is evaluated against the
  card-name context `{ inPlayAnywhere, charactersInPlayAnywhere }` — the same
  name lists the player-state context exposes (`inPlayAnywhere`: names of
  every card in either player's `cardsInPlay`, with name-aliases and
  environment overrides applied; `charactersInPlayAnywhere`: names of every
  character in play for either player). Name matching means every printing of
  a card counts (Radagast is tw-178 as a hero Wizard and wh-8 as a
  Fallen-wizard). `scope` selects what is canceled, and thereby where in the
  attack pipeline the rule applies. Consumed by `getActiveAutoAttacks()` in
  `engine/manifestations.ts`.

  - `"scope": "printed"` — removes ALL of the site's own printed
    automatic-attacks, before hazard augments, so attacks added to the site
    by hazard effects (Spawn permanent-events, `extra-automatic-attack`
    constraints) are unaffected. Used by *Rhosgobel* (as-159) — "If the
    Wizard card Radagast is in play, the automatic-attacks are removed."
  - `"scope": "first"` — removes the first attack of the final combined
    list. Used by *The Under-gates* (dm-38 / as-165) — "If Balrog of Moria
    is in play ... the first automatic attack is canceled."

  ```json
  { "type": "site-rule", "rule": "cancel-auto-attacks", "scope": "printed",
    "when": { "charactersInPlayAnywhere": { "$includes": "Radagast" } } }
  { "type": "site-rule", "rule": "cancel-auto-attacks", "scope": "first",
    "when": { "inPlayAnywhere": { "$includes": "Balrog of Moria" } } }
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
  store attempt as a backstop. The optional `when` condition scopes the ban to a
  subset of players; it is evaluated against `{ player: { alignment } }`, and an
  absent `when` means the ban is unconditional. Used by *Geann a-Lisch* (le-374),
  a minion Haven that would otherwise permit storing regular items, and by
  *Barad-dûr* (tw/le/ba) for the MEBA clause "A Balrog player may not store
  anything at Barad-dûr".

  ```json
  { "type": "site-rule", "rule": "no-storage" }
  { "type": "site-rule", "rule": "no-storage", "when": { "player.alignment": "balrog" } }
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

**`requiresTapped` — storable only once the card itself is tapped.** Pass the
Doors of Dol Guldur (dm-154): "*If tapped*, this card can be stored at a Haven
[{H}]". The store action is withheld until the card's own `status` is
`Tapped`; the reducer re-checks it.

**Company-bound storage (no bearer).** A permanent event played on a company
(`play-target` `company`) lives in `cardsInPlay` with a `companyId`, not on a
character. Such a card is offered for storage per company rather than per
(item, bearer) pair, and the emitted `store-item` action carries `companyId`
instead of `characterId`. Storing moves it from `cardsInPlay` into the
marshalling-point pile with `storedAtSite` stamped, and enqueues **no**
corruption check — CoE 2.II.4's check falls on *the bearer*, and a card the
whole company jointly controls has none.

```json
{ "type": "storable-at", "siteTypes": ["haven"],
  "requiresTapped": true, "marshallingPoints": 4 }
```

### 21z. Item-cache primitives (`item-cache-hand-store`, `item-cache-alt-storage`, `item-cache-play-source`, `item-cache-count-bonus`)

A permanent event that acts as an off-to-the-side cache of a player's own
minor items, layered on top of the generic `setAside` mechanism
(`engine/set-aside.ts`, MEAS §1) rather than the marshalling-point pile.
Used by Armory (dm-116): "Only you and your companies can use Armory. You
may place any minor items from your hand under Armory during your
organization phase. A character at a Haven [{H}] can store a minor item
under Armory instead of to your marshalling point pile. When you otherwise
would be allowed to play a minor item from your hand at a Border-hold [{B}],
Free-hold [{F}], or Haven [{H}], you may play an item from under Armory
instead. If you have at least three minor items under Armory, gain 1
marshalling point." Four independent effects, each a thin, reusable
extension of an existing mechanism — no dedicated card-specific code:

- **`item-cache-hand-store`** — a new organization-phase action
  (`store-item-in-cache`, `legal-actions/organization.ts`
  `itemCacheHandStoreActions`, `reducer-organization.ts`
  `handleStoreItemInCache`) moves a hand item of a listed subtype straight
  into the host's `setAside` pile (`placeCardSetAside(..., noMp: true)`), no
  site or bearer required — the item was never played.
- **`item-cache-alt-storage`** — offered alongside the existing `store-item`
  action wherever an item is already storable at a matching site type
  (`organization-companies.ts` `storeItemActions`); the emitted action
  carries an extra `cacheHostInstanceId`, and `handleStoreItem`
  (`reducer-organization.ts`) branches on its presence to call
  `placeCardSetAside(..., noMp: true)` instead of pushing to `killPile`. The
  initial-bearer corruption check and `bearer-cannot-untap` cleanup run
  unchanged either way.
- **`item-cache-play-source`** — generalizes the Great Secrets Buried There
  (dm-63) "play a set-aside item as though in hand" shape
  (`legal-actions/site.ts`, the hand-card loop in `playResourcesActions`)
  from a hardcoded Under-deeps keyword check to a declared `siteTypes` list:
  a player-owned host card's own `setAside` items are merged into the
  hand-card loop whenever the active company's site's *effective* type
  (`getEffectiveSiteType`) matches. Every ordinary item-play gate (site
  resource type, uniqueness, untapped bearer) still applies unchanged, and
  the existing `fromSetAside` reducer path (`reducer-site.ts`
  `handleSitePlayHeroResource` / `removeItemFromSetAside`) needed no changes
  — it was already host-agnostic.
- **`item-cache-count-bonus`** — a `{ count, mp }` threshold scored in
  `recompute-derived.ts` by counting the host's own `setAside.length`, the
  same shape as `leader-control`'s `groupBonus` applied to a card count
  instead of a faction count. Individual cached items already score no MP
  (`setAsideNoMp`, set by both storage modes above) — this bonus is the only
  MP the cache itself contributes.

```json
{ "type": "item-cache-hand-store", "subtypes": ["minor"] }
{ "type": "item-cache-alt-storage", "siteTypes": ["haven"], "subtypes": ["minor"] }
{ "type": "item-cache-play-source", "siteTypes": ["border-hold", "free-hold", "haven"] }
{ "type": "item-cache-count-bonus", "count": 3, "mp": 1 }
```

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
hand. Allies and hazards attached to the character are discarded;
followers fall to GI if room, otherwise are discarded. One item may
automatically be transferred to another character in the company (the
"Pilfer Anything Unwatched" `transfer-returned-item` primitive, §6i
analog — see `allowItemTransfer` on the `return-character-to-hand`
dice-check branch); the rest of the character's items are discarded.

Used with a `play-target` effect that selects the target character.

```json
{ "type": "call-of-home-check", "threshold": 10 }
```

An optional `rollModifiers` list adds conditional adjustments to the roll,
evaluated at enqueue time against `{ company: { sitePathRegionTypes:
RegionType[] } }` — the region types on the target's company's resolved
site path this turn (`MovementHazardPhaseState.resolvedSitePath`, read
directly since the target always belongs to the company currently in its
M/H sub-phase). The values of all matching entries sum into a `constant`
`DiceCheckModifier` alongside the `unused-gi` one. Used by Call of the Sea
(tw-19): "playable on an Elf character … modified by -3 if the character's
company moved this turn using a site path containing a Coastal Sea":

```json
{ "type": "call-of-home-check", "threshold": 10,
  "rollModifiers": [
    { "when": { "company.sitePathRegionTypes": { "$includes": "coastal" } }, "value": -3 }
  ] }
```

Implemented in `chain-reducer.ts` (enqueue pending resolution on
short-event resolution), `legal-actions/pending.ts` (generate roll
action), and `pending-reducers.ts` (execute roll and apply consequences).
Used by Call of Home (tw-18, le-105), Tookish Blood (tw-104), and Call of
the Sea (tw-19).

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

### 23b. `removal-protection`

While the carrying card (a resource long-event/permanent-event) sits in
`cardsInPlay`, no character — either player's — currently standing at a site
whose effective type is in `siteTypes` may be discarded or returned to hand
for any reason. Unlike `protect-from-removal` above (a turn-scoped constraint
on one selected character), this is a continuous, location-gated protection
over a dynamic population: a character gains it the moment it stands at a
matching site and loses it the moment it leaves, for as long as the carrying
card stays in play — no constraint to install or clear.

```json
{ "type": "removal-protection", "siteTypes": ["haven"] }
```

Checked by `isSiteRemovalProtected` (`engine/removal-protection.ts`), which
scans both players' `cardsInPlay` for a matching clause and resolves the
target character's current site's effective type via `getEffectiveSiteType`.
Folded into `isCharacterRemovalProtected` alongside the turn-scoped
`character-removal-protected` constraint, so both sources are consulted by
the same two central helpers (`returnCharacterToHand` / `discardCharacter` in
`pending-reducers.ts`) that back every removal path — dice-check returns,
CoE 3.47 influence-overflow returns, body-check discards, and so on.

Used by Elf-song (tw-223): "While Elf-song is in play, no character at a
Haven [{H}] may be discarded or returned to its owner's hand for any
reason." Because the central helpers back every removal path, this also
covers the CRF-22 ruling that Elf-song "will effectively stop influence
attempts against characters" with no extra wiring.

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
  - `destinationSiteCardType` — the destination site's printed alignment
    (`"hero-site"` / `"minion-site"` / etc.), resolved from the moving
    company's actual `destinationSite` definition. Only ever populated
    for a company that is genuinely **moving** — unlike the `company-site`
    play-condition's `destinationSite ?? currentSite` fallback (used by
    "at or moving to" cards), `site-path` never falls back to the current
    site, so a stationary company exposes no `destinationSiteType` at all
    and a condition referencing it correctly fails. Lets a card distinguish
    e.g. a hero Border-hold from a minion Border-hold — the same
    `siteType` occurs on both alignments (Raider-hold: as-141 hero /
    le-399 minion, both `border-hold`). Used by *Whole Villages Roused*
    (wh-31): "Playable on a hero Border-hold or Free-hold... playable on a
    minion Shadow-hold or Dark-hold" —
    `{ "$or": [ { "$and": [{"destinationSiteCardType": "hero-site"}, {"destinationSiteType": {"$in": ["border-hold", "free-hold"]}}] }, { "$and": [{"destinationSiteCardType": "minion-site"}, {"destinationSiteType": {"$in": ["shadow-hold", "dark-hold"]}}] } ] }`.
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
  lists where to look, using the same vocabulary as `discard-keyword-card`
  below: `character-items` (items on the company's characters),
  `kill-pile` (the marshalling point pile — successfully stored items live
  there per CoE rule 2.II.4.1), and/or `cards-in-play` (bare company-bound
  permanent events). One legal action is generated per available discard
  candidate, carrying the `discardCardInstanceId` on the action.

```json
{ "type": "play-condition", "requires": "discard-named-card",
  "cardName": "Sapling of the White Tree",
  "sources": ["character-items", "kill-pile"] }
```

Implemented in `reducer-utils.ts` (`namedDiscardCandidates`),
`legal-actions/site.ts` and `legal-actions/organization-events.ts`
(permanent event play-condition checks), and `reducer-events.ts` (discard
execution).

- `discard-keyword-card` — the keyword-matched sibling of
  `discard-named-card`: instead of one printing, it matches a *family* of
  cards by the structural keyword in `cardKeyword`. Used by Pass the Doors of
  Dol Guldur (dm-154): "Playable on a company if the company discards (for no
  effect) a Stolen Knowledge card it controls" — Dark Numbers (dm-123),
  Knowledge of the Enemy (dm-147), and another copy of dm-154 all qualify.

  `sources` adds `cards-in-play` to `character-items` / `kill-pile`, for the
  bare permanent events that live in `PlayerState.cardsInPlay`. On a
  company-targeting card the search is scoped to what *that company* controls:
  the items of its own characters, and only `cardsInPlay` entries whose
  `companyId` is that company. One legal action per candidate, each carrying
  its `discardCardInstanceId`.

  "For no effect" is literal — the play-cost payer moves the chosen card
  straight to its owner's discard pile without running any of its own
  discard-triggered `grant-action` / `on-event` abilities.

```json
{ "type": "play-condition", "requires": "discard-keyword-card",
  "cardKeyword": "stolen-knowledge",
  "sources": ["character-items", "cards-in-play"] }
```

Implemented in `reducer-utils.ts` (`keywordDiscardCandidates`),
`legal-actions/organization-events.ts` (company play-target emitter), and
`reducer-events.ts` (discard execution).

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

- `card-count-exceeds` — the controlling player must hold strictly more
  copies of `cardName` in play than of `comparedToCardName` (both counted via
  `countPlayerHeldCopies` — the player's own `cardsInPlay` plus items attached
  to their characters; a tie does not satisfy "more"). Checked in the
  site-phase permanent-event block of `legal-actions/site.ts`. Used by
  Earth-eater (wh-67): "Playable during the site phase if … you have more
  Delver's Harvest cards in play than you have Earth-eater cards."

```json
{ "type": "play-condition", "requires": "card-count-exceeds",
  "cardName": "Delver’s Harvest", "comparedToCardName": "Earth-eater" }
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
  `{ site: { name, type, keywords }, company: { itemNames, characterNames, allyNames } }`.
  `itemNames`/`allyNames` are the names of every item / ally borne by any
  character in the company; `site.keywords` is the active site's printed
  keyword list (e.g. `under-deeps`, `hoard`). Lets a card express a positional
  play prerequisite without a per-card keyword. Used by the CoE 10.39 win
  cards: Cracks of Doom (tw-205) requires The One Ring at Mount Doom;
  Gollum's Fate (tw-247) additionally requires Gollum. Also used by Bounty of
  the Hoard (td-101) — rule 5.1.2 bars playing a short-event that has no
  potential effect on the board state, and this card's only effect
  (unlocking `hoardBountyAvailable`) can never matter at a site that isn't a
  hoard — via `{ "site.keywords": { "$includes": "hoard" } }`. Implemented in
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

- `target-company` — for **hazard creatures**: an extra gate checked after
  keying, evaluated against the defending company via
  `buildTargetCompanyConditionContext` (`reducer-utils.ts`), exposing
  `{ company: { alignment, homeSites, characterNames, maxUntappedWarriorProwess,
  containsWizard, covert, itemNames, itemKeywords, hasWoundedCharacter },
  inPlay: [<names>] }`. `company.alignment` is `defenderAlignmentLabel`-mapped
  (a Wizard player's companies read `"hero"`); `company.hasWoundedCharacter` is
  `true` when any company member's status is Inverted (wounded); `inPlay` lets
  the same condition combine a company predicate with a named in-play
  prerequisite. Checked in `legal-actions/movement-hazard.ts` (creature-keying
  block) via `findPlayConditionEffect(def, 'target-company')`, **after** a
  keying match is found — a miss makes the play non-viable with reason "Cannot
  be played against this company". Used by Horse-lords (le-78): "May not be
  played against a company containing a character with Edoras as a home site"
  — `{ "$not": { "company.homeSites": "Edoras" } }`; Olog Warlords (ba-12) /
  Sons of Kings (le-91) / Elves upon Errantry (le-70) gate on
  `company.alignment`; Landroval (le-81) combines `company.alignment` with
  `company.covert`; and Morgul-rats (td-49): "playable... only if a character
  in target company is wounded or Doors of Night is in play" —
  `{ "$or": [{ "company.hasWoundedCharacter": true }, { "inPlay": "Doors of Night" }] }`.

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
  - `player.characterSiteNames` — the names of every site the player currently
    has characters at (one entry per non-empty company's `currentSite`,
    de-duplicated). Matched by **name**, so every version of a site (hero /
    minion reprints) counts. Backs "playable if any of *your* characters are at
    `<site>`", which is about *any* company rather than the phase's active one —
    used by *Mirror of Galadriel* (tw-282): "Only playable if any of your
    characters are at Lórien."
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
  `currentSite` — exposing
  `{ site: { name, siteType, cardType, region, keywords } }`. `cardType` is the
  site's printed alignment (`"hero-site"` / `"minion-site"` / etc.), letting a
  card distinguish e.g. a hero Border-hold from a minion Border-hold (the same
  `siteType` occurs on both alignments). Lets a hazard gate on where the
  targeted company is (or is moving to) without a per-card keyword. Implemented
  in the play-hazards block of `legal-actions/movement-hazard.ts`. Used by
  *Glance of Arien* (ba-19): "Playable on The Balrog at or moving to a
  non-Under-deeps site" — note the explicit "at or moving to" wording, which is
  what justifies the `currentSite` fallback; a card worded only "playable on a
  [site]" without that fallback wording should instead use `site-path`'s
  `destinationSiteCardType` (see above), which never falls back and so
  correctly excludes a stationary company (e.g. *Whole Villages Roused* wh-31).

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

- `active-player-deck-size` — gates on `GameState.activePlayer`'s play deck
  card count reaching `minDeckSize`. `activePlayer` is always the correct
  party to check regardless of which "side" of the card's text is being
  evaluated: a hazard permanent-event is only ever declared by the
  *non*-active player against the active company's owner ("opponent" in the
  card text = the active player), and a `playable-as-resource` self-cast
  permanent-event is only ever declared by the active player on themself
  ("you" = the active player). Checked in `legal-actions/movement-hazard.ts`
  (hazard mode) and `legal-actions/organization-events.ts` /
  `legal-actions/site.ts` (resource mode) via the shared
  `activePlayerDeckSize` helper (`reducer-utils.ts`). Used by *Great Secrets
  Buried There* (dm-63): "Playable if opponent has at least ten cards in his
  play deck" / "you may play this card as a resource on yourself if you have
  at least ten cards in your play deck."

```json
{ "type": "play-condition", "requires": "active-player-deck-size", "minDeckSize": 10 }
```

- `card-player-deck-size` — gates on the deck size of whichever player is
  actually **declaring this play**, always "you" in the card text regardless
  of side. Diverges from `active-player-deck-size` whenever a hazard
  short-event is played by the *non*-active (hazard) player and gates on
  their own deck rather than the active company owner's. Checked in
  `legal-actions/movement-hazard.ts` alongside `active-player-deck-size`, via
  the `cardPlayerDeckSize` helper (`reducer-utils.ts`). Used by *Long Dark
  Reach* (dm-70): "if you have at least 10 cards in your play deck" (see §35c).

```json
{ "type": "play-condition", "requires": "card-player-deck-size", "minDeckSize": 10 }
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

### 24a. `nazgul-boost-pending` — a pre-play boost for the next Nazgûl creature

An `add-constraint` kind for a hazard short-event played *standalone*
(no target), before the boosted creature is even in play. Installed via
the ordinary `on-event: self-enters-play` → `add-constraint` path — no
special dispatcher support needed, just a new `constraintKind` case in
`buildConstraintKind` (`constraint-kind.ts`) — targeting the company the
short event was played against, scope `company-mh-phase`:

```json
{ "type": "on-event", "event": "self-enters-play",
  "apply": {
    "type": "add-constraint",
    "constraint": "nazgul-boost-pending",
    "scope": "company-mh-phase",
    "race": "ringwraith",
    "strikesModifier": 1,
    "prowessModifier": -2,
    "grantAttackerChoosesDefenders": true,
    "keyingRegionTypes": ["shadow"],
    "keyingSiteTypes": ["shadow-hold"]
  } }
```

Consumed the moment a hazard-creature of the matching `race` is actually
played against that company: `mh-hazard-play.ts`'s creature-play handler
looks up the constraint, removes it, and folds `strikesModifier`/
`prowessModifier`/`grantAttackerChoosesDefenders` into the `creature`
`ChainEntryPayload` as `strikesBonus`/`prowessBonus`/
`grantAttackerChoosesDefenders` — consumed in `chain-reducer.ts` the same
way Summons from Long Sleep's (as-39) `prowessBonus` already is, and
OR'd into the `resolveAttackerChoosesDefenders` call that already
honours a creature's own `combat-attacker-chooses-defenders` effect.
`keyingRegionTypes`/`keyingSiteTypes` (both optional) let the boosted
creature additionally be keyed via those region/site types, on top of
its own printed `keyedTo` — implemented as a synthetic extra
`CreatureKeyRestriction` entry appended to `def.keyedTo` at both
`findCreatureKeyingMatches` (`legal-actions/movement-hazard.ts`, the
offer side) and `checkCreatureKeying` (`mh-hazard-play.ts`, the
validation side), so the two can never disagree.

If the target company's M/H phase ends with the constraint still
unconsumed (no matching creature was ever played), `finalizeCompanyMH`
returns the short event's own card instance from its owner's discard
pile back to hand instead of just letting the constraint's
`company-mh-phase` scope silently drop it — CRF ruling for Fell Beast
(tw-33): "A Nazgûl must be played as the first declared action ... or
else this card is returned to its player's hand."

A companion **permanent** constraint kind, `nazgul-boost-used`
(`until-cleared` scope, target the creature's owning player, payload
`creatureDefinitionId`), marks a specific unique Nazgûl as having already
received this boost — `hasNazgulBoostBeenUsed`/`markNazgulBoostUsed`
(`engine/pending.ts`) gate both the keying grant and the bonus
consumption, so "Cannot be duplicated on a given Nazgûl" holds even
across the creature cycling through the discard pile and being replayed
later in the game (an ordinary `duplication-limit` scope cannot express
this, since the card providing the boost never stays in play).

A card offering this Mode A pre-play boost may *also* carry an ordinary
`modify-attack` (`fromHand: true`) Mode B for playing on an attack
already in progress — see §10e-quater. The pre-existing "a short event
whose only M/H-relevant effect is a from-hand `modify-attack` has no
open M/H play" suppression (`legal-actions/movement-hazard.ts`) skips
itself when the card also carries an `on-event self-enters-play` →
`add-constraint` effect, so the two modes coexist without either
starving the other. Used by Fell Beast (tw-33): "The number of strikes
of one Nazgûl hazard creature is increased by one and its prowess is
decreased by 2. Attacker chooses defending characters. Additionally,
target Nazgûl may be played keyed to a Shadow-land [{s}] or Shadow-hold
[{S}]. Cannot be duplicated on a given Nazgûl." — paired with
`{ "type": "modify-attack", "fromHand": true, "player": "attacker",
"strikesModifier": 1, "prowessModifier": -2,
"grantAttackerChoosesDefenders": true, "when": { "enemy.race": "ringwraith" } }`
for Mode B (CRF: "playable on an existing Nazgûl attack, but the extra
playability this card provides would not apply" — the keying grant is
Mode-A only) and `{ "type": "duplication-limit", "scope": "attack", "max": 1 }`.

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

### 25a2. `block-influence-boost`

Self-restriction carried directly on a faction card's own `effects` (not an
environment scanned from other in-play cards). While that faction is being
influenced, any one-shot influence check-modifier boost sourced from a card
named in `blockCards` is suppressed for the attempt — consumed, but worth
zero.

```json
{ "type": "block-influence-boost", "blockCards": ["Muster"] }
```

Consulted alongside `faction-influence-restriction`'s `blockedCardNames` at
both influence seams — the influence-attempt legal-action generator
(`legal-actions/site.ts`) and the roll resolver (`resolveInfluenceAttemptRoll`
in `reducer-site.ts`).

Used by Angmarim (as-58) and Nûrniags (as-64): "Playable at Carn Dûm if the
influence check is greater than 11 (Muster has no effect on this attempt)."

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
  "revealToOpponent": false,
  "cardName": "…",
  "when": { "…": "…" }
}
```

**`revealToOpponent`** — for a `select: 'target'` fetch move (`to: 'hand'` or
`'deck'`), reveals the fetched card's identity to the opponent as it is taken
(recorded in `GameState.revealedInstances`). Generalizes the field the internal
`FetchToDeckEffect` pending-resolution shape already carried for the hazard-only
`fetch-agent-to-hand` (Inner Cunning dm-68) to the card-level `move` primitive,
so any resource event can model "reveal to your opponent" on its own fetch.
`moveToFetchToDeckPayload` (`reducer-move.ts`) copies the flag onto the
generated `FetchToDeckEffect`; `handleFetchFromPile` (`reducer-utils.ts`) is
unchanged — it already honoured the field. Used by Far-sight (tw-238): "choose
an item that you must reveal to your opponent."

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

Reduces opponent draws from Alatar's company's movement by one (floored at zero). When a hazard creature attacks any of the controller's companies and Alatar is at a haven in a different company, the controller may accept the haven-join offer: Alatar joins the attacked company for good, his attached allies are discarded, the creature must strike him, and after combat he taps (if untapped) and makes a corruption check.

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

**Organization-phase permanent events.** `playPermanentEventActions`
(`legal-actions/organization-events.ts`) also honours an `untargeted: true`
play-option on a character-targeting permanent event: when no character in
the player's companies matches the `play-target` filter, the emitter falls
back to the untargeted option's `when`, evaluated against the same
`player`/`opponent` context as `play-condition: requires: "player-state"`
(`buildPlayerStateContext`, e.g. `player.hasRingwraithInPlay`). If it
matches, a single bare `play-permanent-event` action with no
`targetCharacterId` is offered instead of the usual "no valid target"
rejection. The card then resolves through the existing unattached path
(`chain-reducer.ts`'s `resolvePermanentEvent` places it in `cardsInPlay`
rather than attaching it to a character), so no dedicated `apply` kind is
needed here — the option's `apply` is a no-op (`{ "type": "sequence", "apps":
[] }`) and the card's own always-on effects (e.g. a `general-influence`
`stat-modifier`, already summed from unattached `cardsInPlay` entries) take
effect once it is in play. Used by *Bade to Rule* (le-167): "Playable ... on
your Ringwraith ... Alternatively, playable if your Ringwraith is not in
play. +5 general influence.":

```json
{ "type": "play-target", "target": "character",
  "filter": { "target.race": "ringwraith" } },
{ "type": "play-option", "id": "no-ringwraith", "untargeted": true,
  "when": { "player.hasRingwraithInPlay": false },
  "apply": { "type": "sequence", "apps": [] } }
```

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

**Company-targeting mode.** `play-option` is also honoured on
**company**-targeting hazard short-events (`play-target: "company"`, e.g.
Drowning Seas tw-30). The company branch of `playHazardsActions`
(`legal-actions/movement-hazard.ts`) emits one `play-hazard` action per
matching option (carrying `optionId`), evaluating each option's `when`
against the same company filter context used for the card's `play-target`
filter, extended with `inPlay` — so an alternative gated on a permanent-event
(e.g. Doors of Night) is only offered while it's actually in play. A card
whose play-options *all* fail their `when` is offered as a single non-viable
action. `chain-reducer.ts`'s `applyCompanyPlayOption` dispatches the chosen
option's `apply` once the entry resolves un-negated; it only fires for cards
whose own `play-target` is `"company"`, so it never collides with the
existing untargeted-mode dispatch (`optionId && !targetCharacterId`) — every
hazard short-event's chain payload carries `targetCompanyId` regardless of
its actual target kind, so that field alone can't tell the two families
apart.

Three apply kinds resolve against the chain's active movement/hazard company:

- `company-return-to-origin` — the same CoE rule 2.IV.4 mechanism described
  in §56b, reused here as a `play-option` apply instead of a top-level card
  effect.
- `force-discard-one-company-item` — reused outside combat. Normally an
  `on-event: character-wounded-by-self` verb (Brigands le-64/tw-17); as a
  `play-option` apply it directly enqueues the same `discard-one-company-item`
  pending resolution (no `characterId` narrowing, so every item in the
  company is a candidate), actored by the company's controller — "the
  company loses one item of its choice".
- `random-discard-hand` (`{ "count": <n> }`) — the company controller
  discards `count` cards drawn **at random** from hand (capped at hand
  size). A seeded `shuffle` (same pattern as `reveal-hand-cards-per-character`
  §3-ish/Crebain tw-25) picks the discarded slice; `state.rng` advances.

`sequence` composes multiple applies (e.g. item loss + random hand discard)
for a single option.

```json
"effects": [
  { "type": "play-target", "target": "company" },
  { "type": "play-condition", "requires": "site-path",
    "condition": { "sitePath.coastalCount": { "$gte": 1 } } },
  { "type": "play-option", "id": "item-loss-and-discard",
    "apply": { "type": "sequence", "apps": [
      { "type": "force-discard-one-company-item" },
      { "type": "random-discard-hand", "count": 2 }
    ] } },
  { "type": "play-option", "id": "return-to-origin",
    "when": { "inPlay": "Doors of Night" },
    "apply": { "type": "company-return-to-origin" } }
]
```

Used by *Drowning Seas* (tw-30): "Environment. Playable on a company that
moved this turn to a site with a Coastal Sea [{c}] in its site path. Target
company loses one item of its choice and its player must randomly discard two
cards from his hand. Alternatively, if Doors of Night is in play, target
company must immediately return to its site of origin." The Coastal-Sea
clause reuses the `play-condition` site-path gate (`sitePath.coastalCount`,
the Lost at Sea tw-50 shape).

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

### Wizard's River-horses

A dual-mode spell short-event (the shape *The Cock Crows* tw-342 established:
two independent effects on one card, each offered in its own window).

Mode 1, "All Nazgûl events are discarded", is a `move` sweep — `select:
'filter-all'`, `from: 'in-play'`, `to: 'discard'` — filtered on the `Nazgûl`
keyword. The Nine are dual creature/permanent-event cards, so a Nazgûl reaches
`cardsInPlay` only in its permanent-event mode; each swept card goes to its own
owner's discard pile. The mode is offered only while at least one matching card
is in play (`heroResourceShortEventActions`, `legal-actions/long-event.ts`), and
it rides the chain of effects like the single-target `discard-in-play` shape —
the declaration carries `discardAllInPlay: true` on the chain payload and
`chain-reducer` runs the sweep plus the `corruptionCheck` on the `play-target`
Wizard once both players pass priority (`applyShortEventDiscardAllInPlay`,
`engine/short-event-discard.ts`). The payload flag is what keeps the sweep from
also firing when the card is played in its *other* mode.

Mode 2 is a plain `cancel-attack` gated on `bearer.companySize` — "if he is the
only character in the company". Allies do not count: they are not characters.

```json
"effects": [
  { "type": "play-target", "target": "character",
    "filter": { "target.race": "wizard" } },
  { "type": "move",
    "select": "filter-all",
    "from": "in-play",
    "to": "discard",
    "filter": { "keywords": { "$includes": "Nazgûl" } },
    "corruptionCheck": { "modifier": -2 } },
  { "type": "cancel-attack",
    "requiredRace": "wizard",
    "cost": { "check": "corruption", "modifier": -2 },
    "when": { "bearer.companySize": 1 } }
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

### 35b. `named-creature-hunt`

The Hunt (dm-143) — Alatar's short-event resource event. Unlike
`reveal-and-attack`'s multi-creature reveal sequence, this is a one-shot,
player-driven naming of a *single already-known* hazard-creature instance:

```text
"Playable on Alatar during the organization phase. Name a specific hazard
creature card your opponent revealed to you through a mechanism of the game
and discarded. Unless eliminated or prevented from being in play, your
opponent then finds this particular card (reshuffling his play deck if it was
searched). This creature immediately attacks Alatar as though he were a
one-character company. Alatar cannot use or benefit from spells against the
attack. If untapped, tap Alatar afterwards."
```

Paired with `play-window { phase: "organization" }` and `play-target {
target: "character", filter: { target.name: "Alatar" } }` (no cost) — the
generic filter-only-target path in `playResourceShortEventActions`
(`legal-actions/organization.ts`) already offers the play with
`targetCharacterId` set to the chosen bearer.

**"Revealed to you ... and discarded"** is modeled by
`GameState.handRevealedInstances` — the engine's ledger of card identities
made public while sitting in an otherwise-private pile (grown only by
explicit reveal effects, e.g. The Great Hunt's discard sweep, Pallando's
top-of-discard peek). `findHuntCandidates` (`engine/hunt.ts`) scans the
opponent's play deck **and** discard pile for hazard-creature instances whose
id/definition pair is recorded there — "unless eliminated or prevented from
being in play" falls out for free: a creature that left both piles (kill pile,
out-of-play) is simply not a candidate.

**Resolution flow** (`handlePlayResourceShortEvent`, `reducer-events.ts`):
discards the event card immediately, then enqueues a `hunt-target-choice`
pending resolution (fields: `huntInstanceId`, `bearerInstanceId`, `opponentId`,
`companyId`). `huntTargetChoiceActions` (`legal-actions/pending.ts`)
recomputes candidates live and offers one `choose-hunt-target` action per
candidate, or a mandatory `pass` when none exists (fizzle — no creature ever
attacks, so the "tap afterwards" clause does not fire either).
`applyHuntTargetChoiceResolution` (`pending-reducers.ts`) re-validates the
chosen instance is still a candidate, then calls `buildHuntCombat`:

- If the creature was found in the play deck (not the discard pile), the deck
  is reshuffled immediately — "reshuffling his play deck if it was searched".
  A discard-pile find needs no reshuffle.
- The creature card is never moved out of its pile — attacked in place,
  exactly like `reveal-and-attack` — via a new `hunt-attack` `AttackSource`
  (`{ type: "hunt-attack", huntInstanceId, creatureInstanceId,
  bearerInstanceId }`). `attackSourceCreatureInstanceId` does not recognize
  it, so `finalizeCombat` neither discards nor awards it as a trophy.
- `CombatState.soloDefenderInstanceId = bearerInstanceId` — "as though he were
  a one-character company": `assignStrikeActions` restricts the defending
  company to just the bearer, exactly like a failed-burglary solo auto-attack.
- `CombatState.spellsIneffective = true` — "cannot use or benefit from spells
  against the attack", enforced centrally (not per-card `when` checks, unlike
  `weaponsIneffective`):
  - `cancelAttackActions` (`legal-actions/combat.ts`) filters out every
    `cancel-attack` action whose source card carries the `spell` keyword
    (Vanishment tw-356, Wizard's River-horses tw-364) once all the normal
    per-source loops have run.
  - `collectCreatureAttackBoostEffects` (`effects/resolver.ts`) takes a new
    `CreatureAttackBoostContext.suppressSpellSources` flag (set via
    `buildHuntCombat`'s `attackBoostCtx`) and skips `creature-attack-boost`
    constraints sourced from a `spell`-keyword card (Wizard's Flame tw-361's
    prowess reduction) when resolving this attack's effective prowess/strikes.
- "If untapped, tap [the bearer] afterwards" — `tapHuntBearerAfterwards`
  (`engine/hunt.ts`) runs from both `combat-finalize.ts` and
  `combat-cancel.ts` for a `hunt-attack` source, so the tap applies whichever
  way the forced attack concludes.

```json
{ "type": "named-creature-hunt" }
```

Used by The Hunt (dm-143).

### 35c. `reveal-deck-choose-attacker`

Carried by a **hazard** short-event. When the event resolves un-negated on the
chain, the card-player reveals the top `count` cards of **their own** play
deck — unlike `reveal-deck-choose-penalty` (ba-16), which reveals the
*opponent's* deck:

1. The reveal count is capped by the deck length; `revealInstances` records
   the top `min(count, deckSize)` cards. They remain physically at the top of
   the deck (no instance ever floats).
2. A revealed card is an **eligible candidate** when it is a hazard-creature
   whose race is one of `alwaysEligibleRaces`, or any non-unique creature of
   any race — AND (when `requireNonCoastalKeying` is set) its printed
   `keyedTo` offers at least one non-Coastal-Sea region
   (`creatureHasNonCoastalRegionKeying`, exported from
   `legal-actions/movement-hazard.ts` — the same helper A Pack at the Door
   tw-497 uses for its own "must be playable in a non-Coastal Sea region"
   clause).
3. With at least one eligible candidate, a `reveal-deck-choose-attacker`
   pending resolution is enqueued (actor = the card-player). The choice is
   **mandatory** (no pass — "must immediately attack"): one
   `choose-long-dark-reach-attacker` action per eligible candidate.
4. With none eligible, the reveal fizzles: every revealed card is immediately
   shuffled among itself and returned to the top of the deck (no pending
   resolution) — mirrors `reveal-deck-choose-set-aside`'s no-eligible
   fallthrough.
5. On resolution, the chosen creature immediately attacks the target company
   (the M/H company the event was played on) — a normal (non-solo-defender)
   attack, bypassing the creature's own keying/playability check entirely for
   *legality*. Whether the creature *could* normally have been played on the
   company is still evaluated purely to decide `unplayableProwessPenalty`
   (added to its printed prowess): via `creatureIsNormallyPlayableOnCompany`
   (also exported from `movement-hazard.ts`), which wraps the same
   `findCreatureKeyingMatches` the ordinary M/H hazard-creature-play path
   uses. The attack does **not** count against the hazard limit — it is
   spawned directly by chain resolution, never through the `play-hazard`
   action that charges the limit.
6. The unused revealed cards (every revealed card except the chosen one) are
   shuffled among themselves and returned to the top of the card-player's
   deck as part of building the combat. The chosen card is left resting
   directly beneath them — still in the deck, still reachable — rather than
   being extracted; it attacks "in place", exactly like The Hunt (dm-143) /
   The Great Hunt (wh-91).

Fields:

- `count: number` — how many top cards of the card-player's own deck are revealed.
- `alwaysEligibleRaces: Race[]` — races eligible regardless of uniqueness (e.g. `["ringwraith", "dragon"]` for Nazgûl/Dragon).
- `requireNonCoastalKeying: boolean` — when true, a candidate must be playable in a non-Coastal-Sea region.
- `unplayableProwessPenalty: number` — prowess modifier applied when the chosen creature could not normally have been played on the company (e.g. `-4`).

Implementation: `engine/long-dark-reach.ts` (`findLongDarkReachCandidates`,
`fizzleLongDarkReach`, `buildLongDarkReachCombat`); the reveal + first enqueue
is in `chain-reducer.ts` (`resolveEntry`); the choice resolves via
`legal-actions/pending.ts` (`revealDeckChooseAttackerActions`) and
`pending-reducers.ts` (`applyRevealDeckChooseAttackerResolution`). The
`long-dark-reach-attack` `AttackSource` variant is finalize-safe: a defeated
attack moves the creature into the defending player's kill pile for
marshalling points (or the card-player's discard pile under detainment, CoE
3.II.3) — see `combat-finalize.ts`'s block alongside `hunt-attack`'s.

```json
{
  "type": "reveal-deck-choose-attacker",
  "count": 7,
  "alwaysEligibleRaces": ["ringwraith", "dragon"],
  "requireNonCoastalKeying": true,
  "unplayableProwessPenalty": -4
}
```

Used by Long Dark Reach (dm-70): "Playable on a moving company with at least
one Wilderness [{w}] in its site path if you have at least 10 cards in your
play deck. Reveal the top seven cards of your play deck. One revealed Nazgûl,
Dragon, or a non-unique creature of your choice must immediately attack the
company regardless of its playability requirements (not count against the
hazard limit). The creature must be playable in a region besides Coastal Sea
[{c}]. If the creature could not normally be played on the company, modify its
prowess by -4. Shuffle all unused cards and return them to the top of your
play deck." Paired with a `play-condition` `requires: "site-path"`
(`sitePath.wildernessCount >= 1`) for the Wilderness requirement, and a
`play-condition` `requires: "card-player-deck-size"` (`minDeckSize: 10`, see
§23) for the "if you have at least 10 cards in your play deck" gate — "you" is
the hazard player actually declaring the play, not the moving company's owner,
so this diverges from `active-player-deck-size` (dm-63).

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
`no-creatures-keyed-to-site` and Secret Passage's
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

The `only-creatures-keyed-to-site-if-safe-path` constraint (added by *Elf-path*
td-111 via `on-event: self-enters-play` → `add-constraint`, target
`target-company` resolved from the tapped Elf's company) is the **safe-path-gated**
variant: the same drop of non-site-keyed creatures applies, but **only when**
the protected company's resolved site path (`phaseState.resolvedSitePath`) is
exactly one or two regions and contains no Dark-domain [{d}] or Shadow-land
[{s}] regions (`reducer-utils.ts` `regionTypeCounts`). When the path is longer
or crosses either region type, the constraint imposes nothing
(`applyOnlyCreaturesKeyedToSiteIfSafePath`). Elf-path's cost is `{ "tap":
"character" }` on a `play-target` filtered to `{ "target.race": "elf",
"company.moving": true }` — the tapped Elf's own company ("his company") is
the target, not a separately declared company.

```json
{ "type": "play-target", "target": "character",
  "filter": { "target.race": "elf", "company.moving": true },
  "cost": { "tap": "character" } },
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "add-constraint",
    "constraint": "only-creatures-keyed-to-site-if-safe-path", "scope": "turn" },
  "target": "target-company" }
```

`set-company-special-movement` (§ "Actions" above, previously only reachable
via a grant-action apply — e.g. Gwaihir's `gwaihir-special-movement`) is also
supported directly on a **resource short-event's** `on-event: self-enters-play`
(`reducer-events.ts` `applyShortEventOnEntersPlay`), resolving the target
company from the play-target character (`action.targetScoutInstanceId ??
action.targetCharacterId`) rather than a grant-action bearer. Used by *Paths of
the Dead* (tw-302) with `specialMovement: "paths-of-the-dead"`: the org-phase
movement planner (`organization-companies.ts` `planMovementActions`) offers a
direct `plan-movement` to a site card named "Vale of Erech" regardless of
region adjacency, and the M/H `reveal-new-site` step
(`legal-actions/movement-hazard.ts`) declares the path as
`MovementType.Special` with no traversed regions — the same "no path traversed"
handling as `'gwaihir'`.

```json
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "set-company-special-movement", "specialMovement": "paths-of-the-dead" },
  "target": "target-company" }
```

A third `specialMovement` value, `"belegaer"`, backs *Belegaer* (td-100): "moving
without region cards" between a fixed list of coastal regions (Lindon, Elven
Shores, Eriadoran Coast, Andrast Coast, Bay of Belfalas, Mouths of the Anduin,
Enedhwaith, Old Pûkel-land, Andrast, Anfalas, Belfalas, Lebennin, Harondor).
Unlike `'gwaihir'`/`'paths-of-the-dead'`, this variant does not fall through to
"no path traversed":

- The card's own `play-target` filter gates the origin via `company.siteRegion`
  (the region name of the target character's company's current site, exposed
  by `buildPlayOptionContext` in `legal-actions/organization.ts` alongside
  `company.siteName`/`company.siteType`), checked with `$in` against the
  region list.
- `organization-companies.ts` `planMovementActions` hardcodes the same region
  list (`BELEGAER_REGIONS`) to filter destination candidates once
  `company.specialMovement === 'belegaer'` — any site in the player's site deck
  whose `region` is on the list (other than the current site) is offered,
  regardless of region adjacency.
- `legal-actions/movement-hazard.ts` offers `declare-path` with
  `MovementType.Special` for `'belegaer'` exactly as for the other two modes.
- `mh-steps.ts`'s `declare-path` handler special-cases `'belegaer'`: instead of
  leaving `resolvedSitePath` empty, it sets it to three `RegionType.Coastal`
  entries ("The site path is [{c} {c} {c}]"), so downstream region-type
  consumers (hazard-creature keying, `hazard-limit-region-count`,
  `ahunt-attack` type-matching) see the sea crossing as if it traversed three
  coastal-sea regions.
- `snapshotHazardLimit` (`mh-steps.ts`) applies a flat `-2` floored at `2` when
  `company.specialMovement === 'belegaer'` ("the hazard limit is decreased by
  two to a minimum of two"), applied after every other modifier alongside the
  Going Ever Under Dark (ba-37) movement-restriction reduction.

```json
{ "type": "play-target", "target": "character",
  "filter": { "company.siteRegion": { "$in": ["Lindon", "Elven Shores", "…"] } } }
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "set-company-special-movement", "specialMovement": "belegaer" },
  "target": "target-company" }
```

A fourth `specialMovement` value, `"eagle-mounts"`, backs *Eagle-mounts*
(tw-220): "Company may move to any site that is not a Shadow-hold [{S}],
Dark-hold [{D}], or Under-deeps." This is a **SITE-type** exclusion, distinct
from `'gwaihir'`'s **REGION-type** exclusion (Shadow-land [{s}] / Dark-domain
[{d}]) even though both cards are printed near-identically and share the "any
site not X, only site-keyed hazards" shape — e.g. Moria is a Shadow-hold
sitting in a wilderness region, so it is reachable via `'gwaihir'` but not via
`'eagle-mounts'`. `organization-companies.ts` `planMovementActions` carries a
separate `'eagle-mounts'` branch alongside `'gwaihir'`'s, filtering candidate
destinations on `siteDef.siteType !== 'shadow-hold' && siteDef.siteType !==
'dark-hold'` instead of the destination region's type; both branches apply the
same MEAS §6(b) Under-deeps exclusion (origin and destination). Falls through
to the shared "no path traversed" handling in `legal-actions/movement-hazard.ts`
(`MovementType.Special`) and `mh-steps.ts` (empty `resolvedSitePath`, so only
site-keyed hazard creatures match) exactly like `'gwaihir'`/`'paths-of-the-dead'`.

```json
{ "type": "play-window", "phase": "organization", "step": "end-of-org" },
{ "type": "play-target", "target": "character",
  "filter": { "$and": [
    { "target.skills": { "$includes": "diplomat" } },
    { "company.siteName": "Eagles’ Eyrie" }
  ] } },
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "set-company-special-movement", "specialMovement": "eagle-mounts" },
  "target": "target-company" }
```

The `only-race-creatures-on-company` constraint (added by *Paths of the Dead*
tw-302 via `on-event: self-enters-play` → `add-constraint`, carrying a `race`
field) restricts the opponent to playing only hazard creatures of the given
race against the target company; every other hazard-creature play is dropped
(`legal-actions/pending.ts` `applyOnlyRaceCreaturesOnCompany`, matching
`def.race` or `def.additionalRaces`). Used by tw-302: "The only hazard
creatures that may be played on this company are Undead, but any Undead may be
played on the company."

```json
{ "type": "add-constraint", "constraint": "only-race-creatures-on-company",
  "scope": "turn", "race": "undead" }
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

Grants an additional agent action per turn. Applied during the Untap phase via
`countExtraAgentActions(state, agentId)` (`mh-agents.ts`): each agent's
`remainingActions` is set to `1 + Σ(value)` instead of the default 1, where the
sum is scoped **per agent** from three possible sources:

- Untargeted — the effect sits on a card in `cardsInPlay` with no
  `attachedToAgentId` (Great Need or Purpose dm-62: "Each agent may take an
  extra agent action…"). Applies to **every** agent of **both** players.
- Self, `whileRevealed: true` — the effect is on the agent's own character
  definition and only counts while that specific agent is revealed (My
  Precious dm-29: "If face-up, may take an extra agent action…").
- Attached — the effect is on a card in `cardsInPlay` whose
  `attachedToAgentId` matches this agent (via `play-target: "agent"`; Never
  Seen Him dm-74: "Target agent may take an extra agent action…"). Applies
  only to the one bound agent, for as long as it remains attached (see
  `play-target`'s `agent` entry).

The same total also gates which of an agent's actions taken this turn are
free (don't count against the hazard limit): `chargeAgentActionTail` and the
`agent-move`/`agent-move-back`/`agent-return-home` handlers (`mh-agents.ts`)
mark an action as free when `remainingActions <= countExtraAgentActions(state,
agent.id)` *before* decrementing — i.e. the last `Σ(value)` actions taken are
the free ones, the first (base) action always counts.

Fields:

| Field           | Type    | Description                                              |
|-----------------|---------|-----------------------------------------------------------|
| `value`         | number  | Number of extra actions granted (usually 1)                |
| `whileRevealed` | boolean | Self-scoped: only counts while *this* agent is revealed. Omit for untargeted/attached effects. |

Implementation:

- `reducer-untap.ts` sets each agent's `remainingActions` to
  `1 + countExtraAgentActions(state, agent.id)` during the resource-player
  untap step.
- `legal-actions/movement-hazard.ts` (`agentTurnActions`) and `mh-agents.ts`
  action handlers pass the acting agent's `id` so the free-action threshold is
  scoped to that agent, not summed globally.

Used by *Great Need or Purpose* (dm-62, untargeted), *My Precious* (dm-29,
self `whileRevealed`), and *Never Seen Him* (dm-74, attached via
`play-target: "agent"`).

```json
{ "type": "extra-agent-actions", "value": 1 }
{ "type": "extra-agent-actions", "value": 1, "whileRevealed": true }
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

The optional `source` field says what makes the grant active. It defaults to
`"in-play"` (the carrying card must sit in either player's `cardsInPlay`, as
above). `"faced-this-turn"` moves the grant onto a **hazard creature**: it
applies only against a company that has already faced that creature this turn
— its name appears in the company's `MovementHazardPhaseState.hazardsEncountered`
(rule 8.03: an attack counts as faced even when canceled). The carrier is gone
from play by then, so `collectCreatureKeyingGrants` resolves it from the card
pool by name instead of from `cardsInPlay`.

Used by Dwarven Travelers (as-9): "Maia hazard creatures may be keyed to
Border-holds [{B}] or Ruins & Lairs [{R}] against any company that has faced
Dwarven Travelers this turn."

```json
{
  "type": "grant-creature-keying",
  "source": "faced-this-turn",
  "creatureFilter": { "race": "maia" },
  "siteFilter": { "siteTypes": ["border-hold", "ruins-and-lairs"] }
}
```

`siteFilter.excludeSiteTypes` is the inverse of `siteTypes` — a denylist:
the site-type branch matches any effective site type **except** those listed
(still ANDed with `siteKeywords` when present). Mutually exclusive with
`siteTypes` — a grant uses one or the other, not both. Used for "any site
except …" grants where a positive list would have to enumerate every other
site type.

The optional `companyFilter` additionally gates the grant on the **target
company being attacked**, evaluated only after a `siteFilter` branch already
matched. Context (via `buildTargetCompanyConditionContext`):
`{ company: { itemNames, itemKeywords, alignment, homeSites, characterNames,
maxUntappedWarriorProwess, containsWizard, covert } }` — `itemNames`/
`itemKeywords` are the names/combined keywords of every item borne by any
character in the company (e.g. `"the-one-ring"`, `"ring"`), and `alignment` is
the defending player's rules-terminology alignment label (`"hero"` for a
Wizard player).

Used by The Nazgûl are Abroad (tw-96): "Nazgûl may attack a hero company
containing the bearer of The One Ring at any site that is not a Free-hold
[{F}] or Haven [{H}]. Nazgûl may attack any hero company possessing any Ring
in a Shadow-land [{s}] or Shadow-hold [{S}]."

```json
{
  "type": "grant-creature-keying",
  "creatureFilter": { "keywords": { "$includes": "Nazgûl" } },
  "siteFilter": { "excludeSiteTypes": ["free-hold", "haven"] },
  "companyFilter": {
    "$and": [
      { "company.alignment": "hero" },
      { "company.itemKeywords": { "$includes": "the-one-ring" } }
    ]
  }
}
```

```json
{
  "type": "grant-creature-keying",
  "creatureFilter": { "keywords": { "$includes": "Nazgûl" } },
  "siteFilter": { "siteTypes": ["shadow-hold"], "regionTypes": ["shadow"] },
  "companyFilter": {
    "$and": [
      { "company.alignment": "hero" },
      { "company.itemKeywords": { "$includes": "ring" } }
    ]
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
| `rescueSiteTypes` | yes | Array of site type strings (e.g. `["ruins-and-lairs"]`). Multiple entries are an "or" — any one matching site in the hazard player's location deck satisfies the gate. |
| `rescueAttacks` | yes | Rescue-attack list (shape: `{ race, strikes, prowess }`). |
| `autoRescue` | no | Auto-rescue spec: `{ bodyCheckModifier, autoRescueThreshold }`. Data-only — not yet wired into the engine (dm-58 does not test it). |
| `discardRings` | no | When true, ring items are discarded along with the prisoner's other possessions on capture, overriding the default CoE 8.35/3.III.3 rule that lets a prisoner keep its rings. |
| `untapBodyCheck` | no | `{ modifier }` — at the start of each of the prisoner's untap phases, `enterUntapPhase` (`reducer-untap.ts`) enqueues a `dice-check` (roll 2d6 + `modifier` vs the character's effective body, rolled by the host's owner per CoE 3.I.1) that eliminates the character on failure via the `eliminate-character` dice-check branch. Elimination also drops the character from the host's prisoner bookkeeping (`removePrisonerFromHost`, `reducer-utils.ts`), discarding the (now-empty) host card if it lived only in the `HazardHost` record. Unlike `autoRescue`, surviving has no further effect. |

```json
{
  "type": "take-prisoner",
  "rescueSiteTypes": ["ruins-and-lairs", "shadow-hold"],
  "rescueAttacks": [{ "race": "undead", "strikes": 3, "prowess": 8 }],
  "discardRings": true,
  "untapBodyCheck": { "modifier": 0 }
}
```

Used by Flies and Spiders (dm-58, `autoRescue`) and Spells of the Barrow-wights (dm-90, `discardRings` + `untapBodyCheck`).

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

### 48. `event-maintenance`

An in-play event whose controller must pay an upkeep cost every turn to keep it
on the table — and, optionally, a bidding war in which the opponent may pay to
remove it. Lives in `engine/event-maintenance.ts`; the whole exchange runs as a
sequence of `event-maintenance` pending resolutions, one per *stage*.

| Field | Required | Description |
|-------|----------|-------------|
| `trigger` | yes | When the upkeep fires: `"opponent-long-event-end"` (as the controller's opponent leaves their long-event phase) or `"controller-organization-phase-start"` (as the controller's own organization phase begins). |
| `handCardFilter` | yes | DSL condition evaluated against hand-card definitions. Matching cards may be discarded as payment. |
| `counterChain` | no | `{ challengeCount, counterCount }` — the bidding war after the controller keeps the card. Absent, the upkeep payment ends the matter. |

Stages, alternating actors:

```text
upkeep (controller, 1 card)
  ├─ discard-self ─────────────────────────► source discarded, done
  └─ pays ──► challenge (opponent, challengeCount)
                ├─ decline ────────────────► source stays, done
                └─ pays ──► counter (controller, counterCount)
                              ├─ decline ──► source discarded, done
                              └─ pays ──► challenge (opponent) …
```

Each stage is resolved by one or more `pay-event-maintenance` actions:
**`discard-self`** (upkeep only) gives the card up; **`discard-from-hand`**
pays one matching card towards the stage's cost; **`decline`** bids nothing.
A stage costing more than one card is paid one action at a time, and the opt-out
is offered only while nothing has been paid yet — once a player starts paying
they are committed.

A stage is only enqueued when its actor actually holds enough matching hand
cards to finish it. Otherwise the stage is skipped and its "declined" outcome
applied at once: an unaffordable *challenge* leaves the card in play, an
unaffordable *counter* discards it. So a controller with no matching card at
`upkeep` has exactly one legal action (`discard-self`), and neither player is
ever prompted for a decision they cannot make.

```json
{
  "type": "event-maintenance",
  "trigger": "opponent-long-event-end",
  "handCardFilter": { "cardType": "hazard-creature", "race": "man" }
}
```

```json
{
  "type": "event-maintenance",
  "trigger": "controller-organization-phase-start",
  "handCardFilter": { "keywords": { "$includes": "environment" } },
  "counterChain": { "challengeCount": 1, "counterCount": 2 }
}
```

Used by Thrice Outnumbered (le-142, upkeep only) and Balance Between Powers
(dm-118, upkeep + counter chain: "At the start of your organization phase,
discard this card **or** keep it in play by discarding an environment card from
your hand. Your opponent can then discard an environment card from his hand to
discard this card, which you can counter by discarding two … he with one, etc.").

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

### 53a-bis. `free-strike-assignment`

An **environment** effect: while the carrying card sits in a player's
`cardsInPlay`, the defender of any **hazard-creature-sourced** attack
(`attack.source` of `"creature"`, `"on-guard-creature"`, or
`"played-auto-attack"` — the same set `tap-on-strike-assignment` uses to mean
"hazard creature attack"; never a site's own automatic-attack, an agent, or a
CvCC attack) may assign that attack's strikes to **any** character or ally in
the defending company, regardless of tapped/wounded status, and the attack's
own `combat-attacker-chooses-defenders` rule (if any) is suppressed for that
attack — assignment always opens in the defender's own phase instead of a
cancel-window/attacker phase.

No fields beyond `type` (and the inherited optional `when`, matched against
`{ attack: { creatureRace } }`).

```json
{ "type": "free-strike-assignment" }
```

Resolved by `resolveDefenderFreeStrikeAssignment` (`reducer-utils.ts`),
mirroring `resolveAttackerChoosesDefenders`'s global-`cardsInPlay` scan, at
every hazard-creature-sourced combat-initiation site (`chain-reducer.ts`
`initiateCreatureCombat`, `reducer-site.ts`'s played-auto-attack path). When
granted, the initiation site both drops its own `attackerChoosesDefenders`
value and sets `CombatState.defenderFreeStrikeAssignment`, which
`assignStrikeActions` (`legal-actions/combat.ts`) consults to drop its
untapped-only gate for characters and allies alike.

Used by Cloudless Day (td-104): "Whenever a company faces a hazard creature
attack, the defender may choose which characters in the company will be the
targets of the attack's strikes (regardless of tapped status, wounded status,
and the normal abilities of the attack)."

---

### 53a-ter. `company-combat-boost`

Played from hand as a resource **short event during combat** (the pre-assignment
window of the defending company's `assign-strikes` phase). Applies an
attack-scoped stat modifier to characters in the **defending** company. The
boost is realised as one `character-stat-modifier` active constraint per boosted
character with `scope: { kind: 'attack' }`, swept when the attack finalizes.

| Field | Required | Description |
|-------|----------|-------------|
| `stat` | yes | `"prowess"`, `"body"` (both install a `character-stat-modifier` constraint on the character's own stat), or `"creature-body"` (installs a `character-creature-body-modifier` constraint that reduces the *attacking creature's* body-check target for strikes the character faces — see below). |
| `value` | no | Fixed modifier value (positive boosts, negative penalises; for `"creature-body"`, the magnitude subtracted). Ignored (and may be omitted) when `costDiscard` is present. |
| `filter` | no | Per-character grant filter, matched against `{ target: { race, name, skills, keywords } }`. Only matching characters receive the boost; the card is offered when at least one member matches. When absent (and no `companyFilter`/`itemFilter`), every member is boosted. Ignored when `itemFilter` is set. |
| `companyFilter` | no | Company-level eligibility gate. When present, the event may be played only if at least one member satisfies it — and then **every** character in the company is boosted (the per-character `filter` is not used). Distinguishes "boost characters that are X" (`filter`) from "boost the whole company if it contains an X" (`companyFilter`). Ignored when `itemFilter` is set. |
| `itemFilter` | no | Per-item condition matched against `{ item: { name, keywords, cardType, subtype } }` (same shape as `in-play-item-modifier`'s `itemFilter`) for every item borne by every company member. Switches the boost from "once per matching character" to **once per matching borne item** — a bearer of two qualifying items receives it twice. The card is offered when any member bears a matching item; `filter`/`companyFilter` are ignored. |
| `when` | no | Gate restricting which attack the card may be played against, evaluated against `{ enemy: { race, name, overt } }`. `race` is the current attack's creature race (populated for hazard creatures, on-guard reveals, played-auto-attacks, and site automatic-attacks alike); `name` is the specific creature card's printed name, empty when the attack has no individual creature card; `overt` is the attacking company's overt status, present (`true`/`false`) only for a CvCC attack (resolved via `isCovertCompany`), absent for a creature/automatic-attack. Absent `when` means any attack. |
| `costDiscard` | no | `{ source: "hand", filter, minCount, maxCount }` — replaces the fixed `value` with a variable one. The player picks between `minCount` and `maxCount` matching cards from `source` to discard as payment; the boost `value` becomes the sum of their printed `marshallingPoints`. `filter` is matched against each candidate's card definition, extended with `faction.playableRegions` (via `buildFactionPlayableRegions`) for faction candidates. One `play-short-event` action is offered per eligible combination, carrying the chosen instances as `costDiscardInstanceIds`. |
| `requiredSkill` | no | Switches to cost-bearing single-target mode (see below) — the skill the chosen/paying character must have. Only meaningful alongside `cost`. |
| `cost` | no | Switches to cost-bearing single-target mode — an {@link ActionCost} (e.g. a corruption check) the chosen character pays; only that character receives the boost, `filter`/`companyFilter` are ignored. |
| `costExemptRace` | no | Waives `cost` for a cost-payer of this race. |

**`itemFilter` + `stat: "creature-body"` (Biter and Beater! as-46):** "Playable
on a company facing an Orc attack or in combat with an overt company. Also
playable during opponent's site phase. Every Sword of Gondolin, Orcrist, and
Glamdring in target company give an additional +2 prowess bonus and lower the
body of strikes their bearers face by 1."

```json
{ "type": "company-combat-boost", "stat": "prowess", "value": 2,
  "itemFilter": { "item.name": { "$in": ["Sword of Gondolin", "Orcrist", "Glamdring"] } },
  "when": { "$or": [{ "enemy.race": "orc" }, { "enemy.overt": true }] } }
{ "type": "company-combat-boost", "stat": "creature-body", "value": 1,
  "itemFilter": { "item.name": { "$in": ["Sword of Gondolin", "Orcrist", "Glamdring"] } },
  "when": { "$or": [{ "enemy.race": "orc" }, { "enemy.overt": true }] } }
```

The reducer loops every matching item on every company member, adding one
constraint per item (stacking). For `stat: "prowess"`, the constraint carries
an optional `max` (a new field on the `character-stat-modifier` constraint
kind, threaded into the synthesized `stat-modifier` effect by
`effects/resolver.ts` so it clamps the running total exactly like a JSON
`stat-modifier`'s own `max`) — resolved by re-collecting that one matching
item's own `stat-modifier(prowess)` effects through the shared resolver
(`collectCharacterEffects` + `buildBearerContext`, the same `reason: "combat"`
/ `enemy.race` context used elsewhere) and picking its override entry over its
base entry, the same selection `resolveStatModifiers` itself performs. This
matches the card's French reference text: "the maximum values indicated by
the weapons still apply" — the extra +2 cannot push a named weapon's prowess
contribution past that weapon's own printed ceiling (e.g. Glamdring's max 9
vs Orcs still caps Glamdring + Biter and Beater! combined).

For `stat: "creature-body"`, the reducer instead adds a
`character-creature-body-modifier` constraint (`characterId`, `value`) —
consumed in `combat-actions.ts` `handleBodyCheckRoll`'s `bodyCheckTarget ===
'creature'` branch alongside `resolveEnemyBody`'s item-sourced reduction
(`Math.max(0, body - value)`). This is the short-event counterpart of an
item's `enemy-modifier` (stat `"body"`, op `"subtract"` — see §5 below), which
normally only reaches a bearer through their own borne items; it only matters
for attacks against a body-checkable creature (`combat.creatureBody !==
null`), a no-op otherwise. "Also playable during opponent's site phase"
needed no engine change: `company-combat-boost` is offered whenever
`state.combat` exists and `playerId === combat.defendingPlayerId`, independent
of whose site-phase turn is active.

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

**`when` + `costDiscard` (Alert the Folk td-97):** "Playable on a company
facing a Dragon or Drake attack (not Eärcaraxë). Discard from your hand any
one or two factions playable at sites in Northern Rhovanion, Iron Hills,
Woodland Realm, or Anduin Vales. All characters facing the attack gain a
bonus to their prowess equal to the total marshalling point values … of the
factions discarded."

```json
{ "type": "company-combat-boost", "stat": "prowess",
  "when": { "$and": [
    { "enemy.race": { "$in": ["dragon", "drake"] } },
    { "enemy.name": { "$ne": "Eärcaraxë" } } ] },
  "costDiscard": {
    "source": "hand",
    "filter": { "$and": [
      { "marshallingCategory": "faction" },
      { "$or": [
        { "faction.playableRegions": { "$includes": "Northern Rhovanion" } },
        { "faction.playableRegions": { "$includes": "Iron Hills" } },
        { "faction.playableRegions": { "$includes": "Woodland Realm" } },
        { "faction.playableRegions": { "$includes": "Anduin Vales" } } ] } ] },
    "minCount": 1, "maxCount": 2 } }
```

`companyCombatBoostActions` builds the `{ enemy: { race, name } }` context from
`combat.creatureRace` and (when the attack is backed by an actual creature
instance — `attackSourceCreatureInstanceId`) that creature's resolved
definition name; a boost whose `when` doesn't match the current attack is
never offered. When `costDiscard` is present, candidate hand cards are
filtered (excluding the played card itself) and every combination of
`minCount`..`maxCount` of them is offered as a separate action. On
resolution, `handlePlayResourceShortEvent` validates the chosen
`costDiscardInstanceIds` against the same filter and count bounds, moves them
from the controller's hand to their discard pile, and sums their printed
`marshallingPoints` as the constraint `value` instead of a fixed number.

**Cost-bearing single-target mode.** A `cost` field (an {@link ActionCost},
typically a corruption check) switches the effect from "boost every
`filter`-matching character" to "boost exactly one chosen character, who also
pays the cost." Add `requiredSkill` to gate which characters qualify (matched
against the character's *printed* skills, not `filter`/`companyFilter` — those
two fields are ignored once `cost` is present). `costExemptRace` waives the
cost for a cost-payer of that race, mirroring `cancel-attack`'s field of the
same name.

`companyCombatBoostActions` (`legal-actions/combat.ts`) offers one
`play-short-event` action per company character satisfying `requiredSkill`
(or every character when absent) that `canPayCost` accepts, carrying
`targetCharacterId` for the chosen character — no tap-cost filtering is
needed since corruption-check costs don't require the payer to be untapped.
`handlePlayResourceShortEvent` (`reducer-events.ts`) resolves `action.
targetCharacterId`: if the character's race matches `costExemptRace` the cost
is skipped, otherwise `applyCost` enqueues the corruption check (or pays
whatever the cost declares); the boost constraint is then added for that one
character only.

```json
{ "type": "company-combat-boost", "stat": "prowess", "value": 4,
  "requiredSkill": "sorcery",
  "cost": { "check": "corruption", "modifier": -4 },
  "costExemptRace": "ringwraith" }
```

Used by Some Secret Art of Flame (le-232): "Playable on a sorcery-using
character facing an attack. +4 prowess for the character against the attack.
Unless he is a Ringwraith, character makes a corruption check modified by
-4." — the same `requiredSkill`/`cost`/`costExemptRace` shape as `cancel-attack`
(see The Tormented Earth as-102), but boosting the chosen character's own
prowess instead of canceling or weakening the attack.

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

**Same convention for `stat-modifier`**: a `stat-modifier`'s `when` is evaluated in
the effective-stats context, where `bearer.skills` is the *merged* set (printed +
every granted skill, including the card's own `grant-skill`). A card that grants a
skill and also conditions a bonus on the bearer already having that skill must
therefore read `bearer.naturalSkills` (printed skills only) instead of `bearer.skills`
— otherwise its own grant would make the condition trivially always true. Used by
Magic Ring of Courage (tw-271): "gives the bearer warrior skill; if already a
warrior, +2 prowess" —
`{ "type": "stat-modifier", "stat": "prowess", "value": 2, "when": { "bearer.naturalSkills": { "$includes": "warrior" } } }`.

| Field | Required | Description |
|-------|----------|-------------|
| `skill` | yes | The skill name to grant (e.g. `"scout"`, `"sage"`, `"warrior"`). |

```json
{ "type": "grant-skill", "skill": "scout" }
```

Used by Magic Ring of Stealth (tw-274), Magic Ring of Courage (tw-271).

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

### `adjacentToSiteNames`

```json
{ "adjacentToSiteNames": ["The Under-gates"] }
```

The named-site sibling of `adjacentToSiteKeywords`: matches when the destination
site is adjacent (in the under-deeps movement sense — bidirectional via
`adjacentSites`, using the same `resolveAdjacency`/`isUnderDeepsAdjacent`
machinery) to any site printing one of the listed *names*, resolved against
every same-named printing in `state.cardPool` (a site name like "The
Under-gates" has separate hero/minion/balrog printings). Used for creatures
whose base keying is tied to a single canonical site rather than a keyword
category — the base cost still needs its own `siteNames` entry for the named
site itself, since adjacency does not include the site.

The keying method recorded in `keyedBy.method` is `"adjacent-to-site-name"`.
Evaluated in `findCreatureKeyingMatches` (movement-hazard.ts) and
`checkCreatureKeying` (mh-hazard-play.ts).

Used by: *Durin's Bane* (dm-107) — "May be played at The Under-gates and at all
of its adjacent sites" (`keyedTo: [{ siteNames: ["The Under-gates"] },
{ adjacentToSiteNames: ["The Under-gates"] }, { siteKeywords: ["under-deeps"],
when: { inPlay: "Doors of Night" } }]`).

### `followsAttackRaces`

```json
{ "followsAttackRaces": ["orc"] }
```

Matches when the target company has, during its *current* M/H sub-phase, already
faced a creature-sourced hazard attack (played from hand — "not keyed to a site",
i.e. not a site automatic-attack or on-guard reveal) by a creature of one of the
listed races. Evaluated against `deriveFacedRaces(state, mhState.hazardsEncountered)`
(`reducer-utils.ts`) — `hazardsEncountered` only ever records creature-sourced
attacks (`recordHazardEncountered`, `combat-finalize.ts`, gated on
`combat.attackSource.type === 'creature'`), which is exactly "not keyed to a site."
Scoped to the company's current M/H sub-phase (cleared at company start,
`freshCompanyFields`), and unordered — any qualifying attack faced earlier in the
same sub-phase satisfies it, not only the immediately preceding one.

The keying method recorded in `keyedBy.method` is `"follows-attack"`. Checked in
`findCreatureKeyingMatches` (movement-hazard.ts) and `checkCreatureKeying`
(mh-hazard-play.ts).

Used by: *Wolf-riders* (td-86) — "May be played following any Orc attack not keyed
to a site." (`keyedTo: [{ "followsAttackRaces": ["orc"] }]`, no other keying entry —
this creature has no ordinary region/site keying at all.)

### `movingBetweenSiteNames`

```json
{ "movingBetweenSiteNames": ["Rivendell", "Lórien"] }
```

Site-to-site movement keying. Matches when the company is moving directly between
two of the named sites: the company's origin (current) site name and its destination
site name must both appear in the list and differ from each other, so a single entry
covers both directions of the route. A non-moving company never matches, because its
destination site name equals its origin site name.

Evaluated in `findCreatureKeyingMatches` (legal-actions/movement-hazard.ts, offer
side — the origin resolves from the target company's `currentSite`) and
`checkCreatureKeying` (mh-hazard-play.ts, validation side — the origin resolves from
the active company's `currentSite`). The keying method recorded in `keyedBy.method`
is `"moving-between-sites"` with the route as the value (e.g. `"Rivendell to Lórien"`).

Used by: *The Great Goblin* (tw-95) — "May also be played on a company moving from
Rivendell to Lórien or from Lórien to Rivendell."

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

### 47. `skill-suppression` / `location-magic-restriction`

A pair of **character**-scoped location gates, distinct from
`force-return-to-origin`/`tap-sites-in-play` above (which evaluate a
**company**'s site path once at movement resolution). These two resolve a
single character's location on demand, at any phase, via the shared
`characterLocation` helper (`engine/reducer-utils.ts`):

- The character's company's **current** site's containing region (its
  `regionType` via `siteRegionTypeOf`, and its printed `region` name) —
  populated whenever the company has a `currentSite`, regardless of phase.
- **Only** while that company is the *active mover* of an in-progress
  movement/hazard phase, the phase's `resolvedSitePath` /
  `resolvedSitePathNames` — the engine does not persist a company's site path
  outside that window (see `mh-steps.ts`'s `transitionToDrawCards`, which
  computes and consumes it for the same active company).

`locationMatchesSpec(loc, spec)` matches either fact against `spec`'s
`regionTypes` / `regionNames`. Both effects below share this location shape
plus `noEffectOnMinion?: boolean` — the *Foul Fumes* (tw-36) / *Mordor in
Arms* (dm-72) convention, checked against the **affected character's own**
controller, not the carrying card's owner.

**`skill-suppression`** — while the carrying card is in play, a character
whose location matches no longer counts as having `skill` for any purpose
that reads `getEffectiveSkills`.

| Field | Required | Description |
|-------|----------|--------------|
| `skill` | yes | The skill a matching character no longer counts as having (e.g. `"sage"`). |
| `regionTypes` | no | Region types (e.g. `["dark"]`) whose sites/paths trigger the suppression. |
| `regionNames` | no | Named regions (e.g. `["Gorgoroth"]`) whose sites/paths trigger the suppression. |
| `noEffectOnMinion` | no | When `true`, a character controlled by a Ringwraith/Balrog player is exempt. |

```json
{ "type": "skill-suppression", "skill": "sage",
  "regionTypes": ["dark"], "regionNames": ["Gorgoroth"],
  "noEffectOnMinion": true }
```

Consulted inside `getEffectiveSkills` (`engine/effects/resolver.ts`), which
filters its final `[...base, ...granted]` skill list through
`isSkillSuppressedForCharacter` (`reducer-utils.ts`). Every existing consumer
of a character's effective skills — site `grant-action` costs like
`sage-and-scout-in-company` / `sage-in-company`, `organization.ts`'s
`sage-tap-ring-test` — therefore respects the suppression automatically, with
no per-call-site change.

**`location-magic-restriction`** — while the carrying card is in play, a
character whose location matches may not play a magic-class card: one
carrying any of `keywords`.

| Field | Required | Description |
|-------|----------|--------------|
| `regionTypes` | no | Region types whose sites/paths trigger the restriction. |
| `regionNames` | no | Named regions whose sites/paths trigger the restriction. |
| `keywords` | no | Card keywords counted as "magic". Defaults to `["spell","sorcery","spirit-magic","shadow-magic","light-enchantment","ritual"]`. |
| `noEffectOnMinion` | no | When `true`, a character controlled by a Ringwraith/Balrog player is exempt. |

```json
{ "type": "location-magic-restriction",
  "regionTypes": ["dark"], "regionNames": ["Gorgoroth"],
  "noEffectOnMinion": true }
```

Enforced centrally by `applyLocationMagicRestriction`
(`engine/location-magic-restriction.ts`), wired into `computeLegalActions`
alongside `applyCardPlayProhibitions` (mirroring that module's "central
rather than per-phase" rationale — see its own module doc — so the lock
reaches every window a magic card can be played from). For each *viable*
evaluated action, it resolves the played card via `cardInstanceId` and the
acting/casting character via the first of `characterId`, `scoutInstanceId`,
`targetCharacterId`, `targetScoutInstanceId` present on the action (covering
reactive `cancel-attack`/`cancel-influence` spells and `play-target`-bound
permanent-event rituals/light-enchantments alike); an action naming none of
those fields is left alone. A match turns the action into a `not-playable`
entry.

`draw-modifier`'s resolver context (built in `mh-steps.ts`'s
`transitionToDrawCards`) also gained a `player: { minion }` field — the
moving company's own alignment — so a `draw-modifier`'s `when` can use the
same `player.minion` gate `force-return-to-origin`/`tap-sites-in-play`
already exposed, e.g. `{ "player.minion": false }`.

Used by *In the Heart of his Realm* (dm-67): "Each company moving in a
Dark-domain [{d}] draws one less card … (to no minimum). Additionally, any
sage at a site in a Dark-domain [{d}] or Gorgoroth, or moving with a
Dark-domain [{d}] or Gorgoroth in his site path, loses his sage skill. No
character at a site in a Dark-domain [{d}] or Gorgoroth, or moving with a
Dark-domain [{d}] or Gorgoroth in his site path, can use spells, light
enchantments, or rituals. … This card has no effect on a minion player." —
a `draw-modifier` (`"resource"`, `-1`, `min: 0`, `appliesTo: "any-company"`,
`when: { "$and": [{ "sitePath.darkCount": { "$gte": 1 } }, { "player.minion": false }] }`),
the `skill-suppression` and `location-magic-restriction` examples above, plus
the pre-existing `play-restriction unplayable-when opponent.alignment:
"ringwraith"` and an `on-event play-deck-exhausted` self-discard.

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

### 49b. `eliminate-instead-of-discard` — a discard from play becomes an elimination

Carried by an in-play card (Pallando the Soul-keeper, as-17, in its
permanent-event mode). While the card is in play, a character that would be
**discarded from play** and matches `filter` is instead **eliminated**: its card
goes to its owner's out-of-play pile rather than the discard pile, so it can
never be recycled.

```json
{
  "type": "eliminate-instead-of-discard",
  "filter": { "cardType": "minion-character", "race": { "$ne": "ringwraith" } },
  "discardSelf": true
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `filter` | no | Card-definition condition (`matchesDefinition`) the discarded character must match. Absent = every character discard is replaced. |
| `discardSelf` | no | When `true`, the host card is discarded the moment the replacement fires — which is also what makes the effect one-shot ("the **next** … is instead eliminated"). |

Behaviour (engine mechanics in `engine/eliminate-instead-of-discard.ts`):

- **Which removals.** The same five "discard from play" seams Press-gang covers:
  `discardCharacter` (dice-check discards, `pending-reducers.ts`), the
  corruption-check `discard` outcome, the rule-3.22 voluntary organization
  discard, the combat body-check discard band, and the Abductor "discard wounded
  character" effect. A removal that is *already* an elimination is untouched.
- **What changes.** Only the destination of the character card itself. Items,
  allies and hazards still go to the discard piles and followers still revert to
  general influence, exactly as for a normal discard (CoE 7.1: discard and
  eliminate share the whole shape). No kill marshalling points change hands — the
  effect redirects a removal that was already happening.
- **Scope.** Both players' `cardsInPlay` are scanned (the wording is "the next …
  minion", not "your opponent's"); set-aside copies never fire.
- **Against Press-gang.** The `press-gang-capture` check runs first and wins: a
  captured character is held off to the side and never discarded at all, so there
  is nothing left to replace.

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

### 52-1. `fw-site-alignment-restriction`

Locks which **alignment of a site card** a Fallen-wizard player may use for a
location. A Fallen-wizard's location deck may hold both the hero and the minion
card for the same place (CoE rule 1.28), and the two play very differently —
hero Lórien (tw-408) is a Haven, minion Lórien (as-155) a plain Free-hold with
no haven benefits.

| Field | Required | Description |
|-------|----------|-------------|
| `require` | yes | The alignment the Fallen-wizard is forced to use — `"minion"` or `"hero"`. The *opposite* version is the one barred. |
| `siteTypes` | yes | Printed site types the lock covers, read off the barred card (e.g. `["haven"]` with `require: "minion"` bars hero Haven cards). |
| `when` | no | Matched per Fallen-wizard player against `{ player: { alignment, stagePoints } }`, so one card can escalate with stage points. |

```json
{ "type": "fw-site-alignment-restriction", "require": "minion", "siteTypes": ["free-hold"],
  "when": { "player.stagePoints": { "$gt": 4 } } }
```

Behaviour (`fwSiteVersionForbidden` in `reducer-utils.ts`): while a card carrying
this effect is in play, **every** Fallen-wizard player (both players' `cardsInPlay`
are scanned, and the `when` is evaluated against the *restricted* player, not the
controller) is barred from using the opposite version of any location whose
printed site type is listed. Only `hero-site` / `minion-site` cards can be barred:
a `fallen-wizard-site` — any Wizardhaven — counts as both hero and minion
(MEWH §10) and is never locked.

The lock is consumed where a player picks a site card, i.e. when movement is
declared (`organization-companies.ts` `planMovementActions`). A barred card is
dropped while the candidate list is built, *before* it can claim the location's
name → instance slot, so the surviving version of the same location becomes the
destination actually used; when the deck holds only the barred version the
location becomes unreachable. The same check drops a sibling company's in-play
site (rule 2.II.7.2), so a Fallen-wizard cannot join a company standing on a
barred card either. Agent movement is untouched — CoE 4.F1 already pins a
Fallen-wizard's agents to hero site cards regardless of the player's own lock.

Used by Heart Grown Cold (wh-21): "Fallen-wizard players must use minion site
cards for hero Havens [{H}]. If a Fallen-wizard has more than 4 stage points, his
player must also use minion site cards for Free-holds [{F}]. If a Fallen-wizard
has more than 7 stage points, his player must also use minion site cards for
Border-holds [{B}]."

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
restriction cards on one company stack: `noStarterMovement` and
`noUnderDeepsMovement` each OR, the region cap takes the strictest declared
maximum, and hazard modifiers sum.

| Field | Required | Description |
|-------|----------|-------------|
| `noStarterMovement` | no | When `true`, the bound company may not use starter movement. |
| `noUnderDeepsMovement` | no | When `true`, the bound company may not move to an Under-deeps site (keyword `under-deeps`). |
| `regionMovementMax` | no | Hard cap on the number of regions the company may span in region movement ("limited in all cases to N regions maximum"). |
| `hazardLimitModifier` | no | Added to the company's hazard limit **only when it moves via region movement** (negative reduces it). |
| `hazardLimitFloor` | no | Floor the hazard limit is never reduced below by `hazardLimitModifier`. |

```json
{ "type": "company-movement-restriction", "noStarterMovement": true, "regionMovementMax": 3, "hazardLimitModifier": -1, "hazardLimitFloor": 2 }
```

```json
{ "type": "company-movement-restriction", "noStarterMovement": true, "noUnderDeepsMovement": true, "regionMovementMax": 3, "hazardLimitModifier": -1, "hazardLimitFloor": 2 }
```

Behaviour (`effects/company-restrictions.ts` `companyMovementRestrictions`): the
aggregate is read at organization plan-movement (`organization-companies.ts`,
drops starter destinations, caps region distance, and — when
`noUnderDeepsMovement` — skips the entire Under-deeps destination pass), M/H
select-company (`mh-steps.ts`, caps `phaseState.maxRegionDistance`), M/H
declare-path (`legal-actions/movement-hazard.ts`, suppresses the starter path
option and, when `noUnderDeepsMovement`, the Under-deeps declare-path option),
and the hazard-limit snapshot (`mh-steps.ts` `snapshotHazardLimit`, applies the
floored hazard modifier). The hazard modifier is gated on a region-moving
company (`movementType === region`), per CRF 22: "The hazard limit reduction only
works if the company is moving." Used by Going Ever Under Dark (ba-37,
`noStarterMovement` only) and Crept Along Carefully (ba-29, adds
`noUnderDeepsMovement`: "cannot use starter movement or move to an Under-deeps
site").

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

While the carrying card is in play, the cards it selects may not be played by
**either** player. The generic "prohibits the subsequent play of X" primitive —
a hard play-lock, distinct from `cancel-card-effects` (which only suppresses an
in-play card's *constraints* while leaving it in play and re-playable).

| Field | Required | Description |
|-------|----------|-------------|
| `cardNames` | no | Names of the cards discarded on entry and barred from play. |
| `filter` | no | Condition matched against card **definitions**, for class-wide locks. Forward-looking only — nothing already in play is touched. |

At least one of the two must be present; they may be combined.

```json
{ "type": "prohibit-card-play", "cardNames": ["The Way is Shut"] }
```

```json
{ "type": "prohibit-card-play",
  "filter": { "keywords": { "$includes": "environment" } } }
```

Behaviour, `cardNames`: on enter-play the resolving long-event discards every
matching card from either player's `cardsInPlay` to its owner's discard pile
(`resolveLongEvent` → `applyProhibitCardPlayOnResolve`, `chain-reducer.ts`).
This one-time table sweep is what "**Discards** and prohibits …" means, so it is
tied to `cardNames` and never runs for a bare `filter` lock.

Behaviour, ongoing lock: enforced centrally in `computeLegalActions`
(`applyCardPlayProhibitions`, `engine/card-play-prohibition.ts`), which turns
every viable `play-short-event` / `play-long-event` / `play-permanent-event` /
`play-hazard` action for a locked card into a single `not-playable` entry. Being
central, the lock holds in every phase menu and in the chain and combat response
windows alike. Entries a phase module already marked non-viable are left as they
are, so a module with a more specific reason keeps it — the hazard generator
(`playHazardsActions`, `legal-actions/movement-hazard.ts`) checks the same lock
itself and explains it per target company.

Used by:

- The Under-roads (as-106): "Discards and prohibits the subsequent play of The
  Way is Shut." (`cardNames`)
- Balance Between Powers (dm-118): "No environment cards can be played."
  (`filter` on the `environment` keyword — both players, both alignments of
  environment, and the environments already on the table stay put)

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
(`heroResourceShortEventActions`). Per CoE 9.4/9.5, playing it declares an
entry on the chain of effects rather than resolving inline
(`handlePlayResourceShortEvent`, `reducer-events.ts`, routing through
`routeShortEventToChain`) so the opponent has a chance to respond before the
company is flagged; once both players pass priority, the chain resolver (the
`grant-extra-mh-phase` block in `chain-reducer.ts`) sets `extraMHPhasePending`
on the target company. After the company commits its move (`endCompanyMH`),
`advanceAfterCompanyMH`
(`mh-hazard-play.ts`) consumes the flag and enters the dedicated
`extra-mh-move-offer` step: the active player either chooses a new destination
reachable from the current site (`extra-mh-move`, `handleExtraMHMoveOffer`
re-enters `reveal-new-site` with the per-phase state reset) or passes to finalize
the company. Unlike `extra-under-deeps-mh-phase`, the extra move is a normal
starter/region movement (not restricted to Under-deeps), grants exactly one extra
phase (a one-shot short-event, not a persistent in-play effect), and carries no
roll penalty.

**Under-deeps variant** — `movement: "under-deeps"` (World Gnawed by the
Nameless as-110: "Playable during the movement/hazard phase on a company moving
to an Under-deeps site. At the end of its movement/hazard phase, target company
attempts to move to an additional Under-deeps site which it has not attempted
to move to yet this turn."):

- The play gate additionally requires the company's destination site to carry
  the `under-deeps` keyword.
- Resolution sets `extraMHPhasePending: 'under-deeps'`; `advanceAfterCompanyMH`
  enters `extra-mh-move-offer` with `extraMHMoveUnderDeeps` set on the M/H
  phase state, so the offered destinations come from
  `extraMHUnderDeepsDestinations` instead: site-deck sites with the
  `under-deeps` keyword, Under-deeps-adjacent to the company's current site,
  and **not attempted by this company yet this turn**. Every Under-deeps
  declare-path records its destination in `underDeepsAttempts` on the M/H
  phase state (keyed by company id), so a destination whose movement roll
  failed still counts as attempted. The extra phase runs through the normal
  Under-deeps declare-path/roll flow with no extra roll penalty.
- `returnToHand: true` — "Return this card to your hand": the resolved event
  stays in its owner's hand instead of going to the discard pile, so it can be
  replayed during the extra movement/hazard phase to chain further Under-deeps
  moves.

```json
{ "type": "grant-extra-mh-phase", "movement": "under-deeps", "returnToHand": true }
```

### 52b-i-b. `keyed-attacks-normal`

Companion effect on a company-affecting resource event (World Gnawed by the
Nameless as-110: "All hazard creatures the company faces this turn keyed to
Shadow-holds [{S}] attack normally, not as detainment"). When the carrying
event resolves on a company, a **turn-scoped `keyed-attacks-normal` active
constraint** is installed on that company.

```json
{ "type": "keyed-attacks-normal", "siteTypes": ["shadow-hold"] }
```

While the constraint is active, `isDetainmentAttack` (`engine/detainment.ts`)
receives the union of the constraint's site types as `normalIfKeyedToSiteTypes`
(collected by `companyKeyedAttacksNormalSiteTypes`, `reducer-utils.ts`) and
forces any attack **actually keyed** to one of them to resolve as a normal,
non-detainment attack — overriding `combat-detainment` effects on the creature
and the alignment-based §3.II keying rules alike. The attack's actual keying is
the declared keying match when the play declared one
(`attackDeclaredSiteTypes`: the creature-play path in `chain-reducer.ts`
threads its declared site-type keying; the `dynamic-auto-attack` played-attack
path in `reducer-site.ts` threads the site rule's own keying `siteTypes`), else
the union of the creature's currently-valid `keyedTo` site types (on-guard
reveals, Great Hunt attacks).

### 52b-ii. `extra-mh-phase` constraint (organization-phase promise)

The organization-phase sibling of `grant-extra-mh-phase`, for cards played
*before* the move resolves — Master of Esgaroth (td-135): "Playable at the end
of the organization phase on a moving company. If the company moves to a
Border-hold [{B}], it can take a second movement/hazard phase immediately
following its first movement/hazard phase."

Because the destination is not final when the card is played, the card is
playable on **any** moving company and the "if it moves to …" clause is checked
later. The card carries the usual end-of-org trio, with the gate on the
`add-constraint` apply:

```json
{ "type": "play-window", "phase": "organization", "step": "end-of-org" },
{ "type": "play-target", "target": "company", "filter": { "company.moving": true } },
{
  "type": "on-event",
  "event": "self-enters-play",
  "apply": {
    "type": "add-constraint",
    "constraint": "extra-mh-phase",
    "scope": "turn",
    "requiresDestinationSiteType": "border-hold"
  },
  "target": "target-company"
}
```

`requiresDestinationSiteType` is the `SiteType` the company must actually have
moved to; omit it for an unconditional grant.

Behaviour: resolving the event installs a turn-scoped `extra-mh-phase`
constraint targeted at the chosen company. When that company's movement/hazard
phase ends, `advanceAfterCompanyMH` (`mh-hazard-play.ts`) looks for a matching
constraint via `extraMHPhaseConstraint`: the company must have `moved` and its
new `currentSite` must be of the required type. On a match the constraint is
**consumed** (`removeConstraint`) and the company enters the same
`extra-mh-move-offer` step `grant-extra-mh-phase` uses, so the second phase runs
through the identical `extra-mh-move` → `reveal-new-site` path. Consuming the
constraint is what bounds the card to exactly one extra phase even when the
second move also lands on a qualifying site. A company that moved elsewhere — or
did not move at all — leaves the constraint in place, inert, until the turn-end
sweep.

### 52b-iii. `ally-tap-extra-mh-phase`

Carried by an **in-play ally** attached to a character in the company (not the
short-event/constraint-bound cards `52b-i`/`52b-ii` above); grants the tap
option at the same end-of-M/H-phase decision point, but only while a
company-composition `condition` holds and the ally is untapped (Shadowfax
tw-326: "If his company has only one character or one character and a Hobbit
at the end of the movement/hazard phase, tap Shadowfax to allow his company to
immediately move again; an additional site card may be played and an
additional movement/hazard phase follows for that company.").

```json
{
  "type": "ally-tap-extra-mh-phase",
  "counts": [
    { "as": "hobbit", "filter": { "character.race": "hobbit" } }
  ],
  "condition": {
    "$or": [
      { "company.characterCount": 1 },
      { "$and": [{ "company.characterCount": 2 }, { "count.hobbit": 1 }] }
    ]
  }
}
```

- `condition` (required) — evaluated against the same
  {@link CompanyCharacterCount}-shaped context `discard-self-when-company`
  uses (`company.characterCount` plus one `count.<as>` headcount per declared
  `counts` filter), built by `buildCompanyCompositionContext`
  (`company-composition.ts`, exported for reuse here).
- `counts` (optional) — named per-character filtered headcounts published to
  `condition` as `count.<as>`.

Behaviour: at the end of a company's movement/hazard phase,
`advanceAfterCompanyMH` (`mh-hazard-play.ts`) calls `findAllyTapExtraMHPhase`,
which walks the company's characters' `allies` for an untapped card carrying
this effect whose `condition` currently holds; a match routes to the dedicated
`ally-tap-mh-offer` step instead of falling through to `finalizeCompanyMH`.
`allyTapExtraMHOfferActions` (`legal-actions/movement-hazard.ts`) re-derives
the same match and offers one `ally-tap-extra-mh-phase` action per qualifying
ally, plus `pass`. Accepting (`handleAllyTapExtraMHOffer`) taps the ally
(`updateAttachment`) and — unlike `grant-extra-mh-phase`, which sets a flag —
simply switches the step straight to the shared `extra-mh-move-offer`, so the
destination choice and the fresh `reveal-new-site` re-entry reuse that
machinery unchanged. Passing finalizes the company without tapping the ally.

### 52b-iv. `character-tap-extra-mh-phase`

Character-carried counterpart to `ally-tap-extra-mh-phase`: the bearer is a
character in the company itself (not an attached ally), and there is no
company-composition condition — any company containing an untapped bearer
qualifies. Used by Carambor (le-5): "May tap at the end of his company's
movement/hazard phase to allow it to move to an additional site on the same
turn. Another site card may be played and another movement/hazard phase
immediately follows for his company. The new site path must contain at least
one Wilderness [{w}]."

```json
{
  "type": "character-tap-extra-mh-phase",
  "requiresDestinationSitePathIncludes": ["wilderness"]
}
```

- `requiresDestinationSitePathIncludes` (optional) — restricts the extra
  move's destination to a site whose static `sitePath` (region types) includes
  at least one of the listed {@link RegionType}s.

Behaviour: at the end of a company's movement/hazard phase,
`advanceAfterCompanyMH` (`mh-hazard-play.ts`) calls
`findCharacterTapExtraMHPhase`, which walks the company's characters for an
untapped one carrying this effect; a match routes to the dedicated
`character-tap-mh-offer` step instead of falling through to
`finalizeCompanyMH`. `characterTapExtraMHOfferActions`
(`legal-actions/movement-hazard.ts`) re-derives the same match and offers one
`character-tap-extra-mh-phase` action per qualifying character, plus `pass`.
Accepting (`handleCharacterTapExtraMHOffer`) taps the character
(`updateCharacter`) and switches the step to the shared `extra-mh-move-offer`,
threading `requiresDestinationSitePathIncludes` (if any) onto the phase
state's `extraMHMoveRequiresSitePathIncludes` so `extraMHMoveDestinations`
(shared with `grant-extra-mh-phase`/`ally-tap-extra-mh-phase`) filters the
offered destinations down to sites whose `sitePath` includes a matching region
type; the field is cleared on either exit from `extra-mh-move-offer`. Passing
finalizes the company without tapping the character.

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

`play-flag: untapped-site-required` and `play-flag: tap-site-on-play` were
originally checked only for permanent-event resolution. Both are now also
honoured for **short events** playable during the site phase: the gate lives
in `playResourceShortEventActions` (`legal-actions/organization.ts`), and the
tap is applied via the shared `applyTapSiteOnPlayFlag` (`reducer-utils.ts`),
called from both `resolvePermanentEvent` (`chain-reducer.ts`) and
`handlePlayResourceShortEvent` (`reducer-events.ts`). Used by Far-sight
(tw-238): "Playable ... on an untapped sage at an untapped site ... Tap the
sage and the site."

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
- `company.alignment` — the owning player's alignment (`"wizard"`,
  `"ringwraith"`, `"fallen-wizard"`, `"balrog"`), for rules that name one side's
  companies.
- `company.covert` — MELE covert/overt status (`isCovertCompany`); an **overt**
  company is `false`.
- `company.regionNames` — the names of the regions the company is moving through
  this phase (the M/H state's `resolvedSitePathNames`; empty for a stationary
  company), for rules that name the regions they cover. Match with `$includes`
  (or a bare string, which the matcher also treats as array membership).

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
`when`. And by Gandalf the White Rider (as-11): "the hazard limit against all
overt minion companies is increased by one" —

```json
{
  "type": "hazard-limit-environment",
  "value": 1,
  "appliesTo": "all",
  "when": { "company.alignment": "ringwraith", "company.covert": false }
}
```

And by Radagast the Tamer (as-18): "all companies moving in Southern Mirkwood,
Western Mirkwood, Woodland Realm, and/or Heart of Mirkwood have their hazard
limit increased by one" — the default `appliesTo: "moving"` supplies "moving",
and the named regions are matched against `company.regionNames`:

```json
{
  "type": "hazard-limit-environment",
  "value": 1,
  "when": {
    "$or": [
      { "company.regionNames": { "$includes": "Southern Mirkwood" } },
      { "company.regionNames": { "$includes": "Western Mirkwood" } },
      { "company.regionNames": { "$includes": "Woodland Realm" } },
      { "company.regionNames": { "$includes": "Heart of Mirkwood" } }
    ]
  }
}
```

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
  `company.characterNames`, `company.maxUntappedWarriorProwess`,
  `company.covert` (`isCovertCompany` — `true` covert, `false` overt), …). When
  it matches, the return is **skipped** and the card resolves with no effect.

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

**Optional `unless` and `escape`.** Two optional fields extend the effect for
cards whose restriction has exceptions:

- `unless` — a `Condition` evaluated against the same `company.*` context
  {@link buildTargetCompanyConditionContext} builds for `company-return-to-origin`
  (`company.homeSites`, `company.characterNames`, `company.maxUntappedWarriorProwess`,
  `company.containsWizard`, `company.alignment`). When it matches, the restriction
  is skipped entirely — no constraint is installed at all.
- `escape` — a `GrantedActionConstraintPayload` (`action`, optional `phase`/`window`,
  `cost`, optional `when`, `apply`). When present, a companion `granted-action`
  constraint is installed alongside `site-phase-do-nothing`, sourced from the same
  card instance — the same two-constraint pattern River (tw-84/le-95) uses for its
  ranger-tap escape (`remove-constraint` with `select: "constraint-source"` clears
  both together). Unlike River's `on-event`-triggered pair, this pair installs
  directly on the short event's own chain resolution.

Used by **Fifteen Birds in Five Firtrees (dm-129)**: "The company can do nothing
during its site phase unless it contains a Wizard or you discard Eagle-mounts from
your hand."

```json
{
  "type": "company-site-phase-do-nothing",
  "unless": { "company.containsWizard": true },
  "escape": {
    "action": "discard-eagle-mounts-for-site-phase",
    "cost": { "discard": "named-card", "discardCardName": "Eagle-mounts" },
    "apply": { "type": "remove-constraint", "select": "constraint-source" }
  }
}
```

The `discard: "named-card"` cost (a new `ActionCost.discard` variant, alongside
`"discardCardName"`) discards a card matching that name from the acting player's
hand — no character actor is tapped or otherwise required, unlike every other
`ActionCost` variant. Because `canPayCost` only gates on tap status, both
granted-action legal-action paths (`granted-action-constraints.ts`'s
window-specific emitter and `legal-actions/pending.ts`'s generic constraint
pass-through) additionally check hand presence for this cost variant before
offering the action at all.

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

The same "Alternatively" shape also composes with an ordinary `play-target:
"character"` main mode (instead of `tap-character`) — e.g. a `character-stat-
modifier` penalty rather than a tap. The short-event character-targeting branch
(`legal-actions/movement-hazard.ts`, "Character-targeting short events") offers
the arrival-override modes' single untargeted action alongside its per-character
actions whenever the card also carries `on-event company-arrives-at-site`
effects, using the same eligibility check as the `tap-character` branch above.
`applyShortEventArrivalTrigger`'s mutual-exclusion guard checks for either
`tap-character` **or** a `play-target` `target: "character"` effect, so a chosen
`targetCharacterId` suppresses the arrival-override modes regardless of which
shape the main mode takes. The character-targeting filter context also exposes
`company.moving` (`!!targetCompany.destinationSite`), mirroring the `target.moving`
field already exposed to `play-target: "company"` filters (Heedless Revelry
le-114). Used by Gloom (tw-41): "Playable only on a company that is moving this
turn. One character (attacker's choice) in that company suffers -1 to his
prowess until the end of the turn. Alternatively, if Doors of Night is in play,
treat one Border-land as a Wilderness or one Border-hold as a Ruins & Lairs
until the end of the turn." — `play-target` character (`filter: { "company.moving":
true }`), `on-event self-enters-play` → `character-stat-modifier` (prowess -1,
scope turn), and the two `on-event company-arrives-at-site` → `region-type-
override` (border→wilderness) / `site-type-override` (border-hold→ruins-and-
lairs) modes.

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

### 56f. `site-type-remap` (class-wide site retype)

The site-type sibling of `region-type-remap` (§43): **every site whose printed
site type is `from` counts as a `to`**, everywhere the engine asks for a site's
effective type — hazard keying, item / ally / faction playability, haven tests,
movement.

```json
{ "type": "site-type-remap", "from": "shadow-hold", "to": "dark-hold",
  "duration": "long-event" }
```

| Field | Required | Description |
|-------|----------|-------------|
| `from` | yes | The printed `SiteType` being reinterpreted. |
| `to` | yes | The `SiteType` every such site is treated as. |
| `duration` | no | `"long-event"` — lives as long as a hazard long-event owned by the declarer would ([2.III.3]); `"turn"` (default) — swept at end of turn. |

Unlike the bound `site-type-override` add-constraint (§ `add-constraint`; Hold
Rebuilt and Repaired as-88, Nature's Revenge wh-27), which retypes *one* site —
the one the card was played on, or every printing of it — this remap is bound to
no site at all. It installs a single `site.type` `override`
`attribute-modifier` whose filter is `{ "site.printedType": <from> }`, the third
filter shape understood by `siteConstraintFilterMatches` (`engine/effective.ts`)
alongside `site.definitionId` and `site.name`. It therefore needs neither an
active company nor a destination to resolve, and it survives the carrying card
leaving play. The MEAS §6(d) Under-deeps type-immutability short-circuit in
`getEffectiveSiteType` still wins: an Under-deeps Shadow-hold keeps its printed
type.

Resolved as a **top-level effect** when the carrying card resolves as a
short-event on the chain (`applySiteTypeRemap`, `chain-reducer.ts`) — which
includes the on-tap "becomes a short-event" conversion of a `creature-alt-event`
permanent-event (§56c). The constraint targets the *declaring* player (the
effect is global and must outlive any company).

**`duration: "long-event"`** maps to the `next-long-event-phase`
{@link ConstraintScope}, stamped with the declarer's id and `state.turnNumber`
at creation. The new `long-event-phase-end` sweep boundary — raised in
`handleLongEvent`'s pass branch, at the same moment [2.III.3] discards the
hazard player's long-event *cards* — drops it once it sees that player as the
hazard player on a strictly later turn. That is exactly one turn cycle: the
declarer's own next turn does not expire it (he is the resource player then),
his opponent's next turn does.

Used by Witch-king of Angmar (tw-113): "When tapped, Witch-king of Angmar
becomes a long-event and causes all Shadow-holds [{S}] to become Dark-holds
[{D}]. When resolved, the long-event effect will remain and this card is
discarded." The card goes to the discard pile the instant its entry resolves
(CRF 22: "he is discarded when the effect resolves just like other Nazgûl. The
long-event effect will remain until the appropriate time"), so there is no card
in play for the ordinary [2.III.3] card sweep to remove — the constraint carries
the whole duration on its own.

### 56g. `force-discard-target-item`

When this short-event resolves — including a dual-mode creature's
tap-to-short-event conversion (§56c) — the **target character's controller**
must give up one item borne by that character. The card-player names the
victim; the victim's own controller picks which item. Used by Indûr Dawndeath
(tw-46)'s on-tap conversion: "makes any wounded character discard an item of
his choice (but not a ring)."

```json
{
  "type": "force-discard-target-item",
  "targetFilter": { "target.status": "inverted" },
  "itemFilter": { "$not": { "keywords": { "$includes": "ring" } } }
}
```

- `targetFilter` (optional) — condition narrowing which characters may be
  named. Evaluated against the shared play-option context
  (`buildPlayOptionContext`), so it reads state as well as printed data:
  `{ "target.status": "inverted" }` is "a wounded character".
- `itemFilter` (optional) — condition every candidate item's card definition
  must match. `{ "$not": { "keywords": { "$includes": "ring" } } }` is "but
  not a ring" (every ring item in the pool carries the `ring` keyword,
  whether it is a `gold-ring` or a tested `special` ring).

Target selection happens at declaration time. The legal-action emitter
(`tapAltPermanentEventActions`, `legal-actions/movement-hazard.ts`) offers one
`tap-alt-permanent-event` action per **opponent** character (CoE 2.1.2 — as a
hazard it never aims at the card-player's own characters) that both matches
`targetFilter` and bears at least one item passing `itemFilter`; with no such
character the tap is emitted as not viable rather than as a play without
effect (CoE 9.6). The chosen `targetCharacterId` rides on the chain entry
payload.

Resolution (`applyForceDiscardTargetItem`, `chain-reducer.ts`) enqueues the
shared `discard-one-company-item` pending resolution for the victim's
controller, narrowed by two optional fields on that pending kind:

- **`characterId`** — only the named character's items are offered (absent for
  Brigands tw-17, whose text covers the whole company).
- **`itemFilter`** — copied from the effect, re-checked both when emitting the
  choices and when applying the chosen `discard-item-from-company` action, so a
  forged action naming a ring (or another character's item) is rejected.

Routing through that resolution also inherits the Leaf Brooch (dm-171)
`discard-substitute` interposition for free.

### 56h. `attack-race-boost`

When this short-event resolves — including a dual-mode creature's
tap-to-short-event conversion (§56c) — **every attack made by a creature of
one of the named races** gains the given prowess/strike bonus for the rest of
the turn. Unlike `modify-attack`, which raises one named attack, this is an
untargeted standing buff: no attack need exist when the card resolves. Used by
Dwar of Waw (tw-31)'s on-tap conversion: "gives +1 prowess to all Wolf,
Spider, and Animal attacks until the end of the turn."

```json
{
  "type": "attack-race-boost",
  "races": ["wolf", "spider", "animal"],
  "prowess": 1,
  "strikes": 0
}
```

- `races` — creature races whose attacks receive the boost. Matched against
  the attack's normalised race, so printed plurals on site automatic-attacks
  ("Wolves", "Spiders", "Animals") count too.
- `prowess` (optional, default 0) — prowess added to every matching attack.
- `strikes` (optional, default 0) — strikes added to every matching attack.

Resolution (`applyAttackRaceBoost`, `chain-reducer.ts`) installs a
turn-scoped **`creature-attack-boost`** active constraint — the same kind
Chill Douser (dm-106) places when its attack survives — carrying the race list
and the bonuses. Two small generalisations of that kind make it fit:

- its `race` field now accepts a **list** of races as well as a single one; and
- the constraint may target a **player** as well as a company. A player target
  reaches every company that player controls, which is what "all X attacks"
  means; a company target keeps Chill Douser's narrower "against the company".

The target is the **opponent of the declaring player** — the side whose
companies face hazards this turn. `collectCreatureAttackBoostEffects`
(`effects/resolver.ts`) resolves either target shape when computing attack
prowess/strikes, so the boost lands on hazard-creature attacks and site
automatic-attacks alike, and the `turn` scope sweeps it at end of turn.

**Race-agnostic, self-targeted use via `on-event: self-enters-play` →
`add-constraint`.** A plain resource short event with no combat/move/draw
shape resolves inline (`handlePlayResourceShortEvent`, not the chain), so
`attack-race-boost` itself (a chain-only primitive) doesn't reach it. Its
underlying `creature-attack-boost` constraint kind is reachable from that
inline path too, via the generic `add-constraint` `on-event` case already
used for `character-stat-modifier`/`hazard-limit-modifier`/etc. (§ "add-constraint"
above): set `constraint: "creature-attack-boost"`, `scope: "turn"`, and
`prowess`/`strikes` on the apply, and **omit `race`** — the constraint-kind
builder (`reducer-events.ts`) passes the apply's `race` through only when
present, and `collectCreatureAttackBoostEffects` treats an absent `race` as
"matches every attack" rather than filtering by one. The company is resolved
from the card's own `play-target`-chosen character exactly as every other
character-targeted `add-constraint` apply (§ "add-constraint": "resolve the
target company from ... the scout/character instance"). Used by Wizard's
Flame (tw-361): "Spell. Wizard only. All attacks against Wizard's company
suffer a -2 modification to prowess for the rest of the turn. Wizard makes a
corruption check modified by -3." — `play-target` (`target: "character"`,
`filter: { "target.race": "wizard" }`), `on-event: self-enters-play` →
`add-constraint` (`constraint: "creature-attack-boost"`, `scope: "turn"`,
`prowess: -2`), and a second `on-event: self-enters-play` →
`enqueue-corruption-check` (`modifier: -3`).

### 56i. `target-character-stat-modifier`

When this short-event resolves — including a dual-mode creature's
tap-to-short-event conversion (§56c) — the **one character named when the card
was played or tapped** has the given stat modified for the rest of the turn.
Used by Akhôrahil (tw-4)'s on-tap conversion: "modifies any one character's body
by -1 for the rest of this turn."

```json
{ "type": "target-character-stat-modifier", "stat": "body", "value": -1 }
```

- `stat` — `"prowess"`, `"body"`, or `"direct-influence"`.
- `value` — signed modifier (negative to reduce).
- `targetFilter` *(optional)* — condition on a candidate target character,
  evaluated against the shared play-option context exactly as
  `force-discard-target-item`'s `targetFilter` (§56g). Omit for "any one
  character".

The target is chosen when the permanent-event is tapped: the emitter
(`tapAltPermanentEventActions`, `legal-actions/movement-hazard.ts`) offers one
`tap-alt-permanent-event` action per character of the **resource (active)
player** passing `targetFilter` — a hazard never aims at its own side (CoE
2.1.2) — and surfaces a non-viable action when nothing qualifies. Resolution
(`applyTargetCharacterStatModifier`, `chain-reducer.ts`) installs a turn-scoped
**`character-stat-modifier`** constraint (§6a) bound to that instance, so the
modifier flows through `collectCharacterStatModifierEffects` into the
character's `effectiveStats` and is swept at end of turn.

This differs from the `on-event: self-enters-play → add-constraint` shape
(Glance of Arien ba-19) only in *when* it fires: it resolves on the
**short-event** chain path alone, so a dual-mode creature sitting in play as a
permanent-event grants nothing until it is tapped.

A character's body check reads `effectiveStats.body` (`handleBodyCheckRoll`,
`combat-actions.ts`), not the printed value, so the modifier is what a wounded
character actually checks against. Allies bear no items and carry no
`effectiveStats`, so they keep their printed/override body.

### 56j. `multi-faction-check`

When this hazard short-event resolves, **every faction in play — both
players' — is rolled for and discarded on a bad result**. Unlike the
single-target `play-target: "faction"` + `dice-check` shape (Muster Disperses
le-126/tw-67, § `play-target`), this effect carries no `play-target` at all —
the card's own text names the scope ("each player" / "each faction he has in
play"), so it is offered as a single untargeted `play-hazard` action (the
existing no-`play-target` fallback in `legal-actions/movement-hazard.ts`).
Used by News of Doom (le-127): "Each player makes a roll for each faction he
has in play. Discard any faction if its result is 2 or 3, or if its result
plus that player's unused general influence is less than 10. Remove News of
Doom from the game."

```json
{ "type": "multi-faction-check", "threshold": 10, "comparison": "gte",
  "alwaysFailRolls": [2, 3] }
```

- `threshold` / `comparison` — the modified total (roll + unused GI) must
  reach this threshold (`"gt"` or `"gte"`) to survive, exactly like the
  generic `dice-check` fields they feed.
- `alwaysFailRolls` *(optional)* — raw (pre-modifier) 2d6 values that always
  fail the check regardless of the modified total. Needed because "result is
  2 or 3" reads the unmodified roll, which cannot be folded into
  `threshold`/`comparison` (those compare the modified total).

Resolution (the `multi-faction-check` block in `chain-reducer.ts`, alongside
the Muster Disperses faction-targeting block) scans both players'
`cardsInPlay` for `isFactionCard` entries and enqueues one generic
`dice-check` {@link PendingResolution} per faction found: `roller`/`actor` =
that faction's own owner, `modifiers: [{ kind: "unused-gi", player: owner }]`,
`onFail` a `move` discarding the faction to its own owner's discard pile
(`toOwner: "source-owner"`, resolved from the located `in-play` source card —
not the declaring player, so factions on both sides route correctly even
though one player played the card). Every enqueued check shares
`continuation: { kind: "chain-entry", match: "source", drainSameSource: true
}`, so the chain entry stays unresolved until every faction's roll is in —
the same `force-check-all-company` (§ above) "all company members" pattern,
generalized across both players' `cardsInPlay` instead of one company's
characters. The new `alwaysFailRolls` field lives on the `dice-check` pending
kind itself (`types/pending.ts`) and is consulted in
`applyDiceCheckResolution` (`pending-reducers.ts`): `rawFail =
alwaysFailRolls?.includes(rawRoll)`, and `passed = !rawFail && (normal
comparison)`.

A card combining `multi-faction-check` with `play-flag: "remove-from-game"`
(§ `play-flag`) must perform the removal **inline**, inside the
`multi-faction-check` block, before it returns `needsInput: true` — the
generic remove-from-game block runs later in `resolveEntry`, and once the
drained multi-resolution entry is marked resolved via
`resolveChainEntryAndContinue` rather than a fresh call into `resolveEntry`,
nothing after the pausing point ever runs for it again.

### 56k. `creature-alt-event` — `when` gate + `attacksAsCreature` (Shelob tw-86)

Two more fields extend the `creature-alt-event` primitive (§56a/§56c) for
Shelob (tw-86): "If Doors of Night is in play, Shelob may be played as a
permanent-event that gives +1 prowess and +1 strikes to all Spider and Animal
attacks. She may opt to attack from a permanent-event state and receive these
bonuses, but her attack counts as one against the hazard limit. Discard when
Shelob attacks or if Doors of Night is not in play."

```json
{ "type": "creature-alt-event", "mode": "permanent-event",
  "when": { "inPlay": "Doors of Night" }, "attacksAsCreature": true }
```

- **`when`** *(optional Condition)* gates the permanent-event mode's
  *availability* — not its ongoing behaviour — on a condition evaluated
  against `{ inPlay: <game-wide in-play card names> }` (`buildInPlayNames`),
  the same context shape the `keyedTo[].when` gate uses. When absent, the
  event mode is always offered, as for every other dual-mode card. The
  creature mode's own playability (keying to Imlad Morgul / Gorgoroth via a
  plain `regionNames` `keyedTo` entry) carries no such gate — only the
  alternate permanent-event mode requires Doors of Night. Checked in the
  `creature-alt-event` offering block of `legal-actions/movement-hazard.ts`,
  alongside the existing `targetCompany` / `requiresMovingCompany` checks.

- **`attacksAsCreature`** *(optional `true`, permanent-event mode only)*
  marks the in-play permanent-event as convertible into a **full creature
  attack** — using the card's own printed stats plus whatever global effects
  are active at resolution — instead of the §56c short-event conversion.
  Offered as a new `attack-alt-permanent-event` action
  (`attackFromAltPermanentEventActions`, `legal-actions/movement-hazard.ts`)
  rather than `tap-alt-permanent-event` (excluded for such a card, mirroring
  how a `modify-attack fromAltPermanentEvent` card is excluded). Like a normal
  creature play, it must initiate a new chain (not offered in response to
  one) and needs no creature keying.

  The reducer (`handleAttackFromAltPermanentEvent`, `mh-hazard-play.ts`)
  charges one hazard-limit slot (unless `no-hazard-limit`) and pushes a plain
  `{ type: "creature" }` chain entry sourced from the card **still sitting in
  `cardsInPlay`** — unlike every other creature/short-event/permanent-event
  play, the card is deliberately *not* removed from its current location
  first. This matters because Shelob's own passive `stat-modifier` (+1
  prowess/+1 strikes to `target: "all-attacks"` when `enemy.race` is Spider or
  Animal) is itself sourced from this same card in `cardsInPlay`: if the card
  were pulled out before the chain resolves into combat, `resolveAttackProwess`
  /`resolveAttackStrikes` (`effects/resolver.ts`) would no longer see it when
  computing her own attack's stats, and "she may opt to attack … and receive
  these bonuses" would silently fail to apply to her own attack. Because nothing
  removes the card up front, `initiateCreatureCombat` (`chain-reducer.ts`) must
  check whether the creature is already present in the hazard player's
  `cardsInPlay` before appending it (normal creature plays never are) — the
  attacking-from-permanent-event path is otherwise indistinguishable from a
  played-from-hand creature attack. `finalizeCombat`'s existing creature
  disposal (discard, or the defender's kill pile if defeated) then removes the
  card once the attack resolves, matching "discard when Shelob attacks";
  "discard … if Doors of Night is not in play" is the ordinary
  `discard-self-when` primitive (§62), condition
  `{ "$not": { "inPlayAnywhere": "Doors of Night" } }` (The Will of Sauron
  tw-100 precedent).

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

`source: "cards-in-play"` instead sources the candidate from the playing
player's own `cardsInPlay` — for an **untargeted long/permanent hazard event**
whose text both requires and spends an existing in-play card. The legal-action
layer (`playHazardsActions` in `legal-actions/movement-hazard.ts`) offers one
action per own `cardsInPlay` entry matching `filter`; zero candidates makes the
card unplayable outright, which doubles as a "playable only if you have … in
play" gate with no separate `play-condition` needed. The reducer
(`mh-hazard-play.ts`) pays the cost at declaration — before the card is pushed
onto the chain, mirroring the hand-sourced cost's timing — removing the chosen
card from `cardsInPlay` and appending it to its owner's discard pile.

| Field | Required | Description |
|-------|----------|-------------|
| `source` | yes | Pile the cost card is discarded from: `"hand"` or `"cards-in-play"`. |
| `filter` | yes | DSL condition matched against candidate card definitions in the source. |
| `revealToOpponent` | no | When `true`, the discarded card's identity is revealed to the opponent. |

```json
{ "type": "play-discard-cost",
  "source": "hand",
  "filter": { "cardType": "hazard-creature", "race": "undead" },
  "revealToOpponent": true }
```

Used by Scimitars of Steel (dm-86): "Playable only if you have a Nazgûl
permanent-event in play. Discard the Nazgûl when this card is brought into
play. All Orc, Troll, and Men attacks receive +1 prowess."

```json
{ "type": "play-discard-cost",
  "source": "cards-in-play",
  "filter": { "keywords": { "$includes": "Nazgûl" } } }
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

`inPlay` / `inPlayAnywhere` list `cardsInPlay` only and never see **characters**,
so a rule about a *person* arriving reads `charactersInPlayAnywhere` — the names
of every character either player has in play (`charactersInPlayNames` in
`manifestations.ts`). Matched by name, so every printing counts (Gandalf is the
hero Wizard tw-156 and the Fallen-wizard wh-4). Gandalf the White Rider (as-11),
"Discard this card if Gandalf comes into play":

```json
{ "type": "discard-self-when",
  "condition": { "charactersInPlayAnywhere": "Gandalf" } }
```

A `discard-self-when` on a **manifestation** sister also satisfies glossary
g.man.1's "unless the current manifestation would leave play when the new
manifestation is played" clause: `blockingManifestationForCharacterPlay`
(`manifestations.ts`) re-evaluates each in-play sister's condition against a
hypothetical `charactersInPlayAnywhere` that already includes the character
being played, and a sister that would yield stops blocking. So the in-play White
Rider never bars playing Gandalf — the post-action sweep discards it instead.

### 62a. `return-self-to-hand-when`

The return-to-hand sibling of `discard-self-when` (§62): same player-state
context, same `postReduce` sweep slot (`sweepReturnSelfToHandWhen` in
`return-self-when.ts`), but the card goes back to its controller's **hand**
instead of the discard pile. They are separate effects rather than one with a
destination flag, because a card carrying both would be ambiguous about where
it ends up.

| Field | Required | Description |
|-------|----------|-------------|
| `condition` | yes | DSL condition (against the player-state context) that forces the return. |

Unlike the discard sweep, this one also reaches a card held as an **ally
attached to a character**, which is where the manifestation cards that need it
live. Last Child of Ungoliant (le-153), "Return her to your hand if Shelob is
played":

```json
{ "type": "return-self-to-hand-when",
  "condition": { "inPlayAnywhere": "Shelob" } }
```

Last Child is a manifestation of Shelob (`manifestId: "tw-86"`), so g.man.1 has
the two competing for one slot; the card's own text settles it in the ally's
favour. `inPlayAnywhere` sees Shelob in her **permanent-event** mode (the
`creature-alt-event` play, which puts tw-86 into `cardsInPlay`). A Shelob played
as a *hazard creature* is an attack rather than a card on the table, so it does
not trigger the return.

### 62b. Company-composition primitives (`company-size-unlimited`, `company-influence-exempt`, `company-character-play-exempt`, `discard-self-when-company`)

Four effects for a permanent-event bound to a **company as a whole** (a
`play-target` `target: "company"` card, stored as `CardInPlay.companyId`) whose
rules read the bound company's roster. They live in
`engine/company-composition.ts`.

Three of them match a card-authored `filter` against a **per-character
context**, so the class of characters a card cares about stays in card data:

| Path | Description |
|------|-------------|
| `character.name` | Card name. |
| `character.race` | Race (`"dwarf"`, `"hobbit"`, `"wizard"`, …). |
| `character.mind` | Effective mind (printed mind when unmodified). **Absent** for avatars (printed mind `null`), so `{ "$gt": n }` never matches one. |
| `character.unique` | Uniqueness flag. |
| `character.isAvatar` | True for a printed-mind-`null` character. |
| `character.keywords` | Keyword list (use `$includes`). |

**`company-size-unlimited`** — the bound company ignores the CoE 2.II.3.1
maximum of seven effective characters outside a haven. Read in
`organization-companies.ts` by `moveToCompanyActions` and
`mergeCompaniesActions`; in a merge only the **target** company's marker counts,
because the target is the company that survives. Contrast `extra-leader-slot`,
which merely exempts one Leader from the same headcount. No fields.

```json
{ "type": "company-size-unlimited" }
```

**`company-influence-exempt`** — characters in the bound company matching
`filter` cost no influence to control. Two call sites: `recompute-derived.ts`
stops subtracting their mind from the general-influence pool, and
`organization-characters.ts` offers them under general influence at cost 0 at a
site where such a company stands (the direct-influence branch is untouched — a
character that "does not require influence" is held under general influence, not
as a discounted follower).

```json
{ "type": "company-influence-exempt",
  "filter": { "$and": [{ "character.race": "dwarf" },
                       { "character.mind": { "$lte": 2 } }] } }
```

**`company-character-play-exempt`** — characters matching `filter` may join the
bound company regardless of the one-character-per-turn limit of CoE 2.II.2.1,
*and* doing so does not consume that turn's single slot (the gate in
`organization-characters.ts`, the bookkeeping in `reducer-organization.ts`
`handlePlayCharacter`). The exemption is per company: at a site whose company
does not carry the card the limit still bites.

```json
{ "type": "company-character-play-exempt",
  "filter": { "character.race": "dwarf" } }
```

**`discard-self-when-company`** — the company-scoped sibling of
`discard-self-when` (§62): the card is discarded the moment a condition over the
bound company's composition holds. Swept in `postReduce`
(`sweepDiscardSelfWhenCompany`), so every roster change — character play, split,
merge, elimination, being influenced away — is covered by one chokepoint;
skipped during setup.

| Field | Required | Description |
|-------|----------|-------------|
| `counts` | no | Named filtered headcounts, each `{ "as": <name>, "filter": <condition> }`, published to the condition as `count.<name>`. |
| `condition` | yes | DSL condition that forces the discard. Sees `company.characterCount`, `company.atHaven`, `company.siteType` and every `count.<name>`. |

The `counts` mechanism is what keeps "more than two non-Dwarf characters"-style
clauses in card data rather than in engine branches.

```json
{ "type": "discard-self-when-company",
  "counts": [
    { "as": "nonDwarves", "filter": { "character.race": { "$ne": "dwarf" } } },
    { "as": "bigDwarves",
      "filter": { "$and": [{ "character.race": "dwarf" },
                           { "character.mind": { "$gt": 5 } }] } }
  ],
  "condition": { "$or": [{ "count.nonDwarves": { "$gt": 2 } },
                         { "count.bigDwarves": { "$lt": 1 } }] } }
```

All four are used together by *An Unexpected Party* (dm-114), whose text is
nothing but company-composition clauses. Its "Only playable during the
organization phase" sentence is a plain `play-condition` `requires: "phase"`
with `phases: ["organization"]`, and "Cannot be duplicated on a given company" a
`duplication-limit` of scope `"company"`.

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

Playability during the site phase rides the existing site-phase permanent-event
path (`legal-actions/site.ts`): `play-target character` (sage skill + untapped
status), `play-target site` (siteType Border-hold/Free-hold), and
`play-flag: tapped-site-only`. Unlike its site-tapping siblings (Rescue
Prisoners tw-315, Andúril tw-192, Reforging tw-314, …), whose card text prints
"during the site phase", Fireworks' text declares no such restriction — under
rule 2.1.1 it remains playable during any phase as long as the sage is still
untapped and the site still tapped from an earlier site phase. This any-phase
case is evaluated directly in `legal-actions/organization-events.ts`
(`playPermanentEventActions`'s `roll-untap-site`-gated branch), mirroring how
The White Tree (tw-348) and Return of the King (tw-316) are handled there.

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

---

### 70. `discard-substitute` (Leaf Brooch)

A replacement effect on an item: when another card **in the bearer's company**
is required to be discarded by a hazard or resource effect, the owner may
discard *this* card instead, and the protected card stays in play.

| Field | Required | Description |
|-------|----------|-------------|
| `scope` | yes | Where the replaced card must sit. Only `"company"` (any character of the bearer's own company) is supported. |
| `filter` | no | Card-definition condition the replaced card must match, evaluated with `matchesDefinition` (e.g. `{ "subtype": { "$ne": "special" } }`). Omit to substitute for any card. |

```json
{ "type": "discard-substitute", "scope": "company", "filter": { "subtype": { "$ne": "special" } } }
```

Implemented in `engine/discard-substitute.ts`. Every forced-discard site calls
`enqueueDiscardSubstituteOffer` **instead of** moving the doomed cards: it
returns a state carrying a `discard-substitute-offer` pending resolution when a
covering substitute is in the company, or `null` ("no substitute — discard them
yourself"). The resolution owns the discard either way, so no call site needs
its own "did the brooch save this one?" branch.

The owner answers with `use-discard-substitute`: with an `itemInstanceId` to
name one doomed card to save (the substitute is discarded in its place), or
with the field omitted to decline (every remaining doomed card is discarded).
When a second substitute is still borne and doomed cards remain, the resolution
re-queues itself, so a company holding two copies saves two cards from one
requirement. Legal actions: `discardSubstituteOfferActions`
(`legal-actions/pending.ts`); reducer:
`applyDiscardSubstituteOfferResolution` (`pending-reducers.ts`).

Wired-in forced-discard paths:

- `discard-one-company-item` (`pending-reducers.ts`) — Brigands tw-17/le-64,
  Pirates le-88, and Scourge of Fire ba-75, where the *opponent* picks the item;
- `move { select: 'filter-all', from: 'items-on-wounded', to: 'discard' }`
  (`combat-finalize.ts` `discardWoundedItems`) — the Trolls tw-016 / tw-103 /
  tw-112, which strip every non-special item off a wounded character at once;
- the gold-ring test discard, Rule 9.21 (`applyGoldRingTestResolution`). The
  offer is queued *behind* the `ring-play-offer` so the owner decides knowing
  the test result, and the ring stays borne meanwhile — matching CRF 22's
  ruling that "the bearer of the gold ring item gets the special ring item, not
  the bearer of the Leaf Brooch". A ring stored at a Darkhaven (Rule 9.22) sits
  in the MP pile rather than in a company, so it cannot be saved.

A requirement phrased as "discard one item of the **defender's** choice" (the
combat `discard-item-from-company` sub-phase of An Article Missing dm-43) needs
no replacement machinery: the substitute is itself an item in the company, so
naming it already fulfils the requirement.

Used by: *Leaf Brooch* (dm-171).

### 71. `agent-tap-faction-influence` (Twisted Tales)

Hazard short-event that *grants* one of the hazard player's own agents a rule
10.14 influence attempt against an **opponent faction in play** that is playable
at the agent's current site. The agent needs no `agent-tap-influence` effect of
its own — rule 10.14 opens with "if an effect allows an agent hazard to make an
influence attempt", and this card is such an effect.

| Field | Required | Description |
|-------|----------|-------------|
| `agentFilter` | no | Condition the acting agent's definition must satisfy, evaluated against `{ target: { name, race, skills, keywords } }` (e.g. `{ "target.skills": { "$includes": "diplomat" } }`). Omit to allow any untapped agent. |
| `attemptBonus` | yes | Flat modifier added to the attacker's side of the influence attempt (rides as the attempt's `boostModifier`). |
| `autoSuccessAtHomeSite` | no | When true, the attempt succeeds without any roll if the target faction is playable at one of the agent's **home** sites. |

```json
{ "type": "agent-tap-faction-influence",
  "agentFilter": { "target.skills": { "$includes": "diplomat" } },
  "attemptBonus": 6, "autoSuccessAtHomeSite": true }
```

- **Legal actions** (short-event branch of `movementHazardActions`,
  `legal-actions/movement-hazard.ts`): one `play-hazard` action per (untapped
  agent passing `agentFilter`, opponent in-play faction whose `playableAt` names
  the agent's current site), carrying `agentInstanceId` +
  `targetFactionInstanceId`. Independent of the active company — a faction sits
  in `cardsInPlay`. Blocked when the opponent is a minion/Balrog player
  (`isMinionOrBalrog`), matching "Cannot be played if your opponent is a minion
  player". The agent's current site and the filter test use the shared
  `agentCurrentSiteName` / `agentMatchesFilter` helpers (`reducer-utils.ts`) so
  the emitter and the reducer agree on "the agent's site".
- **Reducer** (`handleAgentTapFactionInfluence`, `mh-agents.ts`, dispatched from
  `mh-hazard-play.ts`): taps **and reveals** the agent (declaring an influence
  attempt reveals it), discards the event, counts it against the hazard limit,
  and enqueues the standard `opponent-influence-defend` resolution. The attempt
  is not an agent action, so `remainingActions` is untouched. Rule-10.14 bonuses
  are applied as usual (+2 direct influence at a home site, plus the agent's own
  conditional DI modifiers; a faction playable at a home site counts as value 0
  with +2 to the roll), and `attemptBonus` is passed as `boostModifier`.
- **Automatic success**: with `autoSuccessAtHomeSite` and a faction playable at
  one of the agent's home sites the attempt is flagged `autoSuccess` — no
  attacker roll is made at declaration and `resolveOpponentInfluenceDefend`
  skips the defence roll and resolves as a success. The defender still gets the
  window to cancel the attempt outright (`cancel-influence`).
- **Defending side**: `resolveOpponentInfluenceDefend` reads the defending
  player from `attempt.targetPlayer` rather than from `state.activePlayer`, so
  an attempt declared by the (non-active) hazard player during the resource
  player's movement/hazard phase discards the *resource* player's faction. For a
  site-phase attempt the two derivations coincide.

Used by Twisted Tales (dm-96): "Playable on an untapped diplomat agent. Tap the
agent who may then make an influence attempt against a faction playable at the
agent's site. +6 to influence attempt. Attempt is automatically successful if
target faction is playable at the agent's home site. Cannot be played if your
opponent is a minion player."

---

### 72. `un-eliminate-creature` + instance-targeted untargeted `play-option` modes

Returned Beyond All Hope (as-35) is a hazard short-event with **three**
mutually-exclusive modes, none of which targets a character, each acting on one
card instance the player names when playing:

1. as a short-event, a hazard creature of race Maia / Elf / Dwarf / Dúnedain
   from the player's own **discard pile** → their hand;
2. as a short-event, a **Maia permanent-event in play** (a Maia hazard creature
   sitting in that player's `cardsInPlay` in its permanent-event mode) → their
   hand;
3. as a **permanent-event**, a roll: on "greater than 8" an *eliminated* Elf or
   Maia hazard creature returns to its owner's discard pile and this card is
   placed in the opponent's marshalling-point pile; otherwise the card is
   discarded.

Two generic additions to `play-option` cover the first two modes and the mode
selection; only the roll-and-recover verb is new.

#### `play-option` — `candidates` and `eventMode`

| Field | Required | Description |
|-------|----------|-------------|
| `candidates` | no | Pool the option's declared card instance is drawn from: `own-discard`, `own-in-play`, or `eliminated` (both players' `killPile` **and** `outOfPlayPile`). |
| `eventMode` | no | `short-event` \| `permanent-event` — the event mode this option is played as, when it differs from the card's printed `eventType`. |

An **untargeted** option carrying `candidates` is enumerated by the hazard
short-event emitter (`legal-actions/movement-hazard.ts`,
`untargetedOptionCandidates`): each instance in the pool is filtered by the
apply's own `filter` (the source card itself is always excluded — a hazard short
event already sits in its own discard pile at that point), and one `play-hazard`
action is emitted per (mode × candidate) carrying `optionId` +
`optionTargetInstanceId`. Targets are therefore declared at *play* time, so the
opponent's response window sees what is at stake. A mode with no candidate is
emitted non-viable with a reason; a card whose every mode is empty is simply not
playable. This branch runs only for a short event that carries **no**
`play-target`.

`eventMode: "permanent-event"` makes the emitter stamp `altEventMode` on the
action. `handlePlayHazardCard` (`mh-hazard-play.ts`) then routes a short-event
card down the permanent-event chain path: the card rides the chain instead of
being pre-discarded, and its option's apply decides where it lands.

Mode 1 and mode 2 apply a plain `move` (`select: 'target'`, `from: 'discard'` /
`'in-play'`, `to: 'hand'`); `chain-reducer.ts` feeds
`optionTargetInstanceId` to `applyMove` as `ctx.targetCardId`, so the card
returns to its owner's hand through the ordinary move primitive. "to your hand"
is read as the playing player's own cards, which is why the two pools are
`own-discard` / `own-in-play`.

#### `un-eliminate-creature`

| Field | Required | Description |
|-------|----------|-------------|
| `threshold` | yes | 2d6 total at or above which the recovery succeeds (`9` = "greater than 8"). |
| `filter` | yes | Card-definition condition every candidate creature must match. |
| `selfTo` | yes | Where the resolving card goes on success. Only `"opponent-mp-pile"` today. |

```json
{ "type": "play-option", "id": "un-eliminate-creature", "untargeted": true,
  "candidates": "eliminated", "eventMode": "permanent-event",
  "apply": { "type": "un-eliminate-creature", "threshold": 9,
             "selfTo": "opponent-mp-pile",
             "filter": { "$and": [ { "cardType": "hazard-creature" },
                                   { "race": { "$in": ["elf", "maia"] } } ] } } }
```

Resolved by `resolveUnEliminateCreature` (`chain-reducer.ts`), reached from the
permanent-event branch of `resolveEntry` — which, like dm-73's
`displace-stored-item`, skips `resolvePermanentEvent` entirely so the card never
enters `cardsInPlay`. It rolls 2d6 (honouring `cheatRollTotal`, emitting the
dice `GameEffect` through `ResolveResult.effects`) and then:

- **success** — the declared creature leaves the terminal pile holding it for
  its **owner's** discard pile (owner from the instance-id prefix, falling back
  to the opponent of the pile holder, since a creature only reaches another
  player's kill/out-of-play pile by attacking them), and the resolving card is
  placed into the opponent's marshalling-point pile, where an accompanying
  `mp-in-pile` effect scores it (as-35: 2 kill MP, its printed value);
- **failure**, or a declared creature that can no longer be located or no longer
  matches `filter` — the resolving card goes to its own player's discard pile.

Either way the card lands in exactly one pile: no instance is lost.

An *eliminated* creature is one in a terminal off-board pile — either player's
`outOfPlayPile` **or** `killPile`. Including the kill pile is deliberate: CRF 22
rules that this card "may target creatures still in play as trophies". Because
the recovered creature leaves the terminal piles, `isManifestationDefeated`
stops reporting its chain as defeated — which is the other CRF 22 ruling, that
the card "«un-eliminates» a hazard creature, allowing any manifestation of that
character to be played".

Used by: *Returned Beyond All Hope* (as-35).

### 73. `discard-bearer-corruption` + `company.siteCharacterNames`

`{ "type": "on-event", "event": "self-enters-play", "apply": { "type":
"discard-bearer-corruption" } }` — for a permanent-event played onto a
character (a `play-target: "character"` attachment), discards every attached
corruption card already on that bearer (its `hazards`) the moment this card
enters play. A "corruption card" is `cardType: "hazard-corruption"` **or** a
`hazard-event` carrying the `"corruption"` game keyword — the same CoE-7.2.1
test `movement-hazard.ts` (one corruption card per character per turn) and
`organization.ts` (no-tap removal roll) already use, since every printed
"Corruption." hazard in the data files today is modeled as the latter (no
card actually uses the `hazard-corruption` cardType yet). Scoped to the bearer
only — unlike `discard-named-in-play`, which scans the whole board by name,
this scans one character's `hazards`. Implemented by
`discardBearerCorruptionCards` (`chain-reducer.ts`), dispatched from the
`self-enters-play` apply loop in `resolvePermanentEvent` using the chain
entry's `targetCharacterId`. Each discarded instance is routed to its owner's
discard pile (owner from the instance-id prefix), so the no-card-disappears
invariant holds even for an opponent's corruption card attached to the
bearer.

```json
{ "type": "on-event", "event": "self-enters-play",
  "apply": { "type": "discard-bearer-corruption" } }
```

The site-phase `play-target: "character"` filter context (`site.ts`,
`playResourcesActions`) also gained a `company.siteCharacterNames` field: the
names of every character in one of the *player's* companies currently at the
same site as the candidate bearer's company (across companies, including the
candidate's own) — backing "playable on a … character … at the same site as
<Named Character>" gates with a plain `$includes` filter, the same way
`same-site-has-character-race` (organization-events.ts) backs the race-scoped
org-phase equivalent. Not computed for the organization-phase emitter (no card
needs it there yet).

```json
{ "type": "play-target", "target": "character",
  "filter": { "$and": [
    { "target.race": { "$ne": "wizard" } },
    { "target.race": { "$ne": "hobbit" } },
    { "target.skills": { "$includes": "diplomat" } },
    { "target.name": { "$ne": "Galadriel" } },
    { "company.siteCharacterNames": { "$includes": "Galadriel" } } ] } }
```

Used by *Three Golden Hairs* (td-157): "Unique. Playable at any site on a
non-Wizard, non-Hobbit diplomat character (other than Galadriel) at the same
site as Galadriel. All corruption cards on the bearer are discarded when this
card comes into play. +2 to all corruption checks by bearer." (the "+2 to all
corruption checks" is a bearer-scoped `check-modifier` — see section 2.)

### 74. `untap-mind-roll`

A game-wide untap-phase restriction carried by a hazard **long-event** while it
sits in either player's `cardsInPlay` (checked once per untap in
`performUntap`, `reducer-untap.ts`, not tied to whoever played the card).

```json
{ "type": "untap-mind-roll", "threshold": 12,
  "exemptSiteTypes": ["haven", "free-hold", "border-hold"],
  "noEffectOnMinion": true }
```

Every tapped character of the untapping (active) player is checked: a Wizard
(`race === "wizard"`) or a character whose company's current site resolves
(`getEffectiveSiteType`) to one of `exemptSiteTypes` untaps normally. Every
other tapped character stays tapped instead, and a generic `dice-check` is
enqueued in its place — 2d6 + the character's effective mind (`effectiveStats
.mind` ?? printed mind), strictly greater than `threshold` untaps him via the
`set-character-status` onPass verb. There is no `onFail` branch: rolling has no
downside, so the printed "the player may instead make a roll" is modeled as an
always-enqueued roll rather than an interactive decline — a rational player
never declines. The pending resolution outranks every other untap-phase action
(including the phase advancing straight to Organization when the hazard player
had already passed) until it resolves.

`noEffectOnMinion: true` skips the whole restriction for an untapping player
whose alignment is `ringwraith` — the same "minion player" reading the
`ahunt-attack`/`faction-influence-restriction` primitives use (Balrog is not
included).

Used by Worn and Famished (td-89): "Each non-Wizard character that is not in a
Haven [{H}], Free-hold [{F}], or Border-hold [{B}] does not untap normally
during his untap phase. Character's player may instead make a roll adding his
mind. If the result is greater than 12, he untaps. This card has no effect on
a minion player. Cannot be duplicated." — paired with the pre-existing
`play-restriction unplayable-when opponent.alignment: "ringwraith"` (the
tw-36/dm-72 "no effect on a minion player" precedent of also blocking play
against a Ringwraith opponent outright) and a `duplication-limit` scope `game`
max 1 for "Cannot be duplicated".

### 75. `targets.movingThroughRegionNames` + `bearer.homesiteRegions`

Two additions letting a **bearer-less in-play faction** (a card sitting bare in
`cardsInPlay`, not attached to any character) tap itself to grant a per-company
region-movement bonus keyed to *named* regions, and letting a faction's own
standard-modification `check-modifier` read the influencing character's home
region.

```json
{ "type": "grant-action",
  "action": "wild-horses-extra-region",
  "cost": { "tap": "self" },
  "targets": { "scope": "player-companies",
    "movingThroughRegionNames": ["Rohan", "Khand", "Dorwinion",
      "Horse Plains", "Southern Rhovanion", "Harondor"] },
  "apply": { "type": "increment-company-extra-region-distance", "amount": 1 } }
```

- **`targets.movingThroughRegionNames`** is the named-region sibling of
  `targets.movingThroughRegionType` (§22): it narrows a `player-companies`
  enumeration to companies that have declared movement whose destination
  site's own printed `region` (a specific name, not an abstract terrain type)
  is in the given list.
- The bearer-less in-play-faction grant-action path (`bareCardGrantActions`,
  previously discard-self / `add-constraint` only for A Panoply of Wings
  wh-37) now also accepts `cost.tap: "self"` and, with a `player-companies`
  `targets`, emits one activation per eligible company (`targetCompanyId`).
  `apply.type: "increment-company-extra-region-distance"` resolves its target
  company from `targetCompanyId` instead of a bearer's company (contrast
  Cram td-105, whose identical apply is bearer-borne).

```json
{ "type": "check-modifier", "check": "influence", "value": 3,
  "when": { "$and": [
    { "bearer.race": "man" },
    { "$or": [
      { "bearer.homesiteRegions": { "$includes": "Rohan" } },
      { "bearer.homesiteRegions": { "$includes": "Khand" } }
    ] } ] } }
```

- **`bearer.homesiteRegions`** is a resolver-context field populated only for
  the `faction-influence-check` reason, listing the named regions of the
  influencing character's home site(s) (via `characterHomeSiteRegions`, the
  region-name sibling of `characterHomeSiteTypes`). Lets a faction card gate
  its own standard modification on the influencer's home region rather than a
  fixed character name or `controller.wizard`.

Used by Wild Horses (wh-39): "Playable at any tapped or untapped non-Haven
site in Rohan, Khand, Dorwinion, Horse Plains, Southern Rhovanion, or Harondor
if the influence check is greater than 11. Standard Modifications: Men with
home sites in the regions listed above (+3). Tap this faction to allow any
company with one of the regions listed above in its site path to move up to 1
additional region."

### 76. `target.woundedByRaceThisTurn`, `on-event: card-discarded-from-hand`, `sage-in-company-excluding-bearer`

Three additions for hazard-events that attach to a character following a
wound and punish hand discards made by that character's own controller.

```json
{ "type": "play-target", "target": "character",
  "filter": { "$and": [
    { "target.race": { "$ne": "wizard" } },
    { "target.woundedByRaceThisTurn": { "$includes": "undead" } } ] } }
```

- **`target.woundedByRaceThisTurn`** is a character play-target filter
  context field (added to both `buildPlayOptionContext` in
  `legal-actions/organization.ts` and the bespoke hazard-menu character
  filter context in `legal-actions/movement-hazard.ts`) listing the races of
  every attack that has wounded the character so far this turn. Backed by
  `CharacterInPlay.woundedByRaceThisTurn`, appended to (deduplicated) in
  `combat-finalize.ts` whenever a strike wounds a character (from
  `combat.creatureRace`), and cleared for every character of every player at
  the start of each new turn in `enterUntapPhase` (`reducer-untap.ts`) —
  mirroring the existing `sideboardAccessedDuringUntap` per-turn reset.

```json
{ "type": "on-event", "event": "card-discarded-from-hand", "target": "bearer",
  "apply": { "type": "force-check", "check": "corruption" } }
```

- **`on-event: card-discarded-from-hand`** fires once per card a player
  discards from their own hand during their own turn (`state.activePlayer`
  at the moment of the discard), for every on-event effect of this name on a
  card attached to one of that player's characters. There is no single
  reducer call site for "a card left the hand" (end-of-turn hand-size
  reduction, named-card play costs, hazard-limit discards, …), so it is
  implemented as a prev/next diff in the new `hand-discard-trigger.ts`
  module (`applyHandDiscardCorruptionChecks`), hooked into `postReduce`
  alongside `applyDiscardOnCardLeaves`/`enqueuePostAttackPlayOffers`: a card
  counts as "discarded from hand" when its instance left `hand` and landed
  in `discardPile` within the same step (distinguishing a discard from the
  card being played, which leaves the hand for `cardsInPlay`/a
  character/etc., not the discard pile). Note CoE rule 2.09 (both play deck
  and discard pile empty ⇒ the discarded card becomes the new play deck) is
  therefore *not* currently detected as a discard by this trigger.

```json
{ "type": "grant-action", "action": "remove-self-on-roll",
  "cost": { "tap": "sage-in-company-excluding-bearer" },
  "apply": { "type": "roll-then-apply", "threshold": 7,
    "onSuccess": { "type": "move", "select": "self", "from": "self-location", "to": "discard" } } }
```

- **`cost.tap: "sage-in-company-excluding-bearer"`** is the `sage-in-company`
  sibling (§ various corruption-removal cards) that additionally excludes
  the bearer character itself from the eligible sages enumerated in
  `legal-actions/organization.ts`'s grant-action scan.

Used by Pale Dream-maker (dm-78): "Corruption. Dark Enchantment. Playable on
a non-Wizard character wounded by an Undead attack this turn; does not count
against the hazard limit. Target character receives 2 corruption points and
makes a corruption check each time his player discards a card from his hand
during his turn. His direct influence is zero while bearing this card.
Cannot be duplicated on a given character. During the organization phase, a
sage in target character's company (other than character) may tap to
attempt to remove this card. Make a roll: if the result is greater than 6,
discard this card."

### 77. `modify-attack` `postAttackMindRollSplit` + `split-into-own-company` (Turning Hope to Despair)

A hazard **short-event**, played from hand (or revealed on-guard) in the same
attacker-only pre-assignment `modify-attack` window as Unabated in Malice
(ba-26, §see `modify-attack fromHand`), that schedules a **per-character**
post-attack roll instead of (or alongside) any stat modifiers: if the attack
ends up not fully defeated, every character still in the defending company
rolls 2d6 plus his mind against a threshold, and each one who rolls below it
splits off into his own company.

```json
{ "type": "modify-attack", "fromHand": true, "player": "attacker",
  "postAttackMindRollSplit": { "threshold": 11 },
  "when": { "attack.detainment": false,
    "enemy.race": { "$in": ["undead", "ringwraith", "maia"] } } }
```

| Field | Required | Description |
|-------|----------|--------------|
| `postAttackMindRollSplit.threshold` | yes | The 2d6-plus-mind total each character in the company must reach (`>=`) to stay together (11 for Turning Hope to Despair). |

- **Play** — reuses the existing from-hand `modify-attack` offering and
  playability machinery verbatim (window, `when` gate, hazard-limit
  bypass via `play-flag: "no-hazard-limit"`, attacker-only `player` gate).
  `handleModifyAttack` (`combat-actions.ts`) discards the card as usual, but
  because `postAttackMindRollSplit` is set, stores
  `{ threshold }` as `CombatState.mindRollSplitPending` instead of (in this
  card's case, since no `prowessModifier`/etc. are set) applying any stat
  change.
- **Roll** — at combat finalization (`finalizeCombat`, `combat-finalize.ts`),
  if `!allDefeated` and `mindRollSplitPending` is set, the engine enqueues one
  generic `dice-check` `PendingResolution` per character still in the
  defending company: `modifiers: [{ kind: "constant", value: <effective mind> }]`,
  `threshold`, `comparison: "gte"`, `onFail: { type: "split-into-own-company" }`,
  `targetCharacterId`/`targetCompanyId` set. The company's controller rolls.
- **Split** — `split-into-own-company` (a new `TriggeredAction` verb) is
  dispatched by `applyDiceCheckBranch` (`pending-reducers.ts`) on a failed
  roll, delegating to `splitCharacterOffCompany` (`reducer-utils.ts`): the
  generalized, auto-rejoining sibling of Left Behind (td-41)'s
  `applyLeftBehindSplit` (§64 `left-behind-split`). It peels the character
  into a new `Company` sharing the same site path (`currentSite` /
  `destinationSite` / `movementPath`), flagged
  `Company.forcedSoloHazardLimit` — **not** `leftBehind` — since the card
  carries no "may rejoin" clause. A lone character instead flags his own
  company `Company.forcedSoloExtraPhasePending`, mirroring
  `leftBehindExtraPhasePending`.
- **Separate M/H phase, limit one** — identical mechanism to `left-behind-split`:
  the new company is created *unhandled*, so the M/H loop's `select-company`
  naturally gives it its own phase; `enterSetHazardLimitAndAutoAdvance`
  (`mh-steps.ts`) forces a `forcedSoloHazardLimit` company's snapshot to 1,
  **clearing the flag the moment it is consumed** (unlike `leftBehind`, which
  stays set until the explicit rejoin resolves). `advanceAfterCompanyMH`
  (`mh-hazard-play.ts`) re-runs a `forcedSoloExtraPhasePending` lone company
  once, mirroring the `leftBehindExtraPhasePending` branch.
- **No explicit rejoin** — because the flag is gone after the split company's
  own phase, `autoMergeNonHavenCompanies` (rule 2.IV.6) treats it like any
  other company: it silently merges back with its origin the moment both are
  at the same non-Haven site, with no `left-behind-rejoin`-style pending
  choice. This is the deliberate behavioral difference from Left Behind,
  whose printed text explicitly grants a "may rejoin" option that Turning
  Hope to Despair's text does not.

Used by *Turning Hope to Despair* (as-41): "Playable on a company facing a
non-detainment attack from: Undead, Nazgûl, or Maia; does not count against
the hazard limit. If the attack is not defeated, each character in the
company makes a roll and adds his mind. If the result is less than 11, the
character splits off from the company and forms his own company with the
same site path as his original company. The character faces a separate
movement/hazard phase this turn with a hazard limit of one."

### 77. `tap-at-site` + `reattach-to-item` + `activeWhileAttachedToItem` (Map to Mithril)

A card-borne "if bearer is ever at named site, tap this permanent-event
(permanently); once tapped and at a race-flavor site, move it onto a chosen
item mid-game and only then grant a stat bonus" shape.

```json
{ "type": "tap-at-site", "siteNames": ["Moria"] },
{ "type": "play-flag", "flag": "no-auto-untap" }
```

- **`tap-at-site`** — a level-triggered (not edge-triggered) passive check on
  a resource permanent-event currently sitting as its bearer's own `items`
  entry. The `sweepTapAtSiteItems` `postReduce` sweep (`reducer-utils.ts`)
  re-runs after every action: whenever the bearer's company's current site
  name is in `siteNames`, an untapped matching item is tapped. Fires on
  arrival, on staying put, and even if the company was already at the site
  when the card was played — matching "if bearer is ever at X" card text,
  unlike an arrival-edge trigger. Paired with `play-flag: "no-auto-untap"` to
  make the tap permanent — that flag was extended in this certification to
  also apply to items borne by a character (`reducer-untap.ts`'s per-item
  untap loop), not just top-level `cardsInPlay` entries as before.

```json
{ "type": "grant-action",
  "action": "map-to-mithril-attach-weapon",
  "cost": { "tap": "bearer" },
  "when": { "$and": [
    { "self.status": "tapped" },
    { "site.keywords": { "$includes": "dwarf-hold" } } ] },
  "targets": { "scope": "company-items",
    "filter": { "$and": [
      { "keywords": { "$includes": "weapon" } },
      { "unique": false } ] } },
  "apply": { "type": "reattach-to-item" } },
{ "type": "stat-modifier", "stat": "prowess", "value": 3,
  "activeWhileAttachedToItem": true }
```

- **`self` grant-action context** (`buildGrantActionContext`,
  `legal-actions/organization.ts`) — the status of the specific card instance
  carrying the grant-action (an item/hazard/ally, or the bearer's own card
  when a character-def grant-action passes its own instance id as source),
  for abilities gated on their own source card's tapped/untapped/inverted
  status rather than the bearer's. `{ "self.status": "tapped" }`.
- **`site.keywords`** — added to the grant-action `site` context alongside
  `type`/`region`/`isTapped`/etc.: the current site's DSL `keywords` array, so
  a grant-action can gate on a race-flavor site tag (e.g. the new `dwarf-hold`
  keyword, tagged onto Blue Mountain Dwarf-hold tw-377 / Iron Hill Dwarf-hold
  tw-403) rather than only the formal `siteType`.
- **`reattach-to-item`** — a `TriggeredAction` verb resolved in
  `runGrantApply` (`grant-action-apply.ts`): re-parents the source card from
  the bearer's `items` onto a chosen item's `attachedToItem` binding — the
  same shape Barrow-blade (dm-119) gets at play time, applied here mid-game
  via a `grant-action` with `targets.scope: "company-items"` supplying the
  chosen item's instance id as `targetCardId`. No card instance is lost; it
  simply changes zones, keeping its current (tapped) status.
- **`activeWhileAttachedToItem`** (`stat-modifier` flag) — mirrors
  `activeWhileStored`'s dormant-until-state-reached shape: the modifier is
  skipped while the card sits as its own bearer's plain item
  (`collectCharacterEffects`'s own-items loop, `effects/resolver.ts`) and is
  collected only via the existing item-attached-events scan once genuinely
  bound through `attachedToItem` — so the bonus never leaks onto the bearer
  before the card is actually re-parented onto the target item.

Used by Map to Mithril (td-133): "Playable on a Dwarf during the site phase
at a site at which Information is playable. Tap the Dwarf and site. Tap Map
to Mithril if bearer is ever at Moria; this card never untaps. If Map to
Mithril is at a Dwarf-hold and it is tapped, the bearer may tap himself and
place this card with a non-unique weapon in his company. This gives the
weapon a +3 prowess bonus."

### 78. `add-constraint` `region-shortcut` (Ash Mountains)

A company-bound `add-constraint` kind for the "movement enhancer" family of
end-of-organization resource short-events (Ash Mountains tw-194, Mountains of
Shadow tw-287, Anduin River tw-191, and their minion "Deeps" counterparts):
"tap a ranger to move as if the following pairs of regions were adjacent …
faces an attack at the beginning of its movement/hazard phase … alternatively,
if the site moved to is in one of the regions listed above, the hazard limit
is reduced by N."

```json
{ "type": "play-window", "phase": "organization", "step": "end-of-org" },
{ "type": "play-target", "target": "company",
  "filter": { "company.skills": { "$includes": "ranger" } } },
{ "type": "on-event", "event": "self-enters-play",
  "apply": {
    "type": "add-constraint",
    "constraint": "region-shortcut",
    "scope": "turn",
    "pairs": [["Dagorlad", "Gorgoroth"], ["Horse Plains", "Gorgoroth"]],
    "requiredSkill": "ranger",
    "race": "orc", "strikes": 4, "prowess": 8,
    "value": -2, "floor": 2
  },
  "target": "target-company" },
{ "type": "duplication-limit", "scope": "company", "max": 1 }
```

- **`company.skills`** — added to the end-of-org `play-target: "company"`
  filter context (`endOfOrgEligibility`, `legal-actions/organization.ts`): the
  union of every company member's effective skills, mirroring the
  already-established `company.skills` field on the item/ally play-target
  context (`organization-events.ts`, Palantír of Amon Sûl tw-296 family) so
  `{ "company.skills": { "$includes": "ranger" } }` reads the same regardless
  of which context builder resolves it.
- **`region-shortcut`** constraint kind (`types/pending.ts`) — carries
  `pairs` (region-name pairs), `requiredSkill`, an optional `attack`
  (`race`/`strikes`/`prowess`, taken from the same generic `race`/`strikes`/
  `prowess` `add-constraint` fields other kinds already use), and
  `hazardLimitReduction` (`value`/`floor`, from the generic `value`/`floor`
  fields `hazard-limit-region-count` uses). Built in `reducer-events.ts`'s
  `add-constraint` switch.
- **Path-finding widening** — `companyRegionShortcutPairs`
  (`legal-actions/movement-hazard.ts`) finds an active `region-shortcut`
  constraint bound to the declaring company and confirms it still has an
  untapped character carrying `requiredSkill`; if so, the region-movement
  `declare-path` enumeration searches `withVirtualAdjacency(movementMap,
  pairs)` (`movement-map.ts`) instead of the plain map. That helper only
  extends `regionGraph` (consulted by `findRegionPaths`) — it leaves
  `regionPathEdges` (consulted by `getReachableSites` for org-phase
  destination-candidate reachability) untouched, so the shortcut only widens
  which *path* can justify an already-chosen destination, never which
  destinations organization-phase planning offers in the first place.
- **Tap cost + forced attack** — `checkRegionShortcutUsage` (`mh-steps.ts`,
  called from `handleRevealNewSite`'s `declare-path` branch) checks whether
  the just-resolved region path actually crosses one of the constraint's
  pairs. If so, it taps the first untapped character with `requiredSkill`,
  removes the constraint, and — when the constraint carries an `attack` —
  injects a `region-shortcut-attack` combat (`makeCombatState`) before
  `enterSetHazardLimitAndAutoAdvance` runs, via a new `region-shortcut-attack`
  M/H step (`types/state-phases.ts` `MHStep`, dispatched in
  `reducer-movement-hazard.ts`) that simply resumes at `set-hazard-limit` once
  the injected combat resolves (mirrors the `order-effects`/
  `set-hazard-limit` auto-advance shape, not a `site-entry-attack`-style
  return-step field). Legal-action support for the new step is a bare `pass`
  (`legal-actions/movement-hazard.ts`), exactly like `order-effects`.
- **"Alternatively" hazard-limit reduction** — if the shortcut was *not* used
  for this move, the constraint survives into `snapshotHazardLimit`
  (`mh-steps.ts`), which applies `hazardLimitReduction` (floored, same
  never-raise-to-floor semantics as `hazard-limit-region-count`) when the
  company's resolved destination region (the last entry of its site path) is
  one of the constraint's named regions. Because firing the attack removes
  the constraint first, the two payoffs are mutually exclusive on a single
  move without any extra bookkeeping.

Used by Ash Mountains (tw-194): "Playable at the end of the organization
phase on a company containing a ranger. If the company uses region cards for
its site path, tap the ranger to move as if the following pairs of regions
were adjacent: Dagorlad and Gorgoroth, Horse Plains and Gorgoroth. The
company faces an attack at the beginning of its movement/hazard phase: Orcs —
4 strikes with 8 prowess. Alternatively, if the site moved to is in one of
the regions listed above, the hazard limit is reduced by 2 (to a minimum of
2). Cannot be duplicated on a given company." (CRF 22: the printed
"otherwise" should be read as "alternatively".)
