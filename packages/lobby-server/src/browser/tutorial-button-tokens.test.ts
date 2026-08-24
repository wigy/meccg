/**
 * @module tutorial-button-tokens.test
 *
 * Guards the tutorial's `[[Button]]` tokens against label drift: every step
 * body that tells the player to press a named button must name the text the
 * bottom-bar button ACTUALLY shows at that point of the scripted game.
 *
 * The whole six-turn script is replayed headlessly (like the shared
 * tutorial-script test), but with the human seat's legal actions gated via
 * {@link gateHumanActions} — the same gate the game-server applies — and the
 * pass-button selection logic of `render-instructions.ts` mimicked at every
 * human decision point. The labels observed during each step are then
 * required to cover that step's `[[...]]` tokens, so a relabelled button
 * (e.g. "Pass" → "Pass Hazards") fails here instead of confusing new
 * players mid-tutorial.
 */
import './test-dom-bootstrap.js'; // must precede the pass-button-label import (render-player-names.js reads window.__meccg at load time)
import { describe, test, expect } from 'vitest';
import {
  createGame, loadCardPool, reduce, computeLegalActions, setEngineConsoleLog, Phase,
  findMatchingAction, gateHumanActions,
  TUTORIAL_HERO_DECK, TUTORIAL_MENTOR_DECK, TUTORIAL_BEATS, TUTORIAL_STEPS,
  LATER_CHAPTER_BEATS, LATER_CHAPTER_STEPS,
} from '@meccg/shared';
import type {
  EvaluatedAction, GameConfig, GameState, PlayerId, PlayerView, TutorialBeat,
} from '@meccg/shared';
import { passButtonLabel } from './pass-button-label.js';

const HUMAN = 'p1' as PlayerId;
const MENTOR = 'p2' as PlayerId;

/** Action types renderPassButton binds to the bottom-bar button (its whitelist). */
const PASS_LIKE = new Set([
  'pass', 'draft-stop', 'shuffle-play-deck', 'draw-cards', 'roll-initiative',
  'faction-influence-roll', 'under-deeps-roll', 'pass-chain-priority',
  'deck-exhaust', 'finished', 'untap', 'opponent-influence-defend',
  'resolve-dice-check', 'flattery-attempt', 'seized-by-terror-roll',
  'gold-ring-test-roll',
]);

/**
 * The button labels the human would see, mimicking `renderPassButton`:
 * the primary pass-like button, a secondary plain-Pass button when the
 * primary is a non-pass action, and the tutorial's special Enter/Skip pair
 * when the gate demoted Skip in the site phase's enter-or-skip step.
 */
const visibleButtonLabels = (state: GameState, beat: TutorialBeat): string[] => {
  const gated: EvaluatedAction[] = gateHumanActions(state, computeLegalActions(state, HUMAN), beat);
  const humanPlayer = state.players.find(p => p.id === HUMAN)!;
  const mentorPlayer = state.players.find(p => p.id === MENTOR)!;
  const view = {
    phaseState: state.phaseState,
    legalActions: gated,
    activePlayer: state.activePlayer,
    self: { id: HUMAN, companies: humanPlayer.companies },
    opponent: { id: MENTOR, companies: mentorPlayer.companies },
    activeConstraints: state.activeConstraints,
  } as unknown as PlayerView;
  const corruptionCheckCount = gated.filter(ea => ea.viable === true && ea.action.type === 'corruption-check').length;
  const passEval = gated.find(ea => ea.viable === true
    && (PASS_LIKE.has(ea.action.type) || (ea.action.type === 'corruption-check' && corruptionCheckCount === 1)));
  if (!passEval) {
    const ps = state.phaseState as { phase?: string; step?: string };
    if (ps.phase === Phase.Site && ps.step === 'enter-or-skip'
      && gated.some(ea => ea.viable === true && ea.action.type === 'enter-site')
      && gated.some(ea => ea.viable !== true && ea.action.type === 'pass')) {
      return ['Enter'];
    }
    return [];
  }
  const labels = [passButtonLabel(passEval.action, view)];
  if (passEval.action.type !== 'pass') {
    const secondaryPass = gated.find(ea => ea.viable === true && ea.action.type === 'pass');
    if (secondaryPass) labels.push(passButtonLabel(secondaryPass.action, view));
  }
  return labels;
};

