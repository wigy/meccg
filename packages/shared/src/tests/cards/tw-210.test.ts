/**
 * @module tw-210.test
 *
 * Card test: Dreams of Lore (tw-210)
 * Type: hero-resource-event (permanent)
 *
 * Text:
 *   "Sage only during the site phase at an untapped site where Information is
 *    playable. Tap the sage and the site. Sage may not untap until Dreams of
 *    Lore is stored at a Haven during his organization phase. May not be
 *    transferred."
 *
 * Same play/store/lock mechanic as Reforging (tw-314): `play-target` site
 * (Information playable) + `play-target` character (sage, untapped) +
 * `untapped-site-required` + `tap-site-on-play` + `tap-character-on-play` +
 * `storable-at` (Haven, 2 misc MP — cards.json TW-210 attributes) +
 * `bearer-cannot-untap-until-stored`. Unlike Reforging, Dreams of Lore has no
 * organization-phase retrieval ability, so this test is a complete cover of
 * the printed text. "May not be transferred" needs no dedicated DSL flag: the
 * card is a `hero-resource-event`, not `hero-resource-item`, and
 * `handleTransferItem` (`reducer-organization.ts`) rejects any bearer
 * attachment whose definition fails `isItemCard` — verified below by
 * dispatching `transfer-item` directly and asserting the reducer error.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus,
  resetMint,
  buildSitePhaseState,
  buildTestState, makePlayDeck,
  findCharInstanceId,
  viableActions, dispatch, resolveChain,
  GALADRIEL, ARAGORN, RIVENDELL, LORIEN, LEGOLAS,
  mint, addToPile,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { Phase, reduce } from '../../index.js';
import type { CardDefinitionId, PlayPermanentEventAction } from '../../index.js';

const DREAMS_OF_LORE = 'tw-210' as CardDefinitionId;
const AMON_HEN = 'tw-371' as CardDefinitionId; // ruins-and-lairs, Information playable
const TOLFALAS = 'tw-433' as CardDefinitionId; // ruins-and-lairs, NO Information

describe('Dreams of Lore (tw-210)', () => {
  beforeEach(() => resetMint());

  // ── Effects 1 + 2: sage-only, site where Information is playable ──

  test('offered on an untapped sage at a site where Information is playable', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL], // scout+sage
      site: AMON_HEN,
      hand: [DREAMS_OF_LORE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('NOT offered on a non-sage character', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN], // warrior/scout/ranger — no sage skill
      site: AMON_HEN,
      hand: [DREAMS_OF_LORE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at a site where Information is not playable', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: TOLFALAS,
      hand: [DREAMS_OF_LORE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 3 + untapped-site-required: both sage and site must be untapped ──

  test('NOT offered when the sage is already tapped', () => {
    const state = buildSitePhaseState({
      characters: [{ defId: GALADRIEL, status: CardStatus.Tapped }],
      site: AMON_HEN,
      hand: [DREAMS_OF_LORE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at an already-tapped site', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [DREAMS_OF_LORE],
      siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effects 4 + 5: tap the sage and the site, attach to the sage ──

  test('playing it taps the sage and the site, and attaches to the sage', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [DREAMS_OF_LORE],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const galadrielId = findCharInstanceId(after, RESOURCE_PLAYER, GALADRIEL);
    const galadriel = after.players[RESOURCE_PLAYER].characters[galadrielId];
    expect(galadriel.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(galadriel.items.some(i => i.definitionId === DREAMS_OF_LORE)).toBe(true);
  });

  // ── Storable-at Haven + bearer-cannot-untap-until-stored ──

  test('sage bearing Dreams of Lore cannot untap until it is stored', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [DREAMS_OF_LORE],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = resolveChain(dispatch(state, action));

    const galadrielId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, GALADRIEL);
    const constraint = afterPlay.activeConstraints.find(
      c => c.kind.type === 'bearer-cannot-untap'
        && c.target.kind === 'character'
        && c.target.characterId === galadrielId,
    );
    expect(constraint).toBeDefined();

    const inUntap = {
      ...afterPlay,
      phaseState: {
        phase: Phase.Untap,
        untapped: false,
        hazardSideboardDestination: null,
        hazardSideboardFetched: 0,
        hazardSideboardAccessed: false,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      } as typeof afterPlay.phaseState,
    };
    const afterUntap = dispatch(inUntap, { type: 'untap', player: PLAYER_1 });
    expect(afterUntap.players[RESOURCE_PLAYER].characters[galadrielId].status).toBe(CardStatus.Tapped);
  });

  test('Dreams of Lore can be stored at a Haven during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GALADRIEL, items: [DREAMS_OF_LORE] }] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);
  });

  test('no marshalling points while Dreams of Lore is attached to a character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GALADRIEL, items: [DREAMS_OF_LORE] }] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('2 misc marshalling points once Dreams of Lore is stored', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GALADRIEL] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });
    const stored = addToPile(
      base, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: DREAMS_OF_LORE },
    );
    const state = recomputeDerived(stored);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });

  // ── "May not be transferred" ──

  test('cannot be transferred between characters', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [{ defId: GALADRIEL, items: [DREAMS_OF_LORE] }, ARAGORN],
          }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });

    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const itemInstanceId = state.players[RESOURCE_PLAYER].characters[galadrielId].items[0].instanceId;

    const result = reduce(state, {
      type: 'transfer-item',
      player: PLAYER_1,
      fromCharacterId: galadrielId,
      toCharacterId: aragornId,
      itemInstanceId,
    });
    expect(result.error).toBeDefined();
    expect(state.players[RESOURCE_PLAYER].characters[galadrielId].items.some(
      i => i.definitionId === DREAMS_OF_LORE,
    )).toBe(true);
  });
});
