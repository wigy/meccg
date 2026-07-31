/**
 * @module tutorial/match
 *
 * Pure matching machinery for the guided tutorial
 * (specs/2026-07-30-tutorial-plan.md). A tutorial script is an ordered list
 * of {@link TutorialBeat}s — one prescribed action each. A beat carries an
 * {@link ActionMatcher} that is matched against the engine's real legal
 * actions, so the script can never desynchronize from the rules: if the
 * expected action is not legal, that is a script bug and surfaces loudly.
 *
 * Consumed by three clients with the same semantics:
 * - the headless integration test (drives both seats through every beat),
 * - the game-server TutorialController (gates the human's legal actions and
 *   feeds the Mentor's scripted actions),
 * - the browser tutorial panel (renders the active step's instruction).
 */

import type { GameState } from '../types/state.js';
import type { GameAction } from '../types/actions.js';
import type { TutorialCardIllustration, TutorialConcept, TutorialPointer } from '../types/player-view.js';
import type { EvaluatedAction, PlayerId } from '../index.js';
import type { CardDefinitionId, CardInstanceId } from '../types/common.js';
import { resolveInstanceId } from '../types/state.js';
import { computeLegalActions } from '../engine/legal-actions/index.js';

/** Which seat performs a beat. */
export type TutorialActor = 'human' | 'mentor';

/**
 * Declarative pattern over a {@link GameAction}. A matcher matches an action
 * when the type equals, every `fields` entry equals the action's same-named
 * property, and — when `cardDef` is set — at least one instance-id-carrying
 * property of the action resolves to that card definition (or a `...DefId`
 * property equals it directly).
 */
export interface ActionMatcher {
  readonly type: GameAction['type'];
  /** Card identity the action must reference (via any instance-id or def-id field). */
  readonly cardDef?: CardDefinitionId;
  /**
   * Additional card identities the action must also reference — used to
   * disambiguate actions that name several cards (e.g. an item AND its
   * bearer).
   */
  readonly alsoRefs?: readonly CardDefinitionId[];
  /**
   * Exact-equality constraints on additional action fields. Arrays are
   * compared element-wise (e.g. `regionPath` on `declare-path`).
   */
  readonly fields?: Readonly<Record<string, string | number | boolean | null | readonly (string | number)[]>>;
}

/**
 * One prescribed action of the tutorial script, in strict order. Beats
 * belonging to the same curriculum step share a `stepId`; the step's
 * instruction stays on screen until its last beat has been performed.
 */
export interface TutorialBeat {
  readonly stepId: string;
  readonly actor: TutorialActor;
  readonly match: ActionMatcher;
  /**
   * Force the next 2d6 roll (via {@link GameState.cheatRollTotal}) before
   * this beat's action is applied, so scripted combat/influence outcomes are
   * reproducible.
   */
  readonly cheatRoll?: number;
  /**
   * Mentor beats only: hold this beat until the player explicitly clicks
   * the tutorial panel's Continue button. The server pauses the Mentor pump,
   * the view carries {@link TutorialProgress.awaitingContinue}, and the
   * browser dims the board — so a dramatic narration (e.g. the body check
   * against a struck-down character) can be read at the player's own pace.
   */
  readonly waitForContinue?: boolean;
}

/** Presentation metadata for one curriculum step (a group of beats). */
export interface TutorialStepInfo {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Glossary entries for game terms this step introduces, shown under the instruction. */
  readonly concepts?: readonly TutorialConcept[];
  /** Callout bubbles pointing at UI elements related to this step. */
  readonly pointers?: readonly TutorialPointer[];
  /** Card illustrated beside the instruction, with an optional attribute highlight. */
  readonly card?: TutorialCardIllustration;
  /** Emphasized closing line rendered under the step content (e.g. "TO BE CONTINUED…"). */
  readonly footer?: string;
}

/** True when `action` references `def` through any of its id-bearing fields. */
function referencesCard(state: GameState, action: GameAction, def: CardDefinitionId): boolean {
  for (const [key, value] of Object.entries(action)) {
    if (key === 'type' || key === 'player' || typeof value !== 'string') continue;
    // Def-id fields compare directly; anything else is tried as an instance
    // id (field names vary: characterInstanceId, destinationSite, …) —
    // resolution simply fails for non-id strings.
    if (value === (def as string)) return true;
    if (resolveInstanceId(state, value as CardInstanceId) === def) return true;
  }
  return false;
}

/** True when the matcher matches the given action in the given state. */
export function actionMatches(state: GameState, action: GameAction, matcher: ActionMatcher): boolean {
  if (action.type !== matcher.type) return false;
  if (matcher.fields) {
    for (const [key, expected] of Object.entries(matcher.fields)) {
      const actual = (action as unknown as Record<string, unknown>)[key];
      if (Array.isArray(expected)) {
        if (!Array.isArray(actual) || actual.length !== expected.length) return false;
        if (expected.some((item, i) => actual[i] !== item)) return false;
      } else if (actual !== expected) {
        return false;
      }
    }
  }
  if (matcher.cardDef && !referencesCard(state, action, matcher.cardDef)) return false;
  if (matcher.alsoRefs && matcher.alsoRefs.some(def => !referencesCard(state, action, def))) return false;
  return true;
}

/**
 * Find the (viable) legal action of `playerId` matching `matcher`, or null.
 * When several legal actions match, the first one wins — matchers in the
 * script are written to be unambiguous.
 */
export function findMatchingAction(state: GameState, playerId: PlayerId, matcher: ActionMatcher): GameAction | null {
  const legal = computeLegalActions(state, playerId);
  for (const evaluated of legal) {
    if (evaluated.viable !== true) continue;
    if (actionMatches(state, evaluated.action, matcher)) return evaluated.action;
  }
  return null;
}

/**
 * Gate the human's legal actions to the current beat: everything that does
 * not match the beat's matcher is demoted to non-viable with a tutorial
 * reason (surfaced by the existing not-playable tooltips). Chain-priority
 * passes stay allowed — chains are narrated as part of the surrounding step.
 * When the current beat belongs to the Mentor, every human action except a
 * chain-priority pass is gated.
 */
export function gateHumanActions(
  state: GameState,
  actions: readonly EvaluatedAction[],
  beat: TutorialBeat | null,
): EvaluatedAction[] {
  const reason = 'Tutorial: follow the current instruction';
  return actions.map(evaluated => {
    if (evaluated.viable !== true) return evaluated;
    if (evaluated.action.type === 'pass-chain-priority') return evaluated;
    const allowed = beat !== null
      && beat.actor === 'human'
      && actionMatches(state, evaluated.action, beat.match);
    return allowed ? evaluated : { ...evaluated, viable: false, reason };
  });
}
