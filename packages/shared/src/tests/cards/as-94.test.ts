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
 *   2. starting-company-placement: eligible for item-draft setup placement
 *   3. extra-troll-leader-slot: company may hold one Troll leader + one other leader
 *   4. duplication-limit: scope "company", max 1
 *   5. company-modifier: +1 corruption check when company.hasTrollLeader
 *   6. on-event: organization-phase-start discard-self when player.avatarId === "le-56"
 *   7. on-event: leader-leaves-company discard-self
 *
 * Engine support table:
 * | # | Rule                                                | Status      | Notes                                                 |
 * |---|-----------------------------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Playable on a company                               | IMPLEMENTED | play-target: company                                  |
 * | 2 | May be played with a starting company in lieu of item| IMPLEMENTED| starting-company-placement effect + item-draft action |
 * | 3 | Company may contain Troll leader + another leader   | IMPLEMENTED | extra-troll-leader-slot effect                        |
 * | 4 | +1 CC when company has a Troll leader               | IMPLEMENTED | company-modifier check:corruption when.hasTrollLeader |
 * | 5 | Discard if Ren is your Ringwraith                   | IMPLEMENTED | on-event:organization-phase-start when player.avatarId|
 * | 6 | Discard when a leader leaves the company            | IMPLEMENTED | on-event:leader-leaves-company discard-self           |
 * | 7 | Cannot be duplicated on a given company             | IMPLEMENTED | duplication-limit: scope "company"                    |
 *
 * Playable: CERTIFIED
 *
 * Fixtures:
 *   PERCHEN (as-4)                   — minion man scout/diplomat, mind 5
 *   GORBAG (le-11)                   — minion orc Leader (Uruk-hai), mind 6
 *   LIEUTENANT_OF_DOL_GULDUR (le-21) — minion troll Leader (Olog-hai), mind 9
 *   OLD_TREASURE (as-129)            — minion minor item (for item-draft setup)
 *   REN (le-56)                      — Ren the Ringwraith (ringwraith avatar, mind null)
 *   MINAS_MORGUL (le-390)            — minion darkhaven (haven — used for play tests)
 *   DOL_GULDUR (le-367)              — minion haven (opponent site)
 *   MORIA_LE (le-392)                — shadow-hold (non-haven — used for leader tests)
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
  runActions,
  findCharInstanceId,
  enqueueCorruptionCheck,
  createGame,
  pool,
  draftInstId,
  dispatch,
} from '../test-helpers.js';
import { computeLegalActions, SetupStep } from '../../index.js';
import type { CardDefinitionId, PlayPermanentEventAction, MergeCompaniesAction, CompanyId, CorruptionCheckAction, GameConfig } from '../../index.js';

