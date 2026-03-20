/**
 * @module effects-resolver.test
 *
 * Tests for the card effects resolver, verifying that DSL effects from
 * card JSON data are correctly evaluated in context.
 */

import { describe, it, expect } from 'vitest';
import { evaluateExpr } from '../engine/effects/expression-eval.js';
import {
  collectCharacterEffects,
  resolveStatModifiers,
  resolveCheckModifier,
} from '../engine/effects/resolver.js';
import type { ResolverContext } from '../engine/effects/resolver.js';
import {
  pool, makeQuickStartConfig, makeDraftConfig, runSimpleDraft, reduce,
  PLAYER_1,
  ARAGORN, DAGGER_OF_WESTERNESSE, GLAMDRING,
} from './test-helpers.js';
import { createGameQuickStart } from '../engine/init.js';
import { matchesCondition } from '@meccg/shared';
import type { GameState, HeroCharacterCard, HeroItemCard, CardDefinitionId } from '@meccg/shared';

/** Helper to build a ResolverContext for a character definition. */
function contextForCharacter(charDefId: CardDefinitionId, reason = 'effective-stats'): ResolverContext {
  const def = pool[charDefId as string] as HeroCharacterCard;
  return {
    reason,
    bearer: {
      race: def.race,
      skills: [...def.skills],
      baseProwess: def.prowess,
      baseBody: def.body,
      baseDirectInfluence: def.directInfluence,
      name: def.name,
    },
  };
}

describe('evaluateExpr', () => {
  it('returns plain numbers as-is', () => {
    expect(evaluateExpr(5, {})).toBe(5);
  });

  it('evaluates simple expressions', () => {
    expect(evaluateExpr('2 + 3', {})).toBe(5);
  });

  it('evaluates expressions with context variables', () => {
    const context = { bearer: { baseProwess: 6 } };
    expect(evaluateExpr('bearer.baseProwess * 2', context)).toBe(12);
  });

  it('handles nested context paths', () => {
    const context = { a: { b: { c: 10 } } };
    expect(evaluateExpr('a.b.c + 5', context)).toBe(15);
  });
});

describe('resolveStatModifiers', () => {
  let state: GameState;

  function setupState(): GameState {
    return createGameQuickStart(makeQuickStartConfig(), pool);
  }

  it('computes base stats when character has no items', () => {
    state = setupState();
    const player = state.players[0];
    // Aragorn is the first character
    const charEntry = Object.values(player.characters)[0];
    const context = contextForCharacter(ARAGORN);
    const collected = collectCharacterEffects(state, charEntry, context);

    // Aragorn has no stat-modifier effects for effective-stats reason
    const prowess = resolveStatModifiers(collected, 'prowess', 6, context);
    const body = resolveStatModifiers(collected, 'body', 9, context);
    expect(prowess).toBe(6);
    expect(body).toBe(9);
  });

  it('applies item prowess modifier with cap', () => {
    // Use draft path to get items assigned
    let draftState = runSimpleDraft(makeDraftConfig());
    const p1Char = draftState.players[0].companies[0].characters[0];

    // Assign both daggers to Aragorn
    let result = reduce(draftState, { type: 'assign-starting-item', player: PLAYER_1, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p1Char });
    draftState = result.state;
    result = reduce(draftState, { type: 'assign-starting-item', player: PLAYER_1, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p1Char });
    draftState = result.state;

    const charEntry = draftState.players[0].characters[p1Char as string];
    const context = contextForCharacter(ARAGORN);
    const collected = collectCharacterEffects(draftState, charEntry, context);

    // Daggers: each has +1 prowess, max 8. Base 6 + 1 + 1 = 8, within cap
    const prowess = resolveStatModifiers(collected, 'prowess', 6, context);
    expect(prowess).toBe(8);
  });

  it('applies override when condition matches', () => {
    // Glamdring: +3 prowess max 8, but max 9 vs Orcs (overrides base)
    const glamdringDef = pool[GLAMDRING as string] as HeroItemCard;
    expect(glamdringDef.effects).toBeDefined();

    const combatContext: ResolverContext = {
      reason: 'combat',
      bearer: {
        race: 'dunadan',
        skills: ['warrior', 'scout', 'ranger'],
        baseProwess: 6,
        baseBody: 9,
        baseDirectInfluence: 3,
        name: 'Aragorn II',
      },
      enemy: { race: 'orc', name: 'Orc-patrol', prowess: 6, body: null },
    };

    // Filter effects by condition (simulating what collectEffects does)
    const collected = glamdringDef.effects!
      .filter(e => !e.when || matchesCondition(e.when, combatContext as unknown as Record<string, unknown>))
      .map(e => ({ effect: e, sourceDef: glamdringDef }));

    // With Aragorn (prowess 6) + Glamdring (+3) = 9, max should be 9 vs Orcs
    const prowess = resolveStatModifiers(collected, 'prowess', 6, combatContext);
    expect(prowess).toBe(9);
  });

  it('applies max cap from base effect when no override matches', () => {
    const glamdringDef = pool[GLAMDRING as string] as HeroItemCard;

    const combatContext: ResolverContext = {
      reason: 'combat',
      bearer: {
        race: 'dunadan',
        skills: ['warrior'],
        baseProwess: 6,
        baseBody: 9,
        baseDirectInfluence: 3,
        name: 'Aragorn II',
      },
      enemy: { race: 'dragon', name: 'Cave-drake', prowess: 10, body: null },
    };

    const collected = glamdringDef.effects!
      .filter(e => !e.when || matchesCondition(e.when, combatContext as unknown as Record<string, unknown>))
      .map(e => ({ effect: e, sourceDef: glamdringDef }));

    // Aragorn (6) + Glamdring (+3) = 9, but max 8 vs non-Orcs
    const prowess = resolveStatModifiers(collected, 'prowess', 6, combatContext);
    expect(prowess).toBe(8);
  });
});

describe('resolveCheckModifier', () => {
  it('sums corruption check modifiers', () => {
    // Gandalf has +1 corruption check modifier
    const state = createGameQuickStart(makeQuickStartConfig(), pool);
    const player = state.players[0];
    // Bilbo is the second character (has +4 corruption check modifier)
    const chars = Object.values(player.characters);
    const bilbo = chars.find(c => {
      const def = pool[state.instanceMap[c.instanceId as string].definitionId as string];
      return def && def.name === 'Bilbo';
    });
    expect(bilbo).toBeDefined();

    const context: ResolverContext = { reason: 'corruption-check' };
    const collected = collectCharacterEffects(state, bilbo!, context);

    const modifier = resolveCheckModifier(collected, 'corruption');
    expect(modifier).toBe(4); // Bilbo's +4 corruption modifier
  });
});

describe('resolveCompanyModifier', () => {
  it('identifies company-modifier effects', () => {
    // The One Ring has a company-modifier for corruption-points
    const oneRingDef = pool['tw-347'] as HeroItemCard;
    expect(oneRingDef.effects).toBeDefined();

    const companyEffects = oneRingDef.effects!.filter(e => e.type === 'company-modifier');
    expect(companyEffects.length).toBe(1);
  });
});

describe('expression evaluation for caps', () => {
  it('evaluates bearer.baseProwess * 2 (One Ring cap)', () => {
    const context = { bearer: { baseProwess: 1 } };
    // Frodo has baseProwess 1, so max is 2
    expect(evaluateExpr('bearer.baseProwess * 2', context)).toBe(2);

    // Aragorn has baseProwess 6, so max is 12
    expect(evaluateExpr('bearer.baseProwess * 2', { bearer: { baseProwess: 6 } })).toBe(12);
  });
});
