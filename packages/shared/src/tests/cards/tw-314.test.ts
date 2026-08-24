/**
 * @module tw-314.test
 *
 * Card test: Reforging (tw-314)
 * Type: hero-resource-event (permanent)
 *
 * Text:
 *   "Sage only during the site phase at an untapped site where Information is
 *    playable. Tap the sage and the site. Sage may not untap until Reforging
 *    is stored at a Haven. During your organization phase, you may tap a sage
 *    at a Haven and discard a stored Reforging to retrieve any minor or major
 *    weapon, armor, or shield (even a hoard item) from your discard pile. The
 *    item must be placed under the control of a character in the sage's
 *    company."
 *
 * Regression: a prior game (bug report, msg ae8c6ff70006420c) showed Reforging
 * entering play with no sage/site verification and no effect whatsoever — the
 * card had an empty `effects` array. This test covers the play-time half of
 * the card: the sage/site play conditions, the tap costs, and the
 * bearer-cannot-untap-until-stored lock (mirrors Rescue Prisoners tw-315 and
 * Swordmaster tw-498, which use the same DSL primitives).
 *
 * The organization-phase "discard a stored Reforging to retrieve an item"
 * clause is a `grant-action` with `fromStored: true` — the ability is
 * granted while the card sits *stored* in the marshalling-point pile
 * (`killPile`), not while attached to a bearer. Its cost is
 * `{ tap: "sage-at-haven", discard: "self" }`: any of the player's own
 * untapped sage characters at a Haven [{H}] may pay the tap (independent of
 * company — there is no bearer to anchor one), and the stored card itself is
 * discarded straight out of `killPile`. The apply is `place-item-on-character`
 * (shared with The Forge-master wh-117), scoped by the stored-card scanner
 * (`storedCardGrantActions`) to the tapped sage's own company, fetching a
 * minor/major weapon/armor/shield (hoard items qualify too — the filter has
 * no `hoard`-excluding clause) from the discard pile.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus,
  resetMint,
  buildSitePhaseState,
  buildTestState, makePlayDeck,
  findCharInstanceId, findInPile,
  viableActions, dispatch, resolveChain,
  GALADRIEL, ARAGORN, RIVENDELL, LORIEN, LEGOLAS,
  mint, addToPile,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, PlayPermanentEventAction, GameAction } from '../../index.js';

const REFORGING = 'tw-314' as CardDefinitionId;
const AMON_HEN = 'tw-371' as CardDefinitionId; // ruins-and-lairs, Information playable
const TOLFALAS = 'tw-433' as CardDefinitionId; // ruins-and-lairs, NO Information

const DAGGER_OF_WESTERNESSE = 'tw-206' as CardDefinitionId; // minor weapon
const VALIANT_SWORD = 'td-161' as CardDefinitionId;         // major weapon, hoard item
const ATHELAS = 'tw-195' as CardDefinitionId;                // minor, not weapon/armor/shield

describe('Reforging (tw-314)', () => {
  beforeEach(() => resetMint());

  // ── Effects 1 + 2: sage-only, site where Information is playable ──

  test('offered on an untapped sage at a site where Information is playable', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL], // scout+sage
      site: AMON_HEN,
      hand: [REFORGING],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('NOT offered on a non-sage character', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN], // warrior/scout/ranger — no sage skill
      site: AMON_HEN,
      hand: [REFORGING],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at a site where Information is not playable', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: TOLFALAS,
      hand: [REFORGING],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 3 + untapped-site-required: both sage and site must be untapped ──

  test('NOT offered when the sage is already tapped', () => {
    const state = buildSitePhaseState({
      characters: [{ defId: GALADRIEL, status: CardStatus.Tapped }],
      site: AMON_HEN,
      hand: [REFORGING],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at an already-tapped site', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [REFORGING],
      siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effects 4 + 5: tap the sage and the site, attach to the sage ──

  test('playing it taps the sage and the site, and attaches to the sage', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [REFORGING],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const galadrielId = findCharInstanceId(after, RESOURCE_PLAYER, GALADRIEL);
    const galadriel = after.players[RESOURCE_PLAYER].characters[galadrielId];
    expect(galadriel.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(galadriel.items.some(i => i.definitionId === REFORGING)).toBe(true);
  });

  // ── Storable-at Haven + bearer-cannot-untap-until-stored ──

  test('sage bearing Reforging cannot untap until it is stored', () => {
    const state = buildSitePhaseState({
      characters: [GALADRIEL],
      site: AMON_HEN,
      hand: [REFORGING],
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

  test('Reforging can be stored at a Haven during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GALADRIEL, items: [REFORGING] }] }],
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

  test('no marshalling points while Reforging is attached to a character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GALADRIEL, items: [REFORGING] }] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('1 misc marshalling point is awarded when Reforging is stored', () => {
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
      { instanceId: mint(), definitionId: REFORGING },
    );
    const state = recomputeDerived(stored);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  // ── Organization-phase retrieval: tap a sage at a Haven, discard a stored
  //    Reforging, retrieve a qualifying item onto a character in the sage's
  //    company ──

  function retrievalState(opts: { discardPile?: CardDefinitionId[]; site?: CardDefinitionId }) {
    const site = opts.site ?? RIVENDELL;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site, characters: [GALADRIEL, ARAGORN] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
          discardPile: opts.discardPile ?? [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });
    const stored = addToPile(
      base, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: REFORGING, storedAtSite: site },
    );
    return recomputeDerived(stored);
  }

  test('offers tap-sage-at-haven + discard-stored-Reforging, targeting a qualifying item onto any character in the sage\'s company', () => {
    const state = retrievalState({ discardPile: [DAGGER_OF_WESTERNESSE] });
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const daggerId = findInPile(state, RESOURCE_PLAYER, 'discardPile', DAGGER_OF_WESTERNESSE)!.instanceId;

    const matches = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as GameAction & { actionId?: string; characterId?: unknown; targetCardId?: unknown; recipientCharacterId?: unknown })
      .filter(a => a.actionId === 'reforging-retrieve-item' && a.targetCardId === daggerId);

    // Both company members are offered as recipients.
    const recipientIds = new Set(matches.map(a => a.recipientCharacterId));
    expect(recipientIds.has(galadrielId)).toBe(true);
    expect(recipientIds.has(aragornId)).toBe(true);
    // Only the sage (Galadriel) may pay the tap cost — Aragorn has no sage skill.
    expect(matches.every(a => a.characterId === galadrielId)).toBe(true);
  });

  test('activating retrieves the item onto the chosen character, discards stored Reforging, and taps the sage', () => {
    const state = retrievalState({ discardPile: [DAGGER_OF_WESTERNESSE] });
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const daggerId = findInPile(state, RESOURCE_PLAYER, 'discardPile', DAGGER_OF_WESTERNESSE)!.instanceId;

    const act = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as GameAction & { actionId?: string; targetCardId?: unknown; recipientCharacterId?: unknown })
      .find(a => a.actionId === 'reforging-retrieve-item' && a.targetCardId === daggerId && a.recipientCharacterId === aragornId);
    expect(act).toBeDefined();

    const after = dispatch(state, act as GameAction);

    // The dagger is now on Aragorn, untapped, and gone from the discard pile.
    const aragorn = after.players[RESOURCE_PLAYER].characters[aragornId];
    const placed = aragorn.items.find(i => i.definitionId === DAGGER_OF_WESTERNESSE);
    expect(placed).toBeDefined();
    expect(placed!.status).toBe(CardStatus.Untapped);
    expect(findInPile(after, RESOURCE_PLAYER, 'discardPile', DAGGER_OF_WESTERNESSE)).toBeUndefined();

    // The stored Reforging is discarded out of the marshalling-point pile.
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === REFORGING)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === REFORGING)).toBe(true);

    // The sage (Galadriel) tapped to pay the cost, even though the item went to Aragorn.
    expect(after.players[RESOURCE_PLAYER].characters[galadrielId].status).toBe(CardStatus.Tapped);
  });

  test('a hoard item still qualifies for retrieval', () => {
    const state = retrievalState({ discardPile: [VALIANT_SWORD] });
    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as { actionId?: string })
      .some(a => a.actionId === 'reforging-retrieve-item');
    expect(offered).toBe(true);
  });

  test('a non-weapon/armor/shield minor item does NOT qualify', () => {
    const state = retrievalState({ discardPile: [ATHELAS] });
    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as { actionId?: string })
      .some(a => a.actionId === 'reforging-retrieve-item');
    expect(offered).toBe(false);
  });

  test('NOT offered when the sage is not at a Haven', () => {
    const state = retrievalState({ discardPile: [DAGGER_OF_WESTERNESSE], site: AMON_HEN });
    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as { actionId?: string })
      .some(a => a.actionId === 'reforging-retrieve-item');
    expect(offered).toBe(false);
  });

  test('NOT offered when the sage is already tapped', () => {
    const site = RIVENDELL;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site, characters: [{ defId: GALADRIEL, status: CardStatus.Tapped }, ARAGORN] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
          discardPile: [DAGGER_OF_WESTERNESSE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });
    const state = recomputeDerived(addToPile(
      base, RESOURCE_PLAYER, 'killPile',
      { instanceId: mint(), definitionId: REFORGING, storedAtSite: site },
    ));
    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as { actionId?: string })
      .some(a => a.actionId === 'reforging-retrieve-item');
    expect(offered).toBe(false);
  });

  test('NOT offered when there is no stored Reforging (only one attached to a bearer)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GALADRIEL, items: [REFORGING] }, ARAGORN] }],
          hand: [],
          siteDeck: [AMON_HEN],
          playDeck: makePlayDeck(),
          discardPile: [DAGGER_OF_WESTERNESSE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [AMON_HEN] },
      ],
    });
    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as { actionId?: string })
      .some(a => a.actionId === 'reforging-retrieve-item');
    expect(offered).toBe(false);
  });
});