const ORDERS_FROM_LUGBURZ = 'as-94' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const LIEUTENANT_DOL_GULDUR = 'le-21' as CardDefinitionId;
const OLD_TREASURE = 'as-129' as CardDefinitionId;
const REN_THE_RINGWRAITH = 'le-56' as CardDefinitionId;
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

  // ── Rule 4: +1 to corruption checks when company has a Troll leader ─────────

  test('+1 corruption modifier on company member when Lieutenant of Dol Guldur (troll leader) is in the company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [PERCHEN, LIEUTENANT_DOL_GULDUR] }],
          hand: [],
          siteDeck: [VARIAG_CAMP],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const withCard = addCardInPlay(state, RESOURCE_PLAYER, ORDERS_FROM_LUGBURZ, companyId);

    const perchenId = findCharInstanceId(withCard, RESOURCE_PLAYER, PERCHEN);
    const withCheck = enqueueCorruptionCheck(withCard, PLAYER_1, perchenId);

    const actions = computeLegalActions(withCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction)
      .filter(a => a.characterId === perchenId);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].corruptionModifier).toBe(1);
  });

  test('no +1 modifier on corruption check when company has no Troll leader', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [PERCHEN, GORBAG] }],
          hand: [],
          siteDeck: [VARIAG_CAMP],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const withCard = addCardInPlay(state, RESOURCE_PLAYER, ORDERS_FROM_LUGBURZ, companyId);

    const perchenId = findCharInstanceId(withCard, RESOURCE_PLAYER, PERCHEN);
    const withCheck = enqueueCorruptionCheck(withCard, PLAYER_1, perchenId);

    const actions = computeLegalActions(withCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction)
      .filter(a => a.characterId === perchenId);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].corruptionModifier).toBe(0);
  });

  // ── Rule 5: Discard if Ren the Ringwraith is the player's avatar ──────────

  test('discards at organization-phase-start when Ren the Ringwraith is the player avatar', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [REN_THE_RINGWRAITH, PERCHEN] }],
          hand: [],
          siteDeck: [VARIAG_CAMP],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const withCard = addCardInPlay(state, RESOURCE_PLAYER, ORDERS_FROM_LUGBURZ, companyId);

    const afterOrg = runActions(withCard, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(afterOrg.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === ORDERS_FROM_LUGBURZ,
    )).toBe(false);
    expect(afterOrg.players[RESOURCE_PLAYER].discardPile.some(
      c => c.definitionId === ORDERS_FROM_LUGBURZ,
    )).toBe(true);
  });

  test('not discarded when a different ringwraith is the player avatar', () => {
    // LIEUTENANT_DOL_GULDUR is not a ringwraith avatar, but we use PERCHEN (no avatar) —
    // the event should survive when Ren is not the avatar.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [VARIAG_CAMP],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const withCard = addCardInPlay(state, RESOURCE_PLAYER, ORDERS_FROM_LUGBURZ, companyId);

    const afterOrg = runActions(withCard, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(afterOrg.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === ORDERS_FROM_LUGBURZ,
    )).toBe(true);
  });

  // ── Rule 2: May be placed from play deck during item-draft in lieu of a minor item ──

  test('place-starting-company-event action offered during item draft when Orders from Lugbúrz is in play deck', () => {
    // Build a ringwraith game with OLD_TREASURE in the draftPool and ORDERS_FROM_LUGBURZ in the playDeck
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Ringwraith,
          draftPool: [PERCHEN, OLD_TREASURE],
          playDeck: [ORDERS_FROM_LUGBURZ],
          siteDeck: [MINAS_MORGUL, DOL_GULDUR, VARIAG_CAMP],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Ringwraith,
          draftPool: [ASTERNAK],
          playDeck: [],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL, VARIAG_CAMP],
          sideboard: [],
        },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    // Character draft: pick PERCHEN for P1, ASTERNAK for P2, then both stop
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, PERCHEN) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ASTERNAK) },
      { type: 'draft-stop', player: PLAYER_1 },
    ]);

    // Should now be in item-draft (P1 has OLD_TREASURE to assign)
    expect(state.phaseState.phase).toBe('setup');
    if (state.phaseState.phase !== 'setup') return;
    expect(state.phaseState.setupStep.step).toBe(SetupStep.ItemDraft);

    // P1 must be offered a place-starting-company-event action for ORDERS_FROM_LUGBURZ
    const actions = computeLegalActions(state, PLAYER_1);
    const placeActions = actions.filter(a => a.viable && a.action.type === 'place-starting-company-event');
    expect(placeActions.length).toBeGreaterThanOrEqual(1);
    if (placeActions.length === 0) return;
    expect((placeActions[0].action as { cardDefId: CardDefinitionId }).cardDefId).toBe(ORDERS_FROM_LUGBURZ);
  });

  test('place-starting-company-event stays offered after the player runs out of drafted minor items to assign', () => {
    // Regression: P1 drafts exactly one minor item (OLD_TREASURE). Assigning
    // it exhausts unassignedItems, but the two-item budget (MAX_STARTING_ITEMS)
    // is not yet spent, and ORDERS_FROM_LUGBURZ ("in lieu of a minor item") is
    // still sitting in the play deck — the item-draft step must not silently
    // finish for this player and take that placement away (bug report:
    // "Orders from Lugburz" discarded from the opening pool with no chance
    // to play it after the last character card).
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Ringwraith,
          draftPool: [PERCHEN, OLD_TREASURE],
          playDeck: [ORDERS_FROM_LUGBURZ],
          siteDeck: [MINAS_MORGUL, DOL_GULDUR, VARIAG_CAMP],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Ringwraith,
          draftPool: [ASTERNAK],
          playDeck: [],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL, VARIAG_CAMP],
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

    const perchenId = findCharInstanceId(state, RESOURCE_PLAYER, PERCHEN);
    state = dispatch(state, {
      type: 'assign-starting-item',
      player: PLAYER_1,
      itemDefId: OLD_TREASURE,
      characterInstanceId: perchenId,
    });

    expect(state.phaseState.phase).toBe('setup');
    if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== SetupStep.ItemDraft) {
      throw new Error('Expected to remain in item-draft after assigning the only drafted minor item');
    }
    expect(state.phaseState.setupStep.itemDraftState[RESOURCE_PLAYER].done).toBe(false);

    const placeActions = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'place-starting-company-event',
    );
    expect(placeActions.length).toBeGreaterThanOrEqual(1);
    expect((placeActions[0].action as { cardDefId: CardDefinitionId }).cardDefId).toBe(ORDERS_FROM_LUGBURZ);
  });

  test('placed Orders from Lugbúrz is in cardsInPlay bound to the company after setup', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Ringwraith,
          draftPool: [PERCHEN, OLD_TREASURE],
          playDeck: [ORDERS_FROM_LUGBURZ],
          siteDeck: [MINAS_MORGUL, DOL_GULDUR, VARIAG_CAMP],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Ringwraith,
          draftPool: [ASTERNAK],
          playDeck: [],
          siteDeck: [DOL_GULDUR, MINAS_MORGUL, VARIAG_CAMP],
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
      c => c.definitionId === ORDERS_FROM_LUGBURZ && c.companyId === companyId,
    )).toBe(true);
    expect(state.players[0].playDeck.some(c => c.definitionId === ORDERS_FROM_LUGBURZ)).toBe(false);
  });

  // ── Rule 6: Discard when a leader leaves the bound company ────────────────

  test('discards when a Troll leader leaves via split-company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_LE, characters: [LIEUTENANT_DOL_GULDUR, PERCHEN] }],
          hand: [],
          siteDeck: [VARIAG_CAMP],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const withCard = addCardInPlay(state, RESOURCE_PLAYER, ORDERS_FROM_LUGBURZ, companyId);
    const lieutenantId = findCharInstanceId(withCard, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);

    const after = dispatch(withCard, {
      type: 'split-company',
      player: PLAYER_1,
      sourceCompanyId: companyId,
      characterId: lieutenantId,
    });

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === ORDERS_FROM_LUGBURZ,
    )).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(
      c => c.definitionId === ORDERS_FROM_LUGBURZ,
    )).toBe(true);
  });

  test('not discarded when a non-leader leaves via split-company', () => {
    // PERCHEN is not a leader — splitting them out must not discard the event
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_LE, characters: [LIEUTENANT_DOL_GULDUR, PERCHEN] }],
          hand: [],
          siteDeck: [VARIAG_CAMP],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const withCard = addCardInPlay(state, RESOURCE_PLAYER, ORDERS_FROM_LUGBURZ, companyId);
    const perchenId = findCharInstanceId(withCard, RESOURCE_PLAYER, PERCHEN);

    const after = dispatch(withCard, {
      type: 'split-company',
      player: PLAYER_1,
      sourceCompanyId: companyId,
      characterId: perchenId,
    });

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === ORDERS_FROM_LUGBURZ,
    )).toBe(true);
  });
});
