/**
 * @module legal-actions/long-event
 *
 * Legal actions during the long-event phase. The resource player may play
 * resource long-events and resource short-events from hand. At entry, the
 * engine already discarded the resource player's old resource long-events;
 * on pass, hazard long-events belonging to the opponent are discarded
 * automatically.
 *
 * When a resource short-event with interactive DSL effects (e.g.
 * `fetch-to-deck`) is played, the game enters an effect resolution
 * sub-flow driven by {@link GameState.pendingEffects}, which is handled
 * at the top level of {@link computeLegalActions}.
 *
 * Returns {@link EvaluatedAction} entries so the UI can highlight playable
 * cards and show reasons for non-playable ones.
 */

import type { GameState, PlayerId, EvaluatedAction, PlayTargetEffect, CardInstanceId, PlayerState, SitePhaseState } from '../../index.js';
import type { PlayOptionEffect } from '../../types/effects.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { isResourceEventCard, isSiteCard, isAllyCard } from '../../types/cards.js';
import { CardStatus, cardStatusToName } from '../../types/common.js';
import { canCallEndgameNow } from '../../state-utils.js';
import { logHeading, logDetail } from './log.js';
import { notPlayable } from './action-builders.js';
import { getPlayTargetEffect, getPlayOptionEffects, buildPlayOptionContext, buildPlayerStateContext, grantedActionActivations, collectDiscardInPlayTargets, withdrawAgentTargetActions } from './organization.js';
import type { WithdrawAgentEffect } from '../../types/effects.js';
import { findMoveEffectByShape } from '../reducer-move.js';
import { characterEntries, playerById, defById, getCardEffects, countCopiesInPlay, altShortEventReshuffleEffect, playerHasReshuffleMatch, findPlayConditionEffect } from '../reducer-utils.js';
import { buildInPlayNames } from '../recompute-derived.js';

/**
 * Computes the legal actions for the active player during the long-event phase.
 *
 * The resource player (active player) may play resource long-events and
 * resource short-events from hand. Non-event hand cards are annotated as
 * not-playable with a reason. Always includes pass to advance to the
 * Movement/Hazard phase.
 */
export function longEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  logHeading(`Long-event phase: computing actions for ${playerId as string}`);

  // Only the active (resource) player acts during the long-event phase
  if (playerId !== state.activePlayer) {
    logDetail('Not active player — no actions during long-event phase');
    return [];
  }

  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  if (!player) return [{ action: { type: 'pass', player: playerId }, viable: true }];

  // Track which hand cards have been evaluated so we can mark the rest not-playable
  const evaluatedInstances = new Set<string>();

  // Scan hand for resource events (long and short)
  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = defById(state, handCard.definitionId);
    if (!isResourceEventCard(def)) continue;

    if (def.eventType === 'long') {
      evaluatedInstances.add(cardInstanceId as string);

      // Check uniqueness: unique long-events can't be played if already in play
      if (def.unique) {
        const alreadyInPlay = state.players.some(p =>
          p.cardsInPlay.some(c => c.definitionId === def.id),
        );
        if (alreadyInPlay) {
          logDetail(`${def.name}: unique and already in play`);
          actions.push(notPlayable(playerId, cardInstanceId, `${def.name} is unique and already in play`));
          continue;
        }
      }

      // Check duplication-limit with scope "game"
      let blocked = false;
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'duplication-limit' || effect.scope !== 'game') continue;
        const copiesInPlay = countCopiesInPlay(state, def.name);
        if (copiesInPlay >= effect.max) {
          logDetail(`${def.name}: duplication limit reached (${copiesInPlay}/${effect.max})`);
          actions.push(notPlayable(playerId, cardInstanceId, `${def.name} cannot be duplicated`));
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      logDetail(`Resource long-event playable: ${def.name} (${cardInstanceId as string})`);
      actions.push({
        action: { type: 'play-long-event', player: playerId, cardInstanceId },
        viable: true,
      });
    }
  }

  // Enumerate resource short events playable during long-event phase.
  // Rule 2.1.1: resource short-events may be played during any phase of the
  // player's turn unless restricted (e.g. by a play-window DSL effect).
  const shortEventActions = heroResourceShortEventActions(state, playerId, 'long-event');
  for (const ea of shortEventActions) {
    const a = ea.action as unknown as Record<string, unknown>;
    const id = a['cardInstanceId'];
    if (typeof id === 'string') evaluatedInstances.add(id);
  }
  actions.push(...shortEventActions);

  // Mark remaining hand cards as not playable during long-event phase
  for (const handCard of player.hand) {
    if (evaluatedInstances.has(handCard.instanceId as string)) continue;
    actions.push(notPlayable(playerId, handCard.instanceId, 'Only resource events can be played during the long-event phase'));
  }

  // Rule 2.1.1: resource player may activate any-phase grant-actions (e.g. Cram untap-bearer)
  actions.push(...grantedActionActivations(state, playerId, 'anyPhase'));

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  const playableCount = actions.filter(a => a.viable).length - 1; // exclude pass
  logDetail(`Long-event phase: ${playableCount} playable events + pass, ${actions.length - playableCount - 1} not playable`);
  return actions;
}

