/**
 * @module le-409.test
 *
 * Card test: Urlurtsu Nurn (le-409)
 * Type: minion-site (dark-hold) · alignment: ringwraith · region: Nurn
 *
 * Card text:
 *   Nearest Darkhaven: Minas Morgul
 *   Special: If your Ringwraith is at this site, he may tap during the
 *   organization phase to bring one Orc or Troll character from your discard
 *   pile into play at this site (as another company). The character must move
 *   to a different site from that of your Ringwraith this turn or be discarded
 *   at the end of the movement/hazard phase.
 *
 * The minion twin of the hero Urlurtsu Nurn (dm-42), which has no special
 * ability. This minion version's "Special" is modeled with the
 * `ringwraith-reanimate-from-discard` site-rule:
 *   - an org-phase emitter (`siteRingwraithReanimateActivations`) offers a
 *     `reanimate-from-discard` action for each (untapped Ringwraith at the
 *     site, eligible Orc/Troll in the discard pile) pair;
 *   - the reducer taps the Ringwraith, removes the character from the discard
 *     pile, and mints it into a NEW company sharing the site instance
 *     (`siteCardOwned: false`), tagged with a `reanimatedRingwraithId` marker;
 *   - at the M/H→Site boundary (`discardStrandedReanimatedCompanies`), a
 *     reanimated company still sharing a site with its Ringwraith has its
 *     character(s) discarded; one that reached a different site survives (the
 *     marker is cleared).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                        |
 * |---|-------------------|--------|----------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — matches {D}                     |
 * | 2 | sitePath          | OK     | [shadow, dark, dark] — matches {s}{d}{d}      |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion darkhaven       |
 * | 4 | region            | OK     | "Nurn"                                        |
 * | 5 | playableResources | OK     | [] (nothing printed as Playable)              |
 * | 6 | automaticAttacks  | OK     | [] (none printed)                             |
 * | 7 | resourceDraws     | OK     | 1                                             |
 * | 8 | hazardDraws       | OK     | 1                                             |
 * | 9 | effects           | OK     | site-rule ringwraith-reanimate-from-discard   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS, LORIEN, MORIA,
  Phase, Alignment, CardStatus,
  buildTestState, resetMint, pool,
  viableActions, dispatch, findCharInstanceId, makeMHState,
} from '../test-helpers.js';
import { isSiteCard, buildMovementMap, getReachableSites } from '../../index.js';
import type {
  SiteCard, CardDefinitionId, GameState, CardInstanceId,
  ReanimateFromDiscardAction, Company,
} from '../../index.js';

const URLURTSU_NURN = 'le-409' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // nearest Darkhaven
const MORIA_LE = 'le-392' as CardDefinitionId;      // a different minion site (no rule)

const AKHORAHIL = 'le-51' as CardDefinitionId;       // Ringwraith avatar
const ORC_BRAWLER = 'le-30' as CardDefinitionId;     // Orc character (mind 1)
const TROLL_LOUT = 'le-44' as CardDefinitionId;      // Troll character (mind 3)
const ASTERNAK = 'le-1' as CardDefinitionId;         // Man character — not Orc/Troll

/** Build a Ringwraith company at a site during the organization phase, with a
 * configurable discard pile. */
function orgStateAt(opts: {
  site?: CardDefinitionId;
  characters: Parameters<typeof buildTestState>[0]['players'][number]['companies'][number]['characters'];
  discardPile?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.site ?? URLURTSU_NURN, characters: opts.characters }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
        discardPile: opts.discardPile ?? [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MORIA],
      },
    ],
  });
}

/** Instance id of the first discard-pile card with the given definition. */
function discardInstId(state: GameState, defId: CardDefinitionId): CardInstanceId {
  const card = state.players[0].discardPile.find(c => c.definitionId === defId);
  if (!card) throw new Error(`${defId} not in discard pile`);
  return card.instanceId;
}

