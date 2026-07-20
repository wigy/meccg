/**
 * @module as-150.test
 *
 * Card test: Himring (as-150)
 * Type: minion-site (ruins-and-lairs)
 * Effects: 2
 *
 * "Nearest Darkhaven: Geann a-Lisch
 *  Playable: Items (minor, major)
 *  Automatic-attacks: Undead — 1 strike with 8 prowess;
 *  each character wounded must make a corruption check modified by -2
 *  Special: An overt company must tap an untapped character (if available)
 *  if this site is revealed as its new site."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                        |
 * | 2 | sitePath          | OK     | [wilderness, coastal, coastal] — matches {w}{c}{c} |
 * | 3 | nearestHaven      | OK     | "Geann a-Lisch" — valid Darkhaven (le-374)       |
 * | 4 | region            | OK     | "Elven Shores"                                   |
 * | 5 | playableResources | OK     | [minor, major] — matches card text               |
 * | 6 | automaticAttacks  | OK     | Undead, 1 strike, 8 prowess                      |
 * | 7 | resourceDraws     | OK     | 3                                                |
 * | 8 | hazardDraws       | OK     | 3                                                |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                    |
 * |---|--------------------------------|-------------|-------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, etc.       |
 * | 2 | Item playability               | IMPLEMENTED | minor, major playable; greater not        |
 * | 3 | Automatic attacks              | IMPLEMENTED | combat initiated with correct stats       |
 * | 4 | Wound → corruption check (-2)  | IMPLEMENTED | on-event: character-wounded-by-self       |
 * | 5 | Overt reveal → tap a character | IMPLEMENTED | on-event: site-revealed-as-new-site →     |
 * |   |                                |             | tap-one-character (mh-steps.ts)           |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LORIEN,
  resetMint, buildTestState, makeMHState, Phase, Alignment, CardStatus,
  dispatch, viableFor, viableActions,
  buildMinionSitePhaseState, setupAutoAttackStep, runAutoAttackCombat,
  findCharInstanceId, findHandCardId, expectCharStatus,
} from '../test-helpers.js';
import type { CharacterEntry } from '../test-helpers.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const HIMRING = 'as-150' as CardDefinitionId;
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;

// Gorbag and Shagrat are Orcs — a company containing either is overt.
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;
// The Mouth is a Man — a company of only Men is covert.
const THE_MOUTH = 'le-24' as CardDefinitionId;

const BLACK_MACE = 'le-299' as CardDefinitionId;         // greater item
const HIGH_HELM = 'le-313' as CardDefinitionId;          // major item
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;  // minor item
const IRON_CROWN = 'le-314' as CardDefinitionId;         // greater item, 5 CP, no combat bonus

/**
 * A Ringwraith-player company at Geann a-Lisch (Himring's nearest Darkhaven)
 * moving to Himring, stopped at the reveal-new-site step of its
 * movement/hazard phase.
 */
function movingToHimring(characters: CharacterEntry[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: GEANN_A_LISCH, characters, destinationSite: HIMRING }],
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

/** Dispatch the starter-movement declare-path for the company moving to Himring. */
function declareStarterPath(state: GameState): GameState {
  const declare = viableFor(state, PLAYER_1)
    .map(a => a.action)
    .find(a => a.type === 'declare-path' && a.movementType === 'starter');
  expect(declare).toBeDefined();
  return dispatch(state, declare!);
}

