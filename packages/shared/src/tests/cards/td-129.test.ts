/**
 * @module td-129.test
 *
 * Card test: Lore of the Ages (td-129)
 * Type: hero-resource-event (permanent), alignment wizard
 *
 * Text:
 *   "Playable on an untapped Elf at a Haven [{H}]. Tap the Elf. When facing
 *    an attack, bearer may tap to give +1 prowess to all characters in his
 *    company against the attack. Bearer makes a corruption check."
 *
 * Effects:
 *   - play-target site: filter siteType "haven"
 *   - play-target character: filter race "elf", untapped, cost tap character
 *   - combat-tap-company-boost: stat prowess +1, cost tap bearer,
 *     enqueueCorruptionCheck true — no `filter` so every company member
 *     (including non-Elves) is boosted
 *
 * | # | Rule                                                           | Status |
 * |---|-----------------------------------------------------------------|--------|
 * | 1 | Playable on an untapped Elf at a Haven                          | OK     |
 * | 2 | Playing taps the Elf (not the site), attaches to the Elf        | OK     |
 * | 3 | Facing an attack, bearer may tap for +1 prowess to whole company| OK     |
 * | 4 | Bearer makes a corruption check                                 | OK     |
 * | 5 | Boost applies only once per attack, swept at attack end         | OK     |
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RESOURCE_PLAYER,
  resetMint, buildSitePhaseState,
  attachItemToChar, getCharacter, findCharInstanceId,
  viableActions, dispatch, resolveChain,
  makeCancelWindowCombat, runCreatureCombat,
  ARAGORN, LEGOLAS, RIVENDELL, MORIA,
  CardStatus,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import type { CardDefinitionId, CharacterCard, GameState, PlayPermanentEventAction } from '../../index.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';

const LORE_OF_THE_AGES = 'td-129' as CardDefinitionId;

describe('Lore of the Ages (td-129)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable on an untapped Elf at a Haven ─────────────────────

  test('IS playable on an untapped Elf at a Haven', () => {
    const state = buildSitePhaseState({ characters: [LEGOLAS], site: RIVENDELL, hand: [LORE_OF_THE_AGES] });
    const actions = computeLegalActions(state, PLAYER_1)
      .filter((a): a is { action: PlayPermanentEventAction; viable: true } =>
        a.viable && a.action.type === 'play-permanent-event' && a.action.cardInstanceId === state.players[0].hand[0].instanceId);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('NOT playable on a non-Elf character (Aragorn)', () => {
    const state = buildSitePhaseState({ characters: [ARAGORN], site: RIVENDELL, hand: [LORE_OF_THE_AGES] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable at a non-Haven site (Moria)', () => {
    const state = buildSitePhaseState({ characters: [LEGOLAS], site: MORIA, hand: [LORE_OF_THE_AGES] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable when the Elf is tapped', () => {
    const state = buildSitePhaseState({
      characters: [LEGOLAS], site: RIVENDELL, hand: [LORE_OF_THE_AGES],
    });
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const tapped: GameState = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [legolasId]: { ...state.players[RESOURCE_PLAYER].characters[legolasId], status: CardStatus.Tapped },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    expect(viableActions(tapped, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Rule 2: playing taps the Elf (not the site), attaches to the Elf ────

  test('playing taps the Elf, leaves the site untapped, and attaches to the Elf', () => {
    const state = buildSitePhaseState({ characters: [LEGOLAS], site: RIVENDELL, hand: [LORE_OF_THE_AGES] });
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    expect(after.players[RESOURCE_PLAYER].characters[legolasId].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expect(after.players[RESOURCE_PLAYER].characters[legolasId].items
      .some(i => i.definitionId === LORE_OF_THE_AGES)).toBe(true);
  });

  // ── Rules 3+4: tap bearer during combat for +1 prowess to the whole company ──

  /** Build a state with Legolas (bearing the card) and Aragorn in a company facing a creature attack. */
  function buildCombatState(strikeProwess = 9) {
    const base = buildSitePhaseState({ characters: [LEGOLAS, ARAGORN], site: RIVENDELL, hand: [] });
    const withCard = attachItemToChar(base, RESOURCE_PLAYER, LEGOLAS, LORE_OF_THE_AGES);
    return makeCancelWindowCombat(withCard, { strikesTotal: 1, strikeProwess });
  }

  test('the bearer-tap boost action is offered during combat', () => {
    const state = buildCombatState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const cardInst = getCharacter(state, RESOURCE_PLAYER, LEGOLAS).items[0].instanceId;
    const actions = viableActions(state, PLAYER_1, 'tap-ally-combat-boost')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardInst
        && 'characterInstanceId' in a.action && a.action.characterInstanceId === legolasId);
    expect(actions).toHaveLength(1);
  });

  test('NOT offered when the bearer (Legolas) is tapped', () => {
    let state = buildCombatState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    state = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          characters: {
            ...state.players[RESOURCE_PLAYER].characters,
            [legolasId]: { ...state.players[RESOURCE_PLAYER].characters[legolasId], status: CardStatus.Tapped },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    const cardInst = getCharacter(state, RESOURCE_PLAYER, LEGOLAS).items[0].instanceId;
    const actions = viableActions(state, PLAYER_1, 'tap-ally-combat-boost')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardInst);
    expect(actions).toHaveLength(0);
  });

  test('activating gives +1 prowess to EVERY character in the company (Elf and non-Elf alike), taps the bearer, and enqueues a corruption check', () => {
    const state = buildCombatState();
    const legolas = getCharacter(state, RESOURCE_PLAYER, LEGOLAS);
    const aragorn = getCharacter(state, RESOURCE_PLAYER, ARAGORN);
    const legolasDef = state.cardPool[legolas.definitionId] as CharacterCard;
    const aragornDef = state.cardPool[aragorn.definitionId] as CharacterCard;
    const cardInst = legolas.items[0].instanceId;

    expect(computeCombatProwess(state, legolas, legolasDef, Race.Orc)).toBe(legolasDef.prowess);
    expect(computeCombatProwess(state, aragorn, aragornDef, Race.Orc)).toBe(aragornDef.prowess);

    const after = dispatch(state, {
      type: 'tap-ally-combat-boost',
      player: PLAYER_1,
      cardInstanceId: cardInst,
      characterInstanceId: legolas.instanceId,
    });

    const legolasAfter = getCharacter(after, RESOURCE_PLAYER, LEGOLAS);
    const aragornAfter = getCharacter(after, RESOURCE_PLAYER, ARAGORN);
    expect(computeCombatProwess(after, legolasAfter, legolasDef, Race.Orc)).toBe(legolasDef.prowess + 1);
    expect(computeCombatProwess(after, aragornAfter, aragornDef, Race.Orc)).toBe(aragornDef.prowess + 1);

    // The bearer (Legolas) is now tapped — his own item stays untapped (cost
    // is "tap the bearer", not "tap the card").
    expect(legolasAfter.status).toBe(CardStatus.Tapped);
    expect(legolasAfter.items[0].status).toBe(CardStatus.Untapped);

    // Two attack-scoped character-stat-modifier constraints (one per company member).
    const boosts = after.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier' && c.scope.kind === 'attack',
    );
    expect(boosts).toHaveLength(2);

    // Legolas has a corruption check enqueued.
    expect(after.pendingResolutions.some(
      r => r.kind.type === 'corruption-check' && r.kind.characterId === legolas.instanceId,
    )).toBe(true);
  });

  test('the boost may only apply once per attack', () => {
    const state = buildCombatState();
    const legolas = getCharacter(state, RESOURCE_PLAYER, LEGOLAS);
    const cardInst = legolas.items[0].instanceId;
    const after = dispatch(state, {
      type: 'tap-ally-combat-boost', player: PLAYER_1, cardInstanceId: cardInst, characterInstanceId: legolas.instanceId,
    });
    // Bearer now tapped, so the action is no longer offered.
    const again = viableActions(after, PLAYER_1, 'tap-ally-combat-boost')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardInst);
    expect(again).toHaveLength(0);
  });

  test('the boost is cleared when the attack finalizes', () => {
    const state = buildCombatState(9);
    const legolas = getCharacter(state, RESOURCE_PLAYER, LEGOLAS);
    const cardInst = legolas.items[0].instanceId;
    const after = dispatch(state, {
      type: 'tap-ally-combat-boost', player: PLAYER_1, cardInstanceId: cardInst, characterInstanceId: legolas.instanceId,
    });
    expect(after.activeConstraints.some(c => c.scope.kind === 'attack')).toBe(true);

    // Resolve the enqueued corruption check first (roll comfortably passes).
    const corruptionAction = viableActions(after, PLAYER_1, 'corruption-check')[0];
    const resolved = dispatch(after, { ...corruptionAction.action, player: PLAYER_1 } as never);

    // Legolas: prowess 5 + 1 boost = 6; roll 5 + 6 = 11 > strikeProwess 9 → defeats the strike outright.
    let finished = runCreatureCombat(resolved, LEGOLAS, 5, null, /* tapToFight */ true);
    if (finished.combat?.phase === 'trophy-offer') {
      finished = dispatch(finished, { type: 'pass', player: PLAYER_1 });
    }
    expect(finished.combat).toBeNull();
    expect(finished.activeConstraints.some(c => c.scope.kind === 'attack')).toBe(false);
  });

  test('a non-Elf, non-bearer character cannot activate the boost', () => {
    const state = buildCombatState();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolas = getCharacter(state, RESOURCE_PLAYER, LEGOLAS);
    const cardInst = legolas.items[0].instanceId;
    const actions = viableActions(state, PLAYER_1, 'tap-ally-combat-boost')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardInst
        && 'characterInstanceId' in a.action && a.action.characterInstanceId === aragornId);
    expect(actions).toHaveLength(0);
  });
});
