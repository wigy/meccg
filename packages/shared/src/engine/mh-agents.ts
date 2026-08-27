/**
 * @module mh-agents
 *
 * Agent actions during the movement/hazard phase: the per-action handlers
 * (move, move-back, return-home, heal, untap, turn-face-down, key-creatures,
 * influence-attempt, tap-attack, tap-agent-at-site) plus their private helpers
 * (resolveAgent, chargeAgentAction(Tail), updateAgent, countExtraAgentActions,
 * computeAgentAttackProwess, revealAgentForAttack). Extracted from
 * `reducer-movement-hazard.ts` as the provably-closed transitive closure of the
 * agent handlers — it calls no other reducer-movement-hazard function.
 * `reducer-movement-hazard` imports the handlers it dispatches one-way from
 * here; `legal-actions/movement-hazard` imports `countExtraAgentActions` here.
 *
 * Pure relocation: the logic is unchanged from its previous home.
 */

import type { GameState, MovementHazardPhaseState, Company, GameAction, CombatState, CharacterCard, AgentInPlay, SiteInPlay, CardDefinition, PlayHazardAction, GameEffect } from '../index.js';
import type { TapAgentEffect, AgentTapInfluenceEffect, AgentTapAttackEffect, AgentTapReturnCharacterEffect, AgentTapFactionInfluenceEffect, AgentTapMultiInfluenceEffect, AgentInfluenceBoostEffect } from '../types/effects.js';
import type { CardInstanceId, CompanyId, Race } from '../types/common.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { getPlayerIndex } from '../state-utils.js';
import { isCharacterCard, isAllyCard, isFactionCard, isSiteCard } from '../types/cards.js';
import { Alignment, CardStatus } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import type { ReducerResult } from './reducer-utils.js';
import { controlCostOf } from './control-cost.js';
import { makeCombatState, characterEntries, defById, findById, getCardEffects, removeById, updatePlayer, wrongActionType, roll2d6, diceRollEffect, effectiveGeneralInfluence, parseHomesiteNames, influenceModificationsNullified, agentCurrentSiteName, agentMatchesFilter } from './reducer-utils.js';
import { enqueueResolution, addConstraint } from './pending.js';
import { allyEffectiveMind } from './ally-stats.js';
import { availableDI, normalUnusedDI } from './legal-actions/organization.js';
import { crossAlignmentInfluencePenalty } from '../alignment-rules.js';
import { formatSignedNumber } from '../format-helpers.js';

/**
 * Count the total extra agent actions in play, e.g. Great Need or Purpose
 * (dm-62). Three sources contribute:
 *  - Untargeted cardsInPlay effects (no `attachedToAgentId`), which grant the
 *    bonus to every agent — summed across both players.
 *  - A revealed agent's own `whileRevealed` effect (My Precious dm-29),
 *    scoped to that agent alone.
 *  - A permanent event attached to one specific agent via
 *    `CardInPlay.attachedToAgentId` (Never Seen Him dm-74), scoped to that
 *    agent alone.
 *
 * When `agentId` is given, the result is the total applicable to that one
 * agent (untargeted + its own self/attached bonuses). When omitted (legacy
 * callers), self/attached bonuses are summed across every agent — the
 * pre-existing behavior for callers that don't yet know which agent they
 * care about. Exported so legal-actions can reuse the same logic.
 */
export function countExtraAgentActions(state: GameState, agentId?: CompanyId): number {
  const sumEffects = (defId: CardDefinition['id'], requireGlobal: boolean, revealed: boolean): number =>
    getCardEffects(defById(state, defId)).reduce(
      (n, e) => {
        if (e.type !== 'extra-agent-actions') return n;
        const eff = e as { value?: number; whileRevealed?: boolean };
        // A card in cardsInPlay contributes only if it is NOT a face-up-agent
        // effect; an agent contributes its whileRevealed effect only while revealed.
        if (requireGlobal && eff.whileRevealed) return n;
        if (!requireGlobal && (!eff.whileRevealed || !revealed)) return n;
        return n + (eff.value ?? 0);
      }, 0,
    );
  return state.players.reduce((sum, p) =>
    sum
      + p.cardsInPlay
        .filter(card => card.attachedToAgentId === undefined || card.attachedToAgentId === agentId)
        .reduce((s, card) => s + sumEffects(card.definitionId, true, false), 0)
      + p.agents
        .filter(a => agentId === undefined || a.id === agentId)
        .reduce((s, a) => s + sumEffects(a.character.definitionId, false, a.revealed), 0),
  0);
}

/**
 * Shared helper: charge a hazard slot for an agent action (unless it is an
 * extra action granted by an effect like Great Need or Purpose, which is free).
 *
 * Rule: only the agent's BASE action costs a hazard slot. Extra actions
 * (remainingActions <= extraAgentActions before decrement) are free.
 */
function chargeAgentAction(mhState: MovementHazardPhaseState, isExtraAction: boolean): MovementHazardPhaseState {
  return {
    ...mhState,
    hazardsPlayedThisCompany: isExtraAction ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1,
    resourcePlayerPassed: false,
  };
}

/**
 * Shared helper: update one agent in the hazard player's agents array.
 */
function updateAgent(
  state: GameState,
  hazardIndex: number,
  agentIdx: number,
  updater: (a: AgentInPlay) => AgentInPlay,
): GameState {
  return updatePlayer(state, hazardIndex, p => ({
    ...p,
    agents: p.agents.map((a, i) => i === agentIdx ? updater(a) : a),
  }));
}

/**
 * Handle `agent-move`: move agent to an adjacent site from its location deck.
 *
 * Pushes destination site onto `siteStack`, taps agent, increments hazard count.
 */
/**
 * Locate the acting agent for an agent action. Returns the hazard player's
 * index, the player, the agent's index, and the agent — or an error if no
 * agent matches. Shared opening for every `agent-*` handler.
 */
function resolveAgent(
  state: GameState,
  playerId: import('../types/common.js').PlayerId,
  agentId: string,
): { hazardIndex: number; hazardPlayer: GameState['players'][number]; agentIdx: number; agent: AgentInPlay } | { error: string } {
  const hazardIndex = getPlayerIndex(state, playerId);
  const hazardPlayer = state.players[hazardIndex];
  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === agentId);
  if (agentIdx === -1) return { error: 'Agent not found' };
  return { hazardIndex, hazardPlayer, agentIdx, agent: hazardPlayer.agents[agentIdx] };
}

/**
 * Shared tail for the simple status-change agent actions: apply `mutate` to
 * the agent, decrement its remaining actions, and charge the agent action
 * (extra-action aware). The action is "extra" when the agent's remaining
 * actions are already within the granted-extra count.
 */
function chargeAgentActionTail(
  state: GameState,
  mhState: MovementHazardPhaseState,
  agentRef: { hazardIndex: number; agentIdx: number; agent: AgentInPlay },
  mutate: (a: AgentInPlay) => AgentInPlay,
): ReducerResult {
  const isExtra = agentRef.agent.remainingActions <= countExtraAgentActions(state, agentRef.agent.id);
  const newState = updateAgent(state, agentRef.hazardIndex, agentRef.agentIdx,
    a => ({ ...mutate(a), remainingActions: a.remainingActions - 1 }));
  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtra) } };
}

export function handleAgentMove(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-move') return wrongActionType(state, action, 'agent-move');
  const r = resolveAgent(state, action.player, action.agentId);
  if ('error' in r) return { state, error: r.error };
  const { hazardIndex, hazardPlayer, agentIdx, agent: agentBeforeMove } = r;

  const destCard = findById(hazardPlayer.siteDeck, action.destinationSiteInstanceId);
  if (!destCard) return { state, error: 'Destination site not in location deck' };

  const destDef = defById(state, destCard.definitionId);
  const destName = destDef && isSiteCard(destDef) ? destDef.name : String(destCard.definitionId);
  logDetail(`Agent ${action.agentId as string}: moving to "${destName}"`);

  const destEntry: SiteInPlay = {
    instanceId: destCard.instanceId,
    definitionId: destCard.definitionId,
    status: CardStatus.Untapped,
  };

  const isExtraMove = agentBeforeMove.remainingActions <= countExtraAgentActions(state, agentBeforeMove.id);

  const newState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    agents: p.agents.map((a, i) => i !== agentIdx ? a : {
      ...a,
      character: { ...a.character, status: CardStatus.Tapped },
      siteStack: [...a.siteStack, destEntry],
      remainingActions: a.remainingActions - 1,
    }),
    siteDeck: removeById(p.siteDeck, destCard.instanceId),
  }));

  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraMove) } };
}

