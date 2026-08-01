/**
 * @module combat-finalize
 *
 * The terminal half of a combat: `finalizeCombat` (the ~780-line routine that
 * tears a finished attack down — resolves trophies, body checks, wounds,
 * eliminations, post-attack triggers, haven-jump restoration and combat-state
 * cleanup) together with its private closure: `applyPostAttackEffects`,
 * `restoreHavenJumpOrigins`, `buildOnEventContext`, `discardWoundedItems`,
 * `discardWoundedCharacters`, `recordHazardEncountered`, the Rule 8.22
 * trophy-decision helper `applyRule8_22AfterTrophyDecision`, and the
 * triggered-discard helper `discardCardTriggeredCard`.
 *
 * Extracted wholesale from `reducer-combat.ts`. This set is the full transitive
 * closure of `finalizeCombat` over combat-local calls and is provably closed
 * (it calls no other `reducer-combat` function), so relocating it shrinks the
 * combat god-module without forming a cycle: `reducer-combat` imports the four
 * entry points (`finalizeCombat`, `applyRule8_22AfterTrophyDecision`,
 * `recordHazardEncountered`, `discardCardTriggeredCard`) one-way from here, and
 * this module imports only shared leaves plus `getAttackSourceCard` from
 * `combat-hazard-play` (also one-way).
 *
 * Pure relocation: the logic is unchanged from its previous home.
 */

import type { GameState, CombatState, GameEffect, CardInstanceId, CardDefinitionId } from '../index.js';
import type { PlayerState } from '../types/state-player.js';
import type { ReducerResult } from './reducer-utils.js';
import type { MovementHazardPhaseState } from '../types/state-phases.js';
import type { TriggerAttackOnPlayEffect } from '../types/effects.js';
import { shuffle } from '../rng.js';
import { getPlayerIndex } from '../state-utils.js';
import { findCapturingPressGang, capturePressGang } from './press-gang.js';
import { findEliminateInsteadOfDiscardHost, consumeEliminateInsteadOfDiscardHost } from './eliminate-instead-of-discard.js';
import { isSiteCard, isCharacterCard, isHalfOrc } from '../types/cards.js';
import { CardStatus, Alignment, Race } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { getActiveAutoAttacks } from './manifestations.js';
import { matchesCondition, matchesContext } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { resolveInstanceId } from '../types/state.js';
import { enqueueDiscardSubstituteOffer } from './discard-substitute.js';
import { attackSourceCreatureInstanceId, makeCombatState, resolveAttackerChoosesDefenders, cardName, cleanupEmptyCompanies, clonePlayers, companyById, companySubphaseScope, defById, findById, getCardEffects, getOnEventEffects, isSelfDiscardMove, matchesDefinition, nextCompanyId, partitionLeavingAllies, playerConvertsDetainmentToNormal, playerHasKillMpExemption, ringwraithReclaimMark, sweepLeaderLeavesCompanyEvents, toCardInstance, updateCharacter, updatePlayer } from './reducer-utils.js';
import { resolveAttackProwess, resolveAttackStrikes, resolveAttackBody, normalizeCreatureRace, resolveDef, enemyRaceContext } from './effects/index.js';
import { isDetainmentAttack } from './detainment.js';
import { buildInPlayNames } from './recompute-derived.js';
import { enqueueCorruptionCheck, addConstraint, enqueueResolution, sweepExpired, removeConstraint } from './pending.js';
import { getAttackSourceCard } from './combat-hazard-play.js';
import { advanceGreatHuntReveal } from './great-hunt.js';

export function discardCardTriggeredCard(
  state: GameState,
  cardInstanceId: import('../index.js').CardInstanceId,
  defPlayerIdx: number,
): GameState {
  const newPlayers: [import('../index.js').PlayerState, import('../index.js').PlayerState] = [
    state.players[0],
    state.players[1],
  ];
  for (let pi = 0; pi < 2; pi++) {
    const inPlay = findById(newPlayers[pi].cardsInPlay, cardInstanceId);
    if (inPlay) {
      newPlayers[pi] = {
        ...newPlayers[pi],
        cardsInPlay: newPlayers[pi].cardsInPlay.filter(c => c.instanceId !== cardInstanceId),
      };
      newPlayers[defPlayerIdx] = {
        ...newPlayers[defPlayerIdx],
        discardPile: [
          ...newPlayers[defPlayerIdx].discardPile,
          toCardInstance(inPlay),
        ],
      };
      return { ...state, players: newPlayers };
    }
  }
  return state;
}

/**
 * Advance a `card-triggered-attack` (Rescue Prisoners, Burning Rick, Cot, and
 * Tree, …) once its current attack has ended — whether it resolved normally or
 * was cancelled. Returns `state` untouched for every other attack source.
 *
 * The card sits in `cardsInPlay` for the duration of the attack, so something
 * must always happen to it here:
 *
 * - **More queued attacks** (multi-attack form of `trigger-attack-on-play`) —
 *   build the next combat immediately, carrying the remaining queue forward.
 * - **Last attack, no untapped characters left** — the card is discarded.
 * - **Last attack, untapped characters remain** — queue a `select-card-bearer`
 *   resolution so the defender chooses who taps to take the card. The card's
 *   `trigger-attack-on-play` effect supplies the post-attack mode and the
 *   faction-disposal flags.
 *
 * A cancelled attack takes the identical path — the attack simply never dealt
 * strikes — so both {@link finalizeCombat} and the cancel path call this.
 * `cancelled` only distinguishes the log lines.
 */
export function continueOrDisposeCardTriggeredAttack(
  state: GameState,
  combat: CombatState,
  cancelled: boolean,
): GameState {
  if (combat.attackSource.type !== 'card-triggered-attack') return state;
  const { cardInstanceId, remainingAttacks } = combat.attackSource;
  const label = cancelled ? 'Card-auto-attack cancelled' : 'Card-auto-attack';
  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const cardDefId = resolveInstanceId(state, cardInstanceId);
  const cardLabel = cardDefId ? cardName(state, cardDefId, '?') : '?';

  if (remainingAttacks && remainingAttacks.length > 0) {
    // More attacks remain — trigger the next one immediately
    const next = remainingAttacks[0];
    const rest = remainingAttacks.slice(1);
    const defPlayer = state.players[defIdx];
    const atkPlayer = state.players[1 - defIdx];
    const inPlayNames = buildInPlayNames(state);
    const creatureRace = normalizeCreatureRace(next.creatureType);
    const effectiveProwess = resolveAttackProwess(
      state, next.prowess, inPlayNames, creatureRace, true, undefined,
      { companyId: combat.companyId },
    );
    const effectiveStrikes = resolveAttackStrikes(
      state, next.strikes, inPlayNames, creatureRace, true, { companyId: combat.companyId },
    );
    logDetail(
      `${label}: "${cardLabel}" triggering next attack — ${next.creatureType} ` +
      `(${effectiveStrikes} strikes, ${effectiveProwess} prowess)` +
      (rest.length > 0 ? `; ${rest.length} more after this` : ''),
    );
    const nextCombat: CombatState = makeCombatState({
      attackSource: {
        type: 'card-triggered-attack',
        cardInstanceId,
        ...(rest.length > 0 ? { remainingAttacks: rest } : {}),
      },
      companyId: combat.companyId,
      defendingPlayerId: defPlayer.id,
      attackingPlayerId: atkPlayer.id,
      strikesTotal: effectiveStrikes,
      strikeProwess: effectiveProwess,
      creatureBody: null,
      creatureRace,
      assignmentPhase: 'defender',
      detainment: false,
    });
    return { ...state, combat: nextCombat };
  }

  // Final (or only) attack — check for untapped characters
  const defPlayer = state.players[defIdx];
  const company = companyById(defPlayer.companies, combat.companyId);
  const anyUntapped = company
    ? company.characters.some(charId => {
        const ch = defPlayer.characters[charId];
        return ch && ch.status === CardStatus.Untapped;
      })
    : false;

  if (!anyUntapped) {
    // No untapped characters — discard the card from cardsInPlay
    logDetail(`${label}: no untapped characters — discarding "${cardLabel}" from cardsInPlay`);
    return discardCardTriggeredCard(state, cardInstanceId, defIdx);
  }

  // Untapped characters remain — queue bearer selection for the resource player.
  // The card definition supplies the post-attack mode and faction-discard flags.
  const cardDef = cardDefId ? defById(state, cardDefId) : undefined;
  const triggerEffect = cardDef
    ? (getCardEffects(cardDef).find(
        (e): e is TriggerAttackOnPlayEffect => e.type === 'trigger-attack-on-play',
      ) ?? null)
    : null;
  const afterAttack = triggerEffect?.afterAttack ?? 'attach-with-constraint';
  const discardFactionsAtSite = triggerEffect?.discardFactionsAtSite ?? false;
  const returnFactionsAtSite = triggerEffect?.returnFactionsAtSite ?? false;
  const discardUniqueFactionsAtSite = triggerEffect?.discardUniqueFactionsAtSite ?? false;
  logDetail(
    `${label}: untapped characters remain — queuing select-card-bearer for "${cardLabel}" ` +
    `(company ${combat.companyId as string}, mode: ${afterAttack})`,
  );
  return enqueueResolution(state, {
    source: cardInstanceId,
    actor: combat.defendingPlayerId,
    scope: { kind: 'phase', phase: state.phaseState.phase },
    kind: {
      type: 'select-card-bearer',
      cardInstanceId,
      companyId: combat.companyId,
      ...(afterAttack !== 'attach-with-constraint' ? { mode: afterAttack } : {}),
      ...(discardFactionsAtSite ? { discardFactionsAtSite: true } : {}),
      ...(returnFactionsAtSite ? { returnFactionsAtSite: true } : {}),
      ...(discardUniqueFactionsAtSite ? { discardUniqueFactionsAtSite: true } : {}),
    },
  });
}

