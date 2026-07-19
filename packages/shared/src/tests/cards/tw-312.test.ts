/**
 * @module tw-312.test
 *
 * Card test: Red Arrow (tw-312)
 * Type: hero-resource-item (major item), unique, 2 MP (item), 2 CP.
 *
 * Card text:
 *   "Unique. Bearer may automatically influence the Riders of Rohan. +5 to the
 *    bearer's direct influence against any character with Edoras as a home site."
 *
 * Two effects, both flowing to the bearer because item effects are collected
 * onto the carrying character:
 *   1. `auto-influence-faction` (faction "Riders of Rohan") — a faction-influence
 *      attempt against the Riders of Rohan by the bearer succeeds with no 2d6
 *      check. Exercised through the faction-influence legal-action `need`
 *      (0 / automatic) and `resolveInfluenceAttemptRoll` (guaranteed success,
 *      no dice-roll effect emitted).
 *   2. `stat-modifier` direct-influence +5 gated on `influence-check` +
 *      `target.homesite $includes "Edoras"` — mirrors the dm-27 Wormtongue
 *      precedent; exercised through `availableDI` against an Edoras-homesite
 *      character.
 *
 * "Unique." is structural (the `unique` flag). Tests drive engine computation
 * (computeLegalActions / availableDI / resolveInfluenceAttemptRoll) and assert
 * on the resulting actions/state — no assertions on the card JSON itself.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, THEODEN, LEGOLAS,
  EDORAS, LORIEN, MORIA, MINAS_TIRITH, RIDERS_OF_ROHAN,
  buildSitePhaseState, buildTestState, resetMint, mint,
  findCharInstanceId,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstance, CharacterCard, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import { resolveInfluenceAttemptRoll } from '../../engine/reducer-site.js';

const RED_ARROW = 'tw-312' as CardDefinitionId;

function riderAttempt(state: ReturnType<typeof buildSitePhaseState>, charId: string): InfluenceAttemptAction | undefined {
  return computeLegalActions(state, PLAYER_1)
    .filter(a => a.viable && a.action.type === 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.influencingCharacterId === charId);
}

describe('Red Arrow (tw-312)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: automatic influence of the Riders of Rohan ────────────────────

  test('Riders of Rohan influence by the bearer is automatic (need 0)', () => {
    // Aragorn (DI 3) bearing Red Arrow at Edoras. Without the item the attempt
    // would need a roll >= influence#(10) - DI(3) = 7; the auto grant makes it 0.
    const state = buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [RED_ARROW] }],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const attempt = riderAttempt(state, aragornId as string);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(0);
  });

  test('without Red Arrow the same attempt needs a real roll', () => {
    // Control: Aragorn (DI 3, a Man) alone. The Riders of Rohan card grants a
    // +1 influence check bonus to a Man influencer, so
    // need = influence#(10) - DI(3) - check bonus(1) = 6 — a real (non-zero) roll.
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const attempt = riderAttempt(state, aragornId as string);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('resolving the auto influence succeeds with no dice roll', () => {
    // The faction is on the chain (entry.card); resolving it with the bearer
    // present skips the 2d6 check: the faction lands in play and no dice-roll
    // effect is emitted.
    const state = buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [RED_ARROW] }],
      site: EDORAS,
      hand: [],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const faction: CardInstance = { instanceId: mint(), definitionId: RIDERS_OF_ROHAN };

    const { state: after, effects } = resolveInfluenceAttemptRoll(state, {
      card: faction,
      declaredBy: PLAYER_1,
      payload: { type: 'influence-attempt', influencingCharacterId: aragornId },
    });

    // Guaranteed success — the faction is now in play.
    expect(after.players[0].cardsInPlay.some(c => c.definitionId === RIDERS_OF_ROHAN)).toBe(true);
    // No dice were rolled: no roll effect emitted.
    expect(effects.length).toBe(0);
  });

  test('resolving the same attempt WITHOUT Red Arrow rolls the dice', () => {
    // Control: no auto grant → the roll path runs and emits a dice-roll effect.
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: EDORAS,
      hand: [],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const faction: CardInstance = { instanceId: mint(), definitionId: RIDERS_OF_ROHAN };

    const { effects } = resolveInfluenceAttemptRoll(state, {
      card: faction,
      declaredBy: PLAYER_1,
      payload: { type: 'influence-attempt', influencingCharacterId: aragornId },
    });

    expect(effects.length).toBe(1);
  });

  // ─── Effect 2: +5 direct influence vs Edoras-homesite characters ─────────────

  test('+5 DI applies when influencing a character with Edoras as a home site', () => {
    // Aragorn (DI 3) bearing Red Arrow influencing Théoden (homesite Edoras):
    // availableDI = base DI 3 + 5 = 8.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [{ defId: ARAGORN, items: [RED_ARROW] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const theodenDef = pool[THEODEN as string] as CharacterCard;

    expect(availableDI(state, aragornId, state.players[0], theodenDef)).toBe(8);
  });

  test('+5 DI does NOT apply against a character without Edoras home site', () => {
    // Aragorn's own homesite is Bree, so influencing an Aragorn (Bree) grants
    // no bonus: DI stays at base 3.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [{ defId: ARAGORN, items: [RED_ARROW] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const aragornDef = pool[ARAGORN as string] as CharacterCard;

    expect(availableDI(state, aragornId, state.players[0], aragornDef)).toBe(3);
  });

  test('without Red Arrow there is no +5 DI against an Edoras-homesite character', () => {
    // Control: bare Aragorn influencing Théoden → base DI 3, no bonus.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const theodenDef = pool[THEODEN as string] as CharacterCard;

    expect(availableDI(state, aragornId, state.players[0], theodenDef)).toBe(3);
  });
});
