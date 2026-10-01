/**
 * @module td-123.test
 *
 * Card test: Here, There, or Yonder (td-123)
 * Type: hero-resource-event (short)
 * Effects: 3 (play-window site @ Ruins & Lairs, play-target character with tap
 * cost gated on `company.enteredSite`, roll-play-ally)
 *
 * "Tap a character during his site phase at a tapped or untapped Ruins &
 *  Lairs [{R}]. Make a roll modified by +3 if character is a diplomat. An ally
 *  may be played and placed under the character's control if the result is
 *  greater than 6 plus the ally's mind stat and the ally is not restricted
 *  from moving in this site's region. If an ally is played, tap the site if it
 *  is not already tapped."
 *
 * The event rides the chain of effects; on resolution the tapped character
 * rolls and an `ally-placement-offer` lists every hand ally that clears the
 * roll — regardless of the ally's printed playable sites — minus allies whose
 * "discard if his company moves to a site not in …" clause would fire at this
 * site. Accepting places the ally and taps the site.
 *
 * Fixtures: Weathertop (tw-436, R&L in Arthedain), Dimrill Dale (tw-385, R&L
 * in Redhorn Gate), Moria (shadow-hold). Allies: Gwaihir (mind 4), Bill the
 * Pony (mind 1), Treebeard (mind 3, discarded outside Fangorn/Rohan/…/Redhorn
 * Gate). Aragorn II is not a diplomat; Legolas is.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  GWAIHIR, TREEBEARD,
  MORIA, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, makeSitePhase, setCompanySiteStatus,
  viableActions, findCharInstanceId, handCardId, findHandCardId,
  dispatch, resolveChain, setCharStatus, attachAllyToChar,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharStatus, expectInDiscardPile,
  CardStatus,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, PlayAllyPlacementOfferAction } from '../../index.js';
import { Phase, WEATHERTOP_HERO } from '../../index.js';

const HERE_THERE_OR_YONDER = 'td-123' as CardDefinitionId;
const DIMRILL_DALE = 'tw-385' as CardDefinitionId;
const BILL_THE_PONY = 'tw-198' as CardDefinitionId;

describe('Here, There, or Yonder (td-123)', () => {
  beforeEach(() => resetMint());

  test('playable during the company\'s site phase at a Ruins & Lairs, tapping an untapped character', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN, LEGOLAS] }], hand: [HERE_THERE_OR_YONDER], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = setCharStatus({ ...base, phaseState: makeSitePhase() }, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);

    const plays = viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction);
    // Only the untapped character can pay the tap.
    expect(plays).toHaveLength(1);
    expect(plays[0].targetScoutInstanceId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN));
  });

  test('playable at a tapped Ruins & Lairs too', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [HERE_THERE_OR_YONDER], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = setCompanySiteStatus({ ...base, phaseState: makeSitePhase() }, RESOURCE_PLAYER, 0, CardStatus.Tapped);

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(1);
  });

  test('not playable at a site that is not a Ruins & Lairs', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [HERE_THERE_OR_YONDER], siteDeck: [WEATHERTOP_HERO] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('not playable on a character outside his own site phase (another company is active)', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [LEGOLAS] },
            { site: WEATHERTOP_HERO, characters: [ARAGORN] },
          ],
          hand: [HERE_THERE_OR_YONDER],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // Company 0 (at Moria) is in its site phase; Aragorn's company at
    // Weathertop is not.
    const state = { ...base, phaseState: makeSitePhase({ activeCompanyIndex: 0 }) };
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);

    // Once Aragorn's company is the one in its site phase, it is playable.
    const own = { ...base, phaseState: makeSitePhase({ activeCompanyIndex: 1 }) };
    expect(viableActions(own, PLAYER_1, 'play-short-event')).toHaveLength(1);
  });

  test('roll greater than 6 + mind plays the ally under the character, waiving its playable site, and taps the site', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [HERE_THERE_OR_YONDER, GWAIHIR], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), cheatRollTotal: 11 };
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, HERE_THERE_OR_YONDER);
    const gwaihirId = findHandCardId(state, RESOURCE_PLAYER, GWAIHIR);

    const afterPlay = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId, targetScoutInstanceId: aragornId });
    // Tap is paid on declaration; the roll waits for chain resolution.
    expectCharStatus(afterPlay, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect(afterPlay.chain).not.toBeNull();

    const resolved = resolveChain(afterPlay);
    expectInDiscardPile(resolved, RESOURCE_PLAYER, HERE_THERE_OR_YONDER);
    const offers = viableActions(resolved, PLAYER_1, 'play-ally-placement-offer').map(ea => ea.action as PlayAllyPlacementOfferAction);
    // 11 > 6 + 4 — Gwaihir (printed playable only at Eagles' Eyrie) qualifies.
    expect(offers.map(a => a.cardInstanceId)).toEqual([gwaihirId]);
    expect(viableActions(resolved, PLAYER_1, 'pass')).toHaveLength(1);

    const placed = dispatch(resolved, offers[0]);
    expect(placed.players[0].characters[aragornId].allies.map(a => a.instanceId)).toContain(gwaihirId);
    expect(placed.players[0].hand.map(c => c.instanceId)).not.toContain(gwaihirId);
    expect(placed.players[0].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    expect(placed.pendingResolutions).toHaveLength(0);
  });

  test('roll not greater than 6 + mind does not allow the ally (non-diplomat gets no bonus)', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [HERE_THERE_OR_YONDER, GWAIHIR, BILL_THE_PONY], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), cheatRollTotal: 10 };
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, HERE_THERE_OR_YONDER);
    const billId = findHandCardId(state, RESOURCE_PLAYER, BILL_THE_PONY);

    const resolved = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId, targetScoutInstanceId: aragornId }));
    const offered = viableActions(resolved, PLAYER_1, 'play-ally-placement-offer').map(ea => (ea.action as PlayAllyPlacementOfferAction).cardInstanceId);
    // 10 is not greater than 6 + 4 (Gwaihir); 10 > 6 + 1 (Bill the Pony).
    expect(offered).toEqual([billId]);
  });

  test('diplomat adds +3 to the roll', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [LEGOLAS] }], hand: [HERE_THERE_OR_YONDER, GWAIHIR], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), cheatRollTotal: 8 };
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, HERE_THERE_OR_YONDER);
    const gwaihirId = findHandCardId(state, RESOURCE_PLAYER, GWAIHIR);

    const resolved = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId, targetScoutInstanceId: legolasId }));
    const offer = resolved.pendingResolutions.find(r => r.kind.type === 'ally-placement-offer');
    if (offer?.kind.type !== 'ally-placement-offer') throw new Error('no ally-placement-offer pending');
    // 8 + 3 (diplomat) = 11 > 10.
    expect(offer.kind.rollTotal).toBe(11);
    const offered = viableActions(resolved, PLAYER_1, 'play-ally-placement-offer').map(ea => (ea.action as PlayAllyPlacementOfferAction).cardInstanceId);
    expect(offered).toEqual([gwaihirId]);
  });

  test('ally restricted from moving in the site\'s region is not offered; offered where it may move', () => {
    const atWeathertop = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [HERE_THERE_OR_YONDER, TREEBEARD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const s1 = { ...atWeathertop, phaseState: makeSitePhase(), cheatRollTotal: 12 };
    const r1 = resolveChain(dispatch(s1, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: handCardId(s1, RESOURCE_PLAYER), targetScoutInstanceId: findCharInstanceId(s1, RESOURCE_PLAYER, ARAGORN),
    }));
    // Treebeard is discarded if his company moves outside Fangorn, Rohan, …,
    // Redhorn Gate — Weathertop (Arthedain) is off-limits.
    expect(viableActions(r1, PLAYER_1, 'play-ally-placement-offer')).toHaveLength(0);

    resetMint();
    const atDimrill = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ARAGORN] }], hand: [HERE_THERE_OR_YONDER, TREEBEARD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const s2 = { ...atDimrill, phaseState: makeSitePhase(), cheatRollTotal: 12 };
    const treebeardId = findHandCardId(s2, RESOURCE_PLAYER, TREEBEARD);
    const r2 = resolveChain(dispatch(s2, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(s2, RESOURCE_PLAYER, HERE_THERE_OR_YONDER), targetScoutInstanceId: findCharInstanceId(s2, RESOURCE_PLAYER, ARAGORN),
    }));
    // Dimrill Dale (Redhorn Gate) is within Treebeard's allowed regions.
    const offered = viableActions(r2, PLAYER_1, 'play-ally-placement-offer').map(ea => (ea.action as PlayAllyPlacementOfferAction).cardInstanceId);
    expect(offered).toEqual([treebeardId]);
  });

  test('unique ally already in play is not offered', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [HERE_THERE_OR_YONDER, GWAIHIR], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...attachAllyToChar({ ...base, phaseState: makeSitePhase() }, HAZARD_PLAYER, GIMLI, GWAIHIR), cheatRollTotal: 12 };
    const resolved = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, HERE_THERE_OR_YONDER), targetScoutInstanceId: findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN),
    }));
    expect(viableActions(resolved, PLAYER_1, 'play-ally-placement-offer')).toHaveLength(0);
  });

  test('declining plays no ally and leaves the site untapped', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [HERE_THERE_OR_YONDER, BILL_THE_PONY], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), cheatRollTotal: 12 };
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const billId = findHandCardId(state, RESOURCE_PLAYER, BILL_THE_PONY);
    const resolved = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, HERE_THERE_OR_YONDER), targetScoutInstanceId: aragornId,
    }));
    expect(viableActions(resolved, PLAYER_1, 'play-ally-placement-offer')).toHaveLength(1);

    const declined = dispatch(resolved, { type: 'pass', player: PLAYER_1 });
    expect(declined.pendingResolutions).toHaveLength(0);
    expect(declined.players[0].characters[aragornId].allies).toHaveLength(0);
    expect(declined.players[0].hand.map(c => c.instanceId)).toContain(billId);
    expect(declined.players[0].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
  });

  test('at an already-tapped site the ally is still played and the site stays tapped', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: WEATHERTOP_HERO, characters: [ARAGORN] }], hand: [HERE_THERE_OR_YONDER, BILL_THE_PONY], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...setCompanySiteStatus({ ...base, phaseState: makeSitePhase() }, RESOURCE_PLAYER, 0, CardStatus.Tapped), cheatRollTotal: 9 };
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const billId = findHandCardId(state, RESOURCE_PLAYER, BILL_THE_PONY);
    const resolved = resolveChain(dispatch(state, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, HERE_THERE_OR_YONDER), targetScoutInstanceId: aragornId,
    }));
    const placed = dispatch(resolved, { type: 'play-ally-placement-offer', player: PLAYER_1, cardInstanceId: billId });
    expect(placed.players[0].characters[aragornId].allies.map(a => a.instanceId)).toContain(billId);
    expect(placed.players[0].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
  });
});
