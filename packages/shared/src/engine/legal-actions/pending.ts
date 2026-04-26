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
import { isCharacterCard, isAllyCard, isFactionCard, Phase, CardStatus, matchesCondition, GENERAL_INFLUENCE } from '../../index.js';
import type { PlayOptionEffect, PlayTargetEffect, CardEffect } from '../../types/effects.js';
import { resolveInstanceId } from '../../types/state.js';
import { resolveDef, collectCharacterEffects, collectCompanyAllyEffects, resolveCheckModifier, resolveStatModifiers } from '../effects/index.js';
import type { ResolverContext, CollectedEffect } from '../effects/index.js';
import { buildPlayOptionContext } from './organization.js';
import { buildControllerInPlayNames, buildFactionPlayableAt } from '../recompute-derived.js';
import { logDetail } from './log.js';
import { canPayCost } from '../cost-evaluator.js';

/**
 * Collect check-modifier effects from a character's attached hazards only
 * (excluding the character's own definition to avoid double-counting with
 * the built-in corruptionModifier field).
 */
function collectHazardCheckModifiers(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  context: ResolverContext,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];
  for (const hazard of char.hazards) {
    const hDef = resolveDef(state, hazard.instanceId);
    if (!hDef || !('effects' in hDef) || !hDef.effects) continue;
    for (const effect of hDef.effects) {
      if (effect.type !== 'check-modifier') continue;
      if (effect.when && !matchesCondition(effect.when, context as unknown as Record<string, unknown>)) continue;
      results.push({ effect, sourceDef: hDef, sourceInstance: hazard.instanceId });
    }
  }
  return results;
}

/**
 * Collect check-modifier effects from a character's attached items only.
 * Items may carry effects that modify corruption / influence / etc. checks
 * (e.g. Wizard's Staff's "+2 to any corruption check required by a spell
 * card"). Effects are filtered by their `when` condition against the given
 * context, which typically includes `source.keywords` so items can key off
 * the triggering card's keywords.
 */
function collectItemCheckModifiers(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  context: ResolverContext,
): CollectedEffect[] {
  const results: CollectedEffect[] = [];
  for (const item of char.items) {
    const iDef = resolveDef(state, item.instanceId);
    if (!iDef || !('effects' in iDef) || !iDef.effects) continue;
    for (const effect of iDef.effects) {
      if (effect.type !== 'check-modifier') continue;
      if (effect.when && !matchesCondition(effect.when, context as unknown as Record<string, unknown>)) continue;
      results.push({ effect, sourceDef: iDef, sourceInstance: item.instanceId });
    }
  }
  return results;
}

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
    case 'call-of-home-roll':
      return callOfHomeRollActions(state, actor, top);
    case 'seized-by-terror-roll':
      return seizedByTerrorRollActions(state, actor, top);
    case 'gold-ring-test':
      return goldRingTestActions(state, actor, top);
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
  const activePlayerObj = state.players.find(p => p.id === state.activePlayer);
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
      const handCard = p.hand.find(c => c.instanceId === deferredAction.cardInstanceId);
      if (handCard) return state.cardPool[handCard.definitionId as string];
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
      const def = state.cardPool[ogCard.definitionId as string];
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

  actions.push(...cancelInfluenceActions(state, actor));

  return actions;
}

/**
 * Scan the defending player's hand for cancel-influence cards (e.g.
 * Wizard's Laughter) and generate one action per qualifying character
 * who can pay the cost.
 */