/**
 * Enumerates resource short events (hero or minion) in the active player's
 * hand that are playable during the given phase. Encodes rule 2.1.1:
 * resource short-events may be played during any phase of the player's
 * turn unless a DSL `play-window` restricts them, they are combat-only,
 * or they require targets that aren't present.
 *
 * Used by the long-event and movement-hazard phase handlers. Returns
 * both viable `play-short-event` actions and `not-playable` annotations
 * (with reasons) for cards that were considered but rejected, so the UI
 * can explain why.
 */
export function heroResourceShortEventActions(
  state: GameState,
  playerId: PlayerId,
  currentPhase: string,
): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const actions: EvaluatedAction[] = [];
  const combatOnlyTypes = new Set(['cancel-attack', 'cancel-chain-attack-cancel', 'cancel-strike', 'halve-strikes', 'strike-modifier', 'flattery-cancel-attack']);
  const inPlayNames = buildInPlayNames(state);

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = defById(state, handCard.definitionId);
    if (!isResourceEventCard(def)) continue;
    // A "Permanent-event/Short-event" card (Great Army of the North ba-38) is a
    // permanent event that also carries an alternative short-event reshuffle
    // mode; admit it here alongside true short events. It is viable only when
    // the reshuffle would actually recycle a matching card from the discard.
    const altReshuffle = altShortEventReshuffleEffect(def);
    if (def.eventType !== 'short' && !altReshuffle) continue;

    // grant-extra-mh-phase resources (Forced March le-185, Bridge tw-202, Leg
    // It Double Quick le-202) are emitted by the movement/hazard-specific
    // `extraMHPhaseResourceActions`, which enforces the "at the end of the
    // movement/hazard phase, on a company moving to the qualifying site" window.
    // Skip them in this generic short-event path so they aren't offered
    // ungated (e.g. during the site phase or against a non-qualifying company).
    if ((def.effects ?? []).some(e => e.type === 'grant-extra-mh-phase')) continue;
    if (def.eventType !== 'short' && altReshuffle) {
      if (!playerHasReshuffleMatch(state, player, altReshuffle)) {
        logDetail(`${def.name}: short-event mode has no matching card in discard — not playable`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: nothing to shuffle from your discard pile`));
        continue;
      }
      logDetail(`${def.name}: playable as alternative short-event (reshuffle from discard)`);
      actions.push({
        action: { type: 'play-short-event', player: playerId, cardInstanceId },
        viable: true,
      });
      continue;
    }

    // Skip cards that declare a play-window restricting them to a
    // different phase/step (e.g. Stealth plays only at end-of-org).
    const playWindow = def.effects?.find(e => e.type === 'play-window') as
      { phase?: string; step?: string; siteTypes?: readonly string[] } | undefined;
    if (playWindow && playWindow.phase !== currentPhase) {
      const where = `${playWindow.phase ?? '?'}${playWindow.step ? '/' + playWindow.step : ''}`;
      logDetail(`${def.name}: play-window restricts it to ${where}, not playable in ${currentPhase} phase`);
      actions.push(notPlayable(playerId, cardInstanceId, `${def.name} can only be played during ${playWindow.phase ?? 'a different phase'}${playWindow.step ? ' (' + playWindow.step + ')' : ''}`));
      continue;
    }

    // When play-window declares a site-type restriction, enforce it against
    // the active company's current site. Only applies during the site phase
    // after a company has been selected (i.e. not the select-company step,
    // where activeCompanyIndex still refers to the previously-handled company).
    if (playWindow?.siteTypes && playWindow.siteTypes.length > 0 && currentPhase === 'site') {
      const siteState = state.phaseState as SitePhaseState | null;
      if (siteState && siteState.step !== 'select-company') {
        const activeCompany = player.companies[siteState.activeCompanyIndex];
        const siteDef = activeCompany?.currentSite
          ? defById(state, activeCompany.currentSite.definitionId)
          : undefined;
        if (siteDef && isSiteCard(siteDef) && !playWindow.siteTypes.includes(siteDef.siteType)) {
          logDetail(`${def.name}: active company at ${siteDef.siteType} (${siteDef.name}), play-window requires [${playWindow.siteTypes.join(', ')}] — not playable`);
          actions.push(notPlayable(playerId, cardInstanceId, `${def.name} can only be played at ${playWindow.siteTypes.join(' or ')}`));
          continue;
        }
      }
    }

    // Withdrawn to Mordor (dm-165): a `withdraw-agent` short event needs a
    // concrete target on the action (a face-up agent or an unrevealed
    // on-guard card) — the reducer rejects a bare play. Mirror the
    // organization/site emitter: enumerate one action per eligible target
    // via the shared helper, or mark not-playable when none exists.
    // Without this, the generic any-phase path offered a target-less play
    // that the reducer refused (offer/validate asymmetry — heuristic
    // self-play decks q/r, seeds 5000/5001).
    const withdrawAgentEffect = def.effects?.find(
      (e): e is WithdrawAgentEffect => e.type === 'withdraw-agent',
    );
    if (withdrawAgentEffect) {
      const targeted = withdrawAgentTargetActions(
        state, playerId, player, cardInstanceId, withdrawAgentEffect,
      );
      if (targeted.length === 0) {
        logDetail(`${def.name}: no face-up agent${withdrawAgentEffect.alternativeDiscardOnGuard ? ' or on-guard card' : ''} to target — not playable`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} has no valid target`));
      } else {
        actions.push(...targeted);
      }
      continue;
    }

    // play-condition requires: "player-state" — a generic DSL condition
    // evaluated against the player's avatar/alignment context. Mirrors the
    // organization-phase path so any-phase and chain-window plays honour the
    // same gate (The Dark Power as-79: "Playable if you are Sauron" via
    // player.playsAsSauron).
    const playerStateCondition = findPlayConditionEffect(def, 'player-state');
    if (playerStateCondition?.condition) {
      if (!matchesCondition(playerStateCondition.condition, buildPlayerStateContext(state, player, playerId))) {
        logDetail(`${def.name}: play-condition player-state not satisfied`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: play conditions not met`));
        continue;
      }
    }

    // Skip short events whose effects are only usable during combat
    // (e.g. Concealment's cancel-attack). These require an active attack.
    // A move (discard-in-play) effect whose `when` gate is not currently met
    // is also treated as absent — e.g. The Cock Crows has a discard mode
    // gated on Gates of Morning being in play.
    // play-target and set-character-status are neutral companions to
    // cancel-attack (e.g. Escape: target an unwounded character, cancel the
    // attack, wound the character). They don't represent independent non-combat
    // effects, so they don't prevent the card from being treated as combat-only.
    // duplication-limit is a companion to company-combat-boost (e.g. The Dwarves
    // Are upon You!) or attack-modifiers (e.g. Not Slay Needlessly): it describes
    // per-attack duplication rules and does not represent an independent non-combat
    // effect.
    const effects = getCardEffects(def);
    const hasCancelAttack = effects.some(e => e.type === 'cancel-attack');
    const hasModifyAttack = effects.some(e => e.type === 'modify-attack');
    const hasCompanyCombatBoost = effects.some(e => e.type === 'company-combat-boost');
    const hasCombatEffect = hasCancelAttack || hasModifyAttack || hasCompanyCombatBoost;
    const allCombatOnly = effects.length > 0 && effects.every(e => {
      if (combatOnlyTypes.has(e.type)) return true;
      if (e.type === 'modify-attack') return true;
      if (e.type === 'company-combat-boost') return true;
      if (e.type === 'move' && e.when && !matchesCondition(e.when, { inPlay: inPlayNames })) return true;
      if (hasCancelAttack && (e.type === 'play-target' || (e.type === 'set-character-status' && e.status === 'inverted'))) return true;
      if (hasCombatEffect && e.type === 'duplication-limit') return true;
      // A play-condition is a gate on playing the card, not an independent
      // non-combat effect — a gated cancel-attack card (Eye Never Sleeping
      // as-82: "Playable if you are Sauron. Cancel one hazard creature
      // attack.") is still combat-only.
      if (hasCombatEffect && e.type === 'play-condition') return true;
      return false;
    });
    if (allCombatOnly) {
      logDetail(`${def.name}: combat-only short-event, not playable outside combat`);
      actions.push(notPlayable(playerId, cardInstanceId, `${def.name} can only be played during combat`));
      continue;
    }

    // Resource-side `call-council` (e.g. Sudden Call, le-235): the caller
    // must meet endgame conditions and must not have already called.
    // Only playable on the caller's own turn, hence in the resource path.
    const resourceCallCouncil = def.effects?.find(
      (e): e is import('../../index.js').CallCouncilEffect => e.type === 'call-council' && e.lastTurnFor === 'opponent',
    );
    if (resourceCallCouncil) {
      if (!canCallEndgameNow(player)) {
        logDetail(`${def.name}: caller has not met end-of-game conditions`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: end-of-game conditions not met`));
        continue;
      }
      if (player.freeCouncilCalled || state.lastTurnFor !== null) {
        logDetail(`${def.name}: endgame already called`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: endgame already called`));
        continue;
      }
      logDetail(`Resource short-event "${def.name}" playable — caller meets end-of-game conditions`);
      actions.push({
        action: { type: 'play-short-event', player: playerId, cardInstanceId },
        viable: true,
      });
      continue;
    }

    // Collect eligible discard-in-play targets up front. Cards with a
    // discard-in-play effect (e.g. Marvels Told) force the discard of an
    // in-play card matching the filter — the player picks which target
    // at play time as part of the play-short-event action. If no valid
    // target exists, the card is not playable. A `when` gate on the effect
    // is also evaluated (e.g. The Cock Crows requires Gates of Morning).
    const discardInPlay = findMoveEffectByShape(def, 'target', 'in-play', 'discard');
    const discardWhenMet = !discardInPlay?.when
      || matchesCondition(discardInPlay.when, { inPlay: inPlayNames });
    let discardTargetIds: CardInstanceId[] | null = null;
    if (discardWhenMet && discardInPlay && discardInPlay.filter) {
      discardTargetIds = collectDiscardInPlayTargets(state, discardInPlay.filter);
      if (discardTargetIds.length === 0) {
        logDetail(`${def.name}: no eligible discard-in-play target — not playable`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} has no valid target to discard`));
        continue;
      }
    }

    // If the card has a play-target with a tap cost (e.g. Marvels Told taps
    // a sage), emit one action per eligible target. Otherwise emit a single
    // action with no target. When a discard-in-play target is also required,
    // emit the cross-product of sage × discard-target.
    const playTarget = getPlayTargetEffect(def);
    const emitPlay = (sageId: CardInstanceId | undefined) => {
      if (discardTargetIds) {
        for (const discardId of discardTargetIds) {
          logDetail(`Resource short-event playable (sage ${String(sageId)}, discard ${String(discardId)}): ${def.name}`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId,
              ...(sageId ? { targetScoutInstanceId: sageId } : {}),
              discardTargetInstanceId: discardId,
            },
            viable: true,
          });
        }
      } else {
        logDetail(`Resource short-event playable${sageId ? ` (target ${String(sageId)})` : ''}: ${def.name}`);
        actions.push({
          action: {
            type: 'play-short-event',
            player: playerId,
            cardInstanceId,
            ...(sageId ? { targetScoutInstanceId: sageId } : {}),
          },
          viable: true,
        });
      }
    };

    // Cards with play-option effects (e.g. Many Turns and Doublings)
    // must go through the option path even when the play-target has a
    // tap cost, so the option's `when` gate is evaluated.
    const playOptions = getPlayOptionEffects(def);
    if (playOptions.length > 0 && playTarget) {
      const optionActions = playOptionActionsForShortEvent(
        state, player, playerId, cardInstanceId, def, playTarget, playOptions, currentPhase,
      );
      if (optionActions.length === 0) {
        logDetail(`${def.name}: no eligible play-option targets — not playable`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} requires a matching character and condition`));
      } else {
        actions.push(...optionActions);
      }
    } else if (playTarget && playTarget.cost?.tap === 'character') {
      const targets = eligibleTapTargets(state, player, playTarget);
      if (targets.length === 0) {
        logDetail(`${def.name}: no eligible targets — not playable`);
        actions.push(notPlayable(playerId, cardInstanceId, `No eligible ${playTarget.target} to target`));
      } else {
        for (const targetId of targets) emitPlay(targetId);
      }
    } else if (playTarget && playTarget.target === 'character') {
      const optionActions = playOptionActionsForShortEvent(
        state, player, playerId, cardInstanceId, def, playTarget, getPlayOptionEffects(def), currentPhase,
      );
      if (optionActions.length === 0) {
        logDetail(`${def.name}: no eligible character targets — not playable`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} requires a matching character`));
      } else {
        actions.push(...optionActions);
      }
    } else {
      emitPlay(undefined);
    }
  }

  return actions;
}

