/**
 * @module as-5.test
 *
 * Card test: Tûma (as-5)
 * Type: minion-character
 *
 * Text:
 *   "Unique. Manifestation of 'Tom'. May not be included with a starting company.
 *    May be played on the same turn Bûrat and/or Wûluag is played, without counting
 *    against the one character per turn limit. Discard on a body check result of 8.
 *    +1 prowess against Dwarves. Tap Tûma to untap Bûrat or Wûluag if at the same site.
 *    If Bûrat and/or Wûluag is in his company, Tûma's mind is reduced by one."
 *
 * Effects tested:
 * 1. stat-modifier: +1 prowess in combat when enemy race is dwarf (vs 0 against other races)
 * 2. stat-modifier: -1 mind (effectiveStats.mind = 3) when Bûrat or Wûluag is in company
 * 3. grant-action: tap Tûma to untap a tapped Bûrat or Wûluag in the same company
 * 4. coPlayCompanions: Tûma may be played on the same turn as Bûrat or Wûluag
 *
 * Structural rules covered by engine/data without a dedicated test:
 * - discardBodyCheck: [8] — handled by pending-reducers.ts body-check logic
 * - "May not be included with a starting company" — enforced structurally: homesite
 *   "Any non-Under-deeps Ruins & Lairs" is never a haven, so the character cannot
 *   be placed in a starting company during setup.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  findCharInstanceId, getCharacter, dispatch, actionAs,
  CardStatus, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, computeLegalActions, Race } from '../../index.js';
import type { CardDefinitionId, ActivateGrantedAction, GameState } from '../../index.js';
import { resolveCombatProwessBonus } from '../../engine/effects/index.js';

const TUMA = 'as-5' as CardDefinitionId;
const BURAT = 'as-1' as CardDefinitionId;
const WULUAG = 'as-6' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;
// Dol Guldur (le-367) — minion darkhaven, siteType: "haven"
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Tûma (as-5)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: +1 prowess against Dwarves ────────────────────────────────────

  test('+1 combat prowess bonus against dwarves', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [TUMA] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const tumaChar = getCharacter(state, RESOURCE_PLAYER, TUMA);
    const dwarfEnemy = { race: Race.Dwarf, name: 'Gimli', prowess: 5, body: 9 };
    expect(resolveCombatProwessBonus(state, tumaChar, dwarfEnemy, [])).toBe(1);
  });

  test('combat prowess bonus is 0 against non-dwarf races', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [TUMA] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const tumaChar = getCharacter(state, RESOURCE_PLAYER, TUMA);
    const orcEnemy = { race: Race.Orc, name: 'Gorbag', prowess: 5, body: 7 };
    expect(resolveCombatProwessBonus(state, tumaChar, orcEnemy, [])).toBe(0);
  });

  // ─── Effect 2: mind reduced by 1 when Bûrat or Wûluag in company ─────────────

  test('effective mind is 3 (reduced from 4) when Bûrat is in the same company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [TUMA, BURAT] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, TUMA).effectiveStats.mind).toBe(3);
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
          companies: [{ site: DOL_GULDUR, characters: [TUMA, WULUAG] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(s, RESOURCE_PLAYER, TUMA).effectiveStats.mind).toBe(3);
  });

  test('mind is not reduced when Tûma is alone in company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [TUMA] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    // No companion → mind stat-modifier does not fire → effectiveStats.mind is undefined
    expect(getCharacter(s, RESOURCE_PLAYER, TUMA).effectiveStats.mind).toBeUndefined();
  });

  test('GI usage reflects reduced mind: Bûrat+Tûma together cost 6 GI (3+3) not 8 (4+4)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [TUMA, BURAT] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // dispatch pass triggers recompute that applies effective mind to GI
    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    // Bûrat: mind 4→3 (Tûma in company), Tûma: mind 4→3 (Bûrat in company) → total 6
    expect(s.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(6);
  });

  // ─── Effect 3: tap to untap Bûrat or Wûluag ──────────────────────────────────

  test('untap-companion-at-site action available when Bûrat is tapped in same company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [TUMA, { defId: BURAT, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const untapActions = actions.filter(
      a => a.viable
        && a.action.type === 'activate-granted-action'
        && actionAs<ActivateGrantedAction>(a.action).actionId === 'untap-companion-at-site',
    );
    expect(untapActions).toHaveLength(1);
    // The target must be Bûrat's instance
    const buratId = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    expect(actionAs<ActivateGrantedAction>(untapActions[0].action).targetCardId).toBe(buratId);
  });

  test('tapping Tûma untaps Bûrat', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [TUMA, { defId: BURAT, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
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
    expect(getCharacter(afterUntap, RESOURCE_PLAYER, TUMA).status).toBe(CardStatus.Tapped);
    expect(getCharacter(afterUntap, RESOURCE_PLAYER, BURAT).status).toBe(CardStatus.Untapped);
  });

  test('untap action not available when no companion is tapped', () => {
    // Both Tûma and Bûrat are untapped — no one to untap
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [TUMA, BURAT] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const untapActions = actions.filter(
      a => a.action.type === 'activate-granted-action'
        && actionAs<ActivateGrantedAction>(a.action).actionId === 'untap-companion-at-site',
    );
    expect(untapActions).toHaveLength(0);
  });

  test('untap action not available when Tûma is tapped', () => {
    // Tûma is tapped — cannot pay the tap-self cost
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: TUMA, status: CardStatus.Tapped }, { defId: BURAT, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const untapActions = actions.filter(
      a => a.action.type === 'activate-granted-action'
        && actionAs<ActivateGrantedAction>(a.action).actionId === 'untap-companion-at-site',
    );
    expect(untapActions).toHaveLength(0);
  });

  // ─── Co-play: Tûma may be played same turn as Bûrat/Wûluag ──────────────────

  test('Tûma may be played on same turn as Bûrat (co-play exception)', () => {
    // Bûrat already placed at Dol Guldur; Tûma is in hand.
    // Phase state records that Bûrat (as-1) was played this turn.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [BURAT] }],
          hand: [TUMA],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAfterBurat: GameState = {
      ...state,
      phaseState: {
        phase: Phase.Organization,
        characterPlayedThisTurn: true,
        buddyGroupPlayedThisTurn: ['as-1', 'as-5', 'as-6'],
        sideboardFetchedThisTurn: 0,
        sideboardFetchDestination: null,
      } as GameState['phaseState'],
    };

    const actions = computeLegalActions(stateAfterBurat, PLAYER_1);
    const tumaPlayActions = actions.filter(a => a.viable && a.action.type === 'play-character');
    expect(tumaPlayActions.length).toBeGreaterThan(0);
  });

  test('Tûma is blocked when a non-companion character was played this turn', () => {
    // Mionid (as-3) was played, not a co-play companion of Tûma.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [MIONID] }],
          hand: [TUMA],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAfterMionid: GameState = {
      ...state,
      phaseState: {
        phase: Phase.Organization,
        characterPlayedThisTurn: true,
        // Mîonid is not in any buddy group — buddyGroupPlayedThisTurn is absent
        sideboardFetchedThisTurn: 0,
        sideboardFetchDestination: null,
      } as GameState['phaseState'],
    };

    const actions = computeLegalActions(stateAfterMionid, PLAYER_1);
    const tumaPlayActions = actions.filter(a => a.viable && a.action.type === 'play-character');
    expect(tumaPlayActions).toHaveLength(0);
  });
});
