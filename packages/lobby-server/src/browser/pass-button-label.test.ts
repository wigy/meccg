/**
 * @module pass-button-label.test
 *
 * Coverage for {@link passButtonLabel}, extracted from `render-instructions.ts`
 * per the fix for feature request "change 'pass' button name and place": every
 * generic pass/continue/done branch must name what it is passing on, so two
 * different steps never render the identical bottom-bar button text.
 */
import './test-dom-bootstrap.js'; // must precede the pass-button-label import (render-player-names.js reads window.__meccg at load time)
import { describe, test, expect } from 'vitest';
import { Phase } from '@meccg/shared';
import type { GameAction, PlayerView, EvaluatedAction } from '@meccg/shared';
import { passButtonLabel } from './pass-button-label.js';

const passAction: GameAction = { type: 'pass', player: 'p1' } as unknown as GameAction;

const viewWith = (phaseState: unknown, legalActions: EvaluatedAction[] = []): PlayerView =>
  ({ phaseState, legalActions } as unknown as PlayerView);

/**
 * A play-hazards view with the fields {@link getHazardLimitLabel} (via
 * `pass-button-label.ts`) needs: `self`/`opponent`/`activeConstraints` plus
 * the hazard-limit phaseState fields. `hazardsPlayedThisCompany` defaults to
 * `0` so the remaining count equals `hazardLimitAtReveal` unless overridden.
 */
const playHazardsViewWith = (hazardLimitAtReveal: number, hazardsPlayedThisCompany = 0): PlayerView =>
  ({
    activePlayer: 'p2',
    self: { id: 'p1', companies: [] },
    opponent: { id: 'p2', companies: [{ id: 'company-p2-0' }] },
    activeConstraints: [],
    phaseState: {
      phase: Phase.MovementHazard,
      step: 'play-hazards',
      activeCompanyIndex: 0,
      hazardLimitAtReveal,
      preRevealHazardLimitConstraintIds: [],
      hazardsPlayedThisCompany,
    },
    legalActions: [],
  } as unknown as PlayerView);

describe('passButtonLabel — action-type specific branches (phase-independent)', () => {
  test.each([
    ['draft-stop', 'Done'],
    ['shuffle-play-deck', 'Shuffle'],
    ['draw-cards', 'Draw'],
    ['roll-initiative', 'Roll'],
    ['corruption-check', 'Roll'],
    ['faction-influence-roll', 'Roll'],
    ['under-deeps-roll', 'Roll'],
    ['deck-exhaust', 'Exhaust'],
    ['finished', 'Finished'],
    ['untap', 'Untap'],
    ['opponent-influence-defend', 'Roll Defense'],
    ['resolve-dice-check', 'Roll'],
    ['flattery-attempt', 'Roll'],
    ['seized-by-terror-roll', 'Roll'],
    ['gold-ring-test-roll', 'Roll'],
    ['pass-chain-priority', 'Pass Priority'],
  ])('%s -> %s', (type, expected) => {
    const action = { type, player: 'p1' } as unknown as GameAction;
    const view = viewWith({ phase: Phase.MovementHazard, step: 'play-hazards' });
    expect(passButtonLabel(action, view)).toBe(expected);
  });
});

describe('passButtonLabel — Phase.MovementHazard (generic pass)', () => {
  test('set-hazard-limit -> Continue', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.MovementHazard, step: 'set-hazard-limit' }))).toBe('Continue');
  });

  test('draw-cards -> Pass Draw', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.MovementHazard, step: 'draw-cards' }))).toBe('Pass Draw');
  });

  // The remaining hazard limit is shown by the HL box; the button only
  // names the step being passed.
  test('play-hazards -> Pass Hazards (no remaining-count suffix)', () => {
    expect(passButtonLabel(passAction, playHazardsViewWith(4, 1))).toBe('Pass Hazards');
    expect(passButtonLabel(passAction, playHazardsViewWith(4, 3))).toBe('Pass Hazards');
  });

  test('reset-hand -> Continue', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.MovementHazard, step: 'reset-hand' }))).toBe('Continue');
  });

  test('draw-cards and play-hazards never render the same text (bug report regression)', () => {
    const draw = passButtonLabel(passAction, viewWith({ phase: Phase.MovementHazard, step: 'draw-cards' }));
    const hazards = passButtonLabel(passAction, playHazardsViewWith(4, 1));
    expect(draw).not.toBe(hazards);
  });

  test('unknown step falls back to Continue', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.MovementHazard, step: 'gangways-offer' }))).toBe('Continue');
  });
});