/**
 * My Precious (dm-29) `agent-attack-outcome` post-effects, applied when his
 * agent attack finalizes:
 *   - Successful attack (a defender wounded/eliminated) against a company that
 *     holds a ring (a `gold-ring` item): discard My Precious and enqueue a
 *     `force-discard-card` so the attacker chooses one ring to discard.
 *   - Failed attack (no wound), agent survives: enqueue an
 *     `agent-play-manifestation-offer` so the defender may tap a character to
 *     play Gollum from hand (discarding My Precious), or pass.
 */
function applyAgentAttackOutcome(state: GameState, combat: CombatState): GameState {
  if (combat.attackSource.type !== 'agent') return state;
  const agentInstId = combat.attackSource.instanceId;
  const hazardIdx = getPlayerIndex(state, combat.attackingPlayerId);
  const agent = state.players[hazardIdx].agents.find(a => a.character.instanceId === agentInstId);
  if (!agent) return state;
  const agentDef = defById(state, agent.character.definitionId);
  const outcome = getCardEffects(agentDef).find(e => e.type === 'agent-attack-outcome');
  if (!outcome) return state;

  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defIdx];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company) return state;

  const attackSucceeded = combat.strikeAssignments.some(a => a.result === 'wounded' || a.result === 'eliminated');

  if (attackSucceeded && outcome.onSuccessVsRing) {
    const ringIds: CardInstanceId[] = [];
    for (const charId of company.characters) {
      const ch = defPlayer.characters[charId];
      if (!ch) continue;
      for (const item of ch.items) {
        const itemDef = defById(state, item.definitionId);
        if (itemDef && (itemDef as { subtype?: string }).subtype === 'gold-ring') ringIds.push(item.instanceId);
      }
    }
    if (ringIds.length === 0) return state;
    logDetail(`My Precious: successful attack vs a company with a ring → discarded; attacker chooses a ring to discard`);
    let next = updatePlayer(state, hazardIdx, p => ({
      ...p,
      agents: p.agents.filter(a => a.character.instanceId !== agentInstId),
      discardPile: [...p.discardPile, toCardInstance(agent.character)],
      siteDeck: [...p.siteDeck, ...agent.siteStack],
    }));
    next = enqueueResolution(next, {
      source: null,
      actor: combat.attackingPlayerId,
      scope: companySubphaseScope(state.phaseState.phase, combat.companyId),
      kind: { type: 'force-discard-card', candidateInstanceIds: ringIds, sourceDefinitionId: agent.character.definitionId },
    });
    return next;
  }

  if (!attackSucceeded && outcome.onFailSurvive) {
    const manifestName = outcome.manifestationCardName ?? '';
    const hasManifestation = defPlayer.hand.some(c => {
      const d = defById(state, c.definitionId);
      return d !== undefined && (d as { name?: string }).name === manifestName;
    });
    const hasUntappedChar = company.characters.some(cid => defPlayer.characters[cid]?.status === CardStatus.Untapped);
    if (!hasManifestation || !hasUntappedChar) return state;
    logDetail(`My Precious: failed attack, survives → defender may play ${manifestName} to discard him`);
    return enqueueResolution(state, {
      source: null,
      actor: combat.defendingPlayerId,
      scope: companySubphaseScope(state.phaseState.phase, combat.companyId),
      kind: { type: 'agent-play-manifestation-offer', companyId: combat.companyId, agentId: agent.id, manifestationCardName: manifestName },
    });
  }
  return state;
}

/**
 * Apply CoE rule 8.22 after the trophy decision is resolved (either no eligible
 * characters or player declined). Checks the creature in the defender's kill pile
 * and moves it to out-of-play if the alignment doesn't match the creature's starred status.
 *
 * - Hero/FW: starred creatures → out-of-play
 * - Minion/Balrog: non-starred creatures → out-of-play
 */
export function applyRule8_22AfterTrophyDecision(state: GameState, combat: CombatState): GameState {
  const creatureInstanceId = attackSourceCreatureInstanceId(combat);
  if (!creatureInstanceId || combat.detainment) return state;

  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defIdx];
  const creatureInKill = defPlayer.killPile.find(c => c.instanceId === creatureInstanceId);
  if (!creatureInKill) return state;

  const creatureDef = resolveDef(state, creatureInstanceId) as { starredKillMarshallingPoints?: boolean } | undefined;
  const isStarred = creatureDef?.starredKillMarshallingPoints === true;
  const defAlignment = defPlayer.alignment;
  const defIsMinion = defAlignment === Alignment.Ringwraith || defAlignment === Alignment.Balrog;
  const worthMP = defIsMinion ? isStarred : !isStarred;

  if (!worthMP) {
    logDetail(`Rule 8.22: moving ${isStarred ? 'starred' : 'non-starred'} creature from kill pile to out-of-play for ${defAlignment} defender`);
    const newPlayers = clonePlayers(state);
    newPlayers[defIdx] = {
      ...newPlayers[defIdx],
      killPile: newPlayers[defIdx].killPile.filter(c => c.instanceId !== creatureInstanceId),
      outOfPlayPile: [...newPlayers[defIdx].outOfPlayPile, creatureInKill],
    };
    return { ...state, players: [newPlayers[0], newPlayers[1]] as unknown as typeof state.players };
  }
  return state;
}

