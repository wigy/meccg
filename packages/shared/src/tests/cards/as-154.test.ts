/**
 * @module as-154.test
 *
 * Card test: Isles of the Dead That Live (as-154)
 * Type: minion-site (ruins-and-lairs)
 * Effects: 2
 *
 * "Nearest Darkhaven: Geann a-Lisch
 *  Playable: Items (minor, major, gold ring)
 *  Automatic-attacks: Undead — 2 strikes with 8 prowess;
 *  each character wounded must make a corruption check modified by -2
 *  Special: A covert company must tap an untapped character (if available)
 *  if this site is revealed as its new site."
 *
 * The covert-company mirror of Himring (as-150): identical Undead auto-attack
 * with a -2 corruption check on every wound, and a reveal-tap — but here the
 * `site-revealed-as-new-site` on-event gate is `{ "company.covert": true }`
 * (an *overt* company is NOT forced to tap). Playable resources add gold-ring
 * items on top of Himring's minor/major.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                          |
 * | 2 | sitePath          | OK     | [wilderness, coastal] — matches {w}{c}             |
 * | 3 | nearestHaven      | OK     | "Geann a-Lisch" — valid Darkhaven (le-374)         |
 * | 4 | region            | OK     | "Eriadoran Coast"                                  |
 * | 5 | playableResources | OK     | [minor, major, gold-ring] — matches card text      |
 * | 6 | automaticAttacks  | OK     | Undead, 2 strikes, 8 prowess                       |
 * | 7 | resourceDraws     | OK     | 1                                                  |
 * | 8 | hazardDraws       | OK     | 2                                                  |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                   |
 * |---|---------------------------------|-------------|-----------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, etc.     |
 * | 2 | Item playability                | IMPLEMENTED | minor/major/gold-ring playable; greater not |
 * | 3 | Automatic attacks               | IMPLEMENTED | combat initiated with correct stats     |
 * | 4 | Wound → corruption check (-2)   | IMPLEMENTED | on-event: character-wounded-by-self     |
 * | 5 | Covert reveal → tap a character | IMPLEMENTED | on-event: site-revealed-as-new-site →   |
 * |   |                                 |             | tap-one-character, covert-gated (mh-steps.ts) |
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
import type { CardDefinitionId, GameState } from '../../index.js';

const ISLES = 'as-154' as CardDefinitionId;
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;

// The Mouth is a Man — a company of only Men is covert.
const THE_MOUTH = 'le-24' as CardDefinitionId;
// Gorbag and Shagrat are Orcs — a company containing either is overt.
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;

const BLACK_MACE = 'le-299' as CardDefinitionId;         // greater item
const HIGH_HELM = 'le-313' as CardDefinitionId;          // major item
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;  // minor item
const A_LITTLE_GOLD_RING = 'le-297' as CardDefinitionId; // gold-ring item, no site restriction
const IRON_CROWN = 'le-314' as CardDefinitionId;         // greater item, 5 CP, no combat bonus

/**
 * A Ringwraith-player company at Geann a-Lisch (Isles' nearest Darkhaven)
 * moving to Isles of the Dead That Live, stopped at the reveal-new-site step
 * of its movement/hazard phase.
 */
function movingToIsles(characters: CharacterEntry[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: GEANN_A_LISCH, characters, destinationSite: ISLES }],
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

/** Dispatch the starter-movement declare-path for the company moving to Isles. */
function declareStarterPath(state: GameState): GameState {
  const declare = viableFor(state, PLAYER_1)
    .map(a => a.action)
    .find(a => a.type === 'declare-path' && a.movementType === 'starter');
  expect(declare).toBeDefined();
  return dispatch(state, declare!);
}