/**
 * Handle `agent-move-back`: move agent one step back along its site stack.
 *
 * Pops the top site from `siteStack` (returning it to location deck), taps agent.
 */
export function handleAgentMoveBack(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-move-back') return wrongActionType(state, action, 'agent-move-back');
  const r = resolveAgent(state, action.player, action.agentId);
  if ('error' in r) return { state, error: r.error };
  const { hazardIndex, agentIdx, agent } = r;
  if (agent.siteStack.length <= 1) return { state, error: 'Cannot move back: no prior site in stack' };

  const topSite = agent.siteStack[agent.siteStack.length - 1];
  const backDef = state.cardPool[agent.siteStack[agent.siteStack.length - 2].definitionId];
  const backName = backDef && isSiteCard(backDef) ? backDef.name : 'previous site';
  logDetail(`Agent ${action.agentId as string}: moving back to "${backName}", returning ${topSite.instanceId as string} to deck`);

  const isExtraMoveBack = agent.remainingActions <= countExtraAgentActions(state, agent.id);
  const newState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    agents: p.agents.map((a, i) => i !== agentIdx ? a : {
      ...a,
      character: { ...a.character, status: CardStatus.Tapped },
      siteStack: a.siteStack.slice(0, -1),
      remainingActions: a.remainingActions - 1,
    }),
    siteDeck: [...p.siteDeck, topSite],
  }));

  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraMoveBack) } };
}

/**
 * Handle `agent-return-home`: return agent to a home site, clearing the site stack.
 *
 * All current siteStack entries are returned to location deck; chosen home site becomes sole entry.
 * Taps agent.
 */
/**
 * Handle `agent-return-home`: return agent to its home site.
 *
 * All siteStack entries are returned to the location deck. Does NOT tap
 * the agent (rule 4.1). For face-down agents, siteStack becomes empty.
 * For face-up agents, the chosen home site card is placed with the agent.
 */
export function handleAgentReturnHome(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-return-home') return wrongActionType(state, action, 'agent-return-home');
  const r = resolveAgent(state, action.player, action.agentId);
  if ('error' in r) return { state, error: r.error };
  const { hazardIndex, hazardPlayer, agentIdx, agent } = r;

  if (agent.revealed) {
    // Face-up: home site card must be placed with agent
    const homeCard = hazardPlayer.siteDeck.find(s => s.instanceId === action.homeSiteInstanceId);
    if (!homeCard) return { state, error: 'Home site not in location deck (required for face-up agent)' };

    const homeDef = defById(state, homeCard.definitionId);
    const homeName = homeDef && isSiteCard(homeDef) ? homeDef.name : String(homeCard.definitionId);
    logDetail(`Agent ${action.agentId as string}: returning home (face-up) to "${homeName}", returning ${agent.siteStack.length} site(s) to deck`);

    const homeSiteEntry: SiteInPlay = {
      instanceId: homeCard.instanceId,
      definitionId: homeCard.definitionId,
      status: CardStatus.Untapped,
    };

    const isExtraReturnFaceUp = agent.remainingActions <= countExtraAgentActions(state, agent.id);
    const newState = updatePlayer(state, hazardIndex, p => ({
      ...p,
      agents: p.agents.map((a, i) => i !== agentIdx ? a : {
        ...a,
        siteStack: [homeSiteEntry],
        remainingActions: a.remainingActions - 1,
        // does NOT tap (rule 4.1)
      }),
      siteDeck: [...removeById(p.siteDeck, homeCard.instanceId), ...agent.siteStack],
    }));
    return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraReturnFaceUp) } };
  }

  // Face-down: siteStack becomes empty, no site card needed
  logDetail(`Agent ${action.agentId as string}: returning home (face-down), returning ${agent.siteStack.length} site(s) to deck`);

  const isExtraReturnFaceDown = agent.remainingActions <= countExtraAgentActions(state, agent.id);
  const newState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    agents: p.agents.map((a, i) => i !== agentIdx ? a : {
      ...a,
      siteStack: [],
      remainingActions: a.remainingActions - 1,
      // does NOT tap (rule 4.1)
    }),
    siteDeck: [...p.siteDeck, ...agent.siteStack],
  }));
  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraReturnFaceDown) } };
}

/**
 * Handle `agent-heal`: heal a wounded (Inverted) agent to Tapped.
 */
export function handleAgentHeal(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-heal') return wrongActionType(state, action, 'agent-heal');
  const r = resolveAgent(state, action.player, action.agentId);
  if ('error' in r) return { state, error: r.error };
  if (r.agent.character.status !== CardStatus.Inverted) return { state, error: 'Agent is not wounded' };
  logDetail(`Agent ${action.agentId as string}: healed (inverted → tapped)`);
  return chargeAgentActionTail(state, mhState, r, a => ({ ...a, character: { ...a.character, status: CardStatus.Tapped } }));
}

/**
 * Handle `agent-untap`: untap a tapped agent.
 */
export function handleAgentUntap(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-untap') return wrongActionType(state, action, 'agent-untap');
  const r = resolveAgent(state, action.player, action.agentId);
  if ('error' in r) return { state, error: r.error };
  if (r.agent.character.status !== CardStatus.Tapped) return { state, error: 'Agent is not tapped' };
  logDetail(`Agent ${action.agentId as string}: untapped`);
  return chargeAgentActionTail(state, mhState, r, a => ({ ...a, character: { ...a.character, status: CardStatus.Untapped } }));
}

/**
 * Handle `agent-turn-face-down`: turn a revealed untapped agent face-down.
 *
 * Does not tap the agent. The current site remains in siteStack (now face-down).
 */
export function handleAgentTurnFaceDown(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-turn-face-down') return wrongActionType(state, action, 'agent-turn-face-down');
  const r = resolveAgent(state, action.player, action.agentId);
  if ('error' in r) return { state, error: r.error };
  if (!r.agent.revealed) return { state, error: 'Agent is not revealed' };
  if (r.agent.character.status !== CardStatus.Untapped) return { state, error: 'Agent must be untapped to turn face-down' };
  logDetail(`Agent ${action.agentId as string}: turned face-down`);
  return chargeAgentActionTail(state, mhState, r, a => ({ ...a, revealed: false }));
}

/**
 * Handle `agent-key-creatures`: tap an untapped agent to key creatures to its site.
 *
 * Taps the agent. (The actual keying logic for creature hazards is handled
 * by the hazard-play legal-action computer which checks `keyedAgents`.)
 */
export function handleAgentKeyCreatures(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-key-creatures') return wrongActionType(state, action, 'agent-key-creatures');
  const r = resolveAgent(state, action.player, action.agentId);
  if ('error' in r) return { state, error: r.error };
  if (r.agent.character.status !== CardStatus.Untapped) return { state, error: 'Agent must be untapped to key creatures' };
  logDetail(`Agent ${action.agentId as string}: tapped to key creatures to its site`);
  return chargeAgentActionTail(state, mhState, r, a => ({ ...a, character: { ...a.character, status: CardStatus.Tapped } }));
}

/**
 * Handle `agent-influence-attempt` (rule 10.14).
 *
 * The agent taps (not as an agent action, not against hazard limit) and is
 * revealed. The influence attempt is resolved using the standard
 * `opponent-influence-defend` pending resolution with rule 10.14 bonuses:
 *   - +2 to influencer DI if agent is at one of its home sites
 *   - Target mind treated as 0, +2 to attacker roll if target shares a home
 *     site with the agent (character/ally) or faction is playable at agent's
 *     home site (faction)
 */
/**
 * Sum an agent's conditional `direct-influence` stat-modifiers whose `when`
 * condition matches the given influence context. Agents live in `player.agents`
 * — outside `recompute-derived` (which only processes `player.characters`) — so
 * an agent's conditional DI bonus is applied here at influence time rather than
 * via effective stats. Used by Lobelia dm-28 ("+3 direct influence against
 * Hobbits and Hobbit factions").
 */
