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

import type { GameState, PlayerId, EvaluatedAction, PassChainPriorityAction, CardInstanceId, CardDefinitionId, HazardEventCard } from '../../index.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { getPlayerIndex } from '../../state-utils.js';
import { CardStatus } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import type { CardEffect, OnEventEffect, CancelChainReturnToOriginEffect, ForceReturnToOriginEffect, GrantActionEffect, CounterCancelAttackRollEffect } from '../../types/effects.js';
import { isSiteCard, isCharacterCard } from '../../types/cards.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { getEffectiveNaturalSkills } from '../effects/index.js';
import { cardStatusToName } from '../../types/common.js';
import { logDetail } from './log.js';
import { playerById, getCardEffects, defById, companyById } from '../reducer-utils.js';
import { companyContainsBalrogAvatar } from '../../state-utils.js';
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

  // Black Vapour (ba-14): the attacking (hazard) player may counter an
  // opponent's chain entry that would cancel a Spider (or matching-race) attack.
  if (chain.restriction === 'normal' && state.combat != null) {
    actions.push(...counterCancelRollChainActions(state, playerId));
  }

  // Great Fissure (ba-61): the Balrog attacker may counter-cancel an opponent's
  // chain entry that would cancel their company-vs-company attack.
  if (chain.restriction === 'normal') {
    actions.push(...counterCancelAttackChainActions(state, playerId));
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
        const def = defById(state, e.card.definitionId);
        if (def && (def.cardType === 'hazard-creature' || def.cardType === 'hazard-event')) hazardCount++;
      }
      actions.push(...emitGrantedActionConstraintActions(state, playerId, company, 'movement-hazard', 'chain-declaring', {
        path: mhState.resolvedSitePath,
        chain: { hazardCount },
      }));
      // Tom Bombadil (tw-350) / Leaflock (tw-265): an in-play ally taps itself
      // to cancel a hazard when its company is moving to one of the ally's
      // home regions.
      const destDef = company.destinationSite ? defById(state, company.destinationSite.definitionId) : undefined;
      const destinationRegion = destDef && isSiteCard(destDef) ? destDef.region : undefined;
      actions.push(...emitAllyCancelChainActions(state, playerId, company, hazardCount, destinationRegion));
      // Enchanted Stream (as-27): a hazard being played that carries its own
      // "a <skill> in the company may tap to cancel this card before it
      // resolves" grant-action. Offered to the active (resource) player.
      actions.push(...emitHazardSelfCancelBySkillActions(state, playerId, company));
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
 * Emit `activate-granted-action` cancel-chain-entry activations for in-play
 * allies carrying a static `grant-action` with `action: "cancel-chain-entry"`
 * (Tom Bombadil tw-350, Leaflock tw-265).
 *
 * Unlike Great Ship (a turn-scoped granted-action *constraint* that taps a
 * character in the company — {@link emitGrantedActionConstraintActions}), these
 * allies tap *themselves* to cancel a hazard being played against the active
 * moving company. Eligibility:
 *  - the ally is an untapped ally in the active company,
 *  - there is at least one unresolved hazard on the chain (`hazardCount > 0`),
 *  - the ally's grant-action `when` matches a context exposing the active
 *    company's destination region and the chain hazard count.
 *
 * The reducer path is the shared `handleGrantActionApply`: the cost
 * `{ tap: "self" }` taps the ally in place (source ≠ bearer character) and the
 * `cancel-chain-entry` apply negates the most-recent unresolved hazard entry.
 * These grant-actions are deliberately excluded from the generic per-phase
 * scanner (`extractGrantActions`), so this chain-declaring emitter is their
 * only source — a chain cancellation is meaningless outside an active chain.
 */
