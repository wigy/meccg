/**
 * @module ba-70.test
 *
 * Card test: Orders from the Great Demon (ba-70)
 * Type: minion-resource-event (permanent, balrog alignment)
 *
 * Text:
 *   "Balrog specific. Playable on a company. May be played with a starting
 *    company in lieu of a minor item. This company may contain an additional
 *    leader who does not count against the company size maximum."
 *
 * Effects:
 *   1. play-target: company
 *   2. extra-leader-slot: the bound company may contain one additional
 *      Leader-keyword character (any race) beyond the single leader normally
 *      permitted by CoE rule 2.II.3.1.3, and one Leader in the company is
 *      exempt from the company-size maximum of CoE rule 2.II.3.1 (max size 7
 *      outside a haven)
 *   3. starting-company-placement: eligible for item-draft setup placement in
 *      lieu of a minor item
 *
 * Engine support table:
 * | # | Rule                                                           | Status      | Notes                                                            |
 * |---|-----------------------------------------------------------------|-------------|-------------------------------------------------------------------|
 * | 1 | Playable on a company                                          | IMPLEMENTED | play-target: company                                              |
 * | 2 | May be played with a starting company in lieu of a minor item  | IMPLEMENTED | starting-company-placement effect + item-draft action             |
 * | 3 | Company may contain an additional leader                       | IMPLEMENTED | extra-leader-slot effect (wouldViolateLeaderRestriction)          |
 * | 4 | Additional leader does not count toward company-size maximum   | IMPLEMENTED | extra-leader-slot effect (companyEffectiveSizeExemptingLeaders)   |
 *
 * Playable: CERTIFIED
 *
 * Fixtures:
 *   ORC_CAPTAIN (le-31)    — minion orc Leader, mind 5, no scout skill (full count)
 *   GORBAG (le-11)         — minion orc Leader (Uruk-hai), mind 6 (second leader)
 *   LAGDUF, MUZGASH, ORC_BRAWLER, ORC_VETERAN, ORC_CHIEFTAIN, SNAGA, TROLL_LOUT
 *                           — non-leader minion Orc/Troll characters, no scout
 *                             skill (each counts as a full character)
 *   MORIA_MINION (le-392)  — minion shadow-hold (non-haven — leader/size rules apply)
 *   DOL_GULDUR (le-367)    — minion haven (opponent site)
 *   ASTERNAK (le-1)        — minion man diplomat, opponent character
 *   PERCHEN (as-4)         — minion man scout/diplomat, mind 5 (draft filler)
 *   OLD_TREASURE (as-129)  — minion minor item (for item-draft setup)
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
  runActions,
  createGame,
  pool,
  draftInstId,
  dispatch,
} from '../test-helpers.js';
import { computeLegalActions, SetupStep } from '../../index.js';
import type { CardDefinitionId, PlayPermanentEventAction, MergeCompaniesAction, CompanyId, GameConfig } from '../../index.js';

const ORDERS_FROM_THE_GREAT_DEMON = 'ba-70' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;
const MUZGASH = 'le-25' as CardDefinitionId;
const ORC_BRAWLER = 'le-30' as CardDefinitionId;
const ORC_VETERAN = 'le-35' as CardDefinitionId;
const ORC_CHIEFTAIN = 'le-32' as CardDefinitionId;
const SNAGA = 'le-41' as CardDefinitionId;
const TROLL_LOUT = 'le-44' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold (non-haven)
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // haven (opponent site)
const PERCHEN = 'as-4' as CardDefinitionId;
const OLD_TREASURE = 'as-129' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;

/** Build two Balrog-aligned P1 companies sharing one non-haven site, plus a P2 company. */
function twoBalrogCompaniesAt(
  site: CardDefinitionId,
  company1Chars: CardDefinitionId[],
  company2Chars: CardDefinitionId[],
) {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Balrog,
        companies: [
          { site, characters: company1Chars },
          { site, characters: company2Chars },
        ],
        hand: [],
        siteDeck: [VARIAG_CAMP],
      },
      { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MORIA_MINION] },
    ],
  });

  // Share the same site instance between both companies (required for merge to be viable).
  const sharedSite = built.players[0].companies[0].currentSite!;
  return {
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
}