/**
 * Generates `play-short-event` actions for a card with {@link PlayTargetEffect}
 * targeting characters and {@link PlayOptionEffect}s. One action per
 * (target, option) pair whose `when` (if any) matches the target context.
 */
function playOptionActionsForShortEvent(
  state: GameState,
  player: PlayerState,
  playerId: PlayerId,
  cardInstanceId: CardInstanceId,
  def: { name: string },
  playTarget: PlayTargetEffect,
  options: readonly PlayOptionEffect[],
  currentPhase?: string,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const targets = playTarget.cost?.tap === 'character'
    ? eligibleTapTargets(state, player, playTarget)
    : eligibleCharacterTargets(state, player, playTarget);
  const hasTapCost = playTarget.cost?.tap === 'character';
  for (const targetId of targets) {
    const char = player.characters[targetId];
    if (!char) continue;
    const ctx = buildPlayOptionContext(state, char, player, currentPhase);
    if (options.length === 0) {
      logDetail(`${def.name} playable on ${targetId as string} (no options)`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId,
          targetCharacterId: targetId,
          ...(hasTapCost ? { targetScoutInstanceId: targetId } : {}),
        },
        viable: true,
      });
    } else {
      for (const opt of options) {
        if (opt.when && !matchesCondition(opt.when, ctx)) continue;
        logDetail(`${def.name} playable on ${targetId as string}: option "${opt.id}"`);
        actions.push({
          action: {
            type: 'play-short-event',
            player: playerId,
            cardInstanceId,
            targetCharacterId: targetId,
            optionId: opt.id,
            ...(hasTapCost ? { targetScoutInstanceId: targetId } : {}),
          },
          viable: true,
        });
      }
    }
  }
  return actions;
}

