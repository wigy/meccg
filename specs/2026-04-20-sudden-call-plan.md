# Plan: Sudden Call (le-235) — Minion/Balrog Endgame Trigger

## Context

Sudden Call (LE-235) is the Ringwraith/Balrog equivalent of "calling the Free Council". Per CoE rule 10.41:

> A Ringwraith [or Balrog] player cannot freely call to end the game; instead, a Ringwraith [or Balrog] player may play Sudden Call, which may be played either as a resource on a player's own turn if that player has met the normal game-length conditions for calling the end of the game (after which their opponent gets one last turn), or as a hazard during an opponent's turn if that opponent has met the normal game-length conditions for calling the end of the game (after which the player who played Sudden Call gets one last turn).

Card text adds:

- "may be included as a hazard in a Wizard's deck" — a Wizard player can deck this only as hazard
- "This card may not be played as a hazard against a Wizard player"
- "You may reshuffle this card into your play deck at any time that it is in your hand (show opponent)"

## Scope Decision: Reuse Free Council, Don't Add a New Endgame

The existing Free Council phase (`packages/shared/src/engine/reducer-free-council.ts`, `legal-actions/free-council.ts`) already implements the endgame sequence (corruption checks → duplicate reveals → scoring → game over). The card text says "Audience of Sauron Rules" but rule 10.41 clarifies this is just the same call-the-council mechanic — flavor only. We do **not** need a parallel `Phase.AudienceOfSauron`.

So the work is:

1. Block bare `call-free-council` for Ringwraith/Balrog players in `signalEndStepActions()` (alignment gate).
2. Add `play-sudden-call` as a resource short-event on own turn → same effect as today's `call-free-council` reducer branch.
3. Add `play-sudden-call` as a hazard short-event on opponent's twilight → triggers council with `lastTurnFor` set to the **player who played Sudden Call** (reversed direction).
4. Block hazard play if defending player is Wizard-aligned.
5. Add `reshuffle-from-hand` action (cross-phase, show-opponent), available whenever Sudden Call is in hand.
6. Generalize the call-council eligibility check (`rawScore + exhaustions`) into a shared helper since two more sites now consume it.
7. New DSL effects so the card text is data-driven, not hardcoded.

---

## Implementation: 5 Parts

### Part A: Player Alignment & Eligibility Helper

**Why first:** every later part branches on alignment and on "has the player met the call conditions".

**Files:**

- `packages/shared/src/engine/state-utils.ts` (new helpers)
- `packages/shared/src/engine/legal-actions/end-of-turn.ts`

**What to build:**

