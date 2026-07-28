/**
 * @module tw-205.test
 *
 * Card test: Cracks of Doom (tw-205)
 * Type: hero-resource-event (short, wizard alignment)
 * Effects:
 *   1. play-window: phase "site" — only playable during the site phase
 *   2. play-condition: active-company — The One Ring must be in the active
 *      company at Mount Doom
 *   3. play-target: character bearing The One Ring (the corruption-check target)
 *   4. on-event: self-enters-play → enqueue-corruption-check (modifier -4,
 *      onSuccess: win-game with destroysOneRing) — a successful −4 corruption
 *      check on the Ring's bearer destroys The One Ring (removed from the
 *      game, to the out-of-play pile) and wins the game (CoE rule 10.39);
 *      failure runs the standard corruption consequence.
 *
 * Card text: "Only playable if The One Ring is at Mount Doom during the site
 * phase. Its bearer must make a corruption check modified by -4. If
 * successful, The One Ring is destroyed and its bearer's player wins.
 * Cannot be included in a Fallen-wizard's deck."
 *
 * The deck-construction clause is enforced by `validateDeck`
 * (`deck-validation.ts` `FALLEN_WIZARD_BANNED_CARD_IDS`, rule 1.18), covered
 * by the last test below.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, LORIEN,
  resetMint, buildSitePhaseState,
  dispatch, handCardId, findCharInstanceId, viableActions,
  Phase, RESOURCE_PLAYER, expectCharNotInPlay,
  getCharacter, expectInPile, assertEveryInstanceReachable,
  pool, HAZARD_CREATURES_12,
} from '../test-helpers.js';
import type {
  CardDefinitionId, PlayShortEventAction, GameOverPhaseState, GameState, DeckList,
} from '../../index.js';
import { validateDeck } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const CRACKS_OF_DOOM = 'tw-205' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;
const FRODO = 'tw-152' as CardDefinitionId;
const MOUNT_DOOM = 'tw-414' as CardDefinitionId;

const playShortEventActions = (state: GameState, eventInstance: string) =>
  computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable && ea.action.type === 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === eventInstance);

describe('Cracks of Doom (tw-205)', () => {
  beforeEach(() => resetMint());

  test('not playable when The One Ring is not at Mount Doom', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [CRACKS_OF_DOOM],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    expect(playShortEventActions(state, eventInstance as string)).toHaveLength(0);
  });

  test('not playable at Mount Doom without The One Ring', () => {
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [FRODO],
      hand: [CRACKS_OF_DOOM],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    expect(playShortEventActions(state, eventInstance as string)).toHaveLength(0);
  });

  test('playable at Mount Doom with The One Ring, targeting the bearer', () => {
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [CRACKS_OF_DOOM],
    });
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const actions = playShortEventActions(state, eventInstance as string);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCharacterId).toBe(frodoId);
  });

  test('playing enqueues a corruption check on the bearer', () => {
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [CRACKS_OF_DOOM],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const after = dispatch(state, playShortEventActions(state, eventInstance as string)[0]);
    expect(after.pendingResolutions.some(r => r.kind.type === 'corruption-check')).toBe(true);
  });

  test('successful −4 corruption check wins the game', () => {
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [CRACKS_OF_DOOM],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const afterPlay = dispatch(state, playShortEventActions(state, eventInstance as string)[0]);

    // Ring CP 6, modifier −4 → need a die total of 11+ to pass (11 − 4 = 7 > 6).
    const ccAction = viableActions(afterPlay, PLAYER_1, 'corruption-check')[0].action;
    const after = dispatch({ ...afterPlay, cheatRollTotal: 12 }, ccAction);

    expect(after.phaseState.phase).toBe(Phase.GameOver);
    const go = after.phaseState as GameOverPhaseState;
    expect(go.winner).toBe(PLAYER_1);
    expect(go.winReason.kind).toBe('one-ring');
    if (go.winReason.kind === 'one-ring') {
      expect(go.winReason.card).toBe(CRACKS_OF_DOOM);
    }
  });

  test('a winning check destroys The One Ring — removed from the game, not merely discarded', () => {
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [CRACKS_OF_DOOM],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const afterPlay = dispatch(state, playShortEventActions(state, eventInstance as string)[0]);
    const ringInstance = getCharacter(afterPlay, RESOURCE_PLAYER, FRODO).items
      .find(i => i.definitionId === THE_ONE_RING)!.instanceId;

    const ccAction = viableActions(afterPlay, PLAYER_1, 'corruption-check')[0].action;
    const after = dispatch({ ...afterPlay, cheatRollTotal: 12 }, ccAction);

    // Destroyed: off its bearer and in the terminal out-of-play pile (the Ring
    // is removed from the game, so it is not recyclable from the discard pile).
    expect(getCharacter(after, RESOURCE_PLAYER, FRODO).items
      .some(i => i.definitionId === THE_ONE_RING)).toBe(false);
    expectInPile(after, RESOURCE_PLAYER, 'outOfPlayPile', ringInstance);
    assertEveryInstanceReachable(after);
  });

  test('the destroyed Ring stops counting item marshalling points', () => {
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [CRACKS_OF_DOOM],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const afterPlay = dispatch(state, playShortEventActions(state, eventInstance as string)[0]);
    // The Ring is worth 6 item MP while borne.
    const beforeItemMp = afterPlay.players[RESOURCE_PLAYER].marshallingPoints.item;
    expect(beforeItemMp).toBeGreaterThan(0);

    const ccAction = viableActions(afterPlay, PLAYER_1, 'corruption-check')[0].action;
    const won = dispatch({ ...afterPlay, cheatRollTotal: 12 }, ccAction);

    // Destruction happens before final scoring, so the Ring's points are gone.
    expect(won.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(0);
  });

  test('cannot be included in a Fallen-wizard deck (rule 1.18)', () => {
    const fwDeck: DeckList = {
      id: 'test-fw-cracks',
      name: 'FW Cracks of Doom',
      alignment: 'fallen-wizard',
      pool: [],
      sideboard: [],
      sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [],
        hazards: [...HAZARD_CREATURES_12],
        resources: [{ name: 'Cracks of Doom', card: CRACKS_OF_DOOM, qty: 1 }],
      },
    };
    const errors = validateDeck(fwDeck, pool).filter(e => e.card === CRACKS_OF_DOOM);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('not allowed');
  });

  test('failed corruption check does not win — standard consequence applies', () => {
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [CRACKS_OF_DOOM],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const afterPlay = dispatch(state, playShortEventActions(state, eventInstance as string)[0]);
    const frodoId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, FRODO);

    const ccAction = viableActions(afterPlay, PLAYER_1, 'corruption-check')[0].action;
    const after = dispatch({ ...afterPlay, cheatRollTotal: 2 }, ccAction);

    expect(after.phaseState.phase).not.toBe(Phase.GameOver);
    // The bearer suffered the standard corruption-check failure consequence.
    expectCharNotInPlay(after, RESOURCE_PLAYER, frodoId);
  });
});