/**
 * Returns eligible character IDs for a play-target with character filter.
 * Characters matching the DSL filter condition are eligible. Sage/scout
 * allies that satisfy a skill-only filter are also eligible (rule 2.V.2.2).
 */
function eligibleCharacterTargets(
  state: GameState,
  player: PlayerState,
  playTarget: PlayTargetEffect,
): CardInstanceId[] {
  if (playTarget.target !== 'character') return [];
  const out: CardInstanceId[] = [];
  for (const [charId, char] of characterEntries(player)) {
    if (playTarget.filter
        && !matchesCondition(playTarget.filter, buildPlayOptionContext(state, char, player))) {
      continue;
    }
    out.push(charId);
  }
  out.push(...eligibleSkillAllyTargets(state, player, playTarget, false));
  return out;
}

/**
 * Returns eligible target character IDs for a play-target with tap cost.
 * Only untapped characters matching the filter are eligible. Untapped
 * sage/scout allies that satisfy a skill-only filter are also eligible,
 * since allies count as characters for skill-only cards (rule 2.V.2.2).
 */
function eligibleTapTargets(
  state: GameState,
  player: { characters: Record<string, import('../../index.js').CharacterInPlay> },
  playTarget: PlayTargetEffect,
): CardInstanceId[] {
  if (playTarget.target !== 'character') return [];
  const out: CardInstanceId[] = [];
  for (const [charId, char] of characterEntries(player)) {
    if (char.status !== CardStatus.Untapped) continue;
    if (playTarget.filter
        && !matchesCondition(playTarget.filter, buildPlayOptionContext(state, char, player as PlayerState))) {
      continue;
    }
    out.push(charId);
  }
  out.push(...eligibleSkillAllyTargets(state, player as PlayerState, playTarget, true));
  return out;
}