function cancelInfluenceActions(
  state: GameState,
  actor: PlayerId,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const playerIndex = state.players.findIndex(p => p.id === actor);
  if (playerIndex < 0) return actions;
  const player = state.players[playerIndex];

  for (const handCard of player.hand) {
    const def = resolveDef(state, handCard.instanceId);
    if (!def || !('effects' in def) || !def.effects) continue;

    const cancelEffect = (def.effects as CardEffect[]).find(e => e.type === 'cancel-influence');
    if (!cancelEffect || cancelEffect.type !== 'cancel-influence') continue;

    if (cancelEffect.requiredRace) {
      for (const company of player.companies) {
        for (const charId of company.characters) {
          const charData = player.characters[charId as string];
          if (!charData) continue;
          const charDef = resolveDef(state, charId);
          if (!charDef || !isCharacterCard(charDef)) continue;
          if (charDef.race !== cancelEffect.requiredRace) continue;

          logDetail(`Cancel-influence: ${charDef.name} (${cancelEffect.requiredRace}) can play ${def.name}`);
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

  const actorIndex = state.players.findIndex(p => p.id === playerId);
  if (actorIndex === -1) return [];
  const player = state.players[actorIndex];

  const def = state.cardPool[factionDefinitionId as string];
  if (!def || !isFactionCard(def)) return [];

  const charInPlay = player.characters[influencingCharacterId as string];
  if (!charInPlay) return [];

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const factionName = def.name;

  // Calculate influence modifier using current state (post-chain effects)
  let modifier = 0;
  const parts: string[] = [];

  if (charDef && isCharacterCard(charDef)) {
    modifier += charDef.directInfluence;
    parts.push(`DI ${charDef.directInfluence}`);

    const resolverCtx: ResolverContext = {
      reason: 'faction-influence-check',
      bearer: {
        race: charDef.race,
        skills: charDef.skills,
        baseProwess: charDef.prowess,
        baseBody: charDef.body,
        baseDirectInfluence: charDef.directInfluence,
        name: charDef.name,
      },
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
        if (effect.when && !matchesCondition(effect.when, resolverCtx as unknown as Record<string, unknown>)) continue;
        charEffects.push({ effect, sourceDef: def, sourceInstance: factionInstanceId });
      }
    }

    const dslModifier = resolveCheckModifier(charEffects, 'influence');
    if (dslModifier !== 0) {
      modifier += dslModifier;
      parts.push(`check mod ${dslModifier >= 0 ? '+' : ''}${dslModifier}`);
    }

    const dslDI = resolveStatModifiers(charEffects, 'direct-influence', 0, resolverCtx);
    if (dslDI !== 0) {
      modifier += dslDI;
      parts.push(`DI mod ${dslDI >= 0 ? '+' : ''}${dslDI}`);
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
      explanation: `${charName} influences ${factionName}: need roll >= ${need} (influence # ${influenceNumber}, modifier ${modifier >= 0 ? '+' : ''}${modifier}${modStr})`,
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

  const actorIndex = state.players.findIndex(p => p.id === playerId);
  if (actorIndex === -1) return [];
  const player = state.players[actorIndex];

  const def = state.cardPool[factionDefinitionId as string];
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

  const actorIndex = state.players.findIndex(p => p.id === playerId);
  if (actorIndex === -1) return [];
  const player = state.players[actorIndex];

  const charInPlay = player.characters[targetCharacterId as string];
  if (!charInPlay) return [];

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const hazardDef = state.cardPool[hazardDefinitionId as string];
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

  const actorIndex = state.players.findIndex(p => p.id === playerId);
  if (actorIndex === -1) return [];
  const player = state.players[actorIndex];

  const charInPlay = player.characters[targetCharacterId as string];
  if (!charInPlay) return [];

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const hazardDef = state.cardPool[hazardDefinitionId as string];
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

  const actorIndex = state.players.findIndex(p => p.id === playerId);
  if (actorIndex === -1) return [];
  const player = state.players[actorIndex];

  const ringCard = player.outOfPlayPile.find(c => c.instanceId === goldRingInstanceId);
  const ringDef = ringCard ? state.cardPool[ringCard.definitionId as string] : undefined;
  const ringName = ringDef?.name ?? '?';
  const modSign = rollModifier >= 0 ? '+' : '';
  logDetail(`Pending gold-ring-test for ${ringName}: roll 2d6 ${modSign}${rollModifier}`);

  return [{
    action: {
      type: 'gold-ring-test-roll' as const,
      player: playerId,
      goldRingInstanceId,
      rollModifier,
      explanation: `Gold-ring auto-test for ${ringName}: 2d6 ${modSign}${rollModifier}`,
    },
    viable: true,
  }];
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
  const actorIndex = state.players.findIndex(p => p.id === playerId);
  if (actorIndex === -1) return [];
  const player = state.players[actorIndex];
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

  // Built-in character corruption modifier (canonical source — many character
  // defs duplicate this as a check-modifier effect, so we ignore effects on
  // the character's own definition to avoid double-counting).
  const baseModifier = isCharacterCard(charDef) ? charDef.corruptionModifier : 0;

  // The producing effect's own modifier (e.g. Barrow-wight's -2)
  let totalModifier = baseModifier + modifier;

  // Add one-shot `check-modifier` constraints targeting this character and
  // keyed to corruption checks (e.g. Halfling Strength +4). Generic enough
  // that any future card granting a one-shot corruption / influence / other
  // check bonus reuses the same constraint machinery.
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'check-modifier') continue;
    if (constraint.kind.check !== 'corruption') continue;
    if (constraint.target.kind !== 'character') continue;
    if (constraint.target.characterId !== characterId) continue;
    totalModifier += constraint.kind.value;
    logDetail(`One-shot check-modifier ${constraint.kind.value >= 0 ? '+' : ''}${constraint.kind.value} from constraint ${constraint.id}`);
  }

  // Build the source-card keyword list so item check-modifiers can gate
  // on what produced the check (e.g. Wizard's Staff keys off source.keywords
  // $includes 'spell'). The source is the PendingResolution's source card.
  const sourceDef = top.source ? resolveDef(state, top.source) : undefined;
  const sourceKeywords: readonly string[] = sourceDef && 'keywords' in sourceDef && Array.isArray((sourceDef as { keywords?: readonly string[] }).keywords)
    ? (sourceDef as { keywords: readonly string[] }).keywords
    : [];
  const checkContext = { reason: 'corruption-check', source: { keywords: sourceKeywords } };

  // DSL check-modifier effects from attached hazards only (not the
  // character's own definition — that's already in baseModifier).
  const hazardEffects = collectHazardCheckModifiers(state, char, checkContext);
  if (hazardEffects.length > 0) {
    const company = player.companies.find(c => c.characters.includes(characterId));
    const companyCharCount = company ? company.characters.length : 1;
    const dslModifier = resolveCheckModifier(hazardEffects, 'corruption', { company: { characterCount: companyCharCount } });
    if (dslModifier !== 0) {
      totalModifier += dslModifier;
      logDetail(`DSL check-modifier ${dslModifier >= 0 ? '+' : ''}${dslModifier} from attached hazards (company size: ${companyCharCount})`);
    }
  }

  // DSL check-modifier effects from the character's items (e.g. Wizard's
  // Staff's "+2 to any corruption check required by a spell card"). Items
  // see the same context as hazards so they can key on the triggering
  // card's keywords via `{ "source.keywords": { "$includes": "spell" } }`.
  const itemEffects = collectItemCheckModifiers(state, char, checkContext);
  if (itemEffects.length > 0) {
    const dslModifier = resolveCheckModifier(itemEffects, 'corruption');
    if (dslModifier !== 0) {
      totalModifier += dslModifier;
      logDetail(`DSL check-modifier ${dslModifier >= 0 ? '+' : ''}${dslModifier} from attached items (source keywords: [${sourceKeywords.join(', ')}])`);
    }
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
    const transferredDefId = resolveInstanceId(state, transferredItemId);
    const transferredDef = transferredDefId ? state.cardPool[transferredDefId as string] : undefined;
    if (transferredDef && 'corruptionPoints' in transferredDef) {
      cp += (transferredDef as { corruptionPoints: number }).corruptionPoints;
    }
  }

  const ccNeed = cp + 1 - totalModifier;
  const parts = [`CP ${cp}`];
  if (totalModifier !== 0) parts.push(`modifier ${totalModifier >= 0 ? '+' : ''}${totalModifier}`);
  logDetail(`Pending corruption check for ${charName} (${reason}: CP ${cp}, modifier ${totalModifier >= 0 ? '+' : ''}${totalModifier}, ${possessions.length} possession(s))`);

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
  const actorIndex = state.players.findIndex(p => p.id === playerId);
  if (actorIndex === -1) return actions;
  const player = state.players[actorIndex];

  const ctx = buildPlayOptionContext(state, targetChar, player);

  for (const handCard of player.hand) {
    const def = state.cardPool[handCard.definitionId as string];
    if (!def || def.cardType !== 'hero-resource-event') continue;
    const shortDef = def;
    if (shortDef.eventType !== 'short') continue;
    const effects = shortDef.effects;
    if (!effects) continue;

    const playTarget = effects.find(
      (e): e is PlayTargetEffect => e.type === 'play-target',
    );
    if (!playTarget || playTarget.target !== 'character') continue;
    if (playTarget.filter && !matchesCondition(playTarget.filter, ctx)) continue;

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
    case 'hand-size-modifier':
      // Consumed directly by `resolveHandSize` — no legal-action filtering needed.
      return base;
    case 'creature-attack-boost':
      // Consumed directly by `resolveAttackProwess`/`resolveAttackStrikes` —
      // no legal-action filtering needed here.
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
    const player = state.players.find(p => p.id === state.activePlayer);
    if (!player) return null;
    return player.companies[sps.activeCompanyIndex]?.id ?? null;
  }
  if (ps.phase === Phase.MovementHazard) {
    const mps = ps;
    if (state.activePlayer === null) return null;
    const player = state.players.find(p => p.id === state.activePlayer);
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

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return base;
  const player = state.players[playerIndex];
  const targetCompanyId = constraint.target.companyId;
  const company = player.companies.find(c => c.id === targetCompanyId);
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
    const defId = resolveInstanceId(state, cardInstId);
    const def = defId ? state.cardPool[defId as string] : undefined;
    if (!def || def.cardType !== 'hazard-creature') return true;
    logDetail(`Constraint ${constraint.id as string} (no-creature-hazards-on-company): dropping creature play "${def.name}" against protected company ${protectedCompany as string}`);
    return false;
  });
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
    const defId = resolveInstanceId(state, cardInstId);
    const def = defId ? state.cardPool[defId as string] : undefined;
    if (!def || !('effects' in def) || !def.effects) return true;
    if (!requiresScout(def.effects)) return true;
    logDetail(`Constraint ${constraint.id as string} (deny-scout-resources): dropping "${def.name}" — requires scout`);
    return false;
  });
}
