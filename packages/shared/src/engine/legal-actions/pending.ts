/**
 * @module legal-actions/pending
 *
 * Glue between {@link computeLegalActions} and the unified pending system
 * (resolutions + constraints) defined in `engine/pending.ts` and
 * `types/pending.ts`.
 *
 * Two entry points:
 *
 *  - {@link resolutionLegalActions} — invoked when a {@link PendingResolution}
 *    is queued for the actor; collapses the legal action menu to the
 *    actions that resolve the top entry.
 *  - {@link applyConstraints} — invoked after the per-phase legal actions
 *    have been computed; rewrites the menu by dropping or adding actions
 *    according to the active {@link ActiveConstraint}s in scope.
 *
 * Per-kind handlers are filled in as the migration steps move each
 * legacy `pending*` field over to the new system.
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  PendingResolution,
  ActiveConstraint,
  CardInstanceId,
  CompanyId,
} from '../../index.js';
import { isCharacterCard, isAllyCard, isFactionCard, isAvatarCharacter, isSiteCard, isResourceEventCard, Phase, CardStatus, matchesCondition, matchesContext, GENERAL_INFLUENCE, Skill, formatSignedNumber } from '../../index.js';
import type { PlayOptionEffect, PlayTargetEffect, CardEffect, RingTestTableEffect, RingCategory, DuplicationLimitEffect } from '../../types/effects.js';
import { resolveInstanceId } from '../../types/state.js';
import type { OpponentInfluenceAttempt } from '../../types/pending.js';
import { buildBearerContext, resolveDef, collectCharacterEffects, collectCompanyAllyEffects, resolveCheckModifier, resolveStatModifiers, getItemGrantedSkills } from '../effects/index.js';
import type { ResolverContext } from '../effects/index.js';
import { buildPlayOptionContext, availableDI } from './organization.js';
import { buildControllerInPlayNames, buildFactionPlayableAt } from '../recompute-derived.js';
import { logDetail } from './log.js';
import { canPayCost } from '../cost-evaluator.js';
import { cardName, matchesDefinition, findCharacterCompany, findById, playerById, activePlayerState, getCardEffects, companyById, defById, findHazardMaintenanceEffect } from '../reducer-utils.js';


/** Wrap plain GameActions as viable EvaluatedActions. */
function viable(actions: import('../../index.js').GameAction[]): EvaluatedAction[] {
  return actions.map(action => ({ action, viable: true }));
}

/**
 * Compute the (single) set of legal actions for the actor while the
 * given resolution is at the top of the queue. Dispatches on
 * `top.kind.type`. Each handler is added in the migration step that
 * moves its old per-phase short-circuit over.
 */
export function resolutionLegalActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  switch (top.kind.type) {
    case 'corruption-check':
      return corruptionCheckActions(state, actor, top);
    case 'order-effects':
      return [];
    case 'on-guard-window':
      return onGuardWindowActions(state, actor, top);
    case 'opponent-influence-defend':
      return opponentInfluenceDefendActions(state, actor, top);
    case 'faction-influence-roll':
      return factionInfluenceRollActions(state, actor, top);
    case 'muster-roll':
      return musterRollActions(state, actor, top);
    case 'flattery-attempt':
      return flateryAttemptRollActions(state, actor, top);
    case 'call-of-home-roll':
      return callOfHomeRollActions(state, actor, top);
    case 'seized-by-terror-roll':
      return seizedByTerrorRollActions(state, actor, top);
    case 'gold-ring-test':
      return goldRingTestActions(state, actor, top);
    case 'body-check-company':
      return bodyCheckCompanyActions(state, actor, top);
    case 'resource-play-offer':
      return resourcePlayOfferActions(state, actor, top);
    case 'wizard-search-on-store':
      return wizardSearchOnStoreActions(state, actor, top);
    case 'select-card-bearer':
      return selectCardBearerActions(state, actor, top);
    case 'glamour-hazard-roll':
      return glamourHazardRollActions(state, actor, top);
    case 'discard-one-company-item':
      return discardOneCompanyItemActions(state, actor, top);
    case 'hazard-event-maintenance':
      return hazardEventMaintenanceActions(state, actor, top);
    case 'ring-play-offer':
      return ringPlayOfferActions(state, actor, top);
    case 'cvcc-ally-discard-roll':
      return cvccAllyDiscardRollActions(state, actor, top);
    case 'tap-one-character':
      return tapOneCharacterActions(state, actor, top);
  }
}

/**
 * Compute the legal actions for the actor of a queued `on-guard-window`
 * resolution.
 *
 * - During the `reveal-window` stage (hazard player), produce one
 *   `reveal-on-guard` action per eligible on-guard hazard event in the
 *   active company plus a `pass` action that closes the window.
 * - During the `awaiting-pass` stage (resource player after the chain
 *   has resolved), the only legal action is `pass`, which runs the
 *   deferred action.
 */
function onGuardWindowActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'on-guard-window') return [];
  if (top.kind.stage === 'awaiting-pass') {
    return [{ action: { type: 'pass', player: actor }, viable: true }];
  }

  // reveal-window stage: produce reveal-on-guard actions for the
  // active company's on-guard hazard events that target a character or
  // are revealable in this window. Mirrors the legacy
  // `onGuardRevealAtResourceActions`.
  if (state.activePlayer === null) {
    return [{ action: { type: 'pass', player: actor }, viable: true }];
  }
  const activePlayerObj = activePlayerState(state);
  if (!activePlayerObj) {
    return [{ action: { type: 'pass', player: actor }, viable: true }];
  }
  const phaseState = state.phaseState as { activeCompanyIndex?: number };
  const activeCompanyIndex = phaseState.activeCompanyIndex ?? 0;
  const company = activePlayerObj.companies[activeCompanyIndex];

  const actions: EvaluatedAction[] = [];

  // Identify the deferred action so trigger-specific on-guard cards can
  // be filtered against it (e.g. Searching Eye only reveals against a
  // play-short-event whose source card carries the matching requiredSkill).
  const deferredAction = top.kind.type === 'on-guard-window' ? top.kind.deferredAction : undefined;
  const deferredSource = (() => {
    if (!deferredAction) return undefined;
    if (deferredAction.type !== 'play-short-event' && deferredAction.type !== 'play-hero-resource') return undefined;
    for (const p of state.players) {
      const handCard = findById(p.hand, deferredAction.cardInstanceId);
      if (handCard) return defById(state, handCard.definitionId);
    }
    return undefined;
  })();
  const deferredRequiredSkills = new Set<string>();
  if (deferredSource && 'effects' in deferredSource) {
    const effects = (deferredSource as { effects?: readonly { requiredSkill?: string }[] }).effects ?? [];
    for (const e of effects) {
      if (typeof e.requiredSkill === 'string') deferredRequiredSkills.add(e.requiredSkill);
    }
  }

  if (company) {
    for (const ogCard of company.onGuardCards) {
      if (ogCard.revealed) continue;
      const def = defById(state, ogCard.definitionId);
      if (!def) continue;
      if (def.cardType !== 'hazard-event') continue;

      // Per CoE rule 2.V.6, only hazard events that directly affect the
      // company may be revealed from on-guard when a resource is played.
      // Cards must declare an on-guard-reveal effect with a matching trigger.
      // For `resource-short-event` triggers (Searching Eye), additionally
      // check that the deferred short's source card carries a matching
      // `requiredSkill` on its apply — no match ⇒ reveal is not legal.
      const ogEffects = 'effects' in def
        ? ((def as { effects?: readonly import('../../types/effects.js').CardEffect[] }).effects ?? [])
        : [];
      const matchesDeferred = ogEffects.some(e => {
        if (e.type !== 'on-guard-reveal') return false;
        const trigger = (e as { trigger?: string }).trigger;
        if (trigger === 'resource-play' || trigger === 'influence-attempt') return true;
        if (trigger === 'resource-short-event') {
          if (!deferredAction || deferredAction.type !== 'play-short-event') return false;
          const apply = (e as { apply?: { requiredSkill?: string } }).apply;
          if (apply && typeof apply.requiredSkill === 'string') {
            return deferredRequiredSkills.has(apply.requiredSkill);
          }
          return true;
        }
        return false;
      });
      if (!matchesDeferred) continue;

      // play-target DSL: character-targeting events get one action per character
      const isCharTargeting = 'effects' in def && def.effects?.some(
        e => e.type === 'play-target' && e.target === 'character',
      );
      if (isCharTargeting) {
        for (const charId of company.characters) {
          actions.push({
            action: {
              type: 'reveal-on-guard',
              player: actor,
              cardInstanceId: ogCard.instanceId,
              targetCharacterId: charId,
            },
            viable: true,
          });
        }
      } else {
        actions.push({
          action: {
            type: 'reveal-on-guard',
            player: actor,
            cardInstanceId: ogCard.instanceId,
          },
          viable: true,
        });
      }
    }
  }

  actions.push({ action: { type: 'pass', player: actor }, viable: true });
  return actions;
}