/**
 * Returns eligible *ally* target IDs for a skill-only play-target.
 *
 * CoE rule 2.V.2.2 (and CRF) treat allies as characters only for "skill
 * only" cards or effects (e.g. fulfilling an active condition that requires
 * a sage). So an ally is offered as a tap/character target only when the
 * play-target's filter actually constrains `target.skills` and the ally —
 * evaluated in its host character's company context but with its own skills
 * and status — satisfies the filter. When `requireUntapped` is true (a tap
 * cost), tapped allies are excluded.
 */
function eligibleSkillAllyTargets(
  state: GameState,
  player: PlayerState,
  playTarget: PlayTargetEffect,
  requireUntapped: boolean,
): CardInstanceId[] {
  if (playTarget.target !== 'character') return [];
  if (!playTarget.filter || !filterReferencesSkills(playTarget.filter)) return [];
  const out: CardInstanceId[] = [];
  for (const [, char] of characterEntries(player)) {
    if (char.allies.length === 0) continue;
    const hostCtx = buildPlayOptionContext(state, char, player);
    for (const ally of char.allies) {
      if (requireUntapped && ally.status !== CardStatus.Untapped) continue;
      const allyDef = defById(state, ally.definitionId);
      if (!allyDef || !isAllyCard(allyDef)) continue;
      const ctx = buildAllyTargetContext(hostCtx, allyDef, ally.status);
      if (!matchesCondition(playTarget.filter, ctx)) continue;
      out.push(ally.instanceId);
    }
  }
  return out;
}

