/**
 * @module tutorial
 *
 * Public surface of the guided tutorial (specs/2026-07-30-tutorial-plan.md):
 * the pre-arranged decks, the scripted curriculum (steps + beats), the
 * action-matching machinery, and the beat driver. Consumed by the
 * game-server TutorialController, the browser tutorial panel, and the
 * headless integration test.
 *
 * Card-id constants in `./ids.js` are internal to the tutorial and are not
 * re-exported (they would collide with the shared `card-ids.ts` namespace).
 */

export type { TutorialDeck } from './decks.js';
export { TUTORIAL_HERO_DECK, TUTORIAL_MENTOR_DECK } from './decks.js';
export type { ActionMatcher, TutorialActor, TutorialBeat, TutorialStepInfo } from './match.js';
export { actionMatches, findMatchingAction, gateHumanActions } from './match.js';
export type { TutorialSeats } from './driver.js';
export { TutorialScriptError, applyBeat, runBeats } from './driver.js';
export {
  TUTORIAL_STEPS, TUTORIAL_BEATS, TUTORIAL_STEP_BY_ID, TUTORIAL_COMPLETION,
  LATER_CHAPTER_STEPS, LATER_CHAPTER_BEATS,
} from './script.js';
