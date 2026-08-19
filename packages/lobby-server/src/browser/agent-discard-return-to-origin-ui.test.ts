/**
 * @module agent-discard-return-to-origin-ui.test
 *
 * Regression test for bug report e4fb825afb77e64a (game mt084iio-x2dhxa, seq
 * 503): the player could not use Baduila's (dm-2) agent power to discard her
 * at a company's new site and force the company back to its site of origin.
 *
 * The engine correctly offered `agent-discard-return-to-origin` as a viable
 * action, but `getAgentOtherActions` in company-actions.ts — which filters
 * the raw legal-action list down to the "other agent action" buttons shown in
 * the agent's tooltip menu — whitelisted only agent-move-back/return-home/
 * heal/untap/turn-face-down/key-creatures. The discard-return-to-origin type
 * was missing from that whitelist, so the action never reached the tooltip
 * and was unclickable even though it was legal.
 */

import { test, expect } from 'vitest';
import type {
  PlayerView, EvaluatedAction, CompanyId, PlayerId, AgentDiscardReturnToOriginAction,
} from '@meccg/shared';
import { getAgentOtherActions } from './company-actions.js';

const P2 = 'p2' as PlayerId;
const AGENT_ID = 'agent-0-0' as CompanyId;

test('Baduila\'s agent-discard-return-to-origin action reaches the agent tooltip', () => {
  const discardAction: AgentDiscardReturnToOriginAction = {
    type: 'agent-discard-return-to-origin',
    player: P2,
    agentId: AGENT_ID,
  };
  const legalActions: EvaluatedAction[] = [
    { action: discardAction, viable: true },
  ];
  const view = { legalActions } as unknown as PlayerView;

  const otherActions = getAgentOtherActions(view);
  expect(otherActions.get(AGENT_ID as string)).toEqual([discardAction]);
});
