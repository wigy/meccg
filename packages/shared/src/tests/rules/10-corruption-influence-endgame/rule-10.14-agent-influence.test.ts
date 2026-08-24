/**
 * @module rule-10.14-agent-influence
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.14: Influencing with an Agent
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Influencing with an Agent - If an effect allows an agent hazard to make an influence attempt (which does not count as an agent action), a hazard player can have that agent make the influence attempt against an opponent's card during an opponent's movement/hazard phase. The agent must be at the company's new site for a target in a moving company OR at the company's current site for a target in a company that isn't moving OR at a site where the faction is playable if influencing a faction. When the influence attempt is declared, the agent is revealed and is treated as the character making the influence attempt in the normal procedure for influence attempts, except that the hazard player cannot reveal an identical card from their hand (and thus cannot influence an item), and the attempt is additionally modified as follows:
 * • If the agent is at one of its home sites, its direct influence is modified by +2.
 * • If the influence attempt is against an ally or character that shares a home site with the agent, the target's mind is treated as zero and the hazard player's roll is modified by an additional +2.
 * • If the influence attempt is against a faction that is playable at one of the agent's home sites, the value required to bring the faction into play is treated as zero and the hazard player's roll is modified by an additional +2.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CompanyId, PendingResolution } from '../../../index.js';
import { Phase, CardStatus, ZERO_EFFECTIVE_STATS } from '../../../index.js';
import type { AgentInPlay, SiteInPlay, CharacterInPlay } from '../../../index.js';

// Golodhros (dm-14): Ringwraith agent, directInfluence=4, home: "Minas Morgul, Cirith Ungol, Barad-dûr"
// Has the agent-tap-influence effect
const GOLODHROS = 'dm-14' as CardDefinitionId;
// Minas Morgul minion site (one of Golodhros's home sites)
const MINAS_MORGUL_SITE = 'le-390' as CardDefinitionId;
// Gorbag: minion character, home: Minas Morgul (shares home with Golodhros)
const GORBAG = 'le-11' as CardDefinitionId;

const GOLODHROS_ID = 'test-1014-gol' as CardInstanceId;
const SITE_INST_ID = 'test-1014-site' as CardInstanceId;
const AGENT_COMP_ID = 'agent-0-0' as CompanyId;

const GOLODHROS_CHAR: CharacterInPlay = {
  instanceId: GOLODHROS_ID,
  definitionId: GOLODHROS,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const MINAS_MORGUL_IN_PLAY: SiteInPlay = {
  instanceId: SITE_INST_ID,
  definitionId: MINAS_MORGUL_SITE,
  status: CardStatus.Untapped,
};

function buildInfluenceState(opts: {
  agentAtHome?: boolean;   // true → agent at Minas Morgul (home); false → at Moria
  target?: CardDefinitionId; // resource char def — defaults to ARAGORN
  destinationSite?: CardDefinitionId; // company's destination
  agentSiteStack?: SiteInPlay[]; // override the agent's site stack (e.g. [] for a hidden at-home agent)
  hazardSiteDeck?: CardDefinitionId[]; // hazard player's site deck contents
} = {}) {
  const atHome = opts.agentAtHome ?? true;
  const targetChar = opts.target ?? ARAGORN;
  const destSite = opts.destinationSite ?? MINAS_MORGUL_SITE;

  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: LORIEN, characters: [targetChar], destinationSite: destSite }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: opts.hazardSiteDeck ?? [] },
    ],
  });

  const agentSiteStack: SiteInPlay[] = opts.agentSiteStack ?? (atHome ? [MINAS_MORGUL_IN_PLAY] : [
    { instanceId: 'test-1014-moria' as CardInstanceId, definitionId: MORIA, status: CardStatus.Untapped },
  ]);

  const agent: AgentInPlay = {
    id: AGENT_COMP_ID,
    character: GOLODHROS_CHAR,
    revealed: false,
    siteStack: agentSiteStack,
    remainingActions: 1,
    inPlayAtTurnStart: true,
    attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
  };

  const destSiteNames: Record<string, string> = { [MINAS_MORGUL_SITE as string]: 'Minas Morgul', [MORIA as string]: 'Moria' };
  const destSiteName = destSiteNames[destSite as string] ?? 'Minas Morgul';

  return {
    ...base,
    players: [
      base.players[0],
      { ...base.players[1], agents: [agent] },
    ] as unknown as typeof base.players,
    phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0, destinationSiteName: destSiteName }),
  };
}

describe('Rule 10.14 — Influencing with an Agent', () => {
  beforeEach(() => resetMint());

  test('Agent hazard may make influence attempt during opponent M/H phase; special bonuses at home site and shared home site', () => {
    // Golodhros at Minas Morgul (his home site), company moving to Minas Morgul, targeting Aragorn
    const state = buildInfluenceState({ agentAtHome: true, target: ARAGORN });

    // Action is offered
    const actions = viableActions(state, PLAYER_2, 'agent-influence-attempt');
    expect(actions.length).toBeGreaterThan(0);

    // Action dispatches without error and enqueues pending defend
    const after = dispatch(state, actions[0].action);
    const pending = after.pendingResolutions.find(
      (r: PendingResolution) => r.kind.type === 'opponent-influence-defend',
    );
    expect(pending).toBeDefined();
  });

  test('action not offered when agent is at a different site than the company destination', () => {
    // Golodhros at Moria, company moving to Minas Morgul — no match
    const state = buildInfluenceState({ agentAtHome: false, destinationSite: MINAS_MORGUL_SITE });
    const actions = viableActions(state, PLAYER_2, 'agent-influence-attempt');
    expect(actions.length).toBe(0);
  });

  test('agent at home site: influencerDI includes +2 home bonus', () => {
    // Golodhros: base DI 4, at home → effective DI 6
    const state = buildInfluenceState({ agentAtHome: true });
    const actions = viableActions(state, PLAYER_2, 'agent-influence-attempt');
    expect(actions.length).toBeGreaterThan(0);

    const after = dispatch(state, actions[0].action);
    const pending = after.pendingResolutions.find(
      (r: PendingResolution) => r.kind.type === 'opponent-influence-defend',
    );
    expect(pending).toBeDefined();
    const attempt = (pending!.kind as { attempt: { influencerDI: number; targetMind: number } }).attempt;
    // Base DI 4 + home bonus 2 = 6
    expect(attempt.influencerDI).toBe(6);
  });

  test('agent not at home: no +2 DI bonus', () => {
    // Build state where agent is at Moria (not home) and company also at Moria
    const state = buildInfluenceState({ agentAtHome: false, destinationSite: MORIA });
    const actions = viableActions(state, PLAYER_2, 'agent-influence-attempt');
    expect(actions.length).toBeGreaterThan(0);

    const after = dispatch(state, actions[0].action);
    const pending = after.pendingResolutions.find(
      (r: PendingResolution) => r.kind.type === 'opponent-influence-defend',
    );
    expect(pending).toBeDefined();
    const attempt = (pending!.kind as { attempt: { influencerDI: number } }).attempt;
    // Base DI 4 only (no home bonus)
    expect(attempt.influencerDI).toBe(4);
  });

  test('target sharing home site with agent: targetMind treated as zero', () => {
    // Gorbag has home site "Minas Morgul", same as Golodhros → mind = 0 (was 6)
    const state = buildInfluenceState({ agentAtHome: true, target: GORBAG });
    const actions = viableActions(state, PLAYER_2, 'agent-influence-attempt');
    expect(actions.length).toBeGreaterThan(0);

    const after = dispatch(state, actions[0].action);
    const pending = after.pendingResolutions.find(
      (r: PendingResolution) => r.kind.type === 'opponent-influence-defend',
    );
    expect(pending).toBeDefined();
    const attempt = (pending!.kind as { attempt: { targetMind: number } }).attempt;
    // Gorbag mind 6 → shared home → treated as 0
    expect(attempt.targetMind).toBe(0);
  });

  test('reveal via influence returns a traveled agent\'s prior stack sites to the site deck (bug regression)', () => {
    // A face-down agent that traveled (Moria under Minas Morgul on its
    // stack) is revealed by the influence attempt. Rule 9.04 reveal
    // bookkeeping — as performed by the attack-reveal paths — keeps only the
    // top (current) site under the agent and returns the prior stack sites
    // to the site deck. The influence path used to flip `revealed` without
    // any of this.
    const moriaInst: SiteInPlay = { instanceId: 'test-1014-moria' as CardInstanceId, definitionId: MORIA, status: CardStatus.Untapped };
    const state = buildInfluenceState({
      agentSiteStack: [moriaInst, MINAS_MORGUL_IN_PLAY],
    });
    const actions = viableActions(state, PLAYER_2, 'agent-influence-attempt');
    expect(actions.length).toBeGreaterThan(0);

    const after = dispatch(state, actions[0].action);
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.revealed).toBe(true);
    // Only the current site remains under the agent…
    expect(agent.siteStack.map(s => s.instanceId)).toEqual([SITE_INST_ID]);
    // …and the prior stack site went back to the site deck.
    expect(after.players[HAZARD_PLAYER].siteDeck.some(s => s.instanceId === moriaInst.instanceId)).toBe(true);
  });

  test('reveal via influence binds a hidden at-home agent\'s home site from the site deck (bug regression)', () => {
    // A hidden agent sitting at home has an EMPTY site stack. On reveal, the
    // home site card is taken from the site deck and placed under the agent
    // (rule 9.04) — mirroring the attack-reveal path. The influence path used
    // to leave the agent revealed with no site at all.
    const state = buildInfluenceState({
      agentSiteStack: [],
      hazardSiteDeck: [MINAS_MORGUL_SITE],
    });
    const homeSiteInst = state.players[HAZARD_PLAYER].siteDeck[0].instanceId;
    const actions = viableActions(state, PLAYER_2, 'agent-influence-attempt');
    expect(actions.length).toBeGreaterThan(0);

    const after = dispatch(state, actions[0].action);
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.revealed).toBe(true);
    // The home site card moved from the site deck to the agent's stack.
    expect(agent.siteStack.map(s => s.instanceId)).toEqual([homeSiteInst]);
    expect(after.players[HAZARD_PLAYER].siteDeck.some(s => s.instanceId === homeSiteInst)).toBe(false);
    expect(agent.discardAtEndOfTurn ?? false).toBe(false);
  });

  test('reveal via influence with no site card available flags the agent for end-of-turn discard (rule 9.04)', () => {
    // Hidden at-home agent whose home site card is NOT in the site deck: the
    // reveal cannot bind a site, so the agent is flagged discardAtEndOfTurn.
    const state = buildInfluenceState({
      agentSiteStack: [],
      hazardSiteDeck: [],
    });
    const actions = viableActions(state, PLAYER_2, 'agent-influence-attempt');
    expect(actions.length).toBeGreaterThan(0);

    const after = dispatch(state, actions[0].action);
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.revealed).toBe(true);
    expect(agent.siteStack).toHaveLength(0);
    expect(agent.discardAtEndOfTurn).toBe(true);
  });

  test('agent remainingActions not consumed by influence (influence is not an agent action)', () => {
    const state = buildInfluenceState({ agentAtHome: true });
    const actions = viableActions(state, PLAYER_2, 'agent-influence-attempt');
    expect(actions.length).toBeGreaterThan(0);

    const after = dispatch(state, actions[0].action);
    // remainingActions must not be decremented (influence is not an agent action)
    expect(after.players[HAZARD_PLAYER].agents[0].remainingActions).toBe(state.players[HAZARD_PLAYER].agents[0].remainingActions);
    // But agent is tapped
    expect(after.players[HAZARD_PLAYER].agents[0].character.status).toBe(CardStatus.Tapped);
    // And revealed
    expect(after.players[HAZARD_PLAYER].agents[0].revealed).toBe(true);
  });
});
