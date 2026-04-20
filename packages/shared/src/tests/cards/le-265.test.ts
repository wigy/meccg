/**
 * @module le-265.test
 *
 * Card test: Goblins of Goblin-gate (le-265)
 * Type: minion-resource-faction (orc, unique, 2 MP, influence # 9)
 *
 * "Unique. Playable at Goblin-gate if the influence check is greater than
 *  8. Once in play, the number required to influence this faction is 0.
 *  Standard Modifications: Grey Mountain Goblins (+2)."
 *
 * The "Once in play, the number required to influence this faction is 0"
 * clause governs re-influence (another player taking control). The engine
 * has no re-influence mechanic for any faction, so there is no action
 * path that rule could alter — it is a no-op in the current codebase and
 * is not modeled as an effect.
 *
 * Engine Support:
 * | # | Feature                                         | Status      | Notes                                  |
 * |---|-------------------------------------------------|-------------|----------------------------------------|
 * | 1 | Playable only at Goblin-gate                    | IMPLEMENTED | `playableAt.site` match in site.ts     |
 * | 2 | Influence # 9 (greater than 8)                  | IMPLEMENTED | shared faction-influence machinery     |
 * | 3 | +2 influence check when controller has GMG      | IMPLEMENTED | `controller.inPlay` resolver context   |
 * | 4 | Bonus does NOT apply if opponent has GMG        | IMPLEMENTED | `controller.inPlay` is per-player      |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, InfluenceAttemptAction,
  SitePhaseState,
} from '../../index.js';

const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const GREY_MOUNTAIN_GOBLINS = 'le-266' as CardDefinitionId;

const CIRYAHER = 'le-6' as CardDefinitionId;            // dúnadan scout/sage, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;             // orc warrior, DI 0, no effects
const GOBLIN_GATE = 'le-378' as CardDefinitionId;       // shadow-hold
const DOL_GULDUR = 'le-367' as CardDefinitionId;        // minion haven (site deck filler)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;      // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;      // shadow-hold, not Goblin-gate

function sitePhaseStatePlayResources(): SitePhaseState {
  return {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: true,
    resourcePlayed: false,
    minorItemAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };
}

function firstInfluenceAttempt(
  state: ReturnType<typeof buildTestState>,
  factionInstanceId: CardInstanceId,
): InfluenceAttemptAction | undefined {
  const actions = computeLegalActions(state, PLAYER_1);
  return actions
    .filter(a => a.viable && a.action.type === 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.factionInstanceId === factionInstanceId);
}

describe('Goblins of Goblin-gate (le-265)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at Goblin-gate with baseline need = 9 - DI', () => {
    // Ciryaher (DI 2, no effects) at Goblin-gate with Goblins of Goblin-gate
    // in hand. No Grey Mountain Goblins in play → modifier = DI 2.
    // need = influenceNumber(9) - DI(2) = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: sitePhaseStatePlayResources() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 check modifier applies when controller also has Grey Mountain Goblins in play', () => {
    // Same setup but Grey Mountain Goblins already in PLAYER_1's cardsInPlay.
    // modifier = DI 2 + check bonus 2 = 4; need = 9 - 4 = 5.
    const gmgInPlay: CardInPlay = {
      instanceId: 'gmg-1' as CardInstanceId,
      definitionId: GREY_MOUNTAIN_GOBLINS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR], cardsInPlay: [gmgInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: sitePhaseStatePlayResources() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  test('bonus does NOT apply when only the OPPONENT has Grey Mountain Goblins in play', () => {
    // GMG is on the opponent's side — controller.inPlay is per-player.
    // need stays at baseline 9 - 2 = 7.
    const gmgInPlay: CardInPlay = {
      instanceId: 'gmg-1' as CardInstanceId,
      definitionId: GREY_MOUNTAIN_GOBLINS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [gmgInPlay] },
      ],
    });
    const state = { ...base, phaseState: sitePhaseStatePlayResources() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('faction is NOT influence-able at a site other than Goblin-gate', () => {
    // Same character, different shadow-hold (Moria). The playableAt
    // restriction should disqualify the faction — no influence-attempt
    // action emitted for Goblins of Goblin-gate.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [CIRYAHER] }], hand: [GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: sitePhaseStatePlayResources() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('influence-attempt uses Ciryaher (only untapped character in company)', () => {
    // Sanity check that the influencingCharacterId field points at
    // Ciryaher — protects against the test passing due to an unrelated
    // character being picked up.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: sitePhaseStatePlayResources() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const attempt = firstInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(ciryaherId);
  });
});
