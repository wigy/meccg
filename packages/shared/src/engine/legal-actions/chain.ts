/**
 * @module legal-actions/chain
 *
 * Computes legal actions when a chain of effects is active.
 *
 * When `state.chain` is non-null, {@link computeLegalActions} delegates here
 * instead of to the phase-specific handler. This module determines what the
 * priority player can declare in response (playable cards, pass) while
 * respecting the chain's restriction mode.
 *
 * During the `'resolving'` mode, no player actions are needed — the reducer
 * auto-advances resolution. This function only returns actions during the
 * `'declaring'` mode for the player who currently has priority.
 */

import type { GameState, PlayerId, EvaluatedAction, PassChainPriorityAction, CardInstanceId, HazardEventCard } from '../../index.js';
import { Phase, getPlayerIndex } from '../../index.js';
import { logDetail } from './log.js';

/**
 * Returns the legal actions available to the given player while a chain
 * of effects is active. Only the priority player may act during the
 * declaring phase; during resolution the reducer auto-advances.
 */
export function chainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const chain = state.chain!;

  // During resolution, the reducer auto-advances — no player input needed
  if (chain.mode === 'resolving') {
    logDetail(`Chain is resolving — no actions for player ${playerId as string}`);
    return [];
  }

  // Only the priority player may act
  if (playerId !== chain.priority) {
    logDetail(`Player ${playerId as string} does not have chain priority — no actions`);
    return [];
  }

  const actions: EvaluatedAction[] = [];

  // Short-event response actions (e.g. Twilight canceling an environment)
  if (chain.restriction === 'normal') {
    actions.push(...playShortEventChainActions(state, playerId));
  }

  // On-guard reveal: hazard player may reveal on-guard events during
  // an influence-attempt chain (rule 2.V.6)
  if (chain.restriction === 'normal') {
    actions.push(...onGuardRevealChainActions(state, playerId));
  }

  // The priority player can always pass
  const passAction: PassChainPriorityAction = {
    type: 'pass-chain-priority',
    player: playerId,
  };
  actions.push({ action: passAction, viable: true });

  logDetail(`Chain declaring: player ${playerId as string} has ${actions.length} action(s) (pass${actions.length > 1 ? ' + responses' : ' only'})`);

  return actions;
}

/**
 * During chain declaring, the priority player may play short-event cards
 * with `playable-as-resource` (e.g. Twilight) to cancel an environment.
 * Targets include environments in cardsInPlay and unresolved
 * chain entries with the environment keyword.
 */
function playShortEventChainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = state.cardPool[handCard.definitionId as string] as HazardEventCard | undefined;
    if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') continue;
    if (!def.effects?.some(e => e.type === 'play-restriction' && e.rule === 'playable-as-resource')) continue;

    // Collect environment targets
    const isEnv = (defId: string): boolean => {
      const d = state.cardPool[defId];
      return !!d && 'keywords' in d
        && !!(d as { keywords?: readonly string[] }).keywords?.includes('environment');
    };
    const envTargets: { instanceId: CardInstanceId; definitionId: string }[] = [];
    for (const p of state.players) {
      for (const c of p.cardsInPlay) {
        if (isEnv(c.definitionId as string)) envTargets.push(c);
      }
    }
    if (state.chain) {
      for (const entry of state.chain.entries) {
        if (entry.resolved || entry.negated) continue;
        if (!entry.card) continue;
        if (isEnv(entry.card.definitionId as string)) {
          envTargets.push({ instanceId: entry.card.instanceId, definitionId: entry.card.definitionId as string });
        }
      }
    }

    for (const target of envTargets) {
      const targetDef = state.cardPool[target.definitionId];
      logDetail(`Chain response: ${def.name} can cancel ${targetDef?.name ?? target.definitionId}`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId,
          targetInstanceId: target.instanceId,
        },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * On-guard reveal actions during chain declaring for influence-attempt chains.
 *
 * The hazard player (opponent of the influence-attempt declarer) may reveal
 * on-guard hazard events that affect the company, just like the old
 * awaitingOnGuardReveal window but now as part of the chain response.
 */
function onGuardRevealChainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const chain = state.chain!;

  // Only relevant when the chain has an influence-attempt entry
  const infEntry = chain.entries.find(e => e.payload.type === 'influence-attempt' && !e.resolved);
  if (!infEntry) return [];

  // Only the hazard player (opponent of declarer) can reveal on-guard
  if (playerId === infEntry.declaredBy) return [];

  // Must be in the site phase to access on-guard cards
  if (state.phaseState.phase !== Phase.Site) return [];
  const siteState = state.phaseState;

  const activeIndex = getPlayerIndex(state, infEntry.declaredBy);
  const resourcePlayer = state.players[activeIndex];
  const company = resourcePlayer.companies[siteState.activeCompanyIndex];
  if (!company) return [];

  const actions: EvaluatedAction[] = [];

  for (const ogCard of company.onGuardCards) {
    if (ogCard.revealed) continue;
    const def = state.cardPool[ogCard.definitionId as string];
    if (!def || def.cardType !== 'hazard-event') continue;

    // Per CoE rule 2.V.6, only hazard events that directly affect the
    // company (or an influence check) may be revealed from on-guard.
    // Cards must declare an on-guard-reveal effect with the matching trigger.
    const hasInfluenceTrigger = 'effects' in def && def.effects?.some(
      (e: { type: string; trigger?: string }) =>
        e.type === 'on-guard-reveal' && e.trigger === 'influence-attempt',
    );
    if (!hasInfluenceTrigger) {
      logDetail(`Chain on-guard reveal: "${def.name}" skipped — no influence-attempt trigger`);
      continue;
    }

    // Character-targeting events get one action per character
    const isCharTargeting = 'effects' in def && def.effects?.some(
      (e: { type: string; target?: string }) => e.type === 'play-target' && e.target === 'character',
    );
    if (isCharTargeting) {
      for (const charId of company.characters) {
        logDetail(`Chain on-guard reveal: "${def.name}" targeting ${charId as string}`);
        actions.push({
          action: {
            type: 'reveal-on-guard',
            player: playerId,
            cardInstanceId: ogCard.instanceId,
            targetCharacterId: charId,
          },
          viable: true,
        });
      }
    } else {
      logDetail(`Chain on-guard reveal: "${def.name}" eligible`);
      actions.push({
        action: {
          type: 'reveal-on-guard',
          player: playerId,
          cardInstanceId: ogCard.instanceId,
        },
        viable: true,
      });
    }
  }

  return actions;
}
