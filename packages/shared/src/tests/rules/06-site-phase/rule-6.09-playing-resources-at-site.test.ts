/**
 * @module rule-6.09-playing-resources-at-site
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.09: Playing Resources at a Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Playing Resources at a Site - Allies, factions, and items can only be played during the site phase, can only be played by an untapped character at an untapped site, and tap the character and site when played.
 * If a resource can only be played during the site phase and playing it would normally tap the site, it can only be played after facing all automatic-attacks, agent hazard attacks, and on-guard creature attacks. Additionally, the resource has an active condition of requiring an untapped site, which is then tapped upon successful resolution of the resource (rather than upon declaration).
 * "Does not tap the site" is not equal to "playable at a tapped site."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, buildTestState, resetMint, viableActions, actionAs,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus, Phase,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { NotPlayableAction, PlayHeroResourceAction } from '../../../index.js';

describe('Rule 6.09 — Playing Resources at a Site', () => {
  beforeEach(() => resetMint());

  test('item is playable in site phase by an untapped character at an untapped site', () => {
    // Bilbo (untapped) at Moria (untapped, allows minor items) holds a
    // Dagger of Westernesse in hand. The legal-actions computer offers a
    // viable play-hero-resource attaching the dagger to Bilbo.
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [BILBO],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBe(1);
    const action = actionAs<PlayHeroResourceAction>(plays[0].action);
    expect(action.cardInstanceId).toBe(state.players[0].hand[0].instanceId);
    expect(action.attachToCharacterId).toBe(state.players[0].companies[0].characters[0]);
  });

  test('item is NOT playable when the site is already tapped', () => {
    // Same setup but the site arrives tapped — the engine refuses to
    // offer a viable play action and surfaces a not-playable annotation.
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [BILBO],
      hand: [DAGGER_OF_WESTERNESSE],
      siteStatus: CardStatus.Tapped,
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);

    const handInst = state.players[0].hand[0].instanceId;
    const tooltip = computeLegalActions(state, PLAYER_1).find(
      ea => !ea.viable && ea.action.type === 'not-playable'
        && actionAs<NotPlayableAction>(ea.action).cardInstanceId === handInst,
    );
    expect(tooltip).toBeDefined();
    expect(tooltip!.reason).toMatch(/tapped/i);
  });

  test('item is NOT playable if no untapped character is available to carry it', () => {
    // Bilbo is already tapped, so even at an untapped Moria the dagger
    // has nobody to carry it. Engine returns no viable play action.
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [{ defId: BILBO, status: CardStatus.Tapped }],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('items can only be played during the site phase, not the organization phase', () => {
    // The same Dagger in the organization phase yields no viable
    // play-hero-resource — that action is gated by the site phase.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }],
          hand: [DAGGER_OF_WESTERNESSE],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });
});