function emitAllyCancelChainActions(
  state: GameState,
  playerId: PlayerId,
  company: import('../../index.js').Company,
  hazardCount: number,
  destinationRegion: string | undefined,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  if (hazardCount === 0) return actions;

  const player = playerById(state, playerId);
  if (!player) return actions;

  const ctx = { destinationRegion, chain: { hazardCount } };

  for (const charInstId of company.characters) {
    const char = player.characters[charInstId];
    if (!char) continue;
    for (const ally of char.allies) {
      if (ally.status !== CardStatus.Untapped) continue;
      const allyDef = defById(state, ally.definitionId);
      const cancelEffects = getCardEffects(allyDef).filter(
        (e): e is GrantActionEffect =>
          e.type === 'grant-action' && e.action === 'cancel-chain-entry'
          && e.apply?.type === 'cancel-chain-entry',
      );
      for (const effect of cancelEffects) {
        if (effect.when && !matchesCondition(effect.when, ctx)) {
          logDetail(`Ally cancel-chain (${allyDef?.name ?? '?'}): when not met (destination region: ${destinationRegion ?? 'none'})`);
          continue;
        }
        logDetail(`Ally cancel-chain available: ${allyDef?.name ?? '?'} may tap to cancel a hazard (destination region ${destinationRegion ?? 'none'})`);
        actions.push({
          action: {
            type: 'activate-granted-action',
            player: playerId,
            characterId: charInstId,
            sourceCardId: ally.instanceId,
            sourceCardDefinitionId: ally.definitionId,
            actionId: 'cancel-chain-entry',
            rollThreshold: 0,
          },
          viable: true,
        });
      }
    }
  }
  return actions;
}

/**
 * Emit `activate-granted-action` cancel-chain-entry activations for an
 * unresolved hazard chain entry whose **own** source card carries a static
 * `grant-action` with `action: "cancel-chain-entry"` gated on the *acting
 * character's* skills — Enchanted Stream (as-27): "A ranger in the company can
 * tap to cancel this card before it resolves."
 *
 * Unlike Tom Bombadil (an in-play ally that cancels *other* hazards —
 * {@link emitAllyCancelChainActions}), here the grant lives on the hazard being
 * played, and the canceller is an untapped **character** in the target (active)
 * company whose printed skills satisfy the grant's `when` (`actor.skills`).
 * Only the active/resource player — whose company is the target — is offered
 * the cancel. The shared `handleGrantActionApply` → `cancel-chain-entry` path
 * negates the most-recent unresolved hazard entry (this card) and returns it to
 * its owner's discard, and the `{ tap: "character" }` cost taps the ranger.
 */