describe('Himring (as-150)', () => {
  beforeEach(() => resetMint());

  // ─── Special: overt company must tap an untapped character on reveal ───────

  test('overt company revealing Himring as its new site must tap one untapped character', () => {
    const state = movingToHimring([GORBAG, SHAGRAT]);
    const declared = declareStarterPath(state);

    // The reveal enqueues a mandatory tap-one-character resolution.
    const pending = declared.pendingResolutions;
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('tap-one-character');
    expect(pending[0].actor).toBe(PLAYER_1);
    if (pending[0].kind.type !== 'tap-one-character') return;
    expect(pending[0].kind.sourceDefinitionId).toBe(HIMRING);
    expect(pending[0].kind.companyId).toBe(declared.players[0].companies[0].id);

    // One tap action per untapped character; the tap is mandatory, so pass
    // is NOT offered while an untapped character remains.
    const viable = viableFor(declared, PLAYER_1).map(a => a.action);
    expect(viable.filter(a => a.type === 'tap-character-by-effect')).toHaveLength(2);
    expect(viable.some(a => a.type === 'pass')).toBe(false);
  });

  test('tapping a character resolves the pending and the character becomes tapped', () => {
    const declared = declareStarterPath(movingToHimring([GORBAG, SHAGRAT]));

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

  test('already-tapped characters are not offered — only untapped ones', () => {
    const declared = declareStarterPath(movingToHimring([
      { defId: GORBAG, status: CardStatus.Tapped },
      SHAGRAT,
    ]));

    expect(declared.pendingResolutions).toHaveLength(1);
    const shagratId = findCharInstanceId(declared, RESOURCE_PLAYER, SHAGRAT);
    const taps = viableFor(declared, PLAYER_1)
      .map(a => a.action)
      .filter(a => a.type === 'tap-character-by-effect');
    expect(taps).toHaveLength(1);
    expect((taps[0] as { characterInstanceId?: string }).characterInstanceId).toBe(shagratId);
  });

  test('with no untapped character available only pass is offered and it clears the pending', () => {
    const declared = declareStarterPath(movingToHimring([
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

  test('a covert company revealing Himring is NOT forced to tap', () => {
    // The Mouth is a Man: a company without Orcs, Trolls, or overt-making
    // allies is covert, so the special rule does not fire.
    const declared = declareStarterPath(movingToHimring([THE_MOUTH]));

    expect(declared.pendingResolutions).toHaveLength(0);
    expectCharStatus(declared, RESOURCE_PLAYER, THE_MOUTH, CardStatus.Untapped);
  });

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 1 strike and 8 prowess', () => {
    const state = buildMinionSitePhaseState({ site: HIMRING, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(1);
    expect(nextState.combat!.strikeProwess).toBe(8);
    expect(nextState.combat!.creatureRace).toBe('undead');
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound → corruption check modified by -2 ───────────────────────────────

  test('wounded character gets a corruption check modified by -2 after the auto-attack', () => {
    const state = buildMinionSitePhaseState({ site: HIMRING, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    // Untapped: prowess 6-3=3, roll 2 → 5 < 8 → wounded. Body check roll 5 ≤ 8
    // → survives wounded, so the corruption check fires.
    const result = runAutoAttackCombat(readyState, THE_MOUTH, 2, 5, false);
    expect(result.state.combat).toBeNull();

    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.modifier).toBe(-2);
    expect(pending[0].kind.reason).toBe('Himring');
    expect(pending[0].kind.characterId).toBe(findCharInstanceId(result.state, RESOURCE_PLAYER, THE_MOUTH));
  });

  test('the post-wound corruption check can fail and remove the character from play', () => {
    // The Iron Crown gives 5 CP and no combat bonus; roll 2 with -2 → 0 vs
    // 5 CP → the corruption check fails and The Mouth leaves play.
    const state = buildMinionSitePhaseState({
      site: HIMRING,
      characters: [{ defId: THE_MOUTH, items: [IRON_CROWN] }],
    });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombat(readyState, THE_MOUTH, 2, 5, false);
    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    const ccState = dispatch({ ...result.state, cheatRollTotal: 2 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    const mouthId = findCharInstanceId(result.state, RESOURCE_PLAYER, THE_MOUTH);
    expect(Object.keys(ccState.players[RESOURCE_PLAYER].characters)).not.toContain(mouthId as string);
  });

  test('character that beats the auto-attack strike gets no corruption check', () => {
    const state = buildMinionSitePhaseState({ site: HIMRING, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    // Tap to fight at full prowess 6, roll 10 → 16 > 8 → wins, no wound.
    const result = runAutoAttackCombat(readyState, THE_MOUTH, 10, null);
    expect(result.state.combat).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  // ─── Item playability: minor, major (not greater) ──────────────────────────

  test('minor and major items are playable at Himring, greater items are not', () => {
    const state = buildMinionSitePhaseState({
      site: HIMRING,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM, BLACK_MACE],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, BLACK_MACE));
  });
});
