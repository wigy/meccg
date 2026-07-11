/**
 * @module agent-onguard-choice.test
 *
 * Regression test for bug e1a09e9ca89e07e6 (game mrevwcn5-itaw75, seq 101):
 * an agent card in hand dispatched straight into play as an agent with no
 * option to place it face-down on-guard. CoE 2.IV.vii.4 lets the hazard player
 * place any hand card — including an agent — on-guard, and the engine correctly
 * offers both `play-agent-hazard` and `place-on-guard`; the hand renderer's
 * agent branch, however, ignored the on-guard action and clicked straight to
 * `play-agent-hazard`.
 *
 * `agentPlayChoices` now enumerates both plays, so the renderer opens a
 * disambiguation menu whenever an on-guard action is also available.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction, PlayerId } from '@meccg/shared';
import { agentPlayChoices } from './render-hand.js';

const AGENT_INSTANCE = 'p1-62' as CardInstanceId;
const HAZARD_PLAYER = 'p1' as PlayerId;

const agentAction: GameAction = {
  type: 'play-agent-hazard',
  player: HAZARD_PLAYER,
  agentCardInstanceId: AGENT_INSTANCE,
} as GameAction;

const onGuardAction: GameAction = {
  type: 'place-on-guard',
  player: HAZARD_PLAYER,
  cardInstanceId: AGENT_INSTANCE,
} as GameAction;

describe('agent card offers an on-guard placement alongside playing it', () => {
  test('when an on-guard action exists, both plays are offered', () => {
    const choices = agentPlayChoices(agentAction, onGuardAction);
    expect(choices).toHaveLength(2);
    expect(choices.map(c => c.label)).toContain('Play as agent');
    expect(choices.map(c => c.label)).toContain('Place on-guard');
    const onGuardChoice = choices.find(c => c.label === 'Place on-guard');
    expect(onGuardChoice?.action).toBe(onGuardAction);
  });

  test('without an on-guard action, only playing as an agent is offered', () => {
    const choices = agentPlayChoices(agentAction, undefined);
    expect(choices).toHaveLength(1);
    expect(choices[0].label).toBe('Play as agent');
    expect(choices[0].action).toBe(agentAction);
  });
});