1. `isMinionOrBalrog(player: PlayerState): boolean` — returns true for `'minion'` or `'balrog'` alignment.
2. `isWizard(player: PlayerState): boolean` — returns true for `'hero'` (wizard) and `'fallen-wizard'` alignments. Confirm against the alignment enum; the rule says "Wizard player", which in CoE includes Fallen-wizards.
3. `canCallEndgameNow(state, playerIdx): boolean` — extracts the existing inline check from `signalEndStepActions` (`rawScore >= FREE_COUNCIL_MP_THRESHOLD && exhaustions >= 1) || exhaustions >= 2`, plus the `freeCouncilCalled === false && lastTurnFor === null` guards.
4. In `signalEndStepActions()`, gate `call-free-council` on `!isMinionOrBalrog(player)`. Minion/Balrog players must use Sudden Call instead — log the rationale.

**Tests added (in PR):**

- Rule 10.41 stub: Minion player at threshold does NOT see `call-free-council` in legal actions during signal-end.
- Hero player still sees it (regression).

---

### Part B: Dual-Nature Short-Event Infrastructure

**Why:** Today, a short-event is either resource (`type === 'minion-resource-event'`) or hazard (`type === 'minion-hazard-event'`). Sudden Call is one card type with `attributes.playableAsHazard: true` that needs both legal-action paths.

**Files:**

- `packages/shared/src/types/cards.ts` — confirm/expose `playableAsHazard` on the card definition shape (`CardAttributes`).
- `packages/shared/src/engine/legal-actions/movement-hazard.ts` — when scanning hazard player's hand for short-event hazards, include cards whose primary type is a minion-resource-event but `attributes.playableAsHazard === true` AND a hazard-side DSL effect is defined.
- `packages/shared/src/engine/legal-actions/long-event.ts` (or wherever resource short-events are offered during own twilight/long-event) — include the card normally as a resource short-event when it has a resource-side DSL effect.
- `packages/shared/src/engine/reducer-events.ts` — when resolving `play-short-event`, dispatch on which side (resource vs hazard) the card is being played; resolve the matching DSL effect array.

**Card-data shape:**
Keep the existing flat `effects[]` array and tag each effect with a `when: 'resource' | 'hazard'` filter. Effects with no `when` apply in either context (back-compat with all existing single-side cards). At resolution time, the dispatcher in `reducer-events.ts` filters by the play-context side. Document the `when` field in `docs/card-effects-dsl.md`.

**Tests added:**

- A dual-nature card with both effect arrays appears in resource-side legal actions on own turn AND in hazard-side legal actions on opponent's turn.

---

### Part C: New DSL Effects

**Files:**

- `docs/card-effects-dsl.md` — document new effect types
- `packages/shared/src/engine/effects/` — new effect handlers
- `packages/shared/src/types/effects.ts` (or wherever the DSL union lives)

**New effect types:**

1. **`call-council`**
   - Params: `lastTurnFor: 'opponent' | 'self'`
   - Resource-side use: `{ type: 'call-council', lastTurnFor: 'opponent' }`
   - Hazard-side use: `{ type: 'call-council', lastTurnFor: 'self' }`
   - Behavior: same state mutation as today's `call-free-council` reducer branch — sets `freeCouncilCalled = true` on the *resource player whose endgame conditions were met*, sets `lastTurnFor` per param, advances turn. Reuse the existing block in `reducer-end-of-turn.ts` by extracting it into a helper `triggerCouncilCall(state, callerPlayerId, lastTurnRecipient)`.

2. **`reshuffle-self-from-hand`**
   - No params. The card resolves by removing itself from the player's hand and placing it back into the play deck, then shuffling.
   - "Show opponent" — emits a public log entry naming the card and player. No hidden state change since opponent already sees the play action.
   - Triggered by a new `reshuffle-card-from-hand` action (Part D).

**Constraint additions for hazard-side `call-council`:**

1. **`play-context`** condition variant: `{ type: 'play-context', forbidden-when: { 'opponent.alignment': ['hero', 'fallen-wizard'] } }` — generic "cannot be played as hazard against player matching filter". This keeps the Wizard-immunity rule data-driven and reusable for any future card with the same restriction. Both Hero (Wizard) and Fallen-wizard alignments are immune — locked in per question 1. If a generic filter expression already exists per CLAUDE.md's "prefer DSL expressions over magic keywords" guidance, extend it instead.

**Tests added:**

- `call-council` resource-side from a Minion player ends with `lastTurnFor === opponent`.
- `call-council` hazard-side from a Minion player on a Hero opponent's turn ends with `lastTurnFor === sudden-call-player`.
- `reshuffle-self-from-hand` removes card from hand, puts it in play deck, shuffles, logs publicly.

---

### Part D: Cross-Phase `reshuffle-card-from-hand` Action

**Why separate from short-event play:** The card text says "at any time that it is in your hand". This is not a play action — the card stays in the deck, not the discard. It needs to be available across phases.

**Files:**

- `packages/shared/src/types/actions.ts` — `ReshuffleCardFromHandAction { type: 'reshuffle-card-from-hand', card: CardInstanceId, player: PlayerId }`
- `packages/shared/src/engine/legal-actions/index.ts` — augment top-level legal-actions computer to include this action whenever the player has at least one hand card with the `reshuffle-self-from-hand` effect available, regardless of phase.
- `packages/shared/src/engine/reducer.ts` — handle the new action by invoking the `reshuffle-self-from-hand` effect.

**Availability rule:** Offer `reshuffle-card-from-hand` only when the player already has at least one *other* legal action available in the current step. This naturally excludes atomic resolution windows (mid-strike, mid-corruption-check, mid-dice-roll) where the only "legal action" is the system-driven resolve, and naturally includes every strategy-time step where the player has agency. Implementation: in the top-level legal-actions computer, compute the rest of the action list first, then append `reshuffle-card-from-hand` entries only if the list is non-empty.

**Tests added:**

- The action appears for a player holding Sudden Call during Untap, Org, MH twilight, Site, End-of-Turn (each is a strategy step with other legal actions present).
- Resolving the action: card moves from hand to play deck, deck is reshuffled (deterministic with seeded RNG in test), public log entry naming the card and player.
- Action does NOT appear during atomic resolution windows (mid-strike, mid-corruption-check) — covered automatically by the "only if other legal actions exist" gate.

---

### Part E: Card Data + Certification Test

**Files:**

- `packages/shared/src/data/le-resources.json` — add `effects` to LE-235 with both resource and hazard sides; add `certified: true`.
- `packages/shared/src/tests/cards/le-235-sudden-call.test.ts` — new card test.
- `packages/shared/src/tests/rules/10-corruption-influence-endgame/rule-10.41-minion-balrog-sudden-call.test.ts` — implement the existing `test.todo`.

**Card data shape (illustrative):**

```json
{
  "id": "le-235",
  "effects": [
    { "when": "resource", "type": "call-council", "lastTurnFor": "opponent" },
    { "when": "hazard",   "type": "call-council", "lastTurnFor": "self" }
  ],
  "constraints": [
    { "when": "hazard", "type": "play-context", "forbidden-when": { "opponent.alignment": ["hero", "fallen-wizard"] } },
    { "when": "hazard", "type": "play-context", "required": { "opponent.canCallEndgameNow": true } },
    { "when": "resource", "type": "play-context", "required": { "self.canCallEndgameNow": true } }
  ],
  "abilities": [
    { "type": "reshuffle-self-from-hand" }
  ],
  "certified": true
}
```

(Final JSON shape will follow whatever the existing DSL conventions look like — the above sketches the *intent*.)

**Card test scenarios:**

1. Resource-side play by Minion at threshold → council called, opponent gets one last turn, transitions to Free Council after that turn.
2. Resource-side play not legal when caller is below threshold.
3. Hazard-side play during Hero opponent's twilight → not legal (Wizard immunity).
4. Hazard-side play during Minion-on-Minion match where defending player is at threshold → legal; council called with `lastTurnFor` = the Sudden Call player.
5. `reshuffle-card-from-hand` action is offered while card sits in hand; resolving it returns the card to the deck.
6. Cannot be played as resource by a Hero player (alignment gate at the card-play layer mirrors the player-alignment gate at signal-end).

---

## Implementation Order

1. **Part A** — alignment gate + eligibility helper (small, isolated, prerequisite for the rest).
2. **Part C** — DSL effect types (`call-council`, `reshuffle-self-from-hand`, alignment-based play-context constraint) — needed by B and E.
3. **Part B** — dual-nature short-event infrastructure.
4. **Part D** — cross-phase reshuffle action.
5. **Part E** — wire up le-235 data + tests + flip `certified: true`.

## PR Strategy

One PR per part (5 PRs total), each independently reviewable:

| PR | Title | Approx size |
|---|---|---|
| 1 | `gate call-free-council on player alignment` | small |
| 2 | `add call-council and reshuffle-self-from-hand DSL effects` | medium |
| 3 | `support dual-nature short-events (resource + hazard sides)` | medium |
| 4 | `add reshuffle-card-from-hand cross-phase action` | small |
| 5 | `certify Sudden Call (le-235)` | small |

PR 5 is the certification PR — that's what the certify-card skill will produce.

## Files Modified (summary)

| File | Changes |
|---|---|
| `packages/shared/src/engine/state-utils.ts` | `isMinionOrBalrog`, `isWizard`, `canCallEndgameNow` helpers |
| `packages/shared/src/engine/legal-actions/end-of-turn.ts` | gate call-free-council on alignment |
| `packages/shared/src/engine/reducer-end-of-turn.ts` | extract `triggerCouncilCall` helper from existing call-free-council branch |
| `packages/shared/src/engine/effects/` | new effect handlers: `call-council`, `reshuffle-self-from-hand` |
| `packages/shared/src/engine/legal-actions/movement-hazard.ts` | recognize dual-nature cards as hazard-side options |
| `packages/shared/src/engine/legal-actions/long-event.ts` (and resource-side short-event sites) | recognize dual-nature cards as resource-side options |
| `packages/shared/src/engine/legal-actions/index.ts` | offer `reshuffle-card-from-hand` cross-phase |
| `packages/shared/src/engine/reducer.ts` | handle `reshuffle-card-from-hand` |
| `packages/shared/src/engine/reducer-events.ts` | dispatch resource vs hazard side on `play-short-event` |
| `packages/shared/src/types/actions.ts` | `ReshuffleCardFromHandAction` |
| `packages/shared/src/types/cards.ts` / DSL types | dual-side `effects` shape, new effect/constraint types |
| `packages/shared/src/data/le-resources.json` | LE-235 effects + `certified: true` |
| `packages/shared/src/tests/cards/le-235-sudden-call.test.ts` | new card test |
| `packages/shared/src/tests/rules/10-corruption-influence-endgame/rule-10.41-minion-balrog-sudden-call.test.ts` | implement `test.todo` |
| `docs/card-effects-dsl.md` | document new effect types and dual-side `effects` shape |

## Verification

- `npm run build`, `npm test`, `npm run test:nightly`, `npm run lint`, `npm run lint:md` (all five in parallel) before each PR.
- Manual: spin up a Minion-vs-Hero game, play through to threshold, confirm Sudden Call resource-side ends the game with opponent's last turn.
- Manual: spin up a Minion-vs-Hero game where Hero is at threshold, confirm hazard-side Sudden Call is NOT offered (Wizard immunity).
- Manual: confirm reshuffle action visible in client across multiple phases.

## Deferred (out of scope)

- "Audience of Sauron" as a distinct named phase — the rule treats it as the same mechanic as Free Council; rebrand display strings only if/when player feedback asks for it.
- Other cards that might benefit from `reshuffle-self-from-hand` (none currently certified) — implement only what le-235 needs.
- Web-client UI for the cross-phase reshuffle action — text client + legal-action surface is enough for certification.

## Resolved Decisions

1. **Wizard immunity scope:** Both Hero (Wizard) and Fallen-wizard alignments are immune to hazard-side Sudden Call.
2. **Dual-nature effect shape:** Flat `effects[]` array with a `when: 'resource' | 'hazard'` filter on each effect. Effects with no `when` apply in either context.
3. **Reshuffle-from-hand timing:** Available whenever the player already has at least one *other* legal action in the current step. This implicitly excludes atomic resolution windows and includes every strategy step.
