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
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                  |
 * | 2 | sitePath          | OK     | [wilderness, coastal] — matches {w}{c}           |
 * | 3 | nearestHaven      | OK     | "Geann a-Lisch" — valid Darkhaven (le-374)       |
 * | 4 | region            | OK     | "Eriadoran Coast"                                |
 * | 5 | playableResources | OK     | [minor, major, gold-ring] — matches card text    |
 * | 6 | automaticAttacks  | OK     | Undead, 2 strikes, 8 prowess                     |
 * | 7 | resourceDraws     | OK     | 1                                                |
 * | 8 | hazardDraws       | OK     | 2                                                |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                    |
 * |---|---------------------------------|-------------|-------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, etc.       |
 * | 2 | Item playability                | IMPLEMENTED | minor, major, gold ring; greater not      |
 * | 3 | Automatic attacks               | IMPLEMENTED | combat initiated with correct stats       |
 * | 4 | Wound → corruption check (-2)   | IMPLEMENTED | on-event: character-wounded-by-self       |
 * | 5 | Covert reveal → tap a character | IMPLEMENTED | on-event: site-revealed-as-new-site with  |
 * |   |                                 |             | covert gate `true` (mh-steps.ts, as-150)  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  resetMint, CardStatus,
  dispatch, viableFor, viableActions,
  buildMinionSitePhaseState, setupAutoAttackStep, runAutoAttackCombatMulti,
  buildMinionMHRevealState, declareStarterPath,
  findCharInstanceId, findHandCardId, expectCharStatus,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const ISLES_OF_THE_DEAD = 'as-154' as CardDefinitionId;
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;

// The Mouth and Layos are Men — a company of only Men is covert.
const THE_MOUTH = 'le-24' as CardDefinitionId;
const LAYOS = 'le-19' as CardDefinitionId;
// Gorbag and Shagrat are Orcs — a company containing either is overt.
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;

const BLACK_MACE = 'le-299' as CardDefinitionId;         // greater item
const HIGH_HELM = 'le-313' as CardDefinitionId;          // major item
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;  // minor item
const GLEAMING_GOLD_RING = 'le-311' as CardDefinitionId; // gold ring item

