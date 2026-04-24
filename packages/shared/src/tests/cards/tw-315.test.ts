/**
 * @module tw-315.test
 *
 * Card test: Rescue Prisoners (tw-315)
 * Type: hero-resource-event (permanent)
 * Effects: play-target (site: dark-hold/shadow-hold), play-flag (tapped-site-only),
 *          play-target (character), storable-at (haven/border-hold/free-hold, 2 MP),
 *          duplication-limit (site, max 1)
 *
 * "Playable at an already tapped Dark-hold or Shadow-hold during the site phase.
 *  The company faces a Spider attack (2 strikes with 7 prowess). If no characters
 *  are untapped after the attack, discard Rescue Prisoners. Otherwise, you may tap
 *  1 character in the company and put Rescue Prisoners under his control. No
 *  marshalling points are received and that character may not untap until Rescue
 *  Prisoners is stored at a Haven, Border-hold, or Free-hold during his organization
 *  phase. Cannot be duplicated at a given site."
 *
 * NOT CERTIFIED — Spider attack on play, character untap restriction, and
 * conditional MPs (0 until stored) require engine support not yet implemented.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  CardStatus,
  ARAGORN, LEGOLAS,
  MORIA, MOUNT_DOOM, BANDIT_LAIR, RIVENDELL, LORIEN,
  buildSitePhaseState, resetMint,
  viableActions,
  attachItemToChar,
  playPermanentEventAndResolve,
  buildTestState, makePlayDeck,
  mint, addToPile, makeSitePhase,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayPermanentEventAction } from '../../index.js';
import { Phase } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const RESCUE_PRISONERS = 'tw-315' as CardDefinitionId;

describe('Rescue Prisoners (tw-315)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: play-target (site filter: dark-hold or shadow-hold) ──

  test('NOT playable at ruins-and-lairs site (Bandit Lair)', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 2: play-flag (tapped-site-only) ──

  test('NOT playable at untapped shadow-hold (Moria)', () => {
    // siteStatus defaults to Untapped in buildSitePhaseState
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effects 1 + 2 combined: playable when site is tapped shadow-hold ──

  test('IS playable at tapped shadow-hold (Moria), emits per-character actions', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
    // Each action must carry a targetCharacterId (card attaches to a character)
    for (const ea of actions) {
      const act = ea.action as PlayPermanentEventAction;
      expect(act.targetCharacterId).toBeDefined();
    }
  });

  test('IS playable at tapped dark-hold (Carn Dum is le-359 — use Mount Doom as shadow-hold)', () => {
    // Mount Doom is tw-414, siteType shadow-hold — confirms shadow-hold works
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Reducer: event attaches to character's items on resolution ──

  test('reducer places Rescue Prisoners into character items on resolution', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
    const action = actions[0].action as PlayPermanentEventAction;
    const charId = action.targetCharacterId!;

    const after = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId, charId);

    // Card must be in character's items
    const char = after.players[RESOURCE_PLAYER].characters[charId as string];
    expect(char).toBeDefined();
    expect(char.items.some(i => i.definitionId === RESCUE_PRISONERS)).toBe(true);

    // Card must not remain in hand
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === RESCUE_PRISONERS)).toBe(false);
  });

  // ── Effect 3: duplication-limit (scope "site", max 1) ──

  test('NOT playable when a copy is already in play at the same site', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [RESCUE_PRISONERS],
    });
    // Attach a copy of Rescue Prisoners to Aragorn at Moria
    const stateWithCopy = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, RESCUE_PRISONERS);
    const actions = viableActions(stateWithCopy, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('IS playable at a different site even when a copy exists at another site', () => {
    // Player 1 company at Moria (has Rescue Prisoners on Aragorn)
    // Player 1 wants to play at Mount Doom (different site, no copy there)
    const baseState = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [{ defId: ARAGORN, items: [RESCUE_PRISONERS] }] },
            { site: MOUNT_DOOM, characters: [LEGOLAS] },
          ],
          hand: [RESCUE_PRISONERS],
          siteDeck: [RIVENDELL],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
      phase: Phase.Site,
    });

    // Set Mount Doom company's site to tapped
    const mountDoomCompany = baseState.players[0].companies[1];
    const stateWithTap = {
      ...baseState,
      players: [
        {
          ...baseState.players[0],
          companies: [
            baseState.players[0].companies[0],
            {
              ...mountDoomCompany,
              currentSite: mountDoomCompany.currentSite
                ? { ...mountDoomCompany.currentSite, status: CardStatus.Tapped }
                : null,
            },
          ],
        },
        baseState.players[1],
      ] as typeof baseState.players,
    };

    const stateAtMountDoom = { ...stateWithTap, phaseState: makeSitePhase({ activeCompanyIndex: 1 }) };

    const actions = viableActions(stateAtMountDoom, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Storable-at: can be stored at haven during organization ──

  test('Rescue Prisoners can be stored at a Haven during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [RESCUE_PRISONERS] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);
  });

  // ── MPs: 0 while in play, 2 when stored ──

  test('no marshalling points while Rescue Prisoners is attached to a character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [RESCUE_PRISONERS] }] }],
          hand: [],
          siteDeck: [RIVENDELL],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const mp = state.players[RESOURCE_PLAYER].marshallingPoints;
    // No misc MPs from Rescue Prisoners (marshallingPoints: 0 while in play)
    expect(mp.misc).toBe(0);
  });

  test('2 marshalling points awarded when Rescue Prisoners is stored', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    // Place Rescue Prisoners in the out-of-play pile (stored state)
    const stored = addToPile(
      base, RESOURCE_PLAYER, 'outOfPlayPile',
      { instanceId: mint(), definitionId: RESCUE_PRISONERS },
    );
    const state = recomputeDerived(stored);
    const mp = state.players[RESOURCE_PLAYER].marshallingPoints;
    expect(mp.misc).toBe(2);
  });

  // ── Unimplemented rules (engine support required) ──

  test.todo('company faces Spider attack (2 strikes, prowess 7) when Rescue Prisoners is played');
  test.todo('Rescue Prisoners is discarded if no characters are untapped after the Spider attack');
  test.todo('bearer character cannot untap until Rescue Prisoners is stored');
});