/**
 * Builds a play-target filter context for an ally, reusing its host
 * character's company/player context but overriding the `target` fields
 * with the ally's own skills and status (the only attributes a skill-only
 * filter inspects). Items/allies borne by an ally are always empty.
 */
function buildAllyTargetContext(
  hostCtx: Record<string, unknown>,
  allyDef: import('../../index.js').AllyCard,
  status: CardStatus,
): Record<string, unknown> {
  const baseTarget = (hostCtx.target as Record<string, unknown> | undefined) ?? {};
  return {
    ...hostCtx,
    target: {
      ...baseTarget,
      skills: [...(allyDef.skills ?? [])],
      status: cardStatusToName(status),
      name: allyDef.name,
      mind: allyDef.mind,
      itemNames: [],
      allyNames: [],
    },
  };
}

/**
 * True if a play-target filter constrains `target.skills` anywhere in its
 * (possibly nested `$and`/`$or`) structure. Gates whether allies may be
 * offered as targets — they count as characters only for skill-only cards.
 */
function filterReferencesSkills(filter: unknown): boolean {
  if (Array.isArray(filter)) return filter.some(filterReferencesSkills);
  if (filter && typeof filter === 'object') {
    for (const [key, value] of Object.entries(filter)) {
      if (key === 'target.skills') return true;
      if (filterReferencesSkills(value)) return true;
    }
  }
  return false;
}