describe('Isles of the Dead That Live (as-154)', () => {
  beforeEach(() => resetMint());

  // ─── Special: covert company must tap an untapped character on reveal ──────

  test('covert company revealing Isles as its new site must tap one untapped character', () => {
    // The Mouth is a Man: a Men-only company is covert, so the special fires.
    const state = movingToIsles([THE_MOUTH]);
    const declared = declareStarterPath(state);

    // The reveal enqueues a mandatory tap-one-character resolution.
    const pending = declared.pendingResolutions;
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('tap-one-character');
    expect(pending[0].actor).toBe(PLAYER_1);
    if (pending[0].kind.type !== 'tap-one-character') return;
    expect(pending[0].kind.sourceDefinitionId).toBe(ISLES);
    expect(pending[0].kind.companyId).toBe(declared.players[0].companies[0].id);

    // The tap is mandatory, so pass is NOT offered while an untapped character
    // remains; one tap action is offered for The Mouth.
    const viable = viableFor(declared, PLAYER_1).map(a => a.action);
    expect(viable.filter(a => a.type === 'tap-character-by-effect')).toHaveLength(1);
    expect(viable.some(a => a.type === 'pass')).toBe(false);
  });

  test('tapping a character resolves the pending and the character becomes tapped', () => {
    const declared = declareStarterPath(movingToIsles([THE_MOUTH]));

    const mouthId = findCharInstanceId(declared, RESOURCE_PLAYER, THE_MOUTH);
    const tapAction = viableFor(declared, PLAYER_1)
      .map(a => a.action)
      .find(a => a.type === 'tap-character-by-effect' && a.characterInstanceId === mouthId);
    expect(tapAction).toBeDefined();

    const after = dispatch(declared, tapAction!);
    expect(after.pendingResolutions).toHaveLength(0);
    expectCharStatus(after, RESOURCE_PLAYER, THE_MOUTH, CardStatus.Tapped);
  });

  test('with no untapped character available only pass is offered and it clears the pending', () => {
    const declared = declareStarterPath(movingToIsles([
      { defId: THE_MOUTH, status: CardStatus.Tapped },
    ]));

    expect(declared.pendingResolutions).toHaveLength(1);
    const viable = viableFor(declared, PLAYER_1).map(a => a.action);
    expect(viable.filter(a => a.type === 'tap-character-by-effect')).toHaveLength(0);
    expect(viable.some(a => a.type === 'pass')).toBe(true);

    const after = dispatch(declared, { type: 'pass', player: PLAYER_1 });
    expect(after.pendingResolutions).toHaveLength(0);
    expectCharStatus(after, RESOURCE_PLAYER, THE_MOUTH, CardStatus.Tapped);
  });

  test('an overt company revealing Isles is NOT forced to tap', () => {
    // Gorbag and Shagrat are Orcs — a company containing an Orc is overt, so
    // the covert-gated special rule does not fire.
    const declared = declareStarterPath(movingToIsles([GORBAG, SHAGRAT]));

    expect(declared.pendingResolutions).toHaveLength(0);
    expectCharStatus(declared, RESOURCE_PLAYER, GORBAG, CardStatus.Untapped);
    expectCharStatus(declared, RESOURCE_PLAYER, SHAGRAT, CardStatus.Untapped);
  });

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 2 strikes and 8 prowess', () => {
    const state = buildMinionSitePhaseState({ site: ISLES, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(2);
    expect(nextState.combat!.strikeProwess).toBe(8);
    expect(nextState.combat!.creatureRace).toBe('undead');
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound → corruption check modified by -2 ───────────────────────────────

  test('a wounded character gets a corruption check modified by -2 after the auto-attack', () => {
    // Two strikes hit two defenders. Gorbag is wounded (roll 2), The Mouth wins.
    const state = buildMinionSitePhaseState({
      site: ISLES,
      characters: [{ defId: GORBAG }, { defId: THE_MOUTH }],
    });
    const readyState = setupAutoAttackStep(state);

    // Gorbag untapped: prowess 6-3=3, roll 2 → 5 < 8 → wounded; body 9, roll 5
    //   → survives wounded, so the corruption check fires.
    // The Mouth taps to fight at prowess 6, roll 12 → win, no wound.
    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: GORBAG, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: THE_MOUTH, roll: 12 },
    ]);
    expect(result.state.combat).toBeNull();

    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.modifier).toBe(-2);
    expect(pending[0].kind.reason).toBe('Isles of the Dead That Live');
    expect(pending[0].kind.characterId).toBe(findCharInstanceId(result.state, RESOURCE_PLAYER, GORBAG));
  });

  test('characters that beat the auto-attack strikes get no corruption check', () => {
    const state = buildMinionSitePhaseState({
      site: ISLES,
      characters: [{ defId: GORBAG }, { defId: THE_MOUTH }],
    });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: GORBAG, roll: 12 },
      { characterDefId: THE_MOUTH, roll: 12 },
    ]);
    expect(result.state.combat).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  test('the post-wound corruption check can fail and remove the character from play', () => {
    // The Iron Crown gives 5 CP and no combat bonus; roll 2 with -2 → 0 vs
    // 5 CP → the corruption check fails and Gorbag leaves play.
    const state = buildMinionSitePhaseState({
      site: ISLES,
      characters: [{ defId: GORBAG, items: [IRON_CROWN] }, { defId: THE_MOUTH }],
    });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: GORBAG, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: THE_MOUTH, roll: 12 },
    ]);
    const gorbagId = findCharInstanceId(result.state, RESOURCE_PLAYER, GORBAG);
    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    const ccState = dispatch({ ...result.state, cheatRollTotal: 2 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    expect(Object.keys(ccState.players[RESOURCE_PLAYER].characters)).not.toContain(gorbagId as string);
  });

  // ─── Item playability: minor, major, gold-ring (not greater) ───────────────

  test('minor, major and gold-ring items are playable at Isles; greater items are not', () => {
    const state = buildMinionSitePhaseState({
      site: ISLES,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM, A_LITTLE_GOLD_RING, BLACK_MACE],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, A_LITTLE_GOLD_RING));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, BLACK_MACE));
  });
});
