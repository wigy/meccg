/**
 * @module dm-57.test
 *
 * Card test: Faces of the Dead (dm-57)
 * Type: hazard-event (short)
 *
 * "Playable on a non-Wizard character moving with at least two Wildernesses
 *  [{w}] in his site path if you discard any Undead hazard creature from your
 *  hand (show opponent). Target character's player makes a roll and adds
 *  character's mind. If the result is less than 13, that character splits off
 *  into a different company. This new company immediately returns to his
 *  original company's site of origin."
 *
 * Card shape:
 *   - effects[0]: play-condition (requires site-path, wildernessCount >= 2)
 *   - effects[1]: play-discard-cost (discard an Undead hazard creature from
 *                 hand, revealed to opponent)
 *   - effects[2]: play-target (character, non-wizard)
 *   - effects[3]: seized-by-terror-check (threshold 13)
 *
 * Engine support:
 *   - play-condition site-path: requires at least two Wildernesses in the path
 *   - play-discard-cost: only playable if a matching Undead hazard creature is
 *     in hand; one action per (character × matching cost card); on play the
 *     chosen creature is discarded and its identity revealed to the opponent
 *   - play-target character filter: excludes wizards
 *   - seized-by-terror-check threshold:13 — roll + mind < 13 splits the
 *     character into a new company at the site of origin (shared machinery
 *     with Seized by Terror dm-88, which uses threshold 12)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState,
  P1_COMPANY,
  charIdAt, findCharInstanceId, findHandCardId, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, RegionType } from '../../index.js';
import type { GameState, CardDefinitionId, PlayHazardAction, SeizedByTerrorRollAction } from '../../index.js';

const FACES_OF_THE_DEAD = 'dm-57' as CardDefinitionId;

/** Viable play-hazard actions for the Faces of the Dead card specifically. */
function facesActions(state: GameState) {
  const facesId = findHandCardId(state, HAZARD_PLAYER, FACES_OF_THE_DEAD);
  return computeLegalActions(state, PLAYER_2)
    .filter(a => a.viable && a.action.type === 'play-hazard'
      && a.action.cardInstanceId === facesId)
    .map(a => a.action as PlayHazardAction);
}

/** A two-wilderness travel path that satisfies the play-condition. */
function twoWildernessMH(state: GameState): GameState {
  return { ...state, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness] }) };
}

