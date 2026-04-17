/**
 * @module rule-metd-dragon-cascade
 *
 * METD §4.2 — Defeat cascade for Dragon manifestations.
 *
 * When any chain card lands in an off-board pile (kill / out-of-play /
 * discard), all OTHER manifestations of the same Dragon are swept into
 * the owning player's outOfPlayPile, no further manifestations of that
 * Dragon may be played, and the Dragon's lair loses its automatic-attack.
 */

import { describe, expect, test } from 'vitest';
import type { CardDefinitionId, CardInstance, CardInstanceId, SiteCard } from '../../../index.js';
import {
  applyManifestationCascade,
  isManifestationDefeated,
  getActiveAutoAttacks,
} from '../../../engine/manifestations.js';
import {
  addCardInPlay,
  addToKillPile,
  addToOutOfPlayPile,
  buildSimpleTwoPlayerState, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';

const SMAUG = 'tw-90' as CardDefinitionId;
const SMAUG_AHUNT = 'td-70' as CardDefinitionId;
const SMAUG_AT_HOME = 'td-71' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;
const EARC_AT_HOME = 'td-22' as CardDefinitionId;

describe('METD §4.2 — Defeat cascade', () => {
  test('Smaug landing in killPile sweeps Smaug Ahunt + Smaug At-Home from cardsInPlay', () => {
    // Set up a state where Smaug Ahunt and Smaug At-Home are in P2's
    // cardsInPlay (P2 is the hazard player who staged them). Then drop
    // the basic Smaug creature into P2's killPile (defeated by P1's
    // company in some prior combat) and run the cascade.
    let state = buildSimpleTwoPlayerState();
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AHUNT);
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AT_HOME);
    // Earcaraxe At-Home should be untouched.
    state = addCardInPlay(state, HAZARD_PLAYER, EARC_AT_HOME);
    const smaugBasic: CardInstance = { instanceId: 'p2-50' as CardInstanceId, definitionId: SMAUG };
    state = addToKillPile(state, HAZARD_PLAYER, smaugBasic);

    const after = applyManifestationCascade(state);
    // P2's cardsInPlay should now hold only the unrelated Earcaraxe.
    const remaining = after.players[1].cardsInPlay.map(c => c.definitionId as string);
    expect(remaining).toEqual([EARC_AT_HOME]);
    // Sister cards land in P2's outOfPlayPile (owner = p2).
    const oopDefs = after.players[1].outOfPlayPile.map(c => c.definitionId as string).sort();
    expect(oopDefs).toEqual([SMAUG_AHUNT, SMAUG_AT_HOME].sort());
  });

  test('cascade is idempotent — running twice changes nothing', () => {
    let state = buildSimpleTwoPlayerState();
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AHUNT);
    state = addToKillPile(state, HAZARD_PLAYER, { instanceId: 'p2-50' as CardInstanceId, definitionId: SMAUG });

    const once = applyManifestationCascade(state);
    const twice = applyManifestationCascade(once);
    expect(twice).toBe(once);
  });

  test('cards swept land in the owning player\'s pile (ownerOf prefix)', () => {
    // P1 played Smaug At-Home (ownership: p1) — this is unusual but
    // possible if a hero player ever controls a Dragon manifestation.
    // P2 then defeats some other Smaug copy → P2's killPile. The
    // cascade must sweep P1's At-Home into P1's outOfPlayPile, not P2's.
    let state = buildSimpleTwoPlayerState();
    // Manually inject a P1-owned At-Home into P1's cardsInPlay.
    const p1Athome: CardInstance = { instanceId: 'p1-77' as CardInstanceId, definitionId: SMAUG_AT_HOME };
    state = {
      ...state,
      players: [
        { ...state.players[0], cardsInPlay: [...state.players[0].cardsInPlay, { ...p1Athome, status: 0 as never }] },
        state.players[1],
      ] as typeof state.players,
    };
    state = addToKillPile(state, HAZARD_PLAYER, { instanceId: 'p2-50' as CardInstanceId, definitionId: SMAUG });

    const after = applyManifestationCascade(state);
    // P1's cardsInPlay should be empty; the At-Home moved to P1's outOfPlayPile.
    expect(after.players[0].cardsInPlay).toHaveLength(0);
    expect(after.players[0].outOfPlayPile.map(c => c.definitionId as string)).toContain(SMAUG_AT_HOME);
    // P2's outOfPlayPile shouldn't have received it.
    expect(after.players[1].outOfPlayPile.map(c => c.definitionId as string)).not.toContain(SMAUG_AT_HOME);
  });

  test('isManifestationDefeated returns true for killPile and outOfPlayPile, false for discardPile', () => {
    // killPile case (combat defeat) → defeated.
    let state = buildSimpleTwoPlayerState();
    state = addToKillPile(state, HAZARD_PLAYER, { instanceId: 'p2-1' as CardInstanceId, definitionId: SMAUG });
    expect(isManifestationDefeated(state, SMAUG)).toBe(true);

    // outOfPlayPile case (eliminated / removed-from-play) → defeated.
    state = buildSimpleTwoPlayerState();
    state = addToOutOfPlayPile(state, RESOURCE_PLAYER, { instanceId: 'p1-3' as CardInstanceId, definitionId: SMAUG });
    expect(isManifestationDefeated(state, SMAUG)).toBe(true);

    // discardPile case (Ahunt naturally expired at end-of-LE-phase, or
    // any routine discard) → NOT defeated. The chain is still alive.
    state = buildSimpleTwoPlayerState();
    const discarded: CardInstance = { instanceId: 'p2-2' as CardInstanceId, definitionId: SMAUG_AHUNT };
    state = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], discardPile: [...state.players[1].discardPile, discarded] },
      ] as typeof state.players,
    };
    expect(isManifestationDefeated(state, SMAUG)).toBe(false);
  });

  test('discarding a manifestation does NOT trigger the cascade', () => {
    // Smaug Ahunt and Smaug At-Home are in P2's cardsInPlay; another
    // Smaug Ahunt naturally expires to discard. The in-play cards must
    // remain — discard is not a defeat.
    let state = buildSimpleTwoPlayerState();
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AHUNT);
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AT_HOME);
    const discardedAhunt: CardInstance = { instanceId: 'p2-99' as CardInstanceId, definitionId: SMAUG_AHUNT };
    state = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], discardPile: [...state.players[1].discardPile, discardedAhunt] },
      ] as typeof state.players,
    };
    const after = applyManifestationCascade(state);
    expect(after).toBe(state);
    expect(after.players[1].cardsInPlay).toHaveLength(2);
  });

  test('after cascade the lair loses its Dragon auto-attack', () => {
    let state = buildSimpleTwoPlayerState();
    state = addCardInPlay(state, HAZARD_PLAYER, SMAUG_AHUNT);
    state = addToKillPile(state, HAZARD_PLAYER, { instanceId: 'p2-50' as CardInstanceId, definitionId: SMAUG });
    const after = applyManifestationCascade(state);
    const lonely = after.cardPool[LONELY_MOUNTAIN] as SiteCard;
    expect(getActiveAutoAttacks(after, lonely)).toHaveLength(0);
  });
});
