/**
 * @module hazard-agent-target-label.test
 *
 * Regression test for bug f738a109143eeab1 (game mvqo48t4-m6reuj, seq 411):
 * with two agents in play, clicking Never Seen Him (dm-74) in hand opened a
 * menu of one `play-hazard` choice per agent, but every choice was labelled
 * just "Play hazard" — the player could not tell which agent each option
 * targeted. Agent-targeting choices now name the agent.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, CompanyId, PlayerId, PlayHazardAction } from '@meccg/shared';
import { buildAgentNames, describeAction } from '@meccg/shared';
import type { AgentInPlay, CardDefinition, CardDefinitionId, OpponentAgentView } from '@meccg/shared';
import { hazardPlayLabel } from './render-hand.js';

const HAZARD_PLAYER = 'p1' as PlayerId;
const NEVER_SEEN_HIM = 'p1-56' as CardInstanceId;
const ANARIN_AGENT = 'agent-0-0' as CompanyId;
const AGENT_TWO = 'agent-1-1' as CompanyId;

const pool = {
  'dm-74': { id: 'dm-74', name: 'Never Seen Him', cardType: 'hazard-event' },
  'dm-1': { id: 'dm-1', name: 'Anarin', cardType: 'minion-character' },
  'dm-8': { id: 'dm-8', name: 'Eradan', cardType: 'minion-character' },
} as unknown as Readonly<Record<string, CardDefinition>>;

const ownAgent = (id: CompanyId, defId: string): AgentInPlay => ({
  id,
  character: { definitionId: defId as CardDefinitionId },
} as unknown as AgentInPlay);

const playOn = (agentId: CompanyId): PlayHazardAction => ({
  type: 'play-hazard',
  player: HAZARD_PLAYER,
  cardInstanceId: NEVER_SEEN_HIM,
  targetCompanyId: 'company-p2-1' as CompanyId,
  targetAgentId: agentId,
});

const lookup = (id: CardInstanceId) => (id === NEVER_SEEN_HIM ? 'dm-74' as CardDefinitionId : undefined);

describe('agent-targeting hazard choices name the target agent', () => {
  const agentNames = buildAgentNames([ownAgent(ANARIN_AGENT, 'dm-1'), ownAgent(AGENT_TWO, 'dm-8')], [], pool);

  test('hand menu labels each agent choice with the agent name', () => {
    const labels = [ANARIN_AGENT, AGENT_TWO].map(id => hazardPlayLabel(playOn(id), lookup, agentNames, pool));
    expect(labels).toEqual(['Play on agent Anarin', 'Play on agent Eradan']);
  });

  test('action description names the agent instead of the targeted company', () => {
    const desc = describeAction(playOn(AGENT_TWO), pool, lookup, agentNames);
    expect(desc).toContain('Never Seen Him');
    expect(desc).toMatch(/on agent Eradan$/);
    expect(desc).not.toContain('agent-');
  });

  test('a face-down opponent agent stays anonymous', () => {
    const hidden: OpponentAgentView = {
      id: ANARIN_AGENT, characterInstanceId: null, characterDefinitionId: null,
      revealed: false, siteStackSize: 1, actedThisTurn: false,
    };
    expect(buildAgentNames([], [hidden], pool)[ANARIN_AGENT as string]).toBe('a face-down agent');
  });
});
