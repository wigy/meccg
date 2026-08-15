/**
 * @module tw-224.test
 *
 * Card test: Elf-stone (tw-224)
 * Type: hero-resource-item (minor), non-unique
 *
 * "+2 to direct influence used against an Elf character or an Elf faction.
 *  Cannot be duplicated on a given character."
 *
 * Effects:
 * 1. stat-modifier: +2 DI during influence-check when target.race === "elf"
 * 2. stat-modifier: +2 DI during faction-influence-check when faction.race === "elf"
 * 3. duplication-limit: scope "character", max 1
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  THRANDUILS_HALLS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  WOOD_ELVES,
  buildSitePhaseState, buildTestState, resetMint,
  findCharInstanceId, viablePlayCharacterActions, RESOURCE_PLAYER,
  attachItemToChar, charIdAt,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

const ELF_STONE = 'tw-224' as CardDefinitionId;
// Elladan: elf, mind 4, DI 0 — a local constant since it's only used here
const ELLADAN = 'tw-143' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Elf-stone (tw-224)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 2: +2 DI vs Elf faction (faction-influence-check) ────────────

  test('+2 DI bonus applies during faction influence check against an Elf faction', () => {
    // Aragorn (dunadan, base DI 3) with Elf-stone at Thranduil's Halls.
    // Wood-elves: race "elf", influenceNumber 9, no check-modifier for Dúnadan.
    // With Elf-stone: need = 9 - (3 + 2) = 4.
    const state = buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [ELF_STONE] }],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const attempt = influenceActions.find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    // influenceNumber(9) - baseDI(3) - elfStoneDIBonus(2) = 4
    expect(attempt!.need).toBe(4);
  });

  test('+2 DI bonus compared to same character without Elf-stone', () => {
    // Without Elf-stone: need = 9 - 3 = 6.
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const attempt = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === aragornId);

    expect(attempt).toBeDefined();
    // influenceNumber(9) - baseDI(3) = 6
    expect(attempt!.need).toBe(6);
  });

  // ─── Effect 1: +2 DI vs Elf character (influence-check) ──────────────────

  test('+2 DI bonus enables controlling Elf character Elladan (elf, mind 4)', () => {
    // Aragorn (DI 3) with Elf-stone: effective DI vs Elf = 5 >= Elladan mind 4.
    // Elladan should be playable as follower under Aragorn.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [ELF_STONE] }] }],
          hand: [ELLADAN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);
    const elladanUnderAragorn = actions.filter(a => a.controlledBy === aragornId);
    expect(elladanUnderAragorn.length).toBeGreaterThanOrEqual(1);
  });

  test('without Elf-stone Aragorn (DI 3) cannot control Elladan (elf, mind 4)', () => {
    // Aragorn DI 3 < Elladan mind 4 — cannot control without the bonus.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ELLADAN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.filter(a => a.controlledBy === aragornId)).toHaveLength(0);
  });

  // ─── Effect 3: duplication-limit (per character, max 1) ──────────────────

  test('cannot play a second Elf-stone on the same character', () => {
    // Aragorn already carries one Elf-stone; a second in hand must not be playable on him.
    // Legolas (no Elf-stone) should still be a valid target.
    const state = buildSitePhaseState({
      characters: [
        { defId: ARAGORN, items: [ELF_STONE] },
        LEGOLAS,
      ],
      site: MORIA,
      hand: [ELF_STONE],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const onAragorn = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === aragornId,
    );
    expect(onAragorn).toBeUndefined();

    const onLegolas = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === legolasId,
    );
    expect(onLegolas).toBeDefined();
  });

  test('first Elf-stone can be played on a character with no Elf-stones', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MORIA,
      hand: [ELF_STONE],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const onAragorn = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === aragornId,
    );
    expect(onAragorn).toBeDefined();
  });

  // ─── Printed corruption points (1, per the card database) ────────────────

  test('bearer gains 1 corruption point from carrying Elf-stone', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    expect(base.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(0);

    const withItem = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, ELF_STONE));
    expect(withItem.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.corruptionPoints).toBe(1);
  });
});