function agentConditionalDirectInfluence(agentDef: CardDefinition, ctx: Record<string, unknown>): number {
  let bonus = 0;
  for (const eff of getCardEffects(agentDef)) {
    if (eff.type !== 'stat-modifier' || eff.stat !== 'direct-influence') continue;
    if (typeof eff.value !== 'number') continue;
    if (eff.when && !matchesCondition(eff.when, ctx)) continue;
    bonus += eff.value;
  }
  return bonus;
}

/**
 * Consume one-shot influence `check-modifier` constraints banked on the given
 * agent (Good Sense Revolts dm-61's "Alternatively, modify an influence
 * attempt by an agent by +4" mode) whose `when` matches the attempt about to
 * resolve. Mirrors the opponent-influence boost fold in
 * `handleOpponentInfluenceAttempt` (reducer-site.ts lines ~4243-4262), scoped
 * to agent-initiated rule-10.14 attempts — native ability or a granted
 * attempt — instead of a normal character's declared attempt.
 */
function foldAgentInfluenceBoost(
  state: GameState,
  agentCharacterInstanceId: CardInstanceId,
  ctx: Record<string, unknown>,
): { boost: number; consumedIds: readonly string[] } {
  let boost = 0;
  const consumedIds: string[] = [];
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'check-modifier') continue;
    if (constraint.kind.check !== 'influence') continue;
    if (constraint.target.kind !== 'character' || constraint.target.characterId !== agentCharacterInstanceId) continue;
    if (!constraint.kind.when || !matchesCondition(constraint.kind.when, ctx)) continue;
    boost += constraint.kind.value;
    consumedIds.push(constraint.id as string);
    logDetail(`Agent influence boost ${formatSignedNumber(constraint.kind.value)} from ${constraint.sourceDefinitionId as string} (consumed)`);
  }
  return { boost, consumedIds };
}

export function handleAgentInfluenceAttempt(
  state: GameState,
  action: GameAction,
  _mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'agent-influence-attempt') return wrongActionType(state, action, 'agent-influence-attempt');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const resourceIndex = 1 - hazardIndex;
  const resourcePlayer = state.players[resourceIndex];

  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  const agent = hazardPlayer.agents[agentIdx];
  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) return { state, error: 'Agent definition not found' };

  // Reveal agent, tap agent (not actedThisTurn — rule 10.14)
  const tapInfluenceEff = (agentDef.effects ?? []).find(
    (e): e is AgentTapInfluenceEffect => e.type === 'agent-tap-influence',
  );
  if (!tapInfluenceEff) return { state, error: 'Agent does not have agent-tap-influence effect' };
  if (agent.character.status !== CardStatus.Untapped) return { state, error: 'Agent must be untapped' };

  logDetail(`Agent influence attempt: ${agentDef.name} (agent-${agent.id as string}) → ${action.targetKind} ${action.targetInstanceId as string}`);

  // Determine home site and whether agent is at home
  const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
  let agentSiteName: string | null = null;
  if (agent.siteStack.length > 0) {
    const topSite = agent.siteStack[agent.siteStack.length - 1];
    const siteDef = defById(state, topSite.definitionId);
    if (siteDef && isSiteCard(siteDef)) agentSiteName = siteDef.name;
  } else {
    agentSiteName = homesiteNames[0] ?? null;
  }
  const isAtHome = agentSiteName !== null && homesiteNames.includes(agentSiteName);

  // Rule 10.14 bonus: +2 DI if at home site
  // Agents are in hazardPlayer.agents, not .characters, so availableDI won't find them.
  // Read DI directly from the card definition.
  let influencerDI = agentDef.directInfluence ?? 0;
  if (isAtHome) {
    influencerDI += 2;
    logDetail(`Agent influence: ${agentDef.name} is at home site ${agentSiteName} → +2 DI (total: ${influencerDI})`);
  }

  // Resolve target mind / value and roll bonus
  let targetMind = 0;
  let controllerDI = 0;
  let rollBonus = 0;

  // Webs of Fear & Treachery (le-150): card-sourced modifications are worth
  // zero. The rule 10.14 home-site bonuses are rules-level, not card text, and
  // the agent's own printed DI modifications are "influence modifications given
  // in a character's card text" — both survive. What le-150 does change here is
  // the defending controller's unused DI, which drops to his *normal* value.
  const nullifyMods = influenceModificationsNullified(state);
  const controllerUnusedDI = (id: CardInstanceId): number => nullifyMods
    ? normalUnusedDI(state, id, resourcePlayer, [], { reason: 'influence-check' })
    : availableDI(state, id, resourcePlayer);

  if (action.targetKind === 'character') {
    const targetChar = resourcePlayer.characters[action.targetInstanceId];
    if (!targetChar) return { state, error: 'Target character not found' };
    const targetDef = defById(state, targetChar.definitionId);
    if (!targetDef || !isCharacterCard(targetDef)) return { state, error: 'Target is not a character' };
    // Conditional DI bonus vs this target's race (e.g. Lobelia +3 vs Hobbits).
    const diBonus = agentConditionalDirectInfluence(agentDef, { reason: 'influence-check', target: { race: targetDef.race } });
    if (diBonus) {
      influencerDI += diBonus;
      logDetail(`Agent influence: ${agentDef.name} +${diBonus} DI vs ${targetDef.race} ${targetDef.name} (total: ${influencerDI})`);
    }
    // A `control-restriction` overrides the influence-to-control threshold.
    targetMind = controlCostOf(state, targetChar, targetDef.mind ?? null) ?? 0;

    // Rule 10.14: shared home site → mind = 0, +2 roll
    const targetHomesites = parseHomesiteNames((targetDef as { homesite?: string }).homesite ?? '');
    const sharesHome = targetHomesites.some(h => homesiteNames.includes(h));
    if (sharesHome) {
      targetMind = 0;
      rollBonus += 2;
      logDetail(`Agent influence: ${targetDef.name} shares home site → mind = 0, +2 roll`);
    }

    if (targetChar.controlledBy !== 'general') {
      controllerDI = controllerUnusedDI(targetChar.controlledBy);
    }
  } else if (action.targetKind === 'ally') {
    let allyFound = false;
    for (const [oppCharId, oppChar] of characterEntries(resourcePlayer)) {
      const allyInst = oppChar.allies.find(a => a.instanceId === action.targetInstanceId);
      if (allyInst) {
        const allyDef = defById(state, allyInst.definitionId);
        // A converted-creature ally (Ready to His Will) carries its mind on the
        // instance override; otherwise the target must be a real ally card.
        if (!allyInst.statOverride && (!allyDef || !isAllyCard(allyDef))) return { state, error: 'Target is not an ally' };
        targetMind = allyEffectiveMind(state, allyInst);
        controllerDI = controllerUnusedDI(oppCharId);

        // Rule 10.14: shared home site → mind = 0, +2 roll
        const allyHomesites = parseHomesiteNames((allyDef as { homesite?: string }).homesite ?? '');
        const sharesHome = allyHomesites.some(h => homesiteNames.includes(h));
        if (sharesHome) {
          targetMind = 0;
          rollBonus += 2;
          logDetail(`Agent influence: ally shares home site → mind = 0, +2 roll`);
        }
        allyFound = true;
        break;
      }
    }
    if (!allyFound) return { state, error: 'Target ally not found' };
  } else if (action.targetKind === 'faction') {
    const targetFaction = findById(resourcePlayer.cardsInPlay, action.targetInstanceId);
    if (!targetFaction) return { state, error: 'Target faction not found' };
    const factionDef = defById(state, targetFaction.definitionId);
    if (!factionDef || !isFactionCard(factionDef)) return { state, error: 'Target is not a faction' };
    // Conditional DI bonus vs this faction's race (e.g. Lobelia +3 vs Hobbit factions).
    const diBonus = agentConditionalDirectInfluence(agentDef, { reason: 'faction-influence-check', faction: { race: (factionDef as { race?: Race }).race } });
    if (diBonus) {
      influencerDI += diBonus;
      logDetail(`Agent influence: ${agentDef.name} +${diBonus} DI vs faction ${factionDef.name} (total: ${influencerDI})`);
    }
    targetMind = factionDef.inPlayInfluenceNumber ?? factionDef.influenceNumber;

    // Rule 10.14: faction playable at agent's home site → value = 0, +2 roll
    if (agentSiteName !== null) {
      const factionAtHome = (factionDef.playableAt ?? []).some(e =>
        'site' in e && homesiteNames.includes(e.site),
      );
      if (factionAtHome) {
        targetMind = 0;
        rollBonus += 2;
        logDetail(`Agent influence: faction playable at agent's home → value = 0, +2 roll`);
      }
    }
  }

  const opponentGI = effectiveGeneralInfluence(state, resourcePlayer.id) - resourcePlayer.generalInfluenceUsed;
  const crossAlignmentPenalty = crossAlignmentInfluencePenalty(hazardPlayer.alignment, resourcePlayer.alignment);

  // A separately-played Good Sense Revolts (dm-61, mode B) may have banked a
  // one-shot influence check-modifier on this agent.
  const { boost: bankedBoost, consumedIds } = foldAgentInfluenceBoost(state, agent.character.instanceId, {
    reason: 'opponent-influence-check',
    target: { kind: action.targetKind },
  });

  // Reveal and tap the agent (not actedThisTurn — this is NOT an agent action).
  // A face-down agent's reveal runs the full rule 9.04 bookkeeping via
  // revealAgentForAttack, exactly like the sibling tap-attack path: a traveled
  // agent keeps only its top stack site (prior sites return to the site deck),
  // an at-home agent binds its home site card from the site deck, and a reveal
  // with no site card available is flagged discardAtEndOfTurn. The influence
  // action carries no home-site choice, so bind the site the offer located the
  // agent at (agentSiteName).
  const isFaceDown = !agent.revealed;
  const homeSiteInstanceId = isFaceDown && agent.siteStack.length === 0 && agentSiteName !== null
    ? hazardPlayer.siteDeck.find(s => {
        const d = defById(state, s.definitionId);
        return d && isSiteCard(d) && d.name === agentSiteName;
      })?.instanceId
    : undefined;
  const revealed = revealAgentForAttack(
    state, hazardIndex, hazardPlayer, agent, agent.character.instanceId,
    isFaceDown, null, homeSiteInstanceId, false,
  );
  if ('error' in revealed) return { state, error: revealed.error };
  let newState = revealed;

  // Roll attacker 2d6 and apply roll bonus
  const { roll, rng, cheatRollTotal } = roll2d6(newState);
  const attackerRoll = roll.die1 + roll.die2 + rollBonus;

  const rollEffect = diceRollEffect(hazardPlayer.name, roll, `Agent influence: ${agentDef.name}${rollBonus > 0 ? ` (+${rollBonus} bonus)` : ''}`);

  logDetail(`Agent influence: ${agentDef.name} rolls ${roll.die1}+${roll.die2}${rollBonus > 0 ? `+${rollBonus}` : ''}=${attackerRoll} vs target ${targetMind} (DI: ${influencerDI}, GI: ${opponentGI})`);

  newState = {
    ...newState, rng, cheatRollTotal,
    activeConstraints: newState.activeConstraints.filter(c => !consumedIds.includes(c.id as string)),
  };

  const stateAfterAttempt = enqueueResolution(newState, {
    source: agent.character.instanceId,
    actor: resourcePlayer.id,
    scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
    kind: {
      type: 'opponent-influence-defend',
      attempt: {
        influencerId: agent.character.instanceId,
        targetInstanceId: action.targetInstanceId,
        targetKind: action.targetKind,
        targetPlayer: action.targetPlayer,
        attackerRoll,
        influencerDI,
        opponentGI,
        targetMind,
        controllerDI,
        crossAlignmentPenalty,
        boostModifier: bankedBoost,
        revealedCard: null,
      },
    },
  });

  return { state: stateAfterAttempt, effects: [rollEffect] };
}

