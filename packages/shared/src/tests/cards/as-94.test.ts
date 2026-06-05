/**
 * @module as-94.test
 *
 * Card test: Orders from Lugbúrz (as-94)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Playable on a company. May be played with a starting company in lieu of a
 *    minor item. This company may contain a Troll leader in addition to another
 *    leader. +1 to all corruption checks by followers of Troll leaders in this
 *    company. Discard if Ren is your Ringwraith or when a leader leaves the
 *    company. Cannot be duplicated on a given company. Cannot be included in a
 *    Balrog's deck."
 *
 * Effects:
 *   1. play-target: company
 *   2. extra-troll-leader-slot: company may hold one Troll leader + one other leader
 *   3. duplication-limit: scope "company", max 1
 *
 * Engine support table:
 * | # | Rule                                                | Status          | Notes                                               |
 * |---|-----------------------------------------------------|-----------------|-----------------------------------------------------|
 * | 1 | Playable on a company                               | IMPLEMENTED     | play-target: company                                |
 * | 2 | May be played with a starting company in lieu of item| NOT IMPLEMENTED| no DSL type / engine support                        |
 * | 3 | Company may contain Troll leader + another leader   | IMPLEMENTED     | extra-troll-leader-slot effect                      |
 * | 4 | +1 CC for followers of Troll leaders                | NOT IMPLEMENTED | "followers of Troll leaders" condition not supported|
 * | 5 | Discard if Ren is your Ringwraith                   | NOT IMPLEMENTED | ringwraith identity conditions not in engine        |
 * | 6 | Discard when a leader leaves the company            | NOT IMPLEMENTED | company-membership-changes has no conditional discard|
 * | 7 | Cannot be duplicated on a given company             | IMPLEMENTED     | duplication-limit: scope "company"                  |
 *
 * Playable: PARTIALLY (not certified — rules 2, 4, 5, 6 unimplemented)
 *
 * Fixtures:
 *   PERCHEN (as-4)                   — minion man scout/diplomat, mind 5
 *   GORBAG (le-11)                   — minion orc Leader (Uruk-hai), mind 6
 *   LIEUTENANT_OF_DOL_GULDUR (le-21) — minion troll Leader (Olog-hai), mind 9
 *   MINAS_MORGUL (le-390)            — minion darkhaven (haven — used for play tests)
 *   DOL_GULDUR (le-367)              — minion haven (opponent site)
 *   MORIA (tw-413)                   — shadow-hold (non-haven — used for leader tests)
 *   ASTERNAK (le-1)                  — minion man diplomat, opponent character
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  handCardId, viableActions, companyIdAt,
  playPermanentEventAndResolve,
  RESOURCE_PLAYER,
  addCardInPlay,
  Alignment,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayPermanentEventAction, MergeCompaniesAction, CompanyId } from '../../index.js';

const ORDERS_FROM_LUGBURZ = 'as-94' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const LIEUTENANT_DOL_GULDUR = 'le-21' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // darkhaven (haven)
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // haven (opponent site)
const MORIA_LE = 'le-392' as CardDefinitionId;       // shadow-hold (non-haven — for leader tests)
const VARIAG_CAMP = 'le-411' as CardDefinitionId;

describe('Orders from Lugbúrz (as-94)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable on a company ─────────────────────────────────────────

  test('play-permanent-event action generated with targetCompanyId during organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [ORDERS_FROM_LUGBURZ], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    const action = actions[0].action as PlayPermanentEventAction;
    expect(action.targetCompanyId).toBe(companyIdAt(state, RESOURCE_PLAYER));
  });

  test('resolves into cardsInPlay bound to the target company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [ORDERS_FROM_LUGBURZ], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const cardInstanceId = handCardId(state, RESOURCE_PLAYER);
    const expectedCompanyId = companyIdAt(state, RESOURCE_PLAYER);

    const after = playPermanentEventAndResolve(state, PLAYER_1, cardInstanceId, undefined, {
      targetCompanyId: expectedCompanyId,
    });

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(
      c => c.instanceId === cardInstanceId,
    );
    expect(inPlay).toBeDefined();
    expect(inPlay?.companyId).toBe(expectedCompanyId);
  });

  // ── Rule 3: Company may contain a Troll leader in addition to another leader ──

  test('merge-companies is viable when Orders from Lugbúrz is active on a company with a non-Troll leader', () => {
    // Company 0: Gorbag (orc Leader) at Moria + Orders from Lugbúrz
    // Company 1: Lieutenant of Dol Guldur (troll Leader) at same Moria
    // With the event active, merging company 1 into company 0 must be offered
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: MORIA_LE, characters: [GORBAG] },
            { site: MORIA_LE, characters: [LIEUTENANT_DOL_GULDUR] },
          ],
          hand: [],
          siteDeck: [VARIAG_CAMP],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    // Share the same site instance between both companies (required for merge to be viable)
    const sharedSite = built.players[0].companies[0].currentSite!;
    const withSharedSite = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, currentSite: sharedSite, siteCardOwned: false } : c,
          ),
        },
        built.players[1],
      ] as typeof built.players,
    };

    // Bind Orders from Lugbúrz to company 0
    const company0Id = companyIdAt(withSharedSite, RESOURCE_PLAYER);
    const state = addCardInPlay(withSharedSite, RESOURCE_PLAYER, ORDERS_FROM_LUGBURZ, company0Id);

    const company1Id = `company-${PLAYER_1 as string}-1` as CompanyId;
    const mergeActions = viableActions(state, PLAYER_1, 'merge-companies') as { action: MergeCompaniesAction }[];

    // The merge of company 1 (troll leader) into company 0 (orc leader + Orders) must be viable
    const trollMerge = mergeActions.find(
      ea => ea.action.sourceCompanyId === company1Id && ea.action.targetCompanyId === company0Id,
    );
    expect(trollMerge).toBeDefined();
  });

  test('merge-companies is blocked for two leaders without Orders from Lugbúrz', () => {
    // Same two companies with two leaders at Moria — without the event, the merge is blocked
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: MORIA_LE, characters: [GORBAG] },
            { site: MORIA_LE, characters: [LIEUTENANT_DOL_GULDUR] },
          ],
          hand: [],
          siteDeck: [VARIAG_CAMP],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const sharedSite = built.players[0].companies[0].currentSite!;
    const state = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, currentSite: sharedSite, siteCardOwned: false } : c,
          ),
        },
        built.players[1],
      ] as typeof built.players,
    };

    const mergeActions = viableActions(state, PLAYER_1, 'merge-companies');
    expect(mergeActions).toHaveLength(0);
  });

  // ── Rule 7: Cannot be duplicated on a given company ───────────────────────

  test('second Orders from Lugbúrz cannot be played on a company that already has one', () => {
    const baseState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [ORDERS_FROM_LUGBURZ], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    // Add a copy already in play bound to the company
    const companyId = companyIdAt(baseState, RESOURCE_PLAYER);
    const state = addCardInPlay(baseState, RESOURCE_PLAYER, ORDERS_FROM_LUGBURZ, companyId);

    // The hand copy should not be playable on the same company
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ── Rules 2, 4, 5, 6: Not yet implemented ─────────────────────────────────

  test.todo('playable-as-starting-item: may replace a minor item in starting company setup');

  test.todo('+1 to corruption checks by followers of Troll leaders in the company');

  test.todo('discard-if-ren: discard immediately if the player\'s Ringwraith is Ren');

  test.todo('discard-when-leader-leaves: discard when any leader leaves the bound company');
});