describe('Faces of the Dead (dm-57)', () => {
  beforeEach(() => resetMint());

  test('NOT playable when the site path has fewer than two Wildernesses', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [FACES_OF_THE_DEAD, BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Only one wilderness in the path — the play-condition (>= 2) is not met.
    const mhState: GameState = { ...state, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    expect(facesActions(mhState)).toHaveLength(0);
  });

  test('NOT playable without an Undead hazard creature in hand to discard', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        // No Undead creature in hand — the discard cost cannot be paid.
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [FACES_OF_THE_DEAD], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(facesActions(twoWildernessMH(state))).toHaveLength(0);
  });

  test('playable on each non-wizard character when path has two Wildernesses and an Undead creature is in hand', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [FACES_OF_THE_DEAD, BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = twoWildernessMH(state);
    const actions = facesActions(s);
    // One action per eligible character (Aragorn + Legolas), each carrying both
    // the target character and the chosen cost card to discard.
    expect(actions).toHaveLength(2);
    const barrowId = findHandCardId(s, HAZARD_PLAYER, BARROW_WIGHT);
    expect(actions.every(a => a.targetCharacterId !== undefined)).toBe(true);
    expect(actions.every(a => a.costDiscardInstanceId === barrowId)).toBe(true);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect(actions.map(a => a.targetCharacterId).sort()).toEqual([aragornId, legolasId].sort());
  });

  test('NOT playable on a wizard character (Gandalf filtered out)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [FACES_OF_THE_DEAD, BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = facesActions(twoWildernessMH(state));
    // Only Aragorn is eligible — Gandalf (wizard) is filtered out.
    expect(actions).toHaveLength(1);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(actions[0].targetCharacterId).toBe(aragornId);
  });

  test('playing the card discards the chosen Undead creature and reveals it to the opponent', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [FACES_OF_THE_DEAD, BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s0 = twoWildernessMH(state);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const facesId = findHandCardId(s0, HAZARD_PLAYER, FACES_OF_THE_DEAD);
    const barrowId = findHandCardId(s0, HAZARD_PLAYER, BARROW_WIGHT);

    const s = dispatch(s0, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: facesId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: aragornId,
      costDiscardInstanceId: barrowId,
    });

    // The Undead creature and the event both leave the hazard player's hand.
    const hazardHand = s.players[HAZARD_PLAYER].hand.map(c => c.instanceId);
    expect(hazardHand).not.toContain(barrowId);
    expect(hazardHand).not.toContain(facesId);
    // The Undead creature is in the hazard player's discard pile.
    expect(s.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).toContain(barrowId);
    // "show opponent" — the discarded creature's identity is revealed.
    expect(s.revealedInstances[barrowId]).toBe(BARROW_WIGHT);
  });

  test('enqueues a seized-by-terror-roll pending resolution after the chain resolves', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [FACES_OF_THE_DEAD, BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s0 = twoWildernessMH(state);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const facesId = findHandCardId(s0, HAZARD_PLAYER, FACES_OF_THE_DEAD);
    const barrowId = findHandCardId(s0, HAZARD_PLAYER, BARROW_WIGHT);

    let s = dispatch(s0, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: facesId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: aragornId,
      costDiscardInstanceId: barrowId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    const kind = s.pendingResolutions[0].kind;
    expect(kind.type).toBe('seized-by-terror-roll');
    expect(kind.type === 'seized-by-terror-roll' && kind.threshold).toBe(13);
  });

  test('character stays when roll + mind >= 13', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [FACES_OF_THE_DEAD, BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Aragorn mind=9; threshold=13; need roll >= 4 to pass.
    const s0 = twoWildernessMH(state);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const facesId = findHandCardId(s0, HAZARD_PLAYER, FACES_OF_THE_DEAD);
    const barrowId = findHandCardId(s0, HAZARD_PLAYER, BARROW_WIGHT);

    let s = dispatch(s0, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: facesId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: aragornId,
      costDiscardInstanceId: barrowId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    // Force a roll of 4: 4 + 9 = 13 >= 13 → passes, character stays.
    s = { ...s, cheatRollTotal: 4 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'seized-by-terror-roll');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action as SeizedByTerrorRollAction);

    const company = s.players[RESOURCE_PLAYER].companies.find(c => c.id === P1_COMPANY);
    expect(company!.characters).toContain(aragornId);
    expect(s.players[RESOURCE_PLAYER].companies).toHaveLength(1);
  });

  test('character splits into a new company at the site of origin when roll + mind < 13', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [FACES_OF_THE_DEAD, BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Aragorn mind=9; threshold=13; roll of 3 → 12 < 13 fails.
    const s0 = twoWildernessMH(state);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const facesId = findHandCardId(s0, HAZARD_PLAYER, FACES_OF_THE_DEAD);
    const barrowId = findHandCardId(s0, HAZARD_PLAYER, BARROW_WIGHT);

    let s = dispatch(s0, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: facesId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: aragornId,
      costDiscardInstanceId: barrowId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    s = { ...s, cheatRollTotal: 3 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'seized-by-terror-roll');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action as SeizedByTerrorRollAction);

    // Original company keeps Legolas but not Aragorn.
    const original = s.players[RESOURCE_PLAYER].companies.find(c => c.id === P1_COMPANY);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect(original!.characters).not.toContain(aragornId);
    expect(original!.characters).toContain(legolasId);

    // A new company holds Aragorn and stays at the site of origin (no destination).
    expect(s.players[RESOURCE_PLAYER].companies).toHaveLength(2);
    const newCompany = s.players[RESOURCE_PLAYER].companies.find(c => c.id !== P1_COMPANY);
    expect(newCompany!.characters).toContain(aragornId);
    expect(newCompany!.destinationSite).toBeNull();

    // Aragorn is still in play (not discarded).
    expect(s.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
  });
});
