/**
 * @module tw-247.test
 *
 * Card test: Gollum's Fate (tw-247)
 * Type: hero-resource-event (short, wizard alignment, unique)
 * Effects:
 *   1. play-window: phase "site" — only playable during the site phase
 *   2. play-condition: active-company — The One Ring AND Gollum must both be
 *      in the active company at Mount Doom
 *   3. on-event: self-enters-play → win-game (via one-ring) — immediate win,
 *      no roll (CoE rule 10.39 / MELE §1)
 *
 * Card text: "Unique. Only playable if The One Ring and Gollum are both at
 * Mount Doom during the site phase. The One Ring is destroyed and its
 * bearer's player wins."
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, LORIEN,
  resetMint, buildSitePhaseState, attachAllyToChar,
  dispatch, handCardId,
  Phase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, GameOverPhaseState, GameState } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const GOLLUMS_FATE = 'tw-247' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;
const GOLLUM = 'tw-246' as CardDefinitionId;
const FRODO = 'tw-152' as CardDefinitionId;
const MOUNT_DOOM = 'tw-414' as CardDefinitionId;

const playShortEventActions = (state: GameState, eventInstance: string) =>
  computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable && ea.action.type === 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === eventInstance);

describe("Gollum's Fate (tw-247)", () => {
  beforeEach(() => resetMint());

  test('not playable when the company is not at Mount Doom', () => {
    let state: GameState = buildSitePhaseState({
      site: LORIEN,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [GOLLUMS_FATE],
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, FRODO, GOLLUM);

    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    expect(playShortEventActions(state, eventInstance as string)).toHaveLength(0);
  });

  test('not playable at Mount Doom without Gollum in the company', () => {
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [GOLLUMS_FATE],
    });

    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    expect(playShortEventActions(state, eventInstance as string)).toHaveLength(0);
  });

  test('not playable at Mount Doom with Gollum but without The One Ring', () => {
    let state: GameState = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [FRODO],
      hand: [GOLLUMS_FATE],
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, FRODO, GOLLUM);

    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    expect(playShortEventActions(state, eventInstance as string)).toHaveLength(0);
  });

  test('playable with The One Ring and Gollum at Mount Doom → immediate win', () => {
    let state: GameState = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [GOLLUMS_FATE],
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, FRODO, GOLLUM);

    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const actions = playShortEventActions(state, eventInstance as string);
    expect(actions).toHaveLength(1);

    const after = dispatch(state, actions[0]);

    expect(after.phaseState.phase).toBe(Phase.GameOver);
    const go = after.phaseState as GameOverPhaseState;
    expect(go.winner).toBe(PLAYER_1);
    expect(go.winReason.kind).toBe('one-ring');
    if (go.winReason.kind === 'one-ring') {
      expect(go.winReason.card).toBe(GOLLUMS_FATE);
    }
  });
});
