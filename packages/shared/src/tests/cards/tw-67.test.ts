/**
 * @module tw-67.test
 *
 * Card test: Muster Disperses (tw-67)
 * Type: hazard-event (short)
 *
 * "Playable on a faction. The faction's player makes a roll. The faction is
 *  discarded if the result plus his unused general influence is less than
 *  11."
 *
 * Engine support:
 * - play-target: faction — any faction in the resource player's cardsInPlay
 * - Generic faction-targeting short-event dice-check (chain-reducer.ts):
 *   roll + unused GI >= 11 keeps the faction, otherwise it is discarded
 * - Rule 1.55 / 1.56 (CoE 1.12.R1 / 1.12.B1): a Ringwraith or Balrog resource
 *   player's "unused general influence" for this check includes their flat
 *   +5 bonus that "cannot be used to control characters ... added on top of
 *   available general influence"
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  makeMHState,
  handCardId, mint, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment, CardStatus,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase } from '../../index.js';
import type { GameState, CardDefinitionId, PlayHazardAction, ResolveDiceCheckAction } from '../../index.js';

const MUSTER_DISPERSES = 'tw-67' as CardDefinitionId;
const EASTERLINGS = 'le-264' as CardDefinitionId; // minion-resource-faction

// Minion-side fixtures (LE set) — minds sum to exactly 20, fully committing
// the base general-influence pool: GORBAG(6) + ORC_CAPTAIN(5) + ASTERNAK(5)
// + ERADAN(4) = 20.
const GORBAG = 'le-11' as CardDefinitionId;       // orc, mind 6
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;  // orc, mind 5
const ASTERNAK = 'le-1' as CardDefinitionId;      // man, mind 5
const ERADAN = 'le-10' as CardDefinitionId;       // man, mind 4
const LAGDUF = 'le-18' as CardDefinitionId;       // orc, mind 3

// Minion havens (siteDeck filler)
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const MORIA_LE = 'le-392' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

function buildMusterState(): GameState {
  // Fully committed general influence (recompute sums the company's printed
  // minds): unused GI from the base 20-point pool is 0, so only the minion's
  // flat +5 (rule 1.55) can push the roll over threshold.
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [GORBAG, ORC_CAPTAIN, ASTERNAK, ERADAN] }],
        hand: [],
        siteDeck: [MORIA_LE],
        cardsInPlay: [{ instanceId: mint(), definitionId: EASTERLINGS, status: CardStatus.Untapped }],
      },
      { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [MUSTER_DISPERSES], siteDeck: [CARN_DUM] },
    ],
  });
}

describe('Muster Disperses (tw-67)', () => {
  beforeEach(() => resetMint());

  test('[MINION] a Ringwraith resource player\'s flat +5 general influence (rule 1.55) saves the faction', () => {
    // Reproduces a bug report (game msakbfw9-ytbc1s, stateSeq 1523): the
    // engine rolled 5+3=8 for a Ringwraith player with 0 unused GI from the
    // base pool and discarded the targeted faction (8 < 11) — the flat +5
    // minion bonus (CoE 1.12.R1) was never added to the "unused-gi" dice-check
    // modifier, so it could never save a faction whose owner had spent his
    // entire base pool.
    const state = buildMusterState();
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const musterId = handCardId(mhState, HAZARD_PLAYER);
    expect(musterId).toBeDefined();

    const actions = computeLegalActions(mhState, PLAYER_2)
      .filter(a => a.viable && a.action.type === 'play-hazard');
    expect(actions).toHaveLength(1);
    const playAction = actions[0].action as PlayHazardAction;
    expect(playAction.targetFactionInstanceId).toBeDefined();

    let s = dispatch(mhState, playAction);
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('dice-check');

    // Roll 6: without the minion's +5, 6 + 0 unused GI = 6 < 11 → discarded.
    // With the +5 (rule 1.55), 6 + 0 + 5 = 11 >= 11 → survives.
    s = { ...s, cheatRollTotal: 6 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expect(s.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === EASTERLINGS)).toBe(true);
    expect(s.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === EASTERLINGS)).toBe(false);
  });
});