/**
 * Handle `agent-tap-attack` — an agent taps itself during the M/H phase to
 * attack the active company (e.g. The Grimburgoth dm-15, rule 10.14 analog).
 *
 * - Does NOT count as an agent action (remainingActions unchanged).
 * - Does NOT count against the hazard limit.
 * - Prowess computed before reveal (rule 9.06).
 * - Agent is revealed if face-down, then tapped.
 */
/**
 * Pre-reveal agent attack stats (rule 9.06): prowess from face-down/at-home/
 * wounded modifiers + the effect's bonus, plus the active company and its
 * destination site (for the reveal). Shared by the tap-attack and
 * tap-agent-at-site paths.
 */
function computeAgentAttackProwess(
  state: GameState,
  mhState: MovementHazardPhaseState,
  agent: AgentInPlay,
  agentDef: CharacterCard,
  prowessBonus: number,
): { prowess: number; body: number; isFaceDown: boolean; isAtHome: boolean; destSiteInst: SiteInPlay | null; company: Company } {
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[mhState.activeCompanyIndex];
  const destSiteInst = company?.destinationSite ?? company?.currentSite ?? null;
  let destSiteName: string | undefined;
  if (destSiteInst) {
    const destSiteDef = defById(state, destSiteInst.definitionId);
    if (destSiteDef && isSiteCard(destSiteDef)) destSiteName = destSiteDef.name;
  }
  const isFaceDown = !agent.revealed;
  const isWounded = agent.character.status === CardStatus.Inverted;
  const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
  const isAtHome = destSiteName !== undefined && homesiteNames.includes(destSiteName);

  let prowess = agentDef.prowess;
  let body = agentDef.body;
  if (isWounded) prowess -= 2;
  if (isFaceDown && !isAtHome) prowess += 2;
  // Rule 3.iv.6.1: at its home site the agent also gets +1 body (both
  // face-down +5 and face-up +2 prowess tiers carry it) — mirrors the
  // site-phase declare-agent-attack path in reducer-site.ts.
  if (isFaceDown && isAtHome) { prowess += 5; body += 1; }
  if (!isFaceDown && isAtHome) { prowess += 2; body += 1; }
  prowess += prowessBonus;
  return { prowess, body, isFaceDown, isAtHome, destSiteInst, company };
}

/**
 * Reveal a face-down agent for an attack (returning prior stack sites to the
 * deck, binding the chosen home site or flagging EOT-discard when none), or
 * just tap an already-revealed agent. `markActed` additionally zeroes the
 * agent's `remainingActions` (the tap-agent-at-site path consumes the action;
 * the tap-attack path does not). Returns the new state or an error.
 */
