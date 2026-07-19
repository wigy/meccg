/**
 * @module le-137.test
 *
 * Card test: Shut Yer Mouth (le-137)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 4 (play-target character filter:non-wizard/non-ringwraith,
 *             duplication-limit scope:character max:1,
 *             stat-modifier direct-influence -2 min:0,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:8)
 *
 * "Playable on a non-Wizard, non-Ringwraith character. -2 to character's direct
 *  influence (to a minimum of zero). Once during each of his organization
 *  phases, the character may attempt to remove this card. Make a roll—if the
 *  result is greater than 7, discard this card. Cannot be duplicated on a given
 *  character."
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                      |
 * |---|--------------------------------------|-------------|--------------------------------------------|
 * | 1 | Play from hand targeting char         | IMPLEMENTED | play-hazard with targetCharacterId          |
 * | 2 | Filter: non-wizard, non-ringwraith    | IMPLEMENTED | play-target filter with $ne                 |
 * | 3 | -2 direct influence (min 0)           | IMPLEMENTED | stat-modifier direct-influence value:-2 min:0 |
 * | 4 | Tap to attempt removal (roll>7)       | IMPLEMENTED | grant-action remove-self-on-roll            |
 * | 5 | Cannot be duplicated on character     | IMPLEMENTED | duplication-limit scope:character max:1     |
 *
 * Unlike Rebel-talk (le-132) there is NO mind≤7 filter, so a high-mind
 * character (Aragorn, mind 9) is a legal target here.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  makeMHState, attachHazardToChar,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS, ARAGORN, GIMLI, FARAMIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus,
  charIdAt, dispatch, setCharStatus,
  expectCharStatus, expectInDiscardPile,
  getCharacter, RESOURCE_PLAYER, HAZARD_PLAYER,
  recomputeDerived,
} from '../test-helpers.js';
import type { PlayHazardAction, ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const SHUT_YER_MOUTH = 'le-137' as CardDefinitionId;

describe('Shut Yer Mouth (le-137)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: play-target with filter ─────────────────────────────────────

  test('can be played on non-wizard, non-ringwraith characters', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS, FARAMIR] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [SHUT_YER_MOUTH],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');

    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );
    const legolasId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    const faramirId = charIdAt(mhState, RESOURCE_PLAYER, 0, 1);
    expect(new Set(targets)).toEqual(new Set([legolasId, faramirId]));
  });

  test('cannot be played on a wizard (Gandalf)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [SHUT_YER_MOUTH],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');

    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );
    const gandalfId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    expect(targets).not.toContain(gandalfId);
  });

  test('CAN be played on a high-mind character (Aragorn, mind 9) — no mind cap', () => {
    // Distinguishes le-137 from Rebel-talk (le-132), which caps target mind at 7.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [SHUT_YER_MOUTH],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');

    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );
    const aragornId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    const legolasId = charIdAt(mhState, RESOURCE_PLAYER, 0, 1);

    // Both offered — no mind filter on this card.
    expect(targets).toContain(aragornId);
    expect(targets).toContain(legolasId);
  });

  // ── Effect 2: duplication-limit ───────────────────────────────────────────

  test('cannot be duplicated on the same character', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS, FARAMIR] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [SHUT_YER_MOUTH],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const withSYM = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, SHUT_YER_MOUTH);
    const mhState = { ...withSYM, phaseState: makeMHState() };

    const playActions = viableActions(mhState, PLAYER_2, 'play-hazard');
    const targets = playActions.map(
      ea => (ea.action as PlayHazardAction).targetCharacterId,
    );

    const legolasId = charIdAt(mhState, RESOURCE_PLAYER, 0, 0);
    const faramirId = charIdAt(mhState, RESOURCE_PLAYER, 0, 1);

    // Legolas already has a copy → not a valid target; Faramir still valid.
    expect(targets).not.toContain(legolasId);
    expect(targets).toContain(faramirId);
  });

  // ── Effect 3: stat-modifier direct-influence -2 (min 0) ───────────────────

  test('reduces the bearer direct influence by 2 (Aragorn 3 → 1)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Baseline DI before the hazard.
    expect(getCharacter(base, RESOURCE_PLAYER, ARAGORN).effectiveStats.directInfluence).toBe(3);

    const withSYM = recomputeDerived(
      attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, SHUT_YER_MOUTH),
    );
    expect(getCharacter(withSYM, RESOURCE_PLAYER, ARAGORN).effectiveStats.directInfluence).toBe(1);
  });

  test('reduces DI to exactly zero (Legolas 2 → 0)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(base, RESOURCE_PLAYER, LEGOLAS).effectiveStats.directInfluence).toBe(2);

    const withSYM = recomputeDerived(
      attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, SHUT_YER_MOUTH),
    );
    expect(getCharacter(withSYM, RESOURCE_PLAYER, LEGOLAS).effectiveStats.directInfluence).toBe(0);
  });

  test('DI is floored at zero, never negative (Faramir 1 → 0, not -1)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FARAMIR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(base, RESOURCE_PLAYER, FARAMIR).effectiveStats.directInfluence).toBe(1);

    const withSYM = recomputeDerived(
      attachHazardToChar(base, RESOURCE_PLAYER, FARAMIR, SHUT_YER_MOUTH),
    );
    // -2 from base 1 clamps to 0, not -1.
    expect(getCharacter(withSYM, RESOURCE_PLAYER, FARAMIR).effectiveStats.directInfluence).toBe(0);
  });

  // ── Effect 4: grant-action remove-self-on-roll ────────────────────────────

  test('untapped bearer gets exactly one remove action (tap to roll, threshold 8)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withSYM = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, SHUT_YER_MOUTH);
    const actions = viableActions(withSYM, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const act = actions[0].action as ActivateGrantedAction;
    expect(act.actionId).toBe('remove-self-on-roll');
    expect(act.noTap).toBeFalsy();
    expect(act.rollThreshold).toBe(8);
  });

  test('tapped bearer cannot activate remove-self-on-roll', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withSYM = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, SHUT_YER_MOUTH);
    const tapped = setCharStatus(withSYM, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);

    const actions = viableActions(tapped, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(0);
  });

  test('successful removal roll (>7) discards Shut Yer Mouth and taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Attach with the hazard owned by the opponent (player 2) so it discards to their pile.
    const withSYM = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, SHUT_YER_MOUTH, HAZARD_PLAYER);
    const cheated = { ...withSYM, cheatRollTotal: 8 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const next = dispatch(cheated, actions[0].action);

    expectCharStatus(next, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);

    const legolasId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[legolasId].hazards).toHaveLength(0);

    expectInDiscardPile(next, HAZARD_PLAYER, SHUT_YER_MOUTH);
  });

  test('failed removal roll (≤7) keeps Shut Yer Mouth attached and taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withSYM = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, SHUT_YER_MOUTH, HAZARD_PLAYER);
    const cheated = { ...withSYM, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const next = dispatch(cheated, actions[0].action);

    expectCharStatus(next, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);

    const legolasId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[legolasId].hazards).toHaveLength(1);
    expect(next.players[0].characters[legolasId].hazards[0].definitionId).toBe(SHUT_YER_MOUTH);

    expect(next.players[1].discardPile.some(c => c.definitionId === SHUT_YER_MOUTH)).toBe(false);
  });
});
