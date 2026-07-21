/**
 * @module as-162.test
 *
 * Card test: Tolfalas (as-162)
 * Type: minion-site (ruins-and-lairs)
 * Effects: 3
 *   1. on-event: character-wounded-by-self → force corruption check (modifier -2)
 *   2. site-rule: deny-item → any greater item except Scroll of Isildur
 *   3. on-event: site-revealed-as-new-site (overt) → tap-one-character
 *
 * "Nearest Darkhaven: Minas Morgul
 *  Playable: Items (minor, major, greater*) *—Scroll of Isildur only
 *  Automatic-attacks: Undead — 3 strikes with 7 prowess;
 *  each character wounded must make a corruption check modified by -2
 *  Special: An overt company must tap an untapped character (if available)
 *  if this site is revealed as its new site."
 *
 * as-162 is the minion twin of the hero Tolfalas (tw-433) and shares the
 * reveal-tap / -2 corruption machinery of Himring (as-150). Every rule is a
 * shipped primitive:
 *   - the 3-strike / 7-prowess Undead auto-attack is structural data;
 *   - "each character wounded must make a corruption check modified by -2" is
 *     the on-event: character-wounded-by-self → force-check machinery
 *     (Barrow-downs le-353, Himring as-150);
 *   - "greater* — Scroll of Isildur only" is site-rule: deny-item (tw-433);
 *   - the overt reveal-tap is on-event: site-revealed-as-new-site →
 *     tap-one-character gated on `{ "company.covert": false }` (Himring as-150).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                        |
 * | 2 | sitePath          | OK     | [shadow, wilderness, wilderness, coastal]        |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid Darkhaven (le-390)        |
 * | 4 | region            | OK     | "Mouths of the Anduin"                           |
 * | 5 | playableResources | OK     | [minor, major, greater] — greater gated by rule  |
 * | 6 | automaticAttacks  | OK     | Undead, 3 strikes, 7 prowess                     |
 * | 7 | resourceDraws     | OK     | 2                                                |
 * | 8 | hazardDraws       | OK     | 2                                                |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LORIEN,
  resetMint, buildTestState, makeMHState, Phase, Alignment, CardStatus,
  dispatch, viableFor, viableActions,
  buildMinionSitePhaseState, setupAutoAttackStep, runAutoAttackCombatMulti,
  findCharInstanceId, findHandCardId, expectCharStatus,
} from '../test-helpers.js';
import type { CharacterEntry } from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const TOLFALAS = 'as-162' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Gorbag and Shagrat are Orcs — a company containing either is overt.
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;
// The Mouth is a Man — a company of only Men is covert.
const THE_MOUTH = 'le-24' as CardDefinitionId;

const BLACK_MACE = 'le-299' as CardDefinitionId;         // greater item, not Scroll
const HIGH_HELM = 'le-313' as CardDefinitionId;          // major item
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;  // minor item
const IRON_CROWN = 'le-314' as CardDefinitionId;         // greater item, 5 CP, no combat bonus
const SCROLL_OF_ISILDUR = 'tw-323' as CardDefinitionId;  // greater item — the sole exception

/**
 * A Ringwraith-player company at Minas Morgul (Tolfalas's nearest Darkhaven)
 * moving to Tolfalas, stopped at the reveal-new-site step of its
 * movement/hazard phase.
 */
function movingToTolfalas(characters: CharacterEntry[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters, destinationSite: TOLFALAS }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
    ],
  });
  return { ...state, phaseState: makeMHState({ step: 'reveal-new-site', activeCompanyIndex: 0 }) };
}

/** Dispatch the starter-movement declare-path for the company moving to Tolfalas. */
function declareStarterPath(state: GameState): GameState {
  const declare = viableFor(state, PLAYER_1)
    .map(a => a.action)
    .find(a => a.type === 'declare-path' && a.movementType === 'starter');
  expect(declare).toBeDefined();
  return dispatch(state, declare!);
}

