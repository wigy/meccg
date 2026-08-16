/**
 * @module tw-111.test
 *
 * Card test: Weariness of the Heart (tw-111)
 * Type: hazard-event (short, character-targeting), keyword Corruption
 * Effects: 3
 *   1. play-target character
 *   2. play-option "prowess" — add-constraint character-stat-modifier
 *      prowess -1 (scope turn)
 *   3. play-option "corruption" — force-check corruption
 *
 * Card text: "Playable on a character. The prowess of target character is
 *  modified by -1 until the end of the turn. This use cannot be duplicated on
 *  a given character. Alternatively, target character makes a corruption
 *  check."
 *
 * The hazard player chooses one of two mutually-exclusive modes when playing
 * the card. Mode "prowess" attaches a turn-scoped −1 prowess modifier to the
 * targeted character; mode "corruption" enqueues a corruption check on the
 * targeted character. Because the card carries the Corruption keyword, CoE
 * rule 7.2.1 ("only one corruption card per character per turn") subsumes the
 * "this use cannot be duplicated on a given character" restriction: once the
 * card is played on a character (in either mode) no further corruption card —
 * including a second copy of this one — may be played on that character this
 * turn. Identical text/shape to Weariness of the Heart (le-149), certified
 * 2026-06-16.
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                                       |
 * |---|--------------------------------------------|-------------|---------------------------------------------|
 * | 1 | Play from hand on a character (both modes) | IMPLEMENTED | play-hazard per (character, option)         |
 * | 2 | −1 prowess until end of turn               | IMPLEMENTED | character-stat-modifier, scope turn         |
 * | 3 | Alternatively: corruption check             | IMPLEMENTED | force-check corruption on chain resolution  |
 * | 4 | Cannot be duplicated on a given character  | IMPLEMENTED | corruption keyword → CoE 7.2.1 per-char lock |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, recomputeDerived,
  viableActions,
  dispatch,
  resolveChain,
  handCardId,
  findCharInstanceId,
  getCharacter,
  companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, PlayHazardAction, CardInstanceId, GameState } from '../../index.js';

const WEARINESS_OF_THE_HEART = 'tw-111' as CardDefinitionId;

/**
 * Build an M/H state with PLAYER_1 (resource) active at Moria with Aragorn and
 * Legolas, and PLAYER_2 (hazard) holding `copies` copies of Weariness of the
 * Heart. The hazard player targets the active (resource) company.
 */
function buildWeariness(copies = 1) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: Array.from({ length: copies }, () => WEARINESS_OF_THE_HEART),
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...base, phaseState: makeMHState() };
}

/** All viable Weariness play-hazard actions targeting a specific character. */
function wearinessActionsFor(
  state: GameState,
  targetCharId: CardInstanceId,
): PlayHazardAction[] {
  return viableActions(state, PLAYER_2, 'play-hazard')
    .map(a => a.action as unknown as PlayHazardAction)
    .filter(a => a.targetCharacterId === targetCharId);
}

describe('Weariness of the Heart (tw-111)', () => {
  beforeEach(() => resetMint());

  test('offers both modes (prowess / corruption) on each character in the active company', () => {
    const state = buildWeariness();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const aragornActions = wearinessActionsFor(state, aragornId);
    const legolasActions = wearinessActionsFor(state, legolasId);

    expect(aragornActions.map(a => a.optionId).sort()).toEqual(['corruption', 'prowess']);
    expect(legolasActions.map(a => a.optionId).sort()).toEqual(['corruption', 'prowess']);
  });

  test('prowess mode reduces target prowess by 1 until end of turn (no corruption check)', () => {
    const state = buildWeariness();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const baseProwess = getCharacter(recomputeDerived(state), RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: companyId,
      targetCharacterId: aragornId,
      optionId: 'prowess',
    });
    const resolved = resolveChain(afterPlay);

    // A turn-scoped character-stat-modifier constraint targets Aragorn.
    const constraint = resolved.activeConstraints.find(
      c => c.kind.type === 'character-stat-modifier'
        && (c.kind as { characterId: CardInstanceId }).characterId === aragornId,
    );
    expect(constraint).toBeDefined();
    expect((constraint!.kind as { stat: string; value: number }).stat).toBe('prowess');
    expect((constraint!.kind as { stat: string; value: number }).value).toBe(-1);
    expect(constraint!.scope.kind).toBe('turn');

    // Effective prowess is reduced by 1; Legolas is unaffected.
    expect(getCharacter(resolved, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess - 1);

    // Prowess mode does NOT trigger a corruption check.
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'corruption-check')).toBe(false);
  });

  test('corruption mode enqueues a corruption check on the target (no prowess modifier)', () => {
    const state = buildWeariness();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: companyId,
      targetCharacterId: aragornId,
      optionId: 'corruption',
    });
    const resolved = resolveChain(afterPlay);

    const check = resolved.pendingResolutions.find(
      r => r.kind.type === 'corruption-check'
        && (r.kind as { characterId?: CardInstanceId }).characterId === aragornId,
    );
    expect(check).toBeDefined();

    // No prowess modifier was attached.
    expect(resolved.activeConstraints.some(
      c => c.kind.type === 'character-stat-modifier'
        && (c.kind as { characterId: CardInstanceId }).characterId === aragornId,
    )).toBe(false);
  });

  test('cannot be played a second time on a character it already hit this turn', () => {
    const state = buildWeariness(2);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const firstCopy = handCardId(state, HAZARD_PLAYER, 0);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: firstCopy,
      targetCompanyId: companyId,
      targetCharacterId: aragornId,
      optionId: 'prowess',
    });
    const resolved = resolveChain(afterPlay);

    // The second copy may not be played on Aragorn (already a corruption-card
    // target this turn) but is still playable on Legolas.
    expect(wearinessActionsFor(resolved, aragornId)).toHaveLength(0);
    expect(wearinessActionsFor(resolved, legolasId).length).toBeGreaterThan(0);
  });
});
