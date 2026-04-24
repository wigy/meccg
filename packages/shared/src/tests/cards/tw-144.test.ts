/**
 * @module tw-144.test
 *
 * Card test: Elrohir (tw-144)
 * Type: hero-character
 * Prowess: 5, Body: 8, Mind: 4, Race: elf, Skills: warrior/ranger
 * Effects: 1
 *
 * "Unique. +1 prowess against Orcs."
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                      |
 * |---|----------------------------------|-------------|--------------------------------------------|
 * | 1 | +1 prowess vs Orcs in combat     | IMPLEMENTED | stat-modifier resolved by collectCharacterEffects |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
  buildTestState, resetMint,
  getCharacter,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';
import { pool } from '../test-helpers.js';
import {
  collectCharacterEffects,
  resolveStatModifiers,
  type ResolverContext,
} from '../../engine/effects/index.js';

const ELROHIR = 'tw-144' as CardDefinitionId;

describe('Elrohir (tw-144)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: +1 prowess against Orcs in combat ─────────────────────────

  test('+1 prowess bonus applies in combat against Orcs', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROHIR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const elrohirChar = getCharacter(state, RESOURCE_PLAYER, ELROHIR);
    const elrohirDef = pool[ELROHIR as string] as CharacterCard;
    const ctx: ResolverContext = {
      reason: 'combat',
      bearer: {
        race: elrohirDef.race,
        skills: elrohirDef.skills,
        baseProwess: elrohirDef.prowess,
        baseBody: elrohirDef.body,
        baseDirectInfluence: elrohirDef.directInfluence,
        name: elrohirDef.name,
      },
      enemy: { race: 'orc', name: 'Orc Guard', prowess: 4, body: null },
    };

    const effects = collectCharacterEffects(state, elrohirChar, ctx);
    const bonus = resolveStatModifiers(effects, 'prowess', 0, ctx);
    expect(bonus).toBe(1);
  });

  test('no prowess bonus against non-Orcs (e.g. trolls)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROHIR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const elrohirChar = getCharacter(state, RESOURCE_PLAYER, ELROHIR);
    const elrohirDef = pool[ELROHIR as string] as CharacterCard;
    const ctx: ResolverContext = {
      reason: 'combat',
      bearer: {
        race: elrohirDef.race,
        skills: elrohirDef.skills,
        baseProwess: elrohirDef.prowess,
        baseBody: elrohirDef.body,
        baseDirectInfluence: elrohirDef.directInfluence,
        name: elrohirDef.name,
      },
      enemy: { race: 'troll', name: 'Bert Burat', prowess: 9, body: 9 },
    };

    const effects = collectCharacterEffects(state, elrohirChar, ctx);
    const bonus = resolveStatModifiers(effects, 'prowess', 0, ctx);
    expect(bonus).toBe(0);
  });

  test('no prowess bonus outside combat (influence check context)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROHIR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const elrohirChar = getCharacter(state, RESOURCE_PLAYER, ELROHIR);
    const elrohirDef = pool[ELROHIR as string] as CharacterCard;
    const ctx: ResolverContext = {
      reason: 'influence-check',
      bearer: {
        race: elrohirDef.race,
        skills: elrohirDef.skills,
        baseProwess: elrohirDef.prowess,
        baseBody: elrohirDef.body,
        baseDirectInfluence: elrohirDef.directInfluence,
        name: elrohirDef.name,
      },
    };

    const effects = collectCharacterEffects(state, elrohirChar, ctx);
    const bonus = resolveStatModifiers(effects, 'prowess', 0, ctx);
    expect(bonus).toBe(0);
  });
});
