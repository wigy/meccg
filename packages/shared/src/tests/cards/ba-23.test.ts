/**
 * @module ba-23.test
 *
 * Card test: The Reek (ba-23)
 * Type: hazard-event (short)
 *
 * "Playable on a company at or moving to a Ruins & Lairs [{R}] or Under-deeps
 *  site if you discard an Animal or Spider creature from your hand. Tap all
 *  untapped characters in the company with a mind less than 2 plus the number
 *  of Spawn cards in play. Eliminated Spawn do not count. Does not affect
 *  Wizards or Ringwraiths."
 *
 * Card shape:
 *   - effects[0]: play-target (company; siteType ruins-and-lairs OR site keyword
 *                 under-deeps)
 *   - effects[1]: play-discard-cost (discard an Animal/Spider hazard-creature
 *                 from hand)
 *   - effects[2]: company-tap-characters (mindBelow "2 + spawnCardsInPlay",
 *                 filter excluding the wizard and ringwraith races)
 *
 * Engine support exercised:
 *   - play-target company filter on the company's current-or-destination site
 *     (R&L site type, or the under-deeps keyword) — company-targeting short
 *     event branch in movement-hazard legal actions
 *   - play-discard-cost: only playable if an Animal/Spider creature is in hand;
 *     one action per matching cost card; on play the chosen creature is
 *     discarded with the event
 *   - company-tap-characters resolution: on chain resolution every untapped
 *     character in the active company whose effective mind is below
 *     (2 + number of `spawn`-keyword cards in play) is tapped, except Wizards
 *     and Ringwraiths (both avatar races, whose mind is null → treated as 0 and
 *     would otherwise always be under the threshold)
 *   - countSpawnCardsInPlay: raising the number of in-play Spawn cards raises
 *     the mind threshold, tapping more characters ("2 plus the number of Spawn
 *     cards in play")
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  P1_COMPANY,
  ARAGORN, GANDALF, BARROW_WIGHT, RIVENDELL,
  buildTestState, resetMint, makeMHState,
  dispatch, resolveChain,
  findHandCardId, addCardInPlay, expectCharStatus,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, CardStatus } from '../../index.js';
import type { GameState, CardDefinitionId, PlayHazardAction } from '../../index.js';

const THE_REEK = 'ba-23' as CardDefinitionId;
const GIANT_SPIDERS = 'tw-40' as CardDefinitionId;       // hazard-creature, race "spiders"
const WATCHER_IN_THE_WATER = 'tw-110' as CardDefinitionId; // hazard-creature, race "animals"
const SPAWN_OF_UNGOLIANT = 'ba-24' as CardDefinitionId;  // hazard-event, keyword "spawn"
const ETTENMOORS = 'tw-395' as CardDefinitionId;         // hero ruins-and-lairs
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId;      // ruins-and-lairs with under-deeps keyword
const BARLIMAN = 'tw-125' as CardDefinitionId;           // Man, mind 1
const BARD = 'tw-124' as CardDefinitionId;               // Man, mind 2

/** Viable play-hazard actions for The Reek specifically. */
function reekActions(state: GameState): PlayHazardAction[] {
  const reekId = findHandCardId(state, HAZARD_PLAYER, THE_REEK);
  return computeLegalActions(state, PLAYER_2)
    .filter(a => a.viable && a.action.type === 'play-hazard'
      && a.action.cardInstanceId === reekId)
    .map(a => a.action as PlayHazardAction);
}

/**
 * Build an M/H state with PLAYER_1's company stationed at `site` and the hazard
 * player (PLAYER_2) holding The Reek plus `hazardHand` cards.
 */
function stateAt(site: CardDefinitionId, characters: CardDefinitionId[], hazardHand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site, characters }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [THE_REEK, ...hazardHand], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

