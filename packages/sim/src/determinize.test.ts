/**
 * @module determinize.test
 *
 * Determinizer tests (P5): sampled worlds are internally consistent, the
 * searching player's own legal actions on the sampled state match the
 * original view exactly (the property root-node search depends on), the
 * sampling is deterministic per seed, different seeds produce different
 * hidden worlds, and hidden identities always come from the opponent's
 * unseen pool.
 */

import { describe, test, expect } from 'vitest';
import { loadCardPool, UNKNOWN_CARD, setEngineConsoleLog } from '@meccg/shared';
import type { PlayerView } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import { playGame } from './runner.js';
import { createHeuristicAgent } from './agents/heuristic-agent.js';
import { loadDeck } from './decks.js';
import { determinize, isDeterminizableView } from './search/determinize.js';
import type { Agent } from './types.js';

const DECK_A = loadDeck('challenge-deck-a');
const DECK_B = loadDeck('challenge-deck-b');
const CARD_POOL = loadCardPool();

describe('determinizer', () => {
  test('sampled worlds preserve the searching player\'s legal actions and hidden pools', () => {
    setEngineConsoleLog(false);
    // Capture quiet decision points from a real game through the agent seam.
    const captured: PlayerView[] = [];
    const spy: Agent = {
      name: 'spy',
      chooseAction(context) {
        if (captured.length < 12 && context.view.turnNumber >= 2 && isDeterminizableView(context.view)) {
          captured.push(context.view);
        }
        const inner = createHeuristicAgent();
        return inner.chooseAction(context);
      },
    };
    playGame({ agents: [spy, createHeuristicAgent()], decks: [DECK_A, DECK_B], seed: 4242, maxDecisions: 900, cardPool: CARD_POOL });
    expect(captured.length).toBeGreaterThan(3);

    const oppDeckIds = new Set<string>([...DECK_B.playDeck, ...DECK_B.draftPool] as readonly string[]);
    let comparedViews = 0;
    for (const view of captured.slice(0, 6)) {
      const world = determinize({ view, ownDeck: DECK_A, opponentDeck: DECK_B, seed: 99, cardPool: CARD_POOL });

      // Internal consistency: the projection of the sampled world for the
      // searching player redacts back to the same candidate list.
      const reprojected = projectPlayerView(world, view.self.id);
      expect(reprojected.legalActions.map(e => [e.action.type, e.actionId, e.viable]))
        .toEqual(view.legalActions.map(e => [e.action.type, e.actionId, e.viable]));
      comparedViews++;

      // Hidden opponent hand cards received identities from the unseen pool.
      const oppIndex = 1 - view.selfIndex;
      for (const card of world.players[oppIndex].hand) {
        if (card.definitionId === UNKNOWN_CARD) continue; // exhausted-pool fallback
        expect(oppDeckIds.has(card.definitionId as unknown as string)).toBe(true);
      }
    }
    expect(comparedViews).toBeGreaterThan(3);

    // Determinism per seed; variety across seeds.
    const view = captured[captured.length - 1];
    const worldA = determinize({ view, ownDeck: DECK_A, opponentDeck: DECK_B, seed: 7, cardPool: CARD_POOL });
    const worldB = determinize({ view, ownDeck: DECK_A, opponentDeck: DECK_B, seed: 7, cardPool: CARD_POOL });
    const worldC = determinize({ view, ownDeck: DECK_A, opponentDeck: DECK_B, seed: 8, cardPool: CARD_POOL });
    const oppIndex = 1 - view.selfIndex;
    const handOf = (w: typeof worldA): string => JSON.stringify(w.players[oppIndex].hand);
    expect(handOf(worldB)).toBe(handOf(worldA));
    if (view.opponent.hand.length > 1) {
      expect(handOf(worldC)).not.toBe(handOf(worldA));
    }
  });
});
