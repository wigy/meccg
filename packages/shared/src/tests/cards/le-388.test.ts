/**
 * @module le-388.test
 *
 * Card test: Lossadan Cairn (le-388)
 * Type: minion-site (ruins-and-lairs)
 * Effects: 2
 *   1. on-event: character-wounded-by-self → force corruption check (modifier -2)
 *   2. site-rule: deny-item → any greater item that is not a Palantír
 *
 * "Nearest Darkhaven: Carn Dûm
 *  Playable: Items (minor, major, greater*) *—Palantíri only
 *  Automatic-attacks: Undead — 2 strikes with 8 prowess;
 *  each character wounded must make a corruption check modified by -2"
 *
 * le-388 is the sibling of Tolfalas (as-162 / hero tw-433): the same
 * corruption-check-on-wound and greater-item gate, but its greater exception is
 * the whole *group* of Palantíri rather than a single named card, and it carries
 * no reveal-tap. Every rule is a shipped primitive:
 *   - the 2-strike / 8-prowess Undead auto-attack is structural data;
 *   - "each character wounded must make a corruption check modified by -2" is the
 *     on-event: character-wounded-by-self → force-check machinery (Barrow-downs
 *     le-353, Himring as-150, Tolfalas as-162);
 *   - "greater* — Palantíri only" is site-rule: deny-item keyed on the item
 *     definition — greater items lacking the `palantir` keyword are denied
 *     ({ $and: [ subtype greater, $not keywords $includes palantir ] }). The
 *     authoritative cards.json tags every Palantír (including the greater-subtype
 *     ones — Amon Sûl / Annúminas / Osgiliath) with the Palantír keyword; the
 *     imported game data had dropped it from the greater ones, restored here so
 *     the group exception resolves correctly (same import bug as Tharbad le-407).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                        |
 * | 2 | sitePath          | OK     | [shadow, wilderness]                             |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid Darkhaven                     |
 * | 4 | region            | OK     | "Forochel"                                       |
 * | 5 | playableResources | OK     | [minor, major, greater] — greater gated by rule  |
 * | 6 | automaticAttacks  | OK     | Undead, 2 strikes, 8 prowess                     |
 * | 7 | resourceDraws     | OK     | 1                                                |
 * | 8 | hazardDraws       | OK     | 1                                                |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  resetMint, buildMinionSitePhaseState,
  setupAutoAttackStep, runAutoAttackCombatMulti,
  dispatch, viableActions,
  findCharInstanceId, findHandCardId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const LOSSADAN_CAIRN = 'le-388' as CardDefinitionId;

// Gorbag and Shagrat are Orcs — usable as a minion company facing the auto-attack.
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;
const THE_MOUTH = 'le-24' as CardDefinitionId;

const BLACK_MACE = 'le-299' as CardDefinitionId;          // greater item, not a Palantír
const HIGH_HELM = 'le-313' as CardDefinitionId;           // major item
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;   // minor item
const IRON_CROWN = 'le-314' as CardDefinitionId;          // greater item, 5 CP, no combat bonus
const PALANTIR_AMON_SUL = 'le-330' as CardDefinitionId;   // greater Palantír — the allowed exception

describe('Lossadan Cairn (le-388)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 2 strikes and 8 prowess', () => {
    const state = buildMinionSitePhaseState({
      site: LOSSADAN_CAIRN,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }],
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

  test('a wounded character gets a corruption check modified by -2 after the auto-attack', () => {
    const state = buildMinionSitePhaseState({
      site: LOSSADAN_CAIRN,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }],
    });
    const readyState = setupAutoAttackStep(state);

    // Gorbag fights untapped (prowess penalised), roll 2 → total < 8 → wounded;
    //   body 9, bodyRoll 5 → survives wounded, so the corruption check fires.
    // Shagrat taps to fight and rolls 12 → wins its strike, no wound.
    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: GORBAG, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: SHAGRAT, roll: 12 },
    ]);
    expect(result.state.combat).toBeNull();

    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.modifier).toBe(-2);
    expect(pending[0].kind.reason).toBe('Lossadan Cairn');
    expect(pending[0].kind.characterId).toBe(findCharInstanceId(result.state, RESOURCE_PLAYER, GORBAG));
  });

  test('characters that beat the auto-attack strikes get no corruption check', () => {
    const state = buildMinionSitePhaseState({
      site: LOSSADAN_CAIRN,
      characters: [{ defId: GORBAG }, { defId: SHAGRAT }],
    });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: GORBAG, roll: 12 },
      { characterDefId: SHAGRAT, roll: 12 },
    ]);
    expect(result.state.combat).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  test('the post-wound corruption check can fail and remove the character from play', () => {
    // The Iron Crown gives 5 CP and no combat bonus; the -2 modifier plus a
    // roll of 2 → 0 vs 5 CP → the corruption check fails and Gorbag leaves play.
    const state = buildMinionSitePhaseState({
      site: LOSSADAN_CAIRN,
      characters: [{ defId: GORBAG, items: [IRON_CROWN] }, { defId: SHAGRAT }],
    });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: GORBAG, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: SHAGRAT, roll: 12 },
    ]);

    const gorbagId = findCharInstanceId(result.state, RESOURCE_PLAYER, GORBAG);
    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    const ccState = dispatch({ ...result.state, cheatRollTotal: 2 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    expect(Object.keys(ccState.players[RESOURCE_PLAYER].characters)).not.toContain(gorbagId as string);
  });

  // ─── Item playability: minor, major, greater* (Palantíri only) ─────────────

  test('minor and major items are playable at Lossadan Cairn', () => {
    const state = buildMinionSitePhaseState({
      site: LOSSADAN_CAIRN,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
  });

  test('a greater Palantír is playable at Lossadan Cairn', () => {
    const state = buildMinionSitePhaseState({
      site: LOSSADAN_CAIRN,
      characters: [{ defId: THE_MOUTH }],
      hand: [PALANTIR_AMON_SUL],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, PALANTIR_AMON_SUL));
  });

  test('a non-Palantír greater item is denied by the site rule', () => {
    const state = buildMinionSitePhaseState({
      site: LOSSADAN_CAIRN,
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
    expect(notPlayable[0].reason).toContain('Lossadan Cairn');
  });
});
