/**
 * @module le-64.test
 *
 * Card test: Brigands (le-64)
 * Type: hazard-creature
 * Race: man
 * Stats: prowess 8, strikes 2, kill-marshalling-points 1
 * Keyed to: wilderness {w} or border-land {b}
 *
 * "Men. Two strikes. If any strike of Brigands wounds a character, the
 *  company must immediately discard one item (of defender's choice)."
 *
 * le-64 is the **Lidless Eye printing** of Brigands: same name, same text,
 * same 8 prowess / 2 strikes / 1 kill-MP and the same wilderness/border
 * keying as tw-17 (verified against `data/cards.json` — TW-17 and LE-64 are
 * identical but for the artwork). Its data carried the stats and the keying
 * but not the effect, so this printing attacked and then simply stopped: a
 * wounded character cost the company nothing.
 *
 * Rule coverage:
 *
 * | # | Rule                                              | Status | Notes                                      |
 * |---|---------------------------------------------------|--------|--------------------------------------------|
 * | 1 | Men, two strikes, 8 prowess, wilderness/border    | OK     | printed stats + `keyedTo` regionTypes      |
 * | 2 | A wound forces the company to discard one item    | FIXED  | `on-event: character-wounded-by-self` →     |
 * |   |   (defender's choice)                             |        | `force-discard-one-company-item`           |
 *
 * The shared implementation's edges — the effect firing once per attack
 * rather than once per wound, the no-items case, and resource-events riding
 * in `items` never being valid targets — are pinned by tw-17's test.
 *
 * Playable: FULLY — CERTIFIED (2026-08-18).
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
  viableActions, expectCharItemCount,
  executeAction,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const BRIGANDS_LE = 'le-64' as CardDefinitionId;
const BORDER_KEYING = { method: 'region-type' as const, value: 'border' };

describe('Brigands (le-64)', () => {
  beforeEach(() => resetMint());

  test('combat initiates with 2 strikes and prowess 8 when keyed to a border-land', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS_LE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(8);
    expect(afterChain.combat!.creatureRace).toBe('man');
  });

  test('a wounded character forces the company to discard one item, chosen by the defender', () => {
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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS_LE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    let s = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);   // Aragorn wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);  // survives the body check
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);  // Bilbo beats his strike

    expect(s.combat).toBeNull();
    const pending = s.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('discard-one-company-item');

    // Both of the company's items are offered — the choice is the defender's.
    const choices = viableActions(s, PLAYER_1, 'discard-item-from-company');
    expect(choices).toHaveLength(2);

    const chosen = choices[0].action;
    const chosenInstanceId = (chosen as { itemInstanceId: string }).itemInstanceId;
    const after = dispatch(s, chosen);

    expectCharItemCount(after, RESOURCE_PLAYER, ARAGORN, 1);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(chosenInstanceId);
    expect(after.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('no wound, no discard — the company keeps its items', () => {
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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS_LE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    let s = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);  // both characters beat their strikes
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    expect(s.combat).toBeNull();
    expect(s.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
    expectCharItemCount(s, RESOURCE_PLAYER, ARAGORN, 1);
  });
});
