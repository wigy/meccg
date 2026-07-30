/**
 * @module tutorial-controller
 *
 * Server-side driver of the guided tutorial (specs/2026-07-30-tutorial-plan.md).
 *
 * Owns the cursor over the shared {@link TUTORIAL_BEATS} script. The
 * {@link GameSession} consults it to:
 * - gate the human's legal actions to the current beat (everything else is
 *   demoted to non-viable with a tutorial reason),
 * - play the Mentor's scripted beats server-side (the Mentor never has a
 *   WebSocket connection),
 * - force the scripted dice via {@link GameState.cheatRollTotal},
 * - attach {@link TutorialProgress} to the human's projected view.
 *
 * The cursor advances only on actions that match the current beat, so a
 * chain-priority pass (always allowed) never desynchronizes the script.
 */

import type {
  EvaluatedAction, GameAction, GameState, PlayerId, TutorialProgress,
} from '@meccg/shared';
import {
  TUTORIAL_BEATS, TUTORIAL_STEPS, TUTORIAL_STEP_BY_ID,
  actionMatches, findMatchingAction, gateHumanActions,
} from '@meccg/shared';
import type { TutorialBeat } from '@meccg/shared';

export class TutorialController {
  private cursor = 0;

  constructor(
    readonly humanId: PlayerId,
    readonly mentorId: PlayerId,
  ) {}

  /** The beat awaiting performance, or null when the script is finished. */
  currentBeat(): TutorialBeat | null {
    return this.cursor < TUTORIAL_BEATS.length ? TUTORIAL_BEATS[this.cursor] : null;
  }

  /** True once every beat has been performed. */
  isDone(): boolean {
    return this.cursor >= TUTORIAL_BEATS.length;
  }

  /**
   * Force the current beat's scripted dice: returns a state whose
   * `cheatRollTotal` is armed when the beat prescribes a roll. Rolls in the
   * tutorial happen only where the script forces them, so arming as soon as
   * the beat becomes current is safe. Tutorial rolls are scripted, not
   * cheating — the `cheated` stigma flag is not raised by this.
   */
  armCheat(state: GameState): GameState {
    const beat = this.currentBeat();
    if (beat?.cheatRoll === undefined) return state;
    if (state.cheatRollTotal === beat.cheatRoll) return state;
    return { ...state, cheatRollTotal: beat.cheatRoll };
  }

  /**
   * Record an applied action; advances the cursor when it matches the
   * current beat (evaluated against the pre-action state, where the beat's
   * card references were legal).
   */
  noteApplied(stateBefore: GameState, action: GameAction, actorId: PlayerId): void {
    const beat = this.currentBeat();
    if (!beat) return;
    const beatActor = beat.actor === 'human' ? this.humanId : this.mentorId;
    if (actorId !== beatActor) return;
    if (actionMatches(stateBefore, action, beat.match)) this.cursor++;
  }

  /**
   * The Mentor's next scripted action, when it is the Mentor's turn to act:
   * either the current beat (if it belongs to the Mentor) or a chain-priority
   * pass (the Mentor always yields priority — chains are narrated, not
   * scripted beat by beat). Null when the Mentor has nothing to do.
   */
  mentorAction(state: GameState): GameAction | null {
    const beat = this.currentBeat();
    if (beat && beat.actor === 'mentor') {
      const action = findMatchingAction(state, this.mentorId, beat.match);
      if (action) return action;
    }
    // Yield chain priority whenever the engine is waiting on the Mentor.
    if (state.chain !== null) {
      return findMatchingAction(state, this.mentorId, { type: 'pass-chain-priority' });
    }
    return null;
  }

  /** Gate the human's legal actions to the current beat. */
  gate(state: GameState, actions: readonly EvaluatedAction[]): EvaluatedAction[] {
    return gateHumanActions(state, actions, this.currentBeat());
  }

  /** Progress snapshot for the human's view (drives the browser panel). */
  progress(): TutorialProgress {
    const done = this.isDone();
    const stepId = done
      ? TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].id
      : TUTORIAL_BEATS[this.cursor].stepId;
    const info = TUTORIAL_STEP_BY_ID.get(stepId)!;
    const stepIndex = TUTORIAL_STEPS.findIndex(step => step.id === stepId);
    const beat = this.currentBeat();
    return {
      stepId,
      title: info.title,
      body: info.body,
      stepIndex,
      stepCount: TUTORIAL_STEPS.length,
      yourTurn: beat !== null && beat.actor === 'human',
      done,
    };
  }
}
