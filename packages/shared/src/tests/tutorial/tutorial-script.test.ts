/**
 * @module tutorial-script.test
 *
 * The guided tutorial's load-bearing test (specs/2026-07-30-tutorial-plan.md):
 * replays the ENTIRE six-turn scripted game — both seats — against the real
 * engine: chapter one ({@link TUTORIAL_BEATS}, what the tutorial plays today)
 * followed by the written-but-unplayed remainder
 * ({@link LATER_CHAPTER_BEATS}). Every beat must match a viable legal action
 * when its turn comes; any engine change that invalidates the curriculum
 * fails here instead of confusing new players mid-tutorial.
 *
 * Also pins where chapter one ends (the player's first End Turn), and lints
 * the tutorial decks (certified cards only) and the script's structural
 * invariants (beats reference known steps, in presentation order).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { pool, resetMint, PLAYER_1, PLAYER_2 } from '../test-helpers.js';
import {
  createGame, Phase, setEngineConsoleLog,
  TUTORIAL_HERO_DECK, TUTORIAL_MENTOR_DECK,
  TUTORIAL_BEATS, TUTORIAL_STEPS, TUTORIAL_STEP_BY_ID,
  LATER_CHAPTER_BEATS, LATER_CHAPTER_STEPS,
  runBeats,
} from '../../index.js';
import type { GameConfig, CardDefinitionId } from '../../index.js';

const ANNALENA = 'tw-119' as CardDefinitionId;
const GLORFINDEL_II = 'tw-161' as CardDefinitionId;
const ELROHIR = 'tw-144' as CardDefinitionId;

describe('guided tutorial script', () => {
  beforeEach(() => resetMint());

  test('every beat of the six-turn scripted game is legal and reaches the end', () => {
    // The 200+ beat replay would emit megabytes of engine trace.
    setEngineConsoleLog(false);
    try {
      const config: GameConfig = {
        players: [
          { id: PLAYER_1, name: 'You', ...TUTORIAL_HERO_DECK },
          { id: PLAYER_2, name: 'Mentor', ...TUTORIAL_MENTOR_DECK },
        ],
        seed: 7,
        orderedDecks: true,
      };
      let state = createGame(config, pool);
      state = runBeats(
        state,
        [...TUTORIAL_BEATS, ...LATER_CHAPTER_BEATS],
        { human: PLAYER_1, mentor: PLAYER_2 },
      );

      // The curriculum ends on the Mentor's third turn (game turn 6).
      expect(state.turnNumber).toBe(6);
      expect(state.phaseState.phase).toBe(Phase.EndOfTurn);

      // The teaching outcomes actually happened:
      const human = state.players[0];
      expect(human.marshallingPoints.item).toBe(2);     // Sword of Gondolin
      expect(human.marshallingPoints.ally).toBe(1);     // Goldberry
      expect(human.marshallingPoints.faction).toBe(3);  // Riders of Rohan
      const mentor = state.players[1];
      expect(mentor.marshallingPoints.kill).toBe(1);    // defeated the Orc-lieutenant
      expect(mentor.marshallingPoints.item).toBe(2);    // Glamdring

      // Elrohir was wounded at the Barrow-downs (bold untapped resolve, snake
      // eyes) and sent home to heal at Rivendell on the turn-2 split.
      const elrohir = Object.values(human.characters).find(c => c.definitionId === ELROHIR);
      expect(elrohir?.status).not.toBe('wounded');

      // Annalena's spell as Glorfindel's follower ended with the turn-2 split,
      // freeing his influence for the Riders of Rohan attempt.
      const annalena = Object.values(human.characters).find(c => c.definitionId === ANNALENA);
      expect(annalena?.controlledBy).toBe('general');

      // Marvels Told discarded Foolish Words: nothing is stuck on Glorfindel.
      const glorfindel = Object.values(human.characters).find(c => c.definitionId === GLORFINDEL_II);
      expect(glorfindel?.hazards).toEqual([]);
    } finally {
      setEngineConsoleLog(true);
    }
  });

  test('chapter one ends with the player\'s first turn played out', () => {
    setEngineConsoleLog(false);
    try {
      const config: GameConfig = {
        players: [
          { id: PLAYER_1, name: 'You', ...TUTORIAL_HERO_DECK },
          { id: PLAYER_2, name: 'Mentor', ...TUTORIAL_MENTOR_DECK },
        ],
        seed: 7,
        orderedDecks: true,
      };
      let state = createGame(config, pool);
      state = runBeats(state, TUTORIAL_BEATS, { human: PLAYER_1, mentor: PLAYER_2 });

      // The player's End Turn handed the game to the Mentor: the tutorial
      // stops here and shows the completion card instead of playing on.
      expect(state.turnNumber).toBe(2);
      expect(state.activePlayer).toBe(PLAYER_2);

      // What chapter one taught actually happened: the Sword of Gondolin
      // scored, and Elrohir lies face down from the Barrow-downs wound (he
      // only heals in the later chapters, back at Rivendell).
      const human = state.players[0];
      expect(human.marshallingPoints.item).toBe(2);
      const elrohir = Object.values(human.characters).find(c => c.definitionId === ELROHIR);
      expect(elrohir?.status).toBe('inverted');
    } finally {
      setEngineConsoleLog(true);
    }
  });

  test('every card in both tutorial decks is certified', () => {
    const decks = [TUTORIAL_HERO_DECK, TUTORIAL_MENTOR_DECK];
    for (const deck of decks) {
      const cards = [...deck.draftPool, ...deck.playDeck, ...deck.siteDeck, ...deck.sideboard];
      for (const defId of cards) {
        const def = pool[defId] as { certified?: unknown; name?: string } | undefined;
        expect(def, `unknown card ${defId}`).toBeDefined();
        expect(def?.certified, `${def?.name ?? defId} (${defId}) must be certified`).toBeTruthy();
      }
    }
  });

  test('beats reference known steps, in presentation order, covering every step', () => {
    const steps = [...TUTORIAL_STEPS, ...LATER_CHAPTER_STEPS];
    const beats = [...TUTORIAL_BEATS, ...LATER_CHAPTER_BEATS];
    // Chapter one's beats must stay inside chapter one's steps, or the
    // tutorial would end mid-instruction.
    const chapterOne = new Set(TUTORIAL_STEPS.map(step => step.id));
    for (const beat of TUTORIAL_BEATS) {
      expect(chapterOne.has(beat.stepId), `chapter-one beat references later step "${beat.stepId}"`).toBe(true);
    }

    const stepIndex = new Map(steps.map((step, i) => [step.id, i]));
    let cursor = 0;
    const seen = new Set<string>();
    for (const beat of beats) {
      const index = stepIndex.get(beat.stepId);
      expect(index, `beat references unknown step "${beat.stepId}"`).toBeDefined();
      expect(index!, `step "${beat.stepId}" out of order`).toBeGreaterThanOrEqual(cursor);
      cursor = index!;
      seen.add(beat.stepId);
    }
    for (const step of steps) {
      expect(seen.has(step.id), `step "${step.id}" has no beats`).toBe(true);
    }
    expect(TUTORIAL_STEP_BY_ID.size).toBe(steps.length);
  });
});
