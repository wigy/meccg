/**
 * @module rule-3.07-ringwraith-company-composition
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.07: Ringwraith Company Composition
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] Characters in a Ringwraith's company can only be other Ringwraiths, unless at a Darkhaven. If a Ringwraith is played as a new company at a non-Darkhaven site that contains another company with non-Ringwraith characters, and if both companies are still there at the end of all movement/hazard phases when they would be forced to combine, immediately discard the non-Ringwraith company.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, shareSiteInstances,
  discardNonRingwraithCompaniesAtSharedSite,
  findCharInstanceId, recomputeDerived, makeMHState,
  Phase, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS, LORIEN,
} from '../../test-helpers.js';
import type { CardDefinitionId, GameState } from '../../../index.js';
import type { MergeCompaniesAction, MoveToCompanyAction, PlayCharacterAction } from '../../../types/actions-organization.js';
import type { DeclarePathAction } from '../../../types/actions-movement-hazard.js';

// le-58: The Witch-king — Ringwraith avatar (mind null, race ringwraith).
const THE_WITCH_KING = 'le-58' as CardDefinitionId;
// le-52: Dwar the Ringwraith — a second Ringwraith avatar, playable as a
// follower; used to show a Ringwraith-only company is never restricted.
const DWAR_THE_RINGWRAITH = 'le-52' as CardDefinitionId;
// Non-Ringwraith minion characters. Orc Brawler (le-30, mind 1) and Orc Tracker
// (le-34, mind 3) are plain non-leader Orcs, so neither the leader restriction
// (rule 3.26) nor the race-mixing restriction (rule 3.25, hero races vs
// Orcs/Trolls) can be what blocks anything below.
const ORC_BRAWLER = 'le-30' as CardDefinitionId;
const ORC_TRACKER = 'le-34' as CardDefinitionId;
// le-27: Nevido Smôd — a plain Man whose home site is Easterling Camp
// (le-371, a border-hold), so he can be played there without a haven.
const NEVIDO_SMOD = 'le-27' as CardDefinitionId;
const EASTERLING_CAMP = 'le-371' as CardDefinitionId;
// le-367: Dol Guldur — a Darkhaven (minion site, siteType haven).
const DOL_GULDUR = 'le-367' as CardDefinitionId;
// le-390: Minas Morgul — a second Darkhaven, reachable from Dol Guldur via a
// starter-movement haven path (5 regions).
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// le-364: Dead Marshes — a minion shadow-hold; not a Darkhaven.
const DEAD_MARSHES = 'le-364' as CardDefinitionId;
// le-51: Akhôrahil the Ringwraith — a Ringwraith avatar.
const AKHORAHIL = 'le-51' as CardDefinitionId;
// le-31: Orc Captain — a plain non-Ringwraith minion character.
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;

/**
 * A Ringwraith player with two companies sharing one site instance: the
 * Witch-king alone, and a company of plain Orcs.
 */
function twoCompaniesAt(site: CardDefinitionId, hand: CardDefinitionId[] = []): GameState {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [
          { site, characters: [THE_WITCH_KING] },
          { site, characters: [ORC_BRAWLER, ORC_TRACKER] },
        ],
        hand,
        siteDeck: [DOL_GULDUR],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  return recomputeDerived(shareSiteInstances(built, RESOURCE_PLAYER));
}