export function finalizeCombat(state: GameState, effects: GameEffect[] = []): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No combat to finalize' };

  // 'absorbed' strikes (Sable Shield) do not count as defeating the creature —
  // the attacker won the roll but the wound was intercepted by the item.
  const allDefeated = combat.strikeAssignments.length > 0
    && combat.strikeAssignments.every(a => a.result === 'success');

  const newPlayers = clonePlayers(state);

  // Creature attacks (M/H or on-guard): the creature card is in the
  // attacker's cardsInPlay during combat. After combat it moves to:
  // - defender's kill pile (all strikes defeated) for marshalling points
  // - attacker's discard pile (any strike not defeated)
  //
  // Played-auto-attacks (site `dynamic-auto-attack` effect, e.g. Framsburg
  // td-175) are a special case: the creature is "treated in all ways as
  // the site's automatic-attack", which means it is discarded after
  // combat regardless of outcome — the resource player does NOT gain
  // kill-MP, mirroring standard auto-attacks.
  const creatureInstanceId = attackSourceCreatureInstanceId(combat);
  const isPlayedAutoAttack = combat.attackSource.type === 'played-auto-attack';

  if (creatureInstanceId) {
    const atkIdx = getPlayerIndex(state, combat.attackingPlayerId);
    const defIdx = getPlayerIndex(state, combat.defendingPlayerId);

    // Remove creature from attacker's cardsInPlay
    const creatureInPlay = findById(newPlayers[atkIdx].cardsInPlay, creatureInstanceId);
    const creatureCard = creatureInPlay
      ? toCardInstance(creatureInPlay)
      : undefined;
    newPlayers[atkIdx] = {
      ...newPlayers[atkIdx],
      cardsInPlay: newPlayers[atkIdx].cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
    };

    if (isPlayedAutoAttack && creatureCard) {
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        discardPile: [...newPlayers[atkIdx].discardPile, creatureCard],
      };
      logDetail(`Played-auto-attack creature discarded (no kill-MP awarded — treated as site's automatic-attack)`);
    } else if (allDefeated && creatureCard && combat.detainment && !playerHasKillMpExemption(state, state.players[defIdx])) {
      // CoE rule 3.II.3 — defeated detainment creature is discarded instead
      // of going to the attacked player's MP pile (0 kill-MP awarded).
      // Exception: a player with a `fw-kill-mp-full` carrier (Alatar wh-1)
      // gains full kill MP "even with *" (detainment), so his defeated
      // detainment creatures are routed to the kill pile like normal kills.
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        discardPile: [...newPlayers[atkIdx].discardPile, creatureCard],
      };
      logDetail(`All strikes defeated (detainment) — creature discarded instead of kill pile (§3.II.3)`);
    } else if (allDefeated && creatureCard) {
      // Always move to kill pile initially. Rule 8.22 routing (kill pile vs out-of-play)
      // is applied after the trophy-offer decision to avoid race with trophy code.
      newPlayers[defIdx] = {
        ...newPlayers[defIdx],
        killPile: [...newPlayers[defIdx].killPile, creatureCard],
      };
      logDetail(`All strikes defeated — creature moved to defender's kill pile`);
    } else if (creatureCard) {
      newPlayers[atkIdx] = {
        ...newPlayers[atkIdx],
        discardPile: [...newPlayers[atkIdx].discardPile, creatureCard],
      };
      logDetail(`Combat ended — creature moved to attacker's discard`);
    }
  }

  // AS-39 Summons from Long Sleep: if the attacking creature was played from a
  // reserved slot (reservingCardInstanceId present), discard the AS-39 card after combat.
  if (combat.attackSource.type === 'creature' && combat.attackSource.reservingCardInstanceId) {
    const reservingId = combat.attackSource.reservingCardInstanceId;
    const atkIdx2 = getPlayerIndex(state, combat.attackingPlayerId);
    const reservingCard = newPlayers[atkIdx2].cardsInPlay.find(c => c.instanceId === reservingId);
    if (reservingCard) {
      const reservingName = cardName(state, reservingCard.definitionId, '?');
      logDetail(`AS-39 Summons from Long Sleep: creature played from reserved slot — discarding "${reservingName}" after combat`);
      newPlayers[atkIdx2] = {
        ...newPlayers[atkIdx2],
        cardsInPlay: newPlayers[atkIdx2].cardsInPlay.filter(c => c.instanceId !== reservingId),
        reservedCreatures: newPlayers[atkIdx2].reservedCreatures.filter(r => r.sourceCardInstanceId !== reservingId),
        discardPile: [...newPlayers[atkIdx2].discardPile, toCardInstance(reservingCard)],
      };
    } else {
      logDetail(`AS-39 Summons from Long Sleep: reserving card ${reservingId as string} already removed`);
    }
  }

  logDetail('Combat finalized — returning to enclosing phase');

  // Check for on-event: character-wounded-by-self effects on the attack source.
  // If any characters were wounded (not eliminated) and the attack source card
  // has this effect, enqueue a pending corruption-check resolution per
  // wounded character via the unified pending-resolution system.
  //
  // Under detainment (CoE rule 3.II.1.1), successful strikes tap rather than
  // wound — the character "is not considered to have been wounded and
  // passive conditions that depend on a character being wounded are not
  // initiated". Skip the on-wounded trigger entirely.
  let stateAfterCombat: GameState = { ...state, players: newPlayers, combat: null };
  const woundedCharIds = combat.detainment
    ? []
    : combat.strikeAssignments
        .filter(a => a.result === 'wounded')
        .map(a => a.characterId);

  // Combatants whose strike *succeeded* — CoE 3.iv.5: "the strike is successful.
  // The defending character is immediately wounded (which is considered
  // synonymous with the strike succeeding) … and then the hazard player
  // initiates a body check against the character". The wound therefore happens
  // before, and independently of, the body check, so a combatant that is
  // subsequently eliminated (or discarded) by that body check still *became
  // wounded*. `woundedCharIds` above only holds combatants still wounded once
  // combat finished; triggers that fire on the wound itself must use this
  // wider set. `'eliminated'` is only ever recorded after a genuine wound
  // (failed body check, `discardBodyCheck` match, or `wound-eliminates`), so no
  // unwounded combatant leaks in. Detainment strikes tap instead of wounding
  // (CoE 3.II.1.1) and are excluded.
  const struckCharIds = combat.detainment
    ? []
    : combat.strikeAssignments
        .filter(a => a.result === 'wounded' || a.result === 'eliminated')
        .map(a => a.characterId);

  if (
    woundedCharIds.length > 0 &&
    (state.phaseState.phase === Phase.Site || state.phaseState.phase === Phase.MovementHazard)
  ) {
    const sourceCard = getAttackSourceCard(state, combat);
    const sourceName = (sourceCard as { name?: string } | undefined)?.name ?? 'Wound';
    const woundEvents = getOnEventEffects(sourceCard, 'character-wounded-by-self');
    for (const woundEvent of woundEvents) {
      const conditionContext = buildOnEventContext(state);
      if (woundEvent.when && !matchesCondition(woundEvent.when, conditionContext)) {
        logDetail(`On-event condition not met for ${sourceName} — skipping`);
        continue;
      }

      if (woundEvent.apply.type === 'force-check') {
        const modifier = woundEvent.apply.modifier ?? 0;
        const actor = combat.defendingPlayerId;
        const actorIndex = getPlayerIndex(stateAfterCombat, actor);
        const phaseStateActive = state.phaseState as { activeCompanyIndex: number };
        const company = stateAfterCombat.players[actorIndex].companies[phaseStateActive.activeCompanyIndex];
        const companyId = company?.id;
        logDetail(`Wound corruption checks queued for ${woundedCharIds.length} character(s) (${sourceName}, modifier ${modifier})`);
        if (companyId) {
          const scope = companySubphaseScope(state.phaseState.phase, companyId);
          const source = combat.attackSource.type === 'creature' ? combat.attackSource.instanceId : null;
          for (const characterId of woundedCharIds) {
            stateAfterCombat = enqueueCorruptionCheck(stateAfterCombat, {
              source,
              actor,
              scope,
              characterId,
              modifier,
              reason: sourceName,
            });
          }
        }
      } else if (
        woundEvent.apply.type === 'move'
        && woundEvent.apply.select === 'filter-all'
        && woundEvent.apply.from === 'items-on-wounded'
        && woundEvent.apply.to === 'discard'
      ) {
        const filter = woundEvent.apply.filter;
        stateAfterCombat = discardWoundedItems(stateAfterCombat, combat, woundedCharIds, sourceName, filter);
      } else if (woundEvent.apply.type === 'force-discard-one-company-item') {
        // Brigands: fires once per attack (not per wound). Company must discard one item.
        // Were-worm (td-80) sets chooser: 'attacker' — "of attacker's choice" — and has
        // only one strike, so "once per attack" and "once per wound" coincide for it.
        const actor = woundEvent.apply.chooser === 'attacker' ? combat.attackingPlayerId : combat.defendingPlayerId;
        const companyId = combat.companyId;
        const defendingIndex = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
        const defPlayer = stateAfterCombat.players[defendingIndex];
        const company = companyById(defPlayer?.companies ?? [], companyId);
        const hasItems = (company?.characters ?? []).some(charId => {
          const ch = defPlayer.characters[charId];
          return ch && ch.items.length > 0;
        });
        if (hasItems) {
          const scope = companySubphaseScope(state.phaseState.phase, companyId);
          const source = combat.attackSource.type === 'creature' ? combat.attackSource.instanceId : null;
          logDetail(`${sourceName}: wound triggers discard-one-company-item for company ${companyId as string}`);
          stateAfterCombat = enqueueResolution(stateAfterCombat, {
            source,
            actor,
            scope,
            kind: { type: 'discard-one-company-item', companyId },
          });
        } else {
          logDetail(`${sourceName}: discard-one-company-item triggered but company has no items — skipping`);
        }
      } else if (woundEvent.apply.type === 'discard-character') {
        stateAfterCombat = discardWoundedCharacters(stateAfterCombat, combat, woundedCharIds, sourceName, woundEvent.when);
      }
    }
  }

  // My Precious (dm-29): agent-attack-outcome post-effects — success vs a ring
  // discards him + a ring; a failed-but-survived attack offers the defender the
  // Gollum play. Runs for agent attacks in either the Site or M/H phase.
  if (
    combat.attackSource.type === 'agent' &&
    (state.phaseState.phase === Phase.Site || state.phaseState.phase === Phase.MovementHazard)
  ) {
    stateAfterCombat = applyAgentAttackOutcome(stateAfterCombat, combat);
  }

  // Check for on-event: company-member-wounded effects on characters' attached
  // hazard events. When any characters were wounded, scan every character in
  // the defending company for attached hazards carrying this event; for each
  // match, enqueue a corruption check on the bearer (the character bearing the
  // hazard, not necessarily the wounded character). Used by Despair of the Heart.
  //
  // Gated on `struckCharIds`, not `woundedCharIds`: the trigger is the wound
  // itself, which precedes the body check (CRF 22, Despair of the Heart: "the
  // corruption check occurs before the body check"). A company member wounded
  // and then eliminated by its body check still fired this trigger.
  if (
    struckCharIds.length > 0 &&
    (state.phaseState.phase === Phase.Site || state.phaseState.phase === Phase.MovementHazard)
  ) {
    const defPlayerIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
    const defPlayer = stateAfterCombat.players[defPlayerIdx];
    const company = companyById(defPlayer?.companies ?? [], combat.companyId);
    if (company) {
      const scope = companySubphaseScope(state.phaseState.phase, company.id);
      for (const bearerInstId of company.characters) {
        const bearer = defPlayer.characters[bearerInstId];
        if (!bearer) continue;
        for (const hazard of bearer.hazards) {
          const hazardDef = defById(stateAfterCombat, hazard.definitionId);
          if (!hazardDef) continue;
          const companyMemberWoundedEvents = getOnEventEffects(hazardDef, 'company-member-wounded');
          for (const evt of companyMemberWoundedEvents) {
            if (evt.apply.type === 'force-check') {
              const modifier = evt.apply.modifier ?? 0;
              const hazardName = hazardDef.name ?? hazard.definitionId as string;
              logDetail(`Company-member-wounded: ${hazardName} triggers corruption check on bearer ${bearerInstId as string} (modifier ${modifier})`);
              stateAfterCombat = enqueueCorruptionCheck(stateAfterCombat, {
                source: hazard.instanceId,
                actor: combat.defendingPlayerId,
                scope,
                characterId: bearerInstId,
                modifier,
                reason: hazardName,
              });
            }
          }
        }
      }
    }
  }

  // Check for on-event: bearer-wounded effects on cards attached to wounded characters.
  // When any characters are wounded (not eliminated), scan each wounded character's
  // attached allies AND items/permanent-events for this event. If a card has
  // bearer-wounded → self-discard move, discard it to the defending player's pile.
  // Used by Regiment of Black Crows (as-76) and Great Bats (as-74) — attached allies;
  // and Await the Advent of Allies (dm-117) — an attached permanent-event stored in
  // the host character's `items` ("Discard this card when the character … becomes
  // wounded").
  if (woundedCharIds.length > 0) {
    const defPlayerIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
    let defPlayer = stateAfterCombat.players[defPlayerIdx];
    let anyDiscarded = false;
    for (const charId of woundedCharIds) {
      const charData = defPlayer.characters[charId];
      if (!charData) continue;
      const alliesToDiscard: (typeof charData.allies)[number][] = [];
      for (const ally of charData.allies) {
        const allyDef = defById(stateAfterCombat, ally.definitionId);
        const bearerWoundedEvents = getOnEventEffects(allyDef, 'bearer-wounded');
        if (bearerWoundedEvents.some(e => isSelfDiscardMove(e.apply))) {
          const allyName = allyDef?.name ?? (ally.definitionId as string);
          logDetail(`bearer-wounded: discarding ally "${allyName}" from wounded character ${charId as string}`);
          alliesToDiscard.push(ally);
          anyDiscarded = true;
        }
      }
      const itemsToDiscard: (typeof charData.items)[number][] = [];
      for (const item of charData.items) {
        const itemDef = defById(stateAfterCombat, item.definitionId);
        const bearerWoundedEvents = getOnEventEffects(itemDef, 'bearer-wounded');
        if (bearerWoundedEvents.some(e => isSelfDiscardMove(e.apply))) {
          const itemName = itemDef?.name ?? (item.definitionId as string);
          logDetail(`bearer-wounded: discarding attached card "${itemName}" from wounded character ${charId as string}`);
          itemsToDiscard.push(item);
          anyDiscarded = true;
        }
      }
      if (alliesToDiscard.length > 0 || itemsToDiscard.length > 0) {
        const remainingAllies = charData.allies.filter(a => !alliesToDiscard.some(d => d.instanceId === a.instanceId));
        const remainingItems = charData.items.filter(i => !itemsToDiscard.some(d => d.instanceId === i.instanceId));
        const newDiscard = [
          ...defPlayer.discardPile,
          ...alliesToDiscard.map(a => toCardInstance(a)),
          ...itemsToDiscard.map(i => toCardInstance(i)),
        ];
        defPlayer = {
          ...defPlayer,
          characters: {
            ...defPlayer.characters,
            [charId as string]: { ...charData, allies: remainingAllies, items: remainingItems },
          },
          discardPile: newDiscard,
        };
      }
    }
    if (anyDiscarded) {
      stateAfterCombat = updatePlayer(stateAfterCombat, defPlayerIdx, () => defPlayer);
    }
  }

  // LE-140 Stay Her Appetite: if the detainment attack was not fully defeated,
  // the ally that triggered the attack is discarded.
  if (combat.attackSource.type === 'stay-her-appetite-attack' && !allDefeated) {
    const { allyInstanceId, allyOwnerPlayerIndex, hostCharacterInstanceId } = combat.attackSource;
    stateAfterCombat = updatePlayer(stateAfterCombat, allyOwnerPlayerIndex, p => {
      const hostChar = p.characters[hostCharacterInstanceId];
      if (!hostChar) {
        logDetail(`LE-140 Stay Her Appetite: host character ${hostCharacterInstanceId as string} not found — cannot discard ally`);
        return p;
      }
      const ally = hostChar.allies.find(a => a.instanceId === allyInstanceId);
      if (!ally) {
        logDetail(`LE-140 Stay Her Appetite: ally ${allyInstanceId as string} not on host character — already discarded?`);
        return p;
      }
      const allyName = cardName(stateAfterCombat, ally.definitionId, '?');
      logDetail(`LE-140 Stay Her Appetite: attack not defeated — discarding ally "${allyName}"`);
      return {
        ...p,
        characters: {
          ...p.characters,
          [hostCharacterInstanceId as string]: {
            ...hostChar,
            allies: hostChar.allies.filter(a => a.instanceId !== allyInstanceId),
          },
        },
        discardPile: [...p.discardPile, toCardInstance(ally)],
      };
    });
  }

  // Check for on-event: attack-not-defeated effects on the attack source.
  // If the attack was NOT fully defeated and the creature card carries this
  // event, apply its constraint to the defending company.
  if (!allDefeated) {
    const sourceCardForNotDefeated = getAttackSourceCard(state, combat);
    const notDefeatedEvents = getOnEventEffects(sourceCardForNotDefeated, 'attack-not-defeated');
    for (const nde of notDefeatedEvents) {
      if (nde.apply.type === 'add-constraint' && nde.apply.constraint === 'deny-scout-resources') {
        const creatureSource = attackSourceCreatureInstanceId(combat);
        if (creatureSource) {
          const creatureDefId = resolveInstanceId(state, creatureSource);
          const creatureName = cardName(state, creatureDefId!, 'creature');
          logDetail(`Attack not defeated — ${creatureName} fires deny-scout-resources on company ${combat.companyId as string}`);
          stateAfterCombat = addConstraint(stateAfterCombat, {
            source: creatureSource,
            sourceDefinitionId: (creatureDefId ?? creatureSource) as import('../types/common.js').CardDefinitionId,
            scope: { kind: 'turn' },
            target: { kind: 'company', companyId: combat.companyId },
            kind: { type: 'deny-scout-resources' },
          });
        }
      }
    }
  }

  // Check for on-event: attack-strike-successful effects on the attack source.
  // Fires when at least one of this creature's own strikes wounded or
  // eliminated a defender (struckCharIds, computed above) while the defending
  // company is still moving. Used by Fell Turtle (tw-34): "If any strike is
  // successful, the defending company must return to its site of origin" —
  // the CoE rule 2.IV.4 mechanism shared with the short-event
  // `company-return-to-origin` effect and `agent-discard-return-to-origin`.
  if (struckCharIds.length > 0 && state.phaseState.phase === Phase.MovementHazard) {
    const sourceCardForStrikeSuccess = getAttackSourceCard(state, combat);
    const strikeSuccessEvents = getOnEventEffects(sourceCardForStrikeSuccess, 'attack-strike-successful');
    for (const sse of strikeSuccessEvents) {
      if (sse.apply.type !== 'company-return-to-origin') continue;
      const mhStateSS = stateAfterCombat.phaseState as MovementHazardPhaseState;
      if (mhStateSS.returnedToOrigin) continue;
      const defIdxSS = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
      const companySS = companyById(stateAfterCombat.players[defIdxSS].companies, combat.companyId);
      if (!companySS || !companySS.destinationSite) continue;
      const creatureSource = attackSourceCreatureInstanceId(combat);
      if (!creatureSource) continue;
      const creatureDefId = resolveInstanceId(state, creatureSource);
      const creatureName = cardName(state, creatureDefId!, 'creature');
      logDetail(`Successful strike — ${creatureName} forces company ${combat.companyId as string} to return to its site of origin (rule 2.IV.4)`);
      stateAfterCombat = {
        ...stateAfterCombat,
        phaseState: { ...mhStateSS, returnedToOrigin: true },
      };
      stateAfterCombat = addConstraint(stateAfterCombat, {
        source: creatureSource,
        sourceDefinitionId: (creatureDefId ?? creatureSource) as import('../types/common.js').CardDefinitionId,
        scope: { kind: 'company-site-phase', companyId: combat.companyId },
        target: { kind: 'company', companyId: combat.companyId },
        kind: { type: 'site-phase-do-nothing' },
      });
    }
  }

  // Check for on-event: attack-not-canceled effects on the attack source.
  // All resolved combats were by definition not canceled (cancellation prevents
  // combat resolution entirely), so this fires unconditionally after any attack.
  const sourceCardForNotCanceled = getAttackSourceCard(state, combat);
  const notCanceledEvents = getOnEventEffects(sourceCardForNotCanceled, 'attack-not-canceled');
  for (const nce of notCanceledEvents) {
    if (nce.apply.type === 'add-constraint' && nce.apply.constraint === 'creature-attack-boost') {
      const creatureSource = attackSourceCreatureInstanceId(combat);
      const boostRace = nce.apply.race;
      if (creatureSource && boostRace !== undefined) {
        const creatureDefId = resolveInstanceId(state, creatureSource);
        const creatureName = cardName(state, creatureDefId!, 'creature');
        const boostStrikes = nce.apply.strikes ?? 0;
        const boostProwess = nce.apply.prowess ?? 0;
        logDetail(`Attack not canceled — ${creatureName} fires creature-attack-boost (race=${boostRace}, +${boostStrikes} strikes, +${boostProwess} prowess) on company ${combat.companyId as string}`);
        stateAfterCombat = addConstraint(stateAfterCombat, {
          source: creatureSource,
          sourceDefinitionId: (creatureDefId ?? creatureSource) as import('../types/common.js').CardDefinitionId,
          scope: { kind: 'turn' },
          target: { kind: 'company', companyId: combat.companyId },
          kind: {
            type: 'creature-attack-boost',
            race: boostRace,
            strikes: boostStrikes,
            prowess: boostProwess,
          },
        });
      }
    }
    // Wild Fell Beast (td-81): "Unless this attack is canceled, all untapped
    // characters in defending company are tapped following attack." The
    // `company-tap-characters` apply verb (also used by Heedless Revelry's
    // on-guard reveal) taps every still-untapped character in the company that
    // faced the attack. Characters that tapped to face a strike are already
    // tapped and wounded ones are Inverted, so only the bystanders are hit.
    if (nce.apply.type === 'company-tap-characters') {
      const tapDefIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
      const tapCompany = companyById(stateAfterCombat.players[tapDefIdx].companies, combat.companyId);
      if (tapCompany) {
        logDetail(`Attack not canceled — tapping untapped characters in company ${combat.companyId as string}`);
        for (const charId of tapCompany.characters) {
          const ch = stateAfterCombat.players[tapDefIdx].characters[charId];
          if (!ch || ch.status !== CardStatus.Untapped) continue;
          const charDef = defById(stateAfterCombat, ch.definitionId);
          if (!charDef || !isCharacterCard(charDef)) continue;
          if (nce.apply.filter) {
            const ctx = {
              target: {
                race: charDef.race,
                mind: ch.effectiveStats.mind ?? charDef.mind ?? 0,
                name: charDef.name,
                skills: charDef.skills,
                cardType: charDef.cardType,
              },
            };
            if (!matchesCondition(nce.apply.filter, ctx)) continue;
          }
          logDetail(`  tapping "${charDef.name}" following the attack`);
          stateAfterCombat = updatePlayer(stateAfterCombat, tapDefIdx, p =>
            updateCharacter(p, charId, c => ({ ...c, status: CardStatus.Tapped })),
          );
        }
      }
    }
  }

  // Check for on-event: attack-defeated effects on permanent events in play.
  // When all strikes were defeated, scan every player's cardsInPlay for
  // permanent events whose on-event condition matches the attack's race
  // (e.g. The Moon Is Dead: discard when an Undead attack is defeated).
  if (allDefeated && combat.creatureRace) {
    const isAutomaticAttack = combat.attackSource.type === 'automatic-attack'
      || combat.attackSource.type === 'played-auto-attack';
    const attackCtx = {
      enemy: enemyRaceContext(combat),
      attack: { isolated: combat.isolated ?? false, isAutomaticAttack },
      inPlay: buildInPlayNames(stateAfterCombat),
    };
    const allDiscardedIds = new Set<string>();
    const updatedPlayersAD = stateAfterCombat.players.map(player => {
      const toDiscard: import('../types/state-cards.js').CardInPlay[] = [];
      const remaining: import('../types/state-cards.js').CardInPlay[] = [];
      for (const card of player.cardsInPlay) {
        const def = defById(stateAfterCombat, card.definitionId);
        const defeatedEvents = getOnEventEffects(def, 'attack-defeated');
        let shouldDiscard = false;
        for (const ev of defeatedEvents) {
          if (!ev.when || matchesContext(ev.when, attackCtx)) {
            if (isSelfDiscardMove(ev.apply)) {
              shouldDiscard = true;
              break;
            }
          }
        }
        if (shouldDiscard) { toDiscard.push(card); } else { remaining.push(card); }
      }
      if (toDiscard.length === 0) return player;
      const discarded = toDiscard.map(c => (toCardInstance(c)));
      for (const c of toDiscard) {
        allDiscardedIds.add(c.instanceId as string);
        const defName = cardName(stateAfterCombat, c.definitionId, '?');
        logDetail(`Attack-defeated: discarding "${defName}" from cardsInPlay (on-event: attack-defeated)`);
      }
      return { ...player, cardsInPlay: remaining, discardPile: [...player.discardPile, ...discarded] };
    }) as unknown as typeof stateAfterCombat.players;
    stateAfterCombat = { ...stateAfterCombat, players: updatedPlayersAD };
    // Remove constraints sourced from discarded permanent events
    if (allDiscardedIds.size > 0) {
      stateAfterCombat = {
        ...stateAfterCombat,
        activeConstraints: stateAfterCombat.activeConstraints.filter(
          c => !allDiscardedIds.has(c.source as string),
        ),
      };
    }
  }

  // Handle permanent-event auto-attack onDefeat:'remove-from-play' (e.g. Balrog of Moria TW-12).
  // When all strikes of a site automatic-attack are defeated and the attack's source
  // is a permanent-event carrying this flag, remove the event from the hazard player's
  // cardsInPlay and move it to the defending player's killPile to award kill MPs.
  if (allDefeated && combat.attackSource.type === 'automatic-attack') {
    const { siteInstanceId, attackIndex } = combat.attackSource;
    const siteDef = resolveDef(state, siteInstanceId);
    if (siteDef && isSiteCard(siteDef)) {
      const autoAttacks = getActiveAutoAttacks(state, siteDef, siteInstanceId);
      const aa = autoAttacks[attackIndex];
      const sourceInstId = aa?.sourceInstanceId;
      if (sourceInstId) {
        const sourceDef = resolveDef(state, sourceInstId);
        const effects = (sourceDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
        for (const eff of effects) {
          if (eff.type !== 'permanent-event-auto-attack') continue;
          const peaEff = eff;
          if (peaEff.onDefeat !== 'remove-from-play') continue;
          const sourceName = (sourceDef as { name?: string } | undefined)?.name ?? '?';
          const hazardIdx = getPlayerIndex(stateAfterCombat, combat.attackingPlayerId);
          const defIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
          const sourceCard = stateAfterCombat.players[hazardIdx]?.cardsInPlay.find(c => c.instanceId === sourceInstId);
          if (sourceCard) {
            const cardRef = toCardInstance(sourceCard);
            const updatedPlayersOD = stateAfterCombat.players.map((p, idx) => {
              if (idx === hazardIdx) return { ...p, cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== sourceInstId) };
              if (idx === defIdx) return { ...p, killPile: [...p.killPile, cardRef] };
              return p;
            }) as unknown as typeof stateAfterCombat.players;
            stateAfterCombat = { ...stateAfterCombat, players: updatedPlayersOD };
            logDetail(`Permanent-event "${sourceName}" defeated — removed from play, kill MPs awarded to defender`);
          }
          break;
        }
      }
    }
  }

  // Handle permanent-event auto-attack discardAfterUse (e.g. Witch-king at Iron-deeps / Under-leas).
  // Fires regardless of outcome (win or lose). When a site auto-attack's source is a permanent
  // event with discardAfterUse: true, move the card from the hazard player's cardsInPlay to their
  // discard pile. No kill MPs are awarded ("ignore result of defeat").
  if (combat.attackSource.type === 'automatic-attack') {
    const { siteInstanceId: dauSiteInstId, attackIndex: dauAttackIdx } = combat.attackSource;
    const dauSiteDef = resolveDef(state, dauSiteInstId);
    if (dauSiteDef && isSiteCard(dauSiteDef)) {
      const dauAttacks = getActiveAutoAttacks(state, dauSiteDef, dauSiteInstId);
      const dauAa = dauAttacks[dauAttackIdx];
      const dauSourceInstId = dauAa?.sourceInstanceId;
      if (dauSourceInstId) {
        const dauSourceDef = resolveDef(state, dauSourceInstId);
        const dauEffects = (dauSourceDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
        for (const dauEff of dauEffects) {
          if (dauEff.type !== 'permanent-event-auto-attack') continue;
          if (!dauEff.discardAfterUse) continue;
          const dauSourceName = (dauSourceDef as { name?: string } | undefined)?.name ?? '?';
          const dauHazardIdx = getPlayerIndex(stateAfterCombat, combat.attackingPlayerId);
          const dauSourceCard = stateAfterCombat.players[dauHazardIdx]?.cardsInPlay.find(c => c.instanceId === dauSourceInstId);
          if (dauSourceCard) {
            const dauCardRef = toCardInstance(dauSourceCard);
            const dauUpdatedPlayers = stateAfterCombat.players.map((p, idx) => {
              if (idx === dauHazardIdx) return { ...p, cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== dauSourceInstId), discardPile: [...p.discardPile, dauCardRef] };
              return p;
            }) as unknown as typeof stateAfterCombat.players;
            stateAfterCombat = { ...stateAfterCombat, players: dauUpdatedPlayers };
            logDetail(`Permanent-event "${dauSourceName}" used as extra auto-attack (discardAfterUse) — moved to discard pile`);
          }
          break;
        }
      }
    }
  }

  stateAfterCombat = recordHazardEncountered(stateAfterCombat, state, combat);

  // Record ahunt-attack outcomes for ahunt group rewards (e.g. Mordor in Arms
  // dm-72): each ahunt attack resolved during a company's order-effects step
  // appends its defeated/not-defeated result, consumed by handleOrderEffects.
  if (state.phaseState.phase === Phase.MovementHazard && combat.attackSource.type === 'ahunt') {
    const mhStateAO = stateAfterCombat.phaseState as MovementHazardPhaseState;
    const priorOutcomes = mhStateAO.ahuntGroupOutcomes ?? [];
    logDetail(`Ahunt outcome recorded: ${combat.attackSource.longEventInstanceId as string} defeated=${allDefeated}`);
    stateAfterCombat = {
      ...stateAfterCombat,
      phaseState: {
        ...mhStateAO,
        ahuntGroupOutcomes: [...priorOutcomes, { instanceId: combat.attackSource.longEventInstanceId, defeated: allDefeated }],
      },
    };
  }

  // Apply post-attack effects scheduled by accepted haven-join offers
  // (e.g. Alatar's "following the attack, tap + corruption check").
  // Effects fire regardless of outcome. After effects, any haven-jumped
  // character is restored to their original company.
  stateAfterCombat = applyPostAttackEffects(stateAfterCombat, state, combat);
  stateAfterCombat = restoreHavenJumpOrigins(stateAfterCombat, combat);

  // card-triggered-attack: continue the queued attack sequence, or dispose of
  // the card now that its last attack has resolved.
  stateAfterCombat = continueOrDisposeCardTriggeredAttack(stateAfterCombat, combat, false);

  // lucky-search-attack finalization (Lucky Search tw-269):
  // After combat, move the found item to the scout or discard it if the scout
  // was wounded. Reshuffle all non-item revealed cards back into the play deck.
  if (combat.attackSource.type === 'lucky-search-attack') {
    const { scoutInstanceId, foundItemInstanceId, revealedCardInstanceIds } = combat.attackSource;
    const defIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);

    const scoutWounded = combat.strikeAssignments.some(
      a => a.characterId === scoutInstanceId && a.result === 'wounded',
    );

    // Partition the deck: revealed cards vs remainder
    const revealedSet = new Set(revealedCardInstanceIds.map(id => id as string));
    const allRevealedCards = stateAfterCombat.players[defIdx].playDeck.filter(
      c => revealedSet.has(c.instanceId as string),
    );
    const remainingDeck = stateAfterCombat.players[defIdx].playDeck.filter(
      c => !revealedSet.has(c.instanceId as string),
    );

    const foundCard = foundItemInstanceId
      ? findById(allRevealedCards, foundItemInstanceId)
      : null;
    const nonItemRevealed = foundCard
      ? allRevealedCards.filter(c => c.instanceId !== foundItemInstanceId)
      : allRevealedCards;

    if (foundCard && !scoutWounded) {
      // Scout takes control: attach item to scout
      logDetail(`Lucky Search: scout not wounded — ${String(foundCard.definitionId)} attached to scout ${String(scoutInstanceId)}`);
      stateAfterCombat = updatePlayer(stateAfterCombat, defIdx, p =>
        updateCharacter(p, scoutInstanceId as string, ch => ({
          ...ch,
          items: [...ch.items, { instanceId: foundCard.instanceId, definitionId: foundCard.definitionId, status: CardStatus.Untapped }],
        })),
      );
    } else if (foundCard && scoutWounded) {
      logDetail(`Lucky Search: scout wounded — discarding found item ${String(foundCard.definitionId)}`);
      stateAfterCombat = updatePlayer(stateAfterCombat, defIdx, p => ({
        ...p,
        discardPile: [...p.discardPile, toCardInstance(foundCard)],
      }));
    } else {
      logDetail(`Lucky Search: no item found in deck`);
    }

    // Reshuffle non-item revealed cards back into the remaining deck
    const [reshuffled, newRng] = shuffle([...nonItemRevealed, ...remainingDeck], stateAfterCombat.rng);
    logDetail(`Lucky Search: reshuffling ${nonItemRevealed.length} revealed card(s) back into deck (${remainingDeck.length} remaining)`);
    stateAfterCombat = { ...updatePlayer(stateAfterCombat, defIdx, p => ({ ...p, playDeck: reshuffled })), rng: newRng };
  }

  // The Great Hunt (wh-91): after a reveal-sequence attack finalizes, advance
  // the reveal queue — initiate the next queued creature's attack or complete
  // the process (reshuffling the opponent play deck). The creature that just
  // attacked was never moved out of its pile, so nothing is disposed here.
  if (combat.attackSource.type === 'great-hunt-attack' && combat.attackSource.continuation === 'reveal') {
    stateAfterCombat = advanceGreatHuntReveal(stateAfterCombat, combat.attackSource.greatHuntInstanceId);
  }

  // Clear attack-scoped constraints (e.g. company-combat-boost stat modifiers
  // from short events like "The Dwarves Are upon You!").
  stateAfterCombat = sweepExpired(stateAfterCombat, { kind: 'attack-end' });

  // Tidings of Bold Spies (le-143): if the company being attacked has a
  // tidings-attacks-queue constraint with remaining attacks, initiate the next
  // combat immediately. Each queued attack mirrors the site's auto-attack stats
  // but is NOT itself an automatic-attack.
  const tidingsConstraint = stateAfterCombat.activeConstraints.find(
    c => c.target.kind === 'company'
      && c.target.companyId === combat.companyId
      && c.kind.type === 'tidings-attacks-queue',
  );
  if (tidingsConstraint && tidingsConstraint.kind.type === 'tidings-attacks-queue') {
    const { attacks, attackIndex } = tidingsConstraint.kind;
    if (attackIndex < attacks.length) {
      const aa = attacks[attackIndex];
      const race = normalizeCreatureRace(aa.creatureType);
      const inPlayNames2 = buildInPlayNames(stateAfterCombat);
      const activeIdx2 = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
      const siteDef2 = (() => {
        const company2 = activeIdx2 >= 0 ? companyById(stateAfterCombat.players[activeIdx2].companies, combat.companyId) : undefined;
        const destInst2 = company2?.destinationSite ?? company2?.currentSite ?? null;
        const destDefId2 = destInst2 ? resolveInstanceId(stateAfterCombat, destInst2.instanceId) : null;
        const def2 = destDefId2 ? defById(stateAfterCombat, destDefId2) : undefined;
        return def2 && isSiteCard(def2) ? def2 : undefined;
      })();
      const tidingsBoostCtx = { companyId: combat.companyId };
      const prowess2 = resolveAttackProwess(stateAfterCombat, aa.prowess, inPlayNames2, race, true, undefined, tidingsBoostCtx);
      const strikes2 = resolveAttackStrikes(stateAfterCombat, aa.strikes, inPlayNames2, race, true, tidingsBoostCtx);
      const body2 = resolveAttackBody(stateAfterCombat, aa.body ?? null, inPlayNames2, race, tidingsBoostCtx);
      const aaAttackerChooses2 = resolveAttackerChoosesDefenders(
        stateAfterCombat, aa.combatRules?.includes('attacker-chooses-defenders') ?? false, race,
      );
      logDetail(`Tidings of Bold Spies: initiating attack ${attackIndex + 1}/${attacks.length}: ${aa.creatureType} (${strikes2} strikes, ${prowess2} prowess)`);
      const nextCombat: CombatState = makeCombatState({
        attackSource: { type: 'tidings-attack', eventInstanceId: tidingsConstraint.source, attackIndex },
        companyId: combat.companyId,
        defendingPlayerId: combat.defendingPlayerId,
        attackingPlayerId: combat.attackingPlayerId,
        strikesTotal: strikes2,
        strikeProwess: prowess2,
        creatureBody: body2,
        creatureRace: race,
        assignmentPhase: aaAttackerChooses2 ? 'cancel-window' : 'defender',
        detainment: isDetainmentAttack({
          attackEffects: siteDef2?.effects,
          attackRace: race ?? null,
          defendingAlignment: activeIdx2 >= 0 ? stateAfterCombat.players[activeIdx2].alignment : Alignment.Wizard,
          defendingSiteEffects: siteDef2?.effects,
          defenderForcesNormalAttacks: activeIdx2 >= 0 && playerConvertsDetainmentToNormal(stateAfterCombat, stateAfterCombat.players[activeIdx2]),
        }),
        ...(aaAttackerChooses2 ? { attackerChoosesDefenders: true } : {}),
      });
      // Update the queue constraint to point to the next attack.
      stateAfterCombat = removeConstraint(stateAfterCombat, tidingsConstraint.id);
      if (attackIndex + 1 < attacks.length) {
        stateAfterCombat = addConstraint(stateAfterCombat, {
          source: tidingsConstraint.source,
          sourceDefinitionId: tidingsConstraint.sourceDefinitionId,
          scope: { kind: 'company-mh-phase', companyId: combat.companyId },
          target: { kind: 'company', companyId: combat.companyId },
          kind: {
            type: 'tidings-attacks-queue',
            attacks,
            attackIndex: attackIndex + 1,
          },
        });
      }
      return { state: { ...stateAfterCombat, combat: nextCombat }, effects };
    }
    // Queue exhausted — remove the constraint.
    stateAfterCombat = removeConstraint(stateAfterCombat, tidingsConstraint.id);
  }


  // MELE §8.37: Trophy offer — after a non-detainment non-played-auto-attack
  // creature defeat, eligible Orc/Troll characters may take the creature as
  // a trophy. We transition to the `trophy-offer` phase rather than finalizing
  // immediately so the defending player can choose.
  if (allDefeated && !combat.detainment && !isPlayedAutoAttack && creatureInstanceId) {
    const defIdx3 = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
    const defPlayer3 = stateAfterCombat.players[defIdx3];
    // Find Orc/Troll (not half-orc) characters that faced at least one strike
    const facedStrikeCharIds = new Set<CardInstanceId>(
      combat.strikeAssignments.map(a => a.characterId),
    );
    const trophyEligible: import('../types/common.js').CardInstanceId[] = [];
    for (const charId of facedStrikeCharIds) {
      const char = defPlayer3.characters[charId];
      if (!char) continue;
      const def = defById(stateAfterCombat, char.definitionId);
      if (!def || !isCharacterCard(def)) continue;
      // Half-orcs count as Orcs for most purposes but may NOT take trophies
      // (CoE 3.IV.1.1; glossary "Half-orc").
      if ((def.race === Race.Orc || def.race === Race.Troll) && !isHalfOrc(def)) {
        trophyEligible.push(charId);
      }
    }
    if (trophyEligible.length > 0) {
      logDetail(`Trophy offer: ${trophyEligible.length} eligible Orc/Troll character(s) may take creature ${creatureInstanceId as string} as a trophy (MELE §8.37)`);
      // Creature is in kill pile; rule 8.22 is applied after the trophy decision
      // (in finalizeCombatFromTrophyOffer or take-trophy handler).
      const trophyOfferCombat: CombatState = {
        ...combat,
        phase: 'trophy-offer',
        trophyEligibleCharacters: trophyEligible,
      };
      return { state: { ...stateAfterCombat, combat: trophyOfferCombat }, effects };
    }
  }

  // No trophy offer — apply rule 8.22 alignment-based routing now.
  let stateWithRule8_22 = applyRule8_22AfterTrophyDecision(stateAfterCombat, combat);

  // Sweep leader-leaves-company events for any eliminated leaders
  const anyLeaderEliminated = combat.strikeAssignments.some(a => {
    if (a.result !== 'eliminated') return false;
    const defId = resolveInstanceId(stateWithRule8_22, a.characterId);
    const def = defId ? defById(stateWithRule8_22, defId) : undefined;
    return !!(def && isCharacterCard(def) && (def.keywords ?? []).includes('leader'));
  });
  if (anyLeaderEliminated) {
    logDetail(`finalizeCombat: an eliminated character is a Leader — sweeping leader-leaves-company events on company ${combat.companyId as string}`);
    stateWithRule8_22 = sweepLeaderLeavesCompanyEvents(stateWithRule8_22, [combat.companyId]);
  }

  return {
    state: initiateQueuedTraitorAttack(stateWithRule8_22),
    effects,
  };
}