describe('The Reek (ba-23)', () => {
  beforeEach(() => resetMint());

  test('playable on a company at a Ruins & Lairs when a Spider creature is in hand', () => {
    const s = stateAt(ETTENMOORS, [ARAGORN], [GIANT_SPIDERS]);
    const actions = reekActions(s);
    // One action for the single company, carrying the Spider creature as the
    // discard cost and no per-character target.
    expect(actions).toHaveLength(1);
    const spiderId = findHandCardId(s, HAZARD_PLAYER, GIANT_SPIDERS);
    expect(actions[0].targetCompanyId).toBe(P1_COMPANY);
    expect(actions[0].targetCharacterId).toBeUndefined();
    expect(actions[0].costDiscardInstanceId).toBe(spiderId);
  });

  test('playable at an Under-deeps site (keyed by the under-deeps keyword, not the site type)', () => {
    const s = stateAt(DROWNING_DEEPS, [ARAGORN], [GIANT_SPIDERS]);
    expect(reekActions(s)).toHaveLength(1);
  });

  test('offers one discard-cost action per Animal/Spider creature in hand', () => {
    const s = stateAt(ETTENMOORS, [ARAGORN], [GIANT_SPIDERS, WATCHER_IN_THE_WATER]);
    const actions = reekActions(s);
    expect(actions).toHaveLength(2);
    const spiderId = findHandCardId(s, HAZARD_PLAYER, GIANT_SPIDERS);
    const watcherId = findHandCardId(s, HAZARD_PLAYER, WATCHER_IN_THE_WATER);
    expect(actions.map(a => a.costDiscardInstanceId).sort()).toEqual([spiderId, watcherId].sort());
  });

  test('NOT playable at a non-R&L, non-Under-deeps site (a Haven)', () => {
    const s = stateAt(RIVENDELL, [ARAGORN], [GIANT_SPIDERS]);
    expect(reekActions(s)).toHaveLength(0);
  });

  test('NOT playable without an Animal or Spider creature in hand to discard', () => {
    // Barrow-wight is an Undead creature — it does not satisfy the discard cost.
    const s = stateAt(ETTENMOORS, [ARAGORN], [BARROW_WIGHT]);
    expect(reekActions(s)).toHaveLength(0);
  });

  test('playing The Reek discards both the chosen Spider creature and the event', () => {
    const s0 = stateAt(ETTENMOORS, [ARAGORN], [GIANT_SPIDERS]);
    const reekId = findHandCardId(s0, HAZARD_PLAYER, THE_REEK);
    const spiderId = findHandCardId(s0, HAZARD_PLAYER, GIANT_SPIDERS);

    const s = dispatch(s0, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: reekId,
      targetCompanyId: P1_COMPANY,
      costDiscardInstanceId: spiderId,
    });

    const hazardHand = s.players[HAZARD_PLAYER].hand.map(c => c.instanceId);
    expect(hazardHand).not.toContain(reekId);
    expect(hazardHand).not.toContain(spiderId);
    const discard = s.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId);
    expect(discard).toContain(spiderId);
  });

  test('with no Spawn cards in play (threshold 2), taps only characters with mind < 2, skipping Wizards', () => {
    // Barliman (mind 1), Bard (mind 2), Aragorn (mind 9), Gandalf (wizard, mind null → 0).
    const s0 = stateAt(ETTENMOORS, [BARLIMAN, BARD, ARAGORN, GANDALF], [GIANT_SPIDERS]);
    const reekId = findHandCardId(s0, HAZARD_PLAYER, THE_REEK);
    const spiderId = findHandCardId(s0, HAZARD_PLAYER, GIANT_SPIDERS);

    let s = dispatch(s0, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: reekId,
      targetCompanyId: P1_COMPANY,
      costDiscardInstanceId: spiderId,
    });
    s = resolveChain(s);

    expectCharStatus(s, RESOURCE_PLAYER, BARLIMAN, CardStatus.Tapped);   // mind 1 < 2
    expectCharStatus(s, RESOURCE_PLAYER, BARD, CardStatus.Untapped);     // mind 2, not < 2
    expectCharStatus(s, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);  // mind 9
    expectCharStatus(s, RESOURCE_PLAYER, GANDALF, CardStatus.Untapped);  // wizard — excluded
  });

  test('a Spawn card in play raises the threshold (2 + 1 = 3), tapping the mind-2 character too', () => {
    let s0 = stateAt(ETTENMOORS, [BARLIMAN, BARD, ARAGORN, GANDALF], [GIANT_SPIDERS]);
    // One Spawn-keyword card in play → threshold becomes 2 + 1 = 3.
    s0 = addCardInPlay(s0, HAZARD_PLAYER, SPAWN_OF_UNGOLIANT);
    const reekId = findHandCardId(s0, HAZARD_PLAYER, THE_REEK);
    const spiderId = findHandCardId(s0, HAZARD_PLAYER, GIANT_SPIDERS);

    let s = dispatch(s0, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: reekId,
      targetCompanyId: P1_COMPANY,
      costDiscardInstanceId: spiderId,
    });
    s = resolveChain(s);

    expectCharStatus(s, RESOURCE_PLAYER, BARLIMAN, CardStatus.Tapped);   // mind 1 < 3
    expectCharStatus(s, RESOURCE_PLAYER, BARD, CardStatus.Tapped);       // mind 2 < 3 now
    expectCharStatus(s, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);  // mind 9
    expectCharStatus(s, RESOURCE_PLAYER, GANDALF, CardStatus.Untapped);  // wizard — excluded
  });
});
