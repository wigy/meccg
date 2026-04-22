# Adûnaphel the Ringwraith (le-50) certification plan

Narrow-scope cert for a single ringwraith avatar card. Written with
the 2026-04-21 single-card DSL consolidation policy in mind: no
speculative primitives, no per-card keywords, minimum engine surface.

## Card

- **ID:** `le-50`
- **Name:** Adûnaphel the Ringwraith
- **Alignment/race:** ringwraith avatar (minion)
- **Stats:** prowess 8, body 10, direct influence 4, mind null
- **Skills:** warrior, scout, diplomat
- **Homesite:** Urlurtsu Nurn

Text (authoritative, from `data/cards.json`):

> *Unique. Manifestation of Adûnaphel.* Can use spirit-magic. +2
> direct influence in Heralded Lord mode. -2 prowess in Fell Rider
> mode. As your Ringwraith, if at a Darkhaven, she may tap to cancel
> one hazard creature attack not played at a site against any one of
> your companies.

## What the text actually demands

The text reads like three abilities, but only one is an ability of
*this* card:

1. **"Can use spirit-magic"** — flavor today. No spirit-magic cards
   are certified, so there is nothing in the engine that would consult
   this flag. Deferred: when the first spirit-magic card enters the
   certified pool, a `magic-use` tag will be added then, driven by the
   actual consumer (policy: "each new primitive is justified by an
   immediate in-tree consumer"). No effects entry on le-50 for this
   line.
2. **"+2 direct influence in Heralded Lord mode. -2 prowess in Fell
   Rider mode"** — not an ability of le-50. These numbers describe
   the net stat change *when the separate resource cards* Heralded
   Lord (le-190) and Fell Rider (le-183) are in play on her company.
   Those cards carry their own `stat-modifier` effects (they are
   uncertified today — they sit in their own cert queue). le-50 does
   not need an effects entry for this line.
3. **Tap at Darkhaven to cancel a hazard creature attack not played
   at a site** — the only real ability. This is what we certify.

Certifying only (3) is correct and complete: (1) has no engine
consumer, and (2) belongs to other cards. The "FULLY playable"
certification rule is satisfied because no text line is *silently
broken* — (1) and (2) are explicitly flavor relative to the currently
certified card pool.

## Ability (3) — what it decomposes to

- **Cost:** tap the bearer (`cost: { "tap": "self" }`).
- **Trigger:** cancel-attack effect, available when an attack is
  pending against one of her owner's companies during the combat
  window.
- **Precondition — bearer at a Darkhaven:** ringwraith avatars can
  only be at ringwraith havens (Darkhavens) or non-haven minion
  sites — there is no hero haven in her legal site pool. So the
  existing `bearer.atHaven: true` predicate is *equivalent* to
  "at a Darkhaven" for this card. Reuse it; do not add an
  `atDarkhaven` keyword.
- **Precondition — attack not played at a site:** distinguishes the
  three combat-attack sources the engine already models as
  `CombatState.attackSource.type`:
  - `creature` — a hazard creature played during the M/H phase →
    **not played at a site**. Cancellable.
  - `on-guard-creature` — a creature placed on-guard at a site and
    revealed during the site phase → **played at the site**. Not
    cancellable.
  - `automatic-attack` — the site's own listed attack → **played at
    the site**. Not cancellable.
- **"As your Ringwraith"** — flavor emphasis on the avatar role. No
  separate check: le-50 *is* the ringwraith avatar (`alignment:
  ringwraith`, `avatar: true` in its metadata). Any player controlling
  le-50 necessarily holds her as their ringwraith. No condition term
  is needed.
- **"Against any one of your companies"** — implicit in cancel-attack
  routing: the ability is only offered when an attack is pending
  against a company owned by the bearer's controller.

## Engine gap

One. The `cancel-attack` `when` context currently exposes
`attack.keying` (seen on Stinker le-154) but not an attack-source
discriminator. The discriminator exists internally
(`combat.attackSource.type` — `creature` | `on-guard-creature` |
`automatic-attack`) in `reducer-combat.ts`; it simply is not projected
into the predicate-matcher context.

**Fix:** project `attack.source` into the cancel-attack `when`
context with the same three string values already used by the
discriminated union. No new types, no new concepts — just a
one-field addition to the context-building step.

The Adûnaphel filter then reads:

```json
{ "attack.source": "creature" }
```

Read as: "cancellable iff the attack was played into combat as a
loose M/H creature, not from on-guard and not from the site's own
attack list."

This is immediately reusable: several later certs (any
"cancel/affect attacks not played at a site" wording, e.g. the rest
of the Darkhaven tap-cancel ringwraiths — Dwar's +prowess boost,
Hoarmûrath's hand-size bump, etc., don't all share this filter, but
future cancel-attack cards certainly will).

## Effects JSON to land on le-50

```jsonc
"effects": [
  {
    "type": "cancel-attack",
    "cost": { "tap": "self" },
    "when": {
      "$and": [
        { "bearer.atHaven": true },
        { "attack.source": "creature" }
      ]
    }
  }
]
```

Plus `"certified": "<ISO date>"` alongside the existing fields in
`packages/shared/src/data/le-characters.json`.

## Files touched

- `packages/shared/src/engine/effects/resolver.ts` (or the
  predicate-matcher context builder — wherever `attack.keying` is
  populated today) — add `attack.source` to the same context.
- `packages/shared/src/data/le-characters.json` — populate le-50
  `effects` and add `certified`.
- `docs/card-effects-dsl.md` — document `attack.source` alongside
  `attack.keying` in the `cancel-attack` section. One short table
  row. Per the `feedback_dsl_docs.md` policy, DSL additions go in
  the doc during the certifying PR.
- `packages/shared/src/tests/cards/le-50.test.ts` — new card test
  (see below).
- `packages/shared/src/card-ids.ts` — **only** if le-50 ends up
  referenced in more than one file; otherwise declare the ID as a
  local const in the test file (per repo policy).

Explicitly *not* touched: combat reducers (the discriminator already
exists), Heralded Lord / Fell Rider cards, any magic-use machinery.

## Test plan (le-50.test.ts)

One `describe` block, covering exactly the three cases the `when`
clause gates. All three must be real engine assertions — no
`test.todo`, no JSON-against-JSON tautologies.

1. **Positive — M/H creature attack against Adûnaphel's company is
   cancellable by tapping her.** Build state: Adûnaphel at a
   Darkhaven (e.g. Dol Guldur, le-367), untapped, alone or with
   companions, opponent's hazard has played a creature during M/H
   that targets her company. Expect: `computeLegalActions` offers
   an `activate-granted-action` / cancel-attack action from her
   instance; dispatching it taps her and resolves the combat
   window with the attack cancelled.
2. **Negative — on-guard creature attack is not cancellable.** Same
   setup but the hazard creature arrives via on-guard reveal
   (`attackSource.type === 'on-guard-creature'`). Expect: no
   cancel-attack action offered from her instance.
3. **Negative — site automatic-attack is not cancellable.** Move
   Adûnaphel into a site whose automatic attack triggers. (A
   Darkhaven won't have one, so pick a non-haven site the test can
   legally enter.) Expect: no cancel-attack action offered.
4. **Negative — Adûnaphel not at a haven.** Place her at a
   non-Darkhaven site while an M/H creature attacks. Expect: no
   cancel-attack action offered (precondition `bearer.atHaven`
   fails).
5. **Negative — Adûnaphel tapped.** Tap her, M/H creature attacks
   her company. Expect: no cancel-attack action offered (tap cost
   cannot be paid).

All five must pass. Case 1 exercises the positive code path; cases
2–5 each kill one precondition independently so a regression in any
single clause surfaces as exactly one failing test.

Test helper reuse: builders from `test-helpers.ts` (`buildTestState`,
`charIdAt`, `viableActions`, `dispatch`). For the attack-source
variants, the pattern used by `le-154.test.ts` (Stinker) is the
template — it builds combat with explicit `attackSource` already.
If the Stinker test builds only `type: 'creature'` combats, case 2
and case 3 will need a new combat-state builder variant — if that
is the case, add it to `test-helpers.ts` (never to the test file,
per `feedback_no_helpers_in_tests.md`), not inline.

## Out of scope (deferred; do not grow this PR)

- Modeling "Can use spirit-magic" as an engine tag. Deferred to the
  first spirit-magic card cert.
- Certifying Heralded Lord (le-190) or Fell Rider (le-183). These
  are permanent-event resource cards with their own scope; their
  `stat-modifier` effects land in their own PRs.
- Certifying the other Darkhaven-tap ringwraiths (Dwar, Hoarmûrath,
  Ren, Ûvatha, Indûr, The Witch-king). Each has its own distinct
  effect — pronounce-then-buff, hand-size, corruption-mod,
  fetch-from-discard, etc. Several need engine primitives Adûnaphel
  doesn't. Ship Adûnaphel first; the `attack.source` exposure this
  cert adds is a pure infrastructure win that benefits the next
  cert in the queue.
- Any broader combat-context refactor. The discriminated union is
  fine as is; we are only projecting one field of it into the
  predicate matcher.

## Risk

Low. The engine change is one field in one context-builder. The
card-data change is six lines. The test adds one file. No reducer
is rewritten. No new DSL keyword is introduced. The only way this
fails is if `attack.keying` and `attack.source` end up projected
from different call sites with different `CombatState` availability
— check during implementation that both are populated in the same
place.

## Acceptance

- `npm run build` clean.
- `npm test` green (rules tests unaffected).
- `npm run test:nightly` green for le-50 and no new failures
  elsewhere.
- `npm run lint` + `npm run lint:md` clean.
- le-50 carries `"certified": "<date>"` and the five-case test file
  asserts real engine behaviour.
- PR is branch-based, not pushed to master.

## Appendix — survey of all nine Nazgûl (LE-50 through LE-58)

Read to confirm (a) the cert scope is correctly narrow and (b) no
broader refactor is the better path. All nine manifestations are
currently uncertified with empty `effects` arrays in
`packages/shared/src/data/le-characters.json`.

All nine share four structural traits, already supported by the
engine today — none of these need new machinery:

- `alignment: "ringwraith"`, `avatar: true`, `race: "ringwraith"`,
  unique, mind null, direct influence 3–5, homesite at a Darkhaven.
- "As your Ringwraith" flavor framing. No condition term needed.
- "Can use <magic>" flavor — no certified magic cards consume this
  tag today; deferred to the first magic card cert for every Nazgûl.
- "+N DI in Heralded Lord mode / ±M prowess in Fell Rider mode" —
  describes the *partner resource card's* stat-modifier effect, not
  an ability of the Nazgûl. No effects entry needed on any
  manifestation for these lines.

The **distinctive** active ability per Nazgûl and the engine
primitive each one maps to:

| ID | Name | Distinctive ability | Primitive |
|---|---|---|---|
| le-50 | Adûnaphel | Darkhaven-tap → cancel M/H creature attack | `cancel-attack` + `attack.source` (this cert) |
| le-51 | Akhôrahil | When his magic card would be discarded, return it to play deck | `on-event` trigger on magic-card-discarded (new, 1-card) |
| le-52 | Dwar | Darkhaven-tap → +1 prow/+1 body to any one company until EOT | `grant-action` + existing `company-prowess-boost` apply |
| le-53 | Hoarmûrath | Passive at Darkhaven: hand size +1 | `hand-size-modifier` with `when: bearer.atHaven` — exact pattern of le-21 Lt. of Dol Guldur, already certified |
| le-54 | Indûr | Start of his end-of-turn phase, tap → fetch magic from discard to hand | `grant-action` + `enqueue-pending-fetch` with filter=magic, target=hand (existing primitives) |
| le-55 | Khamûl | Elf target of his strike: -2 body; one RW follower no-influence | `stat-modifier` on strike-target filter + follower-control rule (1–2 card primitive) |
| le-56 | Ren | Darkhaven-tap at org → +2 corruption-check mod on one company this turn | `grant-action` + `check-modifier` apply scoped to a company for turn |
| le-57 | Ûvatha | Darkhaven-tap at org → move resource-event from discard to play deck (reshuffle); plus join-another-RW-company at org | `grant-action` + existing `recall-to-deck` apply (le-24 template); joining is a separate org-phase legal-action |
| le-58 | Witch-king | Two RW followers controllable with no influence | Follower-control rule (shared with le-55) |

### What this survey tells us about the cert scope

1. **No Nazgûl-wide abstraction fits.** Every manifestation's
   ability is shaped differently. The only shared *structural*
   piece — Darkhaven-tap-at-organization — is already expressible as
   `grant-action` + `cost: { tap: self }` + `when: bearer.atHaven`.
   No new "ringwraith-tap-at-darkhaven" DSL primitive is warranted;
   that would be exactly the kind of single-concept keyword the
   2026-04-21 consolidation spec is trying to eliminate.

2. **The engine extension Adûnaphel demands (`attack.source` in the
   `cancel-attack` `when` context) is Adûnaphel-only among the nine.**
   None of the other eight need that field. It is not a shared
   investment. It is justified *only* because Adûnaphel's single
   ability is otherwise inexpressible.

3. **The refactor question.** The cancel-attack predicate context
   builder already cleanly populates `attack.keying` (seen on le-154
   Stinker). Adding `attack.source` alongside it is an additive
   change at that same site — not a refactor. No structural
   rearrangement is better here; the current shape is fine.

4. **Ordering in the Nazgûl queue.** Hoarmûrath (le-53) is the
   smallest next cert after Adûnaphel — the passive hand-size
   modifier at Darkhaven is byte-identical in shape to the le-21
   effect already shipped. Dwar (le-52) and Ûvatha (le-57) follow
   easily on existing primitives. Akhôrahil (le-51), Khamûl (le-55),
   and Witch-king (le-58) each require one new primitive; treat each
   as its own cert with its own test and PR. Indûr (le-54) and Ren
   (le-56) sit in between — existing primitives, slightly unusual
   scoping. None of these blocks Adûnaphel; Adûnaphel does not block
   any of them.

### Non-Nazgûl ringwraith-aligned characters

For completeness: `alignment: "ringwraith"` is also carried by
non-Nazgûl minion characters in the LE set (Asternak le-1, Eradan
le-10, Layos le-19, Luitprand le-23, Ciryaher le-6, Ostisen le-36,
Gorbag le-11, The Mouth le-24, Lieutenant of Dol Guldur le-21,
Shagrat le-39). These are Ringwraith *followers* — regular minion
characters that report to a Nazgûl; they are not avatars, have mind
costs, and do not share the "As your Ringwraith…" ability frame.
Four of them (le-11, le-21, le-24, le-39) are already certified.
None of their shapes informs the Adûnaphel cert.