describe('tutorial [[Button]] tokens', () => {
  test('every token names a label the bottom-bar button actually shows during its step', () => {
    // The 200+ beat replay would emit megabytes of engine trace.
    setEngineConsoleLog(false);
    const labelsByStep = new Map<string, Set<string>>();
    const record = (stepId: string, labels: readonly string[]): void => {
      let set = labelsByStep.get(stepId);
      if (!set) { set = new Set(); labelsByStep.set(stepId, set); }
      for (const label of labels) set.add(label);
    };

    try {
      const config: GameConfig = {
        players: [
          { id: HUMAN, name: 'You', ...TUTORIAL_HERO_DECK },
          { id: MENTOR, name: 'Mentor', ...TUTORIAL_MENTOR_DECK },
        ],
        seed: 7,
        orderedDecks: true,
      };
      let state = createGame(config, loadCardPool());

      // Replay the script like the driver does, observing the human's
      // buttons before every human beat and at every chain-priority pass
      // the human makes while a step's chain auto-resolves.
      const resolveChainObserved = (s: GameState, beat: TutorialBeat): GameState => {
        for (let guard = 0; guard < 32 && s.chain !== null; guard++) {
          let advanced = false;
          for (const id of [HUMAN, MENTOR]) {
            const pass = computeLegalActions(s, id)
              .find(ea => ea.viable === true && ea.action.type === 'pass-chain-priority');
            if (pass) {
              if (id === HUMAN) record(beat.stepId, visibleButtonLabels(s, beat));
              const result = reduce(s, pass.action);
              if (result.error) throw new Error(`pass-chain-priority failed: ${result.error}`);
              s = result.state;
              advanced = true;
              break;
            }
          }
          if (!advanced) break;
        }
        return s;
      };

      // Chapter one plus the written-but-unplayed remainder: a label drift
      // in a later chapter must fail here too, before that chapter ships.
      const beats = [...TUTORIAL_BEATS, ...LATER_CHAPTER_BEATS];
      for (let i = 0; i < beats.length; i++) {
        const beat = beats[i];
        const actorId = beat.actor === 'human' ? HUMAN : MENTOR;
        if (beat.actor === 'human') record(beat.stepId, visibleButtonLabels(state, beat));
        let action = findMatchingAction(state, actorId, beat.match);
        if (!action && state.chain !== null) {
          state = resolveChainObserved(state, beat);
          if (beat.actor === 'human') record(beat.stepId, visibleButtonLabels(state, beat));
          action = findMatchingAction(state, actorId, beat.match);
        }
        expect(action, `beat #${i} (step "${beat.stepId}", ${beat.actor}) has no matching legal action`).not.toBeNull();
        if (beat.cheatRoll !== undefined) state = { ...state, cheatRollTotal: beat.cheatRoll };
        const result = reduce(state, action!);
        expect(result.error, `beat #${i} (step "${beat.stepId}") rejected`).toBeUndefined();
        state = result.state;
      }
    } finally {
      setEngineConsoleLog(true);
    }

    for (const step of [...TUTORIAL_STEPS, ...LATER_CHAPTER_STEPS]) {
      const tokens = [...step.body.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
      if (tokens.length === 0) continue;
      const seen = labelsByStep.get(step.id) ?? new Set<string>();
      for (const token of tokens) {
        expect(
          seen.has(token),
          `step "${step.id}" asks the player to press [[${token}]], but the buttons shown during it read: ${[...seen].join(', ') || '(none)'}`,
        ).toBe(true);
      }
    }
  });
});