describe('Isles of the Dead That Live (as-154)', () => {
  beforeEach(() => resetMint());

  // ─── Special: covert company must tap an untapped character on reveal ──────

  test('covert company revealing the Isles as its new site must tap one untapped character', () => {
    const state = buildMinionMHRevealState({
      origin: GEANN_A_LISCH,
      destination: ISLES_OF_THE_DEAD,
      characters: [THE_MOUTH, LAYOS],
    });
    const declared = declareStarterPath(state);

    // The reveal enqueues a mandatory tap-one-character resolution.
    const pending = declared.pendingResolutions;
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('tap-one-character');
    expect(pending[0].actor).toBe(PLAYER_1);
    if (pending[0].kind.type !== 'tap-one-character') return;
    expect(pending[0].kind.sourceDefinitionId).toBe(ISLES_OF_THE_DEAD);
    expect(pending[0].kind.companyId).toBe(declared.players[0].companies[0].id);

    // One tap action per untapped character; the tap is mandatory, so pass
    // is NOT offered while an untapped character remains.
    const viable = viableFor(declared, PLAYER_1).map(a => a.action);
    expect(viable.filter(a => a.type === 'tap-character-by-effect')).toHaveLength(2);
    expect(viable.some(a => a.type === 'pass')).toBe(false);
  });

  test('tapping a character resolves the pending and the character becomes tapped', () => {
    const declared = declareStarterPath(buildMinionMHRevealState({
      origin: GEANN_A_LISCH,
      destination: ISLES_OF_THE_DEAD,
      characters: [THE_MOUTH, LAYOS],
    }));

    const mouthId = findCharInstanceId(declared, RESOURCE_PLAYER, THE_MOUTH);
    const tapAction = viableFor(declared, PLAYER_1)
      .map(a => a.action)
      .find(a => a.type === 'tap-character-by-effect' && a.characterInstanceId === mouthId);
    expect(tapAction).toBeDefined();

    const after = dispatch(declared, tapAction!);
    expect(after.pendingResolutions).toHaveLength(0);
    expectCharStatus(after, RESOURCE_PLAYER, THE_MOUTH, CardStatus.Tapped);
    expectCharStatus(after, RESOURCE_PLAYER, LAYOS, CardStatus.Untapped);
  });

  test('with no untapped character available only pass is offered and it clears the pending', () => {
    const declared = declareStarterPath(buildMinionMHRevealState({
      origin: GEANN_A_LISCH,
      destination: ISLES_OF_THE_DEAD,
      characters: [
        { defId: THE_MOUTH, status: CardStatus.Tapped },
        { defId: LAYOS, status: CardStatus.Tapped },
      ],
    }));

    expect(declared.pendingResolutions).toHaveLength(1);
    const viable = viableFor(declared, PLAYER_1).map(a => a.action);
    expect(viable.filter(a => a.type === 'tap-character-by-effect')).toHaveLength(0);
    expect(viable.some(a => a.type === 'pass')).toBe(true);

    const after = dispatch(declared, { type: 'pass', player: PLAYER_1 });
    expect(after.pendingResolutions).toHaveLength(0);
    expectCharStatus(after, RESOURCE_PLAYER, THE_MOUTH, CardStatus.Tapped);
    expectCharStatus(after, RESOURCE_PLAYER, LAYOS, CardStatus.Tapped);
  });

  test('an overt company revealing the Isles is NOT forced to tap', () => {
    // Gorbag and Shagrat are Orcs, so the company is overt and the special
    // rule (gated on company.covert = true) does not fire.
    const declared = declareStarterPath(buildMinionMHRevealState({
      origin: GEANN_A_LISCH,
      destination: ISLES_OF_THE_DEAD,
      characters: [GORBAG, SHAGRAT],
    }));

    expect(declared.pendingResolutions).toHaveLength(0);
    expectCharStatus(declared, RESOURCE_PLAYER, GORBAG, CardStatus.Untapped);
    expectCharStatus(declared, RESOURCE_PLAYER, SHAGRAT, CardStatus.Untapped);
  });

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 2 strikes and 8 prowess', () => {
    const state = buildMinionSitePhaseState({
      site: ISLES_OF_THE_DEAD,
      characters: [{ defId: THE_MOUTH }, { defId: LAYOS }],
    });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(2);
    expect(nextState.combat!.strikeProwess).toBe(8);
    expect(nextState.combat!.creatureRace).toBe('undead');
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound → corruption check modified by -2 ───────────────────────────────

  test('wounded character gets a corruption check modified by -2 after the auto-attack', () => {
    const state = buildMinionSitePhaseState({
      site: ISLES_OF_THE_DEAD,
      characters: [{ defId: THE_MOUTH }, { defId: LAYOS }],
    });
    const readyState = setupAutoAttackStep(state);

    // The Mouth fights untapped without tapping: prowess 6-3=3, roll 2 → 5 < 8
    // → wounded; body check roll 5 ≤ 8 → survives wounded, so the corruption
    // check fires for him. Layos taps to fight: prowess 3, roll 10 → 13 > 8 →
    // beats her strike, so no check for her.
    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: THE_MOUTH, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: LAYOS, roll: 10, tapToFight: true },
    ]);
    expect(result.state.combat).toBeNull();

    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.modifier).toBe(-2);
    expect(pending[0].kind.reason).toBe('Isles of the Dead That Live');
    expect(pending[0].kind.characterId).toBe(findCharInstanceId(result.state, RESOURCE_PLAYER, THE_MOUTH));
  });

  test('characters that beat both strikes get no corruption check', () => {
    const state = buildMinionSitePhaseState({
      site: ISLES_OF_THE_DEAD,
      characters: [{ defId: THE_MOUTH }, { defId: LAYOS }],
    });
    const readyState = setupAutoAttackStep(state);

    // Both tap to fight at full prowess and roll 10: The Mouth 16 > 8 and
    // Layos 13 > 8 → both strikes beaten, no wounds, no corruption checks.
    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: THE_MOUTH, roll: 10, tapToFight: true },
      { characterDefId: LAYOS, roll: 10, tapToFight: true },
    ]);
    expect(result.state.combat).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  // ─── Item playability: minor, major, gold ring (not greater) ───────────────

  test('minor, major, and gold ring items are playable at the Isles, greater items are not', () => {
    const state = buildMinionSitePhaseState({
      site: ISLES_OF_THE_DEAD,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM, GLEAMING_GOLD_RING, BLACK_MACE],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, GLEAMING_GOLD_RING));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, BLACK_MACE));
  });
});
