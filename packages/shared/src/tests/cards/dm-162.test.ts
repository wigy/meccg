/**
 * @module dm-162.test
 *
 * Card test: Vein of Arda (dm-162)
 * Type: hero-resource-event (permanent)
 *
 * Text:
 *   "Sage or Dwarf only during the site phase at any Under-deeps site. Tap
 *    the sage or Dwarf. Tap the site if it is not already tapped. Sage or
 *    Dwarf may not untap until Vein of Arda is stored at a Haven [{H}].
 *    Cannot be duplicated at a given site."
 *
 * Same play/store/lock mechanic as Dreams of Lore (tw-210): `play-target`
 * character (sage OR dwarf, untapped) + `play-target` site (Under-deeps
 * keyword) + `tap-site-on-play` + `tap-character-on-play` + `storable-at`
 * (Haven, 2 misc MP — cards.json DM-162 attributes) +
 * `bearer-cannot-untap-until-stored`. Unlike Dreams of Lore, Vein of Arda
 * does not require an *untapped* site (no `untapped-site-required` flag —
 * `applyTapSiteOnPlayFlag` already no-ops when the site is already tapped,
 * matching "Tap the site if it is not already tapped") and adds a
 * `duplication-limit` `scope: "site"` ("Cannot be duplicated at a given
 * site"). That scope check relies on `ItemInPlay.playedAtSiteDefId`, which
 * previously was only stamped by the `select-card-bearer` pending-resolution
 * path (Rescue Prisoners tw-315 shape); this card's direct
 * `play-target: character` attach goes through `applyMove`'s
 * `in-play-on-character` destination instead, which did not stamp the field
 * — fixed in `reducer-move.ts` alongside this certification so a site-scoped
 * duplication-limit is checked against where the card was *played*, not
 * wherever the bearer later travels (see the `select-card-bearer` site-scope
 * precedent in `reducer-utils.ts`'s `countPermanentEventCopiesAtSite`).
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
  GALADRIEL, GIMLI, ARAGORN, RIVENDELL, LORIEN, LEGOLAS,
  mint, addToPile,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, PlayPermanentEventAction } from '../../index.js';

const VEIN_OF_ARDA = 'dm-162' as CardDefinitionId;
const THE_UNDER_VAULTS = 'dm-41' as CardDefinitionId; // Under-deeps hero-site
const THE_UNDER_GROTTOS = 'dm-39' as CardDefinitionId; // a different Under-deeps hero-site

describe('Vein of Arda (dm-162)', () => {
  beforeEach(() => resetMint());

  // ── Effects 1 + 2: sage-or-dwarf only, at any Under-deeps site ──

  test('offered on an untapped sage at an Under-deeps site', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL], // scout+sage
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('offered on an untapped Dwarf (non-sage) at an Under-deeps site', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI], // dwarf warrior/diplomat — no sage skill
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('NOT offered on a character who is neither Sage nor Dwarf', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN], // warrior/scout/ranger, dunadan — no sage skill, not a dwarf
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at a site that is not an Under-deeps site', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: RIVENDELL,
      hand: [VEIN_OF_ARDA],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered when the sage/Dwarf is already tapped', () => {
    const state = buildSitePhaseState({
      characters: [{ defId: GALADRIEL, status: CardStatus.Tapped }],
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 3: "Tap the site if it is not already tapped" — no untapped-site requirement ──

  test('still offered at an already-tapped Under-deeps site (no untapped-site requirement)', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA],
      siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('playing it at an already-tapped site leaves the site tapped (no error, no double-tap)', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA],
      siteStatus: CardStatus.Tapped,
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
  });

  // ── Effects 2 + 4: tap the sage/Dwarf and the site, attach to the character ──

  test('playing it taps the sage and an untapped site, and attaches to the sage', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const galadrielId = findCharInstanceId(after, RESOURCE_PLAYER, GALADRIEL);
    const galadriel = after.players[RESOURCE_PLAYER].characters[galadrielId];
    expect(galadriel.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(galadriel.items.some(i => i.definitionId === VEIN_OF_ARDA)).toBe(true);
  });

  test('playing it on a Dwarf taps the Dwarf and attaches to him', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);
    const gimli = after.players[RESOURCE_PLAYER].characters[gimliId];
    expect(gimli.status).toBe(CardStatus.Tapped);
    expect(gimli.items.some(i => i.definitionId === VEIN_OF_ARDA)).toBe(true);
  });

  // ── bearer-cannot-untap-until-stored ──

  test('sage bearing Vein of Arda cannot untap until it is stored', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA],
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

  // ── storable-at Haven + marshalling points ──

  test('Vein of Arda can be stored at a Haven during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GALADRIEL, items: [VEIN_OF_ARDA] }] }],
          hand: [],
          siteDeck: [THE_UNDER_VAULTS],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [THE_UNDER_VAULTS] },
      ],
    });

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);
  });

  test('no marshalling points while Vein of Arda is attached to a character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GALADRIEL, items: [VEIN_OF_ARDA] }] }],
          hand: [],
          siteDeck: [THE_UNDER_VAULTS],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [THE_UNDER_VAULTS] },
      ],
    });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('2 misc marshalling points once Vein of Arda is stored', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GALADRIEL] }],
          hand: [],
          siteDeck: [THE_UNDER_VAULTS],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [THE_UNDER_VAULTS] },
      ],
    });
    const stored = addToPile(
      base, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: VEIN_OF_ARDA },
    );
    const state = recomputeDerived(stored);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });

  // ── Effect 5: duplication-limit scope "site" ──

  test('a second Vein of Arda cannot be played at the same site where one is already borne', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL, GIMLI],
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA, VEIN_OF_ARDA],
    });
    const firstAction = viableActions(state, PLAYER_1, 'play-permanent-event')
      .find(a => (a.action as PlayPermanentEventAction).targetCharacterId
        === findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL))!.action;
    const afterFirst = resolveChain(dispatch(state, firstAction));

    expect(viableActions(afterFirst, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('a second Vein of Arda IS playable at a different Under-deeps site, even after the first bearer travels', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL, GIMLI],
      site: THE_UNDER_VAULTS,
      hand: [VEIN_OF_ARDA],
    });
    const firstAction = viableActions(state, PLAYER_1, 'play-permanent-event')
      .find(a => (a.action as PlayPermanentEventAction).targetCharacterId
        === findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL))!.action;
    const afterFirst = resolveChain(dispatch(state, firstAction));

    // The bearer's company now travels away from The Under-vaults to a
    // different Under-deeps site (The Under-grottos) carrying the stamped
    // `playedAtSiteDefId` with it — the duplication check must key off the
    // play-time site, not the bearer's live location.
    const traveled = {
      ...afterFirst,
      players: [
        {
          ...afterFirst.players[0],
          companies: [{
            ...afterFirst.players[0].companies[0],
            currentSite: { instanceId: mint(), definitionId: THE_UNDER_GROTTOS, status: CardStatus.Untapped },
          }],
          hand: [{ instanceId: mint(), definitionId: VEIN_OF_ARDA }],
        },
        afterFirst.players[1],
      ] as typeof afterFirst.players,
    };
    const recomputed = recomputeDerived(traveled);

    // A second copy at The Under-grottos (never played there before) is legal.
    expect(viableActions(recomputed, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);

    // But a second copy back at The Under-vaults (where the first one was
    // actually played) is still refused, regardless of the bearer's travels.
    const backAtVaults = {
      ...recomputed,
      players: [
        {
          ...recomputed.players[0],
          companies: [{
            ...recomputed.players[0].companies[0],
            currentSite: { instanceId: mint(), definitionId: THE_UNDER_VAULTS, status: CardStatus.Untapped },
          }],
        },
        recomputed.players[1],
      ] as typeof recomputed.players,
    };
    const recomputedBack = recomputeDerived(backAtVaults);
    expect(viableActions(recomputedBack, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });
});