/**
 * Compute legal actions for the hazard player while an
 * opponent-influence-defend resolution is queued. The defending player
 * can either roll the defensive 2d6 (standard) or play a
 * cancel-influence card from hand (e.g. Wizard's Laughter) to
 * automatically cancel the influence attempt.
 */
function opponentInfluenceDefendActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'opponent-influence-defend') return [];
  const { attempt } = top.kind;

  const influencerDef = resolveDef(state, attempt.influencerId);
  const influencerName = influencerDef && isCharacterCard(influencerDef) ? influencerDef.name : '?';

  const targetDef = resolveDef(state, attempt.targetInstanceId);
  const targetName = targetDef && (isCharacterCard(targetDef) || isAllyCard(targetDef))
    ? targetDef.name : '?';

  const parts: string[] = [
    `Attacker roll: ${attempt.attackerRoll}`,
    `Influencer DI: ${attempt.influencerDI}`,
    `Your GI: ${attempt.opponentGI}`,
    `Controller DI: ${attempt.controllerDI}`,
    `Target mind: ${attempt.targetMind}`,
  ];
  if (attempt.crossAlignmentPenalty !== 0) {
    parts.push(`Cross-alignment penalty: ${attempt.crossAlignmentPenalty}`);
  }

  const explanation = `${influencerName} influences ${targetName}: ${parts.join(', ')}`;

  const actions: EvaluatedAction[] = [{
    action: { type: 'opponent-influence-defend', player: actor, explanation },
    viable: true,
  }];

  actions.push(...cancelInfluenceActions(state, actor, attempt));

  return actions;
}

/**
 * Scan the defending player's hand for cancel-influence cards (e.g.
 * Wizard's Laughter, Poisonous Despair) and generate one action per
 * qualifying character who can pay the cost.
 *
 * Each card may carry multiple `cancel-influence` effects (e.g. one
 * for the no-cost Ringwraith case and one for the cost-paying shadow-magic
 * case). All effects are checked; one action is generated per matching
 * (card × character × effect) combination, de-duplicated by card + character
 * so the same pairing is never offered twice.
 */
function cancelInfluenceActions(
  state: GameState,
  actor: PlayerId,
  attempt: OpponentInfluenceAttempt,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, actor);
  if (!player) return actions;

  for (const handCard of player.hand) {
    const def = resolveDef(state, handCard.instanceId);
    if (!def) continue;
    const cancelEffects = (getCardEffects(def) as CardEffect[]).filter(e => e.type === 'cancel-influence');
    if (cancelEffects.length === 0) continue;

    // Track which (card, character) pairs already have an action to avoid duplicates
    const generated = new Set<string>();

    for (const cancelEffect of cancelEffects) {
      if (cancelEffect.type !== 'cancel-influence') continue;

      // Check targetKindFilter: skip this effect if the pending attempt targets a kind not in the filter
      if (cancelEffect.targetKindFilter && cancelEffect.targetKindFilter.length > 0) {
        if (!cancelEffect.targetKindFilter.includes(attempt.targetKind)) continue;
      }

      if (cancelEffect.requiredRace || cancelEffect.requiredSkill) {
        for (const company of player.companies) {
          for (const charId of company.characters) {
            const charData = player.characters[charId as string];
            if (!charData) continue;
            const charDef = resolveDef(state, charId);
            if (!charDef || !isCharacterCard(charDef)) continue;

            // Check race restriction
            if (cancelEffect.requiredRace && charDef.race !== cancelEffect.requiredRace) continue;

            // Check skill restriction (character's innate skills + item-granted skills)
            if (cancelEffect.requiredSkill) {
              const allSkills = [...charDef.skills, ...getItemGrantedSkills(state, charData)];
              if (!allSkills.includes(cancelEffect.requiredSkill)) continue;
            }

            const pairKey = `${handCard.instanceId as string}:${charId as string}`;
            if (generated.has(pairKey)) continue;
            generated.add(pairKey);

            logDetail(`Cancel-influence: ${charDef.name} can play ${def.name} (targetKind=${attempt.targetKind})`);
            actions.push({
              action: {
                type: 'cancel-influence',
                player: actor,
                cardInstanceId: handCard.instanceId,
                characterId: charId,
              },
              viable: true,
            });
          }
        }
      }
    }
  }

  return actions;
}

/**
 * Compute the single faction-influence-roll action that resolves a queued
 * `faction-influence-roll` resolution. Calculates all modifiers from the
 * current game state (post-chain) so the UI can display a full breakdown
 * before the player commits to rolling.
 */
function factionInfluenceRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'faction-influence-roll') return [];
  const { factionInstanceId, factionDefinitionId, influencingCharacterId } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const def = defById(state, factionDefinitionId);
  if (!def || !isFactionCard(def)) return [];

  const charInPlay = player.characters[influencingCharacterId as string];
  if (!charInPlay) return [];

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const factionName = def.name;

  // Calculate influence modifier using current state (post-chain effects)
  let modifier = 0;
  const parts: string[] = [];

  if (charDef && isCharacterCard(charDef)) {
    const freeDI = availableDI(state, influencingCharacterId, player);
    modifier += freeDI;
    parts.push(`DI ${freeDI}`);

    const resolverCtx: ResolverContext = {
      reason: 'faction-influence-check',
      bearer: buildBearerContext(charDef),
      faction: {
        name: def.name,
        race: def.race,
        playableAt: buildFactionPlayableAt(def),
      },
      controller: { inPlay: buildControllerInPlayNames(state, playerId) },
    };

    const charEffects = collectCharacterEffects(state, charInPlay, resolverCtx);
    charEffects.push(...collectCompanyAllyEffects(state, charInPlay, resolverCtx));

    if (def.effects) {
      for (const effect of def.effects) {
        if (effect.when && !matchesContext(effect.when, resolverCtx)) continue;
        charEffects.push({ effect, sourceDef: def, sourceInstance: factionInstanceId });
      }
    }

    const dslModifier = resolveCheckModifier(charEffects, 'influence');
    if (dslModifier !== 0) {
      modifier += dslModifier;
      parts.push(`check mod ${formatSignedNumber(dslModifier)}`);
    }

    const dslDI = resolveStatModifiers(charEffects, 'direct-influence', 0, resolverCtx);
    if (dslDI !== 0) {
      modifier += dslDI;
      parts.push(`DI mod ${formatSignedNumber(dslDI)}`);
    }

    // One-shot check-modifier constraints for influence (e.g. Muster): must match the pending roll
    for (const constraint of state.activeConstraints) {
      if (constraint.kind.type !== 'check-modifier') continue;
      if (constraint.kind.check !== 'influence') continue;
      if (constraint.target.kind !== 'character') continue;
      if (constraint.target.characterId !== influencingCharacterId) continue;
      modifier += constraint.kind.value;
      parts.push(`constraint ${formatSignedNumber(constraint.kind.value)}`);
    }
  }

  const influenceNumber = def.influenceNumber;
  const need = influenceNumber - modifier;
  const modStr = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  logDetail(`Pending faction-influence-roll for ${factionName} by ${charName}: need 2d6 >= ${need}${modStr}`);

  return [{
    action: {
      type: 'faction-influence-roll' as const,
      player: playerId,
      factionInstanceId,
      influencingCharacterId,
      need,
      explanation: `${charName} influences ${factionName}: need roll >= ${need} (influence # ${influenceNumber}, modifier ${formatSignedNumber(modifier)}${modStr})`,
    },
    viable: true,
  }];
}

/**
 * Compute the single muster-roll action that resolves a queued
 * `muster-roll` resolution (Muster Disperses). The faction's owner
 * rolls 2d6; if the roll + unused general influence < 11, the
 * faction is discarded.
 */
function musterRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'muster-roll') return [];
  const { factionInstanceId, factionDefinitionId } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const def = defById(state, factionDefinitionId);
  if (!def || !isFactionCard(def)) return [];

  const unusedGI = GENERAL_INFLUENCE - player.generalInfluenceUsed;
  const threshold = 11;
  const need = threshold - unusedGI;

  logDetail(`Pending muster-roll for ${def.name}: need 2d6 >= ${need} (threshold ${threshold}, unused GI ${unusedGI})`);

  return [{
    action: {
      type: 'muster-roll' as const,
      player: playerId,
      factionInstanceId,
      need,
      explanation: `Muster check for ${def.name}: roll + unused GI (${unusedGI}) must be >= ${threshold} (need roll >= ${need})`,
    },
    viable: true,
  }];
}

/**
 * Compute the single flattery-attempt action for a queued `flattery-attempt`
 * resolution. The defending player rolls 2d6; total = roll + unused DI
 * (+ diplomatBonus if the character has the diplomat skill). Success if
 * total > threshold (the roll threshold varies by creature race).
 */
function flateryAttemptRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'flattery-attempt') return [];
  const { characterInstanceId, creatureRace, threshold, diplomatBonus } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const charInPlay = player.characters[characterInstanceId as string];
  if (!charInPlay) return [];

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const isDiplomat = isCharacterCard(charDef) && charDef.skills.includes(Skill.Diplomat);
  const bonus = isDiplomat ? diplomatBonus : 0;
  const unusedDI = availableDI(state, characterInstanceId, player);
  const totalModifier = unusedDI + bonus;

  // Success requires: roll + unusedDI + bonus > threshold, i.e. roll > threshold - totalModifier
  // need = threshold - totalModifier + 1 (roll >= need means success)
  const need = threshold - totalModifier + 1;

  const parts: string[] = [`threshold ${threshold}`, `unused DI ${unusedDI}`];
  if (isDiplomat) parts.push(`+${diplomatBonus} diplomat`);
  parts.push(`→ need roll >= ${need}`);

  logDetail(`Pending flattery-attempt by ${charName} vs "${creatureRace}": ${parts.join(', ')}`);

  return [{
    action: {
      type: 'flattery-attempt' as const,
      player: playerId,
      characterInstanceId,
      need,
      explanation: `${charName} flattery vs ${creatureRace}: ${parts.join(', ')}`,
    },
    viable: true,
  }];
}

/**
 * Compute the single call-of-home-roll action that resolves a queued
 * `call-of-home-roll` resolution. The character's player rolls 2d6;
 * if roll + unused general influence < threshold, character returns to hand.
 */
function callOfHomeRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'call-of-home-roll') return [];
  const { targetCharacterId, hazardDefinitionId, threshold } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const charInPlay = player.characters[targetCharacterId as string];
  if (!charInPlay) return [];

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const hazardDef = defById(state, hazardDefinitionId);
  const hazardName = hazardDef?.name ?? '?';

  const unusedGI = GENERAL_INFLUENCE - player.generalInfluenceUsed;
  const need = threshold - unusedGI;
  logDetail(`Pending call-of-home-roll for ${charName} (${hazardName}): need 2d6 >= ${need} (threshold ${threshold}, unused GI ${unusedGI})`);

  return [{
    action: {
      type: 'call-of-home-roll' as const,
      player: playerId,
      targetCharacterId,
      need,
      explanation: `${charName} resists ${hazardName}: need roll >= ${need} (threshold ${threshold}, unused GI ${unusedGI})`,
    },
    viable: true,
  }];
}

/**
 * Compute the single seized-by-terror-roll action that resolves a queued
 * `seized-by-terror-roll` resolution. The character's player rolls 2d6;
 * if roll + character mind < threshold (12), the character splits off into
 * a new company that returns to the original company's site of origin.
 */
function seizedByTerrorRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'seized-by-terror-roll') return [];
  const { targetCharacterId, hazardDefinitionId, threshold } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const charInPlay = player.characters[targetCharacterId as string];
  if (!charInPlay) return [];

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const hazardDef = defById(state, hazardDefinitionId);
  const hazardName = hazardDef?.name ?? '?';

  const mind = charDef && isCharacterCard(charDef) && charDef.mind !== null ? charDef.mind : 0;
  const need = threshold - mind;
  logDetail(`Pending seized-by-terror-roll for ${charName} (${hazardName}): need 2d6 >= ${need} (threshold ${threshold}, mind ${mind})`);

  return [{
    action: {
      type: 'seized-by-terror-roll' as const,
      player: playerId,
      targetCharacterId,
      need,
      explanation: `${charName} resists ${hazardName}: need roll >= ${need} (threshold ${threshold}, mind ${mind})`,
    },
    viable: true,
  }];
}

/**
 * Compute the single gold-ring-test-roll action that resolves a queued
 * `gold-ring-test` resolution (auto-test triggered by the
 * `auto-test-gold-ring` site-rule when a gold ring is stored at a
 * Darkhaven). The ring's owner rolls 2d6 with the site's modifier; the
 * ring is discarded regardless of the result.
 */
function goldRingTestActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'gold-ring-test') return [];
  const { goldRingInstanceId, rollModifier } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  // Ring may be in outOfPlayPile (org-phase store path) or in a character's
  // items array (site-phase play path with auto-test-gold-ring).
  const ringInOutOfPlay = findById(player.outOfPlayPile, goldRingInstanceId);
  let ringCardFound = ringInOutOfPlay;
  if (!ringCardFound) {
    for (const char of Object.values(player.characters)) {
      const found = char.items.find(i => i.instanceId === goldRingInstanceId);
      if (found) { ringCardFound = found; break; }
    }
  }
  const ringCard = ringCardFound;
  const ringDef = ringCard ? defById(state, ringCard.definitionId) : undefined;
  const ringName = ringDef?.name ?? '?';
  logDetail(`Pending gold-ring-test for ${ringName}: roll 2d6 ${formatSignedNumber(rollModifier)}`);

  return [{
    action: {
      type: 'gold-ring-test-roll' as const,
      player: playerId,
      goldRingInstanceId,
      rollModifier,
      explanation: `Gold-ring auto-test for ${ringName}: 2d6 ${formatSignedNumber(rollModifier)}`,
    },
    viable: true,
  }];
}

/**
 * Compute the single glamour-hazard-roll action for a queued
 * `glamour-hazard-roll` resolution (Glamour of Surpassing Excellance, as-49).
 * The resource player rolls 2d6; if the result exceeds the hazard's
 * removalThreshold, the hazard permanent-event is discarded.
 */
function glamourHazardRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'glamour-hazard-roll') return [];
  const { hazardInstanceId, hazardDefinitionId, removalThreshold, sourceDefinitionId } = top.kind;

  const hazDef = defById(state, hazardDefinitionId);
  const hazName = hazDef?.name ?? '?';
  const sourceDef = defById(state, sourceDefinitionId);
  const sourceName = sourceDef?.name ?? '?';

  logDetail(`Pending glamour-hazard-roll for ${hazName} (threshold >${removalThreshold}) from ${sourceName}`);

  return [{
    action: {
      type: 'glamour-hazard-roll' as const,
      player: playerId,
      hazardInstanceId,
      explanation: `${hazName}: roll 2d6, discard if result > ${removalThreshold} (${sourceName})`,
    },
    viable: true,
  }];
}

/**
 * Compute the single body-check-company-roll action for a queued
 * `body-check-company` resolution (from a mass-body-check hazard).
 * The resource player rolls 2d6 for the named character.
 */
function bodyCheckCompanyActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'body-check-company') return [];
  const { characterId, modifier, sourceDefinitionId } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const charInPlay = player.characters[characterId as string];
  if (!charInPlay) return [];

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const body = isCharacterCard(charDef) && charDef.body != null ? charDef.body : 9;
  const effectiveBody = body + modifier;
  const sourceDef = defById(state, sourceDefinitionId);
  const sourceName = sourceDef?.name ?? '?';

  logDetail(`Pending body-check-company for ${charName} (body ${body}, modifier ${modifier}, threshold ${effectiveBody}) from ${sourceName}`);

  return [{
    action: {
      type: 'body-check-company-roll' as const,
      player: playerId,
      characterId,
      explanation: `${charName}: body check for ${sourceName} (need 2d6 >= ${effectiveBody})`,
    },
    viable: true,
  }];
}

/**
 * Compute legal actions for a queued `resource-play-offer` resolution.
 *
 * Offered when Crown of Flowers enters play: the active player may pair
 * any resource card from their hand with the in-play Crown of Flowers,
 * or pass (leaving Crown of Flowers with no paired resource this turn).
 */
function resourcePlayOfferActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'resource-play-offer') return [];

  const actions: EvaluatedAction[] = [{ action: { type: 'pass', player: actor }, viable: true }];

  const player = playerById(state, actor);
  if (!player) return actions;
  const cofInstanceId = top.kind.linkToInstanceId;

  for (const card of player.hand) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    if (
      def.cardType !== 'hero-resource-event' &&
      def.cardType !== 'hero-resource-item' &&
      def.cardType !== 'hero-resource-ally' &&
      def.cardType !== 'hero-resource-faction'
    ) continue;
    logDetail(`resource-play-offer: offering ${def.name} (${card.instanceId as string}) as pair for CoF ${cofInstanceId as string}`);
    actions.push({
      action: {
        type: 'pair-resource-with-cof',
        player: actor,
        cardInstanceId: card.instanceId,
        cofInstanceId,
      },
      viable: true,
    });
  }

  return actions;
}

/**
 * Compute the legal actions for a queued `wizard-search-on-store` resolution
 * (The Windlord Found Me, dm-164).
 *
 * Emits one `play-wizard-from-search` action per Wizard found in the player's
 * play deck or discard pile, plus a `skip-wizard-search` action to pass.
 * Wizards are identified by `isAvatarCharacter` (mind === null).
 */
function wizardSearchOnStoreActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'wizard-search-on-store') return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];

  // Gather wizard definition IDs from the play deck (deduplicated)
  const deckWizardDefIds = new Set<string>();
  for (const card of player.playDeck) {
    const def = defById(state, card.definitionId);
    if (def && isCharacterCard(def) && isAvatarCharacter(def)) {
      deckWizardDefIds.add(card.definitionId as string);
    }
  }
  for (const defId of deckWizardDefIds) {
    const def = state.cardPool[defId];
    logDetail(`Wizard-search: found ${def?.name ?? defId} in play deck`);
    actions.push({
      action: {
        type: 'play-wizard-from-search' as const,
        player: playerId,
        wizardDefinitionId: defId as import('../../index.js').CardDefinitionId,
        source: 'play-deck' as const,
      },
      viable: true,
    });
  }

  // Gather wizard instances from the discard pile
  for (const card of player.discardPile) {
    const def = defById(state, card.definitionId);
    if (def && isCharacterCard(def) && isAvatarCharacter(def)) {
      logDetail(`Wizard-search: found ${def.name} in discard pile`);
      actions.push({
        action: {
          type: 'play-wizard-from-search' as const,
          player: playerId,
          wizardDefinitionId: card.definitionId,
          source: 'discard-pile' as const,
        },
        viable: true,
      });
    }
  }

  // Always emit skip option
  actions.push({
    action: { type: 'skip-wizard-search' as const, player: playerId },
    viable: true,
  });

  return actions;
}

/**
 * Compute the single corruption-check action that resolves a queued
 * `corruption-check` resolution. The action carries the precomputed
 * CP, modifier, possessions list, and a human-readable explanation —
 * the same shape the legacy per-phase short-circuits used to produce.
 *
 * For transfer corruption checks, the transferred item is included in
 * both the CP total and the possessions list, even though it has already
 * physically moved to its new bearer.
 */
function corruptionCheckActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'corruption-check') return [];
  const { characterId, modifier, reason, transferredItemId } = top.kind;

  // Find the character on either player (corruption checks are owned by
  // the actor, but the actor may not be the active player in all cases).
  const player = playerById(state, playerId);
  if (!player) return [];
  const char = player.characters[characterId as string];
  if (!char) {
    // Character was eliminated — auto-resolve via pass.
    logDetail(`Corruption check (${reason}): character ${characterId as string} no longer in play — pass to skip`);
    return viable([{ type: 'pass', player: playerId }]);
  }

  const charDef = resolveDef(state, char.instanceId);
  const charName = isCharacterCard(charDef) ? charDef.name : '?';

  // Base CP from current effective stats
  let cp = char.effectiveStats.corruptionPoints;

  // The producing effect's own modifier (e.g. Barrow-wight's -2)
  let totalModifier = modifier;

  // Add one-shot `check-modifier` constraints targeting this character and
  // keyed to corruption checks (e.g. Halfling Strength +4).
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'check-modifier') continue;
    if (constraint.kind.check !== 'corruption') continue;
    if (constraint.target.kind !== 'character') continue;
    if (constraint.target.characterId !== characterId) continue;
    totalModifier += constraint.kind.value;
    logDetail(`One-shot check-modifier ${formatSignedNumber(constraint.kind.value)} from constraint ${constraint.id}`);
  }

  // Build the source-card keyword list so item check-modifiers can gate
  // on what produced the check (e.g. Wizard's Staff keys off source.keywords
  // $includes 'spell'). The source is the PendingResolution's source card.
  const sourceDef = top.source ? resolveDef(state, top.source) : undefined;
  const sourceKeywords: readonly string[] = sourceDef && 'keywords' in sourceDef && Array.isArray((sourceDef as { keywords?: readonly string[] }).keywords)
    ? (sourceDef as { keywords: readonly string[] }).keywords
    : [];
  const checkContext = { reason: 'corruption-check', source: { keywords: sourceKeywords } };

  // DSL check-modifier effects from the character's own definition, items, and hazards.
  const company = findCharacterCompany(player.companies, characterId);
  const companyCharCount = company ? company.characters.length : 1;
  const allEffects = collectCharacterEffects(state, char, checkContext);
  const dslModifier = resolveCheckModifier(allEffects, 'corruption', { company: { characterCount: companyCharCount } });
  if (dslModifier !== 0) {
    totalModifier += dslModifier;
    logDetail(`DSL check-modifier ${formatSignedNumber(dslModifier)} (company size: ${companyCharCount}, source keywords: [${sourceKeywords.join(', ')}])`);
  }

  // Build possessions list. For transfer checks, the item physically lives
  // on the new bearer but is counted on the original character for this check.
  const possessions: CardInstanceId[] = [
    ...(transferredItemId ? [transferredItemId] : []),
    ...char.items.map(i => i.instanceId),
    ...char.allies.map(a => a.instanceId),
    ...char.hazards.map(h => h.instanceId),
  ];

  // For transfer checks, also count the transferred item's CP toward the total
  if (transferredItemId) {
    const transferredDef = resolveDef(state, transferredItemId);
    if (transferredDef && 'corruptionPoints' in transferredDef) {
      cp += (transferredDef as { corruptionPoints: number }).corruptionPoints;
    }
  }

  const ccNeed = cp + 1 - totalModifier;
  const parts = [`CP ${cp}`];
  if (totalModifier !== 0) parts.push(`modifier ${formatSignedNumber(totalModifier)}`);
  logDetail(`Pending corruption check for ${charName} (${reason}: CP ${cp}, modifier ${formatSignedNumber(totalModifier)}, ${possessions.length} possession(s))`);

  const rollAction: EvaluatedAction = {
    action: {
      type: 'corruption-check',
      player: playerId,
      characterId,
      corruptionPoints: cp,
      corruptionModifier: totalModifier,
      possessions,
      need: ccNeed,
      explanation: `${reason}: need roll > ${cp - totalModifier} (${parts.join(', ')})`,
    },
    viable: true,
  };

  // Scan the actor's hand for reactive short-event plays whose DSL
  // declares itself relevant to this corruption check. Halfling Strength's
  // `corruption-check-boost` option matches here via
  // `when: { "pending.corruptionCheckTargetsMe": true }` evaluated against
  // the per-candidate context built from the resolving character. Playing
  // one of these emits a constraint that the roll action re-reads on the
  // next legal-action cycle, so the reactive play → roll sequence is a
  // normal two-action flow.
  const reactivePlays = reactiveCorruptionCheckPlays(state, playerId, char);
  if (reactivePlays.length > 0) {
    return [rollAction, ...reactivePlays];
  }
  return [rollAction];
}

/**
 * Enumerates `play-short-event` actions the actor can take during a
 * pending corruption-check resolution. Scans the actor's hand for short
 * event cards whose DSL declares itself relevant to this check:
 *
 *   1. The card declares a `play-target` with `target: "character"` and
 *      a `filter` that matches the resolving character.
 *   2. The card has at least one `play-option` whose `when` condition is
 *      satisfied by the per-candidate context built from the resolving
 *      character (notably `pending.corruptionCheckTargetsMe === true`).
 *
 * One action is emitted per eligible (card, option) pair. The reducer
 * handles the play via the normal `play-short-event` path; the chosen
 * option's `apply` clause runs through the generic dispatcher. No
 * per-card branches.
 */