describe('Tolfalas (as-162)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 3 strikes and 7 prowess', () => {
    const state = buildMinionSitePhaseState({
      site: TOLFALAS,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }, { defId: THE_MOUTH }],
    });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(3);
    expect(nextState.combat!.strikeProwess).toBe(7);
    expect(nextState.combat!.creatureRace).toBe('undead');
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound → corruption check modified by -2 ───────────────────────────────

  test('a wounded character gets a corruption check modified by -2 after the auto-attack', () => {
    const state = buildMinionSitePhaseState({
      site: TOLFALAS,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }, { defId: THE_MOUTH }],
    });
    const readyState = setupAutoAttackStep(state);

    // Gorbag untapped: prowess 6-3=3, roll 2 → 5 < 7 → wounded; body 9, roll 5
    //   → survives wounded, so the corruption check fires.
    // Shagrat and The Mouth tap to fight at prowess 6, roll 12 → win, no wound.
    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: GORBAG, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: SHAGRAT, roll: 12 },
      { characterDefId: THE_MOUTH, roll: 12 },
    ]);
    expect(result.state.combat).toBeNull();

    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.modifier).toBe(-2);
    expect(pending[0].kind.reason).toBe('Tolfalas');
    expect(pending[0].kind.characterId).toBe(findCharInstanceId(result.state, RESOURCE_PLAYER, GORBAG));
  });

  test('characters that beat the auto-attack strikes get no corruption check', () => {
    const state = buildMinionSitePhaseState({
      site: TOLFALAS,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }, { defId: THE_MOUTH }],
    });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: GORBAG, roll: 12 },
      { characterDefId: SHAGRAT, roll: 12 },
      { characterDefId: THE_MOUTH, roll: 12 },
    ]);
    expect(result.state.combat).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  test('the post-wound corruption check can fail and remove the character from play', () => {
    // The Iron Crown gives 5 CP and no combat bonus; the -2 modifier plus a
    // roll of 2 → 0 vs 5 CP → the corruption check fails and Gorbag leaves play.
    const state = buildMinionSitePhaseState({
      site: TOLFALAS,
      characters: [
        { defId: GORBAG, items: [IRON_CROWN] },
        { defId: SHAGRAT },
        { defId: THE_MOUTH },
      ],
    });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: GORBAG, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: SHAGRAT, roll: 12 },
      { characterDefId: THE_MOUTH, roll: 12 },
    ]);

    const gorbagId = findCharInstanceId(result.state, RESOURCE_PLAYER, GORBAG);
    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    const ccState = dispatch({ ...result.state, cheatRollTotal: 2 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    expect(Object.keys(ccState.players[RESOURCE_PLAYER].characters)).not.toContain(gorbagId as string);
  });

  // ─── Item playability: minor, major, greater* (Scroll of Isildur only) ─────

  test('minor and major items are playable at Tolfalas', () => {
    const state = buildMinionSitePhaseState({
      site: TOLFALAS,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
  });

  test('Scroll of Isildur (greater) is playable at Tolfalas', () => {
    const state = buildMinionSitePhaseState({
      site: TOLFALAS,
      characters: [{ defId: THE_MOUTH }],
      hand: [SCROLL_OF_ISILDUR],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SCROLL_OF_ISILDUR));
  });

  test('a non-Scroll greater item is denied by the site rule', () => {
    const state = buildMinionSitePhaseState({
      site: TOLFALAS,
      characters: [{ defId: THE_MOUTH }],
      hand: [BLACK_MACE],
    });

    const blackMaceId = findHandCardId(state, RESOURCE_PLAYER, BLACK_MACE);
    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);
    expect(playable).not.toContain(blackMaceId);

    const notPlayable = computeLegalActions(state, PLAYER_1)
      .filter(a => !a.viable && a.action.type === 'not-playable'
        && (a.action as { cardInstanceId?: string }).cardInstanceId === blackMaceId);
    expect(notPlayable.length).toBeGreaterThanOrEqual(1);
    expect(notPlayable[0].reason).toContain('Tolfalas');
  });

  // ─── Special: overt company must tap an untapped character on reveal ────────

  test('overt company revealing Tolfalas as its new site must tap one untapped character', () => {
    const state = movingToTolfalas([GORBAG, SHAGRAT]);
    const declared = declareStarterPath(state);

    const pending = declared.pendingResolutions;
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('tap-one-character');
    expect(pending[0].actor).toBe(PLAYER_1);
    if (pending[0].kind.type !== 'tap-one-character') return;
    expect(pending[0].kind.sourceDefinitionId).toBe(TOLFALAS);
    expect(pending[0].kind.companyId).toBe(declared.players[0].companies[0].id);

    // The tap is mandatory: pass is NOT offered while an untapped character remains.
    const viable = viableFor(declared, PLAYER_1).map(a => a.action);
    expect(viable.filter(a => a.type === 'tap-character-by-effect')).toHaveLength(2);
    expect(viable.some(a => a.type === 'pass')).toBe(false);
  });

  test('tapping a character resolves the pending and the character becomes tapped', () => {
    const declared = declareStarterPath(movingToTolfalas([GORBAG, SHAGRAT]));

    const gorbagId = findCharInstanceId(declared, RESOURCE_PLAYER, GORBAG);
    const tapAction = viableFor(declared, PLAYER_1)
      .map(a => a.action)
      .find(a => a.type === 'tap-character-by-effect' && a.characterInstanceId === gorbagId);
    expect(tapAction).toBeDefined();

    const after = dispatch(declared, tapAction!);
    expect(after.pendingResolutions).toHaveLength(0);
    expectCharStatus(after, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);
    expectCharStatus(after, RESOURCE_PLAYER, SHAGRAT, CardStatus.Untapped);
  });

  test('with no untapped character available only pass is offered and it clears the pending', () => {
    const declared = declareStarterPath(movingToTolfalas([
      { defId: GORBAG, status: CardStatus.Tapped },
      { defId: SHAGRAT, status: CardStatus.Tapped },
    ]));

    expect(declared.pendingResolutions).toHaveLength(1);
    const viable = viableFor(declared, PLAYER_1).map(a => a.action);
    expect(viable.filter(a => a.type === 'tap-character-by-effect')).toHaveLength(0);
    expect(viable.some(a => a.type === 'pass')).toBe(true);

    const after = dispatch(declared, { type: 'pass', player: PLAYER_1 });
    expect(after.pendingResolutions).toHaveLength(0);
    expectCharStatus(after, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);
    expectCharStatus(after, RESOURCE_PLAYER, SHAGRAT, CardStatus.Tapped);
  });

  test('a covert company revealing Tolfalas is NOT forced to tap', () => {
    // The Mouth is a Man: a company without Orcs, Trolls, or overt-making
    // allies is covert, so the special rule does not fire.
    const declared = declareStarterPath(movingToTolfalas([THE_MOUTH]));

    expect(declared.pendingResolutions).toHaveLength(0);
    expectCharStatus(declared, RESOURCE_PLAYER, THE_MOUTH, CardStatus.Untapped);
  });
});
