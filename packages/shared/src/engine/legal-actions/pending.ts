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
  CardDefinition,
  PlayerState,
  Company,
} from '../../index.js';
import { matchesCondition, matchesContext } from '../../effects/condition-matcher.js';
import { formatSignedNumber } from '../../format-helpers.js';
import { isCharacterCard, isAllyCard, isFactionCard, isAvatarCharacter, isSiteCard, isResourceEventCard, isItemCard, printedMind } from '../../types/cards.js';
import { CardStatus, Skill, SiteType, Race, cardStatusToName } from '../../types/common.js';
import type { CardDefinitionId } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import type { PlayOptionEffect, PlayTargetEffect, CardEffect, RingTestTableEffect, RingCategory } from '../../types/effects.js';
import { resolveInstanceId } from '../../types/state.js';
import type { OpponentInfluenceAttempt } from '../../types/pending.js';
import { characterPossessions, constraintFromCard } from '../pending.js';
import { buildBearerContext, resolveDef, collectCharacterEffects, collectCompanyAllyEffects, checkConditionalEffects, resolveCheckModifier, resolveStatModifiers, getEffectiveSkills } from '../effects/index.js';
import type { ResolverContext } from '../effects/index.js';
import { buildPlayOptionContext, availableDI, normalUnusedDI, modifyCorruptionCheckGrantActions } from './organization.js';
import { logDetail } from './log.js';
import { canPayCost } from '../cost-evaluator.js';
import { cardName, matchesDefinition, findCharacterCompany, riddlingCompanyBonus, findById, findAttachment, playerById, activePlayerState, getCardEffects, companyById, countCopiesInPlay, defById, findEventMaintenanceEffect, findDuplicationLimitEffect, effectiveGeneralInfluence, generalInfluenceControlLimit, defNamesOf, itemKeywordsOf, itemSubtypesOf, collectGlobalCheckModifier, influenceModificationsNullified, characterHomeSiteRegions, siteRegionTypeOf, deckSearchCancellerFor, buildFactionCheckContext, buildFactionControllerContext } from '../reducer-utils.js';
import { isBalrogAvatarDef } from '../../state-utils.js';
import { effectiveItemCorruptionPoints } from '../../item-corruption.js';
import { afterAttackPlayTargets } from '../post-attack-play.js';
import { findDiscardSubstitutes, substituteCovers } from '../discard-substitute.js';
import { asViable as viable } from './evaluated.js';
import { influenceOverflowAmount, influenceOverflowStep } from '../influence-overflow.js';
import { grantedAction } from './granted-action-emit.js';
import { revealAgentActions } from './movement-hazard.js';
import type { RevealAgentAction } from '../../types/actions-movement-hazard.js';
import { findHuntCandidates } from '../hunt.js';


/**
 * Legal actions while a `stay-her-appetite-roll` pending resolution is at the
 * top of the queue. The hazard player rolls 2d6 to see if the ally detainment
 * attack triggers.
 */
export function stayHerAppetiteRollActions(
  state: GameState,
  actor: PlayerId,
  _top: PendingResolution,
): EvaluatedAction[] {
  const isHazardPlayer = state.activePlayer !== actor;
  if (!isHazardPlayer) return [];
  return viable([{ type: 'stay-her-appetite-roll', player: actor }]);
}

/**
 * Legal actions while a `transfer-returned-item` resolution is at the head of
 * the queue (Pilfer Anything Unwatched as-33). The returned character's owner
 * may transfer one of the discarded items to a company-mate, or decline. Emits
 * one action per `(item, mate)` pair plus a single decline action.
 */
