/**
 * @module ba-49.test
 *
 * Card test: Angband Revisited (ba-49)
 * Type: minion-resource-event (short event, ringwraith alignment; Balrog-specific)
 * Effects: 2 (play-target with inAvatarCompany filter + play-option untap)
 *
 * "Balrog specific. Untap a character in The Balrog's company."
 *
 * A short event that untaps a single tapped character belonging to the same
 * company as the player's avatar. For a Balrog player the avatar is The Balrog
 * (ba-3), so `inAvatarCompany` resolves to "The Balrog's company". Characters
 * outside that company or already untapped are not eligible targets (a card may
 * not be played without effect). This is the Balrog-side counterpart of
 * And Forth He Hastened (td-98), which reuses the same DSL machinery.
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                              |
 * |---|--------------------------------------------|-------------|------------------------------------|
 * | 1 | play-target with inAvatarCompany filter    | IMPLEMENTED | buildPlayOptionContext             |
 * | 2 | play-option: set-character-status untapped | IMPLEMENTED | reducer-events.ts                  |
 *
 * Note on "Balrog specific": this is a deck-construction tag (only a Balrog deck
 * may include the card), not a play-time engine restriction; the effect targets
 * the avatar's company, which for a Balrog player is The Balrog's company.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  CardStatus,
  handCardId, findCharInstanceId, dispatch,
  expectCharStatus, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { PlayShortEventAction, CardDefinitionId } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

/** Angband Revisited — the card under test */
const ANGBAND_REVISITED = 'ba-49' as CardDefinitionId;
/** The Balrog — Balrog avatar, mind null */
const THE_BALROG = 'ba-3' as CardDefinitionId;
/** Crook-legged Orc — Balrog-specific minion character, mind 2 */
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;
/** Azog — another minion character (orc, mind 7) */
const AZOG = 'ba-2' as CardDefinitionId;
/** Barad-dûr (BA) — dark-hold surface site */
const BARAD_DUR_BA = 'ba-84' as CardDefinitionId;
/** Cirith Ungol (BA) — a second dark-hold site */
const CIRITH_UNGOL_BA = 'ba-87' as CardDefinitionId;
/** The Under-gates (BA) — under-deeps haven */
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId;

describe('Angband Revisited (ba-49)', () => {
  beforeEach(() => resetMint());

  test('untaps a tapped character in The Balrog\'s company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{
            site: BARAD_DUR_BA,
            characters: [
              THE_BALROG,
              { defId: CROOK_LEGGED_ORC, status: CardStatus.Tapped },
            ],
          }],
          hand: [ANGBAND_REVISITED],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });

    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, CROOK_LEGGED_ORC);
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const untapAction = actions.find(
      a => a.cardInstanceId === cardInstance && a.targetCharacterId === orcId,
    );
    expect(untapAction).toBeDefined();
    expect(untapAction!.optionId).toBe('untap');

    const state = dispatch(base, untapAction!);
    expectCharStatus(state, RESOURCE_PLAYER, CROOK_LEGGED_ORC, CardStatus.Untapped);
  });

  test('not playable on characters outside The Balrog\'s company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [
            { site: BARAD_DUR_BA, characters: [THE_BALROG] },
            { site: CIRITH_UNGOL_BA, characters: [{ defId: CROOK_LEGGED_ORC, status: CardStatus.Tapped }] },
          ],
          hand: [ANGBAND_REVISITED],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });

    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, CROOK_LEGGED_ORC);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const targetingOrc = actions.find(a => a.targetCharacterId === orcId);
    expect(targetingOrc).toBeUndefined();
  });

  test('not playable on untapped characters (no effect)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{
            site: BARAD_DUR_BA,
            characters: [THE_BALROG, CROOK_LEGGED_ORC],
          }],
          hand: [ANGBAND_REVISITED],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions).toHaveLength(0);
  });

  test('not playable when The Balrog is not in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{
            site: THE_UNDER_GATES_BA,
            characters: [{ defId: CROOK_LEGGED_ORC, status: CardStatus.Tapped }],
          }],
          hand: [ANGBAND_REVISITED],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions).toHaveLength(0);
  });

  test('each tapped character in The Balrog\'s company gets a separate action', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{
            site: BARAD_DUR_BA,
            characters: [
              THE_BALROG,
              { defId: CROOK_LEGGED_ORC, status: CardStatus.Tapped },
              { defId: AZOG, status: CardStatus.Tapped },
            ],
          }],
          hand: [ANGBAND_REVISITED],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });

    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardInstance);

    expect(actions).toHaveLength(2);
  });
});
