/**
 * @module as-1.test
 *
 * Card test: Bûrat (as-1)
 * Type: minion-character (ringwraith)
 * Prowess 5 / Body 8 / Mind 4 / DI 0 / MP 1
 * Skills: warrior, ranger
 * Race: troll
 * Homesite: Any non-Under-deeps Ruins & Lairs
 *
 * "Unique. Manifestation of 'Bert'. May not be included with a starting
 *  company. May be played on the same turn Tûma and/or Wûluag is played,
 *  without counting against the one character per turn limit. Discard on a
 *  body check result of 8. +1 prowess against Dwarves. Tap Bûrat to untap
 *  Tûma or Wûluag if at the same site. If Tûma and/or Wûluag is in his
 *  company, Bûrat's mind is reduced by one."
 *
 * | # | Effect                                              | Status      | Notes                                 |
 * |---|-----------------------------------------------------|-------------|---------------------------------------|
 * | 1 | not-starting-character (play-flag)                  | IMPLEMENTED | blocked at draft                      |
 * | 2 | buddy-play with Tûma/Wûluag (play-flag)             | IMPLEMENTED | buddyGroupPlayedThisTurn mechanism    |
 * | 3 | discardBodyCheck: [8] (structural)                  | IMPLEMENTED | engine handles structurally           |
 * | 4 | +1 prowess vs Dwarves (stat-modifier)               | IMPLEMENTED | enemy.race=dwarf condition            |
 * | 5 | tap to untap Tûma/Wûluag at same site (grant-action)| IMPLEMENTED | characters-at-site scope              |
 * | 6 | mind -1 when Tûma/Wûluag in company (stat-modifier) | IMPLEMENTED | companionDefinitionIds condition       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN,
  Alignment,
  buildTestState, resetMint,
  findCharInstanceId,
  Phase,
  createGame, makePlayDeck, pool, draftInstId,
  RESOURCE_PLAYER,
  dispatch, getCharacter, actionAs, CardStatus,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, GameConfig, ActivateGrantedAction, GameState } from '../../index.js';
import { computeLegalActions, Race } from '../../index.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';

const BURAT = 'as-1' as CardDefinitionId;
const TUMA = 'as-5' as CardDefinitionId;
const WULUAG = 'as-6' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;

// Minion sites for draft and company setup
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // darkhaven
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // darkhaven
const ETTENMOORS = 'le-373' as CardDefinitionId;    // ruins-and-lairs (minion)

describe('Bûrat (as-1)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: cannot be drafted as a starting character ──────────────────────

  test('cannot be drafted as a starting character', () => {
    // Bûrat carries the not-starting-character play-flag.  When he appears in
    // the draft pool the legal action for picking him must be non-viable.
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Ringwraith,
          draftPool: [BURAT, PERCHEN, MIONID],
          playDeck: makePlayDeck(),
          siteDeck: [MINAS_MORGUL, DOL_GULDUR, ETTENMOORS],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN, LEGOLAS],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    const state = createGame(config, pool);
    const buratInstId = draftInstId(state, 0, BURAT);

    const actions = computeLegalActions(state, PLAYER_1);
    const buratPick = actions.find(
      ea => ea.action.type === 'draft-pick'
        && ea.action.characterInstanceId === buratInstId,
    );

    expect(buratPick).toBeDefined();
    expect(buratPick!.viable).toBe(false);
  });

  // ── Effect 2: buddy-play with Tûma / Wûluag ──────────────────────────────────

  test('Bûrat may be played on same turn as Tûma (co-play exception)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [TUMA] }],
          hand: [BURAT],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const stateAfterTuma: GameState = {
      ...state,
      phaseState: {
        phase: Phase.Organization,
        characterPlayedThisTurn: true,
        buddyGroupPlayedThisTurn: ['as-1', 'as-5', 'as-6'],
        sideboardFetchedThisTurn: 0,
        sideboardFetchDestination: null,
      } as GameState['phaseState'],
    };

    const actions = computeLegalActions(stateAfterTuma, PLAYER_1);
    const buratPlayActions = actions.filter(a => a.viable && a.action.type === 'play-character');
    expect(buratPlayActions.length).toBeGreaterThan(0);
  });

  test('Bûrat is blocked when a non-companion character was played this turn', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [MIONID] }],
          hand: [BURAT],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const stateAfterMionid: GameState = {
      ...state,
      phaseState: {
        phase: Phase.Organization,
        characterPlayedThisTurn: true,
        sideboardFetchedThisTurn: 0,
        sideboardFetchDestination: null,
      } as GameState['phaseState'],
    };

    const actions = computeLegalActions(stateAfterMionid, PLAYER_1);
    const buratPlayActions = actions.filter(a => a.viable && a.action.type === 'play-character');
    expect(buratPlayActions).toHaveLength(0);
  });

  // ── Effect 4: +1 prowess against Dwarves ─────────────────────────────────────

  test('+1 prowess in combat against Dwarves', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [BURAT] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const buratId = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    const burat = state.players[RESOURCE_PLAYER].characters[buratId];
    const buratDef = state.cardPool[burat.definitionId] as CharacterCard;

    expect(computeCombatProwess(state, burat, buratDef, Race.Dwarf)).toBe(buratDef.prowess + 1);
  });

  test('no prowess bonus against non-Dwarf enemies', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [BURAT] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const buratId = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    const burat = state.players[RESOURCE_PLAYER].characters[buratId];
    const buratDef = state.cardPool[burat.definitionId] as CharacterCard;

    expect(computeCombatProwess(state, burat, buratDef, Race.Orc)).toBe(buratDef.prowess);
    expect(computeCombatProwess(state, burat, buratDef, Race.Elf)).toBe(buratDef.prowess);
    expect(computeCombatProwess(state, burat, buratDef, Race.Troll)).toBe(buratDef.prowess);
  });

  // ── Effect 5: tap Bûrat to untap Tûma or Wûluag ──────────────────────────────

  test('untap-companion-at-site action available when Tûma is tapped in same company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [BURAT, { defId: TUMA, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const untapActions = actions.filter(
      a => a.viable
        && a.action.type === 'activate-granted-action'
        && actionAs<ActivateGrantedAction>(a.action).actionId === 'untap-companion-at-site',
    );
    expect(untapActions).toHaveLength(1);
    const tumaId = findCharInstanceId(state, RESOURCE_PLAYER, TUMA);
    expect(actionAs<ActivateGrantedAction>(untapActions[0].action).targetCardId).toBe(tumaId);
  });

  test('tapping Bûrat untaps Tûma', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [BURAT, { defId: TUMA, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const untapAction = actions.find(
      a => a.viable
        && a.action.type === 'activate-granted-action'
        && actionAs<ActivateGrantedAction>(a.action).actionId === 'untap-companion-at-site',
    );
    expect(untapAction).toBeDefined();

    const afterUntap = dispatch(state, untapAction!.action);
    expect(getCharacter(afterUntap, RESOURCE_PLAYER, BURAT).status).toBe(CardStatus.Tapped);
    expect(getCharacter(afterUntap, RESOURCE_PLAYER, TUMA).status).toBe(CardStatus.Untapped);
  });

  test('untap action not available when no companion is tapped', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [BURAT, TUMA] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const untapActions = actions.filter(
      a => a.action.type === 'activate-granted-action'
        && actionAs<ActivateGrantedAction>(a.action).actionId === 'untap-companion-at-site',
    );
    expect(untapActions).toHaveLength(0);
  });

  test('untap action not available when Bûrat is tapped', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: BURAT, status: CardStatus.Tapped }, { defId: TUMA, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const untapActions = actions.filter(
      a => a.action.type === 'activate-granted-action'
        && actionAs<ActivateGrantedAction>(a.action).actionId === 'untap-companion-at-site',
    );
    expect(untapActions).toHaveLength(0);
  });

  // ── Effect 6: mind -1 when Tûma or Wûluag in company ────────────────────────

  test('effective mind is 3 (reduced from 4) when Tûma is in the same company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [BURAT, TUMA] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, BURAT).effectiveStats.mind).toBe(3);
  });

  test('effective mind is 3 (reduced from 4) when Wûluag is in the same company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [BURAT, WULUAG] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, BURAT).effectiveStats.mind).toBe(3);
  });

  test('mind is not reduced when Bûrat is alone in company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [BURAT] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, BURAT).effectiveStats.mind).toBeUndefined();
  });
});