function revealAgentForAttack(
  state: GameState,
  hazardIndex: number,
  hazardPlayer: GameState['players'][number],
  agent: AgentInPlay,
  agentInstanceId: CardInstanceId,
  isFaceDown: boolean,
  destSiteInst: SiteInPlay | null,
  homeSiteInstanceId: CardInstanceId | undefined,
  markActed: boolean,
): GameState | { error: string } {
  const acted = markActed ? { remainingActions: 0 } : {};
  if (!isFaceDown) {
    return updatePlayer(state, hazardIndex, p => ({
      ...p,
      agents: p.agents.map(a => a.character.instanceId === agentInstanceId
        ? { ...a, character: { ...a.character, status: CardStatus.Tapped as const }, ...acted }
        : a,
      ),
    }));
  }
  const currentSiteEntry = agent.siteStack.length > 0
    ? agent.siteStack[agent.siteStack.length - 1]
    : destSiteInst;
  const emptyStack = agent.siteStack.length === 0;
  // Traveled agent (non-empty stack): its current site card already sits on
  // top of its own stack — no deck card is needed, and the rule 4.2.2 / 9.04
  // reveal penalty ("discard at end of turn if revealed without a site") is
  // scoped to reveals AT A HOME SITE, so it never applies here. The earlier
  // code conflated the two cases: with a homeSiteInstanceId it deleted the
  // home-site deck card into nothing; without one it wrongly doomed the agent.
  if (!emptyStack) {
    const priorStackSites = agent.siteStack.slice(0, -1);
    const newSiteStack = [{ instanceId: currentSiteEntry!.instanceId, definitionId: currentSiteEntry!.definitionId, status: CardStatus.Untapped as const }];
    return updatePlayer(state, hazardIndex, p => ({
      ...p,
      agents: p.agents.map(a => a.character.instanceId === agentInstanceId
        ? { ...a, revealed: true, character: { ...a.character, status: CardStatus.Tapped as const }, siteStack: newSiteStack, ...acted }
        : a,
      ),
      siteDeck: [...p.siteDeck, ...priorStackSites],
    }));
  }
  if (homeSiteInstanceId) {
    const homeSiteCard = findById(hazardPlayer.siteDeck, homeSiteInstanceId);
    if (!homeSiteCard) {
      return { error: `Home site ${homeSiteInstanceId as string} not in hazard player's site deck` };
    }
    const priorStackSites = agent.siteStack.slice(0, -1);
    const newSiteStack = emptyStack
      ? [{ instanceId: homeSiteCard.instanceId, definitionId: homeSiteCard.definitionId, status: CardStatus.Untapped as const }]
      : [{ instanceId: currentSiteEntry!.instanceId, definitionId: currentSiteEntry!.definitionId, status: CardStatus.Untapped as const }];
    const returnedSites = emptyStack ? [] : priorStackSites;
    return updatePlayer(state, hazardIndex, p => ({
      ...p,
      agents: p.agents.map(a => a.character.instanceId === agentInstanceId
        ? { ...a, revealed: true, character: { ...a.character, status: CardStatus.Tapped as const }, siteStack: newSiteStack, ...acted }
        : a,
      ),
      siteDeck: [...removeById(p.siteDeck, homeSiteCard.instanceId), ...returnedSites],
    }));
  }
  // No home site — reveal without site, discard at EOT (rule 9.04)
  const priorStackSites = emptyStack ? [] : agent.siteStack.slice(0, -1);
  const newSiteStack = emptyStack
    ? []
    : [{ instanceId: currentSiteEntry!.instanceId, definitionId: currentSiteEntry!.definitionId, status: CardStatus.Untapped as const }];
  return updatePlayer(state, hazardIndex, p => ({
    ...p,
    agents: p.agents.map(a => a.character.instanceId === agentInstanceId
      ? { ...a, revealed: true, character: { ...a.character, status: CardStatus.Tapped as const }, siteStack: newSiteStack, ...acted, discardAtEndOfTurn: true }
      : a,
    ),
    siteDeck: [...p.siteDeck, ...priorStackSites],
  }));
}

export function handleAgentTapAttack(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'agent-tap-attack') return wrongActionType(state, action, 'agent-tap-attack');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];

  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  const agent = hazardPlayer.agents[agentIdx];
  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) return { state, error: 'Agent definition not found' };

  const tapAttackEff = (agentDef.effects ?? []).find(
    (e): e is AgentTapAttackEffect => e.type === 'agent-tap-attack',
  );
  if (!tapAttackEff) return { state, error: 'Agent does not have agent-tap-attack effect' };
  if (agent.character.status !== CardStatus.Untapped) return { state, error: 'Agent must be untapped' };

  const { prowess, body, isFaceDown, isAtHome, destSiteInst, company } =
    computeAgentAttackProwess(state, mhState, agent, agentDef, tapAttackEff.prowessBonus);
  logDetail(`Agent tap-attack "${agentDef.name}": prowess ${prowess} (faceDown: ${isFaceDown}, atHome: ${isAtHome}, bonus: +${tapAttackEff.prowessBonus})`);

  // Reveal agent if face-down; tap-attack does NOT consume an agent action.
  const revealed = revealAgentForAttack(
    state, hazardIndex, hazardPlayer, agent, agent.character.instanceId,
    isFaceDown, destSiteInst, action.homeSiteInstanceId, false,
  );
  if ('error' in revealed) return { state, error: revealed.error };
  const newState = revealed;

  // Rule 3.II.2.R3/B3: a Ringwraith or Balrog player treats agent hazard
  // attacks against their companies as detainment — mirrors the site-phase
  // declare-agent-attack path.
  const defendingAlignment = state.players[getPlayerIndex(state, state.activePlayer!)].alignment;
  const detainment = defendingAlignment === Alignment.Ringwraith || defendingAlignment === Alignment.Balrog;

  // Build CombatState
  const combat: CombatState = makeCombatState({
    attackSource: { type: 'agent', instanceId: agent.character.instanceId },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayer.id,
    strikesTotal: 1,
    strikeProwess: prowess,
    creatureBody: body,
    assignmentPhase: tapAttackEff.attackerAssigns ? 'attacker' : 'defender',
    detainment,
    ...(tapAttackEff.attackerAssigns ? { forceSingleTarget: true } : {}),
  });

  return {
    state: {
      ...newState,
      combat,
      phaseState: { ...mhState, hazardPlayerPassed: false, resourcePlayerPassed: false },
    },
  };
}

/**
 * Handle a tap-agent-at-site hazard short-event (e.g. An Article Missing,
 * Cunning Foes). Resolves the effect directly without going through the chain:
 *  - Removes the card from hand and discards it (short event)
 *  - Reveals the targeted agent if face-down (applying face-down prowess
 *    modifiers before reveal, per rule 9.06)
 *  - Taps the agent and marks it as having acted this turn
 *  - Builds and sets CombatState so the M/H phase attack can proceed
 */
/**
 * Handle a Pilfer Anything Unwatched (as-33) hazard short-event: the hazard
 * player taps one of their own untapped agents and targets one opponent
 * character in play whose home site matches the agent's current site.
 *
 * Resolution (rule text):
 *  - Tap the agent, discard the short event, count it against the hazard limit.
 *  - Enqueue a generic `dice-check`: the hazard player rolls 2d6 (+5 when the
 *    agent's current site is also one of its home sites). If the total is
 *    strictly greater than the target's mind + 5, the character is returned to
 *    its owner's hand (with the option to transfer one item to a company-mate).
 *
 * Bypasses the chain (mirrors `handleTapAgentAtSite`); the roll and its
 * consequences run through the pending `dice-check` / `transfer-returned-item`
 * resolutions.
 */
export function handleAgentTapReturnCharacter(
  state: GameState,
  action: PlayHazardAction,
  mhState: MovementHazardPhaseState,
  hazardPlayer: GameState['players'][number],
  hazardIndex: number,
  handCard: GameState['players'][number]['hand'][number],
  def: CardDefinition,
  effect: AgentTapReturnCharacterEffect,
): ReducerResult {
  const agentInstanceId = action.agentInstanceId!;
  const targetCharacterId = action.targetCharacterId!;

  const agentIdx = hazardPlayer.agents.findIndex(a => a.character.instanceId === agentInstanceId);
  if (agentIdx === -1) return { state, error: `Agent ${agentInstanceId as string} not found` };
  const agent = hazardPlayer.agents[agentIdx];
  if (agent.character.status !== CardStatus.Untapped) return { state, error: 'Agent must be untapped' };
  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) return { state, error: 'Agent definition not found' };

  // The target character belongs to the hazard player's opponent (resource player).
  const resourceIndex = 1 - hazardIndex;
  const resourcePlayer = state.players[resourceIndex];
  const targetChar = resourcePlayer.characters[targetCharacterId];
  if (!targetChar) return { state, error: `Target character ${targetCharacterId as string} not found` };
  const targetDef = defById(state, targetChar.definitionId);
  if (!targetDef || !isCharacterCard(targetDef)) return { state, error: 'Target is not a character' };

  // The agent's current site: top of its site stack, or its first home site
  // when the stack is empty (a face-down agent sitting at home).
  const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
  let agentSiteName: string | null = null;
  if (agent.siteStack.length > 0) {
    const topSite = agent.siteStack[agent.siteStack.length - 1];
    const siteDef = defById(state, topSite.definitionId);
    if (siteDef && isSiteCard(siteDef)) agentSiteName = siteDef.name;
  } else {
    agentSiteName = homesiteNames[0] ?? null;
  }
  const atHome = agentSiteName !== null && homesiteNames.includes(agentSiteName);

  const targetMind = targetChar.effectiveStats.mind ?? targetDef.mind ?? 0;
  const threshold = targetMind + effect.mindBonus;

  logDetail(`Pilfer Anything Unwatched: agent "${agentDef.name}" (site ${agentSiteName ?? '?'}, atHome=${atHome}) targeting "${targetDef.name}" (mind ${targetMind}); roll +${atHome ? effect.atHomeSiteBonus : 0} must be > ${threshold}`);

  // Tap the agent, discard the short event, count it against the hazard limit.
  const newHand = removeById(hazardPlayer.hand, handCard.instanceId);
  const bypassesLimit = hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'no-hazard-limit');
  const newHazardCount = bypassesLimit ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;

  let newState: GameState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, handCard],
    agents: p.agents.map((a, i) => i === agentIdx
      ? { ...a, character: { ...a.character, status: CardStatus.Tapped } }
      : a),
  }));
  newState = {
    ...newState,
    phaseState: { ...mhState, hazardsPlayedThisCompany: newHazardCount, resourcePlayerPassed: false },
  };

  // The hazard player rolls; on a pass the target returns to its owner's hand.
  newState = enqueueResolution(newState, {
    source: handCard.instanceId,
    actor: hazardPlayer.id,
    scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
    kind: {
      type: 'dice-check',
      label: `${def.name}: ${targetDef.name}`,
      roller: hazardPlayer.id,
      modifiers: atHome ? [{ kind: 'constant', value: effect.atHomeSiteBonus }] : [],
      threshold,
      comparison: 'gt',
      onPass: { type: 'return-character-to-hand', allowItemTransfer: true },
      continuation: { kind: 'dequeue-only' },
      requireTargetPresent: true,
      targetCharacterId,
    },
  });

  return { state: newState };
}