function reactiveCorruptionCheckPlays(
  state: GameState,
  playerId: PlayerId,
  targetChar: import('../../index.js').CharacterInPlay,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  if (!player) return actions;

  const ctx = buildPlayOptionContext(state, targetChar, player);

  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    if (!def || !isResourceEventCard(def)) continue;
    const shortDef = def;
    if (shortDef.eventType !== 'short') continue;
    const effects = shortDef.effects;
    if (!effects) continue;

    const playTarget = effects.find(
      (e): e is PlayTargetEffect => e.type === 'play-target',
    );
    if (!playTarget || playTarget.target !== 'character') continue;
    if (playTarget.filter && !matchesCondition(playTarget.filter, ctx)) continue;

    // "active-check" duplication limit: skip if a constraint from this definition
    // already exists on the target character (enforces "Cannot be duplicated on a
    // given check" for cards like Join With That Power).
    const activeCheckLimit = effects.find(
      (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'active-check',
    );
    if (activeCheckLimit) {
      const alreadyApplied = state.activeConstraints.some(
        c => c.sourceDefinitionId === handCard.definitionId
          && c.target.kind === 'character'
          && c.target.characterId === targetChar.instanceId,
      );
      if (alreadyApplied) {
        logDetail(`Reactive play ${shortDef.name}: active-check duplication limit — already applied to ${targetChar.instanceId as string}`);
        continue;
      }
    }

    const options = effects.filter(
      (e): e is PlayOptionEffect => e.type === 'play-option',
    );
    for (const opt of options) {
      if (opt.when && !matchesCondition(opt.when, ctx)) continue;
      logDetail(`Reactive corruption-check play available: ${shortDef.name} option "${opt.id}" on ${targetChar.instanceId as string}`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          targetCharacterId: targetChar.instanceId,
          optionId: opt.id,
        },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Filter the per-phase legal actions through every active constraint.
 * Each constraint kind decides for itself whether the player's current
 * action computation is in its scope; cross-player constraints (e.g.
 * Stealth filtering the hazard player's plays) work transparently.
 *
 * Initially a pass-through; constraint kinds are added one at a time
 * during the cert steps.
 */
export function applyConstraints(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
): EvaluatedAction[] {
  if (state.activeConstraints.length === 0) return base;

  let result = base;
  for (const c of state.activeConstraints) {
    result = applyOneConstraint(state, _playerId, result, c);
  }
  return result;
}

function applyOneConstraint(
  state: GameState,
  playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  switch (constraint.kind.type) {
    case 'site-phase-do-nothing':
      return applySitePhaseDoNothing(state, playerId, base, constraint);
    case 'no-creature-hazards-on-company':
      return applyNoCreatureHazardsOnCompany(state, playerId, base, constraint);
    case 'check-modifier':
      return base;
    case 'deny-scout-resources':
      return applyDenyScoutResources(state, playerId, base, constraint);
    case 'attribute-modifier':
      // Consulted directly by the combat / keying / haven-lookup code
      // paths (see `engine/effective.ts` and `legal-actions/
      // movement-hazard.ts`) — no legal-action filtering needed here.
      return base;
    case 'granted-action':
      // Cards whose `when` references window-specific context fields
      // (e.g. Great Ship's `path` + `chain.hazardCount`) rely on the
      // explicit emit from `movement-hazard.ts` / `chain.ts`, which
      // supply that context. This pass-through emits the same
      // activate-granted-action for any phase-matching constraint
      // whose `when` is satisfied by the minimal context available
      // here ({} — so only `when`-less or actor-only conditions hit).
      // River's ranger-cancel (per-character filter on `actor`) runs
      // through this path in both Site and M/H phases.
      return applyGrantedActionConstraint(state, playerId, base, constraint);
    case 'creature-type-no-hazard-limit':
      return base;
    case 'creature-keying-bypass':
      // Consulted directly by the M/H creature-play emitter
      // (see `legal-actions/movement-hazard.ts` `hasCreatureKeyingBypass`)
      // — no broad legal-action filtering needed here.
      return base;
    case 'auto-attack-duplicate':
      return base;
    case 'auto-attack-race-duplicate':
      return base;
    case 'hazard-limit-modifier':
      return base;
    case 'cancel-return-and-site-tap':
      return base;
    case 'cancel-character-discard':
      return base;
    case 'skip-automatic-attacks':
      return base;
    case 'corruption-removal-locked':
      // Consulted directly by the corruption-removal action emitter
      // (see legal-actions/site.ts / organization.ts) — no broad
      // legal-action filtering needed here.
      return base;
    case 'company-stat-modifier':
      // Consumed directly by the effects resolver via
      // `collectCharacterEffects` — no legal-action filtering needed.
      return base;
    case 'character-stat-modifier':
      // Consumed directly by the effects resolver via
      // `collectCharacterEffects` — no legal-action filtering needed.
      return base;
    case 'hand-size-modifier':
      // Consumed directly by `resolveHandSize` — no legal-action filtering needed.
      return base;
    case 'creature-attack-boost':
      // Consumed directly by `resolveAttackProwess`/`resolveAttackStrikes` —
      // no legal-action filtering needed here.
      return base;
    case 'bearer-cannot-untap':
      // Enforced directly by `reducer-untap.ts` `performUntap` —
      // no legal-action filtering needed here.
      return base;
    case 'attack-card-played':
      // Pure marker for the duplication-limit mechanism; consulted directly
      // by `modifyAttackFromHandActions` — no broad legal-action filtering.
      return base;
    case 'major-item-unlocked':
      // Consulted directly by `playResourcesActions` in `legal-actions/site.ts`
      // to allow major and hoard items — no broad legal-action filtering here.
      return base;
    case 'hazard-draw-multiplier':
      // Applied in `transitionToDrawCards` when computing hazardDrawMax —
      // no broad legal-action filtering needed here.
      return base;
    case 'haven-return-option':
      // Consumed by `havenReturnActions` in `legal-actions/end-of-turn.ts` —
      // no broad legal-action filtering needed here.
      return base;
    case 'character-is-prisoner':
      // Enforced by `reducer-untap.ts` (blocks untap/heal), `recompute-derived.ts`
      // (negative MP, 0 GI), and checked by any action computer that requires
      // the acting character to be free — no broad legal-action filtering here.
      return base;
    case 'tidings-attacks-queue':
      // Consumed directly by `finalizeCombat` in `reducer-combat.ts` to
      // chain successive Tidings of Bold Spies attacks — no broad legal-action
      // filtering needed here.
      return base;
  }
}

/**
 * Find the active company for the given player in the current site or
 * MH phase. Returns null if the phase has no active company concept or
 * the constraint's target is not the active company.
 */
function activeCompanyId(state: GameState): CompanyId | null {
  const ps = state.phaseState;
  if (ps.phase === Phase.Site) {
    const sps = ps;
    if (state.activePlayer === null) return null;
    const player = activePlayerState(state);
    if (!player) return null;
    return player.companies[sps.activeCompanyIndex]?.id ?? null;
  }
  if (ps.phase === Phase.MovementHazard) {
    const mps = ps;
    if (state.activePlayer === null) return null;
    const player = activePlayerState(state);
    if (!player) return null;
    return player.companies[mps.activeCompanyIndex]?.id ?? null;
  }
  return null;
}

/**
 * Emit `activate-granted-action` actions for a `granted-action`
 * constraint through the global `applyConstraints` dispatch. River
 * uses this path in both M/H and Site phases (its `when` references
 * only `actor.*`, so the minimal context here suffices). Great Ship
 * uses the window-specific emission from `movement-hazard.ts` and
 * `chain.ts` instead — those paths carry `path` + `chain.hazardCount`
 * context, which Great Ship's `when` requires.
 */
function applyGrantedActionConstraint(
  state: GameState,
  playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.kind.type !== 'granted-action') return base;
  if (constraint.target.kind !== 'company') return base;
  if (state.activePlayer !== playerId) return base;

  const player = playerById(state, playerId);
  if (!player) return base;
  const targetCompanyId = constraint.target.companyId;
  const company = companyById(player.companies, targetCompanyId);
  if (!company) return base;

  const kind = constraint.kind;
  const phaseStr = state.phaseState.phase;

  // Skip if the constraint declares a specific phase and we're not in it.
  if (kind.phase !== undefined && kind.phase !== phaseStr) return base;

  const result = [...base];
  for (const charId of company.characters) {
    const char = player.characters[charId as string];
    if (!char) continue;
    if (!canPayCost(kind.cost, char)) continue;

    const def = resolveDef(state, char.instanceId);
    if (!isCharacterCard(def)) continue;
    const statusStr = char.status === CardStatus.Untapped ? 'untapped'
      : char.status === CardStatus.Tapped ? 'tapped'
      : 'inverted';

    const ctx = {
      actor: {
        name: def.name,
        race: def.race,
        skills: def.skills,
        status: statusStr,
      },
    };

    if (kind.when && !matchesCondition(kind.when, ctx)) continue;

    // Skip if a duplicate action for the same (character, actionId,
    // source) was already emitted by the window-specific path.
    const alreadyEmitted = result.some(ea =>
      ea.action.type === 'activate-granted-action'
      && (ea.action as { characterId?: unknown }).characterId === char.instanceId
      && (ea.action as { actionId?: unknown }).actionId === kind.action
      && (ea.action as { sourceCardId?: unknown }).sourceCardId === constraint.source,
    );
    if (alreadyEmitted) continue;

    logDetail(`Constraint ${constraint.id as string} (granted-action ${kind.action}): offering on ${def.name}`);
    result.push({
      action: {
        type: 'activate-granted-action',
        player: playerId,
        characterId: char.instanceId,
        sourceCardId: constraint.source,
        sourceCardDefinitionId: constraint.sourceDefinitionId,
        actionId: kind.action,
        rollThreshold: 0,
      },
      viable: true,
    });
  }
  return result;
}

/**
 * Lost in Free-domains / River constraint: during the affected company's
 * `enter-or-skip` step, drop every legal action except `pass`. The
 * cancel path is no longer handled here — River declares a separate
 * `granted-action` constraint for the ranger-tap, and the
 * {@link applyGrantedActionConstraint} dispatch handles its emission.
 */
function applySitePhaseDoNothing(
  state: GameState,
  playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  if (constraint.kind.type !== 'site-phase-do-nothing') return base;
  if (state.activePlayer !== playerId) return base;
  const targetCompanyId = constraint.target.companyId;
  if (activeCompanyId(state) !== targetCompanyId) return base;

  // The restriction only fires during the company's enter-or-skip
  // step — M/H and other phases leave `base` unchanged. Any cancel
  // mechanism lives on a separate `granted-action` constraint.
  if (state.phaseState.phase !== Phase.Site) return base;
  const sps = state.phaseState;
  if (sps.step !== 'enter-or-skip') return base;

  logDetail(`Constraint ${constraint.id as string} (site-phase-do-nothing): collapsing to pass for company ${targetCompanyId as string}`);
  return base.filter(ea => ea.action.type === 'pass');
}

/**
 * Stealth constraint: drop every play-hazard / place-on-guard action
 * whose target company matches the constraint's target *and* whose card
 * is a hazard creature. Other hazard categories and creature plays
 * against other companies are unaffected.
 *
 * Exception: if the target company's destination site carries the
 * `creatures-always-keyed-to-site` rule (e.g. Mount Doom), creatures
 * that are keyable to the site by site-type or site-name bypass this
 * constraint.
 */
function applyNoCreatureHazardsOnCompany(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  const protectedCompany = constraint.target.companyId;

  return base.filter(ea => {
    if (ea.action.type !== 'play-hazard') return true;
    const targetCompanyId = (ea.action as { targetCompanyId?: CompanyId }).targetCompanyId;
    if (targetCompanyId !== protectedCompany) return true;
    // Check whether the played card is a hazard creature
    const cardInstId = (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId;
    if (!cardInstId) return true;
    const def = resolveDef(state, cardInstId);
    if (!def || def.cardType !== 'hazard-creature') return true;
    // creatures-always-keyed-to-site bypass: if the destination site carries
    // this rule and the creature is keyed to the site by type or name, allow it.
    if (isCreatureSiteKeyedBypassed(state, protectedCompany, def)) {
      logDetail(`Constraint ${constraint.id as string} (no-creature-hazards-on-company): "${def.name}" bypassed by creatures-always-keyed-to-site rule`);
      return true;
    }
    logDetail(`Constraint ${constraint.id as string} (no-creature-hazards-on-company): dropping creature play "${def.name}" against protected company ${protectedCompany as string}`);
    return false;
  });
}

/**
 * Check whether the target company's destination site carries the
 * `creatures-always-keyed-to-site` rule and the given creature is
 * keyed to the site's original type or name. Used to bypass the
 * `no-creature-hazards-on-company` constraint at Mount Doom.
 */
function isCreatureSiteKeyedBypassed(
  state: GameState,
  companyId: CompanyId,
  def: import('../../types/cards-hazards.js').CreatureCard,
): boolean {
  for (const player of state.players) {
    const company = companyById(player.companies, companyId);
    if (!company) continue;
    const destSite = company.destinationSite;
    if (!destSite) return false;
    const siteDef = defById(state, destSite.definitionId);
    if (!isSiteCard(siteDef)) return false;
    if (!(siteDef.effects ?? []).some(e => e.type === 'site-rule' && e.rule === 'creatures-always-keyed-to-site')) return false;
    const siteType = siteDef.siteType;
    const siteName = siteDef.name;
    return def.keyedTo.some(k =>
      (k.siteTypes && k.siteTypes.includes(siteType))
      || (k.siteNames && k.siteNames.includes(siteName)),
    );
  }
  return false;
}

/**
 * Check whether a card's effects reference the scout skill as a requirement.
 * Covers `cancel-attack` with `requiredSkill: "scout"` and `play-target`
 * with a filter that includes `target.skills: { "$includes": "scout" }`.
 */
function requiresScout(effects: readonly CardEffect[]): boolean {
  return effects.some(e => {
    if (e.type === 'cancel-attack' && 'requiredSkill' in e && e.requiredSkill === 'scout') return true;
    if (e.type === 'play-target' && e.filter) {
      const json = JSON.stringify(e.filter);
      if (json.includes('"scout"') && json.includes('skills')) return true;
    }
    return false;
  });
}

/**
 * Little Snuffler constraint: when the creature's attack is not defeated,
 * resources that require a scout in the target company cannot be played
 * for the rest of the turn. Drops play-short-event and play-permanent-event
 * actions whose card definition has scout-requiring effects.
 */
function applyDenyScoutResources(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  if (state.phaseState.phase !== Phase.Site) return base;
  const targetCompanyId = constraint.target.companyId;
  if (activeCompanyId(state) !== targetCompanyId) return base;

  return base.filter(ea => {
    const actionType = ea.action.type;
    if (actionType !== 'play-short-event' && actionType !== 'play-permanent-event') return true;
    const cardInstId = (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId;
    if (!cardInstId) return true;
    const def = resolveDef(state, cardInstId);
    if (!def) return true;
    const effects = getCardEffects(def);
    if (effects.length === 0 || !requiresScout(effects)) return true;
    logDetail(`Constraint ${constraint.id as string} (deny-scout-resources): dropping "${def.name}" — requires scout`);
    return false;
  });
}

/**
 * Compute legal actions for a `select-card-bearer` pending resolution.
 *
 * Offers one `select-card-bearer` action per untapped character in the
 * company. The resource player taps the chosen character to become the
 * bearer of the permanent event (adding a `bearer-cannot-untap` constraint).
 *
 * A `pass` action is also offered to allow declining the bearer assignment,
 * which discards the card.
 */
function selectCardBearerActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'select-card-bearer') return [];

  const { cardInstanceId, companyId } = top.kind;
  const actions: EvaluatedAction[] = [];

  const defPlayer = state.players.find(p =>
    p.companies.some(co => co.id === companyId),
  );
  if (!defPlayer) return [];

  const company = companyById(defPlayer.companies, companyId);
  if (!company) return [];

  const cardDefId = resolveInstanceId(state, cardInstanceId);
  const cardLabel = cardName(state, cardDefId!, '?');

  for (const charId of company.characters) {
    const ch = defPlayer.characters[charId as string];
    if (!ch || ch.status !== CardStatus.Untapped) continue;
    logDetail(`select-card-bearer: offering ${charId as string} as bearer for "${cardLabel}"`);
    actions.push({
      action: {
        type: 'select-card-bearer',
        player: actor,
        cardInstanceId,
        characterId: charId,
      },
      viable: true,
    });
  }

  // Always offer a pass so the player can decline and discard the card
  actions.push({ action: { type: 'pass', player: actor }, viable: true });

  return actions;
}

/**
 * Legal actions while a `discard-one-company-item` resolution is pending.
 *
 * The defending player must choose one item from any character in their
 * company to discard. One `discard-item-from-company` action is emitted
 * per available item.
 */
function discardOneCompanyItemActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'discard-one-company-item') return [];
  const { companyId } = top.kind;

  const defPlayer = state.players.find(p => p.companies.some(co => co.id === companyId));
  if (!defPlayer) return [];
  const company = companyById(defPlayer.companies, companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];
  for (const charId of company.characters) {
    const ch = defPlayer.characters[charId as string];
    if (!ch) continue;
    for (const item of ch.items) {
      const itemDef = defById(state, item.definitionId);
      const itemName = itemDef && 'name' in itemDef ? (itemDef as { name: string }).name : (item.instanceId as string);
      logDetail(`discard-one-company-item: offering ${itemName}`);
      actions.push({
        action: {
          type: 'discard-item-from-company' as const,
          player: actor,
          itemInstanceId: item.instanceId,
        },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Legal actions for a `hazard-event-maintenance` pending resolution.
 *
 * The hazard player must choose one of:
 * 1. Discard the permanent event itself from cardsInPlay (`discard-self`).
 * 2. Discard any matching card from hand (`discard-from-hand`), if available.
 *
 * At minimum, option 1 is always offered. Options 2 are offered for each
 * qualifying hand card that matches the effect's `handCardFilter`.
 */
function hazardEventMaintenanceActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'hazard-event-maintenance') return [];
  const { sourceInstanceId, sourceDefinitionId } = top.kind;

  // Look up the source effect's handCardFilter
  const sourceDef = defById(state, sourceDefinitionId);
  const handCardFilter = findHazardMaintenanceEffect(sourceDef)?.handCardFilter;

  const actions: EvaluatedAction[] = [];

  // Option 1: always offer discard-self
  actions.push({
    action: {
      type: 'pay-hazard-event-maintenance' as const,
      player: actor,
      paymentType: 'discard-self' as const,
      cardInstanceId: sourceInstanceId,
      sourceInstanceId,
    },
    viable: true,
  });

  // Option 2: offer each matching hand card as a payment alternative
  if (handCardFilter !== undefined) {
    const actorPlayer = playerById(state, actor);
    if (actorPlayer) {
      for (const handCard of actorPlayer.hand) {
        const handDef = defById(state, handCard.definitionId);
        if (!handDef) continue;
        if (!matchesDefinition(handDef, handCardFilter)) continue;
        logDetail(`hazard-event-maintenance: offering hand card ${handCard.definitionId as string} as payment`);
        actions.push({
          action: {
            type: 'pay-hazard-event-maintenance' as const,
            player: actor,
            paymentType: 'discard-from-hand' as const,
            cardInstanceId: handCard.instanceId,
            sourceInstanceId,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Compute the legal actions for a queued `ring-play-offer` resolution
 * (Rule 9.21). The player may play one special ring card from hand whose
 * category keyword matches an entry in `eligibleCategories`, or pass.
 *
 * Alignment must match: wizard gold rings may only be replaced with wizard
 * rings, and ringwraith gold rings with ringwraith rings. Fallen-wizard
 * exception is not yet in scope.
 */
function ringPlayOfferActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'ring-play-offer') return [];

  const { eligibleCategories } = top.kind;
  const actions: EvaluatedAction[] = [{ action: { type: 'pass', player: actor }, viable: true }];

  const player = playerById(state, actor);
  if (!player) return actions;

  for (const card of player.hand) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    // Must be a special ring (subtype 'special', keyword 'ring')
    if (!('subtype' in def) || (def as { subtype?: string }).subtype !== 'special') continue;
    const keywords: readonly string[] = ('keywords' in def && Array.isArray((def as { keywords?: unknown }).keywords))
      ? (def as unknown as { keywords: readonly string[] }).keywords
      : [];
    if (!keywords.includes('ring')) continue;
    // Find the ring's category from its keywords
    const category = (eligibleCategories as readonly string[]).find(cat => keywords.includes(cat)) as RingCategory | undefined;
    if (!category) continue;
    // Duplication-limit scope "character": skip if the target character already
    // holds the maximum number of copies of this ring (Rule text "Cannot be
    // duplicated on a given character").
    const charDupLimit = (def as unknown as { effects?: CardEffect[] }).effects?.find(
      (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'character',
    );
    if (charDupLimit) {
      const { characterInstanceId } = top.kind as { characterInstanceId: CardInstanceId };
      const targetChar = player.characters[characterInstanceId as string];
      const copiesOnChar = targetChar?.items.filter(item => {
        const iDef = defById(state, item.definitionId);
        return iDef?.name === def.name;
      }).length ?? 0;
      if (copiesOnChar >= charDupLimit.max) {
        logDetail(`ring-play-offer: ${def.name} blocked by duplication-limit on character (${copiesOnChar}/${charDupLimit.max})`);
        continue;
      }
    }
    logDetail(`ring-play-offer: offering ${def.name} (${card.instanceId as string}) — category ${category}`);
    actions.push({
      action: {
        type: 'play-ring-after-test' as const,
        player: actor,
        ringInstanceId: card.instanceId,
      },
      viable: true,
    });
  }

  return actions;
}

/** Compute eligible ring categories from a `ring-test-table` effect and a roll total. */
export function eligibleRingCategories(table: RingTestTableEffect['table'], rollTotal: number): readonly RingCategory[] {
  return table
    .filter(row => (row.min === null || rollTotal >= row.min) && (row.max === null || rollTotal <= row.max))
    .map(row => row.category);
}

/**
 * Compute the single `cvcc-ally-discard-roll` action for a queued ally-discard
 * resolution (Bow of the Galadhrim, as-68). The attacking player rolls 2d6;
 * if roll > ally.mind + threshold, the ally is discarded.
 */
function cvccAllyDiscardRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'cvcc-ally-discard-roll') return [];
  const { allyInstanceId, allyMind, threshold } = top.kind;

  // Find the ally definition for its name
  let allyName = allyInstanceId as string;
  for (let pi = 0; pi < 2; pi++) {
    for (const char of Object.values(state.players[pi].characters)) {
      const ally = char.allies.find(a => a.instanceId === allyInstanceId);
      if (ally) {
        const def = defById(state, ally.definitionId);
        allyName = (def as { name?: string })?.name ?? allyName;
        break;
      }
    }
  }

  const need = allyMind + threshold;
  logDetail(`Pending cvcc-ally-discard-roll for ally "${allyName}": roll must be > ${need} (mind ${allyMind} + threshold ${threshold})`);

  return [{
    action: {
      type: 'cvcc-ally-discard-roll' as const,
      player: playerId,
      allyInstanceId,
      explanation: `Roll for ${allyName}: discard if roll > ${need} (mind ${allyMind} + 5)`,
    },
    viable: true,
  }];
}

/**
 * Legal actions while a `tap-one-character` resolution is pending.
 *
 * The resource player must tap one untapped character in the company.
 * One `tap-character-by-effect` action is emitted per untapped character.
 * A `pass` action is always emitted (required when no untapped characters remain).
 */
function tapOneCharacterActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'tap-one-character') return [];
  const { companyId } = top.kind;

  const ownerPlayer = state.players.find(p => p.companies.some(co => co.id === companyId));
  if (!ownerPlayer) return [];
  const company = companyById(ownerPlayer.companies, companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];
  for (const charId of company.characters) {
    const ch = ownerPlayer.characters[charId as string];
    if (!ch || ch.status !== CardStatus.Untapped) continue;
    const charDef = defById(state, ch.definitionId);
    const charName = (charDef as { name?: string })?.name ?? (charId as string);
    logDetail(`tap-one-character: offering ${charName} to tap`);
    actions.push({
      action: {
        type: 'tap-character-by-effect' as const,
        player: actor,
        characterInstanceId: ch.instanceId,
      },
      viable: true,
    });
  }

  // pass is always available (required when no untapped characters exist)
  actions.push({ action: { type: 'pass' as const, player: actor }, viable: true });

  return actions;
}