/**
 * Traitor (tw-105): a corruption check failed while a combat was active
 * (e.g. a Corpse-candle pre-defense check), so the traitor attack was queued
 * as a `traitor-attack-queued` constraint instead of clobbering the running
 * combat. Called at every combat-completion exit (normal finalization, trophy
 * declined, trophy taken): when no combat remains active and the constraint
 * is present, remove it and initiate the traitor attack — the CRF timing puts
 * it in the chain immediately following the one containing the corruption
 * check. The attack is dropped (with a log) if the traitor's company no
 * longer has any characters. No-ops when a combat is still active or no
 * constraint is queued.
 */
export function initiateQueuedTraitorAttack(state: GameState): GameState {
  if (state.combat) return state;
  const queued = state.activeConstraints.find(c => c.kind.type === 'traitor-attack-queued');
  if (!queued || queued.kind.type !== 'traitor-attack-queued') return state;
  const tk = queued.kind;
  const newState = removeConstraint(state, queued.id);
  const companyId = queued.target.kind === 'company' ? queued.target.companyId : undefined;
  const defIdx = getPlayerIndex(newState, tk.defendingPlayerId);
  const company = companyId !== undefined && defIdx >= 0
    ? companyById(newState.players[defIdx].companies, companyId)
    : undefined;
  if (!company || company.characters.length === 0) {
    logDetail('Traitor: queued attack dropped — the traitor\'s company no longer has any characters');
    return newState;
  }
  const traitorName = cardName(newState, tk.traitorDefinitionId, 'traitor');
  logDetail(`Traitor: initiating queued attack — "${traitorName}" (${tk.strikes} strike(s), ${tk.prowess} prowess) against company ${company.id as string}`);
  const traitorCombat: CombatState = makeCombatState({
    attackSource: { type: 'traitor-attack', eventInstanceId: queued.source, traitorDefinitionId: tk.traitorDefinitionId },
    companyId: company.id,
    defendingPlayerId: tk.defendingPlayerId,
    attackingPlayerId: tk.attackingPlayerId,
    strikesTotal: tk.strikes,
    strikeProwess: tk.prowess,
    creatureBody: null,
    ...(tk.race ? { creatureRace: tk.race } : {}),
    assignmentPhase: 'cancel-window',
    detainment: false,
    attackerChoosesDefenders: true,
    ...(tk.bodyCheckModifier !== 0 ? { bodyCheckModifier: tk.bodyCheckModifier } : {}),
  });
  return { ...newState, combat: traitorCombat };
}