describe('Orders from the Great Demon (ba-70)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playable on a company ─────────────────────────────────────────

  test('play-permanent-event action generated with targetCompanyId during organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: MORIA_MINION, characters: [ORC_CAPTAIN] }], hand: [ORDERS_FROM_THE_GREAT_DEMON], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MORIA_MINION] },
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
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: MORIA_MINION, characters: [ORC_CAPTAIN] }], hand: [ORDERS_FROM_THE_GREAT_DEMON], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MORIA_MINION] },
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

  // ── Rule 3: Company may contain an additional leader ──────────────────────

  test('merge-companies is blocked for two leaders without Orders from the Great Demon', () => {
    const state = twoBalrogCompaniesAt(MORIA_MINION, [ORC_CAPTAIN], [GORBAG]);
    const mergeActions = viableActions(state, PLAYER_1, 'merge-companies');
    expect(mergeActions).toHaveLength(0);
  });

  test('merge-companies is viable for two leaders (any race) when Orders from the Great Demon is active', () => {
    const state = twoBalrogCompaniesAt(MORIA_MINION, [ORC_CAPTAIN], [GORBAG]);
    const company0Id = companyIdAt(state, RESOURCE_PLAYER);
    const withCard = addCardInPlay(state, RESOURCE_PLAYER, ORDERS_FROM_THE_GREAT_DEMON, company0Id);

    const company1Id = `company-${PLAYER_1 as string}-1` as CompanyId;
    const mergeActions = viableActions(withCard, PLAYER_1, 'merge-companies') as { action: MergeCompaniesAction }[];

    const leaderMerge = mergeActions.find(
      ea => ea.action.sourceCompanyId === company1Id && ea.action.targetCompanyId === company0Id,
    );
    expect(leaderMerge).toBeDefined();
  });

  // ── Rule 4: Additional leader does not count toward company-size maximum ──

  test('merge-companies is blocked when the merged company would exceed size 7 without the event', () => {
    // Company 0: 7 characters (1 leader + 6 non-leader fillers) at a non-haven site.
    const state = twoBalrogCompaniesAt(
      MORIA_MINION,
      [ORC_CAPTAIN, LAGDUF, MUZGASH, ORC_BRAWLER, ORC_VETERAN, ORC_CHIEFTAIN, SNAGA],
      [TROLL_LOUT],
    );
    const mergeActions = viableActions(state, PLAYER_1, 'merge-companies');
    expect(mergeActions).toHaveLength(0);
  });

  test('merge-companies is viable at size 8 when Orders from the Great Demon exempts the leader', () => {
    const state = twoBalrogCompaniesAt(
      MORIA_MINION,
      [ORC_CAPTAIN, LAGDUF, MUZGASH, ORC_BRAWLER, ORC_VETERAN, ORC_CHIEFTAIN, SNAGA],
      [TROLL_LOUT],
    );
    const company0Id = companyIdAt(state, RESOURCE_PLAYER);
    const withCard = addCardInPlay(state, RESOURCE_PLAYER, ORDERS_FROM_THE_GREAT_DEMON, company0Id);

    const company1Id = `company-${PLAYER_1 as string}-1` as CompanyId;
    const mergeActions = viableActions(withCard, PLAYER_1, 'merge-companies') as { action: MergeCompaniesAction }[];

    const sizeMerge = mergeActions.find(
      ea => ea.action.sourceCompanyId === company1Id && ea.action.targetCompanyId === company0Id,
    );
    expect(sizeMerge).toBeDefined();
  });

  // ── Rule 2: May be placed from play deck during item-draft in lieu of a minor item ──

  test('place-starting-company-event action offered during item draft when Orders from the Great Demon is in play deck', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Balrog,
          draftPool: [PERCHEN, OLD_TREASURE],
          playDeck: [ORDERS_FROM_THE_GREAT_DEMON],
          siteDeck: [MORIA_MINION, DOL_GULDUR, VARIAG_CAMP],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Ringwraith,
          draftPool: [ASTERNAK],
          playDeck: [],
          siteDeck: [DOL_GULDUR, MORIA_MINION, VARIAG_CAMP],
          sideboard: [],
        },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, PERCHEN) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ASTERNAK) },
      { type: 'draft-stop', player: PLAYER_1 },
    ]);

    expect(state.phaseState.phase).toBe('setup');
    if (state.phaseState.phase !== 'setup') return;
    expect(state.phaseState.setupStep.step).toBe(SetupStep.ItemDraft);

    const actions = computeLegalActions(state, PLAYER_1);
    const placeActions = actions.filter(a => a.viable && a.action.type === 'place-starting-company-event');
    expect(placeActions.length).toBeGreaterThanOrEqual(1);
    if (placeActions.length === 0) return;
    expect((placeActions[0].action as { cardDefId: CardDefinitionId }).cardDefId).toBe(ORDERS_FROM_THE_GREAT_DEMON);
  });

  test('placed Orders from the Great Demon is in cardsInPlay bound to the company after setup', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Balrog,
          draftPool: [PERCHEN, OLD_TREASURE],
          playDeck: [ORDERS_FROM_THE_GREAT_DEMON],
          siteDeck: [MORIA_MINION, DOL_GULDUR, VARIAG_CAMP],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Ringwraith,
          draftPool: [ASTERNAK],
          playDeck: [],
          siteDeck: [DOL_GULDUR, MORIA_MINION, VARIAG_CAMP],
          sideboard: [],
        },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, PERCHEN) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ASTERNAK) },
      { type: 'draft-stop', player: PLAYER_1 },
    ]);

    if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== SetupStep.ItemDraft) return;
    const companyId = state.players[0].companies[0].id;
    const placeActions = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'place-starting-company-event',
    );
    if (placeActions.length === 0) return;

    state = dispatch(state, placeActions[0].action);

    expect(state.players[0].cardsInPlay.some(
      c => c.definitionId === ORDERS_FROM_THE_GREAT_DEMON && c.companyId === companyId,
    )).toBe(true);
    expect(state.players[0].playDeck.some(c => c.definitionId === ORDERS_FROM_THE_GREAT_DEMON)).toBe(false);
  });

  // ── Regression: a starting-company-placement resource left in the starting
  //    company pool is a resource-event with the `starting-item` keyword, so
  //    setup sinks it to the sideboard. It must still be offered (and placeable)
  //    during item-draft rather than silently vanishing from the starting
  //    company (bug report game mrhx2tb7-9vcj4g). ──

  test('Balrog starting resource left in the draft pool is offered and placeable from the sideboard', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Balrog,
          // Placement card is part of the starting company (draft pool), not the
          // play deck — the real-game scenario. It never gets drafted (it is an
          // event, not a character) so setup sinks it to the sideboard.
          draftPool: [PERCHEN, ORDERS_FROM_THE_GREAT_DEMON],
          playDeck: [],
          siteDeck: [MORIA_MINION, DOL_GULDUR, VARIAG_CAMP],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Ringwraith,
          draftPool: [ASTERNAK],
          playDeck: [],
          siteDeck: [DOL_GULDUR, MORIA_MINION, VARIAG_CAMP],
          sideboard: [],
        },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, PERCHEN) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ASTERNAK) },
      { type: 'draft-stop', player: PLAYER_1 },
    ]);

    // The card was sunk to the sideboard during setup.
    expect(state.players[0].sideboard.some(c => c.definitionId === ORDERS_FROM_THE_GREAT_DEMON)).toBe(true);

    // Item-draft must stay open for P1 so the placement can be offered.
    expect(state.phaseState.phase).toBe('setup');
    if (state.phaseState.phase !== 'setup') return;
    expect(state.phaseState.setupStep.step).toBe(SetupStep.ItemDraft);

    const placeActions = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'place-starting-company-event',
    );
    expect(placeActions.length).toBeGreaterThanOrEqual(1);
    expect((placeActions[0].action as { cardDefId: CardDefinitionId }).cardDefId).toBe(ORDERS_FROM_THE_GREAT_DEMON);

    const companyId = state.players[0].companies[0].id;
    state = dispatch(state, placeActions[0].action);

    // Placed into play, bound to the company, and removed from the sideboard.
    expect(state.players[0].cardsInPlay.some(
      c => c.definitionId === ORDERS_FROM_THE_GREAT_DEMON && c.companyId === companyId,
    )).toBe(true);
    expect(state.players[0].sideboard.some(c => c.definitionId === ORDERS_FROM_THE_GREAT_DEMON)).toBe(false);
  });
});