/**
 * Handle a Twisted Tales (dm-96) hazard short-event: the hazard player taps one
 * of their own untapped agents matching the card's `agentFilter` (a diplomat)
 * and has it make a rule-10.14 influence attempt against one of the opponent's
 * in-play factions that is playable at the agent's current site.
 *
 * Resolution (card text + rule 10.14):
 *  - Tap **and reveal** the agent (declaring an influence attempt reveals it),
 *    discard the short event, count it against the hazard limit. The attempt is
 *    not an agent action, so `remainingActions` is untouched.
 *  - Rule-10.14 bonuses apply: +2 direct influence while the agent stands at one
 *    of its home sites, and — for a faction playable at one of those home sites
 *    — the faction's value counts as 0 with a further +2 to the roll.
 *  - The card's own `attemptBonus` (+6) rides along as the attempt's
 *    `boostModifier`.
 *  - With `autoSuccessAtHomeSite` and a faction playable at a home site, the
 *    attempt is flagged `autoSuccess`: no attacker or defender roll is made and
 *    the resolution seizes (discards) the faction, though the defender still
 *    gets the cancel-influence window.
 *
 * Bypasses the chain (mirrors `handleAgentTapReturnCharacter`); the outcome runs
 * through the standard `opponent-influence-defend` pending resolution.
 */
export function handleAgentTapFactionInfluence(
  state: GameState,
  action: PlayHazardAction,
  mhState: MovementHazardPhaseState,
  hazardPlayer: GameState['players'][number],
  hazardIndex: number,
  handCard: GameState['players'][number]['hand'][number],
  def: CardDefinition,
  effect: AgentTapFactionInfluenceEffect,
): ReducerResult {
  const agentInstanceId = action.agentInstanceId!;
  const targetFactionInstanceId = action.targetFactionInstanceId!;

  const agentIdx = hazardPlayer.agents.findIndex(a => a.character.instanceId === agentInstanceId);
  if (agentIdx === -1) return { state, error: `Agent ${agentInstanceId as string} not found` };
  const agent = hazardPlayer.agents[agentIdx];
  if (agent.character.status !== CardStatus.Untapped) return { state, error: 'Agent must be untapped' };
  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) return { state, error: 'Agent definition not found' };
  if (!agentMatchesFilter(agentDef, effect.agentFilter)) {
    return { state, error: `${agentDef.name} does not match ${def.name}'s agent restriction` };
  }

  // The target faction belongs to the hazard player's opponent (resource player).
  const resourceIndex = 1 - hazardIndex;
  const resourcePlayer = state.players[resourceIndex];
  const targetFaction = findById(resourcePlayer.cardsInPlay, targetFactionInstanceId);
  if (!targetFaction) return { state, error: 'Target faction not found' };
  const factionDef = defById(state, targetFaction.definitionId);
  if (!factionDef || !isFactionCard(factionDef)) return { state, error: 'Target is not a faction' };

  const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
  const agentSiteName = agentCurrentSiteName(state, agent, agentDef);
  if (agentSiteName === null) return { state, error: 'Agent site could not be resolved' };

  const playableAt = factionDef.playableAt ?? [];
  if (!playableAt.some(e => 'site' in e && e.site === agentSiteName)) {
    return { state, error: `${factionDef.name} is not playable at ${agentSiteName}` };
  }

  // Rule 10.14: +2 direct influence while the agent is at one of its home sites,
  // plus any conditional DI the agent's own card text grants against this faction.
  const isAtHome = homesiteNames.includes(agentSiteName);
  let influencerDI = agentDef.directInfluence ?? 0;
  if (isAtHome) {
    influencerDI += 2;
    logDetail(`${def.name}: agent ${agentDef.name} is at home site ${agentSiteName} → +2 DI (total: ${influencerDI})`);
  }
  const diBonus = agentConditionalDirectInfluence(agentDef, {
    reason: 'faction-influence-check',
    faction: { race: (factionDef as { race?: Race }).race },
  });
  if (diBonus) {
    influencerDI += diBonus;
    logDetail(`${def.name}: agent ${agentDef.name} +${diBonus} DI vs faction ${factionDef.name} (total: ${influencerDI})`);
  }

  // Rule 10.14: a faction playable at one of the agent's home sites counts as
  // value 0 with +2 to the roll — and, for this card, succeeds automatically.
  let targetMind = factionDef.inPlayInfluenceNumber ?? factionDef.influenceNumber;
  let rollBonus = 0;
  const factionAtAgentHome = playableAt.some(e => 'site' in e && homesiteNames.includes(e.site));
  if (factionAtAgentHome) {
    targetMind = 0;
    rollBonus += 2;
    logDetail(`${def.name}: ${factionDef.name} is playable at the agent's home site → value 0, +2 roll`);
  }
  const autoSuccess = factionAtAgentHome && effect.autoSuccessAtHomeSite === true;

  // Tap and reveal the agent, discard the short event, count the hazard.
  const newHand = removeById(hazardPlayer.hand, handCard.instanceId);
  const bypassesLimit = hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'no-hazard-limit');
  const newHazardCount = bypassesLimit ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;

  let newState: GameState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, handCard],
    agents: p.agents.map((a, i) => i === agentIdx
      ? { ...a, revealed: true, character: { ...a.character, status: CardStatus.Tapped } }
      : a),
  }));
  newState = {
    ...newState,
    phaseState: { ...mhState, hazardsPlayedThisCompany: newHazardCount, resourcePlayerPassed: false },
  };

  // An automatically successful attempt needs no attacker roll.
  let attackerRoll = 0;
  const effects: GameEffect[] = [];
  if (!autoSuccess) {
    const { roll, rng, cheatRollTotal } = roll2d6(newState);
    attackerRoll = roll.die1 + roll.die2 + rollBonus;
    effects.push(diceRollEffect(hazardPlayer.name, roll, `${def.name}: ${agentDef.name} influences ${factionDef.name}${rollBonus > 0 ? ` (+${rollBonus} bonus)` : ''}`));
    newState = { ...newState, rng, cheatRollTotal };
  }

  const opponentGI = effectiveGeneralInfluence(newState, resourcePlayer.id) - resourcePlayer.generalInfluenceUsed;
  const crossAlignmentPenalty = crossAlignmentInfluencePenalty(hazardPlayer.alignment, resourcePlayer.alignment);

  logDetail(`${def.name}: ${agentDef.name} (at ${agentSiteName}) influences ${factionDef.name} — roll ${attackerRoll}, DI ${influencerDI}, GI ${opponentGI}, value ${targetMind}, boost +${effect.attemptBonus}${autoSuccess ? ', AUTOMATIC SUCCESS' : ''}`);

  newState = enqueueResolution(newState, {
    source: handCard.instanceId,
    actor: resourcePlayer.id,
    scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
    kind: {
      type: 'opponent-influence-defend',
      attempt: {
        influencerId: agent.character.instanceId,
        targetInstanceId: targetFactionInstanceId,
        targetKind: 'faction',
        targetPlayer: resourcePlayer.id,
        attackerRoll,
        influencerDI,
        opponentGI,
        targetMind,
        controllerDI: 0,
        crossAlignmentPenalty,
        boostModifier: effect.attemptBonus,
        ...(autoSuccess ? { autoSuccess: true } : {}),
        revealedCard: null,
      },
    },
  });

  return { state: newState, effects };
}