/**
 * Apply each {@link PostAttackEffect} in order at combat finalization.
 *
 * For each targeted character, optionally tap them if they are still
 * untapped, then enqueue a corruption check if configured. Enqueued via
 * the unified pending-resolution system scoped to the company's current
 * sub-phase (M/H or Site) so it auto-clears when the sub-phase ends.
 *
 * Reusable by any card that schedules post-attack side-effects via
 * `on-event: creature-attack-begins` + `apply.postAttack`.
 */
function applyPostAttackEffects(
  stateAfterCombat: GameState,
  stateBeforeFinalize: GameState,
  combat: CombatState,
): GameState {
  const effects = combat.postAttackEffects ?? [];
  if (effects.length === 0) return stateAfterCombat;

  let s = stateAfterCombat;
  const defIdx = s.players.findIndex(p => p.id === combat.defendingPlayerId);
  if (defIdx < 0) return s;

  const phaseStateActive = stateBeforeFinalize.phaseState as { activeCompanyIndex?: number };
  const activeCompanyIndex = phaseStateActive.activeCompanyIndex ?? -1;
  // The scope-anchor company is the post-combat active company — i.e. the
  // company the M/H or Site sub-phase is currently servicing. Haven-jumped
  // characters are still attached there at this point (restore runs after).
  const scopeCompany = activeCompanyIndex >= 0
    ? s.players[defIdx].companies[activeCompanyIndex]
    : undefined;
  const scopeCompanyId = scopeCompany?.id;

  for (const effect of effects) {
    // Tap if untapped
    if (effect.tapIfUntapped) {
      const char = s.players[defIdx].characters[effect.targetCharacterId];
      if (char && char.status === CardStatus.Untapped) {
        const newPlayers: [PlayerState, PlayerState] = [s.players[0], s.players[1]];
        newPlayers[defIdx] = {
          ...s.players[defIdx],
          characters: {
            ...s.players[defIdx].characters,
            [effect.targetCharacterId as string]: { ...char, status: CardStatus.Tapped },
          },
        };
        s = { ...s, players: newPlayers };
        logDetail(`Post-attack: tapped ${effect.targetCharacterId as string}`);
      }
    }
    // Corruption check
    if (effect.corruptionCheck && scopeCompanyId) {
      const modifier = effect.corruptionCheck.modifier ?? 0;
      const scope = companySubphaseScope(stateBeforeFinalize.phaseState.phase, scopeCompanyId);
      s = enqueueCorruptionCheck(s, {
        source: null,
        actor: combat.defendingPlayerId,
        scope,
        characterId: effect.targetCharacterId,
        modifier,
        reason: 'post-attack corruption check',
      });
      logDetail(`Post-attack: corruption check queued on ${effect.targetCharacterId as string} (mod ${modifier})`);
    }
    // Left Behind (td-41): peel the character off into a separate company.
    if (effect.leftBehindSplit) {
      s = applyLeftBehindSplit(s, defIdx, effect.targetCharacterId, combat.companyId);
    }
  }

  return s;
}

