/**
 * @module ba-2.test
 *
 * Card test: Azog (ba-2)
 * Type: minion-character (balrog alignment), race orc, homesite Moria
 * Stats: prowess 6, body 9, mind 7, direct influence 1, MP 2 (character)
 * Skills: warrior, diplomat. Keywords: leader, balrog-specific. Unique.
 *
 * Card text:
 *   "Unique. Balrog specific. Leader. Discard on a body check result of 9.
 *    +3 direct influence against Orcs and Orc factions. +2 direct influence
 *    against Balrog specific characters."
 *
 * Rules covered (real assertions, no JSON-vs-itself checks):
 *  1. stat-modifier direct-influence +3 during an influence-check when the
 *     target character's race is orc — lets Azog control an Orc as a follower
 *     that his base DI (1) alone could not afford.
 *  2. The +3 is race-gated: it does NOT apply to a non-Orc, non-Balrog-specific
 *     target (a plain Troll), so Azog cannot control it.
 *  3. stat-modifier direct-influence +2 during an influence-check when the
 *     target character carries the `balrog-specific` keyword — lets Azog control
 *     a Balrog-specific Troll (not an Orc, so only the +2 applies) whose mind
 *     his base DI (1) alone could not afford.
 *  4. stat-modifier direct-influence +3 during a faction-influence-check when
 *     the faction's race is orc — reduces the influence `need` against an Orc
 *     faction.
 *  5. "Discard on a body check result of 9" (`discardBodyCheck: [9]`): a body
 *     check rolling exactly 9 discards Azog (to the discard pile) rather than
 *     leaving him wounded; a roll of 10 exceeds body 9 and eliminates him.
 *
 * Fixture alignment: Azog is a Balrog card, so the influence-check tests use a
 * Balrog player at a Balrog Wizardhaven (Moria, ba-93) and the body-check test
 * a Balrog company. The faction-influence path (rule-identical across the
 * minion side) uses a minion Orc faction, since the Balrog pool has no usable
 * Orc faction of its own.
 *
 * "leader" and "balrog specific" are descriptive keywords consumed by other
 * cards' effects (and by rule 8.31 for the body check); "Unique" is enforced by
 * deck construction. Those are documented here, not asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  buildTestState, buildMinionSitePhaseState, resetMint,
  findCharInstanceId, viablePlayCharacterActions, companyIdAt,
  viableActions, dispatch, setCharStatus,
  makeShadowMHState, makeBodyCheckCombat,
  CardStatus, LEGOLAS, LORIEN, RIVENDELL,
} from '../test-helpers.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase, Alignment } from '../../index.js';

const AZOG = 'ba-2' as CardDefinitionId;

// Influence-check targets
const GRISHNAKH = 'le-12' as CardDefinitionId; // orc, mind 3, NOT balrog-specific
const HILL_TROLL = 'ba-7' as CardDefinitionId;  // troll, mind 3, balrog-specific
const TROLL_LOUT = 'le-44' as CardDefinitionId;  // troll, mind 3, NOT balrog-specific

// Balrog Wizardhavens (any character is playable at a haven)
const MORIA_BA = 'ba-93' as CardDefinitionId;
const UNDER_GATES = 'ba-100' as CardDefinitionId;

// Minion Orc faction and its site (faction-influence path is alignment-neutral)
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc faction, influence# 9
const GOBLIN_GATE = 'le-378' as CardDefinitionId;            // shadow-hold where it plays

describe('Azog (ba-2)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: +3 DI during influence-check (Orc characters) ────────────────

  test('+3 DI vs Orcs lets Azog control Grishnákh (orc, mind 3) as a follower', () => {
    // Azog base DI = 1. Grishnákh is an Orc of mind 3.
    // Without the +3: DI 1 < mind 3 → cannot control.
    // With +3 vs Orcs: DI 1 + 3 = 4 >= mind 3 → controllable under Azog's DI.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA_BA, characters: [AZOG] }],
          hand: [GRISHNAKH],
          siteDeck: [UNDER_GATES],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const azogId = findCharInstanceId(state, RESOURCE_PLAYER, AZOG);
    const underAzog = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.controlledBy === azogId);

    expect(underAzog.length).toBeGreaterThanOrEqual(1);
  });

  test('+3/+2 DI bonuses do NOT apply to a plain Troll (not Orc, not Balrog-specific)', () => {
    // Troll Lout: troll, mind 3, no balrog-specific keyword. Neither the +3 (Orc)
    // nor the +2 (Balrog-specific) gate matches, so Azog's DI stays 1 < mind 3
    // and he cannot take it as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA_BA, characters: [AZOG] }],
          hand: [TROLL_LOUT],
          siteDeck: [UNDER_GATES],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const azogId = findCharInstanceId(state, RESOURCE_PLAYER, AZOG);
    const underAzog = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.controlledBy === azogId);

    expect(underAzog).toHaveLength(0);
  });

  // ─── Effect: +2 DI during influence-check (Balrog-specific characters) ──────

  test('+2 DI vs Balrog-specific lets Azog control Hill-troll (troll, mind 3) as a follower', () => {
    // Hill-troll (ba-7): troll (NOT orc) with the balrog-specific keyword, mind 3.
    // The +3-vs-Orcs bonus does not apply (troll); only the +2-vs-Balrog-specific
    // does: DI 1 + 2 = 3 >= mind 3 → controllable under Azog's DI. Without the
    // +2, DI 1 < 3 → not controllable (verified by the plain-Troll test above).
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA_BA, characters: [AZOG] }],
          hand: [HILL_TROLL],
          siteDeck: [UNDER_GATES],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const azogId = findCharInstanceId(state, RESOURCE_PLAYER, AZOG);
    const underAzog = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.controlledBy === azogId);

    expect(underAzog.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Effect 2: +3 DI during faction-influence-check (Orc factions) ──────────

  test('+3 DI vs Orc factions reduces the influence need against Goblins of Goblin-gate', () => {
    // Azog (base DI 1) influences Goblins of Goblin-gate (orc faction, inf# 9)
    // at Goblin-gate. need = influenceNumber(9) - DI(1) - orcFactionBonus(3) = 5.
    const state = buildMinionSitePhaseState({
      characters: [AZOG],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const azogId = findCharInstanceId(state, RESOURCE_PLAYER, AZOG);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const azogAttempt = influenceActions.find(a => a.influencingCharacterId === azogId);
    expect(azogAttempt).toBeDefined();
    expect(azogAttempt!.need).toBe(5);
  });

  // ─── "Discard on a body check result of 9" (discardBodyCheck: [9]) ──────────

  test('body check rolling 9 discards Azog (not eliminated)', () => {
    // Azog: orc minion-character, body 9, discardBodyCheck [9]. A roll of exactly
    // 9 matches the discard number → discard pile, not out-of-play (rule 8.31).
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA_BA, characters: [AZOG] }],
          hand: [],
          siteDeck: [UNDER_GATES],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const azogId = findCharInstanceId(state, RESOURCE_PLAYER, AZOG);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, AZOG, CardStatus.Inverted);
    const readyState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: azogId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === azogId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === azogId)).toBe(false);
  });

  test('body check rolling 10 exceeds body 9 and eliminates Azog', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA_BA, characters: [AZOG] }],
          hand: [],
          siteDeck: [UNDER_GATES],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const azogId = findCharInstanceId(state, RESOURCE_PLAYER, AZOG);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, AZOG, CardStatus.Inverted);
    const readyState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: azogId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === azogId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === azogId)).toBe(false);
  });
});
