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

  test('tap-an-agent choices name the tapped agent and the prison site', () => {
    // Bug 720f74ba920333aa (game mvsffw67-vylmxe, seq 557): To Get You Away
    // (dm-92) offered one choice per agent / prison site, all labelled
    // "Play hazard".
    const TO_GET_YOU_AWAY = 'p1-64' as CardInstanceId;
    const ELWEN = 'p1-52' as CardInstanceId;
    const ANARIN = 'p1-62' as CardInstanceId;
    const LORIEN = 'p1-133' as CardInstanceId;
    const EDORAS = 'p1-116' as CardInstanceId;
    const defs: Record<string, string> = {
      [TO_GET_YOU_AWAY]: 'dm-92', [ELWEN]: 'dm-8', [ANARIN]: 'dm-1', [LORIEN]: 'tw-408', [EDORAS]: 'tw-394',
    };
    const tapPool = {
      ...pool,
      'dm-92': { id: 'dm-92', name: 'To Get You Away', cardType: 'hazard-event' },
      'dm-8': { id: 'dm-8', name: 'Elwen', cardType: 'minion-character' },
      'tw-408': { id: 'tw-408', name: 'Lórien', cardType: 'hero-site' },
      'tw-394': { id: 'tw-394', name: 'Edoras', cardType: 'hero-site' },
    } as unknown as Readonly<Record<string, CardDefinition>>;
    const tapLookup = (id: CardInstanceId) => defs[id as string] as CardDefinitionId | undefined;
    const tapPlay = (agent: CardInstanceId, prison: CardInstanceId): PlayHazardAction => ({
      type: 'play-hazard',
      player: HAZARD_PLAYER,
      cardInstanceId: TO_GET_YOU_AWAY,
      targetCompanyId: 'company-p2-1' as CompanyId,
      agentInstanceId: agent,
      prisonSiteInstanceId: prison,
    });
    const labels = [tapPlay(ELWEN, LORIEN), tapPlay(ELWEN, EDORAS), tapPlay(ANARIN, LORIEN)]
      .map(a => hazardPlayLabel(a, tapLookup, {}, tapPool));
    expect(labels).toEqual([
      'Play hazard (tap agent Elwen; prisoner held at Lórien)',
      'Play hazard (tap agent Elwen; prisoner held at Edoras)',
      'Play hazard (tap agent Anarin; prisoner held at Lórien)',
    ]);
  });

  test('a face-down opponent agent stays anonymous', () => {
    const hidden: OpponentAgentView = {
      id: ANARIN_AGENT, characterInstanceId: null, characterDefinitionId: null,
      revealed: false, siteStackSize: 1, actedThisTurn: false,
    };
    expect(buildAgentNames([], [hidden], pool)[ANARIN_AGENT as string]).toBe('a face-down agent');
  });
});