describe('Rule 3.07 — Ringwraith Company Composition', () => {
  beforeEach(() => resetMint());

  test('[MINION] a Ringwraith company cannot be merged with a non-Ringwraith company away from a Darkhaven', () => {
    const state = twoCompaniesAt(DEAD_MARSHES);
    const merges = viableActions(state, PLAYER_1, 'merge-companies')
      .map(ea => ea.action as MergeCompaniesAction);
    expect(merges).toHaveLength(0);
  });

  test('[MINION] the same merge is legal at a Darkhaven', () => {
    const state = twoCompaniesAt(DOL_GULDUR);
    const merges = viableActions(state, PLAYER_1, 'merge-companies')
      .map(ea => ea.action as MergeCompaniesAction);
    // Both directions are offered once the Darkhaven lifts the restriction.
    expect(merges).toHaveLength(2);
  });

  test('[MINION] a non-Ringwraith character cannot move into a Ringwraith company away from a Darkhaven', () => {
    const state = twoCompaniesAt(DEAD_MARSHES);
    const ringwraithCompanyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const orcTrackerId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_TRACKER);

    const moves = viableActions(state, PLAYER_1, 'move-to-company')
      .map(ea => ea.action as MoveToCompanyAction);
    expect(moves.some(m => m.characterInstanceId === orcTrackerId && m.targetCompanyId === ringwraithCompanyId)).toBe(false);

    // At a Darkhaven the same move is offered.
    const atDarkhaven = twoCompaniesAt(DOL_GULDUR);
    const dhCompanyId = atDarkhaven.players[RESOURCE_PLAYER].companies[0].id;
    const dhTrackerId = findCharInstanceId(atDarkhaven, RESOURCE_PLAYER, ORC_TRACKER);
    const dhMoves = viableActions(atDarkhaven, PLAYER_1, 'move-to-company')
      .map(ea => ea.action as MoveToCompanyAction);
    expect(dhMoves.some(m => m.characterInstanceId === dhTrackerId && m.targetCompanyId === dhCompanyId)).toBe(true);
  });

  test('[MINION] a non-Ringwraith character cannot be played into a Ringwraith company away from a Darkhaven', () => {
    // Nevido Smôd's home site is Easterling Camp, a border-hold — so he is
    // playable there on his own merits, and rule 3.07 is the only thing that
    // can take the play away. Control: the same company standing alone at
    // Easterling Camp *without* the Witch-king does offer the play.
    const withoutRingwraith = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: EASTERLING_CAMP, characters: [ORC_TRACKER] }],
          hand: [NEVIDO_SMOD],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    }));
    const openSite = withoutRingwraith.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    expect(viableActions(withoutRingwraith, PLAYER_1, 'play-character')
      .map(ea => ea.action as PlayCharacterAction)
      .some(p => p.atSite === openSite)).toBe(true);

    // Swap the Orc for the Witch-king and the same play disappears.
    const withRingwraith = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: EASTERLING_CAMP, characters: [THE_WITCH_KING] }],
          hand: [NEVIDO_SMOD],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    }));
    const closedSite = withRingwraith.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    expect(viableActions(withRingwraith, PLAYER_1, 'play-character')
      .map(ea => ea.action as PlayCharacterAction)
      .some(p => p.atSite === closedSite)).toBe(false);
  });

  test('[MINION] the same play is legal into a Ringwraith company at a Darkhaven', () => {
    const state = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }],
          hand: [NEVIDO_SMOD],
          siteDeck: [EASTERLING_CAMP],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    }));
    const darkhavenInstance = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    expect(viableActions(state, PLAYER_1, 'play-character')
      .map(ea => ea.action as PlayCharacterAction)
      .some(p => p.atSite === darkhavenInstance)).toBe(true);
  });

  test('[MINION] a Ringwraith-only company is never restricted', () => {
    // The Witch-king and Dwar (both race ringwraith) may share a company at a
    // non-Darkhaven site — the restriction is about *non*-Ringwraiths.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DEAD_MARSHES, characters: [THE_WITCH_KING] },
            { site: DEAD_MARSHES, characters: [DWAR_THE_RINGWRAITH] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = recomputeDerived(shareSiteInstances(built, RESOURCE_PLAYER));
    const merges = viableActions(state, PLAYER_1, 'merge-companies');
    expect(merges.length).toBeGreaterThan(0);
  });

  test('[MINION] at the forced combine, the non-Ringwraith company sharing the site is discarded', () => {
    const state = twoCompaniesAt(DEAD_MARSHES);
    const brawlerId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_BRAWLER);
    const trackerId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_TRACKER);

    const after = discardNonRingwraithCompaniesAtSharedSite(state, RESOURCE_PLAYER);

    // Both Orcs are gone from play and sit in their owner's discard pile; the
    // Witch-king's company survives untouched.
    expect(after.players[RESOURCE_PLAYER].characters[brawlerId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].characters[trackerId]).toBeUndefined();
    const discarded = after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId);
    expect(discarded).toContain(brawlerId);
    expect(discarded).toContain(trackerId);
    expect(after.players[RESOURCE_PLAYER].companies).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters)
      .toEqual([findCharInstanceId(state, RESOURCE_PLAYER, THE_WITCH_KING)]);
  });

  test('[MINION] the forced-combine discard does not fire at a Darkhaven', () => {
    const state = twoCompaniesAt(DOL_GULDUR);
    const after = discardNonRingwraithCompaniesAtSharedSite(state, RESOURCE_PLAYER);
    expect(after.players[RESOURCE_PLAYER].companies).toHaveLength(2);
    expect(after.players[RESOURCE_PLAYER].discardPile).toHaveLength(0);
  });

  test('[MINION] a company mixing a Ringwraith with a non-Ringwraith character cannot move at all, even Darkhaven-to-Darkhaven', () => {
    // Akhôrahil (a Ringwraith avatar) and Orc Captain (a plain minion
    // character) share a company at Dol Guldur — legal there, since it is a
    // Darkhaven. The company has already declared movement to Minas Morgul (a
    // second Darkhaven, reachable via starter movement's haven path) for its
    // movement/hazard phase. Even though both origin and destination are
    // Darkhavens, the company is not "at" either one while traveling the
    // haven path between them — rule 3.07 forbids the mixed composition from
    // existing away from a Darkhaven at all, so no movement path (starter,
    // region, or under-deeps) may be offered; the only legal action is 'pass',
    // which negates the movement (rule 5.04) and leaves the company at Dol
    // Guldur.
    const state: GameState = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Ringwraith,
            companies: [{ site: DOL_GULDUR, characters: [AKHORAHIL, ORC_CAPTAIN], destinationSite: MINAS_MORGUL }],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
        ],
      }),
      phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false, activeCompanyIndex: 0 }),
    };

    const paths = viableActions(state, PLAYER_1, 'declare-path')
      .map(ea => ea.action as DeclarePathAction);
    expect(paths).toHaveLength(0);

    const passes = viableActions(state, PLAYER_1, 'pass');
    expect(passes).toHaveLength(1);

    // A Ringwraith-only company (no non-Ringwraith mix) making the identical
    // Darkhaven-to-Darkhaven trip is unaffected by rule 3.07.
    const ringwraithOnly: GameState = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Ringwraith,
            companies: [{ site: DOL_GULDUR, characters: [AKHORAHIL], destinationSite: MINAS_MORGUL }],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
        ],
      }),
      phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false, activeCompanyIndex: 0 }),
    };
    const soloRingwraithPaths = viableActions(ringwraithOnly, PLAYER_1, 'declare-path')
      .map(ea => ea.action as DeclarePathAction);
    expect(soloRingwraithPaths.length).toBeGreaterThan(0);
  });

  test('[MINION] a company mixing a Ringwraith with a non-Ringwraith character cannot plan movement anywhere, even to a Darkhaven', () => {
    // Reproduces a reported bug: a Fell Rider-moded Ringwraith whose company
    // still holds a non-Ringwraith character (e.g. Old Troll) was offered
    // `plan-movement` toward a non-Darkhaven destination, which the
    // movement-hazard phase's `declare-path` step then silently refused
    // (rule 5.04), stranding the company at its origin having wasted the
    // whole movement/hazard phase. `plan-movement` must not offer a
    // destination it can never legally reach.
    const mixed = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [AKHORAHIL, ORC_CAPTAIN] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    }));
    const moves = viableActions(mixed, PLAYER_1, 'plan-movement');
    expect(moves).toHaveLength(0);

    // A Ringwraith-only company at the same origin can plan the identical move.
    const ringwraithOnly = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [AKHORAHIL] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    }));
    const soloMoves = viableActions(ringwraithOnly, PLAYER_1, 'plan-movement');
    expect(soloMoves.length).toBeGreaterThan(0);
  });

  test('[MINION] the forced-combine discard leaves companies without a Ringwraith alone', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: DEAD_MARSHES, characters: [ORC_BRAWLER] },
            { site: DEAD_MARSHES, characters: [ORC_TRACKER] },
          ],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = recomputeDerived(shareSiteInstances(built, RESOURCE_PLAYER));
    const after = discardNonRingwraithCompaniesAtSharedSite(state, RESOURCE_PLAYER);
    expect(after.players[RESOURCE_PLAYER].companies).toHaveLength(2);
    expect(after.players[RESOURCE_PLAYER].discardPile).toHaveLength(0);
  });
});