export function transferReturnedItemActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'transfer-returned-item') return [];
  const kind = top.kind;
  const owner = state.players[kind.ownerPlayerIndex];
  if (!owner || owner.id !== actor) return [];

  const actions: EvaluatedAction[] = [];
  // Always allow declining ("may be transferred").
  actions.push({ action: { type: 'transfer-returned-item', player: actor }, viable: true });

  const company = owner.companies.find(c => c.id === kind.companyId);
  if (!company) return actions;

  for (const itemId of kind.itemInstanceIds) {
    const inst = owner.discardPile.find(c => c.instanceId === itemId);
    if (!inst) continue;
    const itemDef = defById(state, inst.definitionId);
    if (!isItemCard(itemDef)) continue;
    const itemName = itemDef?.name ?? (itemId as string);
    for (const mateId of company.characters) {
      logDetail(`transfer-returned-item: offering ${itemName} → ${mateId as string}`);
      actions.push({
        action: { type: 'transfer-returned-item', player: actor, itemInstanceId: itemId, targetCharacterId: mateId },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Decide whether a character-targeting hazard event revealed from on-guard
 * may legally land on `charId`.
 *
 * Revealing an on-guard card is still a play of that card (CoE 2.V.6), so the
 * same gates the movement/hazard phase applies to a hand play apply here: the
 * card's `play-target` filter (e.g. Lure of Expedience's non-Ringwraith,
 * non-Wizard, non-Hobbit restriction) and its `duplication-limit` (per
 * character, or per company for a character-attached card).
 */
function onGuardCharTargetEligible(
  state: GameState,
  def: CardDefinition,
  playTarget: PlayTargetEffect,
  resourcePlayer: PlayerState,
  company: Company,
  charId: CardInstanceId,
): boolean {
  const charData = resourcePlayer.characters[charId];
  if (!charData) return false;
  const charDef = defById(state, charData.definitionId);
  if (!charDef || !isCharacterCard(charDef)) return false;
  const charLabel = charDef.name;

  if (playTarget.filter) {
    const siteInst = company.currentSite ?? null;
    const siteDef = siteInst ? defById(state, siteInst.definitionId) : undefined;
    const siteType = siteDef && isSiteCard(siteDef) ? siteDef.siteType : null;
    const ctx = {
      target: {
        cardType: charDef.cardType,
        race: charDef.race,
        skills: charDef.skills,
        name: charDef.name,
        mind: charDef.mind,
        possessions: defNamesOf(state, charData.items),
        itemKeywords: itemKeywordsOf(state, charData.items),
        itemSubtypes: itemSubtypesOf(state, charData.items),
      },
      company: { siteType, atHaven: siteType === SiteType.Haven },
    };
    if (!matchesCondition(playTarget.filter, ctx)) {
      logDetail(`On-guard window: "${def.name}" filter excludes ${charLabel}`);
      return false;
    }
  }

  const copiesOn = (targetCharId: CardInstanceId): number => {
    const target = resourcePlayer.characters[targetCharId];
    if (!target) return 0;
    return target.hazards.filter(h => defById(state, h.definitionId)?.name === def.name).length;
  };

  const charDupLimit = findDuplicationLimitEffect(def, 'character');
  if (charDupLimit && copiesOn(charId) >= charDupLimit.max) {
    logDetail(`On-guard window: "${def.name}" already on ${charLabel} (${copiesOn(charId)}/${charDupLimit.max})`);
    return false;
  }

  const companyDupLimit = findDuplicationLimitEffect(def, 'company');
  if (companyDupLimit) {
    const copiesInCompany = company.characters.reduce((sum, cId) => sum + copiesOn(cId), 0);
    if (copiesInCompany >= companyDupLimit.max) {
      logDetail(`On-guard window: "${def.name}" already in ${charLabel}'s company (${copiesInCompany}/${companyDupLimit.max})`);
      return false;
    }
  }

  return true;
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
export function onGuardWindowActions(
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

  // Here Is a Snake! (dm-137): "including on-guard cards" — once an
  // only-revealed-hazards-on-company constraint has narrowed this company to
  // a specific allow-list, on-guard cards outside it may not be revealed
  // either. Checked here rather than via the generic `applyConstraints` post-filter:
  // computeLegalActions short-circuits straight to `resolutionLegalActions`
  // while ANY pending resolution (like this on-guard-window) is queued for the
  // actor, so `applyConstraints` — which only wraps the phase-switch branch —
  // never runs on this function's output.
  const onlyRevealedConstraint = company && state.activeConstraints.find(
    c => c.kind.type === 'only-revealed-hazards-on-company'
      && c.target.kind === 'company' && c.target.companyId === company.id,
  );

  if (company) {
    for (const ogCard of company.onGuardCards) {
      if (ogCard.revealed) continue;
      const def = defById(state, ogCard.definitionId);
      if (!def) continue;
      if (def.cardType !== 'hazard-event') continue;
      if (onlyRevealedConstraint && onlyRevealedConstraint.kind.type === 'only-revealed-hazards-on-company'
        && !onlyRevealedConstraint.kind.allowedInstanceIds.includes(ogCard.instanceId)) {
        logDetail(`On-guard window: "${def.name}" not in Here Is a Snake!'s revealed set (constraint ${onlyRevealedConstraint.id as string}) — skipping`);
        continue;
      }

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
        if (trigger === 'resource-play') {
          // Optional playedFilter (Heedless Revelry le-114): the reveal is
          // legal only if the deferred played card's definition matches
          // (e.g. items and allies only, not short events or characters).
          const playedFilter = (e as { playedFilter?: import('../../types/effects.js').Condition }).playedFilter;
          if (!playedFilter) return true;
          if (!deferredSource) return false;
          const matches = matchesCondition(playedFilter, deferredSource as unknown as Record<string, unknown>);
          if (!matches) {
            logDetail(`On-guard window: "${def.name}" playedFilter does not match deferred "${deferredSource.name}" (${deferredSource.cardType})`);
          }
          return matches;
        }
        // `influence-attempt` reveals happen on the influence chain
        // (`onGuardRevealChainActions` in legal-actions/chain.ts), never in
        // this resource-play window — an influence attempt does not enqueue
        // an on-guard-window resolution.
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
      const playTarget = ogEffects.find((e): e is PlayTargetEffect => e.type === 'play-target');
      if (playTarget?.target === 'character') {
        // A reveal is a play (rule 2.V.6): the card's own play-target filter
        // and duplication limit still gate which characters it may land on —
        // e.g. Lure of Expedience cannot be revealed onto a Wizard, a Hobbit,
        // a Ringwraith, or a character already carrying a copy.
        for (const charId of company.characters) {
          if (!onGuardCharTargetEligible(state, def, playTarget, activePlayerObj, company, charId)) continue;
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
export function opponentInfluenceDefendActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'opponent-influence-defend') return [];
  const { attempt } = top.kind;

  const influencerDef = resolveDef(state, attempt.influencerId);
  const influencerName = influencerDef && isCharacterCard(influencerDef) ? influencerDef.name : '?';

  const targetDef = resolveDef(state, attempt.targetInstanceId);
  const targetName = targetDef && (isCharacterCard(targetDef) || isAllyCard(targetDef) || isFactionCard(targetDef) || isItemCard(targetDef))
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
  if (attempt.regionPenalty && attempt.regionPenalty !== 0) {
    parts.push(`Region penalty: -${attempt.regionPenalty}`);
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
            const charData = player.characters[charId];
            if (!charData) continue;
            const charDef = resolveDef(state, charId);
            if (!charDef || !isCharacterCard(charDef)) continue;

            // Check race restriction
            if (cancelEffect.requiredRace && charDef.race !== cancelEffect.requiredRace) continue;

            // Check skill restriction (character's innate skills + item-granted skills)
            if (cancelEffect.requiredSkill) {
              const allSkills = getEffectiveSkills(state, charData, charDef);
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
export function factionInfluenceRollActions(
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

  const charInPlay = player.characters[influencingCharacterId];
  // The influencer may be a character or an ally that "influences factions as
  // if a character" (Radagast's Black Bird wh-114).
  const influencerAlly = charInPlay ? null : findAttachment(player, 'allies', influencingCharacterId);
  if (!charInPlay && !influencerAlly) {
    // The influencer left play before the roll. Offer the resolution anyway —
    // the resolver fails the attempt and discards the faction. Returning no
    // actions would deadlock the game outright: this resolution's chain entry
    // is still unresolved, and a chain in `resolving` mode offers no actions
    // of its own, so nothing would ever call `reduce` to advance it.
    logDetail(`Pending faction-influence-roll for ${def.name}: influencer no longer in play — attempt fails automatically`);
    return [{
      action: {
        type: 'faction-influence-roll' as const,
        player: playerId,
        factionInstanceId,
        influencingCharacterId,
        // No 2d6 total can reach this: the check cannot be made at all.
        need: 13,
        explanation: `${def.name}: the influencing character is no longer in play — the attempt fails and the faction is discarded`,
      },
      viable: true,
    }];
  }

  const charDef = defById(state, (charInPlay ?? influencerAlly!.attachment).definitionId);
  const charName = (isCharacterCard(charDef) || isAllyCard(charDef)) ? charDef.name : '?';
  const factionName = def.name;

  // Calculate influence modifier using current state (post-chain effects)
  let modifier = 0;
  const parts: string[] = [];

  // Webs of Fear & Treachery (le-150): every card-sourced modification to this
  // attempt is reduced to zero (see `influenceModificationsNullified`).
  const nullifyMods = influenceModificationsNullified(state);

  if (charInPlay && charDef && isCharacterCard(charDef)) {
    const resolverCtx: ResolverContext = {
      ...buildFactionCheckContext(state, def),
      bearer: {
        ...buildBearerContext(charDef),
        stagePoints: player.stagePoints,
        homesiteRegions: characterHomeSiteRegions(state, charDef),
      },
      // Includes `controller.wizard`, which this pending-roll path previously
      // omitted — the declare-time `need` computation (legal-actions/site.ts)
      // and the resolution (reducer-site.ts) both carry it, so a
      // wizard-conditioned faction standard (wh-37/38/40) now prices the
      // pending roll identically instead of drifting from the declared need.
      controller: buildFactionControllerContext(state, playerId),
    };

    const ownEffects = collectCharacterEffects(state, charInPlay, resolverCtx);
    const charEffects = [...ownEffects];
    charEffects.push(...collectCompanyAllyEffects(state, charInPlay, resolverCtx));

    if (def.effects) {
      for (const effect of def.effects) {
        if (effect.when && !matchesContext(effect.when, resolverCtx)) continue;
        charEffects.push({ effect, sourceDef: def, sourceInstance: factionInstanceId });
      }
    }

    // Under nullification only the influencer's own card text counts
    // (distinct from `ownEffects`, which is every effect collected for him).
    const ownCardEffects = charEffects.filter(e => e.sourceInstance === influencingCharacterId);

    const freeDI = nullifyMods
      ? normalUnusedDI(state, influencingCharacterId, player, ownCardEffects, resolverCtx)
      : availableDI(state, influencingCharacterId, player);
    modifier += freeDI;
    parts.push(nullifyMods ? `normal DI ${freeDI}` : `DI ${freeDI}`);

    const dslModifier = resolveCheckModifier(nullifyMods ? ownCardEffects : charEffects, 'influence');
    if (dslModifier !== 0) {
      modifier += dslModifier;
      parts.push(`check mod ${formatSignedNumber(dslModifier)}`);
    }

    // `freeDI` already carries the influencer's effective DI, so only the
    // faction-conditional modifiers borne by the character are added here
    // (see `checkConditionalEffects`). Under a le-150 nullification every
    // card-sourced modification is stripped — the influencer's own ones are
    // already inside `freeDI`.
    const diEffects = [
      ...checkConditionalEffects(ownEffects),
      ...charEffects.slice(ownEffects.length),
    ];
    const dslDI = nullifyMods ? 0 : resolveStatModifiers(diEffects, 'direct-influence', 0, resolverCtx);
    if (dslDI !== 0) {
      modifier += dslDI;
      parts.push(`DI mod ${formatSignedNumber(dslDI)}`);
    }

    // One-shot check-modifier constraints for influence (e.g. Muster): must match the pending roll
    for (const constraint of nullifyMods ? [] : state.activeConstraints) {
      if (constraint.kind.type !== 'check-modifier') continue;
      if (constraint.kind.check !== 'influence') continue;
      if (constraint.target.kind !== 'character') continue;
      if (constraint.target.characterId !== influencingCharacterId) continue;
      if (constraint.kind.prowessSubstitution) {
        // Threats (le-244): unused DI is replaced by min(prowess, max).
        const effectiveProwess = charInPlay.effectiveStats.prowess;
        const substituted = Math.min(constraint.kind.prowessSubstitution.max, effectiveProwess);
        modifier += substituted - freeDI - dslDI;
        parts.push(`prowess ${substituted} replaces DI ${freeDI + dslDI}`);
        continue;
      }
      modifier += constraint.kind.value;
      parts.push(`constraint ${formatSignedNumber(constraint.kind.value)}`);
    }
  } else if (influencerAlly && charDef && isAllyCard(charDef)) {
    // Ally influencing "as if a character" (Radagast's Black Bird wh-114): its
    // printed direct influence plus any player-scoped influence bonuses.
    const allyDI = charDef.directInfluence ?? 0;
    modifier += allyDI;
    parts.push(`DI ${allyDI}`);

    for (const constraint of nullifyMods ? [] : state.activeConstraints) {
      if (constraint.kind.type !== 'check-modifier') continue;
      if (constraint.kind.check !== 'influence') continue;
      if (constraint.target.kind !== 'player') continue;
      if (constraint.target.playerId !== playerId) continue;
      modifier += constraint.kind.value;
      parts.push(`player-wide ${formatSignedNumber(constraint.kind.value)}`);
    }
  }

  // Game-wide ongoing influence modifier from a bare in-play event owned by
  // either player (Times Are Evil td-76: "All … influence attempts are modified
  // by -3"). Applies to every influence attempt regardless of the influencer.
  // The context carries the faction being influenced so a game-wide modifier
  // can be race-gated (Lord of the Carrock as-14). Webs of Fear & Treachery
  // (le-150) nullifies every card-sourced modification, so the gate wins.
  const globalInfluenceMod = nullifyMods
    ? 0
    : collectGlobalCheckModifier(state, 'influence', buildFactionCheckContext(state, def));
  if (globalInfluenceMod !== 0) {
    modifier += globalInfluenceMod;
    parts.push(`game-wide ${formatSignedNumber(globalInfluenceMod)}`);
  }
  if (nullifyMods) parts.push('all other modifications nullified');

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
 * Compute the single `resolve-dice-check` action for a queued generic
 * `dice-check` resolution (P08). Sums the kind's modifiers for the UI
 * breakdown (same computation the resolver does) and emits one roll action.
 */
export function diceCheckActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'dice-check') return [];
  const kind = top.kind;

  let mod = 0;
  for (const m of kind.modifiers) {
    if (m.kind === 'constant') {
      mod += m.value;
    } else {
      const p = playerById(state, m.player);
      if (p) mod += effectiveGeneralInfluence(state, m.player) - p.generalInfluenceUsed;
    }
  }
  const cmp = kind.comparison === 'gt' ? '>' : '>=';
  const need = kind.threshold - mod;
  const modText = mod ? ` ${mod >= 0 ? '+' : ''}${mod}` : '';

  logDetail(`Pending dice-check "${kind.label}": need 2d6 ${cmp} ${need} (threshold ${kind.threshold}, modifiers${modText || ' 0'})`);

  return [{
    action: {
      type: 'resolve-dice-check' as const,
      player: playerId,
      explanation: `${kind.label}: roll${modText} must be ${cmp} ${kind.threshold} (need roll ${cmp} ${need})`,
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
export function flateryAttemptRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'flattery-attempt') return [];
  const { characterInstanceId, creatureRace, threshold, diplomatBonus } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const charInPlay = player.characters[characterInstanceId];
  if (!charInPlay) {
    // The character left play (e.g. eliminated by a chain response) before
    // the roll. Offer the resolution anyway — the resolver fails the attempt
    // and resumes the chain. Returning no actions would deadlock the game:
    // the chain is in 'resolving' mode and offers no actions of its own
    // (same failure mode as the faction-influence-roll emitter above).
    logDetail(`Pending flattery-attempt vs "${creatureRace}": character no longer in play — the attempt fails automatically`);
    return [{
      action: {
        type: 'flattery-attempt' as const,
        player: playerId,
        characterInstanceId,
        // No 2d6 total can reach this: the attempt cannot be made at all.
        need: 13,
        explanation: `Flattery vs ${creatureRace}: the attempting character is no longer in play — the attempt fails`,
      },
      viable: true,
    }];
  }

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
 * Compute the single riddling-attempt action for a queued `riddling-attempt`
 * resolution. The defending player rolls 2d6; total = roll + sageBonus per
 * Sage in the company + hobbitBonus per Hobbit in the company. Success if
 * total > threshold (the roll threshold varies by creature race).
 */
export function riddlingAttemptRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'riddling-attempt') return [];
  const { characterInstanceId, creatureRace, threshold, sageBonus, hobbitBonus } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const charInPlay = player.characters[characterInstanceId];
  if (!charInPlay) {
    // Character gone before the roll — offer a failing resolution instead of
    // no actions, which would deadlock the resolving chain (see the
    // flattery-attempt emitter above).
    logDetail(`Pending riddling-attempt vs "${creatureRace}": character no longer in play — the attempt fails automatically`);
    return [{
      action: {
        type: 'riddling-attempt' as const,
        player: playerId,
        characterInstanceId,
        // No 2d6 total can reach this: the attempt cannot be made at all.
        need: 13,
        explanation: `Riddling vs ${creatureRace}: the attempting character is no longer in play — the attempt fails`,
      },
      viable: true,
    }];
  }

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : '?';

  const { sages, hobbits, bonus } = riddlingCompanyBonus(state, player, characterInstanceId, sageBonus, hobbitBonus);

  // Success requires: roll + bonus > threshold, i.e. roll > threshold - bonus
  const need = threshold - bonus + 1;

  logDetail(`Pending riddling-attempt by ${charName} vs "${creatureRace}": threshold ${threshold}, ${sages} sage(s) x${sageBonus} + ${hobbits} hobbit(s) x${hobbitBonus} = +${bonus} → need roll >= ${need}`);

  return [{
    action: {
      type: 'riddling-attempt' as const,
      player: playerId,
      characterInstanceId,
      need,
      explanation: `${charName} riddling vs ${creatureRace}: threshold ${threshold}, bonus +${bonus} → need roll >= ${need}`,
    },
    viable: true,
  }];
}

/**
 * Compute the single burglary-attempt action for a queued `burglary-attempt`
 * resolution (Burglary, td-103). The player rolls 2d6; total = roll +
 * `scoutBonus` if the character has the Scout skill + `hobbitBonus` if he is
 * a Hobbit. Success if total > threshold.
 */
export function burglaryAttemptRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'burglary-attempt') return [];
  const { characterInstanceId, threshold, scoutBonus, hobbitBonus } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const charInPlay = player.characters[characterInstanceId];
  if (!charInPlay) {
    // Character gone before the roll — offer a failing resolution instead of
    // no actions, which would deadlock the pending queue (see the
    // flattery-attempt emitter above).
    logDetail(`Pending burglary-attempt: character no longer in play — the attempt fails automatically`);
    return [{
      action: {
        type: 'burglary-attempt' as const,
        player: playerId,
        characterInstanceId,
        // No 2d6 total can reach this: the attempt cannot be made at all.
        need: 13,
        explanation: `Burglary: the attempting character is no longer in play — the attempt fails`,
      },
      viable: true,
    }];
  }

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const isScout = isCharacterCard(charDef) && charDef.skills.includes(Skill.Scout);
  const isHobbit = isCharacterCard(charDef) && charDef.race === Race.Hobbit;
  const bonus = (isScout ? scoutBonus : 0) + (isHobbit ? hobbitBonus : 0);

  // Success requires: roll + bonus > threshold, i.e. roll > threshold - bonus
  const need = threshold - bonus + 1;

  logDetail(`Pending burglary-attempt by ${charName}: threshold ${threshold}${isScout ? `, +${scoutBonus} scout` : ''}${isHobbit ? `, +${hobbitBonus} hobbit` : ''} → need roll >= ${need}`);

  return [{
    action: {
      type: 'burglary-attempt' as const,
      player: playerId,
      characterInstanceId,
      need,
      explanation: `${charName} burglary: threshold ${threshold}, bonus +${bonus} → need roll >= ${need}`,
    },
    viable: true,
  }];
}

/**
 * Compute the riddling-guess actions for a queued `riddling-guess`
 * resolution (Riddling Talk, td-148), following a successful riddling roll.
 * One action per distinct card name among hazard-event / hazard-creature
 * definitions in the card pool — the player names any card, blind, hoping
 * it turns out to be in the opponent's hand (revealed on resolution).
 */
export function riddlingGuessActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'riddling-guess') return [];

  const names = new Set<string>();
  for (const def of Object.values(state.cardPool)) {
    if (def.cardType === 'hazard-event' || def.cardType === 'hazard-creature') {
      names.add(def.name);
    }
  }

  return Array.from(names).sort().map(guessedCardName => ({
    action: {
      type: 'riddling-guess' as const,
      player: playerId,
      guessedCardName,
      explanation: `Name "${guessedCardName}"`,
    },
    viable: true,
  }));
}

/**
 * Compute the goodwill-attempt actions for a queued `goodwill-attempt`
 * resolution (Token of Goodwill, dm-160). One action per company item
 * matching the queued rank — the player picks which item to discard, and
 * the roll (2d6 + unused DI) happens as part of the same action. Success if
 * total > threshold.
 */
export function goodwillAttemptRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'goodwill-attempt') return [];
  const { characterInstanceId, companyId, itemSubtype, threshold } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const charInPlay = player.characters[characterInstanceId];
  const company = charInPlay ? companyById(player.companies, companyId) : null;

  if (charInPlay && company) {
    const charDef = defById(state, charInPlay.definitionId);
    const charName = isCharacterCard(charDef) ? charDef.name : '?';
    const unusedDI = availableDI(state, characterInstanceId, player);

    // Success requires: roll + unusedDI > threshold, i.e. roll > threshold - unusedDI
    const need = threshold - unusedDI + 1;
    const explanation = `${charName} goodwill: threshold ${threshold}, unused DI ${unusedDI} → need roll >= ${need}`;

    const actions: EvaluatedAction[] = [];
    for (const charId of company.characters) {
      const bearer = player.characters[charId];
      if (!bearer) continue;
      for (const item of bearer.items) {
        const itemDef = defById(state, item.definitionId);
        if (!itemDef || !isItemCard(itemDef) || itemDef.subtype !== itemSubtype) continue;
        logDetail(`Pending goodwill-attempt by ${charName}: offering to discard "${itemDef.name}" (${itemSubtype}) — ${explanation}`);
        actions.push({
          action: {
            type: 'goodwill-attempt' as const,
            player: playerId,
            characterInstanceId,
            itemInstanceId: item.instanceId,
            need,
            explanation: `${explanation} (discard ${itemDef.name})`,
          },
          viable: true,
        });
      }
    }
    if (actions.length > 0) return actions;
  }

  // The diplomat left play, the company disbanded, or no item of the queued
  // rank remains to discard as the cost. Offer a cost-less fizzle resolution
  // (no `itemInstanceId`) — the resolver drops the attempt and dequeues.
  // Returning no actions would deadlock the pending queue outright (see the
  // flattery-attempt emitter above).
  logDetail(`Pending goodwill-attempt: no character/company/${itemSubtype} item available — the attempt fizzles`);
  return [{
    action: {
      type: 'goodwill-attempt' as const,
      player: playerId,
      characterInstanceId,
      // No 2d6 total can reach this: the attempt cannot be made at all.
      need: 13,
      explanation: `Goodwill attempt: no diplomat or ${itemSubtype} item available — the attempt fails`,
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
export function seizedByTerrorRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'seized-by-terror-roll') return [];
  const { targetCharacterId, hazardDefinitionId, threshold } = top.kind;

  const player = playerById(state, playerId);
  if (!player) return [];

  const charInPlay = player.characters[targetCharacterId];
  if (!charInPlay) {
    // The target left play before the roll — nothing to seize. Offer a
    // fizzle resolution instead of no actions, which would deadlock the
    // resolving chain (see the flattery-attempt emitter above).
    const goneHazardName = defById(state, hazardDefinitionId)?.name ?? '?';
    logDetail(`Pending seized-by-terror-roll (${goneHazardName}): target character no longer in play — no effect`);
    return [{
      action: {
        type: 'seized-by-terror-roll' as const,
        player: playerId,
        targetCharacterId,
        need: 0,
        explanation: `${goneHazardName}: the target character is no longer in play — no effect`,
      },
      viable: true,
    }];
  }

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const hazardDef = defById(state, hazardDefinitionId);
  const hazardName = hazardDef?.name ?? '?';

  const mind = printedMind(charDef);
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
 * Compute the single company-tap-roll action that resolves the head of a
 * queued `company-tap-roll` resolution (Heedless Revelry le-114). The
 * company's controller rolls 2d6 for `remaining[0]`; if roll + modifier is
 * strictly greater than the character's effective mind, the character
 * becomes tapped. One action per dispatch — the resolution stays queued
 * until every listed character has rolled.
 */
export function companyTapRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'company-tap-roll') return [];
  const next = top.kind.remaining[0];
  if (!next) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  const charInPlay = player.characters[next.characterId];
  if (!charInPlay) {
    // The next roller left play (e.g. eliminated by an earlier resolution of
    // the same hazard chain). Offer a skip resolution instead of no actions,
    // which would deadlock the resolving chain with the rest of the list
    // still queued (see the flattery-attempt emitter above).
    const goneHazardName = defById(state, top.kind.hazardDefinitionId)?.name ?? '?';
    logDetail(`Pending company-tap-roll (${goneHazardName}): character no longer in play — skipping their roll`);
    return [{
      action: {
        type: 'company-tap-roll' as const,
        player: playerId,
        targetCharacterId: next.characterId,
        modifier: next.modifier,
        explanation: `${goneHazardName}: the character is no longer in play — their roll is skipped`,
      },
      viable: true,
    }];
  }

  const charDef = defById(state, charInPlay.definitionId);
  const charName = charDef?.name ?? '?';
  const hazardDef = defById(state, top.kind.hazardDefinitionId);
  const hazardName = hazardDef?.name ?? '?';
  const mind = charDef && isCharacterCard(charDef)
    ? (charInPlay.effectiveStats.mind ?? charDef.mind ?? 0)
    : 0;

  const modifierText = next.modifier !== 0 ? ` ${formatSignedNumber(next.modifier)}` : '';
  logDetail(`Pending company-tap-roll for ${charName} (${hazardName}): taps if 2d6${modifierText} > mind ${mind}`);

  return [{
    action: {
      type: 'company-tap-roll' as const,
      player: playerId,
      targetCharacterId: next.characterId,
      modifier: next.modifier,
      explanation: `${charName} vs ${hazardName}: taps if roll${modifierText} > mind ${mind}`,
    },
    viable: true,
  }];
}

/**
 * Compute the single `opposed-roll` action that resolves the next roll of a
 * queued `opposed-roll` resolution (No More Nonsense le-210). The challenger
 * (the card's play-target) rolls first; once their total is recorded on the
 * resolution the opposing character rolls. Both characters belong to the same
 * company, so the same player rolls twice.
 */
export function opposedRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'opposed-roll') return [];
  const kind = top.kind;
  const rolling = kind.challengerRoll === undefined ? kind.challengerId : kind.opponentId;

  const player = playerById(state, playerId);
  const charInPlay = player?.characters[rolling];
  if (!player || !charInPlay) {
    logDetail(`Pending opposed-roll: roller ${rolling as string} is no longer in play — no action`);
    return [];
  }

  const sourceName = defById(state, kind.sourceDefinitionId)?.name ?? '?';
  const rollerName = resolveDef(state, rolling)?.name ?? (rolling as string);
  const stat = opposedRollStat(state, player, rolling, kind.addStat);
  const explanation = kind.challengerRoll === undefined
    ? `${sourceName}: roll for ${rollerName} (roll + ${kind.addStat} ${stat})`
    : `${sourceName}: roll for ${rollerName} (roll + ${kind.addStat} ${stat}) vs `
      + `${resolveDef(state, kind.challengerId)?.name ?? '?'}'s ${kind.challengerRoll} + `
      + `${opposedRollStat(state, player, kind.challengerId, kind.addStat)}`;

  logDetail(`Pending opposed-roll (${sourceName}): ${rollerName} rolls 2d6 + ${kind.addStat} ${stat}`);

  return [{
    action: { type: 'opposed-roll' as const, player: playerId, characterId: rolling, explanation },
    viable: true,
  }];
}

/**
 * The stat an `opposed-roll` adds to a roller's 2d6 total. Reads the
 * character's *effective* stats (so items, attached hazards, and constraints
 * all count), falling back to the printed value when a derived stat is absent.
 */
export function opposedRollStat(
  state: GameState,
  player: PlayerState,
  characterId: CardInstanceId,
  stat: 'prowess' | 'body' | 'mind',
): number {
  const char = player.characters[characterId];
  if (!char) return 0;
  const def = defById(state, char.definitionId);
  if (stat === 'mind') {
    const printed = printedMind(def);
    return char.effectiveStats.mind ?? printed;
  }
  return char.effectiveStats[stat];
}

/**
 * Compute the actions that resolve a queued `gold-ring-test` resolution
 * (auto-test triggered by the `auto-test-gold-ring` site-rule when a gold ring
 * is stored at a Darkhaven, the Wizard/sage tap-test, or a ring-test event).
 *
 * The ring's owner rolls 2d6 with the test's modifier; the ring is discarded
 * regardless of the result. A test with `rollCount > 1` (Wizard's Test tw-365)
 * emits one roll action per outstanding roll and, once every roll is in, one
 * `choose-gold-ring-test-roll` action per **distinct** rolled total — the
 * player picks which result the test uses. Higher is not automatically better
 * (a low total can open Magic Rings where a high one opens only a Lesser
 * Ring), so the choice is offered rather than decided by the engine.
 */
export function goldRingTestActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'gold-ring-test') return [];
  const { goldRingInstanceId, rollModifier } = top.kind;
  const rollCount = top.kind.rollCount ?? 1;
  const rolledTotals = top.kind.rolledTotals ?? [];

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

  // Every roll is in — the player chooses which total the test uses.
  if (rolledTotals.length >= rollCount && rollCount > 1) {
    const table = getCardEffects(ringDef).find(
      (e): e is RingTestTableEffect => e.type === 'ring-test-table',
    );
    const distinct = [...new Set(rolledTotals)];
    logDetail(`Pending gold-ring-test for ${ringName}: choose one of the rolled totals (${rolledTotals.join(', ')})`);
    return distinct.map(rollTotal => {
      const categories = table ? eligibleRingCategories(table.table, rollTotal) : [];
      const categoryNote = categories.length > 0 ? categories.join(', ') : 'nothing';
      logDetail(`  total ${rollTotal} → ${categoryNote}`);
      return {
        action: {
          type: 'choose-gold-ring-test-roll' as const,
          player: playerId,
          goldRingInstanceId,
          rollTotal,
          explanation: `${ringName} tests as ${categoryNote} on a ${rollTotal}`,
        },
        viable: true,
      };
    });
  }

  const rollNote = rollCount > 1 ? ` (roll ${rolledTotals.length + 1} of ${rollCount})` : '';
  logDetail(`Pending gold-ring-test for ${ringName}: roll 2d6 ${formatSignedNumber(rollModifier)}${rollNote}`);

  return [{
    action: {
      type: 'gold-ring-test-roll' as const,
      player: playerId,
      goldRingInstanceId,
      rollModifier,
      explanation: `Gold-ring auto-test for ${ringName}: 2d6 ${formatSignedNumber(rollModifier)}${rollNote}`,
    },
    viable: true,
  }];
}

/**
 * Compute the legal actions for a queued `wizard-search-on-store` resolution
 * (The Windlord Found Me, dm-164).
 *
 * Emits one `play-wizard-from-search` action per Wizard found in the player's
 * play deck or discard pile, plus a `skip-wizard-search` action to pass.
 * Wizards are identified by `isAvatarCharacter` (mind === null).
 */
export function wizardSearchOnStoreActions(
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
    const def = state.cardPool[defId as CardDefinitionId];
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
 * Compute the corruption-check actions that resolve a queued
 * `corruption-check` resolution. Normally that is the single roll action
 * for the head entry; when the head carries `selectableOrder` (Ren the
 * Unclean tw-83: "Each player decides the order of the corruption checks
 * for their characters"), one roll action is offered per same-source
 * selectable sibling so the actor picks which character checks next.
 */
export function corruptionCheckActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'corruption-check') return [];
  const entries = top.kind.selectableOrder
    ? state.pendingResolutions.filter(r =>
      r.actor === playerId
      && r.kind.type === 'corruption-check'
      && r.source === top.source
      && r.kind.selectableOrder)
    : [top];
  if (entries.length > 1) {
    logDetail(`Selectable corruption-check order: ${entries.length} same-source checks offered simultaneously`);
  }
  const actions: EvaluatedAction[] = [];
  for (const entry of entries) {
    actions.push(...corruptionCheckEntryActions(state, playerId, entry, entry.id === top.id));
  }
  return actions;
}

/**
 * The actions for ONE queued corruption-check entry: the roll action
 * carrying precomputed CP, modifier, possessions, and explanation — the
 * same shape the legacy per-phase short-circuits used to produce — plus
 * any reactive aids (short-event plays, modifier grants) and, when the
 * entry carries `allowSupport`, one `support-corruption-check` per
 * untapped company mate (tap for +1, CoE 7.1.1 — offered for item-transfer
 * checks and for checks granted mid-game by Ren the Unclean tw-83). An
 * entry with `noResourceAid`
 * suppresses the reactive short-event plays ("you cannot play resources
 * to aid your character's corruption checks") — activating an in-play
 * grant is using, not playing, a resource and stays legal.
 *
 * For transfer corruption checks, the transferred item is included in
 * both the CP total and the possessions list, even though it has already
 * physically moved to its new bearer.
 */
function corruptionCheckEntryActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
  isHead: boolean,
): EvaluatedAction[] {
  if (top.kind.type !== 'corruption-check') return [];
  const { characterId, modifier, reason, transferredItemId } = top.kind;

  // Find the character on either player (corruption checks are owned by
  // the actor, but the actor may not be the active player in all cases).
  const player = playerById(state, playerId);
  if (!player) return [];
  const char = player.characters[characterId];
  if (!char) {
    // Character was eliminated — auto-resolve the head entry via pass. A
    // non-head selectable sibling emits nothing; it surfaces as head (and
    // gets its pass) once the entries ahead of it drain.
    if (!isHead) return [];
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

  // Company-scoped corruption check-modifier constraints: applied to every
  // matching corruption check by a character in the *targeted* company, and
  // NOT consumed — they persist for the constraint's scope. The checked
  // character's own company must match the constraint's companyId.
  //
  // The constraint's optional `when` narrows which of the company's characters
  // benefit, evaluated against the checking character. Ren the Ringwraith
  // (le-56) modifies checks "by minions in any one of your companies" and so
  // carries a `minion-character` gate; Shifter of Hues (wh-115) aids "the
  // characters in one company" wholesale and carries none.
  const checkCompany = findCharacterCompany(player.companies, characterId);
  if (checkCompany && isCharacterCard(charDef)) {
    const targetCtx = {
      target: {
        cardType: charDef.cardType,
        race: charDef.race,
        name: charDef.name,
      },
    } as Record<string, unknown>;
    for (const constraint of state.activeConstraints) {
      if (constraint.kind.type !== 'check-modifier') continue;
      if (constraint.kind.check !== 'corruption') continue;
      if (constraint.target.kind !== 'company') continue;
      if (constraint.target.companyId !== checkCompany.id) continue;
      if (constraint.kind.when && !matchesCondition(constraint.kind.when, targetCtx)) {
        logDetail(`Company-wide corruption check-modifier from constraint ${constraint.id} does not apply to ${charDef.name}`);
        continue;
      }
      totalModifier += constraint.kind.value;
      logDetail(`Company-wide corruption check-modifier ${formatSignedNumber(constraint.kind.value)} from constraint ${constraint.id}`);
    }
  }

  // Build the source-card keyword list so item check-modifiers can gate
  // on what produced the check (e.g. Wizard's Staff keys off source.keywords
  // $includes 'spell'). The source is the PendingResolution's source card.
  const sourceDef = top.source ? resolveDef(state, top.source) : undefined;
  const sourceKeywords: readonly string[] = sourceDef && 'keywords' in sourceDef && Array.isArray((sourceDef as { keywords?: readonly string[] }).keywords)
    ? (sourceDef as { keywords: readonly string[] }).keywords
    : [];
  // DSL check-modifier effects from the character's own definition, items, and hazards.
  const company = findCharacterCompany(player.companies, characterId);
  const companyCharCount = company ? company.characters.length : 1;
  const hasTrollLeader = company?.characters.some(cid => {
    const compChar = player.characters[cid];
    if (!compChar) return false;
    const def = resolveDef(state, compChar.instanceId);
    return isCharacterCard(def) && def.race === Race.Troll && (def.keywords ?? []).includes('leader');
  }) ?? false;

  // Rule 10.05: a character in the same company as a Ringwraith or the
  // Balrog receives an additional +2 modifier to corruption checks.
  const hasCorruptingAvatar = company?.characters.some(cid => {
    const compChar = player.characters[cid];
    if (!compChar) return false;
    const def = resolveDef(state, compChar.instanceId);
    return isCharacterCard(def) && (def.race === Race.Ringwraith || isBalrogAvatarDef(def));
  }) ?? false;
  if (hasCorruptingAvatar) {
    totalModifier += 2;
    logDetail(`Corruption check +2 (rule 10.05): company includes a Ringwraith/Balrog avatar`);
  }

  const checkContext = { reason: 'corruption-check', source: { keywords: sourceKeywords }, company: { hasTrollLeader, characterCount: companyCharCount } };

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
    ...characterPossessions(char),
  ];

  // For transfer/store checks, also count the transferred item's CP toward
  // the total. Uses `effectiveItemCorruptionPoints` (not the raw printed
  // field) so bearer-conditional bonuses declared on the item itself — e.g.
  // Dwarven Ring of Durin's Tribe tw-216's +2 CP on a Dwarf bearer — and any
  // in-play `in-play-item-modifier` deltas are counted, matching the total
  // `char.effectiveStats.corruptionPoints` carried while the item was still
  // borne.
  if (transferredItemId) {
    const transferredDef = resolveDef(state, transferredItemId);
    if (transferredDef) {
      const inPlayDefs = state.players.flatMap(p => p.cardsInPlay.map(c => resolveDef(state, c.instanceId)));
      cp += effectiveItemCorruptionPoints(
        transferredDef,
        inPlayDefs,
        player.alignment,
        isCharacterCard(charDef) ? charDef.race : undefined,
      );
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
  //
  // An entry flagged `noResourceAid` (Ren the Unclean tw-83: the tapping
  // player "cannot play resources to aid your character's corruption
  // checks") suppresses these hand plays; in-play grant activations are a
  // *use* of a resource, not a play, and stay available.
  const reactivePlays = top.kind.noResourceAid ? [] : reactiveCorruptionCheckPlays(state, playerId, char);
  if (top.kind.noResourceAid) {
    logDetail(`Corruption check (${reason}): no-resource-aid — reactive resource plays suppressed`);
  }
  // In-play permanent events that modify a corruption check by a character
  // in the bearer's company (When I Know Anything td-166) are activatable
  // here, before the roll, just like reactive short-event plays.
  const modifierGrants = modifyCorruptionCheckGrantActions(state, playerId, characterId);

  // Tap-in-support (`allowSupport`, CoE 7.1.1): each untapped company mate
  // of the checking character may tap for +1 to the roll before it is
  // made, exactly like the Free Council window. Set for item-transfer
  // checks and for checks granted mid-game by Ren the Unclean tw-83
  // ("Your characters may tap in support").
  const supportActions: EvaluatedAction[] = [];
  if (top.kind.allowSupport) {
    const supportCompany = findCharacterCompany(player.companies, characterId);
    if (supportCompany) {
      for (const cid of supportCompany.characters) {
        if (cid === characterId) continue;
        const supporter = player.characters[cid];
        if (!supporter || supporter.status !== CardStatus.Untapped) continue;
        logDetail(`Support available: ${defNamesOf(state, [supporter])[0] ?? (cid as string)} can tap for +1 to ${charName}'s corruption check`);
        supportActions.push({
          action: {
            type: 'support-corruption-check',
            player: playerId,
            supportingCharacterId: cid,
            targetCharacterId: characterId,
          },
          viable: true,
        });
      }
    }
  }

  return [rollAction, ...reactivePlays, ...modifierGrants, ...supportActions];
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
 *
 * Exported so the Free Council corruption-check window
 * ({@link module:legal-actions/free-council}) can offer the same reactive
 * plays — CoE 10.3.i grants both players resource/character actions that
 * "reduce a character's corruption point total or prevent a character from
 * being discarded" during those end-of-game checks too.
 */
export function reactiveCorruptionCheckPlays(
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
    const activeCheckLimit = findDuplicationLimitEffect(shortDef, 'active-check');
    if (activeCheckLimit) {
      const alreadyApplied = state.activeConstraints.some(
        c => constraintFromCard(state, c, handCard.definitionId)
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

      // `transfer-item-free` (Pledge of Conduct, td-144): the option itself
      // names no item or destination — the player picks both. Enumerate one
      // action per (item borne by the checking character, other character in
      // the same company) pair, mirroring transferItemActions' per-triple
      // enumeration for the ordinary organization-phase transfer.
      if (opt.apply.type === 'transfer-item-free') {
        const company = findCharacterCompany(player.companies, targetChar.instanceId);
        if (!company) continue;
        for (const item of targetChar.items) {
          const itemDef = defById(state, item.definitionId);
          if (!isItemCard(itemDef)) continue;
          for (const mateId of company.characters) {
            if (mateId === targetChar.instanceId) continue;
            if (!player.characters[mateId]) continue;
            logDetail(`Reactive corruption-check play available: ${shortDef.name} option "${opt.id}" transferring ${itemDef.name} from ${targetChar.instanceId as string} to ${mateId as string}`);
            actions.push({
              action: {
                type: 'play-short-event',
                player: playerId,
                cardInstanceId: handCard.instanceId,
                targetCharacterId: targetChar.instanceId,
                optionId: opt.id,
                transferItemInstanceId: item.instanceId,
                transferToCharacterId: mateId,
              },
              viable: true,
            });
          }
        }
        continue;
      }

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
  // A card in play may cancel the effects of specific named cards (The Way is
  // Shut, dm-98): while suppressed, the constraint imposes nothing.
  if (constraintSuppressedByCancelEffect(state, constraint)) return base;
  switch (constraint.kind.type) {
    case 'site-phase-do-nothing':
      return applySitePhaseDoNothing(state, playerId, base, constraint);
    case 'no-creature-hazards-on-company':
      return applyNoCreatureHazardsOnCompany(state, playerId, base, constraint);
    case 'only-revealed-hazards-on-company':
      return applyOnlyRevealedHazardsOnCompany(state, playerId, base, constraint);
    case 'only-creatures-keyed-to-site':
      return applyOnlyCreaturesKeyedToSite(state, playerId, base, constraint);
    case 'only-creatures-keyed-to-site-at-ruins-lairs':
      return applyOnlyCreaturesKeyedToSiteAtRuinsLairs(state, playerId, base, constraint);
    case 'only-race-creatures-on-company':
      return applyOnlyRaceCreaturesOnCompany(state, playerId, base, constraint);
    case 'extra-mh-phase':
      // Master of Esgaroth (td-135): consumed directly by
      // `advanceAfterCompanyMH` (mh-hazard-play.ts) once the company's
      // movement/hazard phase ends — no broad legal-action filtering here.
      return base;
    case 'keyed-attacks-normal':
      // World Gnawed by the Nameless (as-110): consulted directly at
      // hazard-creature combat initiation (`companyKeyedAttacksNormalSiteTypes`
      // → `isDetainmentAttack`) — no broad legal-action filtering here.
      return base;
    case 'no-creatures-keyed-to-site':
      return applyNoCreaturesKeyedToSite(state, playerId, base, constraint);
    case 'company-cannot-move':
      // Enforced directly by the org-phase `plan-movement` emitter
      // (`planMovementActions`) and reducer (`handlePlanMovement`) — no broad
      // legal-action filtering needed here. Used by Hide in Dark Places (le-192).
      return base;
    case 'check-modifier':
      return base;
    case 'site-path-reduction':
      // Roam the Waste (ba-73): consulted directly when a moving company's
      // resolved site path is built (`applySitePathReduction` in mh-steps.ts) —
      // no broad legal-action filtering needed here.
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
    case 'region-keying-boost':
      // Consulted directly by the creature-keying matchers (Withered Lands)
      // via `collectRegionKeyingBoosts` — no broad legal-action filtering
      // needed here.
      return base;
    case 'auto-attack-duplicate':
      return base;
    case 'auto-attack-race-duplicate':
      return base;
    case 'hazard-limit-modifier':
      return base;
    case 'hazard-limit-region-count':
      // Consulted directly by `snapshotHazardLimit` (mh-steps.ts) against the
      // resolved site path — no broad legal-action filtering needed here.
      return base;
    case 'cancel-return-and-site-tap':
      return base;
    case 'cancel-character-discard':
      return base;
    case 'site-flag':
      // Every site-flag marker is consulted directly by the code path that
      // owns its behaviour (skip/cancel/replace automatic-attacks in
      // `reducer-site.ts`; nothing-playable / cross-alignment / technology /
      // site-protected in `legal-actions/site.ts`; wizardhaven-conversion in
      // `isHavenForPlayer`) — no broad legal-action filtering needed here.
      return base;
    case 'replace-automatic-attacks':
      // Consumed directly by `manifestations.ts` `getActiveAutoAttacks` —
      // no broad legal-action filtering needed here.
      return base;
    case 'extra-automatic-attack':
      // FEAR! FIRE! FOES! (as-29) Mode A — consumed directly by
      // `manifestations.ts` `getActiveAutoAttacks`; no filtering needed here.
      return base;
    case 'mirror-automatic-attacks':
      // Whole Villages Roused (wh-31) — consumed directly by
      // `manifestations.ts` `getActiveAutoAttacks`; no filtering needed here.
      return base;
    case 'influence-at-site-modifier':
      // Consulted directly by the faction-influence emitter in
      // `legal-actions/site.ts` — no broad legal-action filtering needed.
      return base;
    case 'corruption-removal-locked':
      // Consulted directly by the corruption-removal action emitter
      // (see legal-actions/site.ts / organization.ts) — no broad
      // legal-action filtering needed here.
      return base;
    case 'corruption-removal-attempted':
      // Consulted directly by the corruption-removal action emitter
      // (see organization.ts) to withhold the no-tap variant once a
      // tap-and-roll attempt has already been made this turn — no
      // broad legal-action filtering needed here.
      return base;
    case 'granted-action-used':
      // Once-per-turn grant-action lock, consulted directly by the
      // grant-action scanner (grantedActionActivations) — no broad
      // legal-action filtering needed here. Used by Strangling Coils (ba-76).
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
    case 'can-use-palantir':
      // Consumed directly by `buildGrantActionContext` (Palantír of Elostirion
      // le-332) when gating the source Palantír's own granted ability — no
      // broad legal-action filtering needed here.
      return base;
    case 'creature-attack-boost':
      // Consumed directly by `resolveAttackProwess`/`resolveAttackStrikes` —
      // no legal-action filtering needed here.
      return base;
    case 'bearer-cannot-untap':
      // Enforced directly by `reducer-untap.ts` `performUntap` —
      // no legal-action filtering needed here.
      return base;
    case 'skip-next-untap':
      // Fled into Darkness (ba-18) / Fireworks (dm-130): consumed directly by
      // `reducer-untap.ts` `performUntap` for the untap-phase sweep, and by
      // `interceptSkipNextUntap` for any other code path that sets a
      // character's status to untapped directly (e.g. And Forth He Hastened
      // td-98) — no broad legal-action filtering needed here.
      return base;
    case 'attack-card-played':
      // Pure marker for the duplication-limit mechanism; consulted directly
      // by `modifyAttackFromHandActions` — no broad legal-action filtering.
      return base;
    case 'major-item-unlocked':
      // Consulted directly by `playResourcesActions` in `legal-actions/site.ts`
      // to allow major and hoard items — no broad legal-action filtering here.
      return base;
    case 'gold-ring-item-unlocked':
      // Consulted directly by `playResourcesActions` in `legal-actions/site.ts`
      // to allow one gold ring regardless of its text restrictions (Hermit's
      // Hill le-382) — no broad legal-action filtering needed here.
      return base;
    case 'site-resource-unlocked':
      // Consulted directly by `playResourceShortEventActions` in
      // `legal-actions/organization.ts` (Records Unread: Information at any
      // Shadow-hold) — no broad legal-action filtering needed here.
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
    case 'character-pressed':
      // Press-gang (ba-22): the held character is off to the side in no company,
      // so it never surfaces in company-driven action menus. Its negative MP / 0
      // GI / no-untap are enforced in `recompute-derived.ts` / `reducer-untap.ts`.
      return base;
    case 'tidings-attacks-queue':
      // Consumed directly by `finalizeCombat` in `reducer-combat.ts` to
      // chain successive Tidings of Bold Spies attacks — no broad legal-action
      // filtering needed here.
      return base;
    case 'traitor-attack-queued':
      // Traitor (tw-105): consumed by `initiateQueuedTraitorAttack`
      // (combat-finalize.ts) when the combat that was active during the failed
      // corruption check ends — no broad legal-action filtering needed here.
      return base;
    case 'great-hunt-reveal':
    case 'great-hunt-active':
      // The Great Hunt (wh-91) state holders: the reveal queue is consumed by
      // combat finalization and the discard tracker by the post-reduce sweep —
      // neither restricts legal actions here.
      return base;
    case 'item-play-corruption-check':
      // Greed (le-113 / tw-42): consumed directly by the site-phase item-play
      // handler (`fireItemPlayCorruptionChecks` in `reducer-site.ts`), which
      // enqueues the corruption checks when an item is played at the bound
      // site — no broad legal-action filtering needed here.
      return base;
    case 'free-attack-cancel':
      // Darkness Wielded (ba-55): the deferred free-cancel grant is offered
      // directly by `cancelAttackActions` (combat.ts) and consumed by
      // `handleCancelAttack` — no broad legal-action filtering needed here.
      return base;
    case 'auto-attack-boost':
      // Arouse Defenders (le-101): consumed directly by the site auto-attack
      // initiation in `reducer-site.ts` (adds prowess / marks the attack
      // uncancelable) — no broad legal-action filtering needed here.
      return base;
    case 'defeat-attack-strikes':
      // Liquid Fire (wh-52): consumed directly by the site auto-attack
      // initiation in `reducer-site.ts` (forces every strike of a qualifying
      // attack to fail) — no broad legal-action filtering needed here.
      return base;
    case 'character-removal-protected':
      // Tookish Blood (tw-104) resource mode: consulted directly by the
      // central return/discard helpers in `pending-reducers.ts` via
      // `isCharacterRemovalProtected` — no broad legal-action filtering here.
      return base;
    case 'tap-on-strike-assignment':
      // Fifteen Birds in Five Firtrees (dm-129): consumed directly by
      // `applyTapOnStrikeAssignment` in `reducer-combat.ts`'s `assign-strike`
      // handler — no broad legal-action filtering needed here.
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

  // `discard: "named-card"` costs (Fifteen Birds in Five Firtrees dm-129:
  // "or you discard Eagle-mounts from your hand") aren't tied to any
  // character — `canPayCost` only gates on tap status, so check hand
  // presence once here before offering the constraint to anyone.
  if (kind.cost.discard === 'named-card') {
    const hasCard = player.hand.some(c => cardName(state, c.definitionId, '') === kind.cost.discardCardName);
    if (!hasCard) return base;
  }

  const result = [...base];
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char) continue;
    if (!canPayCost(kind.cost, char)) continue;

    const def = resolveDef(state, char.instanceId);
    if (!isCharacterCard(def)) continue;
    const statusStr = cardStatusToName(char.status);

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
    result.push(grantedAction(
      playerId,
      char.instanceId,
      { instanceId: constraint.source, definitionId: constraint.sourceDefinitionId },
      kind.action,
      0,
    ));
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

  return filterCreaturePlaysAgainstCompany(state, base, constraint, protectedCompany, 'no-creature-hazards-on-company', def => {
    // creatures-always-keyed-to-site bypass: if the destination site carries
    // this rule and the creature is keyed to the site by type or name, allow it.
    if (isCreatureSiteKeyedBypassed(state, protectedCompany, def)) {
      return { allow: true, note: `"${def.name}" bypassed by creatures-always-keyed-to-site rule` };
    }
    return { allow: false, note: `dropping creature play "${def.name}" against protected company ${protectedCompany as string}` };
  });
}

/** The `play-hazard` action fields consulted by the creature-constraint post-filters. */
type CreaturePlayAction = { targetCompanyId?: CompanyId; cardInstanceId?: CardInstanceId; keyedBy?: { method: string } };

/**
 * Shared post-filter for constraints restricting hazard-creature plays against
 * a protected company. Every action that is not a `play-hazard` of a hazard
 * creature against `protectedCompany` passes through untouched; for the rest,
 * `verdict` decides whether the play survives and may attach a `note`, which is
 * logged as `Constraint <id> (<label>): <note>`.
 */
function filterCreaturePlaysAgainstCompany(
  state: GameState,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
  protectedCompany: CompanyId,
  label: string,
  verdict: (def: import('../../types/cards-hazards.js').CreatureCard, action: CreaturePlayAction) => { allow: boolean; note?: string },
): EvaluatedAction[] {
  return base.filter(ea => {
    if (ea.action.type !== 'play-hazard') return true;
    const action = ea.action as CreaturePlayAction;
    if (action.targetCompanyId !== protectedCompany) return true;
    const cardInstId = action.cardInstanceId;
    if (!cardInstId) return true;
    const def = resolveDef(state, cardInstId);
    if (!def || def.cardType !== 'hazard-creature') return true;
    const { allow, note } = verdict(def, action);
    if (note) logDetail(`Constraint ${constraint.id as string} (${label}): ${note}`);
    return allow;
  });
}

/**
 * Here Is a Snake! (dm-137): once the hazard player finalizes their
 * `reveal-hazards-choice` resolution, drop every `play-hazard` action against
 * the protected company (hazard creature or hazard event) whose card is not
 * in the revealed allow-list. An empty allow-list drops every hazard play
 * against the company for the rest of its M/H phase.
 *
 * On-guard reveals ("including on-guard cards") are filtered separately,
 * directly inside `onGuardWindowActions` above — while an on-guard-window
 * resolution is queued, `computeLegalActions` short-circuits straight to
 * `resolutionLegalActions` and never reaches this generic constraint
 * post-filter (which only wraps the phase-switch branch of the legal-action
 * computer).
 */
function applyOnlyRevealedHazardsOnCompany(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  if (constraint.kind.type !== 'only-revealed-hazards-on-company') return base;
  const protectedCompany = constraint.target.companyId;
  const allowed = new Set<string>(constraint.kind.allowedInstanceIds.map(id => id as string));

  return base.filter(ea => {
    if (ea.action.type !== 'play-hazard') return true;
    const targetCompanyId = (ea.action as { targetCompanyId?: CompanyId }).targetCompanyId;
    if (targetCompanyId !== protectedCompany) return true;
    const cardInstId = (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId;
    if (!cardInstId || allowed.has(cardInstId as string)) return true;
    const def = resolveDef(state, cardInstId);
    logDetail(`Constraint ${constraint.id as string} (only-revealed-hazards-on-company): dropping unrevealed "${def?.name ?? cardInstId as string}" against protected company ${protectedCompany as string}`);
    return false;
  });
}

/**
 * Secret Passage (tw-325): drop every play-hazard action whose target company
 * matches the constraint *and* whose card is a hazard creature that is NOT
 * keyed to the company's destination site (by site-type or site-name). Only
 * site-keyed creatures survive; region-keyed creatures are blocked. Other
 * hazard categories and plays against other companies are unaffected.
 */
function applyOnlyCreaturesKeyedToSite(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  const protectedCompany = constraint.target.companyId;

  return filterCreaturePlaysAgainstCompany(state, base, constraint, protectedCompany, 'only-creatures-keyed-to-site', def => {
    if (isCreatureKeyedToDestinationSite(state, def)) {
      return { allow: true, note: `"${def.name}" is site-keyed — allowed` };
    }
    return { allow: false, note: `dropping non-site-keyed creature "${def.name}" against company ${protectedCompany as string}` };
  });
}

/**
 * Paths of the Dead (tw-302): drop every play-hazard action whose target
 * company matches the constraint *and* whose card is a hazard creature not of
 * the constraint's race. "The only hazard creatures that may be played on
 * this company are Undead, but any Undead may be played on the company."
 */
function applyOnlyRaceCreaturesOnCompany(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  if (constraint.kind.type !== 'only-race-creatures-on-company') return base;
  const protectedCompany = constraint.target.companyId;
  const race = constraint.kind.race;

  return filterCreaturePlaysAgainstCompany(state, base, constraint, protectedCompany, 'only-race-creatures-on-company', def => {
    if (def.race === race || def.additionalRaces?.includes(race)) {
      return { allow: true, note: `"${def.name}" is ${race} — allowed` };
    }
    return { allow: false, note: `dropping non-${race} creature "${def.name}" against company ${protectedCompany as string}` };
  });
}

/**
 * Down Down to Goblin-town (le-181): like `applyOnlyCreaturesKeyedToSite`, but
 * the restriction is gated on the target company moving to a Ruins & Lairs
 * [{R}]. When the company's destination is a Ruins & Lairs, drop every
 * hazard-creature play against it that is not keyed to that site (region-keyed
 * creatures, "by type or name"); site-keyed creatures survive. When the company
 * moves anywhere else the card is inert and every hazard is allowed. The
 * destination type is read from the M/H phase state (the same source the
 * creature-keying matchers use), which reflects the active moving company — the
 * only company for which `play-hazard` actions are generated.
 */
function applyOnlyCreaturesKeyedToSiteAtRuinsLairs(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  const protectedCompany = constraint.target.companyId;

  // R&L gate: the restriction only bites if the company moves to a Ruins &
  // Lairs. Otherwise the card imposes nothing.
  const ps = state.phaseState;
  if (ps.phase !== Phase.MovementHazard || ps.destinationSiteType !== SiteType.RuinsAndLairs) {
    logDetail(`Constraint ${constraint.id as string} (only-creatures-keyed-to-site-at-ruins-lairs): destination is not a Ruins & Lairs — no restriction`);
    return base;
  }

  return filterCreaturePlaysAgainstCompany(state, base, constraint, protectedCompany, 'only-creatures-keyed-to-site-at-ruins-lairs', def => {
    if (isCreatureKeyedToDestinationSite(state, def)) {
      return { allow: true, note: `"${def.name}" is site-keyed — allowed` };
    }
    return { allow: false, note: `dropping region-keyed creature "${def.name}" against company ${protectedCompany as string}` };
  });
}

/**
 * Keying methods that mean a creature attack happens *at the destination
 * site itself* rather than in a region along the path. Used by
 * `no-creatures-keyed-to-site` (Crack in the Wall le-177) to drop exactly the
 * site-based plays while letting region-keyed plays of the same creature
 * through as their own actions.
 */
const SITE_KEYING_METHODS = new Set<string>([
  'site-type', 'site-name', 'site-keyword', 'adjacent-to-site-keyword',
]);

/**
 * Crack in the Wall (le-177): drop every play-hazard action against the
 * protected company whose card is a hazard creature keyed *to the company's
 * new site* — the action's `keyedBy.method` is site-based (see
 * {@link SITE_KEYING_METHODS}). Region-keyed plays (each keying match is its
 * own action) and other hazard categories are unaffected.
 *
 * When the constraint carries `unlessSiteRegionType`, the restriction is
 * gated on the destination's containing region: if the target company's
 * destination site sits in a region of that type (le-177: Free-domain), the
 * card imposes nothing.
 */
function applyNoCreaturesKeyedToSite(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  if (constraint.kind.type !== 'no-creatures-keyed-to-site') return base;
  const protectedCompany = constraint.target.companyId;

  const unless = constraint.kind.unlessSiteRegionType;
  if (unless) {
    const destRegionType = destinationSiteRegionType(state, protectedCompany);
    if (destRegionType === unless) {
      logDetail(`Constraint ${constraint.id as string} (no-creatures-keyed-to-site): destination region is ${unless} — no restriction`);
      return base;
    }
  }

  return filterCreaturePlaysAgainstCompany(state, base, constraint, protectedCompany, 'no-creatures-keyed-to-site', (def, action) => {
    const method = action.keyedBy?.method;
    if (!method || !SITE_KEYING_METHODS.has(method)) return { allow: true };
    return { allow: false, note: `dropping site-keyed (${method}) creature play "${def.name}" against protected company ${protectedCompany as string}` };
  });
}

/**
 * Resolve the {@link import('../../types/common.js').RegionType} of the region
 * containing the given company's declared destination site, or `undefined`
 * when the company has no destination or the region cannot be resolved. Used
 * by the `no-creatures-keyed-to-site` Free-domain gate.
 */
function destinationSiteRegionType(
  state: GameState,
  companyId: CompanyId,
): import('../../types/common.js').RegionType | undefined {
  for (const player of state.players) {
    const company = companyById(player.companies, companyId);
    if (!company) continue;
    const destSite = company.destinationSite;
    if (!destSite) return undefined;
    return siteRegionTypeOf(state, defById(state, destSite.definitionId));
  }
  return undefined;
}

/**
 * Whether the given creature is keyed to the target company's destination site
 * by site-type or site-name. Reads the M/H phase state's `destinationSiteType`
 * / `destinationSiteName` — the same source the creature-keying matchers use —
 * so the whitelist agrees with normal keying. Used to decide which creatures
 * survive Secret Passage's `only-creatures-keyed-to-site` restriction.
 */
function isCreatureKeyedToDestinationSite(
  state: GameState,
  def: import('../../types/cards-hazards.js').CreatureCard,
): boolean {
  const ps = state.phaseState;
  if (ps.phase !== Phase.MovementHazard) return false;
  const destType = ps.destinationSiteType;
  const destName = ps.destinationSiteName;
  return def.keyedTo.some(k =>
    (k.siteTypes && destType !== null && k.siteTypes.includes(destType))
    || (k.siteNames && destName !== null && k.siteNames.includes(destName)),
  );
}

/**
 * Whether an active constraint is currently suppressed by an in-play card
 * carrying a `cancel-card-effects` effect that names the constraint's source
 * card. This is the generic "cancels the effects of X" mechanism: while The
 * Way is Shut (dm-98) is in play it lists "Secret Passage" and "Secret
 * Entrance", so the creature-play restrictions those cards placed on a company
 * are treated as absent. Matching is by source card name, so an unrelated card
 * sharing the same constraint kind (e.g. Stealth's `no-creature-hazards-on-company`)
 * is never affected.
 */
function constraintSuppressedByCancelEffect(
  state: GameState,
  constraint: ActiveConstraint,
): boolean {
  const sourceName = defById(state, constraint.sourceDefinitionId)?.name;
  if (!sourceName) return false;
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = defById(state, card.definitionId);
      for (const eff of getCardEffects(def)) {
        if (eff.type === 'cancel-card-effects' && eff.cardNames.includes(sourceName)) {
          logDetail(`Constraint ${constraint.id as string} suppressed: "${defById(state, card.definitionId)?.name}" cancels the effects of "${sourceName}"`);
          return true;
        }
      }
    }
  }
  return false;
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
export function selectCardBearerActions(
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
  const company = defPlayer ? companyById(defPlayer.companies, companyId) : null;
  if (!defPlayer || !company) {
    // The company vanished before a bearer was chosen (e.g. every member was
    // eliminated by an earlier resolution in the same queue). Offer the
    // decline so the card is discarded and the queue advances — returning no
    // actions would deadlock the game outright: this resolution heads the
    // queue and nothing else can act until it is consumed.
    logDetail(`select-card-bearer: company ${companyId as string} no longer exists — only the decline (pass) is offered`);
    return [{ action: { type: 'pass', player: actor }, viable: true }];
  }

  const cardDefId = resolveInstanceId(state, cardInstanceId);
  const cardLabel = cardName(state, cardDefId!, '?');

  // Honour the source card's `play-target: character` filter, if any: the
  // bearer that taps to keep the card must satisfy the same filter used at play
  // time. Descent through Fire (ba-56) restricts the bearer to The Balrog
  // ("tap The Balrog or discard this card"); cards with no filter (Burning
  // Rick le-173, The Windlord Found Me dm-164) offer every untapped character.
  const sourceDef = cardDefId ? defById(state, cardDefId) : undefined;
  const bearerFilter = sourceDef
    ? getCardEffects(sourceDef).find(
        (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target' && e.target === 'character',
      )?.filter
    : undefined;

  for (const charId of company.characters) {
    const ch = defPlayer.characters[charId];
    if (!ch || ch.status !== CardStatus.Untapped) continue;
    if (bearerFilter) {
      const chDef = defById(state, ch.definitionId);
      if (!chDef || !isCharacterCard(chDef)) continue;
      const ctx: Record<string, unknown> = {
        target: {
          race: chDef.race,
          skills: getEffectiveSkills(state, ch, chDef),
          status: ch.status,
          name: chDef.name,
          itemNames: defNamesOf(state, ch.items),
          isAvatar: isAvatarCharacter(chDef),
        },
      };
      if (!matchesCondition(bearerFilter, ctx)) {
        logDetail(`select-card-bearer: ${charId as string} does not match "${cardLabel}" bearer filter — skipping`);
        continue;
      }
    }
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
 *
 * Two optional narrowings on the resolution kind restrict the candidate set
 * (Indûr Dawndeath tw-46): `characterId` limits the choice to one character's
 * items, and `itemFilter` is matched against each item's card definition
 * ("but not a ring").
 */
export function discardOneCompanyItemActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'discard-one-company-item') return [];
  const { companyId, characterId, itemFilter } = top.kind;

  const defPlayer = state.players.find(p => p.companies.some(co => co.id === companyId));
  if (!defPlayer) return [];
  const company = companyById(defPlayer.companies, companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];
  for (const charId of company.characters) {
    if (characterId && charId !== characterId) continue;
    const ch = defPlayer.characters[charId];
    if (!ch) continue;
    for (const item of ch.items) {
      const itemDef = defById(state, item.definitionId);
      const itemName = itemDef?.name ?? (item.instanceId as string);
      // A character's `items` list may hold non-item cards placed "with" the
      // character (e.g. the permanent event Thrall of the Voice). Brigands' text
      // forces the company to discard one *item*, so only genuine item cards are
      // valid discard targets — skip anything that is not an item.
      if (!isItemCard(itemDef)) {
        logDetail(`discard-one-company-item: skipping ${itemName} (not an item)`);
        continue;
      }
      // Card-supplied item filter (tw-46: "but not a ring").
      if (itemFilter && !matchesDefinition(itemDef, itemFilter)) {
        logDetail(`discard-one-company-item: skipping ${itemName} (excluded by the source card's item filter)`);
        continue;
      }
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
 * Legal actions while a `discard-substitute-offer` resolution is pending
 * (Leaf Brooch dm-171).
 *
 * The owner of the doomed cards may name **one** of them to save — the
 * substitute item is discarded in its place — or decline, letting the forced
 * discard go through. One `use-discard-substitute` action is emitted per
 * doomed card the substitute's filter actually covers, plus the decline.
 */
export function discardSubstituteOfferActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'discard-substitute-offer') return [];
  if (actor !== top.actor) return [];
  const kind = top.kind;

  const ownerIndex = state.players.findIndex(p => p.id === actor);
  if (ownerIndex < 0) return [];
  const owner = state.players[ownerIndex];

  const substitute = findDiscardSubstitutes(state, ownerIndex, kind.companyId)
    .find(s => s.instanceId === kind.substituteInstanceId);

  const actions: EvaluatedAction[] = [];
  if (substitute) {
    for (const ch of Object.values(owner.characters)) {
      for (const item of ch.items) {
        if (!kind.requiredInstanceIds.includes(item.instanceId)) continue;
        const doomedDef = defById(state, item.definitionId);
        if (!substituteCovers(substitute, doomedDef)) continue;
        logDetail(`discard-substitute-offer: ${substitute.name} may be discarded instead of ${doomedDef?.name ?? (item.definitionId as string)}`);
        actions.push({
          action: { type: 'use-discard-substitute' as const, player: actor, itemInstanceId: item.instanceId },
          viable: true,
        });
      }
    }
  }

  // Declining is always available — the substitution is a "may".
  actions.push({ action: { type: 'use-discard-substitute' as const, player: actor }, viable: true });
  return actions;
}

/**
 * Legal actions for a `force-discard-card` pending resolution. The actor (the
 * card-player's opponent) must discard a card:
 *
 * - Fixed-candidate mode (Rolled down to the Sea wh-29: rings; Echoes of the
 *   Song wh-17: the opponent's in-play Stage cards): one action per
 *   pre-computed candidate instance.
 * - Any-from-hand mode (Khamûl the Easterling tw-47): one action per card
 *   currently in the actor's hand (candidates are recomputed each step as the
 *   hand shrinks).
 */
export function forceDiscardCardActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'force-discard-card') return [];
  const actions: EvaluatedAction[] = [];

  if (top.kind.anyFromHand) {
    const actorIdx = state.players.findIndex(p => p.id === actor);
    const hand = actorIdx >= 0 ? state.players[actorIdx].hand : [];
    const remaining = top.kind.remaining ?? 1;
    for (const c of hand) {
      const cardDef = defById(state, c.definitionId);
      const cardName = cardDef?.name ?? (c.instanceId as string);
      logDetail(`force-discard-card: offering hand card "${cardName}" (${c.instanceId as string}) — ${remaining} left to discard`);
      actions.push({
        action: {
          type: 'force-discard-card' as const,
          player: actor,
          cardInstanceId: c.instanceId,
        },
        viable: true,
      });
    }
    return actions;
  }

  for (const instanceId of top.kind.candidateInstanceIds) {
    const defId = resolveInstanceId(state, instanceId);
    const cardDef = defId ? defById(state, defId) : undefined;
    const cardName = cardDef?.name ?? (instanceId as string);
    logDetail(`force-discard-card: offering candidate "${cardName}" (${instanceId as string})`);
    actions.push({
      action: {
        type: 'force-discard-card' as const,
        player: actor,
        cardInstanceId: instanceId,
      },
      viable: true,
    });
  }
  return actions;
}

/**
 * Legal actions for an `influence-overflow-discard` pending resolution
 * (CoE 3.47). The actor left their organization phase over their general
 * influence and must remove non-avatar characters until they are back within
 * it.
 *
 * The rule fixes the order, so only the highest-priority tier that still has a
 * member is offered — characters brought into play during the phase that just
 * ended, then characters that lost direct-influence control between
 * organization phases, then a free choice. Within the offered tier the actor
 * picks freely; passing is not on the table.
 */
export function influenceOverflowDiscardActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'influence-overflow-discard') return [];
  const step = influenceOverflowStep(state, actor, top.kind.playedThisTurnIds, top.kind.uncontrolledIds);
  // No step means the overflow is gone (or nothing removable is left) and the
  // resolution is about to be dequeued by whatever removal cleared it — the
  // reducer dequeues on the same condition, so an empty menu here is never
  // reachable while the resolution is genuinely at the head of the queue.
  if (!step) return [];

  const excess = influenceOverflowAmount(state, actor);
  return viable(step.candidateIds.map(instanceId => {
    const defId = resolveInstanceId(state, instanceId);
    const name = defId ? cardName(state, defId) : (instanceId as string);
    logDetail(`influence-overflow-discard: offering "${name}" (${step.tier} → ${step.destination}) — ${excess} influence over`);
    return {
      type: 'influence-overflow-discard' as const,
      player: actor,
      characterInstanceId: instanceId,
    };
  }));
}

/**
 * Legal actions while a `remove-corruption-offer` resolution is at the head
 * of the queue (Elf-song tw-223). The eligible character's controller either
 * removes one of the character's current corruption cards, or declines —
 * always offered, mirroring `transfer-returned-item`'s "may" decline.
 */
export function removeCorruptionOfferActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'remove-corruption-offer') return [];
  const { characterId } = top.kind;

  let owner: PlayerState | undefined;
  let char: import('../../index.js').CharacterInPlay | undefined;
  for (const p of state.players) {
    const c = p.characters[characterId];
    if (c) { owner = p; char = c; break; }
  }
  if (!owner || owner.id !== actor || !char) return [];

  const actions: EvaluatedAction[] = [
    { action: { type: 'remove-corruption-offer', player: actor }, viable: true },
  ];

  for (const hazard of char.hazards) {
    const hazardDef = defById(state, hazard.definitionId);
    const hazardKeywords = hazardDef && 'keywords' in hazardDef
      ? (hazardDef as { keywords?: readonly string[] }).keywords
      : undefined;
    const isCorruption = hazardDef?.cardType === 'hazard-corruption' || hazardKeywords?.includes('corruption') === true;
    if (!isCorruption) continue;
    const name = hazardDef?.name ?? (hazard.instanceId as string);
    logDetail(`remove-corruption-offer: offering removal of "${name}" from ${characterId as string}`);
    actions.push({
      action: { type: 'remove-corruption-offer', player: actor, corruptionInstanceId: hazard.instanceId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Legal actions for an `event-maintenance` pending resolution — one stage of
 * the upkeep exchange over an in-play event (Thrice Outnumbered le-142,
 * Balance Between Powers dm-118).
 *
 * Every stage offers each hand card matching the effect's `handCardFilter` as a
 * `discard-from-hand` payment; a stage costing more than one card is paid one
 * action at a time, counting `remainingToPay` down.
 *
 * The opt-out is only offered while nothing has been paid yet — once a player
 * starts paying a multi-card stage they are committed (the stage is only ever
 * enqueued when they can afford to finish it). Which opt-out depends on the
 * stage:
 *
 * - `upkeep` — `discard-self`: give the card up rather than pay to keep it.
 *   Always available, so a controller with no matching card in hand still has
 *   exactly one legal action.
 * - `challenge` / `counter` — `decline`: bid nothing. Declining a challenge
 *   leaves the card in play; declining to counter one loses it.
 */
export function eventMaintenanceActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'event-maintenance') return [];
  const { sourceInstanceId, sourceDefinitionId, stage, remainingToPay, stageCount } = top.kind;

  // Look up the source effect's handCardFilter
  const sourceDef = defById(state, sourceDefinitionId);
  const handCardFilter = findEventMaintenanceEffect(sourceDef)?.handCardFilter;

  const actions: EvaluatedAction[] = [];

  // The opt-out, offered only before any card of this stage has been paid.
  if (remainingToPay === stageCount) {
    const paymentType = stage === 'upkeep' ? 'discard-self' as const : 'decline' as const;
    logDetail(`event-maintenance (${stage}): offering ${paymentType} to ${actor as string}`);
    actions.push({
      action: {
        type: 'pay-event-maintenance' as const,
        player: actor,
        paymentType,
        cardInstanceId: sourceInstanceId,
        sourceInstanceId,
      },
      viable: true,
    });
  }

  // Offer each matching hand card as a payment towards this stage.
  if (handCardFilter !== undefined) {
    const actorPlayer = playerById(state, actor);
    if (actorPlayer) {
      for (const handCard of actorPlayer.hand) {
        const handDef = defById(state, handCard.definitionId);
        if (!handDef) continue;
        if (!matchesDefinition(handDef, handCardFilter)) continue;
        logDetail(
          `event-maintenance (${stage}): offering hand card ${handCard.definitionId as string} as payment `
          + `(${remainingToPay} of ${stageCount} still due)`,
        );
        actions.push({
          action: {
            type: 'pay-event-maintenance' as const,
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
 * True when `def` is a unique ring and a card of the same name is already in
 * play (borne by any character of either player, or in either player's
 * `cardsInPlay`).
 *
 * A ring entering play through a gold-ring test bypasses the site item-play
 * path, so the uniqueness rule that path enforces has to be repeated here.
 * Matters for "Unique." rings such as The One Ring (tw-347 / le-326) and the
 * Dwarven Rings of the tribes: both players may hold a copy, but only one may
 * ever be in play.
 */
function isUniqueRingAlreadyInPlay(state: GameState, def: { readonly name?: string; readonly unique?: boolean }): boolean {
  if (def.unique !== true || def.name === undefined) return false;
  if (countCopiesInPlay(state, def.name) === 0) return false;
  logDetail(`ring-play-offer: ${def.name} is unique and already in play — not offered`);
  return true;
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
export function ringPlayOfferActions(
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
    // "Unique." (The One Ring tw-347/le-326, the Dwarven rings): a unique ring
    // cannot enter play while a card of the same name is already in play — the
    // same rule the site item-play path enforces, applied to the ring-test route.
    if (isUniqueRingAlreadyInPlay(state, def)) continue;
    // Duplication-limit scope "character": skip if the target character already
    // holds the maximum number of copies of this ring (Rule text "Cannot be
    // duplicated on a given character").
    const charDupLimit = findDuplicationLimitEffect(def, 'character');
    if (charDupLimit) {
      const { characterInstanceId } = top.kind as { characterInstanceId: CardInstanceId };
      const targetChar = player.characters[characterInstanceId];
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

  // ring-test-search: also offer cards from play deck and discard pile for
  // categories that the gold ring's ring-test-search effect covers.
  const { searchCategories } = top.kind;
  if (searchCategories && searchCategories.length > 0) {
    const searchSources: Array<{ pile: typeof player.hand; source: 'play-deck' | 'discard-pile' }> = [
      { pile: player.playDeck, source: 'play-deck' },
      { pile: player.discardPile, source: 'discard-pile' },
    ];
    for (const { pile, source } of searchSources) {
      for (const card of pile) {
        const def = defById(state, card.definitionId);
        if (!def) continue;
        if (!('subtype' in def) || (def as { subtype?: string }).subtype !== 'special') continue;
        const keywords: readonly string[] = ('keywords' in def && Array.isArray((def as { keywords?: unknown }).keywords))
          ? (def as unknown as { keywords: readonly string[] }).keywords
          : [];
        if (!keywords.includes('ring')) continue;
        const category = (searchCategories as readonly string[]).find(cat => keywords.includes(cat)) as RingCategory | undefined;
        if (!category) continue;
        if (isUniqueRingAlreadyInPlay(state, def)) continue;
        const charDupLimit = findDuplicationLimitEffect(def, 'character');
        if (charDupLimit) {
          const { characterInstanceId } = top.kind as { characterInstanceId: CardInstanceId };
          const targetChar = player.characters[characterInstanceId];
          const copiesOnChar = targetChar?.items.filter(item => {
            const iDef = defById(state, item.definitionId);
            return iDef?.name === def.name;
          }).length ?? 0;
          if (copiesOnChar >= charDupLimit.max) {
            logDetail(`ring-play-offer (search): ${def.name} blocked by duplication-limit (${copiesOnChar}/${charDupLimit.max})`);
            continue;
          }
        }
        logDetail(`ring-play-offer: offering ${def.name} (${card.instanceId as string}) from ${source} — category ${category} (ring-test-search)`);
        actions.push({
          action: {
            type: 'play-ring-after-test' as const,
            player: actor,
            ringInstanceId: card.instanceId,
            source,
          },
          viable: true,
        });
      }
    }
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
 * Legal actions while a `tap-one-character` resolution is pending.
 *
 * The resource player must tap one untapped character in the company.
 * One `tap-character-by-effect` action is emitted per untapped character.
 * The producing card texts read "must tap one untapped character if
 * available" (Stench of Mordor le-141, Himring as-150), so `pass` is only
 * emitted when the company has no untapped character left to tap — the tap
 * is mandatory whenever it is possible.
 */
export function tapOneCharacterActions(
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
    const ch = ownerPlayer.characters[charId];
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

  // pass is only legal when no untapped character exists — the tap is
  // mandatory ("must tap one untapped character if available")
  if (actions.length === 0) {
    actions.push({ action: { type: 'pass' as const, player: actor }, viable: true });
  }

  return actions;
}

/**
 * Legal actions while a `haven-restore-character` resolution is pending
 * (Hall of Fire, dm-134).
 *
 * The controlling player may untap or heal one character in the company:
 * one `restore-character-by-effect` action is emitted per tapped (untap) or
 * wounded/inverted (heal to tapped) character. The benefit is optional, so
 * `pass` is always available.
 */
export function havenRestoreCharacterActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'haven-restore-character') return [];
  const { companyId } = top.kind;

  const ownerPlayer = state.players.find(p => p.companies.some(co => co.id === companyId));
  if (!ownerPlayer) return [];
  const company = companyById(ownerPlayer.companies, companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];
  for (const charId of company.characters) {
    const ch = ownerPlayer.characters[charId];
    if (!ch) continue;
    if (ch.status !== CardStatus.Tapped && ch.status !== CardStatus.Inverted) continue;
    const charName = (defById(state, ch.definitionId) as { name?: string })?.name ?? (charId as string);
    const verb = ch.status === CardStatus.Tapped ? 'untap' : 'heal';
    logDetail(`haven-restore-character: offering to ${verb} ${charName}`);
    actions.push({
      action: {
        type: 'restore-character-by-effect' as const,
        player: actor,
        characterInstanceId: ch.instanceId,
      },
      viable: true,
    });
  }

  // "may choose" — pass is always available.
  actions.push({ action: { type: 'pass' as const, player: actor }, viable: true });

  return actions;
}

/**
 * Legal actions while a `left-behind-rejoin` resolution is pending (Left Behind,
 * td-41): the controlling player may fold the separate "left behind" company
 * back into its original company (`left-behind-rejoin`) or keep it separate
 * (`pass`).
 */
export function leftBehindRejoinActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'left-behind-rejoin') return [];
  const { companyId, originCompanyId } = top.kind;

  const ownerPlayer = state.players.find(p => p.id === actor);
  if (!ownerPlayer) return [];
  const company = companyById(ownerPlayer.companies, companyId);
  const origin = companyById(ownerPlayer.companies, originCompanyId);
  const actions: EvaluatedAction[] = [];
  // Only offer the merge if both companies still exist at the same site.
  if (company && origin && company.currentSite && origin.currentSite
    && company.currentSite.instanceId === origin.currentSite.instanceId) {
    logDetail(`left-behind-rejoin: offering to rejoin ${companyId as string} into ${originCompanyId as string}`);
    actions.push({
      action: { type: 'left-behind-rejoin' as const, player: actor, companyId },
      viable: true,
    });
  }

  // "may rejoin" — pass is always available (keeps the company separate).
  actions.push({ action: { type: 'pass' as const, player: actor }, viable: true });

  return actions;
}

/**
 * Legal actions while an `arrange-deck-top` resolution is pending (Revealed to
 * all Watchers, dm-85): the player orders the set-aside cards sitting on top of
 * their play deck, picking the next-highest card each step. One
 * `arrange-deck-top-card` action per top-of-deck card not yet chosen; the order
 * is mandatory (no pass).
 */
export function arrangeDeckTopActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'arrange-deck-top') return [];
  const { count, orderedInstanceIds } = top.kind;
  const player = playerById(state, actor);
  if (!player) return [];

  const chosen = new Set(orderedInstanceIds);
  const topCards = player.playDeck.slice(0, count);
  const actions: EvaluatedAction[] = [];
  for (const c of topCards) {
    if (chosen.has(c.instanceId)) continue;
    const name = cardName(state, c.definitionId);
    logDetail(`arrange-deck-top: offering to place "${name}" next (position ${orderedInstanceIds.length + 1}/${count})`);
    actions.push({
      action: {
        type: 'arrange-deck-top-card' as const,
        player: actor,
        cardInstanceId: c.instanceId,
      },
      viable: true,
    });
  }
  return actions;
}

/**
 * Legal actions while a `reveal-choose-to-hand` resolution is pending (Eyes of
 * Mandos, dm-126): the player must choose exactly one of the revealed
 * top-of-deck cards to put into their hand. One `choose-revealed-card` action
 * per revealed card; the choice is mandatory (no pass).
 */
export function revealChooseToHandActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'reveal-choose-to-hand') return [];
  const { revealedInstanceIds } = top.kind;
  const player = playerById(state, actor);
  if (!player) return [];

  // The revealed cards are still on top of the play deck; offer each as a pick.
  const onDeck = new Set(player.playDeck.map(c => c.instanceId as string));
  const actions: EvaluatedAction[] = [];
  for (const id of revealedInstanceIds) {
    if (!onDeck.has(id as string)) continue;
    const card = player.playDeck.find(c => c.instanceId === id)!;
    const name = cardName(state, card.definitionId);
    logDetail(`reveal-choose-to-hand: offering to take "${name}" into hand`);
    actions.push({
      action: {
        type: 'choose-revealed-card' as const,
        player: actor,
        cardInstanceId: id,
      },
      viable: true,
    });
  }
  return actions;
}

/**
 * Legal actions while a `reveal-remove-from-discard` resolution is pending
 * (Aware of their Ways, dm-46): the card-player may choose one of the revealed
 * non-unique cards in the opponent's discard pile to remove from the game, or
 * `pass` to remove none ("You may choose…"). One `remove-revealed-card` action
 * per removable card, plus a pass.
 */
export function revealRemoveFromDiscardActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'reveal-remove-from-discard') return [];
  const { removableInstanceIds, opponentId } = top.kind;
  const opponent = playerById(state, opponentId);
  if (!opponent) return [];

  // The removable cards are still in the opponent's discard pile; offer each.
  const inPile = new Set(opponent.discardPile.map(c => c.instanceId as string));
  const actions: EvaluatedAction[] = [];
  for (const id of removableInstanceIds) {
    if (!inPile.has(id as string)) continue;
    const card = opponent.discardPile.find(c => c.instanceId === id)!;
    const name = cardName(state, card.definitionId);
    logDetail(`reveal-remove-from-discard: offering to remove "${name}" from play`);
    actions.push({
      action: {
        type: 'remove-revealed-card' as const,
        player: actor,
        cardInstanceId: id,
      },
      viable: true,
    });
  }
  // "You may" — declining is always allowed.
  actions.push({ action: { type: 'pass' as const, player: actor }, viable: true });
  return actions;
}

/**
 * Legal actions while a `reveal-hazards-choice` pending resolution (Here Is a
 * Snake! dm-137) is at the top of the queue. The actor (hazard player) may:
 *
 *  - reveal one more hazard card from hand (`reveal-hazard-for-snake`),
 *    repeatable — one action per not-yet-revealed hazard-creature or
 *    hazard-event card in hand;
 *  - while nothing has been revealed yet, tap-reveal an eligible face-down,
 *    untapped agent instead (`tap-reveal-agent-for-snake`) — the printed
 *    alternative. Candidates and their home-site pairings are computed by
 *    the same `revealAgentActions` logic as the standalone rule-4.2 reveal,
 *    filtered to untapped agents (a tapped agent cannot be tapped again);
 *  - `pass` to finalize with whatever has been revealed so far (even
 *    nothing — the resulting allow-list may be empty).
 */
export function revealHazardsChoiceActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'reveal-hazards-choice') return [];
  const { revealedIds } = top.kind;
  const player = playerById(state, actor);
  const actions: EvaluatedAction[] = [];

  if (player) {
    for (const handCard of player.hand) {
      if (revealedIds.includes(handCard.instanceId)) continue;
      const def = defById(state, handCard.definitionId);
      if (!def || (def.cardType !== 'hazard-creature' && def.cardType !== 'hazard-event')) continue;
      actions.push({
        action: { type: 'reveal-hazard-for-snake', player: actor, cardInstanceId: handCard.instanceId },
        viable: true,
      });
    }

    if (revealedIds.length === 0) {
      for (const ea of revealAgentActions(state, actor)) {
        const ra = ea.action as RevealAgentAction;
        const agent = player.agents.find(a => a.id === ra.agentId);
        if (!agent || agent.character.status !== CardStatus.Untapped) continue;
        actions.push({
          action: {
            type: 'tap-reveal-agent-for-snake',
            player: actor,
            agentId: ra.agentId,
            ...(ra.homeSiteInstanceId ? { homeSiteInstanceId: ra.homeSiteInstanceId } : {}),
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
 * Legal actions while a `desire-belly-choose-card` resolution is pending
 * (Desire All for Thy Belly, ba-16, step 1): the card-player must choose one of
 * the revealed top-of-deck cards to show to the opponent. One
 * `desire-choose-shown-card` action per revealed card; the choice is mandatory
 * (no pass).
 */
export function desireBellyChooseCardActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'desire-belly-choose-card') return [];
  const { revealedInstanceIds, opponentId } = top.kind;
  const opponent = playerById(state, opponentId);
  if (!opponent) return [];
  const inDeck = new Set(opponent.playDeck.map(c => c.instanceId as string));
  const actions: EvaluatedAction[] = [];
  for (const id of revealedInstanceIds) {
    if (!inDeck.has(id as string)) continue;
    const card = opponent.playDeck.find(c => c.instanceId === id)!;
    logDetail(`Desire All for Thy Belly: offering to show "${cardName(state, card.definitionId)}"`);
    actions.push({
      action: { type: 'desire-choose-shown-card' as const, player: actor, cardInstanceId: id },
      viable: true,
    });
  }
  return actions;
}

/**
 * Legal actions while a `desire-belly-choose-penalty` resolution is pending
 * (Desire All for Thy Belly, ba-16, step 2): the opponent must choose to either
 * remove the shown card from the game or permanently reduce his hand size by
 * one. Both options are offered; the choice is mandatory (no pass).
 */
export function desireBellyChoosePenaltyActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'desire-belly-choose-penalty') return [];
  void state;
  return [
    {
      action: { type: 'desire-choose-penalty' as const, player: actor, penalty: 'remove-from-game' as const },
      viable: true,
    },
    {
      action: { type: 'desire-choose-penalty' as const, player: actor, penalty: 'reduce-hand-size' as const },
      viable: true,
    },
  ];
}

/**
 * Legal actions while a `reveal-deck-choose-attacker` resolution is pending
 * (Long Dark Reach, dm-70): the card-player must name one of the eligible
 * revealed creatures to immediately attack the target company. One
 * `choose-long-dark-reach-attacker` action per eligible candidate; the choice
 * is mandatory (no pass — the resolution is only enqueued when at least one
 * candidate is eligible).
 */
export function revealDeckChooseAttackerActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'reveal-deck-choose-attacker') return [];
  const { eligibleInstanceIds, cardPlayerId } = top.kind;
  const cardPlayer = playerById(state, cardPlayerId);
  if (!cardPlayer) return [];
  const inDeck = new Map(cardPlayer.playDeck.map(c => [c.instanceId as string, c.definitionId]));
  const actions: EvaluatedAction[] = [];
  for (const id of eligibleInstanceIds) {
    const definitionId = inDeck.get(id as string);
    if (!definitionId) continue;
    logDetail(`Long Dark Reach: offering to attack with "${cardName(state, definitionId)}"`);
    actions.push({
      action: { type: 'choose-long-dark-reach-attacker' as const, player: actor, cardInstanceId: id, definitionId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Legal actions while a `great-secrets-choose-item` resolution is pending
 * (Great Secrets Buried There, dm-63): the deck owner must choose one of the
 * revealed eligible items to place off to the side under the host card. One
 * `choose-set-aside-item` action per eligible item; the choice is mandatory
 * (no pass).
 */
export function greatSecretsChooseItemActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'great-secrets-choose-item') return [];
  const { eligibleInstanceIds, deckOwnerId } = top.kind;
  const deckOwner = playerById(state, deckOwnerId);
  if (!deckOwner) return [];
  const inDeck = new Set(deckOwner.playDeck.map(c => c.instanceId as string));
  const actions: EvaluatedAction[] = [];
  for (const id of eligibleInstanceIds) {
    if (!inDeck.has(id as string)) continue;
    const card = deckOwner.playDeck.find(c => c.instanceId === id)!;
    logDetail(`Great Secrets Buried There: offering to set aside "${cardName(state, card.definitionId)}"`);
    actions.push({
      action: { type: 'choose-set-aside-item' as const, player: actor, cardInstanceId: id },
      viable: true,
    });
  }
  return actions;
}

/**
 * Legal actions while a `tap-or-roll-choice` resolution is pending (A Lie in
 * Your Eyes, as-23): the defending player must choose one of tap the
 * character, tap an untapped ally the character controls (one action per
 * eligible ally — omitted entirely when none is untapped), or let the
 * card-player roll. The choice is mandatory ("Your opponent may either...").
 */
export function tapOrRollChoiceActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'tap-or-roll-choice') return [];
  const { characterInstanceId } = top.kind;
  const ownerIndex = state.players.findIndex(p => !!p.characters[characterInstanceId]);
  if (ownerIndex === -1) return [];
  const character = state.players[ownerIndex].characters[characterInstanceId];

  const actions: EvaluatedAction[] = [
    {
      action: { type: 'choose-tap-or-roll' as const, player: actor, choice: 'tap-character' as const },
      viable: true,
    },
  ];
  for (const ally of character.allies) {
    if (ally.status !== CardStatus.Untapped) continue;
    actions.push({
      action: {
        type: 'choose-tap-or-roll' as const,
        player: actor,
        choice: 'tap-ally' as const,
        allyInstanceId: ally.instanceId,
      },
      viable: true,
    });
  }
  actions.push({
    action: { type: 'choose-tap-or-roll' as const, player: actor, choice: 'roll' as const },
    viable: true,
  });
  return actions;
}

/**
 * Legal actions while an `agent-play-manifestation-offer` resolution is pending
 * (My Precious dm-29): the defender may tap one untapped character in the target
 * company to play Gollum from hand (discarding My Precious), or pass. One
 * `play-agent-manifestation` action per eligible character; pass always offered.
 */
export function agentPlayManifestationActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'agent-play-manifestation-offer') return [];
  const { companyId, agentId, manifestationCardName } = top.kind;
  const actorPlayer = playerById(state, actor);
  const actions: EvaluatedAction[] = [];
  if (actorPlayer) {
    const company = companyById(actorPlayer.companies, companyId);
    const gollum = actorPlayer.hand.find(c => (defById(state, c.definitionId) as { name?: string })?.name === manifestationCardName);
    if (company && gollum) {
      for (const charId of company.characters) {
        const ch = actorPlayer.characters[charId];
        if (!ch || ch.status !== CardStatus.Untapped) continue;
        actions.push({
          action: {
            type: 'play-agent-manifestation' as const,
            player: actor,
            agentId,
            characterId: ch.instanceId,
            manifestationCardInstanceId: gollum.instanceId,
          },
          viable: true,
        });
      }
    }
  }
  actions.push({ action: { type: 'pass' as const, player: actor }, viable: true });
  return actions;
}

/**
 * Legal actions while a `choose-peek-deck` resolution is pending (Mirror of
 * Galadriel tw-282): the card-player chooses which play deck's top cards they
 * look at and shuffle back on top, or passes ("You may … choose to look at the
 * top five cards of any one play deck"). Only decks that are allowed by the
 * effect's `deckChoice` **and** actually hold cards are offered.
 *
 * An in-play `cancel-deck-search` (Bane of the Ithil-stone tw-13 against a
 * non-minion, Lady of the Golden Wood as-13 against a minion) withholds the
 * actor's **own** deck — "any effect that causes a player to … look at any
 * portion of *his* play deck … outside the normal sequence of play". It never
 * touches the opponent's deck, which those cards do not cover.
 */
export function choosePeekDeckActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'choose-peek-deck') return [];
  const { deckChoice } = top.kind;
  const player = playerById(state, actor);
  const opponent = state.players.find(p => p.id !== actor);
  if (!player || !opponent) return [];
  const actions: EvaluatedAction[] = [];
  const ownDeckCanceller = deckSearchCancellerFor(state, actor);
  if (ownDeckCanceller && deckChoice !== 'opponent') {
    logDetail(`choose-peek-deck: "${ownDeckCanceller}" cancels ${actor as string}'s look at his own play deck`);
  }
  if (deckChoice !== 'opponent' && !ownDeckCanceller && player.playDeck.length > 0) {
    logDetail(`choose-peek-deck: offering ${actor as string}'s own play deck (${player.playDeck.length} card(s))`);
    actions.push({ action: { type: 'choose-peek-deck' as const, player: actor, deckOwner: 'self' }, viable: true });
  }
  if (deckChoice !== 'self' && opponent.playDeck.length > 0) {
    logDetail(`choose-peek-deck: offering ${opponent.id as string}'s play deck (${opponent.playDeck.length} card(s))`);
    actions.push({ action: { type: 'choose-peek-deck' as const, player: actor, deckOwner: 'opponent' }, viable: true });
  }
  // The look is optional ("You may …"), and passing is also the escape hatch
  // if both decks emptied between the play and the choice.
  actions.push({ action: { type: 'pass' as const, player: actor }, viable: true });
  return actions;
}

/**
 * Legal actions while a `great-hunt-source` resolution is pending (The Great
 * Hunt wh-91): the controller chooses whether the opponent reveals from their
 * play deck or discard pile. The choice is mandatory (no pass) — the card is
 * already in play and the process must run.
 */
export function greatHuntSourceActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'great-hunt-source') return [];
  const { opponentId } = top.kind;
  const opponent = playerById(state, opponentId);
  if (!opponent) return [];
  const actions: EvaluatedAction[] = [];
  // Only offer piles that actually have cards to reveal.
  if (opponent.playDeck.length > 0) {
    logDetail(`great-hunt-source: offering to reveal ${opponentId as string}'s play deck`);
    actions.push({ action: { type: 'choose-great-hunt-source' as const, player: actor, source: 'deck' }, viable: true });
  }
  if (opponent.discardPile.length > 0) {
    logDetail(`great-hunt-source: offering to reveal ${opponentId as string}'s discard pile`);
    actions.push({ action: { type: 'choose-great-hunt-source' as const, player: actor, source: 'discard' }, viable: true });
  }
  // If both piles are empty there is nothing to reveal — allow a pass so the
  // resolution can clear.
  if (actions.length === 0) {
    actions.push({ action: { type: 'pass' as const, player: actor }, viable: true });
  }
  return actions;
}