/**
 * Left Behind (td-41) split. Peel `characterId` off the company under attack
 * (`originCompanyId`) into a new `leftBehind` company that has the **same site
 * path** (currentSite / destinationSite / movementPath) as the company he was
 * in. That company is created *unhandled* so the movement/hazard loop naturally
 * gives it its own (separate) movement/hazard phase; its `leftBehind` flag
 * forces that phase's hazard-limit snapshot to one, and after all M/H phases a
 * `left-behind-rejoin` resolution offers the merge back into the original
 * company.
 *
 * If the character was **alone** in his company there is no other company to
 * peel him into, so his own company is flagged `leftBehindExtraPhasePending` to
 * run one more (limit-one) M/H phase this turn instead.
 */
function applyLeftBehindSplit(
  state: GameState,
  playerIndex: number,
  characterId: CardInstanceId,
  originCompanyId: import('../types/common.js').CompanyId,
): GameState {
  const newPlayers = clonePlayers(state);
  const player = newPlayers[playerIndex];

  const sourceIndex = player.companies.findIndex(c => c.id === originCompanyId);
  if (sourceIndex < 0) {
    logDetail(`Left Behind: origin company ${originCompanyId as string} not found — split skipped`);
    return state;
  }
  const source = player.companies[sourceIndex];
  if (!source.characters.includes(characterId)) {
    logDetail(`Left Behind: ${characterId as string} not in origin company — split skipped`);
    return state;
  }

  const updatedCompanies = [...player.companies];

  if (source.characters.length <= 1) {
    // Lone character — flag his company for one extra (separate) M/H phase.
    logDetail(`Left Behind: ${characterId as string} is alone — his company gets a separate M/H phase (limit 1)`);
    updatedCompanies[sourceIndex] = {
      ...source,
      leftBehind: true,
      leftBehindOriginCompanyId: source.id,
      leftBehindExtraPhasePending: true,
    };
    newPlayers[playerIndex] = { ...player, companies: updatedCompanies };
    return { ...state, players: newPlayers };
  }

  // Remove the character from his original company.
  updatedCompanies[sourceIndex] = {
    ...source,
    characters: source.characters.filter(id => id !== characterId),
  };

  // Create the separate "left behind" company sharing the same site path.
  const newCompany = {
    id: nextCompanyId(player),
    characters: [characterId],
    currentSite: source.currentSite,
    siteCardOwned: false,
    destinationSite: source.destinationSite,
    movementPath: source.movementPath,
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
    leftBehind: true,
    leftBehindOriginCompanyId: source.id,
  };
  updatedCompanies.push(newCompany);
  logDetail(`Left Behind: ${characterId as string} splits off into ${newCompany.id as string} (same site path as ${source.id as string})`);

  newPlayers[playerIndex] = { ...player, companies: updatedCompanies };
  return cleanupEmptyCompanies({ ...state, players: newPlayers });
}

