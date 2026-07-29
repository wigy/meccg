/**
 * @module ai/h2/core/action-fields.test
 *
 * The list of spellings is only useful if it is complete, so the test that
 * matters is the one that checks it against the engine's real actions rather
 * than against itself: play games, take every action type an H2 module owns,
 * and assert that each one's card or character can actually be found.
 *
 * That is the guard the six bugs of this shape all needed. Each of them was a
 * module reading one field where the engine kept the answer in another, and
 * each was invisible because a module that finds nothing declines — which in
 * the coverage report reads exactly like an action type nobody owns.
 */

import { describe, expect, test } from 'vitest';
import { loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import type { GameAction } from '@meccg/shared';
import { playGame } from '../../../runner.js';
import { loadDeck } from '../../../decks.js';
import { createHeuristicAgent } from '../../../agents/heuristic-agent.js';
import type { Agent, AgentContext } from '../../../types.js';
import { KNOWN_FIELDS, namedCard, namedCharacter } from './action-fields.js';

/**
 * Action types whose *whole point* is a card or character, so an action of that
 * type with neither is a spelling this list has not learned yet.
 *
 * Deliberately narrow. `pass` names nothing and should not; the interesting
 * case is an action that is *about* a card and hides which one behind a field
 * name nobody guessed.
 */
const MUST_NAME_SOMETHING = new Set([
  'play-hazard',
  'place-on-guard',
  'play-short-event',
  'discard-card',
  'discard-character',
  'draft-pick',
  'add-character-to-deck',
  'fetch-from-pile',
  'fetch-from-sideboard',
  'fetch-hazard-from-sideboard',
  'activate-granted-action',
  'move-to-influence',
  'assign-strike',
  'transfer-item',
]);

/** Every action of interest offered across a few real games. */
function offeredActions(seeds: readonly number[]): GameAction[] {
  setEngineConsoleLog(false);
  const decks: [ReturnType<typeof loadDeck>, ReturnType<typeof loadDeck>] =
    [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')];
  const seen: GameAction[] = [];
  const spy = (inner: Agent): Agent => ({
    name: inner.name,
    chooseAction(context: AgentContext) {
      for (const action of context.legalActions) {
        if (MUST_NAME_SOMETHING.has(action.type)) seen.push(action);
      }
      return inner.chooseAction(context);
    },
  });
  for (const seed of seeds) {
    playGame({
      agents: [spy(createHeuristicAgent()), spy(createHeuristicAgent())],
      decks,
      seed,
      maxDecisions: 4000,
    });
  }
  return seen;
}

/** A whole game does not fit vitest's default when files run in parallel. */
const GAME_TIMEOUT = 60_000;

describe('the spellings an action uses', () => {
  test('every action that is about a card or character names one we can find', () => {
    const actions = offeredActions([11, 12]);
    expect(actions.length).toBeGreaterThan(100);

    const unfound = new Map<string, string>();
    for (const action of actions) {
      if (namedCard(action) ?? namedCharacter(action)) continue;
      // Record the shape, not the instance: what a reader needs is the field
      // name to add, and there is no point repeating it once per occurrence.
      unfound.set(action.type, JSON.stringify(action));
    }
    expect([...unfound.values()]).toEqual([]);
  }, GAME_TIMEOUT);

  test('the two lists are disjoint, so a lookup cannot mean two things', () => {
    const overlap = KNOWN_FIELDS.card.filter(field =>
      (KNOWN_FIELDS.character as readonly string[]).includes(field));
    expect(overlap).toEqual([]);
  });

  test('an action naming nothing yields nothing, rather than an empty string', () => {
    const pass = { type: 'pass', player: 'p1' } as unknown as GameAction;
    expect(namedCard(pass)).toBeUndefined();
    expect(namedCharacter(pass)).toBeUndefined();
  });
});