describe('passButtonLabel — Phase.Site (generic pass)', () => {
  test('enter-or-skip -> Skip', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.Site, step: 'enter-or-skip' }))).toBe('Skip');
  });

  test('play-resources -> Pass Resources', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.Site, step: 'play-resources' }))).toBe('Pass Resources');
  });

  test('play-minor-item -> Pass Minor Item', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.Site, step: 'play-minor-item' }))).toBe('Pass Minor Item');
  });

  test('declare-company-attack with a viable attack -> Skip CvCC', () => {
    const attackEval = {
      action: { type: 'declare-company-attack' },
      viable: true,
    } as unknown as EvaluatedAction;
    const view = viewWith({ phase: Phase.Site, step: 'declare-company-attack' }, [attackEval]);
    expect(passButtonLabel(passAction, view)).toBe('Skip CvCC');
  });

  test('declare-company-attack with no viable attack -> Pass Attack', () => {
    const view = viewWith({ phase: Phase.Site, step: 'declare-company-attack' }, []);
    expect(passButtonLabel(passAction, view)).toBe('Pass Attack');
  });

  test('unknown step falls back to Continue', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.Site, step: 'resolve-attacks' }))).toBe('Continue');
  });
});

describe('passButtonLabel — other phases', () => {
  test('Phase.Untap -> End Untap', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.Untap }))).toBe('End Untap');
  });

  test('Phase.Organization -> Long-event', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.Organization }))).toBe('Long-event');
  });

  test('Phase.LongEvent -> Movement/Hazard', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.LongEvent }))).toBe('Movement/Hazard');
  });

  test('Phase.EndOfTurn discard -> Done', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.EndOfTurn, step: 'discard' }))).toBe('Done');
  });

  test('Phase.EndOfTurn signal-end -> End Turn', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.EndOfTurn, step: 'signal-end' }))).toBe('End Turn');
  });

  test('Phase.EndOfTurn reset-hand -> Reconcile Hand', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.EndOfTurn, step: 'reset-hand' }))).toBe('Reconcile Hand');
  });

  test('Phase.FreeCouncil with a pending support window -> Roll', () => {
    const supportEval = {
      action: { type: 'support-corruption-check' },
      viable: true,
    } as unknown as EvaluatedAction;
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.FreeCouncil }, [supportEval]))).toBe('Roll');
  });

  test('Phase.FreeCouncil with no pending support window -> Done', () => {
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.FreeCouncil }, []))).toBe('Done');
  });

  // Bug report (game msc0bo47-pn2a2n, seq 383): Wizard's Test tested Beautiful
  // Gold Ring as a lesser-ring during Organization. The `pass` action that
  // declines the ring-play-offer was mislabeled "Long-event" (the ordinary
  // Organization-phase pass), giving no indication it would skip the ring.
  test('ring-play-offer pending during Organization -> Skip Ring, not Long-event', () => {
    const ringOfferEval = {
      action: { type: 'play-ring-after-test', player: 'p1', ringInstanceId: 'p1-8' },
      viable: true,
    } as unknown as EvaluatedAction;
    expect(passButtonLabel(passAction, viewWith({ phase: Phase.Organization }, [ringOfferEval]))).toBe('Skip Ring');
  });

  test.each([
    ['item-draft', 'Continue'],
    ['character-deck-draft', 'Done'],
    ['starting-site-selection', 'Continue'],
    ['character-placement', 'Done'],
    ['character-draft', 'Pass'],
  ])('setup step %s -> %s', (step, expected) => {
    const view = viewWith({ phase: 'setup', setupStep: { step } });
    expect(passButtonLabel(passAction, view)).toBe(expected);
  });
});