describe('Urlurtsu Nurn (le-409)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Minas Morgul ↔ Urlurtsu Nurn ─────────────────────────────────

  test('reachable from Minas Morgul (nearest darkhaven) via starter movement', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterIds = reachable.filter(r => r.movementType === 'starter').map(r => r.site.id);
    expect(starterIds).toContain(URLURTSU_NURN as string);
  });

  // ─── Special: Ringwraith reanimates an Orc/Troll from the discard pile ───────

  test('offered: untapped Ringwraith at the site can reanimate an Orc from discard', () => {
    const state = orgStateAt({ characters: [AKHORAHIL], discardPile: [ORC_BRAWLER] });

    const actions = viableActions(state, PLAYER_1, 'reanimate-from-discard');
    expect(actions).toHaveLength(1);

    const action = actions[0].action as ReanimateFromDiscardAction;
    expect(action.ringwraithInstanceId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, AKHORAHIL));
    expect(action.characterInstanceId).toBe(discardInstId(state, ORC_BRAWLER));
  });

  test('offered: a Troll in the discard pile is also eligible', () => {
    const state = orgStateAt({ characters: [AKHORAHIL], discardPile: [TROLL_LOUT] });

    const actions = viableActions(state, PLAYER_1, 'reanimate-from-discard');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as ReanimateFromDiscardAction).characterInstanceId)
      .toBe(discardInstId(state, TROLL_LOUT));
  });

  test('one activation per eligible discard character', () => {
    const state = orgStateAt({ characters: [AKHORAHIL], discardPile: [ORC_BRAWLER, TROLL_LOUT] });

    const actions = viableActions(state, PLAYER_1, 'reanimate-from-discard');
    const targets = actions.map(a => (a.action as ReanimateFromDiscardAction).characterInstanceId);
    expect(new Set(targets).size).toBe(2);
    expect(targets).toContain(discardInstId(state, ORC_BRAWLER));
    expect(targets).toContain(discardInstId(state, TROLL_LOUT));
  });

  test('NOT offered: a non-Orc/non-Troll (Man) in the discard pile is ineligible', () => {
    const state = orgStateAt({ characters: [AKHORAHIL], discardPile: [ASTERNAK] });

    expect(viableActions(state, PLAYER_1, 'reanimate-from-discard')).toHaveLength(0);
  });

  test('NOT offered: the Ringwraith is tapped', () => {
    const state = orgStateAt({
      characters: [{ defId: AKHORAHIL, status: CardStatus.Tapped }],
      discardPile: [ORC_BRAWLER],
    });

    expect(viableActions(state, PLAYER_1, 'reanimate-from-discard')).toHaveLength(0);
  });

  test('NOT offered: no Ringwraith is at the site', () => {
    // A lone Orc company (general influence) at the site — no avatar present.
    const state = orgStateAt({ characters: [ORC_BRAWLER], discardPile: [TROLL_LOUT] });

    expect(viableActions(state, PLAYER_1, 'reanimate-from-discard')).toHaveLength(0);
  });

  test('NOT offered: the Ringwraith is at a different site (no rule there)', () => {
    const state = orgStateAt({ site: MORIA_LE, characters: [AKHORAHIL], discardPile: [ORC_BRAWLER] });

    expect(viableActions(state, PLAYER_1, 'reanimate-from-discard')).toHaveLength(0);
  });

  // ─── Activation: taps the Ringwraith, brings the character into a new company ─

  test('activating taps the Ringwraith and forms a new company at the site', () => {
    const state = orgStateAt({ characters: [AKHORAHIL], discardPile: [ORC_BRAWLER] });
    const orcInstId = discardInstId(state, ORC_BRAWLER);
    const rwInstId = findCharInstanceId(state, RESOURCE_PLAYER, AKHORAHIL);
    const siteInstId = state.players[0].companies[0].currentSite!.instanceId;

    const action = viableActions(state, PLAYER_1, 'reanimate-from-discard')[0].action as ReanimateFromDiscardAction;
    const after = dispatch(state, action);

    // Ringwraith taps as the cost.
    expect(after.players[0].characters[rwInstId].status).toBe(CardStatus.Tapped);

    // Orc leaves the discard pile and enters play, untapped, under general influence.
    expect(after.players[0].discardPile.some(c => c.instanceId === orcInstId)).toBe(false);
    const orc = after.players[0].characters[orcInstId];
    expect(orc).toBeDefined();
    expect(orc.status).toBe(CardStatus.Untapped);
    expect(orc.controlledBy).toBe('general');

    // A new company forms at the same site, holding only the Orc, not owning the
    // physical site card, and marked with the reanimation constraint.
    const orcCompany = after.players[0].companies.find(c => c.characters.includes(orcInstId));
    expect(orcCompany).toBeDefined();
    expect(orcCompany).not.toBe(after.players[0].companies[0]); // a distinct, second company
    expect(orcCompany!.currentSite!.instanceId).toBe(siteInstId);
    expect(orcCompany!.siteCardOwned).toBe(false);
    expect(orcCompany!.reanimatedRingwraithId).toBe(rwInstId);
    expect(after.players[0].companies).toHaveLength(2);
  });

  // ─── Movement constraint: must move to a different site or be discarded ──────

  /** Build an M/H state at the play-hazards step for the LAST (reanimated)
   * company, with the Ringwraith's company already handled and the resource
   * player already passed — so a single hazard-player pass finalizes the phase.
   * `reanimatedSite` is where the reanimated company currently stands. */
  function mhEndState(reanimatedSite: CardDefinitionId): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: URLURTSU_NURN, characters: [AKHORAHIL] },
            { site: reanimatedSite, characters: [ORC_BRAWLER] },
          ],
          hand: [],
          siteDeck: [],
          playDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
          playDeck: [],
        },
      ],
    });

    const rwInstId = findCharInstanceId(base, RESOURCE_PLAYER, AKHORAHIL);
    const companies = base.players[0].companies as Company[];
    // Tag the second company as the reanimated one (constraint marker).
    companies[1] = { ...companies[1], reanimatedRingwraithId: rwInstId };
    const patched: GameState = {
      ...base,
      players: [
        { ...base.players[0], companies },
        base.players[1],
      ] as GameState['players'],
      phaseState: makeMHState({
        activeCompanyIndex: 1,
        handledCompanyIds: [companies[0].id],
        resourcePlayerPassed: true,
      }),
    };
    return patched;
  }

  test('reanimated company still sharing the site with the Ringwraith is discarded', () => {
    const state = mhEndState(URLURTSU_NURN); // stayed put — same site as the Ringwraith
    const orcInstId = state.players[0].companies[1].characters[0];

    // Hazard player passes → both passed → M/H phase ends → constraint sweep.
    const after = dispatch(state, { type: 'pass', player: PLAYER_2 });

    expect(after.phaseState.phase).toBe(Phase.Site);
    // Orc discarded: gone from play, present in the discard pile, its company dropped.
    expect(after.players[0].characters[orcInstId]).toBeUndefined();
    expect(after.players[0].discardPile.some(c => c.instanceId === orcInstId)).toBe(true);
    expect(after.players[0].companies).toHaveLength(1);
    expect(after.players[0].companies[0].characters).toContain(
      findCharInstanceId(after, RESOURCE_PLAYER, AKHORAHIL),
    );
  });

  test('reanimated company that reached a different site survives (marker cleared)', () => {
    const state = mhEndState(MORIA_LE); // moved away — different site from the Ringwraith
    const orcInstId = state.players[0].companies[1].characters[0];

    const after = dispatch(state, { type: 'pass', player: PLAYER_2 });

    expect(after.phaseState.phase).toBe(Phase.Site);
    // Orc survives in play; its company remains; the turn-scoped marker is cleared.
    expect(after.players[0].characters[orcInstId]).toBeDefined();
    const orcCompany = after.players[0].companies.find(c => c.characters.includes(orcInstId));
    expect(orcCompany).toBeDefined();
    expect(orcCompany!.reanimatedRingwraithId).toBeUndefined();
    expect(after.players[0].discardPile.some(c => c.instanceId === orcInstId)).toBe(false);
  });
});