/**
 * Handle a Good Sense Revolts (dm-61, mode A) hazard short-event: the hazard
 * player taps one of their own untapped agents (no `agentFilter` — any agent
 * qualifies) and has it make a rule-10.14 influence attempt against an
 * opponent's ally, faction, or character — the multi-target counterpart of
 * Twisted Tales' faction-only {@link handleAgentTapFactionInfluence}.
 *
 * Resolution (card text + rule 10.14):
 *  - Tap **and reveal** the agent, discard the short event, count it against
 *    the hazard limit. Not an agent action.
 *  - Rule-10.14 bonuses apply: +2 direct influence while the agent stands at
 *    one of its home sites; a target that shares (character/ally) or is
 *    playable at (faction) one of those home sites counts as value/mind 0
 *    with a further +2 to the roll.
 *  - The card's own bonus is tiered on that same home-site condition:
 *    `attemptBonus` (+4) normally, `attemptBonusAtHomeSite` (+8) when it
 *    applies.
 *  - A separately-played copy of this same card played as mode B may have
 *    banked a one-shot influence check-modifier on this agent — folded in via
 *    {@link foldAgentInfluenceBoost}.
 *
 * Bypasses the chain (mirrors `handleAgentTapFactionInfluence`); the outcome
 * runs through the standard `opponent-influence-defend` pending resolution.
 */
export function handleAgentTapMultiInfluence(
  state: GameState,
  action: PlayHazardAction,
  mhState: MovementHazardPhaseState,
  hazardPlayer: GameState['players'][number],
  hazardIndex: number,
  handCard: GameState['players'][number]['hand'][number],
  def: CardDefinition,
  effect: AgentTapMultiInfluenceEffect,
): ReducerResult {
  const agentInstanceId = action.agentInstanceId!;

  const agentIdx = hazardPlayer.agents.findIndex(a => a.character.instanceId === agentInstanceId);
  if (agentIdx === -1) return { state, error: `Agent ${agentInstanceId as string} not found` };
  const agent = hazardPlayer.agents[agentIdx];
  if (agent.character.status !== CardStatus.Untapped) return { state, error: 'Agent must be untapped' };
  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) return { state, error: 'Agent definition not found' };

  const resourceIndex = 1 - hazardIndex;
  const resourcePlayer = state.players[resourceIndex];

  const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
  const agentSiteName = agentCurrentSiteName(state, agent, agentDef);
  const isAtHome = agentSiteName !== null && homesiteNames.includes(agentSiteName);

  let influencerDI = agentDef.directInfluence ?? 0;
  if (isAtHome) {
    influencerDI += 2;
    logDetail(`${def.name}: agent ${agentDef.name} is at home site ${agentSiteName} → +2 DI (total: ${influencerDI})`);
  }

  let targetKind: 'character' | 'ally' | 'faction';
  let targetInstanceId: CardInstanceId;
  let targetMind = 0;
  let controllerDI = 0;
  let rollBonus = 0;
  let atHomeBonusTarget = false;

  const controllerUnusedDI = (id: CardInstanceId): number => influenceModificationsNullified(state)
    ? normalUnusedDI(state, id, resourcePlayer, [], { reason: 'influence-check' })
    : availableDI(state, id, resourcePlayer);

  if (action.targetCharacterId) {
    targetKind = 'character';
    targetInstanceId = action.targetCharacterId;
    const targetChar = resourcePlayer.characters[targetInstanceId];
    if (!targetChar) return { state, error: 'Target character not found' };
    const targetDef = defById(state, targetChar.definitionId);
    if (!targetDef || !isCharacterCard(targetDef)) return { state, error: 'Target is not a character' };

    const diBonus = agentConditionalDirectInfluence(agentDef, { reason: 'influence-check', target: { race: targetDef.race } });
    if (diBonus) {
      influencerDI += diBonus;
      logDetail(`${def.name}: agent ${agentDef.name} +${diBonus} DI vs ${targetDef.race} ${targetDef.name} (total: ${influencerDI})`);
    }
    targetMind = controlCostOf(state, targetChar, targetDef.mind ?? null) ?? 0;

    const targetHomesites = parseHomesiteNames((targetDef as { homesite?: string }).homesite ?? '');
    if (targetHomesites.some(h => homesiteNames.includes(h))) {
      targetMind = 0;
      rollBonus += 2;
      atHomeBonusTarget = true;
      logDetail(`${def.name}: ${targetDef.name} shares home site → mind = 0, +2 roll`);
    }
    if (targetChar.controlledBy !== 'general') {
      controllerDI = controllerUnusedDI(targetChar.controlledBy);
    }
  } else if (action.targetAllyId) {
    targetKind = 'ally';
    targetInstanceId = action.targetAllyId;
    let allyFound = false;
    for (const [oppCharId, oppChar] of characterEntries(resourcePlayer)) {
      const allyInst = oppChar.allies.find(a => a.instanceId === targetInstanceId);
      if (!allyInst) continue;
      const allyDef = defById(state, allyInst.definitionId);
      if (!allyInst.statOverride && (!allyDef || !isAllyCard(allyDef))) return { state, error: 'Target is not an ally' };
      targetMind = allyEffectiveMind(state, allyInst);
      controllerDI = controllerUnusedDI(oppCharId);

      const allyHomesites = parseHomesiteNames((allyDef as { homesite?: string }).homesite ?? '');
      if (allyHomesites.some(h => homesiteNames.includes(h))) {
        targetMind = 0;
        rollBonus += 2;
        atHomeBonusTarget = true;
        logDetail(`${def.name}: ally shares home site → mind = 0, +2 roll`);
      }
      allyFound = true;
      break;
    }
    if (!allyFound) return { state, error: 'Target ally not found' };
  } else if (action.targetFactionInstanceId) {
    targetKind = 'faction';
    targetInstanceId = action.targetFactionInstanceId;
    const targetFaction = findById(resourcePlayer.cardsInPlay, targetInstanceId);
    if (!targetFaction) return { state, error: 'Target faction not found' };
    const factionDef = defById(state, targetFaction.definitionId);
    if (!factionDef || !isFactionCard(factionDef)) return { state, error: 'Target is not a faction' };
    if (factionDef.noOpponentInfluence) return { state, error: `${factionDef.name} may not be influenced by an opponent` };

    const diBonus = agentConditionalDirectInfluence(agentDef, {
      reason: 'faction-influence-check',
      faction: { race: (factionDef as { race?: Race }).race },
    });
    if (diBonus) {
      influencerDI += diBonus;
      logDetail(`${def.name}: agent ${agentDef.name} +${diBonus} DI vs faction ${factionDef.name} (total: ${influencerDI})`);
    }
    targetMind = factionDef.inPlayInfluenceNumber ?? factionDef.influenceNumber;

    if (agentSiteName !== null) {
      const factionAtHome = (factionDef.playableAt ?? []).some(e => 'site' in e && homesiteNames.includes(e.site));
      if (factionAtHome) {
        targetMind = 0;
        rollBonus += 2;
        atHomeBonusTarget = true;
        logDetail(`${def.name}: ${factionDef.name} is playable at the agent's home site → value = 0, +2 roll`);
      }
    }
  } else {
    return { state, error: 'No target specified' };
  }

  // dm-61's own bonus: +8 instead of +4 when the target shares/is playable at
  // the agent's home site — the same condition rule 10.14 already zeroes the
  // target's value for.
  const cardBonus = atHomeBonusTarget && effect.attemptBonusAtHomeSite !== undefined
    ? effect.attemptBonusAtHomeSite
    : effect.attemptBonus;

  // A separately-played copy of this same card (mode B) may have banked a
  // one-shot influence check-modifier on this agent.
  const { boost: bankedBoost, consumedIds } = foldAgentInfluenceBoost(state, agent.character.instanceId, {
    reason: 'opponent-influence-check',
    target: { kind: targetKind },
  });
  const boostModifier = cardBonus + bankedBoost;

  // Tap and reveal the agent, discard the short event, count the hazard.
  const newHand = removeById(hazardPlayer.hand, handCard.instanceId);
  const bypassesLimit = hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'no-hazard-limit');
  const newHazardCount = bypassesLimit ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;

  let newState: GameState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, handCard],
    agents: p.agents.map((a, i) => i === agentIdx
      ? { ...a, revealed: true, character: { ...a.character, status: CardStatus.Tapped } }
      : a),
  }));
  newState = {
    ...newState,
    activeConstraints: newState.activeConstraints.filter(c => !consumedIds.includes(c.id as string)),
    phaseState: { ...mhState, hazardsPlayedThisCompany: newHazardCount, resourcePlayerPassed: false },
  };

  const { roll, rng, cheatRollTotal } = roll2d6(newState);
  const attackerRoll = roll.die1 + roll.die2 + rollBonus;
  const rollEffect = diceRollEffect(hazardPlayer.name, roll, `${def.name}: ${agentDef.name} influences ${targetKind}${rollBonus > 0 ? ` (+${rollBonus} bonus)` : ''}`);
  newState = { ...newState, rng, cheatRollTotal };

  const opponentGI = effectiveGeneralInfluence(newState, resourcePlayer.id) - resourcePlayer.generalInfluenceUsed;
  const crossAlignmentPenalty = crossAlignmentInfluencePenalty(hazardPlayer.alignment, resourcePlayer.alignment);

  logDetail(`${def.name}: ${agentDef.name} influences ${targetKind} ${targetInstanceId as string} — roll ${attackerRoll}, DI ${influencerDI}, GI ${opponentGI}, value ${targetMind}, boost +${boostModifier}`);

  newState = enqueueResolution(newState, {
    source: handCard.instanceId,
    actor: resourcePlayer.id,
    scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
    kind: {
      type: 'opponent-influence-defend',
      attempt: {
        influencerId: agent.character.instanceId,
        targetInstanceId,
        targetKind,
        targetPlayer: resourcePlayer.id,
        attackerRoll,
        influencerDI,
        opponentGI,
        targetMind,
        controllerDI,
        crossAlignmentPenalty,
        boostModifier,
        revealedCard: null,
      },
    },
  });

  return { state: newState, effects: [rollEffect] };
}

