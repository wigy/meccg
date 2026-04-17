/**
 * @module tw-190.test
 *
 * Card test: Align Palantír (tw-190)
 * Type: hero-resource-event (permanent)
 * Effects: 3 (play-target, duplication-limit, on-event bearer-company-moves)
 *
 * "Sage only. Playable on a Palantír with a sage in the company. Bearer
 *  now has the ability to use the Palantír. If the Palantír is stored,
 *  this card is stored too. Discard Align Palantír if the company
 *  carrying the Palantír moves. Cannot be duplicated on a given Palantír."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  SARUMAN, ARAGORN, LEGOLAS,
  PALANTIR_OF_ORTHANC,
  LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, dispatch, makePlayDeck,
  playPermanentEventAndResolve,
  findCharInstanceId, getCharacter, makeMHState, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  PlayPermanentEventAction,
  ActivateGrantedAction,
  CardDefinitionId,
} from '../../index.js';
import { ISENGARD } from '../../index.js';

const ALIGN_PALANTIR = 'tw-190' as CardDefinitionId;

describe('Align Palantír (tw-190)', () => {
  beforeEach(() => resetMint());

  // ── Card definition ──


  // ── Effect 1: play-target (sage + palantír required) ──

  test('playable on character bearing Palantír when sage is in company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: SARUMAN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [ALIGN_PALANTIR],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayPermanentEventAction;
    expect(action.targetCharacterId).toBeDefined();
  });

  test('NOT playable when no Palantír item on character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [SARUMAN] }],
          hand: [ALIGN_PALANTIR],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('NOT playable when no sage in company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [ALIGN_PALANTIR],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('reducer places Align Palantír into character items on resolution', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: SARUMAN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [ALIGN_PALANTIR],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;
    const charId = action.targetCharacterId!;

    const after = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId, charId);

    // Card should be in character's items
    const char = after.players[0].characters[charId as string];
    expect(char).toBeDefined();
    const alignItem = char.items.find(i => i.definitionId === ALIGN_PALANTIR);
    expect(alignItem).toBeDefined();

    // Card should NOT be in hand
    expect(after.players[0].hand.some(c => c.definitionId === ALIGN_PALANTIR)).toBe(false);
  });

  // ── Effect 2: duplication-limit (per character, max 1) ──

  test('cannot play a second Align Palantír on the same character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: LORIEN,
            characters: [{
              defId: SARUMAN,
              items: [PALANTIR_OF_ORTHANC, ALIGN_PALANTIR],
            }],
          }],
          hand: [ALIGN_PALANTIR],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Bearer enables Palantír use ──

  test('Align Palantír enables palantir-fetch-discard for non-sage characters', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: LORIEN,
            characters: [{
              defId: ARAGORN,
              items: [PALANTIR_OF_ORTHANC, ALIGN_PALANTIR],
            }],
          }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          discardPile: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea =>
      (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard',
    );
    expect(palantirActions.length).toBe(1);
  });

  test('without Align Palantír, non-sage cannot use Palantír', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: LORIEN,
            characters: [{ defId: ARAGORN, items: [PALANTIR_OF_ORTHANC] }],
          }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          discardPile: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea =>
      (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard',
    );
    expect(palantirActions.length).toBe(0);
  });

  // ── Effect 3: on-event bearer-company-moves → discard-self ──

  test('Align Palantír is discarded when its company moves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: LORIEN,
            characters: [{
              defId: SARUMAN,
              items: [PALANTIR_OF_ORTHANC, ALIGN_PALANTIR],
            }],
          }],
          hand: [],
          siteDeck: [ISENGARD],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    // Set up destination site
    const destCard = base.players[0].siteDeck[0];
    const withDest = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: [{
            ...base.players[0].companies[0],
            destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
    };

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtMH = { ...withDest, phaseState: mhState };

    // Verify Align Palantír is currently on the character
    const sarumanId = findCharInstanceId(stateAtMH, RESOURCE_PLAYER, SARUMAN);
    const charBefore = getCharacter(stateAtMH, RESOURCE_PLAYER, SARUMAN);
    expect(charBefore.items.some(i => i.definitionId === ALIGN_PALANTIR)).toBe(true);

    // Both players pass → M/H completes, company moves
    const afterResourcePass = dispatch(stateAtMH, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Align Palantír should be discarded from character's items
    const charAfter = afterHazardPass.players[0].characters[sarumanId as string];
    expect(charAfter.items.some(i => i.definitionId === ALIGN_PALANTIR)).toBe(false);

    // Align Palantír should be in discard pile
    expect(afterHazardPass.players[0].discardPile.some(c => c.definitionId === ALIGN_PALANTIR)).toBe(true);

    // Palantír of Orthanc should still be on the character
    expect(charAfter.items.some(i => i.definitionId === PALANTIR_OF_ORTHANC)).toBe(true);
  });

  test('Align Palantír NOT discarded when company stays (no destination)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: LORIEN,
            characters: [{
              defId: SARUMAN,
              items: [PALANTIR_OF_ORTHANC, ALIGN_PALANTIR],
            }],
          }],
          hand: [],
          siteDeck: [ISENGARD],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    // No destination set — company is staying
    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtMH = { ...base, phaseState: mhState };

    const afterResourcePass = dispatch(stateAtMH, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Align Palantír should still be on the character
    const sarumanId = findCharInstanceId(stateAtMH, RESOURCE_PLAYER, SARUMAN);
    const charAfter = afterHazardPass.players[0].characters[sarumanId as string];
    expect(charAfter.items.some(i => i.definitionId === ALIGN_PALANTIR)).toBe(true);
  });
});