/**
 * Legal actions while a `great-hunt-discard-attack` resolution is pending (The
 * Great Hunt wh-91 ongoing trigger): the controller may have the discarded
 * creature attack their Alatar company, or pass ("you may choose").
 */
export function greatHuntDiscardAttackActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'great-hunt-discard-attack') return [];
  const { creatureInstanceId } = top.kind;
  const defId = resolveInstanceId(state, creatureInstanceId);
  logDetail(`great-hunt-discard-attack: offering to attack with ${defId ? cardName(state, defId, '?') : '?'}`);
  return [
    { action: { type: 'great-hunt-attack-with-creature' as const, player: actor, creatureInstanceId }, viable: true },
    { action: { type: 'pass' as const, player: actor }, viable: true },
  ];
}

/**
 * Legal actions while a `hunt-target-choice` resolution is pending (The Hunt
 * dm-143): the controller names one hazard-creature instance among the
 * opponent's revealed-and-known play-deck/discard-pile cards to force an
 * attack, via `choose-hunt-target`. Recomputed live (not from a stored list)
 * so a candidate that left the opponent's piles between enqueue and choice is
 * never offered. Mandatory `pass` only when no candidate exists ("Unless
 * eliminated or prevented from being in play").
 */
export function huntTargetChoiceActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'hunt-target-choice') return [];
  const { opponentId } = top.kind;
  const candidates = findHuntCandidates(state, opponentId);
  if (candidates.length === 0) {
    logDetail(`hunt-target-choice: no hazard creature ${opponentId as string} has revealed and still holds — mandatory pass`);
    return [{ action: { type: 'pass' as const, player: actor }, viable: true }];
  }
  return candidates.map(c => {
    logDetail(`hunt-target-choice: offering ${cardName(state, c.definitionId, '?')} (${c.source} — ${opponentId as string})`);
    return {
      action: { type: 'choose-hunt-target' as const, player: actor, creatureInstanceId: c.instanceId, definitionId: c.definitionId },
      viable: true,
    };
  });
}