/**
 * Handle a Good Sense Revolts (dm-61, mode B) hazard short-event:
 * "Alternatively, modify an influence attempt by an agent by +4." Banks a
 * one-shot `check-modifier` {@link ActiveConstraint} on one of the hazard
 * player's own agents (any tap status — this mode does not itself tap or
 * reveal the target), consumed the next time that agent makes a qualifying
 * rule-10.14 attempt via {@link foldAgentInfluenceBoost} (native ability, or
 * this same card's own mode A). Mirrors Mine or No One's (ba-68), which banks
 * the identical constraint kind via the ordinary `add-constraint` play-option
 * apply — this card instead builds it directly because its target (the
 * hazard player's own agent) sits outside the play-target/play-option chain's
 * reach (CoE 2.IV.vii.3: hazard-event `play-target: "character"` targets the
 * *opponent's* characters, not the caster's own).
 */
export function handleAgentInfluenceBoost(
  state: GameState,
  action: PlayHazardAction,
  mhState: MovementHazardPhaseState,
  hazardPlayer: GameState['players'][number],
  hazardIndex: number,
  handCard: GameState['players'][number]['hand'][number],
  def: CardDefinition,
  effect: AgentInfluenceBoostEffect,
): ReducerResult {
  const agentInstanceId = action.agentInstanceId!;
  const agent = hazardPlayer.agents.find(a => a.character.instanceId === agentInstanceId);
  if (!agent) return { state, error: `Agent ${agentInstanceId as string} not found` };

  logDetail(`${def.name}: banking +${effect.attemptBonus} influence boost on agent ${agentInstanceId as string}`);

  const newHand = removeById(hazardPlayer.hand, handCard.instanceId);
  const bypassesLimit = hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'no-hazard-limit');
  const newHazardCount = bypassesLimit ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;

  let newState: GameState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, handCard],
  }));
  newState = {
    ...newState,
    phaseState: { ...mhState, hazardsPlayedThisCompany: newHazardCount, resourcePlayerPassed: false },
  };

  newState = addConstraint(newState, {
    source: handCard.instanceId,
    sourceDefinitionId: def.id,
    scope: { kind: 'until-cleared' },
    target: { kind: 'character', characterId: agentInstanceId },
    kind: {
      type: 'check-modifier',
      check: 'influence',
      value: effect.attemptBonus,
      when: { reason: 'opponent-influence-check' },
    },
  });

  return { state: newState };
}

export function handleTapAgentAtSite(
  state: GameState,
  action: PlayHazardAction,
  mhState: MovementHazardPhaseState,
  hazardPlayer: GameState['players'][number],
  hazardIndex: number,
  handCard: GameState['players'][number]['hand'][number],
  def: CardDefinition,
  tapAgentEff: TapAgentEffect,
): ReducerResult {
  const agentInstanceId = action.agentInstanceId!;

  // Locate the agent
  const agent = hazardPlayer.agents.find(a => a.character.instanceId === agentInstanceId);
  if (!agent) return { state, error: `Agent ${agentInstanceId as string} not found` };

  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) {
    return { state, error: `Agent definition not found for ${agentInstanceId as string}` };
  }

  const { prowess, body, isFaceDown, isAtHome, destSiteInst, company } =
    computeAgentAttackProwess(state, mhState, agent, agentDef, tapAgentEff.prowessBonus);
  logDetail(`Tap-agent-at-site "${def.name}": agent "${agentDef.name}" prowess ${prowess} (faceDown: ${isFaceDown}, atHome: ${isAtHome}, bonus: +${tapAgentEff.prowessBonus})`);

  // Reveal agent if face-down; playing the card consumes the agent's action.
  const revealed = revealAgentForAttack(
    state, hazardIndex, hazardPlayer, agent, agentInstanceId,
    isFaceDown, destSiteInst, action.homeSiteInstanceId, true,
  );
  if ('error' in revealed) return { state, error: revealed.error };
  let stateAfterReveal = revealed;

  // --- Remove card from hand, add to discard ---
  const newHand = removeById(stateAfterReveal.players[hazardIndex].hand, handCard.instanceId);
  stateAfterReveal = updatePlayer(stateAfterReveal, hazardIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, handCard],
  }));

  // --- Increment hazard count (the card counts; the attack does not) ---
  const bypassesLimit = hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'no-hazard-limit');
  const newHazardCount = bypassesLimit
    ? mhState.hazardsPlayedThisCompany
    : mhState.hazardsPlayedThisCompany + 1;

  // Rule 3.II.2.R3/B3: a Ringwraith or Balrog player treats agent hazard
  // attacks against their companies as detainment — mirrors the site-phase
  // declare-agent-attack path.
  const defendingAlignment = state.players[getPlayerIndex(state, state.activePlayer!)].alignment;
  const detainment = defendingAlignment === Alignment.Ringwraith || defendingAlignment === Alignment.Balrog;

  // --- Build CombatState ---
  const combat: CombatState = makeCombatState({
    attackSource: { type: 'agent', instanceId: agentInstanceId },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayer.id,
    strikesTotal: 1,
    strikeProwess: prowess,
    creatureBody: body,
    assignmentPhase: tapAgentEff.attackerAssigns ? 'attacker' : 'defender',
    detainment,
    ...(tapAgentEff.attackerAssigns ? { forceSingleTarget: true } : {}),
    ...(tapAgentEff.strikeEffect ? { strikeEffect: tapAgentEff.strikeEffect } : {}),
  });

  return {
    state: {
      ...stateAfterReveal,
      combat,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: newHazardCount,
        resourcePlayerPassed: false,
      },
    },
  };
}

