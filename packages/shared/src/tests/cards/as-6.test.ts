/**
 * @module as-6.test
 *
 * Card test: Wûluag (as-6)
 * Type: minion-character (ringwraith)
 * Prowess 5 / Body 8 / Mind 4 / DI 0 / MP 1
 * Race: troll | Skills: warrior, scout
 *
 * Card text (relevant effects implemented):
 *   "Unique. Manifestation of 'William'. May not be included with a starting company.
 *    May be played on the same turn Bûrat and/or Tûma is played, without counting
 *    against the one character per turn limit. Discard on a body check result of 8.
 *    +1 prowess against Dwarves. Tap Wûluag to untap Bûrat or Tûma if at the same
 *    site. If Bûrat and/or Tûma is in his company, Wûluag's mind is reduced by one."
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                                         |
 * |---|-------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | not-starting-character                    | IMPLEMENTED | play-flag not-starting-character              |
 * | 2 | buddy-play (Bûrat/Tûma same-turn limit)   | IMPLEMENTED | play-flag buddy-play + buddyGroupPlayedThisTurn|
 * | 3 | +1 prowess vs Dwarves                     | IMPLEMENTED | stat-modifier prowess +1 when enemy.race=dwarf |
 * | 4 | Tap to untap Bûrat or Tûma at same site   | IMPLEMENTED | grant-action untap-companion-at-site          |
 * | 5 | Mind -1 when Bûrat or Tûma in company     | IMPLEMENTED | stat-modifier mind -1 with companion context  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint, Phase,
  findCharInstanceId, findHandCardId, getCharacter,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  dispatch, viableActions,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  pool,
  Alignment,
  createGame,
  makePlayDeck,
  draftInstId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { computeCombatProwess, recomputeDerived } from '../../engine/recompute-derived.js';
import type {
  CardDefinitionId,
  CharacterCard,
  GameConfig,
  ActivateGrantedAction,
  OrganizationPhaseState,
} from '../../index.js';
import { CardStatus, Race } from '../../index.js';

// ── Card under test ──────────────────────────────────────────────────────────
const WULUAG = 'as-6' as CardDefinitionId;  // prowess 5, mind 4, warrior+scout
const BURAT = 'as-1' as CardDefinitionId;   // prowess 5, mind 4, warrior+ranger
const TUMA = 'as-5' as CardDefinitionId;    // prowess 6, mind 4, warrior

// ── Minion sites ─────────────────────────────────────────────────────────────
const DOL_GULDUR = 'le-367' as CardDefinitionId;       // minion haven (darkhaven)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;     // minion haven (darkhaven)
const ETTENMOORS = 'le-373' as CardDefinitionId;       // minion ruins-and-lairs

// ── Minion characters (fixtures for second player, non-trolls) ───────────────
const GORBAG = 'le-11' as CardDefinitionId;            // orc, warrior+scout
const ADUNAPHEL = 'le-50' as CardDefinitionId;         // ringwraith avatar

describe('Wûluag (as-6)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: not-starting-character ─────────────────────────────────────

  test('cannot be drafted as a starting character', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Ringwraith,
          draftPool: [GORBAG, WULUAG, BURAT],
          playDeck: makePlayDeck(),
          siteDeck: [DOL_GULDUR, ETTENMOORS, MINAS_MORGUL],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Ringwraith,
          draftPool: [ADUNAPHEL, GORBAG, TUMA],
          playDeck: makePlayDeck(),
          siteDeck: [MINAS_MORGUL, ETTENMOORS],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    const state = createGame(config, pool);
    const wuluagInstId = draftInstId(state, 0, WULUAG);
    const actions = computeLegalActions(state, PLAYER_1);
    const wuluagPick = actions.find(
      ea => ea.action.type === 'draft-pick'
        && (ea.action as { characterInstanceId: string }).characterInstanceId === wuluagInstId,
    );
    expect(wuluagPick).toBeDefined();
    expect(wuluagPick!.viable).toBe(false);
    expect(wuluagPick!.reason).toMatch(/may not be one of the starting characters/);
  });

  // ── Effect 2: buddy-play — may be played same turn as Bûrat or Tûma ───────

  test('after Bûrat is played, Wûluag may also be played in the same turn', () => {
    // P1 has Bûrat in a company (already played) and Wûluag in hand.
    // Simulate characterPlayedThisTurn=true with Bûrat's id in buddyGroupPlayedThisTurn.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [BURAT] }],
          hand: [WULUAG],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    // Manually set characterPlayedThisTurn=true and buddyGroupPlayedThisTurn with Bûrat's id.
    const stateAfterBurat: typeof base = {
      ...base,
      phaseState: {
        ...(base.phaseState as OrganizationPhaseState),
        characterPlayedThisTurn: true,
        buddyGroupPlayedThisTurn: ['as-1', 'as-5', 'as-6'],
      } as OrganizationPhaseState,
    };

    // Wûluag should still be viable despite characterPlayedThisTurn=true
    const viable = viablePlayCharacterActions(stateAfterBurat, PLAYER_1);
    const wuluagInstId = findHandCardId(stateAfterBurat, RESOURCE_PLAYER, WULUAG);
    const wuluagPlay = viable.find(a => a.characterInstanceId === wuluagInstId);
    expect(wuluagPlay).toBeDefined();
  });

  test('without buddy-play group active, Wûluag is blocked after another character is played', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [GORBAG] }],
          hand: [WULUAG],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    // Simulate a non-buddy character was played (Gorbag, not a troll trio member)
    const stateAfterOther: typeof base = {
      ...base,
      phaseState: {
        ...(base.phaseState as OrganizationPhaseState),
        characterPlayedThisTurn: true,
        // buddyGroupPlayedThisTurn is absent — no buddy group
      } as OrganizationPhaseState,
    };

    // nonViablePlayCharacterActions returns PlayCharacterAction[]
    // We verify that Wûluag is not in the viable set but is in the non-viable set.
    const blocked = nonViablePlayCharacterActions(stateAfterOther, PLAYER_1);
    const wuluagInstId2 = findHandCardId(stateAfterOther, RESOURCE_PLAYER, WULUAG);
    const wuluagBlock = blocked.find(a => a.characterInstanceId === wuluagInstId2);
    expect(wuluagBlock).toBeDefined();
    // Also confirm no viable play action for Wûluag exists
    const viableOther = viablePlayCharacterActions(stateAfterOther, PLAYER_1);
    expect(viableOther.find(a => a.characterInstanceId === wuluagInstId2)).toBeUndefined();
  });

  test('playing Wûluag records buddy group in phaseState', () => {
    // Build a state where Wûluag is in hand, nothing played yet.
    // Site deck must have a ruins-and-lairs site (Wûluag's homesite type).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [],
          hand: [WULUAG],
          siteDeck: [ETTENMOORS, DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const playActions = viablePlayCharacterActions(base, PLAYER_1);
    expect(playActions.length).toBeGreaterThan(0);

    const afterPlay = dispatch(base, playActions[0]);
    const phaseState = afterPlay.phaseState as OrganizationPhaseState;
    expect(phaseState.characterPlayedThisTurn).toBe(true);
    // buddyGroupPlayedThisTurn should include all three troll IDs
    expect(phaseState.buddyGroupPlayedThisTurn).toContain('as-6');
    expect(phaseState.buddyGroupPlayedThisTurn).toContain('as-1');
    expect(phaseState.buddyGroupPlayedThisTurn).toContain('as-5');
  });

  // ── Effect 3: +1 prowess vs Dwarves ──────────────────────────────────────

  test('+1 prowess in combat against Dwarves', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ETTENMOORS, characters: [WULUAG] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const wuluagId = findCharInstanceId(state, RESOURCE_PLAYER, WULUAG);
    const wuluag = state.players[RESOURCE_PLAYER].characters[wuluagId];
    const wuluagDef = pool[WULUAG as string] as CharacterCard;

    // +1 prowess vs dwarf
    expect(computeCombatProwess(state, wuluag, wuluagDef, Race.Dwarf)).toBe(wuluagDef.prowess + 1);
    // No bonus vs other races
    expect(computeCombatProwess(state, wuluag, wuluagDef, Race.Orc)).toBe(wuluagDef.prowess);
    expect(computeCombatProwess(state, wuluag, wuluagDef, Race.Man)).toBe(wuluagDef.prowess);
    expect(computeCombatProwess(state, wuluag, wuluagDef, Race.Troll)).toBe(wuluagDef.prowess);
  });

  // ── Effect 4: Tap to untap Bûrat or Tûma at the same site ────────────────

  test('Wûluag may tap to untap Tûma when Tûma is tapped at the same site', () => {
    // Both Wûluag and Tûma are at the same site; Tûma is tapped.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [WULUAG, TUMA] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    // Tap Tûma so she can be untapped
    const tumaId = findCharInstanceId(base, RESOURCE_PLAYER, TUMA);
    const tapped: typeof base = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          characters: {
            ...base.players[RESOURCE_PLAYER].characters,
            [tumaId]: { ...base.players[RESOURCE_PLAYER].characters[tumaId], status: CardStatus.Tapped },
          },
        },
        base.players[HAZARD_PLAYER],
      ] as typeof base.players,
    };

    const grantedActions = viableActions(tapped, PLAYER_1, 'activate-granted-action');
    const untapAction = grantedActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'untap-companion-at-site'
        && (ea.action as ActivateGrantedAction).targetCardId === tumaId,
    );
    expect(untapAction).toBeDefined();

    // Execute the action: Wûluag taps, Tûma untaps
    const wuluagId = findCharInstanceId(tapped, RESOURCE_PLAYER, WULUAG);
    const afterUntap = dispatch(tapped, untapAction!.action);

    expect(getCharacter(afterUntap, RESOURCE_PLAYER, WULUAG).status).toBe(CardStatus.Tapped);
    expect(getCharacter(afterUntap, RESOURCE_PLAYER, TUMA).status).toBe(CardStatus.Untapped);
    void wuluagId;
  });

  test('untap action not offered when Bûrat/Tûma are not at the same site', () => {
    // Wûluag at Ettenmoors alone; neither companion is at that site
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [WULUAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const grantedActions = viableActions(base, PLAYER_1, 'activate-granted-action');
    const untapActions = grantedActions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'untap-companion-at-site',
    );
    expect(untapActions).toHaveLength(0);
  });

  test('untap action not offered when companion is already untapped', () => {
    // Tûma is at the same site but untapped — nothing to untap
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [WULUAG, TUMA] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    // Both Wûluag and Tûma start untapped in buildTestState
    const grantedActions = viableActions(base, PLAYER_1, 'activate-granted-action');
    const untapActions = grantedActions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'untap-companion-at-site',
    );
    expect(untapActions).toHaveLength(0);
  });

  // ── Effect 5: Mind -1 when Bûrat or Tûma is in company ────────────────────

  test("Wûluag's GI cost is reduced by 1 (mind 3) when Tûma is in the same company", () => {
    // Without Tûma: Wûluag costs mind=4 GI
    const withoutTuma = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [WULUAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    expect(withoutTuma.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(4);

    // With Tûma in the same company: Wûluag's mind becomes 3 → GI used drops by 1.
    // Tûma also has mind 4 → 4 + 3 = 7 total GI used (vs 4+4=8 without reduction).
    const withTuma = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [WULUAG, TUMA] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    }));
    // Wûluag mind 4 - 1 = 3, Tûma mind 4 - 1 (Wûluag in company) = 3 → total 6
    // (Both trolls reduce each other's mind)
    expect(withTuma.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(6);
  });

  test("Wûluag's GI cost is reduced when Bûrat is in the same company", () => {
    const withBurat = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [WULUAG, BURAT] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    }));
    // Wûluag mind 4 - 1 = 3, Bûrat mind 4 - 1 = 3 → total 6
    expect(withBurat.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(6);
  });

  test('all three trolls together: each has mind 3, total GI used 9', () => {
    const withAll = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [WULUAG, BURAT, TUMA] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    }));
    // Each troll has mind 4 - 1 = 3, total = 9
    expect(withAll.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(9);
  });

  test('mind bonus does NOT apply when Bûrat/Tûma is not in company', () => {
    // Wûluag alone in company: mind stays at 4
    const withWuluag = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [WULUAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    }));
    expect(withWuluag.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(4);
  });
});