/**
 * Legal actions while a `post-attack-play-offer` resolution is pending (No News
 * of Our Riding le-211): the defending player may play one of the matched
 * resource permanent-events from hand on an eligible character of the company
 * that just faced the attack, or decline with `pass` ("Playable …" is optional).
 *
 * One `play-permanent-event` action per (matched card × legal bearer). The
 * bearer set is recomputed live via {@link afterAttackPlayTargets}, so a
 * character tapped between the attack ending and the choice is no longer
 * offered.
 */
export function postAttackPlayOfferActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'post-attack-play-offer') return [];
  const { companyId, cardInstanceIds } = top.kind;
  const actions: EvaluatedAction[] = [];

  const player = playerById(state, actor);
  const company = player ? companyById(player.companies, companyId) : undefined;
  if (player && company) {
    for (const cardInstanceId of cardInstanceIds) {
      const handCard = player.hand.find(c => c.instanceId === cardInstanceId);
      if (!handCard) continue;
      const def = defById(state, handCard.definitionId);
      if (!def) continue;
      for (const charId of afterAttackPlayTargets(state, player, company, def)) {
        logDetail(`post-attack-play-offer: ${def.name ?? handCard.definitionId as string} playable on ${cardName(state, player.characters[charId].definitionId, '?')}`);
        actions.push({
          action: {
            type: 'play-permanent-event' as const,
            player: actor,
            cardInstanceId,
            targetCharacterId: charId,
          },
          viable: true,
        });
      }
    }
  }

  // "Playable on …" — the window is optional and always declinable.
  actions.push({ action: { type: 'pass' as const, player: actor }, viable: true });
  return actions;
}

