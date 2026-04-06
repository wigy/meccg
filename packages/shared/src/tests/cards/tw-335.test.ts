/**
 * @module tw-335.test
 *
 * Card test: Sun (tw-335)
 * Type: hero-resource-event (long, environment)
 * Effects: 4 (duplication-limit, 3 stat-modifiers)
 *
 * "Environment. The prowess of each Dúnadan is modified by +1.
 *  Additionally, if Gates of Morning is in play, the prowess of each
 *  automatic-attack and hazard creature is modified by -1 and the prowess
 *  of each Man and Dúnadan is modified by +1. Cannot be duplicated."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  reduce,
  Phase,
  ARAGORN, LEGOLAS, BARD_BOWMAN,
  SUN, GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState,
  findCharInstanceId,
  playLongEventAndResolve,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, CharacterCard, GameState, SitePhaseState } from '../../index.js';
import { ISENGARD } from '../../index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get a character card definition's base prowess from the card pool. */
function baseProwess(defId: CardDefinitionId): number {
  return (pool[defId as string] as CharacterCard).prowess;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Sun (tw-335)', () => {
  beforeEach(() => resetMint());

  test('Dúnadan prowess +1 when Sun is in play', () => {
    // Aragorn is a dunadan — should get +1 prowess from Sun
    // Legolas is an elf — should be unaffected
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sunInstanceId = state.players[0].hand[0].instanceId;
    const s = playLongEventAndResolve(state, PLAYER_1, sunInstanceId);

    expect(s.players[0].characters[findCharInstanceId(s, 0, ARAGORN)].effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
    expect(s.players[1].characters[findCharInstanceId(s, 1, LEGOLAS)].effectiveStats.prowess).toBe(baseProwess(LEGOLAS));
  });

  test('with Gates of Morning: Man and Dúnadan prowess +1 additional', () => {
    // Sun alone: Dúnadan +1, Man +0
    // Sun + Gates of Morning: Dúnadan +2, Man +1
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, BARD_BOWMAN] }], hand: [SUN], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sunInstanceId = state.players[0].hand[0].instanceId;
    const s = playLongEventAndResolve(state, PLAYER_1, sunInstanceId);

    // Aragorn (dunadan): +1 unconditional + +1 with GoM = +2
    expect(s.players[0].characters[findCharInstanceId(s, 0, ARAGORN)].effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 2);
    // Bard Bowman (man): +1 with GoM
    expect(s.players[0].characters[findCharInstanceId(s, 0, BARD_BOWMAN)].effectiveStats.prowess).toBe(baseProwess(BARD_BOWMAN) + 1);
    // Legolas (elf): unaffected
    expect(s.players[1].characters[findCharInstanceId(s, 1, LEGOLAS)].effectiveStats.prowess).toBe(baseProwess(LEGOLAS));
  });

  test('affects opponent characters too', () => {
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-pre' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA], cardsInPlay: [sunInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Pass to trigger recomputeDerived
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // P2's Aragorn (dunadan) should get +1 from P1's Sun
    const s = result.state;
    expect(s.players[1].characters[findCharInstanceId(s, 1, ARAGORN)].effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
  });

  test('body and direct influence are not modified', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sunInstanceId = state.players[0].hand[0].instanceId;
    const s = playLongEventAndResolve(state, PLAYER_1, sunInstanceId);

    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    const stats = s.players[0].characters[findCharInstanceId(s, 0, ARAGORN)].effectiveStats;
    expect(stats.body).toBe(aragornDef.body);
    expect(stats.directInfluence).toBe(aragornDef.directInfluence);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-pre' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MORIA], cardsInPlay: [sunInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sunInstanceId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-long-event', player: PLAYER_1, cardInstanceId: sunInstanceId });
    expect(result.error).toBe('Sun cannot be duplicated');
  });

  test('cannot be duplicated when opponent has a copy in play', () => {
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-opp' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [sunInPlay] },
      ],
    });

    const sunInstanceId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-long-event', player: PLAYER_1, cardInstanceId: sunInstanceId });
    expect(result.error).toBe('Sun cannot be duplicated');
  });

  test('with Gates of Morning: automatic attack prowess reduced by -1', () => {
    // Isengard has Wolves automatic attack: 3 strikes, 7 prowess
    // With Sun + Gates of Morning, attack prowess should be 7 - 1 = 6
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-1' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildSitePhaseState({ site: ISENGARD });
    // Add Sun and GoM to player 1's cardsInPlay
    const players = state.players.map((p, i) =>
      i === 0 ? { ...p, cardsInPlay: [...p.cardsInPlay, gomInPlay, sunInPlay] } : p,
    ) as [typeof state.players[0], typeof state.players[1]];

    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, players, phaseState: autoAttackState };

    // Pass to trigger the automatic attack combat
    const result = reduce(readyState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(3);
    // Prowess reduced from 7 to 6 by Sun's all-attacks effect
    expect(result.state.combat!.strikeProwess).toBe(6);
  });

  test('without Gates of Morning: automatic attack prowess is unchanged', () => {
    // Without GoM, Sun's all-attacks effect should not apply
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-1' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildSitePhaseState({ site: ISENGARD });
    const players = state.players.map((p, i) =>
      i === 0 ? { ...p, cardsInPlay: [...p.cardsInPlay, sunInPlay] } : p,
    ) as [typeof state.players[0], typeof state.players[1]];

    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, players, phaseState: autoAttackState };

    const result = reduce(readyState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    // Prowess unchanged at 7 — Sun's all-attacks effect requires GoM
    expect(result.state.combat!.strikeProwess).toBe(7);
  });
});