/**
 * After combat, return any haven-jumped characters to their original
 * company. The character's CharacterInPlay stays unchanged; only the
 * companies' `characters` membership lists are rewritten.
 */
function restoreHavenJumpOrigins(
  stateAfterCombat: GameState,
  combat: CombatState,
): GameState {
  const origins = combat.havenJumpOrigins ?? [];
  if (origins.length === 0) return stateAfterCombat;

  const defIdx = getPlayerIndex(stateAfterCombat, combat.defendingPlayerId);
  if (defIdx < 0) return stateAfterCombat;

  const player = stateAfterCombat.players[defIdx];
  const newCompanies = player.companies.map(c => {
    let chars = c.characters;
    for (const o of origins) {
      if (chars.includes(o.characterId) && c.id !== o.originCompanyId) {
        chars = chars.filter(id => id !== o.characterId);
      }
      if (c.id === o.originCompanyId && !chars.includes(o.characterId)) {
        chars = [...chars, o.characterId];
      }
    }
    return chars === c.characters ? c : { ...c, characters: chars };
  });

  const newPlayers: [PlayerState, PlayerState] = [stateAfterCombat.players[0], stateAfterCombat.players[1]];
  newPlayers[defIdx] = { ...player, companies: newCompanies };
  for (const o of origins) {
    logDetail(`Haven-jump finalize: ${o.characterId as string} returned to company ${o.originCompanyId as string}`);
  }
  return { ...stateAfterCombat, players: newPlayers };
}