function emitHazardSelfCancelBySkillActions(
  state: GameState,
  playerId: PlayerId,
  company: import('../../index.js').Company,
): EvaluatedAction[] {
  const chain = state.chain;
  if (!chain) return [];
  // Only the active (resource) player, whose company is under attack, may use a
  // character in that company to cancel the hazard before it resolves.
  if (state.activePlayer !== playerId) return [];
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  for (const entry of chain.entries) {
    if (entry.resolved || entry.negated || !entry.card) continue;
    const def = defById(state, entry.card.definitionId);
    const grant = getCardEffects(def).find(
      (e): e is GrantActionEffect =>
        e.type === 'grant-action'
        && e.action === 'cancel-chain-entry'
        && e.apply?.type === 'cancel-chain-entry',
    );
    if (!grant) continue;

    for (const charInstId of company.characters) {
      const char = player.characters[charInstId];
      if (!char || char.status !== CardStatus.Untapped) continue;
      const charDef = defById(state, char.definitionId);
      const actorCtx = {
        actor: {
          status: cardStatusToName(char.status),
          name: charDef && isCharacterCard(charDef) ? charDef.name : '',
          race: charDef && isCharacterCard(charDef) ? charDef.race : '',
          skills: getEffectiveNaturalSkills(state, char, charDef && isCharacterCard(charDef) ? charDef : undefined),
        },
      };
      if (grant.when && !matchesCondition(grant.when, actorCtx)) continue;
      logDetail(`Hazard self-cancel: ${charDef && isCharacterCard(charDef) ? charDef.name : '?'} may tap to cancel "${(def as { name?: string } | undefined)?.name ?? (entry.card.definitionId as string)}" before it resolves`);
      actions.push({
        action: {
          type: 'activate-granted-action',
          player: playerId,
          characterId: charInstId,
          sourceCardId: entry.card.instanceId,
          sourceCardDefinitionId: entry.card.definitionId,
          actionId: 'cancel-chain-entry',
          rollThreshold: 0,
        },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * During chain declaring, the priority player may play short-event cards
 * with `playable-as-resource` (e.g. Twilight) to cancel an environment.
 * Targets include environments in cardsInPlay and unresolved
 * chain entries with the environment keyword.
 */
function playShortEventChainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = state.cardPool[handCard.definitionId] as HazardEventCard | undefined;
    if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') continue;
    if (!hasPlayFlag(def, 'playable-as-resource')) continue;

    // Collect environment targets
    const isEnv = (defId: string): boolean => {
      const d = state.cardPool[defId as CardDefinitionId];
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
      const targetDef = state.cardPool[target.definitionId as CardDefinitionId];
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
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    if (!def || def.cardType !== 'hazard-event') continue;
    const hazDef = def;
    if (hazDef.eventType !== 'short') continue;
    const effects = (hazDef as { effects?: readonly CardEffect[] }).effects ?? [];

    const cancelEffect = effects.find(
      (e): e is OnEventEffect & { apply: import('../../types/effects.js').CancelChainEntryAction } =>
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
      const targetDef = defById(state, entry.card.definitionId);
      const hasSkill = getCardEffects(targetDef).some(
        e => (e as { requiredSkill?: string }).requiredSkill === requiredSkill,
      );
      if (!hasSkill) continue;

      logDetail(`Chain response: ${hazDef.name} can cancel ${(targetDef as { name?: string } | undefined)?.name ?? entry.card.definitionId} (requires ${requiredSkill})`);
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
    const def = defById(state, e.card.definitionId);
    const hasTag = getCardEffects(def).some(
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
    const charData = player.characters[charId];
    if (!charData) continue;
    for (const ally of charData.allies ?? []) {
      const allyDef = defById(state, ally.definitionId);
      const hasCancelEffect = getCardEffects(allyDef).some(
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
 * Great Fissure (ba-61): during a chain, the Balrog player whose company is
 * attacking an opponent's company (CvCC) may play a resource short-event
 * carrying `cancel-chain-attack-cancel` from hand to negate an unresolved chain
 * entry — declared by the opponent — that would cancel that attack (carries a
 * `cancel-attack` effect).
 *
 * Emits one `counter-cancel-attack` action per (hand card, target entry) pair.
 * Only offered to the CvCC attacker whose attacking company contains The Balrog.
 */
function counterCancelAttackChainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const chain = state.chain;
  if (!chain) return [];
  const combat = state.combat;
  if (!combat || !combat.isCvCC || combat.attackSource.type !== 'company-attack') return [];
  // Only the attacking player may counter-cancel a cancel of their own attack.
  if (combat.attackingPlayerId !== playerId) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  // The attack must be by The Balrog's company.
  const attackingCompany = companyById(player.companies, combat.attackSource.attackingCompanyId);
  if (!attackingCompany || !companyContainsBalrogAvatar(state, player, attackingCompany)) return [];

  // Collect unresolved, un-negated chain entries declared by the opponent that
  // carry a cancel-attack effect (the effect that would cancel the attack).
  const cancelEntries: CardInstanceId[] = [];
  for (const e of chain.entries) {
    if (e.resolved || e.negated || !e.card) continue;
    if (e.declaredBy === playerId) continue;
    const def = defById(state, e.card.definitionId);
    if (getCardEffects(def).some(eff => eff.type === 'cancel-attack')) {
      cancelEntries.push(e.card.instanceId);
    }
  }
  if (cancelEntries.length === 0) return [];

  const actions: EvaluatedAction[] = [];
  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    if (!getCardEffects(def).some(e => e.type === 'cancel-chain-attack-cancel')) continue;
    for (const targetInstanceId of cancelEntries) {
      logDetail(`counter-cancel-attack: ${(def as { name?: string }).name ?? (handCard.definitionId as string)} can negate an opponent's cancel-attack on the chain`);
      actions.push({
        action: {
          type: 'counter-cancel-attack',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          targetInstanceId,
        },
        viable: true,
      });
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
  if (state.phaseState.phase === Phase.MovementHazard) {
    if (state.activePlayer !== playerId) return [];
    return heroResourceShortEventActions(state, playerId, 'movement-hazard');
  }
  if (state.phaseState.phase === Phase.Site) {
    return siteInfluenceChainResourceEventActions(state, playerId);
  }
  return [];
}

/**
 * Black Vapour (ba-14): during a combat chain, the attacking (hazard) player
 * may counter an opponent-declared chain entry that would cancel a creature
 * attack of a matching race (Spider). Emits one `counter-cancel-roll` action
 * per (source card, target cancel entry) pair.
 *
 * Sources are the attacker's hand plus any unrevealed on-guard cards on the
 * defending company (the hazard player owns them) that carry a
 * `counter-cancel-attack-roll` effect — the "may be revealed as an on-guard
 * card" clause. Only offered while the attack's race is one the card can
 * counter and at least one opponent cancel-attack entry is unresolved.
 */
function counterCancelRollChainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const chain = state.chain;
  const combat = state.combat;
  if (!chain || !combat) return [];
  // Only the attacking player may counter a cancel of their own attack.
  if (combat.attackingPlayerId !== playerId) return [];
  const attackRace = combat.creatureRace ?? '';

  const player = playerById(state, playerId);
  if (!player) return [];

  // Unresolved, un-negated opponent-declared entries that carry a cancel-attack
  // effect (the effect being countered).
  const cancelEntries: CardInstanceId[] = [];
  for (const e of chain.entries) {
    if (e.resolved || e.negated || !e.card) continue;
    if (e.declaredBy === playerId) continue;
    const def = defById(state, e.card.definitionId);
    if (getCardEffects(def).some(eff => eff.type === 'cancel-attack')) {
      cancelEntries.push(e.card.instanceId);
    }
  }
  if (cancelEntries.length === 0) return [];

  // Candidate source cards: hand + unrevealed on-guard cards on the defender.
  const candidates: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] =
    player.hand.map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId }));
  const defender = playerById(state, combat.defendingPlayerId);
  const defendingCompany = defender ? companyById(defender.companies, combat.companyId) : undefined;
  if (defendingCompany) {
    for (const og of defendingCompany.onGuardCards) {
      if (og.revealed) continue;
      candidates.push({ instanceId: og.instanceId, definitionId: og.definitionId });
    }
  }

  const actions: EvaluatedAction[] = [];
  for (const c of candidates) {
    const def = defById(state, c.definitionId);
    const rollEffect = getCardEffects(def).find(
      (e): e is CounterCancelAttackRollEffect => e.type === 'counter-cancel-attack-roll',
    );
    if (!rollEffect) continue;
    if (!rollEffect.race.includes(attackRace)) {
      logDetail(`counter-cancel-roll: ${(def as { name?: string }).name ?? (c.definitionId as string)} cannot counter a "${attackRace}" attack`);
      continue;
    }
    for (const targetInstanceId of cancelEntries) {
      logDetail(`counter-cancel-roll: ${(def as { name?: string }).name ?? (c.definitionId as string)} may counter cancel entry ${targetInstanceId as string}`);
      actions.push({
        action: { type: 'counter-cancel-roll', player: playerId, cardInstanceId: c.instanceId, targetInstanceId },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * During site-phase chain declaring for an influence-attempt, the player
 * who declared the attempt may play resource short events to boost the
 * influence check (e.g. A Friend or Three, CoE rule 8.3 step 6).
 *
 * The faction card is already in the chain (removed from hand upon declaration),
 * so this is the correct window for boost events.
 */
function siteInfluenceChainResourceEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const chain = state.chain!;
  const infEntry = chain.entries.find(
    e => !e.resolved && !e.negated && e.payload.type === 'influence-attempt',
  );
  if (!infEntry) return [];
  // Only the player who declared the influence attempt may respond with resource events
  if (infEntry.declaredBy !== playerId) return [];
  return heroResourceShortEventActions(state, playerId, 'site');
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

  const resourcePlayer = playerById(state, infEntry.declaredBy)!;
  const company = resourcePlayer.companies[siteState.activeCompanyIndex];
  if (!company) return [];

  const actions: EvaluatedAction[] = [];

  for (const ogCard of company.onGuardCards) {
    if (ogCard.revealed) continue;
    const def = defById(state, ogCard.definitionId);
    if (!def || def.cardType !== 'hazard-event') continue;

    // Per CoE rule 2.V.6, only hazard events that directly affect the
    // company (or an influence check) may be revealed from on-guard.
    // Cards must declare an on-guard-reveal effect with the matching trigger.
    const hasInfluenceTrigger = getCardEffects(def).some(
      (e: { type: string; trigger?: string }) =>
        e.type === 'on-guard-reveal' && e.trigger === 'influence-attempt',
    );
    if (!hasInfluenceTrigger) {
      logDetail(`Chain on-guard reveal: "${def.name}" skipped — no influence-attempt trigger`);
      continue;
    }

    // Character-targeting events get one action per character
    const isCharTargeting = getCardEffects(def).some(
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


