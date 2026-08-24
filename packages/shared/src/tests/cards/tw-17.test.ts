/**
 * @module tw-17.test
 *
 * Card test: Brigands (tw-17)
 * Type: hazard-creature
 * Race: men
 * Stats: prowess 8, strikes 2, kill-marshalling-points 1
 * Keyed to: border-land {b} or wilderness {w}
 * Effects: 1 (on-event: character-wounded-by-self → force-discard-one-company-item)
 *
 * "Men. Two strikes. If any strike of Brigands wounds a character, the
 *  company must immediately discard one item (of defender's choice)."
 *
 * Rules covered by tests:
 * 1. Combat initiates with 2 strikes and prowess 8.
 * 2. When any character is wounded, a discard-one-company-item pending
 *    resolution is enqueued once for the defending player.
 * 3. The defending player can choose any item in the company to discard.
 * 4. The discarded item moves to the defender's discard pile.
 * 5. When no character is wounded, no pending resolution is enqueued.
 * 6. When the company has no items, no pending resolution is enqueued
 *    even if a character is wounded.
 * 7. Effect fires once per attack (not once per wound): only one item
 *    is discarded even if multiple characters are wounded.
 *
 * Multi-strike combat flow (Brigands has 2 strikes):
 *   1. assign-strike char1  (defender)
 *   2. assign-strike char2  (defender) → choose-strike-order
 *   3. choose-strike-order  (defender picks order)
 *   4. resolve-strike char1 + optional body-check-roll (attacker = PLAYER_2 rolls)
 *   5. resolve-strike char2 (auto-selected) + optional body-check-roll
 *   6. finalizeCombat fires wound events
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeBorderMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch,
  viableFor, viableActions, expectCharItemCount,
  executeAction,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CardInstanceId } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const BRIGANDS = 'tw-17' as CardDefinitionId;
const BORDER_KEYING = { method: 'region-type' as const, value: 'border' };
// Fallen-wizard permanent resource-event (Thrall of the Voice). It is *placed
// with* a character so it rides in `CharacterInPlay.items`, but it is a
// resource-event, not an item, and must never be a Brigands discard target.
const THRALL_OF_THE_VOICE = 'wh-82' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Brigands (tw-17)', () => {
  beforeEach(() => resetMint());

  test('combat initiates with 2 strikes and prowess 8', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const brigandId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, brigandId, companyId, BORDER_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(8);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('wounded character triggers discard-one-company-item pending resolution', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const brigandId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    let s = playCreatureHazardAndResolve(ready, PLAYER_2, brigandId, companyId, BORDER_KEYING);

    // Assign both strikes (defender): ARAGORN first, then BILBO → choose-strike-order
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    // Defender picks strike order; first action = ARAGORN
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    // Strike 1: Aragorn wounded (roll 2 ≤ prowess 8), body check roll 2 → survives (2 < body 9)
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);
    // Strike 2: Bilbo defeats (roll 12 > prowess 8) — auto-selected, no body check
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    expect(s.combat).toBeNull();

    // One discard-one-company-item pending resolution enqueued for P1
    const pending = s.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('discard-one-company-item');

    // Defender only has discard-item-from-company actions available
    const viable = viableFor(s, PLAYER_1);
    expect(viable.length).toBeGreaterThan(0);
    expect(viable.every(a => a.action.type === 'discard-item-from-company')).toBe(true);
  });

  test('defender can choose which item to discard and it moves to discard pile', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const brigandId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    let s = playCreatureHazardAndResolve(ready, PLAYER_2, brigandId, companyId, BORDER_KEYING);

    // Assign, choose order, resolve: ARAGORN wounded, BILBO wins
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);  // ARAGORN wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2); // survives (2 < body 9)
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12); // BILBO wins

    expect(s.combat).toBeNull();
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(1);

    // Two items available: Glamdring and Dagger of Westernesse
    const discardActions = viableActions(s, PLAYER_1, 'discard-item-from-company');
    expect(discardActions).toHaveLength(2);

    // Pick the first action (defender's choice)
    const chosen = discardActions[0].action;
    const chosenInstanceId = (chosen as { itemInstanceId: string }).itemInstanceId;

    const afterDiscard = dispatch(s, chosen);

    // Chosen item gone from Aragorn, one item remains
    expectCharItemCount(afterDiscard, RESOURCE_PLAYER, ARAGORN, 1);
    const discardPileIds = afterDiscard.players[0].discardPile.map(c => c.instanceId);
    expect(discardPileIds).toContain(chosenInstanceId);

    // Pending resolution cleared
    expect(afterDiscard.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('non-item cards placed with a character (Thrall of the Voice) are not offered as discard targets', () => {
    // Regression: a wounded character carried both a genuine item (Glamdring)
    // and Thrall of the Voice — a permanent resource-event placed *with* the
    // character. Brigands forces the company to discard one *item*, so only
    // Glamdring may be offered; Thrall of the Voice must be excluded.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, THRALL_OF_THE_VOICE] }, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const brigandId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    let s = playCreatureHazardAndResolve(ready, PLAYER_2, brigandId, companyId, BORDER_KEYING);

    // Assign, choose order, resolve: ARAGORN wounded, BILBO wins
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);  // ARAGORN wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2); // survives (2 < body 9)
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12); // BILBO wins

    expect(s.combat).toBeNull();
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(1);

    // Only the genuine item (Glamdring) is offered — Thrall of the Voice excluded.
    const discardActions = viableActions(s, PLAYER_1, 'discard-item-from-company');
    expect(discardActions).toHaveLength(1);
    const offeredId = (discardActions[0].action as { itemInstanceId: CardInstanceId }).itemInstanceId;
    expect(resolveInstanceId(s, offeredId)).toBe(GLAMDRING);
  });

  test('no pending resolution when the company\'s only "item" entry is a non-item card', () => {
    // Regression (deadlock): the enqueue guard counted raw `items.length`, so
    // a company whose only `items` entry was Thrall of the Voice (a permanent
    // resource-event placed *with* a character, never a discard target) got a
    // discard-one-company-item resolution with an empty action menu — no
    // player had any legal action.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [THRALL_OF_THE_VOICE] }, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const brigandId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    let s = playCreatureHazardAndResolve(ready, PLAYER_2, brigandId, companyId, BORDER_KEYING);

    // Assign, choose order, resolve: ARAGORN wounded, BILBO wins
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);  // ARAGORN wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2); // survives (2 < body 9)
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12); // BILBO wins

    expect(s.combat).toBeNull();
    // No discardable item in the company → no resolution enqueued.
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('no pending resolution when no character is wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const brigandId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    let s = playCreatureHazardAndResolve(ready, PLAYER_2, brigandId, companyId, BORDER_KEYING);

    // Both characters win their strikes (high roll, no body check)
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12); // ARAGORN wins
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12); // BILBO wins

    expect(s.combat).toBeNull();
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('no pending resolution when company has no items, even if a character is wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const brigandId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    let s = playCreatureHazardAndResolve(ready, PLAYER_2, brigandId, companyId, BORDER_KEYING);

    // Strike 1: ARAGORN wounded, survives body check; Strike 2: BILBO wins
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);  // ARAGORN wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2); // survives
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12); // BILBO wins

    expect(s.combat).toBeNull();
    // Company has no items → no pending resolution despite wound
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('effect fires once per attack even when two characters are wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: ARAGORN, items: [GLAMDRING] },
              { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const brigandId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    let s = playCreatureHazardAndResolve(ready, PLAYER_2, brigandId, companyId, BORDER_KEYING);

    // Strike 1: ARAGORN wounded, body check 2 → survives (2 < body 9)
    // Strike 2: BILBO wounded, body check 2 → survives (2 < body 4)
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);  // ARAGORN wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2); // survives
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);  // BILBO wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2); // survives

    expect(s.combat).toBeNull();

    // Two characters wounded but effect fires ONCE — one pending resolution
    const pending = s.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('discard-one-company-item');

    // Items from both characters are available as options (2 total)
    const discardActions = viableActions(s, PLAYER_1, 'discard-item-from-company');
    expect(discardActions).toHaveLength(2);
  });

  test('no pending resolution when the only attachments are non-items (Thrall of the Voice) — regression: an unsatisfiable forced discard deadlocked the game', () => {
    // q/d bench seed 10800010: a wounded character bore only permanent events
    // (placed "with" the character, riding in `items`). The enqueue guard
    // counted them as items, enqueued the forced discard, the emitter rightly
    // offered none of them — and no pass either, so neither player had any
    // action and the game deadlocked.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [THRALL_OF_THE_VOICE] }, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const brigandId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    let s = playCreatureHazardAndResolve(ready, PLAYER_2, brigandId, companyId, BORDER_KEYING);

    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);  // ARAGORN wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2); // survives
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12); // BILBO wins

    expect(s.combat).toBeNull();
    // No genuine item in the company → the resolution is not enqueued at all.
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('a queued discard-one-company-item whose last eligible item vanished offers pass, and the pass dismisses it', () => {
    // Backstop for the same deadlock class: the resolution was legally
    // enqueued but the company's only genuine item left play while it waited
    // in the queue. The emitter must offer the pass and the reducer must
    // dequeue on it — with an eligible item present the pass stays rejected
    // (covered implicitly: the choose-item tests never offer a pass).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [THRALL_OF_THE_VOICE] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const seeded = {
      ...ready,
      pendingResolutions: [
        {
          source: null,
          actor: PLAYER_1,
          scope: { kind: 'company-mh-subphase' as const, companyId },
          kind: { type: 'discard-one-company-item' as const, companyId },
          id: 'r-test-1' as (typeof ready.pendingResolutions)[number]['id'],
        },
      ],
    };

    const passes = viableActions(seeded, PLAYER_1, 'pass');
    expect(passes.length).toBeGreaterThan(0);
    const after = dispatch(seeded, passes[0].action);
    expect(after.pendingResolutions).toHaveLength(0);
  });
});