/**
 * Legal actions for an `influence-reveal-play-offer` pending resolution
 * (CoE 10.13). A successful influence attempt was declared with an identical
 * card revealed from hand, and the attacker "may immediately play the identical
 * card with the influencing character (without tapping the site and without
 * another influence check required)".
 *
 * The card's own playability restrictions are waived — the rule says so
 * explicitly for characters ("a Hobbit may be played in this way") and the same
 * follows for the rest, since the play is granted by the influence result
 * rather than by the site. So nothing here checks `playableAt`, home sites or
 * site tapping.
 *
 * What *is* checked is influence, which the rule does not waive: a revealed
 * **character** is offered once per controller that can actually pay for it —
 * general influence with enough left in the pool, or a character in the
 * influencer's company with enough unused direct influence. A character nobody
 * can control is not offered at all. Items, allies and factions cost no
 * influence and are offered as a single action.
 *
 * The offer is optional, so `pass` is always available and leaves the revealed
 * card in hand.
 */
export function influenceRevealPlayOfferActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'influence-reveal-play-offer') return [];
  const { revealedInstanceId, influencerId } = top.kind;
  const actions: EvaluatedAction[] = [];

  const player = playerById(state, actor);
  const handCard = player?.hand.find(c => c.instanceId === revealedInstanceId);
  const influencer = player?.characters[influencerId];
  const def = handCard ? defById(state, handCard.definitionId) : undefined;

  if (player && handCard && influencer && def) {
    const name = def.name ?? (handCard.definitionId as string);
    if (isCharacterCard(def)) {
      // Influence is the one cost rule 10.13 keeps. Mind is the printed value:
      // the card is still in hand, so it has no effective stats yet.
      const mind = def.mind ?? 0;
      const company = findCharacterCompany(player.companies, influencerId);
      const remainingGI = generalInfluenceControlLimit(state, actor) - player.generalInfluenceUsed;
      if (remainingGI >= mind) {
        logDetail(`influence-reveal-play-offer: ${name} playable under general influence (${remainingGI} left ≥ mind ${mind})`);
        actions.push({
          action: { type: 'play-revealed-card' as const, player: actor, cardInstanceId: revealedInstanceId, controlledBy: 'general' as const },
          viable: true,
        });
      }
      for (const controllerId of company?.characters ?? []) {
        const controller = player.characters[controllerId];
        if (!controller) continue;
        const di = availableDI(state, controllerId, player, def);
        if (di < mind) continue;
        logDetail(`influence-reveal-play-offer: ${name} playable under ${cardName(state, controller.definitionId, '?')}'s direct influence (${di} ≥ mind ${mind})`);
        actions.push({
          action: { type: 'play-revealed-card' as const, player: actor, cardInstanceId: revealedInstanceId, controlledBy: controllerId },
          viable: true,
        });
      }
      if (actions.length === 0) {
        logDetail(`influence-reveal-play-offer: ${name} (mind ${mind}) cannot be controlled by any available influence — play not offered`);
      }
    } else {
      logDetail(`influence-reveal-play-offer: ${name} playable with ${cardName(state, influencer.definitionId, '?')}`);
      actions.push({
        action: { type: 'play-revealed-card' as const, player: actor, cardInstanceId: revealedInstanceId },
        viable: true,
      });
    }
  }

  // "May immediately play" — always declinable, which leaves the card in hand.
  actions.push({ action: { type: 'pass' as const, player: actor }, viable: true });
  return actions;
}
