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
import { Phase, getPlayerIndex, hasPlayFlag, CardStatus } from '../../index.js';
import type { CardEffect, OnEventEffect, CancelChainReturnToOriginEffect, ForceReturnToOriginEffect } from '../../types/effects.js';
import { logDetail } from './log.js';
import { emitGrantedActionConstraintActions } from './granted-action-constraints.js';
import { heroResourceShortEventActions } from './long-event.js';

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
    actions.push(...playSkillCancelChainActions(state, playerId));
    actions.push(...resourceEventChainActions(state, playerId));
  }

  // On-guard reveal: hazard player may reveal on-guard events during
  // an influence-attempt chain (rule 2.V.6)
  if (chain.restriction === 'normal') {
    actions.push(...onGuardRevealChainActions(state, playerId));
  }

  // Goldberry and similar allies: tap to cancel a force-return-to-origin chain entry
  if (chain.restriction === 'normal' && state.phaseState.phase === Phase.MovementHazard) {
    actions.push(...cancelReturnToOriginChainActions(state, playerId));
  }

  // Granted-action constraints (Great Ship, and any future card whose
  // effect is "company may tap to cancel a hazard during M/H chain").
  if (chain.restriction === 'normal' && state.phaseState.phase === Phase.MovementHazard) {
    const mhState = state.phaseState;
    const playerIndex = getPlayerIndex(state, playerId);
    const company = state.players[playerIndex].companies[mhState.activeCompanyIndex];
    if (company) {
      let hazardCount = 0;
      for (const e of chain.entries) {
        if (e.resolved || e.negated || !e.card) continue;
        const def = state.cardPool[e.card.definitionId as string];
        if (def && (def.cardType === 'hazard-creature' || def.cardType === 'hazard-event')) hazardCount++;
      }
      actions.push(...emitGrantedActionConstraintActions(state, playerId, company, 'movement-hazard', 'chain-declaring', {
        path: mhState.resolvedSitePath,
        chain: { hazardCount },
      }));
    }
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
    if (!hasPlayFlag(def, 'playable-as-resource')) continue;

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
 * During chain declaring, the priority player may play a hazard short
 * event whose `on-event: self-enters-play` apply is
 * `cancel-chain-entry` with `select: 'target'` and a `requiredSkill`
 * filter. Emits one `play-short-event` action per eligible target —
 * an unresolved chain entry whose source card carries at least one
 * effect with a matching `requiredSkill`. Used by Searching Eye to
 * cancel scout-skill cards (Concealment, A Nice Place to Hide, Stealth)
 * before they resolve.
 */
function playSkillCancelChainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const chain = state.chain;
  if (!chain) return [];
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const def = state.cardPool[handCard.definitionId as string];
    if (!def || def.cardType !== 'hazard-event') continue;
    const hazDef = def;
    if (hazDef.eventType !== 'short') continue;
    const effects = (hazDef as { effects?: readonly CardEffect[] }).effects ?? [];

    const cancelEffect = effects.find(
      (e): e is OnEventEffect =>
        e.type === 'on-event'
        && e.event === 'self-enters-play'
        && e.apply?.type === 'cancel-chain-entry'
        && e.apply?.select === 'target'
        && typeof e.apply?.requiredSkill === 'string',
    );
    if (!cancelEffect) continue;
    const requiredSkill = cancelEffect.apply.requiredSkill!;

    for (const entry of chain.entries) {
      if (entry.resolved || entry.negated || !entry.card) continue;
      if (entry.card.instanceId === handCard.instanceId) continue;
      const targetDef = state.cardPool[entry.card.definitionId as string];
      if (!targetDef || !('effects' in targetDef)) continue;
      const targetEffects = (targetDef as { effects?: readonly CardEffect[] }).effects ?? [];
      const hasSkill = targetEffects.some(
        e => (e as { requiredSkill?: string }).requiredSkill === requiredSkill,
      );
      if (!hasSkill) continue;

      logDetail(`Chain response: ${hazDef.name} can cancel ${targetDef.name ?? entry.card.definitionId} (requires ${requiredSkill})`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          targetInstanceId: entry.card.instanceId,
        },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * During M/H chain declaring, allies with `cancel-chain-return-to-origin`
 * (e.g. Goldberry) may tap to negate an unresolved chain entry that is
 * tagged with `force-return-to-origin`.
 *
 * Only the resource (active) player benefits. Only untapped allies qualify.
 * One action is emitted per (ally, target entry) pair.
 */
function cancelReturnToOriginChainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const chain = state.chain!;
  const mhState = state.phaseState as import('../../index.js').MovementHazardPhaseState;

  // Only the resource (active) player may use this ability
  if (state.activePlayer !== playerId) return [];

  const playerIndex = getPlayerIndex(state, playerId);
  const company = state.players[playerIndex].companies[mhState.activeCompanyIndex];
  if (!company) return [];

  // Collect unresolved chain entries carrying force-return-to-origin
  const returnEntries: { instanceId: CardInstanceId; defName: string }[] = [];
  for (const e of chain.entries) {
    if (e.resolved || e.negated || !e.card) continue;
    const def = state.cardPool[e.card.definitionId as string];
    if (!def || !('effects' in def) || !def.effects) continue;
    const hasTag = (def.effects).some(
      (eff): eff is ForceReturnToOriginEffect => eff.type === 'force-return-to-origin',
    );
    if (hasTag) {
      returnEntries.push({
        instanceId: e.card.instanceId,
        defName: (def as { name?: string }).name ?? (e.card.definitionId as string),
      });
    }
  }
  if (returnEntries.length === 0) return [];

  const actions: EvaluatedAction[] = [];
  const player = state.players[playerIndex];

  for (const charId of company.characters) {
    const charData = player.characters[charId as string];
    if (!charData) continue;
    for (const ally of charData.allies ?? []) {
      const allyDef = state.cardPool[ally.definitionId as string];
      if (!allyDef || !('effects' in allyDef) || !allyDef.effects) continue;
      const hasCancelEffect = (allyDef.effects).some(
        (e): e is CancelChainReturnToOriginEffect => e.type === 'cancel-chain-return-to-origin',
      );
      if (!hasCancelEffect) continue;
      const allyName = (allyDef as { name?: string }).name ?? (ally.definitionId as string);
      if (ally.status !== CardStatus.Untapped) {
        logDetail(`cancel-chain-return-to-origin: ${allyName} is tapped, cannot act`);
        continue;
      }
      for (const entry of returnEntries) {
        logDetail(`cancel-chain-return-to-origin: ${allyName} can cancel "${entry.defName}"`);
        actions.push({
          action: {
            type: 'cancel-return-to-origin',
            player: playerId,
            allyInstanceId: ally.instanceId,
            targetInstanceId: entry.instanceId,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * During M/H chain declaring, the resource (active) player may play any
 * resource short event they would normally be allowed to play during the
 * movement/hazard phase — e.g. Many Turns and Doublings to decrease the
 * hazard limit (CoE rule 2.IV.iii.1: active condition checked at resolution).
 *
 * Delegates to {@link heroResourceShortEventActions}, which already filters
 * out combat-only cards and evaluates play-option `when` conditions.
 */
function resourceEventChainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.phaseState.phase !== Phase.MovementHazard) return [];
  if (state.activePlayer !== playerId) return [];
  return heroResourceShortEventActions(state, playerId, 'movement-hazard');
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


