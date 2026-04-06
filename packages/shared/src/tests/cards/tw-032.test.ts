/**
 * @module tw-032.test
 *
 * Card test: Eye of Sauron (tw-32)
 * Type: hazard-event (long)
 * Effects: 2 (stat-modifier with id, stat-modifier override with Doors of Night condition)
 *
 * "The prowess of each automatic-attack is increased by one. Alternatively,
 *  if Doors of Night is in play, the prowess of each automatic-attack is
 *  increased by three."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce, Phase,
  ARAGORN, LEGOLAS,
  EYE_OF_SAURON, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState,
  makeMHState, P1_COMPANY,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, GameState, SitePhaseState } from '../../index.js';
import { ISENGARD } from '../../index.js';

// ─── Helpers ──────────���───────────────────────────────────────────────────────

/** Play a hazard card during M/H phase and resolve the chain (both pass). */
function playHazardAndResolve(
  state: GameState,
  player: typeof PLAYER_1,
  cardInstanceId: CardInstanceId,
  targetCompanyId: typeof P1_COMPANY,
): GameState {
  let result = reduce(state, { type: 'play-hazard', player, cardInstanceId, targetCompanyId });
  expect(result.error).toBeUndefined();
  const opponent = player === PLAYER_1 ? PLAYER_2 : PLAYER_1;
  result = reduce(result.state, { type: 'pass-chain-priority', player: opponent });
  expect(result.error).toBeUndefined();
  result = reduce(result.state, { type: 'pass-chain-priority', player });
  expect(result.error).toBeUndefined();
  return result.state;
}

/**
 * Build a state in the site phase automatic-attacks step with Eye of Sauron
 * already in play as a hazard long-event.
 */
function buildAutoAttackState(opts?: {
  /** Additional cards in play for player 2 (the hazard player). */
  extraP2CardsInPlay?: CardInPlay[];
}) {
  const eosInPlay: CardInPlay = {
    instanceId: 'eos-1' as CardInstanceId,
    definitionId: EYE_OF_SAURON,
    status: CardStatus.Untapped,
  };

  const state = buildSitePhaseState({ site: ISENGARD });
  const players = state.players.map((p, i) =>
    i === 1
      ? { ...p, cardsInPlay: [...p.cardsInPlay, eosInPlay, ...(opts?.extraP2CardsInPlay ?? [])] }
      : p,
  ) as [typeof state.players[0], typeof state.players[1]];

  const autoAttackState: SitePhaseState = {
    ...state.phaseState,
    step: 'automatic-attacks',
    siteEntered: false,
    automaticAttacksResolved: 0,
  };
  return { ...state, players, phaseState: autoAttackState };
}

// ─── Tests ──────────��──────────────────────────��──────────────────────────────

describe('Eye of Sauron (tw-32)', () => {
  beforeEach(() => resetMint());

  test('can be played as a hazard long-event during M/H play-hazards step', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const eosId = mhGameState.players[1].hand[0].instanceId;
    const s = playHazardAndResolve(mhGameState, PLAYER_2, eosId, P1_COMPANY);

    // Eye of Sauron should now be in hazard player's cardsInPlay
    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[1].cardsInPlay[0].definitionId).toBe(EYE_OF_SAURON);
    expect(s.players[1].hand).toHaveLength(0);
  });

  test('automatic attack prowess increased by +1 when Eye of Sauron is in play', () => {
    // Isengard has Wolves automatic attack: 3 strikes, 7 prowess
    // With Eye of Sauron, attack prowess should be 7 + 1 = 8
    const readyState = buildAutoAttackState();

    const result = reduce(readyState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(3); // Strikes unchanged
    expect(result.state.combat!.strikeProwess).toBe(8); // 7 + 1
  });

  test('automatic attack prowess increased by +3 when Doors of Night is also in play', () => {
    // "Alternatively, if Doors of Night is in play, the prowess of each
    //  automatic-attack is increased by three."
    // Isengard Wolves: 7 prowess → 7 + 3 = 10
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const readyState = buildAutoAttackState({ extraP2CardsInPlay: [donInPlay] });

    const result = reduce(readyState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(3); // Strikes unchanged
    // +3 overrides +1 when Doors of Night is in play
    expect(result.state.combat!.strikeProwess).toBe(10); // 7 + 3
  });

  test('does not affect hazard creature prowess (only automatic-attacks)', () => {
    // Eye of Sauron uses target "all-automatic-attacks", not "all-attacks".
    // Verify the card definition's effects use the correct target scope.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // All effects on Eye of Sauron should target "all-automatic-attacks", not "all-attacks"
    const eosDef = state.cardPool[EYE_OF_SAURON as string] as { effects?: Array<{ type: string; target?: string }> };
    expect(eosDef.effects).toBeDefined();
    for (const effect of eosDef.effects!) {
      if (effect.type === 'stat-modifier') {
        expect(effect.target).toBe('all-automatic-attacks');
      }
    }
  });

  test('is discarded at end of long-event phase (hazard long-event lifecycle)', () => {
    // Hazard long-events persist until the opponent's long-event phase,
    // at which point they are discarded.
    const eosInPlay: CardInPlay = {
      instanceId: 'eos-1' as CardInstanceId,
      definitionId: EYE_OF_SAURON,
      status: CardStatus.Untapped,
    };

    // Build state in long-event phase with EoS already in P2's cardsInPlay
    // P1 is active (resource player), P2 is hazard player
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [eosInPlay] },
      ],
    });

    // P1 passes the long-event phase → hazard player's long-events are discarded
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    // P2's cardsInPlay should be empty, EoS moved to discard
    expect(result.state.players[1].cardsInPlay).toHaveLength(0);
    expect(result.state.players[1].discardPile.some(c => c.definitionId === EYE_OF_SAURON)).toBe(true);
  });
});