/**
 * Build an on-event condition context from the current game state.
 * Includes `company.hazardsEncountered` for troll-trio condition checks.
 */
function buildOnEventContext(state: GameState): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  if (state.phaseState.phase === Phase.MovementHazard) {
    ctx.company = { hazardsEncountered: state.phaseState.hazardsEncountered };
  }
  return ctx;
}

/**
 * Discard items on wounded characters matching the move filter to the
 * defending player's discard pile. Implements the combat-specific
 * `move { select: 'filter-all', from: 'items-on-wounded', to: 'discard',
 * toOwner: 'defender', filter }` shape used by creatures like Balrog
 * of Moria to strip non-special items from their victims.
 *
 * A `discard-substitute` item borne anywhere in the wounded characters'
 * company (Leaf Brooch dm-171) intercepts the whole batch: the discard is
 * handed to a `discard-substitute-offer` resolution so its owner may save one
 * of the doomed items by throwing the brooch away instead.
 */
function discardWoundedItems(
  state: GameState,
  combat: CombatState,
  woundedCharIds: readonly CardInstanceId[],
  sourceName: string,
  filter: import('../types/effects.js').Condition | undefined,
): GameState {
  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);

  const doomed: CardInstanceId[] = [];
  for (const charId of woundedCharIds) {
    const charData = state.players[defIdx]?.characters[charId];
    if (!charData) continue;
    for (const item of charData.items) {
      const def = defById(state, item.definitionId);
      if (!def) continue;
      if (!filter || matchesDefinition(def, filter)) doomed.push(item.instanceId);
    }
  }
  const offered = doomed.length > 0
    ? enqueueDiscardSubstituteOffer(state, {
      source: combat.attackSource.type === 'creature' ? combat.attackSource.instanceId : null,
      owner: combat.defendingPlayerId,
      scope: companySubphaseScope(state.phaseState.phase, combat.companyId),
      companyId: combat.companyId,
      requiredInstanceIds: doomed,
      sourceName,
    })
    : null;
  if (offered) return offered;

  const cloned = clonePlayers(state);
  const newCharacters = { ...cloned[defIdx].characters };
  const discarded: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] = [];

  for (const charId of woundedCharIds) {
    const charData = newCharacters[charId];
    if (!charData) continue;

    const matching = charData.items.filter(item => {
      const def = defById(state, item.definitionId);
      if (!def) return false;
      if (!filter) return true;
      return matchesDefinition(def, filter);
    });

    if (matching.length === 0) continue;

    const remaining = charData.items.filter(item => !matching.some(m => m.instanceId === item.instanceId));
    newCharacters[charId] = { ...charData, items: remaining };

    for (const item of matching) {
      discarded.push(toCardInstance(item));
      logDetail(`${sourceName}: discarding item ${item.definitionId as string} from wounded character ${charId as string}`);
    }
  }

  cloned[defIdx] = {
    ...cloned[defIdx],
    characters: newCharacters,
    discardPile: [
      ...cloned[defIdx].discardPile,
      ...discarded,
    ],
  };

  return { ...state, players: cloned };
}

/**
 * Discard wounded characters to the defending player's discard pile when the
 * per-character condition (evaluated against `{ target: { race } }`) is met.
 * Implements the `discard-character` apply type for `character-wounded-by-self`.
 * Used by Abductor (tw-1): discards every non-Wizard/non-Ringwraith character it wounds.
 */
function discardWoundedCharacters(
  state: GameState,
  combat: CombatState,
  woundedCharIds: readonly CardInstanceId[],
  sourceName: string,
  when: import('../types/effects.js').Condition | undefined,
): GameState {
  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  let stateOut = state;

  for (const charId of woundedCharIds) {
    const player = stateOut.players[defIdx];
    const charData = player?.characters[charId];
    if (!charData) continue;

    const charDefId = resolveInstanceId(stateOut, charId);
    const charDef = charDefId ? defById(stateOut, charDefId) : undefined;
    const charRace = charDef && isCharacterCard(charDef) ? charDef.race : undefined;
    const perCharContext: Record<string, unknown> = { target: { race: charRace } };

    if (when && !matchesCondition(when, perCharContext)) {
      logDetail(`${sourceName}: discard-character excluded for ${charId as string} (race ${String(charRace)})`);
      continue;
    }

    // Press-gang (ba-22): a wounded character discarded by an effect is instead
    // held off to the side by the opponent's Press-gang.
    const pressHost = findCapturingPressGang(stateOut, defIdx);
    if (pressHost) {
      stateOut = capturePressGang(stateOut, defIdx, charId, pressHost);
      continue;
    }

    // Pallando the Soul-keeper (as-17): a matching character discarded from play
    // is instead eliminated to its owner's out-of-play pile.
    const elimHost = findEliminateInsteadOfDiscardHost(stateOut, charDef);

    logDetail(`${sourceName}: ${elimHost ? 'eliminating' : 'discarding'} wounded character ${charId as string}`);
    const cloned = clonePlayers(stateOut);
    const newPlayerData = { ...cloned[defIdx] };

    newPlayerData.companies = newPlayerData.companies.map(c => ({
      ...c,
      characters: c.characters.filter(ch => ch !== charId),
    }));
    const removedCharCard = { instanceId: charId, definitionId: charDefId! };
    if (elimHost) {
      newPlayerData.outOfPlayPile = [...newPlayerData.outOfPlayPile, removedCharCard];
    } else {
      newPlayerData.discardPile = [...newPlayerData.discardPile, removedCharCard];
    }
    {
      const { toHand, toDiscard } = partitionLeavingAllies(stateOut, charData.allies);
      if (toHand.length > 0) logDetail(`${sourceName}: ${toHand.length} ally(ies) return to hand from discarded character`);
      newPlayerData.hand = [...newPlayerData.hand, ...toHand];
      newPlayerData.discardPile = [...newPlayerData.discardPile, ...toDiscard];
    }
    for (const item of charData.items) {
      logDetail(`${sourceName}: discarding item ${item.instanceId as string} from discarded character`);
      newPlayerData.discardPile = [...newPlayerData.discardPile, toCardInstance(item)];
    }
    for (const hazard of charData.hazards) {
      logDetail(`${sourceName}: discarding hazard ${hazard.instanceId as string} from discarded character`);
      cloned[1 - defIdx] = { ...cloned[1 - defIdx], discardPile: [...cloned[1 - defIdx].discardPile, toCardInstance(hazard)] };
    }
    const { [charId]: _removed, ...remainingChars } = newPlayerData.characters;
    // Revert followers to general influence with the mind subtraction
    // deferred to the player's next organization phase (CoE rule 3.13 —
    // combat never happens during the controller's organization phase).
    const updatedChars = { ...remainingChars };
    for (const followerId of charData.followers) {
      const follower = updatedChars[followerId];
      if (follower) updatedChars[followerId] = { ...follower, controlledBy: 'general', influenceUnsubtracted: true, ...ringwraithReclaimMark(stateOut, follower) };
    }
    newPlayerData.characters = updatedChars;

    cloned[defIdx] = newPlayerData;
    stateOut = { ...stateOut, players: cloned };
    if (elimHost) stateOut = consumeEliminateInsteadOfDiscardHost(stateOut, elimHost);
  }

  return stateOut;
}

/**
 * After combat finalization, record the creature name in the M/H phase
 * state's `hazardsEncountered` list for troll-trio condition checks.
 */
export function recordHazardEncountered(
  stateAfterCombat: GameState,
  originalState: GameState,
  combat: CombatState,
): GameState {
  if (originalState.phaseState.phase !== Phase.MovementHazard) return stateAfterCombat;
  if (combat.attackSource.type !== 'creature') return stateAfterCombat;

  const creatureDefId = resolveInstanceId(originalState, combat.attackSource.instanceId);
  if (!creatureDefId) return stateAfterCombat;

  const creatureDef = originalState.cardPool[creatureDefId] as { name?: string } | undefined;
  const creatureName = creatureDef?.name;
  if (!creatureName) return stateAfterCombat;

  const mhState = stateAfterCombat.phaseState as MovementHazardPhaseState;
  logDetail(`Recording hazard "${creatureName}" in hazardsEncountered`);
  return {
    ...stateAfterCombat,
    phaseState: {
      ...mhState,
      hazardsEncountered: [...mhState.hazardsEncountered, creatureName],
    },
  };
}

