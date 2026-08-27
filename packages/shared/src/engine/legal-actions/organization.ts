/**
 * @module legal-actions/organization
 *
 * Legal actions during the organization phase. The active player can
 * reorganize companies, recruit characters, transfer items, and plan
 * movement for the upcoming movement/hazard phase.
 *
 * For play-character actions, every character card in the active player's
 * hand is evaluated against the CoE rules. A candidate action is generated
 * for each possible (site, controlledBy) combination. Non-viable candidates
 * carry a human-readable reason so the client can show why a character
 * cannot be played.
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardDefinition,
  CardInstanceId,
  CharacterCard,
  ResourceEventCard,
  MovementHazardPhaseState,
  PlayerState,
  SiteCard,
  Company,
} from '../../index.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { formatSignedNumber } from '../../format-helpers.js';
import { isCharacterCard, isResourceEventCard, isSiteCard, isAvatarCharacter, isItemCard, isFactionCard, isAllyCard } from '../../types/cards.js';
import { requirePhaseState, companyContainsBalrogAvatar, canCallEndgameNow, isMinionOrBalrog } from '../../state-utils.js';
import { CardStatus, cardStatusToName, Race, Skill } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import type { PlayTargetEffect, PlayOptionEffect, Condition, WithdrawAgentEffect, GrantActionEffect } from '../../types/effects.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { logDetail, logHeading } from './log.js';
import { notPlayable } from './action-builders.js';
import { buildBearerContext, resolveDef, collectCharacterEffects, checkConditionalEffects, resolveStatModifiers, getEffectiveSkills, normalizeCreatureRace } from '../effects/index.js';
import { buildInPlayNames, buildControllerInPlayNames, buildPlayerItemNamesInPlay } from '../recompute-derived.js';
import { buildSiteFilterContext } from '../effective.js';
import { controlCostOf } from '../control-cost.js';
import { activePlayerState, cardName, characterEntries, companyEffectiveSize, companySiteName, defById, defNamesOf, effectiveInPlayDef, findCharacterCompany, findPlayerAvatar, findFallenWizardAvatarName, getCardEffects, isCorruptionCardDef, itemKeywordsOf, itemsMatchingFilter, matchesDefinition, playerById, stagePointsOfCard, toCardInstance, findDuplicationLimitEffect, findPlayConditionEffect, playerHasProtectedWizardhaven, protectedWizardhavenCount, parseHomesiteNames, siteRegionTypeOf, isCardNameInPlayForPlayer, altShortEventReshuffleEffect, playerHasReshuffleMatch, playerPlaysAsSauron } from '../reducer-utils.js';
import { constraintFromCard, countConstraintsFromDefinition } from '../pending.js';
import { fetchZoneItemInstanceIds, isUniqueCharacterInPlay, siteMatchesEntry } from '../reducer-utils.js';
import { manifestationOfEntityInPlay, charactersInPlayNames } from '../manifestations.js';
import { findMoveEffectByShape, moveToFetchToDeckPayload } from '../reducer-move.js';
import type { ResolverContext } from '../effects/index.js';
import { resolveInstanceId } from '../../types/state.js';
import { regressable } from '../reverse-actions.js';
import { playCharacterActions, discardCharacterActions } from './organization-characters.js';
import { recruitViaEventActions } from './recruit-via-event.js';
import { manifestationSwapActions } from './manifestation-swap.js';
import { discardToRecruitActions } from './discard-to-recruit.js';
import { playPermanentEventActions, playShortEventActions } from './organization-events.js';
import {
  planMovementActions,
  moveToInfluenceActions,
  transferItemActions,
  useItemActions,
  storeItemActions,
  splitCompanyActions,
  moveToCompanyActions,
  mergeCompaniesActions,
  companyMovementTaxUnpaid,
  companiesPendingSplitMovementDeclaration,
  isUnderDeepsSurfaceSite,
} from './organization-companies.js';
import { fetchFromSideboardActions, cardSideboardToDeckActions } from './organization-sideboard.js';
import { canPayCost } from '../cost-evaluator.js';
import { grantedAction, grantedActionFor } from './granted-action-emit.js';

/**
 * Filter mode for {@link grantedActionActivations}. Selects which subset
 * of grant-action effects to emit:
 *
 *  - `'anyPhase'` — only effects flagged `anyPhase: true` (CRF rule
 *    2.1.1). Used by legal-action entry points for phases other than
 *    organization (site, M/H, end-of-turn) on the controller's own turn.
 *  - `'opposingSitePhase'` — only effects flagged `opposingSitePhase:
 *    true`. Emitted for the non-active (hazard) player during the
 *    active player's site phase. Used by Magical Harp.
 *  - `'freeCouncil'` — only effects flagged `freeCouncil: true`.
 *    Emitted for either player during the Free Council's
 *    corruption-checks step. Used by Magical Harp.
 *  - `'activeSitePhase'` — only effects flagged `activeSitePhase: true`.
 *    Emitted for the active (resource) player during their own site phase
 *    (enter-or-skip and play-resources steps). Used by Blasting Fire (wh-51)
 *    and Vile Fumes' (wh-54) transform-site feature.
 */
export type GrantActionPhaseFilter =
  | 'anyPhase'
  | 'opposingSitePhase'
  | 'freeCouncil'
  | 'activeSitePhase';

/**
 * Whether `effect` passes the given {@link GrantActionPhaseFilter}.
 * Each filter mode requires the corresponding boolean flag on the
 * effect (`anyPhase`, `opposingSitePhase`, or `freeCouncil`).
 */
function matchesPhaseFilter(
  effect: import('../../types/effects.js').GrantActionEffect,
  filter: GrantActionPhaseFilter,
): boolean {
  if (filter === 'anyPhase') return effect.anyPhase === true;
  if (filter === 'opposingSitePhase') return effect.opposingSitePhase === true;
  if (filter === 'freeCouncil') return effect.freeCouncil === true;
  if (filter === 'activeSitePhase') return effect.activeSitePhase === true;
  return false;
}

/**
 * Whether a `oncePerTurn` grant-action has already been used this turn — i.e.
 * an active `granted-action-used` constraint matches this source instance and
 * action id. The reducer adds the (turn-scoped) constraint on first use; it is
 * cleared at turn-end. Used by Strangling Coils (ba-76).
 */
function grantActionUsedThisTurn(
  state: GameState,
  sourceInstanceId: CardInstanceId,
  actionId: string,
): boolean {
  return state.activeConstraints.some(c =>
    c.kind.type === 'granted-action-used'
    && c.kind.sourceInstanceId === sourceInstanceId
    && c.kind.actionId === actionId,
  );
}

/**
 * Sum of the mind cost of every character a controller holds under direct
 * influence — the part of his direct influence that is already *used*. Uses
 * effective mind (The Arkenstone raises Dwarf mind by 1) and honours a
 * `control-restriction` cost override (Wizard's Myrmidon).
 *
 * No restricted direct influence is credited here: this is the base cost that
 * {@link directInfluenceLedger} then allocates across a controller's
 * unrestricted and restricted allotments.
 */
function followerControlCost(
  state: GameState,
  followerChar: import('../../index.js').CharacterInPlay,
  followerDef: CharacterCard,
): number {
  return controlCostOf(state, followerChar, followerChar.effectiveStats.mind ?? followerDef.mind ?? 0) ?? 0;
}

/**
 * Sum of the mind cost of every character a controller holds under direct
 * influence, charged in full against unrestricted influence. Used by
 * {@link normalUnusedDI}, where a le-150 nullification has already stripped
 * every card-sourced restricted allotment.
 */
function followersMindCost(
  state: GameState,
  controller: import('../../index.js').CharacterInPlay,
  player: { readonly characters: Readonly<Record<string, import('../../index.js').CharacterInPlay>> },
): number {
  let usedDI = 0;
  for (const followerId of controller.followers) {
    const followerChar = player.characters[followerId as string];
    if (!followerChar) continue;
    const followerDef = resolveDef(state, followerChar.instanceId);
    if (isCharacterCard(followerDef) && followerDef.mind !== null) {
      usedDI += followerControlCost(state, followerChar, followerDef);
    }
  }
  return usedDI;
}

/**
 * The result of allocating a controller's followers across his direct
 * influence: how much *unrestricted* influence is left (negative when he is
 * over-extended) and how much of each restricted allotment the followers have
 * already consumed, keyed by {@link diPoolKey}.
 */
export interface DirectInfluenceLedger {
  /** Unrestricted DI left after the followers are paid for; may be negative. */
  readonly unrestricted: number;
/** Card instance granting a restricted allotment → amount of it spent on followers. */
  readonly poolsUsed: ReadonlyMap<CardInstanceId, number>;
  /** Per-follower charge against *unrestricted* influence, largest first. */
  readonly charges: readonly { readonly followerId: CardInstanceId; readonly charge: number }[];
}

/**
 * Builds the `influence-check` resolver context a controller's conditional DI
 * modifiers are evaluated against for one prospective target.
 */
function influenceCheckContext(
  controller: import('../../index.js').CharacterInPlay,
  ctrlDef: CharacterCard,
  targetDef: CharacterCard,
): ResolverContext {
  return {
    reason: 'influence-check',
    // Effective prowess so stat-comparing conditions (Whip le-348:
    // "prowess less than the bearer's") see the live value, not the
    // printed one.
    bearer: { ...buildBearerContext(ctrlDef), prowess: controller.effectiveStats.prowess },
    target: {
      name: targetDef.name,
      race: targetDef.race,
      homesite: parseHomesiteNames(targetDef.homesite ?? ''),
      keywords: targetDef.keywords ?? [],
      // Printed stats — the target is a definition, not yet in play here.
      // `mind` is omitted for avatars so "with a mind" gates fail (Whip le-348).
      ...(targetDef.mind !== null ? { mind: targetDef.mind } : {}),
      prowess: targetDef.prowess,
    },
  };
}

/**
 * Breaks a controller's target-conditional direct influence against one target
 * down by the card *instance* granting it.
 *
 * {@link targetConditionalDIBonus} returns the same influence as a single
 * total; this keeps the sources apart so a follower already paid for out of
 * one card's allotment cannot be paid for a second time out of that same
 * allotment (CoE 3.14: restricted direct influence is applied once, not once
 * per character being influenced).
 *
 * One card instance is one allotment, even when its restriction is spelled out
 * as several `when`-filtered modifiers: Bûthrakaur ba-5's "+3 direct influence
 * against Trolls, Orcs, Troll factions, and Orc factions" is a single +3 that
 * the card data models as four effects, and spending it on an Orc must leave
 * nothing for a Troll.
 */
function targetConditionalDIPools(
  state: GameState,
  controller: import('../../index.js').CharacterInPlay,
  targetDef: CharacterCard,
): Map<CardInstanceId, number> {
  const pools = new Map<CardInstanceId, number>();
  const ctrlDef = resolveDef(state, controller.instanceId);
  if (!ctrlDef || !isCharacterCard(ctrlDef)) return pools;
  const resolverCtx = influenceCheckContext(controller, ctrlDef, targetDef);
  const collected = checkConditionalEffects(collectCharacterEffects(state, controller, resolverCtx));
  const bySource = new Map<CardInstanceId, typeof collected>();
  for (const effect of collected) {
    bySource.set(effect.sourceInstance, [...(bySource.get(effect.sourceInstance) ?? []), effect]);
  }
  for (const [sourceInstance, effects] of bySource) {
    const value = resolveStatModifiers(effects, 'direct-influence', 0, resolverCtx);
    if (value !== 0) pools.set(sourceInstance, value);
  }
  return pools;
}

/**
 * Pays for every follower a controller holds out of his direct influence.
 *
 * A controller's influence comes in two flavours: *unrestricted* influence
 * (his `effectiveStats.directInfluence`, usable against anything) and
 * *restricted* allotments gated on the target — Elf-stone tw-224's "+2 against
 * Elves", Whip le-348's "+2 against one character with a mind and prowess less
 * than the bearer's", Bolg ba-4's Orc bonuses. Each follower is paid for out
 * of unrestricted influence first (CoE 3.14 spends unrestricted influence
 * ahead of restricted influence), and only what is left over draws on the
 * restricted allotments that match *that* follower.
 *
 * Two consequences matter to callers:
 *
 *  - A follower covered by a restricted allotment stops eating into the
 *    controller's unrestricted influence, so a later check against an
 *    unrelated target (a faction-influence attempt by the same character) sees
 *    the influence it should — the bug behind Whip le-348 reporting an
 *    Orc-Captain at −2 DI.
 *  - An allotment already spent on a follower is *gone*: a second character
 *    matching the same restriction cannot be admitted on it (CoE 3.14 —
 *    restricted direct influence is applied once, not once per character being
 *    influenced).
 */
function directInfluenceLedger(
  state: GameState,
  controller: import('../../index.js').CharacterInPlay,
  player: { readonly characters: Readonly<Record<string, import('../../index.js').CharacterInPlay>> },
  unrestrictedDI: number,
): DirectInfluenceLedger {
  const poolsUsed = new Map<CardInstanceId, number>();
  const charges: { followerId: CardInstanceId; charge: number }[] = [];
  let unrestricted = unrestrictedDI;

  for (const followerId of controller.followers) {
    const followerChar = player.characters[followerId as string];
    if (!followerChar) continue;
    const followerDef = resolveDef(state, followerChar.instanceId);
    if (!isCharacterCard(followerDef) || followerDef.mind === null) continue;

    let owed = followerControlCost(state, followerChar, followerDef);
    const fromUnrestricted = Math.min(Math.max(0, unrestricted), owed);
    unrestricted -= fromUnrestricted;
    owed -= fromUnrestricted;

    if (owed > 0) {
      for (const [key, amount] of targetConditionalDIPools(state, controller, followerDef)) {
        const free = amount - (poolsUsed.get(key) ?? 0);
        if (free <= 0) continue;
        const taken = Math.min(free, owed);
        poolsUsed.set(key, (poolsUsed.get(key) ?? 0) + taken);
        owed -= taken;
        if (owed === 0) break;
      }
    }

    // Whatever no allotment covers over-extends the controller: it drives his
    // unrestricted influence negative, which is what the over-extension checks
    // (`revertOverextendedDirectInfluenceFollowers`) look for.
    unrestricted -= owed;
    charges.push({ followerId, charge: fromUnrestricted + owed });
  }

  charges.sort((a, b) => b.charge - a.charge);
  return { unrestricted, poolsUsed, charges };
}

/**
 * Public entry point to {@link directInfluenceLedger} for a controller in
 * play, starting from his effective (unrestricted) direct influence.
 */
export function directInfluenceLedgerFor(
  state: GameState,
  controller: import('../../index.js').CharacterInPlay,
  player: { readonly characters: Readonly<Record<string, import('../../index.js').CharacterInPlay>> },
): DirectInfluenceLedger {
  return directInfluenceLedger(state, controller, player, controller.effectiveStats.directInfluence);
}

/**
 * The character's **unused normal direct influence** — the value Webs of Fear
 * & Treachery (le-150) preserves when every other influence modification is
 * reduced to zero.
 *
 * "Normal" direct influence is the influence the character has *of his own*:
 * his printed `directInfluence`, plus "influence modifications given in a
 * character's card text" (the `direct-influence` `stat-modifier` effects
 * printed on his own card, e.g. Strider ba-1's "+3 direct influence when
 * influencing Rangers of the North"), minus his followers' mind cost. Direct
 * influence granted by *other* cards — rings and other items, permanent-events
 * played on him, attached hazards — is a modification from another card's text
 * and is therefore nullified, so it is deliberately **not** read off
 * `effectiveStats.directInfluence` the way {@link availableDI} does.
 *
 * Followers are charged their full mind cost here, without the restricted-DI
 * credit {@link directInfluenceLedger} gives them: le-150 has already zeroed
 * every card-sourced restricted allotment, and the controller's *own*
 * restricted text is folded into `ownEffects` against the current target
 * already — crediting it a second time against a follower would double it.
 *
 * @param ownEffects - the influencer's own-card effects, already filtered
 *   against `context` (i.e. the `sourceInstance === controllerInstanceId`
 *   slice of a `collectCharacterEffects` result). Pass an empty array when no
 *   influence context is available; only the printed value then applies.
 * @param context - the influence resolver context the modifications were
 *   filtered against, used for value-expression evaluation and clamps.
 */
export function normalUnusedDI(
  state: GameState,
  controllerInstanceId: CardInstanceId,
  player: { readonly characters: Readonly<Record<string, import('../../index.js').CharacterInPlay>> },
  ownEffects: readonly import('../effects/resolver.js').CollectedEffect[],
  context: ResolverContext,
): number {
  const controller = player.characters[controllerInstanceId as string];
  if (!controller) return 0;
  const def = resolveDef(state, controller.instanceId);
  if (!isCharacterCard(def)) return 0;

  const printedDI = def.directInfluence;
  const normalDI = resolveStatModifiers(ownEffects, 'direct-influence', printedDI, context);
  const unused = normalDI - followersMindCost(state, controller, player);
  logDetail(`  Normal unused DI for ${def.name}: printed ${printedDI} → own card text ${normalDI}, unused ${unused}`);
  return unused;
}

/**
 * Computes the available (unused) direct influence for a character in play,
 * optionally factoring in conditional DI bonuses against a specific target.
 *
 * A character's DI is their effectiveStats.directInfluence minus the sum
 * of mind values of all their followers. When a target character is specified,
 * conditional DI bonuses (e.g. Glorfindel's "+1 DI against Elves") are
 * resolved using an `influence-check` context.
 *
 * @param state - The full game state.
 * @param controllerInstanceId - The controlling character's instance ID.
 * @param player - The player who owns the controller.
 * @param targetDef - Optional target character definition for conditional DI resolution.
 */
export function availableDI(
  state: GameState,
  controllerInstanceId: CardInstanceId,
  player: { readonly characters: Readonly<Record<string, import('../../index.js').CharacterInPlay>> },
  targetDef?: CharacterCard,
): number {
  const controller = player.characters[controllerInstanceId as string];
  if (!controller) return 0;

  const ledger = directInfluenceLedgerFor(state, controller, player);
  let baseDI = ledger.unrestricted;

  // When checking DI for a specific target, resolve conditional DI bonuses
  // (e.g. Glorfindel II "+1 DI against Elves" uses reason: "influence-check"),
  // net of whatever the controller's followers already spent out of those same
  // restricted allotments (CoE 3.14 — each applies once, not once per
  // character being influenced).
  if (targetDef) {
    let alreadySpent = 0;
    for (const [key, amount] of targetConditionalDIPools(state, controller, targetDef)) {
      alreadySpent += Math.min(amount, ledger.poolsUsed.get(key) ?? 0);
    }
    baseDI += targetConditionalDIBonus(state, controller, targetDef) - alreadySpent;
  }

  return baseDI;
}

/**
 * Resolves a controller's target-conditional direct-influence bonus against a
 * specific character (e.g. Glorfindel II's "+1 DI against Elves", modeled as a
 * `stat-modifier` gated on `reason: "influence-check"`). Only target-gated
 * modifiers count: anything gated on the bearer alone (or ungated) is already
 * inside `effectiveStats.directInfluence`, so folding it in again would double
 * it (see `checkConditionalEffects`).
 *
 * This is the *gross* allotment against the target. Callers that must also
 * account for what the controller's existing followers already spent out of
 * the same allotments go through {@link availableDI}, which nets it off using
 * the {@link DirectInfluenceLedger}.
 */
export function targetConditionalDIBonus(
  state: GameState,
  controller: import('../../index.js').CharacterInPlay,
  targetDef: CharacterCard,
): number {
  const ctrlDef = resolveDef(state, controller.instanceId);
  if (!ctrlDef || !isCharacterCard(ctrlDef)) return 0;
  const resolverCtx = influenceCheckContext(controller, ctrlDef, targetDef);
  const charEffects = checkConditionalEffects(collectCharacterEffects(state, controller, resolverCtx));
  const conditionalDI = resolveStatModifiers(charEffects, 'direct-influence', 0, resolverCtx);
  if (conditionalDI !== 0) {
    logDetail(`  DI bonus from influence-check effects: ${formatSignedNumber(conditionalDI)} against ${targetDef.name} (${targetDef.race})`);
  }
  return conditionalDI;
}

/**
 * Computes all legal actions during the organization phase.
 *
 * Returns {@link EvaluatedAction} items so that non-viable play-character
 * candidates carry a human-readable reason for the client to display.
 */
/**
 * Discard-stage-resource actions (MEWH "The Player Turn"): a Fallen-wizard may
 * discard one of their in-play stage resource permanent-events during the
 * organization phase, but not if doing so would drop their stage-point total
 * below 3. One action is offered per eligible stage permanent-event.
 */
export function discardStageResourceActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player || player.alignment !== 'fallen-wizard') return [];

  const actions: EvaluatedAction[] = [];
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def || !isResourceEventCard(def) || (def as { alignment?: string }).alignment !== 'stage' || def.eventType !== 'permanent') continue;
    // Discarding must keep the running total at 3 or more (MEWH).
    const contribution = stagePointsOfCard(def);
    if (player.stagePoints - contribution < 3) {
      logDetail(`Discard-stage-resource: ${def.name} not offered — would drop stage points to ${player.stagePoints - contribution} (< 3)`);
      continue;
    }
    logDetail(`Discard-stage-resource: ${def.name} can be discarded (stage points ${player.stagePoints} → ${player.stagePoints - contribution})`);
    actions.push({
      action: { type: 'discard-stage-resource', player: playerId, cardInstanceId: card.instanceId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Voluntary-discard actions ("Discard during your organization phase if you
 * choose" — Going Ever Under Dark ba-37). One action per in-play permanent-event
 * the player controls that carries a `voluntary-discard` effect with
 * `phase: "organization"`.
 */
export function voluntaryDiscardInPlayActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    const eff = getCardEffects(def).find(e => e.type === 'voluntary-discard');
    if (!eff || (eff as { phase?: string }).phase !== 'organization') continue;
    logDetail(`Voluntary-discard: ${cardName(state, card.definitionId)} can be discarded during the organization phase`);
    actions.push({
      action: { type: 'voluntary-discard-in-play', player: playerId, cardInstanceId: card.instanceId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Enchanted Stream (as-27) movement-tax payment actions. For each of the
 * player's companies bound by a `company-movement-tax` permanent event whose
 * tax is not yet satisfied this org phase, offer one `pay-movement-tax` action
 * per untapped character in that company. Paying taps the chosen character and
 * counts toward the tax, unlocking `plan-movement` / `split-company` once the
 * required number ("to a maximum of two") have been tapped.
 */
export function payMovementTaxActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    if (!companyMovementTaxUnpaid(state, player, company)) continue;
    for (const charId of company.characters) {
      const char = player.characters[charId];
      if (!char || char.status !== CardStatus.Untapped) continue;
      logDetail(`Enchanted Stream: offering to tap ${cardName(state, char.definitionId)} toward company ${company.id as string}'s movement tax`);
      actions.push({
        action: { type: 'pay-movement-tax', player: playerId, companyId: company.id, characterId: charId },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * A More Evil Hour (ba-48) discard-to-grant-movement activations. While the
 * card is in play **and tapped** ("If tapped, you may discard this card during
 * your organization phase"), the controller may discard it to target one of
 * their companies "allowed to move with region movement" — i.e. any company not
 * locked to Under-deeps-only movement by containing the Balrog avatar. One
 * `discard-for-evil-hour-movement` action is offered per (tapped source card ×
 * eligible non-empty company).
 */
export function evilHourGrantMovementActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const actions: EvaluatedAction[] = [];
  for (const card of player.cardsInPlay) {
    if (card.status !== CardStatus.Tapped) continue;
    const def = defById(state, card.definitionId);
    const eff = getCardEffects(def).find(e => e.type === 'evil-hour-grant-movement');
    if (!eff) continue;
    for (const company of player.companies) {
      if (company.characters.length === 0) continue;
      if (companyContainsBalrogAvatar(state, player, company)) {
        logDetail(`A More Evil Hour: company ${company.id as string} contains the Balrog avatar — cannot use region movement, not a valid target`);
        continue;
      }
      logDetail(`A More Evil Hour: ${cardName(state, card.definitionId)} may be discarded to grant company ${company.id as string} the region-movement bonus`);
      actions.push({
        action: { type: 'discard-for-evil-hour-movement', player: playerId, cardInstanceId: card.instanceId, companyId: company.id },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Org-phase-fetch activations (A Strident Spawn wh-61: "During your
 * organization phase, you may take one Half-orc character from your discard
 * pile to your hand"). For each in-play permanent-event the player controls that
 * carries an `org-phase-fetch` effect, offer one `activate-org-fetch` action —
 * provided the source has not already been used this turn and at least one
 * matching candidate exists in the named source piles.
 */
export function orgPhaseFetchActivations(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const orgState = requirePhaseState(state, Phase.Organization);
  const used = orgState.discardFetchUsedThisTurn ?? [];
  const actions: EvaluatedAction[] = [];
  for (const card of player.cardsInPlay) {
    if (used.includes(card.instanceId)) continue;
    const def = defById(state, card.definitionId);
    if (!def) continue;
    for (const eff of getCardEffects(def)) {
      if (eff.type !== 'org-phase-fetch') continue;
      const hasCandidate = eff.from.some(src => {
        const pile = src === 'sideboard' ? player.sideboard
          : src === 'deck' ? player.playDeck
          : player.discardPile;
        return pile.some(c => {
          const cDef = defById(state, c.definitionId);
          return cDef !== undefined && matchesDefinition(cDef, eff.filter);
        });
      });
      if (!hasCandidate) {
        logDetail(`${def.name}: org-phase-fetch offered no candidates (none matching filter in [${eff.from.join(', ')}])`);
        continue;
      }
      logDetail(`${def.name}: org-phase-fetch available (take one matching card to hand)`);
      actions.push({
        action: { type: 'activate-org-fetch', player: playerId, cardInstanceId: card.instanceId },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Item-cache hand-store actions (Armory dm-116): "You may place any minor
 * items from your hand under Armory during your organization phase." For
 * each in-play card the player controls that carries an
 * `item-cache-hand-store` effect, offer one `store-item-in-cache` action per
 * hand item whose subtype matches the effect's `subtypes` list. Unlike
 * `store-item`, this path has no site or bearer requirement — the item is
 * moved directly from hand, never having been played.
 */
export function itemCacheHandStoreActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const actions: EvaluatedAction[] = [];
  for (const host of player.cardsInPlay) {
    const hostDef = defById(state, host.definitionId);
    const cacheEffect = getCardEffects(hostDef).find(e => e.type === 'item-cache-hand-store');
    if (!cacheEffect || cacheEffect.type !== 'item-cache-hand-store') continue;
    for (const card of player.hand) {
      const itemDef = defById(state, card.definitionId);
      if (!itemDef || !isItemCard(itemDef)) continue;
      if (!cacheEffect.subtypes.includes(itemDef.subtype)) continue;
      logDetail(`${hostDef?.name ?? '?'}: ${itemDef.name} may be placed under it from hand`);
      actions.push({
        action: { type: 'store-item-in-cache', player: playerId, itemInstanceId: card.instanceId, hostInstanceId: host.instanceId },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Pair-resource-with-CoF actions (Crown of Flowers, dm-121).
 *
 * Crown of Flowers enters play as an environment with "no effect until you
 * play a resource with it". That one-time pairing is a non-blocking
 * organization-phase action — the player may organize freely and play one
 * resource "with" an in-play Crown of Flowers at any point while the Crown is
 * still unpaired. Emitting these here (rather than enqueuing a blocking pending
 * resolution when the Crown enters play) is what lets the player continue to
 * play/organize characters after playing Crown of Flowers.
 *
 * A Crown of Flowers is identified generically by its
 * `on-event: self-enters-play → offer-resource-play` effect. Only Crowns with
 * no `linkedInstanceId` (not yet paired) are offered, and one action is
 * produced per resource card in hand.
 */
export function cofPairResourceActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  for (const cof of player.cardsInPlay) {
    if (cof.linkedInstanceId !== undefined) continue; // already paired with a resource
    const cofDef = defById(state, cof.definitionId);
    if (!cofDef) continue;
    const offersResourcePlay = getCardEffects(cofDef).some(
      eff => eff.type === 'on-event' && eff.event === 'self-enters-play' && eff.apply.type === 'offer-resource-play',
    );
    if (!offersResourcePlay) continue;

    for (const card of player.hand) {
      const def = defById(state, card.definitionId);
      if (!def) continue;
      if (
        def.cardType !== 'hero-resource-event' &&
        def.cardType !== 'hero-resource-item' &&
        def.cardType !== 'hero-resource-ally' &&
        def.cardType !== 'hero-resource-faction'
      ) continue;

      // Crown of Flowers only re-interprets the resource's own text as though
      // Gates of Morning were in play and Doors of Night were not — it "does
      // not affect the interpretation of any card except the resource played
      // with it" and does not waive the resource's other play requirements.
      // Allies/factions still need a company at a site matching their printed
      // `playableAt` (e.g. Gollum requires Goblin-gate or Moria); otherwise
      // Crown of Flowers would let any site-restricted ally or faction — or
      // The One Ring's ally-like effects — enter play from anywhere for free.
      if (isAllyCard(def) || isFactionCard(def)) {
        const hasQualifyingSite = player.companies.some(company => {
          if (!company.currentSite) return false;
          const siteDef = defById(state, company.currentSite.definitionId);
          return siteDef !== undefined && isSiteCard(siteDef)
            && def.playableAt.some(entry => siteMatchesEntry(siteDef, entry));
        });
        if (!hasQualifyingSite) {
          logDetail(`${cofDef.name}: ${def.name} not offered as pair — no company at a site matching its playableAt`);
          continue;
        }
      }

      // Same principle for resource events with their own `play-target: site`
      // effect (The Windlord Found Me dm-164: "Playable at an untapped
      // Isengard, Shadow-hold, or Dark-hold"). Crown of Flowers reinterprets
      // only the paired resource's *text*, not the company's location — a
      // company merely planning to move to a qualifying site does not
      // satisfy the requirement until it actually arrives there.
      const sitePlayTarget = getCardEffects(def).find(
        (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'site',
      );
      if (sitePlayTarget) {
        const requiresUntapped = hasPlayFlag(def, 'untapped-site-required');
        const hasQualifyingSite = player.companies.some(company => {
          if (!company.currentSite) return false;
          if (requiresUntapped && company.currentSite.status !== CardStatus.Untapped) return false;
          const siteDef = defById(state, company.currentSite.definitionId);
          if (!siteDef || !isSiteCard(siteDef)) return false;
          if (!sitePlayTarget.filter) return true;
          const matchTarget = buildSiteFilterContext(state, siteDef, company.currentSite.instanceId);
          return matchesCondition(sitePlayTarget.filter, matchTarget);
        });
        if (!hasQualifyingSite) {
          logDetail(`${cofDef.name}: ${def.name} not offered as pair — no company at a site matching its play-target`);
          continue;
        }
      }

      logDetail(`${cofDef.name}: offering ${def.name} (${card.instanceId as string}) as pair`);
      actions.push({
        action: {
          type: 'pair-resource-with-cof',
          player: playerId,
          cardInstanceId: card.instanceId,
          cofInstanceId: cof.instanceId,
        },
        viable: true,
      });
    }
  }
  return actions;
}

export function organizationActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  if (state.activePlayer !== playerId) {
    logDetail(`Not active player (active: ${state.activePlayer as string ?? 'null'}), no actions`);
    return [];
  }

  const orgState = requirePhaseState(state, Phase.Organization);

  // Pending corruption checks (transfer / wound / Lure) are now produced
  // and consumed via the unified pending-resolution system. The
  // resolution short-circuit in `legal-actions/index.ts` collapses the
  // menu to the corruption-check action before this function is reached,
  // so no per-phase short-circuit is needed here.

  // When the sideboard sub-flow (CoE 2.II.6) is active, only fetch actions
  // (+ pass for discard) are legal for *organizing* — but the sub-flow only
  // suspends "organizing" (2.II.1: play/discard a character, set company
  // composition), not independent character abilities. CoE 2.II.6 carries no
  // "no other actions" clause — unlike 2.II.1, which explicitly says so — so
  // granted-action activations (e.g. a character's tap-to-remove-corruption
  // action, gold-ring tests, or Gandalf's "may untap at the end of your
  // organization phase") remain available while the sideboard access is
  // still being resolved, and must still be offered here.
  if (orgState.sideboardFetchDestination !== null) {
    logHeading(`Sideboard sub-flow active (destination: ${orgState.sideboardFetchDestination})`);
    return [...fetchFromSideboardActions(state, playerId), ...grantedActionActivations(state, playerId)];
  }

  // Note: "end of the organization phase" cards (e.g. Stealth) do not open a
  // restrictive sub-step. Per CoE 2.II.7 the resource player may declare
  // movement and otherwise organize at any point during the organization
  // phase, including after playing such a card. End-of-org cards are offered
  // alongside the normal organization actions below (see
  // `playResourceShortEventActions`), and the phase advances to Long-event
  // only when the active player passes.

  const actions: EvaluatedAction[] = [];

  // Cancel movement for companies with planned destinations
  for (const company of player.companies) {
    if (company.destinationSite !== null) {
      logDetail(`Company ${company.id as string} has planned movement → can cancel`);
      actions.push(regressable(state, {
        type: 'cancel-movement',
        player: playerId,
        companyId: company.id,
      }));
    }
  }

  logDetail(`Organization: ${player.companies.length} company/companies, ${Object.keys(player.characters).length} character(s) in play`);

  // Play-character actions for each character card in hand
  const characterActions = playCharacterActions(state, playerId);
  actions.push(...characterActions);

  // Collect instance IDs that already have a play-character evaluation
  const evaluatedInstances = new Set(
    characterActions.map(ea =>
      (ea.action as { characterInstanceId: CardInstanceId }).characterInstanceId as string,
    ),
  );

  // Play permanent-event resource cards from hand
  const permanentEventActions = playPermanentEventActions(state, playerId);
  actions.push(...permanentEventActions);
  const permanentEventInstances = new Set(
    permanentEventActions.map(ea =>
      (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId as string,
    ),
  );

  // MEWH: a Fallen-wizard may discard an in-play stage resource (keeping ≥3 stage points)
  actions.push(...discardStageResourceActions(state, playerId));

  // "Discard during your organization phase if you choose" (Going Ever Under Dark ba-37)
  actions.push(...voluntaryDiscardInPlayActions(state, playerId));

  // Org-phase fetch granted by an in-play permanent-event (A Strident Spawn wh-61)
  actions.push(...orgPhaseFetchActivations(state, playerId));

  // Play one resource "with" an in-play Crown of Flowers (dm-121). Non-blocking:
  // offered alongside the normal organization actions, never collapsing the menu.
  const cofPairEvaluated = cofPairResourceActions(state, playerId);
  actions.push(...cofPairEvaluated);
  const cofPairInstances = new Set(
    cofPairEvaluated.map(ea =>
      (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId as string,
    ),
  );

  // A More Evil Hour (ba-48): discard the tapped card to grant a company the
  // conditional region-movement bonus
  actions.push(...evilHourGrantMovementActions(state, playerId));

  // Play short-event cards as resource (e.g. Twilight cancels an environment)
  const shortEventActions = playShortEventActions(state, playerId);
  actions.push(...shortEventActions);
  const shortEventInstances = new Set(
    shortEventActions.map(ea =>
      (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId as string,
    ),
  );

  // Play resource short-events from hand (e.g. Smoke Rings, Stealth,
  // Marvels Told). Per CoE 2.1.1, resource short-events are playable during
  // any phase of the active player's turn unless a rule or effect restricts
  // them. The helper skips hand cards whose play-window restricts them to
  // a different phase, and cards already evaluated as characters.
  const resourceShortEventEvaluated = playResourceShortEventActions(
    state, playerId, evaluatedInstances, 'organization',
  );
  actions.push(...resourceShortEventEvaluated);
  const resourceShortEventInstances = new Set(
    resourceShortEventEvaluated
      .map(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId as string | undefined)
      .filter((id): id is string => typeof id === 'string'),
  );

  // Character-recruitment events (A Chance Meeting tw-188): bring a character
  // into play at a relaxed set of sites, bypassing the one-character-per-turn
  // limit. Emitted as play-character actions carrying viaEventInstanceId.
  const recruitViaEventEvaluated = recruitViaEventActions(state, playerId);
  actions.push(...recruitViaEventEvaluated);
  const recruitViaEventInstances = new Set<string>();
  for (const ea of recruitViaEventEvaluated) {
    const a = ea.action as { characterInstanceId?: CardInstanceId; viaEventInstanceId?: CardInstanceId };
    if (a.characterInstanceId) recruitViaEventInstances.add(a.characterInstanceId as string);
    if (a.viaEventInstanceId) recruitViaEventInstances.add(a.viaEventInstanceId as string);
  }

  // Manifestation swaps (Strider ba-1 → Aragorn II): playable whenever a
  // normal resource could be played (CRF 22), so offered here too.
  const manifestationSwapEvaluated = manifestationSwapActions(state, playerId);
  actions.push(...manifestationSwapEvaluated);
  for (const ea of manifestationSwapEvaluated) {
    const a = ea.action as { cardInstanceId?: CardInstanceId };
    if (a.cardInstanceId) recruitViaEventInstances.add(a.cardInstanceId as string);
  }

  // Discard-to-recruit (Folco Boffin dm-180): likewise playable whenever a
  // normal resource could be played (CRF 22).
  const discardToRecruitEvaluated = discardToRecruitActions(state, playerId);
  actions.push(...discardToRecruitEvaluated);
  for (const ea of discardToRecruitEvaluated) {
    const a = ea.action as { cardInstanceId?: CardInstanceId };
    if (a.cardInstanceId) recruitViaEventInstances.add(a.cardInstanceId as string);
  }

  // Item-cache hand-store actions (Armory dm-116): place minor items from hand
  // under a cache host directly, without playing them. Computed here (ahead of
  // the not-playable sweep below) so eligible hand items are excluded from it.
  const itemCacheHandStoreEvaluated = itemCacheHandStoreActions(state, playerId);
  actions.push(...itemCacheHandStoreEvaluated);
  const itemCacheHandStoreInstances = new Set(
    itemCacheHandStoreEvaluated.map(ea =>
      (ea.action as { itemInstanceId: CardInstanceId }).itemInstanceId as string,
    ),
  );

  // Mark remaining hand cards as not playable during organization
  for (const handCard of player.hand) {
    if (evaluatedInstances.has(handCard.instanceId as string)) continue;
    if (permanentEventInstances.has(handCard.instanceId as string)) continue;
    if (shortEventInstances.has(handCard.instanceId as string)) continue;
    if (resourceShortEventInstances.has(handCard.instanceId as string)) continue;
    if (recruitViaEventInstances.has(handCard.instanceId as string)) continue;
    if (cofPairInstances.has(handCard.instanceId as string)) continue;
    if (itemCacheHandStoreInstances.has(handCard.instanceId as string)) continue;
    actions.push(notPlayable(playerId, handCard.instanceId, 'Not playable during the organization'));
  }

  // Move-to-influence actions (reassign characters between GI and DI)
  actions.push(...moveToInfluenceActions(state, playerId));

  // Discard-character actions (rule 3.22: non-avatar at a haven or home site)
  actions.push(...discardCharacterActions(state, playerId));

  // Plan-movement actions for each company
  actions.push(...planMovementActions(state, playerId));

  // Enchanted Stream (as-27): tap untapped characters toward a company's
  // movement tax so it may voluntarily move/split this org phase.
  actions.push(...payMovementTaxActions(state, playerId));

  // Transfer-item actions (move items between characters at the same site)
  actions.push(...transferItemActions(state, playerId));
  actions.push(...useItemActions(state, playerId));

  // Store-item actions (store items at matching sites)
  actions.push(...storeItemActions(state, playerId));

  // Split-company actions (move GI character + followers to a new company)
  actions.push(...splitCompanyActions(state, playerId));

  // Move-to-company actions (move GI character + followers to an existing company at same site)
  actions.push(...moveToCompanyActions(state, playerId));

  // Merge-companies actions (join entire company into another at same site)
  actions.push(...mergeCompaniesActions(state, playerId));

  // Fetch-from-sideboard actions (tap avatar to bring cards from sideboard)
  actions.push(...fetchFromSideboardActions(state, playerId));

  // Card-granted sideboard self-relocation (Terror Heralds Doom ba-78 et al.):
  // a card in the sideboard may bring itself into the play deck.
  actions.push(...cardSideboardToDeckActions(state, playerId));

  // Grant-action activations from attached hazards (e.g. Foolish Words removal)
  actions.push(...grantedActionActivations(state, playerId));

  // Grant-actions on the player's bare in-play cards — factions (e.g. A
  // Panoply of Wings wh-37) and unattached permanent-event resources (e.g.
  // Earth-eater wh-67)
  actions.push(...bareCardGrantActions(state, playerId));

  // Grant-actions on the player's stored (marshalling-point pile) cards —
  // no bearer to attach to, so scanned separately (Reforging tw-314)
  actions.push(...storedCardGrantActions(state, playerId));

  // Stored-card combine actions — no tap, discard a differently-named
  // stored card instead (Andúril tw-192: "discard a stored Reforging and
  // place Andúril with Narsil")
  actions.push(...storedCombineGrantActions(state, playerId));

  // The Lidless Eye (le-203) / Sauron (ba-43): once-per-org-phase dual-mode
  // ability (sideboard-fetch or peek-opponent-hand)
  actions.push(...sauronOrgGrantActions(state, playerId));

  // Sage-tap ring tests granted by the company's current site (e.g. Mount Doom)
  actions.push(...siteSageRingTestActivations(state, playerId));

  // Ringwraith reanimation from the discard pile granted by the company's
  // current site (Urlurtsu Nurn le-409)
  actions.push(...siteRingwraithReanimateActivations(state, playerId));

  // Voluntary return-to-hand of an attached ally (Radagast's Black Bird wh-114)
  actions.push(...returnAttachedToHandActions(state, playerId));

  // Rule 2.II.3.6: "all but one of the companies must declare movement to a
  // new site during that organization phase." Withhold pass while more than
  // one split-lineage company still lacks a destination and a plan-movement
  // action remains available to fix it — otherwise let pass through so a
  // company with nowhere to go doesn't deadlock the phase.
  const pendingSplitMovement = companiesPendingSplitMovementDeclaration(state, playerId);
  const canStillDeclareMovement = pendingSplitMovement.length > 0 && actions.some(
    ea => ea.action.type === 'plan-movement' && pendingSplitMovement.includes(ea.action.companyId),
  );
  if (canStillDeclareMovement) {
    logDetail(`Organization: withholding pass — rule 2.II.3.6 requires ${pendingSplitMovement.length} more split company(ies) to declare movement`);
  } else {
    actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  }
  return actions;
}

/**
 * Emit `return-attached-to-hand` actions for cards attached to the active
 * player's characters that carry a `return-to-hand` effect whose triggers
 * include `organization` — "You may return this to your hand during your
 * organization phase".
 *
 * Covers both attachment zones: `allies` (Radagast's Black Bird wh-114) and
 * `items`, which is also where a permanent-event placed on a character lives
 * (the Radagast Shapeshifter forms wh-112/115/116). One action per matching
 * attachment.
 */
export function returnAttachedToHandActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const actions: EvaluatedAction[] = [];
  for (const char of Object.values(player.characters)) {
    for (const attached of [...char.allies, ...char.items]) {
      const def = defById(state, attached.definitionId);
      const canReturn = getCardEffects(def).some(
        e => e.type === 'return-to-hand' && e.during.includes('organization'),
      );
      if (!canReturn) continue;
      logDetail(`Return-to-hand available: ${def?.name ?? (attached.definitionId as string)} may return to hand`);
      actions.push({
        action: { type: 'return-attached-to-hand', player: playerId, cardInstanceId: attached.instanceId },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Emit `test-ring-at-site` activations for the `sage-tap-ring-test` site-rule
 * (e.g. Mount Doom, le-393: "Any sage may tap to test a ring at this site,
 * modifying the result by -3.").
 *
 * For each of the player's companies whose current site declares the rule,
 * collect the gold-ring items borne by characters in that company and offer
 * one activation per (untapped sage, gold-ring) pair. The sage need not bear
 * the ring — like Gandalf, any sage may test a ring borne anywhere in the
 * company. Tapping the sage is the cost; the test itself (roll, discard,
 * special-ring offer) reuses the shared `gold-ring-test` resolution.
 */
export function siteSageRingTestActivations(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
    if (!siteDefId) continue;
    const siteDef = defById(state, siteDefId);
    if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) continue;
    const rule = siteDef.effects.find(
      e => e.type === 'site-rule' && (e as { rule?: string }).rule === 'sage-tap-ring-test',
    );
    if (!rule) continue;

    // Gold-ring items borne by any character in this company.
    const ringInstanceIds: CardInstanceId[] = [];
    for (const charInstId of company.characters) {
      const char = player.characters[charInstId];
      if (!char) continue;
      for (const item of char.items) {
        const itemDef = defById(state, item.definitionId);
        if (itemDef && 'subtype' in itemDef && (itemDef as { subtype?: string }).subtype === 'gold-ring') {
          ringInstanceIds.push(item.instanceId);
        }
      }
    }
    if (ringInstanceIds.length === 0) {
      logDetail(`sage-tap-ring-test at ${siteDef.name}: no gold-ring items borne in company ${company.id as string}`);
      continue;
    }

    // One activation per untapped sage × gold-ring.
    for (const charInstId of company.characters) {
      const sage = player.characters[charInstId];
      if (!sage || sage.status !== CardStatus.Untapped) continue;
      const sageDef = defById(state, sage.definitionId);
      if (!sageDef || !isCharacterCard(sageDef)) continue;
      const skills = getEffectiveSkills(state, sage, sageDef as { skills?: readonly string[] });
      if (!skills.includes('sage')) continue;
      for (const ringInstanceId of ringInstanceIds) {
        logDetail(`sage-tap-ring-test at ${siteDef.name}: ${sageDef.name} may tap to test a gold ring (modifier ${formatSignedNumber((rule as { rollModifier: number }).rollModifier)})`);
        actions.push({
          action: {
            type: 'test-ring-at-site',
            player: playerId,
            characterId: charInstId,
            targetCardId: ringInstanceId,
          },
          viable: true,
        });
      }
    }
  }
  return actions;
}

/**
 * Emit `reanimate-from-discard` activations for the
 * `ringwraith-reanimate-from-discard` site-rule (Urlurtsu Nurn le-409): "If
 * your Ringwraith is at this site, he may tap during the organization phase to
 * bring one Orc or Troll character from your discard pile into play at this
 * site (as another company)."
 *
 * For each company at a site carrying the rule, the player's own Ringwraith
 * (an untapped avatar of race `ringwraith`) present in that company may tap to
 * bring one matching character from the discard pile into play. One activation
 * is emitted per (Ringwraith, eligible discard-pile character) pair. Unique
 * characters already in play, and manifestations of an in-play entity, are
 * skipped (they cannot legally be brought into play).
 */
export function siteRingwraithReanimateActivations(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
    if (!siteDefId) continue;
    const siteDef = defById(state, siteDefId);
    if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) continue;
    const rule = siteDef.effects.find(
      e => e.type === 'site-rule' && (e as { rule?: string }).rule === 'ringwraith-reanimate-from-discard',
    ) as { filter: Condition } | undefined;
    if (!rule) continue;

    // The Ringwraith (untapped avatar of race `ringwraith`) must be at this site.
    let ringwraithId: CardInstanceId | null = null;
    for (const charId of company.characters) {
      const char = player.characters[charId];
      if (!char || char.status !== CardStatus.Untapped) continue;
      const charDef = defById(state, char.definitionId);
      if (!isCharacterCard(charDef) || !isAvatarCharacter(charDef)) continue;
      if ((charDef as { race?: Race }).race !== Race.Ringwraith) continue;
      ringwraithId = charId;
      break;
    }
    if (!ringwraithId) {
      logDetail(`${siteDef.name}: reanimate-from-discard requires an untapped Ringwraith at the site — none present`);
      continue;
    }

    // Enumerate eligible characters in the discard pile.
    for (const card of player.discardPile) {
      const cardDef = defById(state, card.definitionId);
      if (!cardDef || !isCharacterCard(cardDef)) continue;
      if (!matchesDefinition(cardDef, rule.filter)) continue;
      if (cardDef.unique && isUniqueCharacterInPlay(state, cardDef.name)) {
        logDetail(`${siteDef.name}: ${cardDef.name} is unique and already in play — cannot reanimate`);
        continue;
      }
      const blockingManifestation = manifestationOfEntityInPlay(state, cardDef);
      if (blockingManifestation !== null) {
        logDetail(`${siteDef.name}: ${blockingManifestation} (a manifestation of ${cardDef.name}) is in play — cannot reanimate`);
        continue;
      }
      logDetail(`${siteDef.name}: Ringwraith may tap to reanimate ${cardDef.name} from the discard pile as a new company`);
      actions.push({
        action: {
          type: 'reanimate-from-discard',
          player: playerId,
          ringwraithInstanceId: ringwraithId,
          characterInstanceId: card.instanceId,
          siteInstanceId: company.currentSite.instanceId,
        },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Scans all characters owned by the player for `grant-action` effects
 * on their attached hazards, items, allies, and the character card itself.
 * Returns activate actions for each available granted ability whose
 * cost can be paid.
 *
 * Currently supports:
 * - `remove-self-on-roll` — character taps, rolls 2d6, on success the
 *   source card is discarded (e.g. Foolish Words).
 * - `test-gold-ring` — character taps to test a gold ring item in their
 *   company; rolls 2d6, gold ring is discarded (e.g. Gandalf).
 * - `gwaihir-special-movement` — discard the ally to grant the company
 *   special movement to any non-Shadow-land/Dark-domain/Under-deeps site.
 *   Requires company size ≤ 2.
 * - `untap-bearer` — discard an item to untap its bearer. Bearer must be
 *   tapped.
 * - `extra-region-movement` — discard an item during organization to grant
 *   the bearer's company +1 max region distance for movement this turn.
 */
export function grantedActionActivations(state: GameState, playerId: PlayerId, phaseFilter?: GrantActionPhaseFilter): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];

  for (const [charId, char] of characterEntries(player)) {
    // Collect grant-action effects from hazards attached to this character
    for (const hazard of char.hazards) {
      const grantActions = extractGrantActions(state, hazard.definitionId);
      for (const effect of grantActions) {
        if (phaseFilter && !matchesPhaseFilter(effect, phaseFilter)) continue;
        if (effect.oncePerTurn && grantActionUsedThisTurn(state, hazard.instanceId, effect.action)) continue;
        const hazardDef = defById(state, hazard.definitionId);
        // Rule 10.08: only cards that carry the 'corruption' game keyword
        // (or have cardType 'hazard-corruption') qualify for the no-tap −3
        // removal variant. Foolish Words, Rebel-talk etc. use the same
        // remove-self-on-roll mechanic but are not Corruption cards.
        const hazardKeywords = hazardDef && 'keywords' in hazardDef
          ? (hazardDef as { keywords?: readonly string[] }).keywords
          : undefined;
        const isCorruptionRemoval = effect.action === 'remove-self-on-roll'
          && (hazardDef?.cardType === 'hazard-corruption'
              || hazardKeywords?.includes('corruption') === true);
        // METD §7 / rule 10.08: once a no-tap removal attempt has been
        // made on this character+corruption-card pair, no further
        // attempts (tap or no-tap) are allowed for the rest of the turn.
        const removalLocked = isCorruptionRemoval && state.activeConstraints.some(c =>
          c.kind.type === 'corruption-removal-locked'
          && c.kind.characterId === charId
          && c.kind.corruptionInstanceId === hazard.instanceId,
        );
        if (removalLocked) {
          const charDef = defById(state, char.definitionId);
          logDetail(`Grant-action ${effect.action} on ${hazardDef?.name ?? '?'}: ${charDef?.name ?? '?'} corruption-removal locked this turn`);
          continue;
        }
        // Rule 7.3: the no-tap -3 variant "cannot be taken if an attempt
        // to remove the same corruption card has already been made this
        // turn" — a prior tap-and-roll attempt withholds the no-tap
        // variant, though further tap-and-roll attempts remain legal
        // (rule 7.3.1) if the character is untapped again.
        const tapAttemptMade = isCorruptionRemoval && state.activeConstraints.some(c =>
          c.kind.type === 'corruption-removal-attempted'
          && c.kind.characterId === charId
          && c.kind.corruptionInstanceId === hazard.instanceId,
        );

        // `sage-in-company` cost: a different character — an untapped
        // sage in the bearer's company — pays the tap, not the bearer.
        // One action per eligible sage (e.g. Dragon's Curse: "a sage in
        // the target character's company may tap to attempt to remove
        // this card"). `sage-in-company-excluding-bearer` is the same but
        // additionally excludes the bearer itself (Pale Dream-maker dm-78:
        // "a sage in target character's company (other than character)").
        // Handled here and we skip the later tap=bearer branches for this
        // effect.
        if (effect.cost.tap === 'sage-in-company' || effect.cost.tap === 'sage-in-company-excluding-bearer') {
          const excludeBearer = effect.cost.tap === 'sage-in-company-excluding-bearer';
          const bearerCompany = findCharacterCompany(player.companies, charId);
          if (!bearerCompany) {
            logDetail(`Grant-action ${effect.action} on ${hazardDef?.name ?? '?'}: bearer has no company`);
            continue;
          }
          let emitted = 0;
          for (const companionId of bearerCompany.characters) {
            if (excludeBearer && companionId === charId) continue;
            const companion = player.characters[companionId];
            if (!companion) continue;
            if (companion.status !== CardStatus.Untapped) continue;
            const companionDef = defById(state, companion.definitionId);
            if (!companionDef || !isCharacterCard(companionDef)) continue;
            if (!getEffectiveSkills(state, companion, companionDef as { skills?: readonly string[] }).includes('sage')) continue;
            logDetail(`Grant-action ${effect.action} available: ${companionDef.name} (sage) can tap to activate (source: ${hazardDef?.name ?? '?'})`);
            actions.push(grantedActionFor(playerId, companionId, hazard, effect));
            emitted++;
          }
          if (emitted === 0) {
            logDetail(`Grant-action ${effect.action} on ${hazardDef?.name ?? '?'}: no eligible untapped sage in bearer's company`);
          }
          continue;
        }

        // Evaluate the grant-action's `when` gate (if any) against the
        // bearer / company / site context. A failed gate suppresses the
        // standard tap-and-roll variant, but the corruption no-tap variant
        // below is offered regardless (removal is always available at -3).
        // Used by Diminish and Depart (ba-17): the removal is offered only
        // while the target character is at a Haven (`bearer.atHaven`).
        let whenSatisfied = true;
        if (effect.when) {
          const charDefForCtx = defById(state, char.definitionId);
          const charDefCard = charDefForCtx && isCharacterCard(charDefForCtx) ? charDefForCtx : undefined;
          const company = findCharacterCompany(player.companies, charId);
          const ctx = buildGrantActionContext(state, char, charDefCard, company, player, hazard.instanceId);
          whenSatisfied = matchesCondition(effect.when, ctx);
          if (!whenSatisfied) {
            logDetail(`Grant-action ${effect.action}: when condition failed on ${charDefCard?.name ?? '?'}`);
          }
        }

        // Check cost: if tap is "bearer", character must be untapped
        if (!canPayCost(effect.cost, char)) {
          const charDef = defById(state, char.definitionId);
          logDetail(`Grant-action ${effect.action} on ${hazardDef?.name ?? '?'}: ${charDef?.name ?? '?'} is tapped, cannot activate`);
          // Fall through to consider the no-tap variant below — the
          // character being tapped doesn't block it.
        }

        // Standard tap-and-roll variant — emitted only if the bearer
        // is untapped (cost.tap=bearer satisfied) and the when gate holds.
        if (canPayCost(effect.cost, char) && whenSatisfied) {
          const charDef = defById(state, char.definitionId);
          logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can tap to activate (source: ${hazardDef?.name ?? '?'})`);
          actions.push(grantedActionFor(playerId, charId, hazard, effect));
        }

        // METD §7 / rule 10.08: also offer the no-tap variant for
        // corruption-removal grant actions. Available regardless of
        // bearer's tap state; first use locks subsequent attempts. Rule
        // 7.3 withholds it once a tap-and-roll attempt has already been
        // made on this character+corruption-card pair this turn.
        if (isCorruptionRemoval && tapAttemptMade) {
          const charDef = defById(state, char.definitionId);
          logDetail(`Grant-action ${effect.action}-no-tap on ${hazardDef?.name ?? '?'}: ${charDef?.name ?? '?'} already attempted removal this turn — no-tap variant withheld`);
        } else if (isCorruptionRemoval) {
          const charDef = defById(state, char.definitionId);
          logDetail(`Grant-action ${effect.action}-no-tap available: ${charDef?.name ?? '?'} may roll without tapping at -3 (source: ${hazardDef?.name ?? '?'})`);
          actions.push(grantedActionFor(playerId, charId, hazard, effect, { noTap: true }));
        }
      }
    }

    // Collect grant-action effects from the character card itself
    const charDef = defById(state, char.definitionId);
    if (charDef && 'effects' in charDef) {
      const charEffects = (charDef as { effects?: readonly import('../../types/effects.js').CardEffect[] }).effects;
      if (charEffects) {
        for (const effect of charEffects) {
          if (effect.type !== 'grant-action') continue;
          // End-of-turn-only abilities (Saruman tw-181/wh-9's discard-pile
          // spell fetch, Great Shadow ba-62) are emitted only by the
          // dedicated end-of-turn discard-pile fetch scanner
          // (`legal-actions/end-of-turn.ts`) — keep them out of this
          // organization-phase default scan, mirroring `extractGrantActions`
          // below (used for ally/item/hazard-borne grant-actions).
          if (effect.endOfTurnOnly === true) continue;
          if (phaseFilter && !matchesPhaseFilter(effect, phaseFilter)) continue;
          if (effect.oncePerTurn && grantActionUsedThisTurn(state, char.instanceId, effect.action)) continue;

          // Check cost: if tap is "self", the character must be untapped
          if (!canPayCost(effect.cost, char)) {
            logDetail(`Grant-action ${effect.action} on ${charDef.name}: character is tapped, cannot activate`);
            continue;
          }

          // Evaluate the `when` condition against the grant-action context.
          if (effect.when) {
            const charDefCard = isCharacterCard(charDef) ? charDef : undefined;
            const company = findCharacterCompany(player.companies, charId);
            const ctx = buildGrantActionContext(state, char, charDefCard, company, player, char.instanceId);
            if (!matchesCondition(effect.when, ctx)) {
              logDetail(`Grant-action ${effect.action} on ${charDef.name}: when condition failed`);
              continue;
            }
          }

          // untap-companion-at-site: enumerate tapped companions in the bearer's
          // company whose definition ID appears in the effect's `companionIds` list.
          // Only use this legacy path when `effect.targets` is absent (older data format).
          if (effect.action === 'untap-companion-at-site' && !effect.targets) {
            const companionIds = (effect as { companionIds?: readonly string[] }).companionIds ?? [];
            const company = findCharacterCompany(player.companies, charId);
            if (!company) {
              logDetail(`Grant-action ${effect.action} on ${charDef.name}: bearer has no company`);
              continue;
            }
            let emitted = 0;
            for (const compId of company.characters) {
              if (compId === charId) continue;
              const companion = player.characters[compId];
              if (!companion || companion.status !== CardStatus.Tapped) continue;
              const compDef = defById(state, companion.definitionId);
              if (!compDef || !isCharacterCard(compDef)) continue;
              if (!companionIds.includes(compDef.id as string)) continue;
              logDetail(`Grant-action ${effect.action} available: ${charDef.name} can tap to untap ${compDef.name}`);
              actions.push(grantedActionFor(playerId, charId, char, effect, { targetCardId: companion.instanceId }));
              emitted++;
            }
            if (emitted === 0) {
              logDetail(`Grant-action ${effect.action} on ${charDef.name}: no tapped companions in company`);
            }
            continue;
          }

          // Per-target enumeration: emit one activation per candidate in
          // the declared scope (e.g. Gandalf's gold-ring test).
          if (effect.targets) {
            // Player-companies scope: enumerate all companies and emit one activation per company.
            if (effect.targets.scope === 'player-companies') {
              const companies = grantActionTargetCompanies(state, player, effect.targets);
              if (companies.length === 0) {
                logDetail(`Grant-action ${effect.action} on ${charDef.name}: no eligible target companies`);
                continue;
              }
              for (const company of companies) {
                logDetail(`Grant-action ${effect.action} available: ${charDef.name} can activate targeting company ${company.id as string}`);
                actions.push(grantedActionFor(playerId, charId, char, effect, { targetCompanyId: company.id }));
              }
              continue;
            }

            const candidates = enumerateGrantActionTargets(state, player, charId, effect.targets);
            if (candidates.length === 0) {
              logDetail(`Grant-action ${effect.action} on ${charDef.name}: no targets in scope '${effect.targets.scope}'`);
              continue;
            }
            for (const target of candidates) {
              const targetDef = defById(state, target.definitionId);
              logDetail(`Grant-action ${effect.action} available: ${charDef.name} can tap to target ${targetDef?.name ?? '?'}`);
              actions.push(grantedActionFor(playerId, charId, char, effect, { targetCardId: target.instanceId }));
            }
            continue;
          }

          // Generic character grant-action (future use)
          logDetail(`Grant-action ${effect.action} available: ${charDef.name} can activate`);
          actions.push(grantedActionFor(playerId, charId, char, effect));
        }
      }
    }

    // Scan allies attached to this character for grant-action effects
    for (const ally of char.allies) {
      const grantActions = extractGrantActions(state, ally.definitionId);
      for (const effect of grantActions) {
        if (phaseFilter && !matchesPhaseFilter(effect, phaseFilter)) continue;
        if (effect.oncePerTurn && grantActionUsedThisTurn(state, ally.instanceId, effect.action)) continue;
        // A `tap: self` cost (e.g. Mistress Lobelia dm-178) requires the ally
        // itself to be untapped; `discard: self` and cost-free abilities are
        // always payable (canPayCost returns true when there is no tap cost).
        if (!canPayCost(effect.cost, char, ally)) {
          const def = defById(state, ally.definitionId);
          logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: cost not payable (ally tapped)`);
          continue;
        }
        const charDefForCtx = defById(state, char.definitionId);
        const charDefCard = charDefForCtx && isCharacterCard(charDefForCtx) ? charDefForCtx : undefined;
        const company = findCharacterCompany(player.companies, charId);
        if (effect.when) {
          const ctx = buildGrantActionContext(state, char, charDefCard, company, player, ally.instanceId);
          if (!matchesCondition(effect.when, ctx)) {
            const def = defById(state, ally.definitionId);
            logDetail(`Grant-action ${effect.action}: when condition failed on ${charDefCard?.name ?? '?'} (source ${def?.name ?? '?'})`);
            continue;
          }
        }

        const charDef = defById(state, char.definitionId);
        const def = defById(state, ally.definitionId);

        // `targets: { scope: "own-hand-factions" }` — Roäc the Raven (tw-320):
        // one activation per faction card of the player's own alignment
        // sitting in hand, offered only while the bearer's company is the
        // one currently taking its site phase ("during the site phase …
        // his company").
        if (effect.targets?.scope === 'own-hand-factions') {
          const isActiveSiteCompany = state.phaseState.phase === Phase.Site
            && !!company
            && player.companies[state.phaseState.activeCompanyIndex]?.id === company.id;
          if (!isActiveSiteCompany) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer's company is not the active site-phase company`);
            continue;
          }
          const handFactions = player.hand.filter(c => {
            const cardDef = defById(state, c.definitionId);
            return !!cardDef && isFactionCard(cardDef)
              && (!effect.targets!.filter || matchesDefinition(cardDef, effect.targets!.filter));
          });
          if (handFactions.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no faction card in hand`);
            continue;
          }
          for (const faction of handFactions) {
            const factionDef = defById(state, faction.definitionId);
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can discard ${def?.name ?? '?'} to attempt influencing ${factionDef?.name ?? '?'}`);
            actions.push(grantedActionFor(playerId, charId, ally, effect, { targetCardId: faction.instanceId }));
          }
          continue;
        }

        logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can discard ${def?.name ?? '?'} to activate`);

        actions.push(grantedActionFor(playerId, charId, ally, effect));
      }
    }

    // Scan items attached to this character for grant-action effects
    for (const item of char.items) {
      const grantActions = extractGrantActions(state, item.definitionId);
      for (const effect of grantActions) {
        if (phaseFilter && !matchesPhaseFilter(effect, phaseFilter)) continue;
        if (effect.oncePerTurn && grantActionUsedThisTurn(state, item.instanceId, effect.action)) continue;
        if (!canPayCost(effect.cost, char, item)) {
          const def = defById(state, item.definitionId);
          logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: cost not payable (item or bearer tapped)`);
          continue;
        }

        const charDefForCtx = defById(state, char.definitionId);
        const charDefCard = charDefForCtx && isCharacterCard(charDefForCtx) ? charDefForCtx : undefined;
        const company = findCharacterCompany(player.companies, charId);
        if (effect.when) {
          const ctx = buildGrantActionContext(state, char, charDefCard, company, player, item.instanceId);
          if (!matchesCondition(effect.when, ctx)) {
            const def = defById(state, item.definitionId);
            logDetail(`Grant-action ${effect.action}: when condition failed on ${charDefCard?.name ?? '?'} (source ${def?.name ?? '?'})`);
            continue;
          }
        }

        const def = defById(state, item.definitionId);
        const costLabel = effect.cost.tap === 'self' ? 'tap' : 'discard';

        // `place-item-on-character` (The Forge-master wh-117): tap the bearer to
        // place a qualifying minor item — fetched from the player's discard pile,
        // sideboard, or hand — onto any of the player's characters at the bearer's
        // site (the recipient is not tapped). Emit one activation per (item,
        // recipient) pair so the player picks both via the chosen action.
        if (effect.apply?.type === 'place-item-on-character') {
          if (!company?.currentSite) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not at a site`);
            continue;
          }
          const siteDefId = company.currentSite.definitionId as string;
          const zones = effect.apply.fetchFrom ?? ['discard-pile', 'sideboard', 'hand'];
          const zoneItemIds = fetchZoneItemInstanceIds(state, player, zones, effect.apply.filter);
          if (zoneItemIds.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no qualifying item in discard/sideboard/hand`);
            continue;
          }
          const recipients: CardInstanceId[] = [];
          for (const co of player.companies) {
            if (!co.currentSite || (co.currentSite.definitionId as string) !== siteDefId) continue;
            for (const memberId of co.characters) recipients.push(memberId);
          }
          for (const itemInstId of zoneItemIds) {
            for (const recipientId of recipients) {
              actions.push(grantedActionFor(
                playerId,
                charId,
                item,
                effect,
                { targetCardId: itemInstId, recipientCharacterId: recipientId },
              ));
            }
          }
          logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: offered ${zoneItemIds.length} item(s) × ${recipients.length} recipient(s) at site`);
          continue;
        }

        // `heal-company-character` targets a wounded character in the bearer's
        // company — emit one action per wounded (inverted) candidate, carrying
        // the chosen target on `targetCardId`. If no one is wounded, the
        // ability is not offered. Used by Foul-smelling Paste (le-310).
        if (effect.action === 'heal-company-character') {
          if (!company) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not in any company`);
            continue;
          }
          const wounded: import('../../index.js').CharacterInPlay[] = [];
          for (const compCharId of company.characters) {
            const compChar = player.characters[compCharId];
            if (compChar && compChar.status === CardStatus.Inverted) wounded.push(compChar);
          }
          if (wounded.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no wounded character in ${charDef?.name ?? '?'}'s company`);
            continue;
          }
          for (const target of wounded) {
            const targetDef = defById(state, target.definitionId);
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to heal ${targetDef?.name ?? '?'}`);
            actions.push(grantedActionFor(playerId, charId, item, effect, { targetCardId: target.instanceId }));
          }
          continue;
        }

        // `untap-company-character` targets a tapped, non-wounded character in
        // the bearer's company — emit one action per tapped (and therefore, by
        // definition, not-Inverted/not-wounded) candidate, carrying the chosen
        // target on `targetCardId`. If no one is tapped, the ability is not
        // offered. Used by Healing Herbs (tw-255): "untap a character in his
        // company that is not wounded."
        if (effect.action === 'untap-company-character') {
          if (!company) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not in any company`);
            continue;
          }
          const tapped: import('../../index.js').CharacterInPlay[] = [];
          for (const compCharId of company.characters) {
            const compChar = player.characters[compCharId];
            if (compChar && compChar.status === CardStatus.Tapped) tapped.push(compChar);
          }
          if (tapped.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no tapped, non-wounded character in ${charDef?.name ?? '?'}'s company`);
            continue;
          }
          for (const target of tapped) {
            const targetDef = defById(state, target.definitionId);
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to untap ${targetDef?.name ?? '?'}`);
            actions.push(grantedActionFor(playerId, charId, item, effect, { targetCardId: target.instanceId }));
          }
          continue;
        }

        // `force-discard-dwarf-at-site` targets each Dwarf character at the
        // bearer's current site (any company, any player). Emit one action per
        // Dwarf. If there are no Dwarves at the same site, the ability is not
        // offered. Used by The Arkenstone (le-418).
        if (effect.action === 'force-discard-dwarf-at-site') {
          if (!company) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not in any company`);
            continue;
          }
          const siteDef = company.currentSite
            ? defById(state, company.currentSite.definitionId)
            : undefined;
          const siteName = siteDef?.name ?? '';
          if (!siteName) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer has no current site`);
            continue;
          }
          const dwarfTargets: { instanceId: import('../../index.js').CardInstanceId; name: string }[] = [];
          for (const p of state.players) {
            for (const co of p.companies) {
              const coSiteDef = co.currentSite
                ? defById(state, co.currentSite.definitionId)
                : undefined;
              const coSiteName = coSiteDef?.name ?? '';
              if (coSiteName !== siteName) continue;
              for (const coCharId of co.characters) {
                const coChar = p.characters[coCharId];
                if (!coChar) continue;
                const coCharDef = defById(state, coChar.definitionId);
                if (!coCharDef || !isCharacterCard(coCharDef)) continue;
                if (coCharDef.race !== Race.Dwarf) continue;
                dwarfTargets.push({ instanceId: coCharId, name: coCharDef.name });
              }
            }
          }
          if (dwarfTargets.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no Dwarf at site ${siteName}`);
            continue;
          }
          for (const { instanceId: targetId, name: targetName } of dwarfTargets) {
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to discard ${targetName}`);
            actions.push(grantedActionFor(playerId, charId, item, effect, { targetCardId: targetId }));
          }
          continue;
        }

        // `auto-pass-corruption-check` (Ancient Black Axe as-122): tap this
        // item to grant a character at the bearer's current site (any
        // company, any player, excluding the bearer) an auto-pass shield on
        // its next corruption check. Emit one action per other character at
        // the site. If nobody else is at the site, the ability is not
        // offered.
        if (effect.action === 'auto-pass-corruption-check') {
          if (!company?.currentSite) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not at a site`);
            continue;
          }
          // Match "the same site" by NAME, not definition id: each location
          // exists as alignment-specific site cards (hero Moria tw-413 vs
          // minion Moria le-392), so an opponent's company at the same
          // location carries a different definition id. Same convention as
          // force-discard-dwarf-at-site above and eligibleMaladyTargets.
          const axeSiteName = defById(state, company.currentSite.definitionId)?.name ?? '';
          if (!axeSiteName) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer's site definition unresolvable`);
            continue;
          }
          const siteTargets: { instanceId: import('../../index.js').CardInstanceId; name: string }[] = [];
          for (const p of state.players) {
            for (const co of p.companies) {
              if (!co.currentSite) continue;
              const coSiteName = defById(state, co.currentSite.definitionId)?.name ?? '';
              if (coSiteName !== axeSiteName) continue;
              for (const memberId of co.characters) {
                if (memberId === charId) continue;
                const member = p.characters[memberId];
                if (!member) continue;
                const memberDef = defById(state, member.definitionId);
                siteTargets.push({ instanceId: memberId, name: memberDef?.name ?? (memberId as string) });
              }
            }
          }
          if (siteTargets.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no other character at the bearer's site`);
            continue;
          }
          for (const { instanceId: targetId, name: targetName } of siteTargets) {
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to make ${targetName} automatically pass a corruption check`);
            actions.push(grantedActionFor(playerId, charId, item, effect, { targetCardId: targetId }));
          }
          continue;
        }

        // `boost-company-influence` (When You Know More dm-163): tap the bearer
        // (a sage carrying the enchantment) to grant +2 to one influence attempt
        // by another untapped character in his company; the bearer then makes a
        // corruption check. Emit one activation per eligible company-mate, carried
        // on `targetCardId`. The bearer is excluded — paying the tap cost leaves
        // it unable to make the boosted attempt — and tapped company-mates cannot
        // make an influence attempt, so they are skipped too.
        if (effect.action === 'boost-company-influence') {
          if (!company) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not in any company`);
            continue;
          }
          const boostTargets: { instanceId: import('../../index.js').CardInstanceId; name: string }[] = [];
          for (const compCharId of company.characters) {
            if (compCharId === charId) continue;
            const compChar = player.characters[compCharId];
            if (!compChar || compChar.status !== CardStatus.Untapped) continue;
            const compCharDef = defById(state, compChar.definitionId);
            boostTargets.push({ instanceId: compCharId, name: compCharDef?.name ?? (compCharId as string) });
          }
          if (boostTargets.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no other untapped character in ${charDef?.name ?? '?'}'s company to boost`);
            continue;
          }
          for (const { instanceId: targetId, name: targetName } of boostTargets) {
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can tap ${def?.name ?? '?'} to give ${targetName} +2 to an influence attempt`);
            actions.push(grantedActionFor(playerId, charId, item, effect, { targetCardId: targetId }));
          }
          continue;
        }

        // `discard-boost-influence` (Dark Numbers dm-123): discard the bearer
        // (a permanent event attached to a scout) to give +3 to an influence
        // attempt against a faction by a character in the bearer's company.
        // Unlike `boost-company-influence`, the cost is discarding the source
        // card rather than tapping the bearer, so the bearer itself remains a
        // legal (untapped) target — the card text does not exclude it. Emit one
        // activation per untapped company member, carried on `targetCardId`.
        if (effect.action === 'discard-boost-influence') {
          if (!company) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer not in any company`);
            continue;
          }
          const boostTargets: { instanceId: import('../../index.js').CardInstanceId; name: string }[] = [];
          for (const compCharId of company.characters) {
            const compChar = player.characters[compCharId];
            if (!compChar || compChar.status !== CardStatus.Untapped) continue;
            const compCharDef = defById(state, compChar.definitionId);
            boostTargets.push({ instanceId: compCharId, name: compCharDef?.name ?? (compCharId as string) });
          }
          if (boostTargets.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no untapped character in ${charDef?.name ?? '?'}'s company to boost`);
            continue;
          }
          for (const { instanceId: targetId, name: targetName } of boostTargets) {
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can discard ${def?.name ?? '?'} to give ${targetName} +3 to an influence attempt`);
            actions.push(grantedActionFor(playerId, charId, item, effect, { targetCardId: targetId }));
          }
          continue;
        }

        // `restore-item` (Reforging family of hoard items — Horn of Defiance
        // td-183, Ringil td-184, Belegennon td-185): "A stored Reforging may
        // be placed with this item to 'restore' it." Emit one activation per
        // stored card in the bearer's own kill pile matching
        // `cost.discardCardName` ("Reforging"). Once restored, the item's own
        // `restore-item` ability is withdrawn — restoring is a one-way,
        // permanent flag, not a repeatable action.
        if (effect.action === 'restore-item') {
          if (item.restored) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: already restored`);
            continue;
          }
          const discardCandidates = player.killPile.filter(c =>
            c.storedAtSite && defById(state, c.definitionId)?.name === effect.cost.discardCardName);
          if (discardCandidates.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no stored ${effect.cost.discardCardName ?? '?'} to discard`);
            continue;
          }
          for (const candidate of discardCandidates) {
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can discard stored ${effect.cost.discardCardName ?? '?'} to restore ${def?.name ?? '?'}`);
            actions.push(grantedActionFor(playerId, charId, item, effect, { targetCardId: candidate.instanceId }));
          }
          continue;
        }

        // Per-company enumeration for an item-borne grant: one activation per
        // eligible company, carrying it on `targetCompanyId` (Shifter of Hues
        // wh-115, a permanent-event attached to Radagast — such cards live in
        // `char.items` and so come through this loop rather than the
        // character-definition one above).
        if (effect.targets?.scope === 'player-companies') {
          const companies = grantActionTargetCompanies(state, player, effect.targets);
          if (companies.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no eligible target companies`);
            continue;
          }
          for (const targetCompany of companies) {
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} targeting company ${targetCompany.id as string}`);
            actions.push(grantedActionFor(playerId, charId, item, effect, { targetCompanyId: targetCompany.id }));
          }
          continue;
        }

        // Per-opponent-card enumeration: one activation per card in the
        // opponent's `cardsInPlay` matching the declared filter, carried on
        // `targetCardId` (Keys to the White Towers wh-89 — "discard the
        // Fortress of the Towers card if in play by another player"). If the
        // opponent has no matching card in play, the mode is not offered.
        if (effect.targets?.scope === 'opponent-cards-in-play') {
          const opponent = state.players.find(p => p.id !== playerId);
          const inPlayTargets = (opponent?.cardsInPlay ?? []).filter(c => {
            const cDef = defById(state, c.definitionId);
            return !!cDef && (!effect.targets?.filter || matchesDefinition(cDef, effect.targets.filter));
          });
          if (inPlayTargets.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no matching card in opponent's play area`);
            continue;
          }
          for (const target of inPlayTargets) {
            const targetDef = defById(state, target.definitionId);
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to discard opponent's ${targetDef?.name ?? '?'}`);
            actions.push(grantedActionFor(playerId, charId, item, effect, { targetCardId: target.instanceId }));
          }
          continue;
        }

        // Generic per-candidate enumeration for an item-borne grant (e.g.
        // `"company-characters"` — The Arkenstone tw-341): one activation per
        // matching card in the declared scope, carried on `targetCardId`.
        // Mirrors the character-definition grant-action loop's fallback above.
        if (effect.targets) {
          const candidates = enumerateGrantActionTargets(state, player, charId, effect.targets);
          if (candidates.length === 0) {
            logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: no targets in scope '${effect.targets.scope}'`);
            continue;
          }
          for (const target of candidates) {
            const targetDef = defById(state, target.definitionId);
            logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to target ${targetDef?.name ?? '?'}`);
            actions.push(grantedActionFor(playerId, charId, item, effect, { targetCardId: target.instanceId }));
          }
          continue;
        }

        logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to activate`);

        actions.push(grantedActionFor(playerId, charId, item, effect));
      }
    }
  }

  return actions;
}

/**
 * The companies a `targets.scope: "player-companies"` grant-action may target.
 *
 * Defaults to every company the player owns (Ren the Ringwraith le-56: "any one
 * of your companies"). When `movingThroughRegionType` is set, only companies
 * that have declared movement whose declared destination's printed site path
 * crosses a region of that type qualify — Shifter of Hues (wh-115) aids a
 * company that "must be moving with at least one Wilderness [{w}] in their site
 * path". When `movingThroughRegionNames` is set, only companies whose declared
 * destination site's own named `region` is in that list qualify — Wild Horses
 * (wh-39) aids "any company with one of the regions listed above ... in its
 * site path". Movement is planned during the organization phase, so the
 * destination is already known when the ability is offered.
 */
function grantActionTargetCompanies(
  state: GameState,
  player: PlayerState,
  targets: NonNullable<GrantActionEffect['targets']>,
): readonly Company[] {
  const regionType = targets.movingThroughRegionType;
  const regionNames = targets.movingThroughRegionNames;
  if (regionType === undefined && regionNames === undefined) return player.companies;
  return player.companies.filter(co => {
    const dest = co.destinationSite;
    if (!dest) return false;
    const destDef = defById(state, dest.definitionId);
    if (!destDef || !isSiteCard(destDef)) return false;
    if (regionType !== undefined && destDef.sitePath.some(r => (r as string) === regionType)) return true;
    if (regionNames !== undefined && regionNames.includes(destDef.region)) return true;
    return false;
  });
}

/**
 * Grant-actions carried by the player's *bare* in-play cards — in-play
 * factions and unattached, uncompany-bound permanent-event resources sitting
 * in `cardsInPlay` (not attached to any character, and not stamped with a
 * `companyId`; a `play-target: "company"` resource with a bound `companyId`
 * instead rides the site-phase sibling `inPlayCompanyTapGrantActions`). There
 * is no activating character, so `characterId` self-references the source
 * instance (the reducer routes bearer-less sources to
 * `handleInPlayCardGrantAction`). Offered during the active player's
 * organization and site phases.
 *
 * Three shapes are recognized:
 *  - discard-self / add-constraint — A Panoply of Wings (wh-37): "Discard
 *    this faction to make information playable at such a site".
 *  - tap-self (or discard-self) with `targets.scope: "player-companies"` — one
 *    activation per eligible target company, carrying `targetCompanyId` — Wild
 *    Horses (wh-39): "Tap this faction to allow any company with one of the
 *    regions listed above in its site path to move up to 1 additional region."
 *  - tap-self / enqueue-pending-fetch — Earth-eater (wh-67): "Tap Earth-eater
 *    to take a minion non-unique weapon/armor/shield/helmet major item from
 *    your sideboard or discard pile to your hand."
 */
export function bareCardGrantActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const actions: EvaluatedAction[] = [];
  for (const cip of player.cardsInPlay) {
    if (cip.companyId !== undefined) continue;
    const def = defById(state, cip.definitionId);
    if (!def || !(isFactionCard(def) || isResourceEventCard(def))) continue;
    for (const effect of getCardEffects(def)) {
      if (effect.type !== 'grant-action') continue;
      const paysWithTap = effect.cost.tap === 'self';
      if (!paysWithTap && effect.cost.discard !== 'self') continue;
      if (paysWithTap && cip.status !== CardStatus.Untapped) continue;

      if (effect.targets?.scope === 'player-companies') {
        const companies = grantActionTargetCompanies(state, player, effect.targets);
        if (companies.length === 0) {
          logDetail(`In-play grant-action ${effect.action} on ${def.name}: no eligible target companies`);
          continue;
        }
        for (const targetCompany of companies) {
          logDetail(`In-play grant-action ${effect.action} available: ${paysWithTap ? 'tap' : 'discard'} ${def.name} targeting company ${targetCompany.id as string}`);
          actions.push(grantedAction(playerId, cip.instanceId, cip, effect.action, 0, { targetCompanyId: targetCompany.id }));
        }
        continue;
      }

      if (effect.apply?.type !== 'add-constraint' && effect.apply?.type !== 'enqueue-pending-fetch') continue;
      logDetail(`In-play grant-action ${effect.action} available: ${paysWithTap ? 'tap' : 'discard'} ${def.name} in play`);
      actions.push(grantedAction(playerId, cip.instanceId, cip, effect.action, 0));
    }
  }
  return actions;
}

/**
 * Grant-action effects sourced from a **stored** card — one that has left
 * `cardsInPlay` for the controller's marshalling-point pile (`killPile`, a
 * `storedAtSite` entry) — rather than one still attached to a bearer. A
 * stored card has no bearer, so it cannot be reached by the item/ally/hazard
 * attachment scans above; `getCardEffects(def)` on each `killPile` entry's
 * definition finds its `grant-action` effects directly instead.
 *
 * Only `cost.tap: "sage-at-haven"` is supported: every one of the player's
 * own untapped sage characters currently at a Haven [{H}] is a candidate
 * actor, independent of company (there is no bearer to anchor one). The
 * chosen sage's own company then supplies the recipients for a
 * `place-item-on-character` apply — mirroring the `(item, recipient)`
 * pairing the attached-item scan already does for The Forge-master
 * wh-117, but scoped to just the acting sage's own company rather than
 * every company at a site, since there is no bearer/site to search
 * site-wide from. `cost.discard: "self"` is paid by the `applyDiscardSelf`
 * `killPile` fallback in `cost-evaluator.ts`.
 *
 * Used by Reforging (tw-314): "During your organization phase, you may tap
 * a sage at a Haven [{H}] and discard a stored Reforging to retrieve any
 * minor or major weapon, armor, or shield (even a hoard item) from your
 * discard pile. The item must be placed under the control of a character in
 * the sage's company."
 */
export function storedCardGrantActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const actions: EvaluatedAction[] = [];

  for (const stored of player.killPile) {
    if (!stored.storedAtSite) continue;
    const def = defById(state, stored.definitionId);
    if (!def) continue;

    for (const effect of getCardEffects(def)) {
      if (effect.type !== 'grant-action' || !effect.fromStored) continue;
      if (effect.cost.tap !== 'sage-at-haven') continue;
      if (effect.apply?.type !== 'place-item-on-character') continue;

      for (const [charId, char] of characterEntries(player)) {
        if (char.status !== CardStatus.Untapped) continue;
        const charDef = defById(state, char.definitionId);
        if (!charDef || !isCharacterCard(charDef) || !charDef.skills.includes(Skill.Sage)) continue;

        const company = findCharacterCompany(player.companies, charId);
        const siteDef = company?.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
        if (!siteDef || !isSiteCard(siteDef) || siteDef.siteType !== 'haven') continue;

        const zones = effect.apply.fetchFrom ?? ['discard-pile'];
        const zoneItemIds = fetchZoneItemInstanceIds(state, player, zones, effect.apply.filter);
        if (zoneItemIds.length === 0) {
          logDetail(`Stored grant-action ${effect.action} on ${def.name}: no qualifying item to retrieve (via ${charDef.name})`);
          continue;
        }

        const recipients = company!.characters;
        for (const itemInstId of zoneItemIds) {
          for (const recipientId of recipients) {
            actions.push(grantedActionFor(
              playerId,
              charId,
              stored,
              effect,
              { targetCardId: itemInstId, recipientCharacterId: recipientId },
            ));
          }
        }
        logDetail(`Stored grant-action ${effect.action} on ${def.name}: offered ${zoneItemIds.length} item(s) × ${recipients.length} recipient(s) via ${charDef.name} at a Haven`);
      }
    }
  }
  return actions;
}

/**
 * `fromStored` grant-actions with a `discard: "named-stored-card"` cost and a
 * `place-source-with-item` apply — the source card itself has no bearer (it
 * sits in `killPile`) and no tap cost, unlike {@link storedCardGrantActions}'s
 * `sage-at-haven` shape. One activation is offered per (eligible discard
 * candidate × qualifying recipient) pair: the discard candidate is any other
 * of the player's own `killPile` entries (also `storedAtSite`) whose
 * definition name matches `cost.discardCardName`; the recipient is any of the
 * player's characters currently bearing an item named `apply.itemName`.
 * `characterId` self-references the source's own instance ID, mirroring the
 * bearer-less convention `grantedAction` documents — `handleGrantActionApply`
 * routes such actions to `handleStoredCardGrantAction`.
 *
 * Used by Andúril, the Flame of the West (tw-192): "Once stored, you may
 * discard a stored Reforging and place Andúril with Narsil."
 */
export function storedCombineGrantActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const actions: EvaluatedAction[] = [];

  for (const stored of player.killPile) {
    if (!stored.storedAtSite) continue;
    const def = defById(state, stored.definitionId);
    if (!def) continue;

    for (const effect of getCardEffects(def)) {
      if (effect.type !== 'grant-action' || !effect.fromStored) continue;
      if (effect.cost.tap !== undefined || effect.cost.discard !== 'named-stored-card') continue;
      if (effect.apply?.type !== 'place-source-with-item') continue;

      const discardCandidates = player.killPile.filter(c =>
        c.instanceId !== stored.instanceId
        && c.storedAtSite
        && defById(state, c.definitionId)?.name === effect.cost.discardCardName);
      if (discardCandidates.length === 0) {
        logDetail(`Stored grant-action ${effect.action} on ${def.name}: no stored ${effect.cost.discardCardName ?? '?'} to discard`);
        continue;
      }

      const itemName = effect.apply.itemName;
      const recipients: CardInstanceId[] = [];
      for (const [charId, char] of characterEntries(player)) {
        if (char.items.some(i => defById(state, i.definitionId)?.name === itemName)) recipients.push(charId);
      }
      if (recipients.length === 0) {
        logDetail(`Stored grant-action ${effect.action} on ${def.name}: no character bears ${itemName}`);
        continue;
      }

      for (const discardCandidate of discardCandidates) {
        for (const recipientId of recipients) {
          actions.push(grantedActionFor(
            playerId,
            stored.instanceId,
            stored,
            effect,
            { targetCardId: discardCandidate.instanceId, recipientCharacterId: recipientId },
          ));
        }
      }
      logDetail(`Stored grant-action ${effect.action} on ${def.name}: offered ${discardCandidates.length} discard candidate(s) × ${recipients.length} recipient(s) bearing ${itemName}`);
    }
  }
  return actions;
}

/**
 * The Lidless Eye (le-203) / Sauron (ba-43): "Once during each of your
 * organization phases, you may: bring a resource or character from your
 * sideboard into your play deck and shuffle **or** choose and discard a card
 * from your hand to look at up to 5 random cards at once from your opponent's
 * hand."
 *
 * A bare permanent-event in `cardsInPlay` grants this dual-mode ability. The two
 * modes are mutually exclusive and the whole ability may be used at most once
 * per the controller's organization phase (tracked by
 * {@link OrganizationPhaseState.sauronOrgActionUsed}, which is fresh each org
 * phase). Each candidate is surfaced as an `activate-granted-action` whose
 * `targetCardId` carries the chosen card:
 *  - `sauron-sideboard-fetch`: one action per eligible sideboard card (a minion
 *    resource or a character) — the card relocated to the play deck.
 *  - `sauron-peek-hand`: one action per hand card (the card discarded as cost),
 *    offered only when the opponent has at least one card in hand.
 *
 * There is no activating character, so `characterId` self-references the source
 * instance (the reducer routes bearer-less sources to
 * `handleInPlayCardGrantAction`).
 */
export function sauronOrgGrantActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.phaseState.phase !== Phase.Organization) return [];
  if (state.activePlayer !== playerId) return [];
  const orgState = requirePhaseState(state, Phase.Organization);
  if (orgState.sauronOrgActionUsed) {
    logDetail('Sauron org-action already used this organization phase — no actions');
    return [];
  }
  const player = playerById(state, playerId);
  if (!player) return [];
  const opponent = state.players.find(p => p.id !== playerId);

  // Minion resource card types eligible for sideboard-fetch ("a resource").
  const MINION_RESOURCE_TYPES = new Set<string>([
    'minion-resource-item', 'minion-resource-ally', 'minion-resource-faction', 'minion-resource-event',
  ]);

  const actions: EvaluatedAction[] = [];
  for (const cip of player.cardsInPlay) {
    const def = defById(state, cip.definitionId);
    if (!def || def.cardType !== 'minion-resource-event' || (def as { eventType?: string }).eventType !== 'permanent') continue;
    const effects = getCardEffects(def);
    const hasFetch = effects.some(e => e.type === 'grant-action' && e.action === 'sauron-sideboard-fetch');
    const hasPeek = effects.some(e => e.type === 'grant-action' && e.action === 'sauron-peek-hand');
    if (!hasFetch && !hasPeek) continue;

    if (hasFetch) {
      for (const sb of player.sideboard) {
        const sbDef = defById(state, sb.definitionId);
        if (!sbDef) continue;
        const eligible = MINION_RESOURCE_TYPES.has(sbDef.cardType) || isCharacterCard(sbDef);
        if (!eligible) continue;
        logDetail(`Sauron sideboard-fetch available (${def.name}): bring ${sbDef.name} (${sb.instanceId as string}) from sideboard into the play deck and shuffle`);
        actions.push(grantedAction(
          playerId,
          cip.instanceId,
          cip,
          'sauron-sideboard-fetch',
          0,
          { targetCardId: sb.instanceId },
        ));
      }
    }

    if (hasPeek) {
      const oppHandSize = opponent?.hand.length ?? 0;
      if (oppHandSize >= 1) {
        for (const hc of player.hand) {
          const hcDef = defById(state, hc.definitionId);
          logDetail(`Sauron peek-hand available (${def.name}): discard ${hcDef?.name ?? '?'} (${hc.instanceId as string}) to look at up to 5 random opponent-hand cards`);
          actions.push(grantedAction(
            playerId,
            cip.instanceId,
            cip,
            'sauron-peek-hand',
            0,
            { targetCardId: hc.instanceId },
          ));
        }
      } else {
        logDetail(`Sauron peek-hand unavailable (${def.name}): opponent has no cards in hand`);
      }
    }
  }
  return actions;
}

/**
 * Builds the DSL context used to evaluate a grant-action effect's
 * {@link EffectBase.when} condition. Exposes `bearer` (the character
 * holding the source card) and `company` (the company that character
 * belongs to, with derived booleans for planned movement and extra
 * region distance).
 *
 * New grant-action preconditions should be expressed as DSL `when`
 * clauses against this context instead of hardcoded action-ID branches
 * in {@link grantedActionActivations}.
 *
 * `sourceInstanceId` is the card whose ability is being gated (the item /
 * ally / hazard carrying the grant-action, or the character himself). It
 * only matters for abilities a *specific* card grants to its own bearer —
 * currently the `can-use-palantir` constraint, which Palantír of Elostirion
 * (le-332) places on its bearer for that one Palantír ("the bearer is able
 * to use **this** Palantír this turn if he taps").
 */
export function buildGrantActionContext(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  charDef: import('../../index.js').CharacterCard | undefined,
  company: import('../../index.js').Company | undefined,
  player?: import('../../index.js').PlayerState,
  sourceInstanceId?: import('../../index.js').CardInstanceId,
): Record<string, unknown> {
  const statusStr = cardStatusToName(char.status);

  // `self` — the status of the specific card instance carrying this
  // grant-action (an item/hazard/ally, or the bearer's own card when a
  // character-def grant-action passes its own instance id as source), for
  // abilities gated on their own source card's status rather than the
  // bearer's. Used by Map to Mithril (td-133): "If Map to Mithril ... is
  // tapped, the bearer may tap himself and place this card with a
  // non-unique weapon..." — `{ "self.status": "tapped" }`.
  let selfStatusStr: string | undefined;
  if (sourceInstanceId === char.instanceId) {
    selfStatusStr = statusStr;
  } else if (sourceInstanceId !== undefined) {
    const found = char.items.find(i => i.instanceId === sourceInstanceId)
      ?? char.hazards.find(h => h.instanceId === sourceInstanceId)
      ?? char.allies.find(a => a.instanceId === sourceInstanceId);
    if (found) selfStatusStr = cardStatusToName(found.status);
  }
  const self = selfStatusStr !== undefined ? { status: selfStatusStr } : null;

  // A turn-scoped `can-use-palantir` constraint grants the ability for the one
  // Palantír that placed it (constraint `source` === the card being gated), so
  // it never leaks to another Palantír the same character happens to bear.
  const palantirConstraint = sourceInstanceId !== undefined
    && state.activeConstraints.some(c =>
      c.kind.type === 'can-use-palantir'
      && c.target.kind === 'character'
      && c.target.characterId === char.instanceId
      && c.source === sourceInstanceId);

  const canUsePalantir = hasPlayFlag(charDef, 'can-use-palantir') ||
    palantirConstraint ||
    char.items.some(item => {
      const itemDef = defById(state, item.definitionId)!;
      return 'effects' in itemDef && hasPlayFlag(itemDef, 'can-use-palantir');
    });

  const siteDef = company?.currentSite
    ? defById(state, company.currentSite.definitionId)
    : undefined;
  const siteType = siteDef && 'siteType' in siteDef
    ? (siteDef as { siteType: string }).siteType
    : '';
  const atHaven = siteType === 'haven';
  // A **Darkhaven** is a Haven controlled by a minion side (Ringwraith:
  // Minas Morgul / Dol Guldur / Carn Dûm / Geann a-Lisch; Balrog: Moria /
  // The Under-gates). Every minion Haven site carries a minion alignment
  // (`ringwraith` / `balrog`), so a Darkhaven is a `haven` site whose
  // alignment is a minion alignment — distinct from the METW hero Havens
  // (Rivendell etc.) a Ringwraith could only reach with a mode card. Used
  // by "if at a Darkhaven" gates (e.g. Ren the Ringwraith le-56).
  const siteAlignment = siteDef && 'alignment' in siteDef
    ? (siteDef as { alignment?: string }).alignment
    : undefined;
  const atDarkhaven = atHaven
    && (siteAlignment === 'ringwraith' || siteAlignment === 'balrog');

  // `As your Ringwraith` gating: true only when this character is the player's
  // own revealed avatar (a Ringwraith follower controlled by another avatar is
  // an avatar card but is NOT the player's Ringwraith — see findPlayerAvatar).
  const isRevealedAvatar = player
    ? findPlayerAvatar(state, player)?.instanceId === char.instanceId
    : false;

  const bearer = {
    status: statusStr,
    name: charDef?.name ?? '',
    race: charDef?.race,
    skills: charDef?.skills ?? [],
    canUsePalantir: !!canUsePalantir,
    siteType,
    atHaven,
    atDarkhaven,
    isRevealedAvatar,
  };

  const companyCtx = company ? {
    size: companyEffectiveSize(state, company),
    hasPlannedMovement: company.destinationSite !== null || !!company.specialMovement,
    hasExtraRegionDistance: !!company.extraRegionDistance,
  } : null;
  const playerCtx = player ? {
    playDeckSize: player.playDeck.length,
    // Names of every card the player has in play, including character-borne
    // items — lets a grant-action `when` clause gate on a specific *other*
    // named card being in play, e.g. "tap to use the abilities of ...
    // Palantír of Annúminas ... if ... in play" (Palantír of Amon Sûl tw-296).
    inPlayNames: buildPlayerItemNamesInPlay(state, player.id),
  } : null;
  const siteName = siteDef?.name ?? '';
  const siteIsTapped = company?.currentSite?.status === CardStatus.Tapped;
  const hasDragonAutoAttack = siteDef && 'automaticAttacks' in siteDef
    ? ((siteDef as { automaticAttacks?: readonly { creatureType: string }[] }).automaticAttacks ?? [])
        .some(a => normalizeCreatureRace(a.creatureType) === Race.Dragon)
    : false;
  const siteCtx = siteName ? {
    type: siteType,
    region: (siteDef as { region?: string } | undefined)?.region ?? '',
    hasOneRing: siteHasItemWithKeyword(state, siteName, 'the-one-ring'),
    isTapped: siteIsTapped,
    hasDragonAutoAttack,
    // Site-carried DSL keywords (e.g. `dwarf-hold`), for grant-actions gated
    // on a race-flavor site tag rather than the formal `siteType`. Used by
    // Map to Mithril (td-133): "If ... at a Dwarf-hold ..." —
    // `{ "site.keywords": { "$includes": "dwarf-hold" } }`.
    keywords: (siteDef as { keywords?: readonly string[] } | undefined)?.keywords ?? [],
  } : null;
  // Current phase, exposed so a grant-action `when` clause can restrict an
  // ability to a specific phase (e.g. Strangling Coils ba-76's company untap
  // is legal only during the movement/hazard phase). Combine with
  // `anyPhase: true` so the M/H scanner offers the ability at all.
  const phase = state.phaseState.phase;
  // Whether the active player has already taken their bulk `untap` action
  // this phase — exposed only while `phase === "untap"`. Morgul-knife
  // (tw-64) / The Pale Sword (tw-97) offer a removal roll "instead of
  // untapping or healing": once the bulk untap sweep (`performUntap`) has
  // already run, the window to forgo it has passed, so their `when` clause
  // also requires `"untap.resourcePlayerUntapped": false`.
  const untap = state.phaseState.phase === Phase.Untap
    ? { resourcePlayerUntapped: state.phaseState.untapped }
    : null;
  return { bearer, self, company: companyCtx, player: playerCtx, site: siteCtx, phase, untap };
}

/**
 * Returns true when any character in any company at the same site
 * (matched by site *name* — so opposing-alignment copies of the same
 * physical location count as co-located) holds an item whose card
 * definition carries the given keyword. Used by grant-action conditions
 * to gate abilities on the presence of a specific item at the ally's
 * site (e.g. Stinker's ring-discard ability triggers when The One Ring,
 * tagged `the-one-ring`, is at the same site).
 */
function siteHasItemWithKeyword(
  state: GameState,
  siteName: string,
  keyword: string,
): boolean {
  for (const p of state.players) {
    for (const company of p.companies) {
      const compSite = company.currentSite
        ? defById(state, company.currentSite.definitionId)
        : undefined;
      const compSiteName = compSite?.name ?? '';
      if (compSiteName !== siteName) continue;
      for (const charInstId of company.characters) {
        const char = p.characters[charInstId];
        if (!char) continue;
        for (const item of char.items) {
          const def = defById(state, item.definitionId);
          if (def && 'keywords' in def && (def as { keywords?: readonly string[] }).keywords?.includes(keyword)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Returns true when an active `site-resource-unlocked` constraint owned by
 * `playerId` makes resource category `subtype` (e.g. `"information"`)
 * playable at `siteDef`. A constraint may select matching sites either by a
 * fixed site type (Records Unread as-130 mode B: "Information at any
 * Shadow-hold") or by a compound `siteCondition` evaluated against the site
 * context (A Panoply of Wings wh-37: "Information at any non-Haven,
 * non-Shadow-hold, non-Dark-hold site in a Wilderness"). Lasts for the turn.
 */
function isSiteResourceUnlocked(
  state: GameState,
  playerId: PlayerId,
  siteDef: SiteCard,
  subtype: string,
): boolean {
  const regionType = siteRegionTypeOf(state, siteDef);
  return state.activeConstraints.some(c => {
    if (c.kind.type !== 'site-resource-unlocked') return false;
    if (c.kind.subtype !== subtype) return false;
    if (c.target.kind !== 'player' || c.target.playerId !== playerId) return false;
    if (c.kind.siteType) return c.kind.siteType === siteDef.siteType;
    if (c.kind.siteCondition) {
      return matchesCondition(c.kind.siteCondition, {
        site: {
          name: siteDef.name,
          siteType: siteDef.siteType,
          regionType,
          region: siteDef.region,
        },
      });
    }
    return false;
  });
}

/**
 * Enumerates candidate target cards for a grant-action's `targets`
 * descriptor. Walks the declared scope relative to the bearer character
 * and applies the optional DSL filter to each candidate's card
 * definition.
 *
 * Returns `{ instanceId, definitionId }` pairs — one per match.
 */
function enumerateGrantActionTargets(
  state: GameState,
  player: { readonly companies: readonly import('../../index.js').Company[]; readonly characters: { readonly [key: string]: import('../../index.js').CharacterInPlay } },
  charId: CardInstanceId,
  targets: import('../../types/effects.js').GrantActionTargets,
): readonly { instanceId: CardInstanceId; definitionId: import('../../index.js').CardDefinitionId }[] {
  const matches: { instanceId: CardInstanceId; definitionId: import('../../index.js').CardDefinitionId }[] = [];

  if (targets.scope === 'company-items') {
    const company = findCharacterCompany(player.companies, charId);
    if (!company) return [];
    for (const compCharId of company.characters) {
      const compChar = player.characters[compCharId as string];
      if (!compChar) continue;
      for (const item of compChar.items) {
        const itemDef = defById(state, item.definitionId);
        if (!itemDef) continue;
        if (targets.filter && !matchesDefinition(itemDef, targets.filter)) continue;
        matches.push(toCardInstance(item));
      }
    }
  }

  if (targets.scope === 'characters-at-site') {
    // Find the bearer's current site
    const bearerCompany = findCharacterCompany(player.companies, charId);
    if (!bearerCompany?.currentSite) return [];
    const bearerSiteDefId = bearerCompany.currentSite.definitionId as string;
    const allowedDefIds = targets.definitionIds ?? [];

    // Scan all companies across both players for characters at the same site
    for (const p of state.players) {
      for (const company of p.companies) {
        if (!company.currentSite) continue;
        if ((company.currentSite.definitionId as string) !== bearerSiteDefId) continue;
        for (const memberId of company.characters) {
          // Exclude the bearer themselves
          if (memberId === charId) continue;
          const member = p.characters[memberId];
          if (!member) continue;
          // Restrict to specified definition IDs if given
          if (allowedDefIds.length > 0 && !allowedDefIds.includes(member.definitionId as string)) continue;
          // Only include tapped/inverted characters — untapping an already-untapped character is pointless
          if (member.status === CardStatus.Untapped) continue;
          if (targets.filter) {
            const memberDef = defById(state, member.definitionId);
            if (!memberDef || !matchesDefinition(memberDef, targets.filter)) continue;
          }
          matches.push({ instanceId: member.instanceId, definitionId: member.definitionId });
        }
      }
    }
  }

  if (targets.scope === 'company-characters') {
    // The Arkenstone (tw-341): "tapped to untap a Dwarf character in the same
    // company" — enumerate the bearer's own company (including the bearer),
    // skipping already-untapped members (mirrors `characters-at-site`).
    // `excludeBearer` (Waybread td-165) drops the bearer from the candidates
    // when the ability separately untaps the bearer via its own `apply`.
    const company = findCharacterCompany(player.companies, charId);
    if (!company) return [];
    for (const memberId of company.characters) {
      if (targets.excludeBearer && memberId === charId) continue;
      const member = player.characters[memberId];
      if (!member) continue;
      if (member.status === CardStatus.Untapped) continue;
      if (targets.filter) {
        const memberDef = defById(state, member.definitionId);
        if (!memberDef || !matchesDefinition(memberDef, targets.filter)) continue;
      }
      matches.push({ instanceId: member.instanceId, definitionId: member.definitionId });
    }
  }

  // Palantír of Amon Sûl (tw-296), borrowing Palantír of Elostirion's "remove
  // one corruption card from an Elf or a Wizard under your control": scan
  // every one of the player's own characters (any company, unlike
  // `company-characters`) for attached `hazard-corruption` cards. `filter` is
  // matched against the *bearer character's* definition (race), not the
  // corruption card's own — corruption cards carry little else worth
  // filtering on.
  if (targets.scope === 'own-hazard-corruption-cards') {
    for (const member of Object.values(player.characters)) {
      if (targets.filter) {
        const memberDef = defById(state, member.definitionId);
        if (!memberDef || !matchesDefinition(memberDef, targets.filter)) continue;
      }
      for (const hazard of member.hazards) {
        const hazardDef = defById(state, hazard.definitionId);
        if (!isCorruptionCardDef(hazardDef)) continue;
        matches.push({ instanceId: hazard.instanceId, definitionId: hazard.definitionId });
      }
    }
  }

  // Athelas (tw-195), Aragorn II's ability: "remove a corruption card from a
  // character in his company" — the company-scoped counterpart of
  // `own-hazard-corruption-cards`, restricted to the bearer's own company
  // rather than every character the player controls.
  if (targets.scope === 'company-hazard-corruption-cards') {
    const company = findCharacterCompany(player.companies, charId);
    if (!company) return [];
    for (const memberId of company.characters) {
      const member = player.characters[memberId];
      if (!member) continue;
      if (targets.filter) {
        const memberDef = defById(state, member.definitionId);
        if (!memberDef || !matchesDefinition(memberDef, targets.filter)) continue;
      }
      for (const hazard of member.hazards) {
        const hazardDef = defById(state, hazard.definitionId);
        if (!isCorruptionCardDef(hazardDef)) continue;
        matches.push({ instanceId: hazard.instanceId, definitionId: hazard.definitionId });
      }
    }
  }

  return matches;
}

/**
 * Extracts grant-action effects from a card definition.
 */
function extractGrantActions(state: GameState, definitionId: import('../../index.js').CardDefinitionId) {
  return getCardEffects(defById(state, definitionId)).filter(
    (e): e is import('../../types/effects.js').GrantActionEffect =>
      // Corruption-check-window abilities (When I Know Anything td-166) are
      // emitted only by `modifyCorruptionCheckGrantActions` while a check is
      // awaiting its roll — never by the generic per-phase scanner.
      // End-of-turn-only abilities (Great Shadow ba-62) are emitted only by
      // the dedicated end-of-turn discard-pile fetch scanner
      // (`legal-actions/end-of-turn.ts`) — never here, so they don't leak
      // into the organization-phase default scan below.
      // Ally chain-cancel abilities (Tom Bombadil tw-350, Leaflock tw-265) are
      // emitted only by the dedicated M/H `emitAllyCancelChainActions` emitter —
      // a chain cancellation is meaningless outside an active chain, so keep it
      // out of the generic per-phase (including organization) scan.
      // `fromStored` abilities (Reforging tw-314) are granted only while the
      // source card sits in the marshalling-point pile, never while attached
      // to a bearer — emitted only by `storedCardGrantActions` below.
      e.type === 'grant-action' && e.corruptionCheckWindow !== true && e.endOfTurnOnly !== true
        && e.apply?.type !== 'cancel-chain-entry' && e.fromStored !== true,
  );
}

/**
 * Emit `activate-granted-action` activations for `corruptionCheckWindow`
 * grant-actions while a corruption check by `resolvingCharacterId` is
 * awaiting its roll. Shared by both corruption-check windows — the unified
 * pending resolution (`legal-actions/pending.ts`) and the Free Council
 * support window (`legal-actions/free-council.ts`).
 *
 * The bearer must be an untapped character in the **same company** as the
 * character making the check (the cost taps the bearer). One activation is
 * emitted per eligible bearer × matching grant-action; the resolving
 * character rides on `targetCardId` so the apply's `add-constraint` /
 * `enqueue-corruption-check` steps know which check to boost.
 *
 * Used by *When I Know Anything* (td-166): a sage taps to add +3 to one
 * corruption check by a character in his company, then makes a check himself.
 */
export function modifyCorruptionCheckGrantActions(
  state: GameState,
  playerId: PlayerId,
  resolvingCharacterId: CardInstanceId,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  if (!player) return actions;
  const company = findCharacterCompany(player.companies, resolvingCharacterId);
  if (!company) return actions;

  for (const charId of company.characters) {
    const bearer = player.characters[charId];
    if (!bearer) continue;
    // Cost taps the bearer — only untapped bearers may activate.
    if (bearer.status !== CardStatus.Untapped) continue;
    for (const item of bearer.items) {
      const def = defById(state, item.definitionId);
      const grant = getCardEffects(def).find(
        (e): e is import('../../types/effects.js').GrantActionEffect =>
          e.type === 'grant-action' && e.corruptionCheckWindow === true && !!e.apply,
      );
      if (!grant) continue;
      logDetail(`Corruption-check modifier available: ${def?.name ?? '?'} (bearer ${charId as string}) → boost check by ${resolvingCharacterId as string}`);
      actions.push(grantedAction(playerId, charId, item, grant.action, 0, { targetCardId: resolvingCharacterId }));
    }
  }
  return actions;
}

/**
 * Result of an end-of-org play eligibility check. When `eligible` is
 * false, `reason` carries a UI-friendly explanation of why the card
 * cannot currently be played. When `eligible` is true and the card has
 * a `play-target` effect, `eligibleTargets` lists every valid target
 * (e.g. each untapped scout in a company under the size cap) so the
 * action emitter can produce one play action per target.
 */
interface EndOfOrgEligibility {
  readonly eligible: boolean;
  readonly reason: string;
  /** One entry per valid target character. Empty when the card has no play-target. */
  readonly eligibleTargets: readonly CardInstanceId[];
}

/**
 * Checks whether an end-of-org card's `play-target` constraints are
 * satisfied by the active player's current companies. Character targeting
 * is driven entirely by the card's DSL `filter` condition plus an
 * optional `maxCompanySize` — there are no per-card branches here.
 */
export function endOfOrgEligibility(
  state: GameState,
  player: PlayerState,
  def: ResourceEventCard,
  playTarget: PlayTargetEffect | undefined,
): EndOfOrgEligibility {
  if (!playTarget) return { eligible: true, reason: '', eligibleTargets: [] };
  if (playTarget.target !== 'character' && playTarget.target !== 'company') {
    return { eligible: true, reason: '', eligibleTargets: [] };
  }

  // Company targeting: collect eligible character IDs per qualifying company.
  // When a `filter` is present it is evaluated against a company-level context
  // (currently exposes `company.atHaven`).  When a tap cost is declared the
  // eligible targets are all untapped characters in qualifying companies (one
  // action per character, representing the tapper choice).  When there is no
  // tap cost, one representative character per qualifying company is returned so
  // the player can distinguish between multiple valid companies.
  if (playTarget.target === 'company') {
    const eligibleTargets: CardInstanceId[] = [];
    for (const company of player.companies) {
      // Evaluate optional company-level filter (e.g. company.atHaven for Great-road).
      if (playTarget.filter) {
        const siteDef = company.currentSite
          ? defById(state, company.currentSite.definitionId)
          : undefined;
        const siteType = siteDef && 'siteType' in siteDef
          ? (siteDef as { siteType: string }).siteType
          : '';
        // Ash Mountains (tw-194) and its "movement enhancer" family: "on a
        // company containing a ranger" — the union of every company member's
        // effective skills, so `{ "company.skills": { "$includes": "ranger" } }`
        // matches regardless of which character carries it.
        const companySkills = company.characters.flatMap(cId => {
          const ch = player.characters[cId];
          if (!ch) return [];
          const cDef = defById(state, ch.definitionId);
          return cDef && isCharacterCard(cDef) ? getEffectiveSkills(state, ch, cDef) : [];
        });
        const companyFilterCtx = {
          company: {
            atHaven: siteType === 'haven',
            // "on a moving company" (Down Down to Goblin-town le-181): a company
            // that has planned a destination (or special movement) this org phase.
            moving: company.destinationSite !== null || !!company.specialMovement,
            // Ancient Stair (dm-115): "a company that starts its turn at an
            // untapped adjacent site of an Under-deeps site" — the surface
            // entrance named in some Under-deeps site's `adjacentSites` map.
            atUnderDeepsSurfaceSite: isUnderDeepsSurfaceSite(state, siteDef),
            siteUntapped: company.currentSite?.status === CardStatus.Untapped,
            skills: companySkills,
          },
        };
        if (!matchesCondition(playTarget.filter, companyFilterCtx)) continue;
      }
      if (playTarget.cost?.tap === 'character' || playTarget.cost?.tap === 'skilled-character-in-company') {
        // Tap-cost: emit one action per untapped (optionally skill-matching)
        // character (player chooses tapper).
        const requiredSkill = playTarget.cost.tap === 'skilled-character-in-company' ? playTarget.cost.skill : undefined;
        for (const charInstId of company.characters) {
          const char = player.characters[charInstId];
          if (!char || char.status !== CardStatus.Untapped) continue;
          if (requiredSkill) {
            const charDef = defById(state, char.definitionId);
            if (!charDef || !isCharacterCard(charDef)) continue;
            if (!getEffectiveSkills(state, char, charDef as { skills?: readonly string[] }).includes(requiredSkill as Skill)) continue;
          }
          eligibleTargets.push(charInstId);
        }
      } else {
        // No tap cost: use the first character as a company representative so
        // the emitter can generate one action per qualifying company.
        const firstChar = company.characters[0];
        if (firstChar) eligibleTargets.push(firstChar);
      }
    }
    if (eligibleTargets.length === 0) {
      return {
        eligible: false,
        reason: (playTarget.cost?.tap === 'character' || playTarget.cost?.tap === 'skilled-character-in-company')
          ? `${def.name} requires an untapped character in a company`
          : `${def.name} requires a company at the required location`,
        eligibleTargets: [],
      };
    }
    return { eligible: true, reason: '', eligibleTargets };
  }

  const eligibleTargets: CardInstanceId[] = [];
  let foundMatchingCharacter = false;
  for (const company of player.companies) {
    const matchesInCompany: CardInstanceId[] = [];
    for (const charInstId of company.characters) {
      const char = player.characters[charInstId];
      if (!char) continue;
      const charDef = defById(state, char.definitionId);
      if (!charDef || !isCharacterCard(charDef)) continue;
      if (playTarget.filter
          && !matchesCondition(playTarget.filter, buildTargetContext(state, char, player))) {
        continue;
      }
      matchesInCompany.push(charInstId);
    }
    if (matchesInCompany.length === 0) continue;
    foundMatchingCharacter = true;
    if (playTarget.maxCompanySize !== undefined) {
      const size = companyEffectiveSize(state, company);
      if (size > playTarget.maxCompanySize) continue;
    }
    eligibleTargets.push(...matchesInCompany);
  }
  if (eligibleTargets.length === 0) {
    if (!foundMatchingCharacter) {
      return { eligible: false, reason: `${def.name} requires a matching character`, eligibleTargets: [] };
    }
    return {
      eligible: false,
      reason: `${def.name} requires a company of size ≤ ${playTarget.maxCompanySize as number}`,
      eligibleTargets: [],
    };
  }
  return { eligible: true, reason: '', eligibleTargets };
}

/**
 * Returns the {@link PlayTargetEffect} for the given resource event card,
 * or undefined when the card does not declare one.
 */
export function getPlayTargetEffect(def: ResourceEventCard): PlayTargetEffect | undefined {
  return def.effects?.find((e): e is PlayTargetEffect => e.type === 'play-target');
}

/**
 * Returns every `play-target` effect on the given resource event card. Most
 * cards carry at most one; a card with two mutually-exclusive end-of-org
 * modes (Anduin River tw-191 and the "mountain-crossing" family: a
 * ranger-tap mode alongside a no-cost "alternatively" mode, the shape *The
 * Cock Crows* tw-342 established for dual-mode short-events) carries one per
 * mode. Used by the end-of-org emitter to offer actions for every mode.
 */
export function getPlayTargetEffects(def: ResourceEventCard): readonly PlayTargetEffect[] {
  return (def.effects ?? []).filter((e): e is PlayTargetEffect => e.type === 'play-target');
}

/**
 * Collects all in-play card instance IDs that match the supplied
 * `discard-in-play` filter. Searches two zones:
 *
 * - General in-play cards ({@link PlayerState.cardsInPlay}, e.g. Eye of
 *   Sauron long-events, untargeted permanent-events) across **both**
 *   players — an untargeted hazard event sits in its owner's own
 *   `cardsInPlay`, so a hero player's Marvels Told must be able to reach
 *   into the hazard player's zone to discard it there.
 * - Hazard cards attached to characters (`character.hazards`, e.g. Foolish
 *   Words, Lure of the Senses), restricted to **`actorPlayerId`'s own**
 *   characters only. Per CoE 2.IV.vii.3 a hazard event targets "the current
 *   company", i.e. whoever was moving when it was played — so an attached
 *   hazard always ends up on its bearer's own side, and Marvels Told-style
 *   cards may only clean hazards off the caster's own characters, never off
 *   the opponent's (even when the caster happens to be the hazard's owner,
 *   e.g. a Rebel-talk they themselves played onto the opponent's character
 *   during an earlier hazard phase).
 *
 * Nazgûl-style dual creature/permanent-event cards (Ûvatha tw-107, Adûnaphel
 * tw-2, …) sitting in `cardsInPlay` are matched via their
 * {@link effectiveInPlayDef} — see that function for why the raw
 * `hazard-creature` definition would otherwise be invisible to a
 * `cardType: 'hazard-event'` filter.
 */
export function collectDiscardInPlayTargets(
  state: GameState,
  filter: Condition,
  actorPlayerId: PlayerId,
): CardInstanceId[] {
  const targets: CardInstanceId[] = [];
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      const cDef = defById(state, c.definitionId);
      if (cDef && matchesDefinition(effectiveInPlayDef(cDef), filter)) {
        targets.push(c.instanceId);
      }
    }
    if (p.id !== actorPlayerId) continue;
    for (const charId of Object.keys(p.characters) as CardInstanceId[]) {
      const char = p.characters[charId];
      for (const haz of char.hazards) {
        const hDef = defById(state, haz.definitionId);
        if (hDef && matchesDefinition(hDef, filter)) {
          targets.push(haz.instanceId);
        }
      }
    }
  }
  return targets;
}

/**
 * Returns all {@link PlayOptionEffect}s declared on the given card.
 */
export function getPlayOptionEffects(def: ResourceEventCard): readonly PlayOptionEffect[] {
  return def.effects?.filter((e): e is PlayOptionEffect => e.type === 'play-option') ?? [];
}

/**
 * Maps a character's {@link CardStatus} to the string tokens used by
 * {@link PlayOptionEffect} `when` conditions.
 */
function statusToken(status: CardStatus): 'tapped' | 'untapped' | 'inverted' {
  switch (status) {
    case CardStatus.Tapped: return 'tapped';
    case CardStatus.Untapped: return 'untapped';
    case CardStatus.Inverted: return 'inverted';
  }
}

/**
 * Builds the matcher context used to evaluate a {@link PlayTargetEffect}'s
 * `filter` or a {@link PlayOptionEffect}'s `when` against a candidate
 * target character. The context exposes:
 *
 *  - `target.race`, `target.status`, `target.skills`, `target.keywords`,
 *    `target.name` — per-character attributes for filtering. `target.keywords`
 *    exposes the character's card keywords (e.g. `"leader"`), used by Foe
 *    Dismayed (ba-59) to gate its +3 influence boost on "a leader or The
 *    Balrog".
 *  - `target.inAvatarCompany` — `true` iff the character belongs to the
 *    same company as the player's avatar (wizard/ringwraith/etc.).
 *    Requires the `player` parameter to be passed.
 *  - `company.siteRegion` — the name of the region containing the
 *    character's company's current site (or `null` at sea/no site). Lets a
 *    `play-target` filter gate on the origin's region by name (e.g. Belegaer
 *    td-100: "moving from a site of origin in one of the following regions").
 *  - `company.containsDiplomat` — `true` iff the character's company
 *    contains at least one character with the `diplomat` skill.
 *    Enables cards like New Friendship to offer a corruption-check boost
 *    to any character in a diplomat's company, not just the diplomat.
 *  - `pending.corruptionCheckTargetsMe` — `true` iff a pending
 *    corruption-check resolution exists whose `characterId` matches
 *    the candidate. Enables reactive plays like Halfling Strength's
 *    `+4 corruption check boost` option to declare
 *    `when: { "pending.corruptionCheckTargetsMe": true }` and thereby
 *    satisfy the CoE "cannot play cards without effect" rule.
 *
 * Exported so legal-action computers in other windows (e.g. the
 * corruption-check pending-resolution window) can build the same
 * context shape when scanning a player's hand for reactive plays.
 */
export function buildPlayOptionContext(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  player?: PlayerState,
  currentPhase?: string,
): Record<string, unknown> {
  const def = defById(state, char.definitionId);
  if (!def || !isCharacterCard(def)) {
    return { target: {}, pending: { corruptionCheckTargetsMe: false } };
  }
  // Mirrors `corruptionCheckTargetsMe` for the riddling-attempt window: true
  // only while a `riddling-attempt` pending resolution is awaiting its roll
  // for this exact character. Gates reactive roll-boosting short events (Wit
  // td-168: "Modify one riddling roll by +3") so they are offered only in
  // response to an actual pending riddling roll, never speculatively.
  const riddlingAttemptTargetsMe = state.pendingResolutions.some(
    r => r.kind.type === 'riddling-attempt' && r.kind.characterInstanceId === char.instanceId,
  );
  const corruptionCheckTargetsMe = state.pendingResolutions.some(
    r => r.kind.type === 'corruption-check' && r.kind.characterId === char.instanceId,
  ) || (
    // Free Council (CoE 10.3.i) tracks its own pending check outside the
    // generic pending-resolution queue — mirror it here so reactive plays
    // like Halfling Strength's +4 corruption-check boost stay usable during
    // the end-of-game corruption checks, not just mid-game ones.
    state.phaseState.phase === Phase.FreeCouncil
    && state.phaseState.pendingCheck?.characterId === char.instanceId
  );
  let inAvatarCompany = false;
  let isRevealedAvatar = false;
  let hasFactionInHand = false;
  let isInfluencing = false;
  let companySiteType: string | null = null;
  let companySiteName: string | null = null;
  let companySiteRegion: string | null = null;
  let containsDiplomat = false;
  let companyMoving = false;
  let companyDestinationSiteRegionType: string | null = null;
  if (player) {
    const avatar = findPlayerAvatar(state, player);
    if (avatar) {
      // `isRevealedAvatar` gates "your Ringwraith"/"your Wizard" self-targeting
      // (e.g. Ancient Secrets ba-36 taps the player's own revealed Ringwraith):
      // true only for the player's own revealed avatar, never a Ringwraith
      // follower controlled by that avatar (findPlayerAvatar returns the
      // revealed avatar specifically).
      if (avatar.instanceId === char.instanceId) isRevealedAvatar = true;
      const co = findCharacterCompany(player.companies, avatar.instanceId);
      if (co && co.characters.includes(char.instanceId)) {
        inAvatarCompany = true;
      }
    }
    // `hasFactionInHand` is true only while this player's influence-attempt is
    // live in the chain — the faction card has moved from hand to the chain but
    // the boost window is still open for cards like Muster and New Friendship.
    // Pre-checking whether the hand contains a faction card is intentionally
    // excluded: short-event influence boosters must be played in response to an
    // active influence check, not speculatively before one is declared.
    hasFactionInHand = Boolean(state.chain?.entries.some(
      e => !e.resolved && !e.negated && e.payload.type === 'influence-attempt' && e.declaredBy === player.id,
    ));
    // `isInfluencing` is true only for the character whose influence-attempt is
    // live in the chain. Lets a boost event that modifies "an influence check"
    // without naming a target (The Dark Power as-79) pin its play-target to the
    // influencing character, so the resulting one-shot constraint is consumed
    // by the very check the card was played on.
    isInfluencing = Boolean(state.chain?.entries.some(
      e => !e.resolved && !e.negated && e.payload.type === 'influence-attempt'
        && e.declaredBy === player.id
        && e.payload.influencingCharacterId === char.instanceId,
    ));
    const charCompany = findCharacterCompany(player.companies, char.instanceId);
    if (charCompany?.currentSite) {
      const siteDef = defById(state, charCompany.currentSite.definitionId);
      if (siteDef && 'siteType' in siteDef) companySiteType = (siteDef as { siteType: string }).siteType;
      if (siteDef) companySiteName = siteDef.name;
      if (siteDef) companySiteRegion = (siteDef as { region?: string }).region ?? null;
    }
    // The region type containing the company's *declared* destination site
    // (Organization phase `plan-movement`, or a still-set destination during
    // M/H) — distinct from `destinationRegionTypes` below, which is the path
    // of regions *traversed* to reach it. Lets end-of-organization-phase cards
    // gate on the destination's own region (e.g. Secret Entrance tw-324: "may
    // not be played on a company moving to a site in a Dark-domain").
    if (charCompany?.destinationSite) {
      const destSiteDef = defById(state, charCompany.destinationSite.definitionId);
      const regionType = siteRegionTypeOf(state, destSiteDef);
      if (regionType) companyDestinationSiteRegionType = regionType;
    }
    if (charCompany) {
      containsDiplomat = charCompany.characters.some(memberId => {
        const memberChar = player.characters[memberId];
        if (!memberChar) return false;
        const memberDef = defById(state, memberChar.definitionId);
        if (!isCharacterCard(memberDef)) return false;
        return getEffectiveSkills(state, memberChar, memberDef).includes('diplomat');
      });
    }
    // A character is "moving" when it belongs to the active company during the
    // M/H phase and that company is actually moving to a new site. Use
    // siteRevealed (true only for moving companies) rather than
    // destinationSiteName (which is set to the current site even for
    // stationary companies, making it non-null for both cases).
    const ps = state.phaseState as MovementHazardPhaseState;
    if (ps.phase === 'movement-hazard' && ps.siteRevealed && charCompany) {
      const activeCompany = player.companies[ps.activeCompanyIndex];
      companyMoving = activeCompany?.id === charCompany.id;
    } else if (state.phaseState.phase === 'organization' && charCompany) {
      // During the organization phase a company counts as "moving" once it has
      // a planned destination (plan-movement sets destinationSite; the player
      // may still cancel it before the phase ends). Hide in Dark Places
      // (le-192) gates on `company.moving` being false so it can only be played
      // on a company that has not declared movement.
      companyMoving = charCompany.destinationSite != null;
    }
  }

  // During M/H phase expose destination site type and path region types so
  // play-option `when` conditions can gate on e.g. "destination is R&L" or
  // "path contains wilderness" (used by Deeper Shadow, le-179).
  let destinationSiteType: string | null = null;
  let destinationRegionTypes: string[] = [];
  const mhPs = state.phaseState as MovementHazardPhaseState;
  if (mhPs.phase === 'movement-hazard') {
    destinationSiteType = mhPs.destinationSiteType ?? null;
    destinationRegionTypes = [...mhPs.resolvedSitePath];
  }

  // Names of items / allies the character bears, so play-target filters can
  // gate on a specific borne card (e.g. Cracks of Doom targets the bearer of
  // The One Ring via `{ "target.itemNames": { "$includes": "The One Ring" } }`).
  const itemNames = defNamesOf(state, char.items);
  const allyNames = defNamesOf(state, char.allies);
  // Combined keywords of every item the character bears, so play-target
  // filters can gate on bearing an item of a given kind without naming it
  // (Use Palantír tw-355: `{ "target.itemKeywords": { "$includes": "palantir" } }`).
  const itemKeywords = itemKeywordsOf(state, char.items);

  return {
    target: {
      race: def.race,
      status: statusToken(char.status),
      skills: getEffectiveSkills(state, char, def as { skills?: readonly string[] }),
      keywords: (def.keywords as readonly string[] | undefined) ?? [],
      name: def.name,
      mind: def.mind,
      inAvatarCompany,
      isRevealedAvatar,
      isInfluencing,
      itemNames,
      allyNames,
      itemKeywords,
      // Races of attacks that wounded this character so far this turn (Pale
      // Dream-maker dm-78, Endless Whispers dm-54: "Playable on a non-Wizard
      // character wounded by an Undead attack this turn").
      woundedByRaceThisTurn: char.woundedByRaceThisTurn ?? [],
    },
    company: {
      siteType: companySiteType,
      siteName: companySiteName,
      siteRegion: companySiteRegion,
      containsDiplomat,
      moving: companyMoving,
      destinationSiteType,
      destinationRegionTypes,
      destinationSiteRegionType: companyDestinationSiteRegionType,
    },
    pending: {
      corruptionCheckTargetsMe,
      riddlingAttemptTargetsMe,
    },
    player: {
      hasFactionInHand,
    },
    inPlay: buildInPlayNames(state),
    ...(currentPhase !== undefined ? { phase: currentPhase } : {}),
  };
}

/**
 * Builds the condition context for a `play-condition` `requires:
 * 'active-company'` check. Exposes the company's current site (name/type/
 * keywords), the aggregate names of every character, borne item, and borne
 * ally in the company, and its `specialMovement` flag — enough for a generic
 * DSL condition to express positional win prerequisites (e.g. The One Ring
 * and Gollum at Mount Doom), a site-keyword prerequisite (e.g. Bounty of the
 * Hoard td-101 requiring `{ "site.keywords": { "$includes": "hoard" } }`), or
 * a same-turn special-movement prerequisite (Army of the Dead tw-193: "on the
 * same turn that [Aragorn II] plays Paths of the Dead") without a per-card
 * keyword.
 *
 * `extra` merges additional caller-supplied fields into `company` — used by
 * the site-phase item branch to fold in `allyOrFactionPlayedAtSite` (Ent-
 * draughts tw-227), a `SitePhaseState` flag this function has no access to
 * on its own.
 */
export function buildActiveCompanyContext(
  state: GameState,
  player: PlayerState,
  company: import('../../types/state-cards.js').Company,
  extra?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const siteDef = company.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
  const siteName = siteDef?.name;
  const siteType = siteDef && 'siteType' in siteDef ? (siteDef as { siteType: string }).siteType : undefined;
  const printedSiteKeywords = siteDef && 'keywords' in siteDef ? (siteDef as { keywords?: readonly string[] }).keywords ?? [] : [];
  // Dwarven Hoard (td-109): "the site is considered to contain a hoard until
  // the end of the turn" — widen the active site-phase company's site
  // keywords with `hoard` while the flag is set, regardless of the site's
  // printed keywords.
  const hoardKeywordGranted = state.phaseState.phase === Phase.Site && state.phaseState.hoardKeywordGranted === true;
  const siteKeywords = hoardKeywordGranted && !printedSiteKeywords.includes('hoard')
    ? [...printedSiteKeywords, 'hoard']
    : printedSiteKeywords;

  const characterNames: string[] = [];
  const itemNames: string[] = [];
  const allyNames: string[] = [];
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char) continue;
    const cn = defById(state, char.definitionId)?.name;
    if (cn != null) characterNames.push(cn);
    itemNames.push(...defNamesOf(state, char.items));
    allyNames.push(...defNamesOf(state, char.allies));
  }

  return {
    site: { name: siteName, type: siteType, keywords: siteKeywords },
    company: { characterNames, itemNames, allyNames, specialMovement: company.specialMovement, ...(extra ?? {}) },
  };
}

/**
 * Builds the condition context for a `play-condition` `requires:
 * "player-state"` check. The single source of truth for the player-state
 * context across all three evaluation sites (organization, organization-events,
 * site phases). Exposes:
 *
 * - `player.alignment` / `opponent.alignment` — card-text alignment string
 *   (`"wizard"`, `"ringwraith"`, `"fallen-wizard"`, `"balrog"`).
 * - `player.avatar` — the name of the player's revealed avatar (e.g.
 *   `"Pallando"`, `"Saruman"`), or `undefined` if none is in play. Used by The
 *   Fortress of Isen/Towers (wh-68/69) and A Strident Spawn (wh-61). Not
 *   Fallen-wizard-only: the in-play avatar is resolved for every alignment, so
 *   this is also the "as your Ringwraith" identity gate — Hoarmûrath Unleashed
 *   (le-193) uses `{ "player.avatar": "Hoarmûrath the Ringwraith" }`. A
 *   Ringwraith riding as another Ringwraith's follower is not controlled under
 *   general influence and so is not the player's avatar.
 * - `player.avatarInPlay` — `true` when the player has an avatar character in
 *   play (in a company). Unlike `avatar` (the declared Fallen-wizard identity,
 *   which persists in the deck/hand), this is the in-play signal. Used by Saw
 *   Further and Deeper (dm-156): "Playable only if your Wizard is not revealed"
 *   → `{ "player.avatarInPlay": false }`.
 * - `player.hasRingwraithInPlay` — `true` when the player has a Ringwraith-race
 *   avatar character in play. Used by Above the Abyss (as-77).
 * - `player.stagePoints` — the Fallen-wizard stage-point total. Used by
 *   Gatherer of Loyalties (wh-70) and A Strident Spawn (wh-61).
 * - `player.factionCount` — the number of factions the player controls in play.
 *   Used by The White Hand (wh-122).
 * - `player.characterCount` — the number of characters the player controls in
 *   play. Used by Await the Onset (wh-96): "6 characters".
 * - `player.hasProtectedWizardhaven` — `true` when the player controls a
 *   protected Wizardhaven. Used by A Strident Spawn (wh-61).
 * - `player.protectedWizardhavenCount` — how many *distinct* protected
 *   Wizardhavens the player controls. Used by Await the Onset (wh-96): "two
 *   protected Wizardhavens [{H}]".
 * - `inPlay` — the names of cards the player has in play, for
 *   `{ "inPlay": "<name>" }` prerequisites (e.g. The White Hand wh-122).
 * - `inPlayAnywhere` — the names of cards **either** player has in play (the
 *   game-wide environment list, honouring `environment-override`), for rules
 *   that key off a card being on the table regardless of who put it there —
 *   e.g. The Will of Sauron (tw-100) "Discard this card if Doors of Night is
 *   not in play": `{ "$not": { "inPlayAnywhere": "Doors of Night" } }`.
 * - `charactersInPlayAnywhere` — the names of every **character** either player
 *   has in play. `inPlay`/`inPlayAnywhere` cover `cardsInPlay` only, so this is
 *   the list a rule about a person entering play must consult. Matched by name,
 *   so every printing of a character counts (Gandalf is tw-156 and wh-4). Used
 *   by Gandalf the White Rider (as-11): "Discard this card if Gandalf comes
 *   into play" → `{ "charactersInPlayAnywhere": "Gandalf" }`.
 * - `player.sameLocationDeckTypeAsOpponent` — `true` when the player and their
 *   opponent draw from the same *type* of location deck: `isMinionOrBalrog`
 *   agrees for both sides (CoE 1.4.W1/R1: a Wizard's location deck is
 *   hero-only, a Ringwraith's minion-only, so two Wizards or two Ringwraiths
 *   always match). Used by Winds of Wrath (td-82) and Chance of Being Lost
 *   (dm-49): "Playable ... if opponent is using the same type of location
 *   deck (minion/hero) as yourself."
 */
export function buildPlayerStateContext(
  state: GameState,
  player: PlayerState,
  playerId: PlayerId,
): Record<string, unknown> {
  const opponent = state.players.find(p => p.id !== playerId);
  let hasRingwraithInPlay = false;
  for (const char of Object.values(player.characters)) {
    const def = defById(state, char.definitionId);
    if (isAvatarCharacter(def) && (def as { race?: Race }).race === Race.Ringwraith) {
      hasRingwraithInPlay = true;
      break;
    }
  }
  const factionCount = player.cardsInPlay.filter(c => {
    const def = defById(state, c.definitionId);
    return def && isFactionCard(def);
  }).length;
  // Number of (non-prisoner) characters the player controls in play — companies
  // hold the player's characters keyed by instance. Used by Await the Onset
  // (wh-96): "6 characters".
  const characterCount = Object.values(player.characters).filter(char => {
    const def = defById(state, char.definitionId);
    return def && isCharacterCard(def);
  }).length;
  // "Playable if you are X" Stage cards test the Fallen-wizard the player
  // counts *as* (CoE 2.2.F2), which persists from declaration (CoE 1.8.F1)
  // until the avatar is eliminated — the avatar need not be in play. Use the
  // identity helper rather than the in-play-only avatar lookup.
  const avatarName = findFallenWizardAvatarName(state, player);
  // Whether the player's avatar is currently in play (in a company). Distinct
  // from `avatar` above, which is the *declared* Fallen-wizard identity and
  // persists even while the avatar sits in the deck/hand. `avatarInPlay` is the
  // signal a Wizard needs for "your Wizard is not revealed" (Saw Further and
  // Deeper dm-156): `findPlayerAvatar` returns the in-play avatar character or
  // undefined, so `false` means no avatar has been brought into play yet.
  const avatarInPlay = findPlayerAvatar(state, player) !== undefined;
  // Names of every site the player currently has characters at — a company's
  // characters are all at its `currentSite`. Backs "playable if any of your
  // characters are at <site>" (Mirror of Galadriel tw-282, "at Lórien"), which
  // is about *any* company, not the phase's active one. Matched by name so all
  // versions of a site (hero / minion / Under-deeps reprints) count.
  const characterSiteNames = Array.from(new Set(
    player.companies
      .filter(c => c.characters.length > 0)
      .map(c => (c.currentSite ? defById(state, c.currentSite.definitionId)?.name : undefined))
      .filter((n): n is string => n !== undefined),
  ));
  return {
    player: {
      alignment: player.alignment,
      characterSiteNames,
      avatar: avatarName,
      avatarInPlay,
      hasRingwraithInPlay,
      stagePoints: player.stagePoints,
      factionCount,
      characterCount,
      hasProtectedWizardhaven: playerHasProtectedWizardhaven(state, playerId),
      protectedWizardhavenCount: protectedWizardhavenCount(state, playerId),
      // "Playable if you are Sauron" (The Dark Power as-79): true while the
      // player counts as Sauron via a `play-as-sauron` marker in play (The
      // Lidless Eye le-203 / Sauron ba-43).
      playsAsSauron: playerPlaysAsSauron(state, player),
      sameLocationDeckTypeAsOpponent: opponent !== undefined && isMinionOrBalrog(player) === isMinionOrBalrog(opponent),
    },
    opponent: { alignment: opponent?.alignment },
    inPlay: buildControllerInPlayNames(state, playerId),
    inPlayAnywhere: buildInPlayNames(state),
    charactersInPlayAnywhere: charactersInPlayNames(state),
  };
}

/**
 * True when `def`'s `play-condition: player-state` gate (if any) is satisfied
 * for the player — the condition is matched against
 * {@link buildPlayerStateContext}, and a card carrying no such play-condition
 * passes. Shared by every from-hand event emitter so the
 * avatar/alignment/stage-point gate (The Great Eye as-85 "Playable if you are
 * Sauron", A Strident Spawn wh-61, The Fortress of Isen wh-68, Above the
 * Abyss as-77) reads identically at each play window.
 */
export function playerStateGateMet(
  state: GameState,
  player: PlayerState,
  playerId: PlayerId,
  def: CardDefinition | null | undefined,
): boolean {
  const gate = findPlayConditionEffect(def, 'player-state');
  return !gate?.condition || matchesCondition(gate.condition, buildPlayerStateContext(state, player, playerId));
}

/** Legacy alias retained for call sites inside this module. */
function buildTargetContext(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  player?: PlayerState,
  currentPhase?: string,
): Record<string, unknown> {
  return buildPlayOptionContext(state, char, player, currentPhase);
}

/**
 * Enumerates candidate target character instance IDs for a
 * {@link PlayTargetEffect} with `target: "character"`. Applies the
 * optional DSL `filter` condition against each candidate's target
 * context — no per-card / per-keyword branches. Non-character targets
 * yield an empty list here; those are handled by dedicated play paths.
 *
 * When the play-target carries a tap cost (`cost.tap === 'character'`),
 * already-tapped characters are excluded — a tapped character cannot pay
 * the tap cost. Without this guard, cards like Marvels Told would be
 * offered with a tapped sage as the target.
 */
function eligiblePlayOptionTargets(
  state: GameState,
  player: PlayerState,
  playTarget: PlayTargetEffect,
): CardInstanceId[] {
  if (playTarget.target !== 'character') return [];
  const requiresUntapped = playTarget.cost?.tap === 'character';
  const out: CardInstanceId[] = [];
  for (const [charId, char] of characterEntries(player)) {
    const charDef = defById(state, char.definitionId);
    if (!charDef || !isCharacterCard(charDef)) continue;
    if (requiresUntapped && char.status !== CardStatus.Untapped) {
      logDetail(`Play-target rejects ${charDef.name} (${charId}): status ${char.status} (tap cost requires untapped)`);
      continue;
    }
    if (playTarget.filter
        && !matchesCondition(playTarget.filter, buildTargetContext(state, char, player))) {
      continue;
    }
    // Enforce the optional company-size cap (e.g. Sneakin' / Stealth:
    // "company size less than 3" → maxCompanySize 2). Hobbits and Orc
    // scouts count as half via companyEffectiveSize. This mirrors the
    // end-of-org path so
    // cards playable during the normal organization window respect the
    // same size restriction.
    if (playTarget.maxCompanySize !== undefined) {
      const company = findCharacterCompany(player.companies, charId);
      if (company && companyEffectiveSize(state, company) > playTarget.maxCompanySize) {
        logDetail(`Play-target rejects ${charDef.name} (${charId}): company size ${companyEffectiveSize(state, company)} > max ${playTarget.maxCompanySize}`);
        continue;
      }
    }
    out.push(charId);
  }
  return out;
}

/**
 * Candidate targets for A Malady Without Healing (le-159): a `play-target`
 * with `requiresControlledShadowMagicUserAtSite`. Unlike
 * {@link eligiblePlayOptionTargets}, candidates are drawn from **both** players'
 * characters ("May target an opponent's character"). A candidate qualifies when
 * it passes the play-target `filter` (non-Ringwraith, non-Wizard) **and** the
 * acting player controls a shadow-magic user (a Ringwraith, or a character with
 * the `shadow-magic` skill incl. item-granted) in a company at the candidate's
 * current site — a different character than the candidate itself.
 *
 * Co-location is matched by site *name*: the caster and an opposing target sit
 * at different alignment versions of the same location (e.g. minion Rivendell
 * `as-160` vs hero Rivendell `tw-421`), so comparing definition ids would never
 * find an opponent's character.
 */
function eligibleMaladyTargets(
  state: GameState,
  caster: PlayerState,
  playTarget: PlayTargetEffect,
): CardInstanceId[] {
  const out: CardInstanceId[] = [];
  for (const owner of state.players) {
    for (const [charId, char] of characterEntries(owner)) {
      const charDef = defById(state, char.definitionId);
      if (!charDef || !isCharacterCard(charDef)) continue;
      if (playTarget.filter && !matchesCondition(playTarget.filter, buildTargetContext(state, char, owner))) continue;
      const targetCompany = findCharacterCompany(owner.companies, charId);
      const siteName = companySiteName(state, targetCompany);
      if (!siteName) continue;
      const hasUserAtSite = caster.companies.some(co =>
        companySiteName(state, co) === siteName
        && co.characters.some(cid => {
          if (cid === charId) return false;
          const ch = caster.characters[cid];
          if (!ch) return false;
          const cDef = defById(state, ch.definitionId);
          if (!cDef || !isCharacterCard(cDef)) return false;
          if (cDef.race === Race.Ringwraith) return true;
          return getEffectiveSkills(state, ch, cDef).includes('shadow-magic');
        }),
      );
      if (!hasUserAtSite) continue;
      out.push(charId);
    }
  }
  return out;
}

/**
 * Generates `play-short-event` actions for a card with {@link PlayOptionEffect}s.
 * One action per (target, option) pair whose `when` (if any) matches the
 * target context. The chosen option is carried on the action via
 * `optionId` so the reducer can dispatch generically via the option's
 * `apply` clause.
 */
function playOptionActionsForCard(
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
  const hasTapCost = playTarget.cost?.tap === 'character';
  const targets = eligiblePlayOptionTargets(state, player, playTarget);

  // Resolve the source definition once to check for an active-check duplication limit.
  const sourceDefId = resolveInstanceId(state, cardInstanceId);
  const sourceDef = sourceDefId ? defById(state, sourceDefId) : undefined;
  const activeCheckLimit = findDuplicationLimitEffect(sourceDef, 'active-check');

  for (const targetId of targets) {
    const char = player.characters[targetId];
    if (!char) continue;
    const charDef = defById(state, char.definitionId);
    const targetName = isCharacterCard(charDef) ? charDef.name : String(targetId);

    // "active-check" duplication limit: skip this target if a constraint from this
    // definition already exists for it (enforces "Cannot be duplicated on a given check").
    if (activeCheckLimit && sourceDefId) {
      const alreadyApplied = state.activeConstraints.some(
        c => constraintFromCard(state, c, sourceDefId)
          && c.target.kind === 'character'
          && c.target.characterId === targetId,
      );
      if (alreadyApplied) {
        logDetail(`${def.name}: active-check duplication limit — already applied to ${targetName}`);
        continue;
      }
    }

    const ctx = buildTargetContext(state, char, player, currentPhase);
    for (const opt of options) {
      if (opt.when && !matchesCondition(opt.when, ctx)) {
        logDetail(`${def.name} on ${targetName}: option "${opt.id}" when-condition rejected`);
        continue;
      }
      logDetail(`${def.name} playable on ${targetName}: option "${opt.id}"`);
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
  return actions;
}

/**
 * Enumerates the concrete play actions for a {@link WithdrawAgentEffect} card
 * (Withdrawn to Mordor, dm-165) held by `playerId`:
 *
 * - one `play-short-event` carrying `targetAgentId` per **face-up** agent the
 *   opponent has in play (agent mode); and
 * - when the effect allows the alternative, one carrying `discardTargetInstanceId`
 *   per **unrevealed** on-guard card sitting on the player's own companies
 *   (on-guard mode — the CRF 22 "before it is revealed" window).
 *
 * Returns an empty array when neither target exists, so the caller can mark
 * the card not-playable with a reason.
 */
export function withdrawAgentTargetActions(
  state: GameState,
  playerId: PlayerId,
  player: PlayerState,
  cardInstanceId: CardInstanceId,
  effect: WithdrawAgentEffect,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];

  const opponent = state.players.find(p => p.id !== playerId);
  for (const agent of opponent?.agents ?? []) {
    if (!agent.revealed) continue;
    const agentDef = defById(state, agent.character.definitionId);
    const agentName = agentDef?.name ?? (agent.character.definitionId as string);
    logDetail(`Withdrawn to Mordor: can target face-up agent ${agentName} (${agent.id as string})`);
    actions.push({
      action: { type: 'play-short-event', player: playerId, cardInstanceId, targetAgentId: agent.id },
      viable: true,
    });
  }

  if (effect.alternativeDiscardOnGuard) {
    for (const company of player.companies) {
      for (const og of company.onGuardCards) {
        if (og.revealed) continue;
        logDetail(`Withdrawn to Mordor: can discard unrevealed on-guard card (${og.instanceId as string}) at company ${company.id as string}`);
        actions.push({
          action: { type: 'play-short-event', player: playerId, cardInstanceId, discardTargetInstanceId: og.instanceId },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Evaluates hero-resource short-event cards in the active player's hand for
 * play in the given phase (CoE rule 2.1.1: resource short-events are legal
 * during any phase of the resource player's turn unless restricted by a
 * rule or effect).
 *
 * Skips cards already considered by an earlier pass (e.g. play-character
 * evaluation in organization) and cards whose `play-window` effect binds
 * them to a different phase. Emits `play-short-event` actions (one per
 * eligible target combination) and `not-playable` entries with a reason
 * for cards whose constraints cannot be satisfied.
 *
 * The returned actions all carry a `cardInstanceId` matching a hand card,
 * so callers can derive the evaluated set to skip duplicates in a final
 * catch-all loop.
 */
export function playResourceShortEventActions(
  state: GameState,
  playerId: PlayerId,
  alreadyEvaluated: ReadonlySet<string>,
  currentPhase: 'organization' | 'site',
): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  const combatOnlyTypes = new Set(['cancel-attack', 'cancel-chain-attack-cancel', 'cancel-strike', 'halve-strikes', 'strike-modifier', 'company-combat-boost', 'flattery-cancel-attack', 'goodwill-cancel-attack', 'riddling-attempt']);
  const inPlayNames = buildInPlayNames(state);

  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    if (!isResourceEventCard(def)) continue;
    if (alreadyEvaluated.has(handCard.instanceId as string)) continue;
    // Character-recruitment events (A Chance Meeting tw-188, We Have Come to
    // Kill le-252): rule 5.1 — "Short-events can only be played if they would
    // have an immediate effect on the game other than the play of the card
    // itself". These cards' only effect is `recruit-character`, resolved
    // exclusively via `recruitViaEventActions`'s paired `play-character`
    // action. Falling through to the generic handling below would offer a
    // bare no-op `play-short-event` (no recruit target) that discards the
    // card for zero effect.
    if (def.effects?.some(e => e.type === 'recruit-character')) continue;
    // Burglary (td-103): its only effect is `burglary-attempt`, resolved
    // exclusively via the dedicated `declare-burglary` action offered during
    // the site phase's `automatic-attacks` step (see
    // `automaticAttacksActions` in legal-actions/site.ts). Falling through to
    // the generic handling below would offer a bare no-op `play-short-event`
    // that silently discards the card for zero effect.
    if (def.effects?.some(e => e.type === 'burglary-attempt')) continue;
    // "Permanent-event/Short-event" card (Great Army of the North ba-38): admit
    // its alternative short-event reshuffle mode during the organization phase
    // (its permanent-event mode is offered separately by playPermanentEventActions).
    const altReshuffle = altShortEventReshuffleEffect(def);
    if (def.eventType !== 'short' && !altReshuffle) continue;
    // grant-extra-mh-phase resources (World Gnawed by the Nameless as-110,
    // Forced March le-185, Bridge tw-202, Leg It Double Quick le-202) are
    // emitted by the movement/hazard-specific `extraMHPhaseResourceActions`,
    // which enforces the "movement/hazard phase, on a company moving to the
    // qualifying site" window. Skip them in this generic short-event path
    // (mirrors the same exclusion in `heroResourceShortEventActions`) so
    // they aren't offered ungated during the organization or site phase.
    if ((def.effects ?? []).some(e => e.type === 'grant-extra-mh-phase')) continue;
    if (def.eventType !== 'short' && altReshuffle) {
      if (!playerHasReshuffleMatch(state, player, altReshuffle)) {
        logDetail(`${def.name}: short-event mode has no matching card in discard — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name}: nothing to shuffle from your discard pile`));
        continue;
      }
      logDetail(`${def.name}: playable as alternative short-event (reshuffle from discard)`);
      actions.push({
        action: { type: 'play-short-event', player: playerId, cardInstanceId: handCard.instanceId },
        viable: true,
      });
      continue;
    }
    const playWindow = def.effects?.find(e => e.type === 'play-window') as { phase?: string; step?: string; siteTypes?: readonly string[] } | undefined;
    // Cards with a play-window restricting them to a different phase
    // are skipped — they'll be marked not-playable by the caller's
    // catch-all loop (or by fillNotPlayable in legal-actions/index.ts).
    if (playWindow && playWindow.phase !== currentPhase) continue;
    // When play-window declares a site-type restriction (e.g. Lucky Search
    // requires shadow-hold or dark-hold), enforce it against the active
    // company's current site. Only applies during the site phase after a
    // company has been selected (activeCompanyIndex is valid outside of the
    // select-company step).
    if (playWindow?.siteTypes && playWindow.siteTypes.length > 0 && currentPhase === 'site') {
      const siteState = state.phaseState as { activeCompanyIndex: number; step: string } | null;
      if (siteState && siteState.step !== 'select-company') {
        const activePlayer = activePlayerState(state);
        const activeCompany = activePlayer?.companies[siteState.activeCompanyIndex];
        const siteDef = activeCompany?.currentSite
          ? defById(state, activeCompany.currentSite.definitionId)
          : undefined;
        if (siteDef && isSiteCard(siteDef) && !playWindow.siteTypes.includes(siteDef.siteType)) {
          logDetail(`${def.name}: play-window siteTypes [${playWindow.siteTypes.join(', ')}] does not include active site type ${siteDef.siteType} — not playable`);
          actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} can only be played at ${playWindow.siteTypes.map((s: string) => s.replace(/-/g, ' ')).join(' or ')}`));
          continue;
        }
      }
    }
    // Withdrawn to Mordor (dm-165): a `withdraw-agent` short event targets an
    // opponent's face-up agent (removed by mind) or, in its alternative mode,
    // discards one of the player's unrevealed on-guard cards. Enumerate one
    // action per eligible target; mark not-playable when neither exists.
    const withdrawAgentEffect = def.effects?.find(
      (e): e is WithdrawAgentEffect => e.type === 'withdraw-agent',
    );
    if (withdrawAgentEffect) {
      const targeted = withdrawAgentTargetActions(
        state, playerId, player, handCard.instanceId, withdrawAgentEffect,
      );
      if (targeted.length === 0) {
        logDetail(`${def.name}: no face-up agent${withdrawAgentEffect.alternativeDiscardOnGuard ? ' or on-guard card' : ''} to target — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} has no valid target`));
      } else {
        actions.push(...targeted);
      }
      continue;
    }

    // End-of-org cards (e.g. Stealth) are playable during the organization
    // phase alongside the player's other organization actions. Playing one
    // does not end the phase or lock out further movement/organization (CoE
    // 2.II.7) — the player advances to Long-event only by passing. Mark them
    // not-playable with a reason if their play-target constraints aren't met
    // so the UI can explain why.
    if (playWindow?.step === 'end-of-org') {
      // play-condition requires: "card-in-play" — a named card must be in play
      // for the playing player (any in-play zone, including character-attached
      // permanent events). Enforced here for end-of-org cards because this
      // branch `continue`s before the generic card-in-play check further down.
      // Used by Cloaked by Darkness (ba-53): "Playable on a company if Great
      // Shadow is in play."
      const endOfOrgCardInPlay = findPlayConditionEffect(def, 'card-in-play');
      if (endOfOrgCardInPlay?.cardName
          && !isCardNameInPlayForPlayer(state, player, endOfOrgCardInPlay.cardName)) {
        logDetail(`${def.name}: end-of-org play-condition card-in-play requires ${endOfOrgCardInPlay.cardName} in play`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires ${endOfOrgCardInPlay.cardName} in play`));
        continue;
      }

      // Most end-of-org cards carry a single play-target effect. A card with
      // two mutually-exclusive modes (Anduin River tw-191 and the
      // "mountain-crossing" family: a ranger-tap mode alongside a no-cost
      // "alternatively" mode) carries one play-target effect per mode — try
      // each independently and union the resulting actions, so the player is
      // offered every mode whose own eligibility is met.
      const eoTargets = getPlayTargetEffects(def);
      const companyDupLimit = findDuplicationLimitEffect(def, 'company');
      let anyModeEmitted = false;
      let lastReason = '';
      for (const eoTarget of eoTargets.length > 0 ? eoTargets : [undefined]) {
        const eligibility = endOfOrgEligibility(state, player, def, eoTarget);
        if (!eligibility.eligible) {
          lastReason = eligibility.reason;
          continue;
        }

        // If the mode has a play-target with a tap cost (e.g. Stealth taps a
        // scout), emit one play action per eligible target so the chosen
        // target can be tapped when the action is reduced. Company-targeting
        // without a tap cost (e.g. Great-road) emits one action per eligible
        // company identified by targetCompanyId. Otherwise emit a single
        // action with no target.
        if (eoTarget && eligibility.eligibleTargets.length > 0
          && (eoTarget.cost?.tap === 'character' || eoTarget.cost?.tap === 'skilled-character-in-company' || eoTarget.target === 'character')) {
          // Per-character actions carrying the chosen character as
          // targetScoutInstanceId. This covers two cases:
          //  - a tap-character cost (e.g. Stealth, Great Ship, Anduin River's
          //    ranger-tap mode): the targeted character is the tapper,
          //    applied at reduce time via the cost;
          //  - a character target with no cost (e.g. Hide in Dark Places,
          //    le-192): the target simply lets the self-enters-play constraint
          //    resolve the scout's company.
          for (const targetId of eligibility.eligibleTargets) {
            // duplication-limit: scope "company" — enforced per mode too, so a
            // tap-cost mode sharing a company-scoped dup limit with a
            // no-cost mode (Anduin River) is blocked once either has fired.
            if (companyDupLimit) {
              const targetCompany = findCharacterCompany(player.companies, targetId);
              if (targetCompany) {
                const copiesOnCompany = state.activeConstraints.filter(
                  c =>
                    constraintFromCard(state, c, def.id) &&
                    c.target.kind === 'company' &&
                    c.target.companyId === targetCompany.id,
                ).length;
                if (copiesOnCompany >= companyDupLimit.max) {
                  logDetail(`${def.name}: cannot be duplicated on company ${targetCompany.id as string} (${copiesOnCompany} active constraint(s))`);
                  continue;
                }
              }
            }
            logDetail(`Resource short-event playable (end-of-org, target ${targetId as string}): ${def.name} (${handCard.instanceId as string})`);
            actions.push({
              action: {
                type: 'play-short-event',
                player: playerId,
                cardInstanceId: handCard.instanceId,
                targetScoutInstanceId: targetId,
              },
              viable: true,
            });
            anyModeEmitted = true;
          }
        } else if (eoTarget && eligibility.eligibleTargets.length > 0 && eoTarget.target === 'company') {
          // Company target without tap cost: one action per eligible company.
          // eligibleTargets[i] is the first character of the i-th eligible company,
          // used here only to look up the company so we can emit targetCompanyId.
          // duplication-limit: scope "company" — "Cannot be duplicated on the
          // same company" (Fair Sailing tw-232). Mirrors the character-scope
          // check above: a short event attaches nothing, but its rest-of-turn
          // effect leaves a company-targeted active constraint marking the
          // source definition. Skip any company that already bears one.
          for (const repCharId of eligibility.eligibleTargets) {
            const company = findCharacterCompany(player.companies, repCharId);
            if (!company) continue;
            if (companyDupLimit) {
              const copiesOnCompany = state.activeConstraints.filter(
                c =>
                  constraintFromCard(state, c, def.id) &&
                  c.target.kind === 'company' &&
                  c.target.companyId === company.id,
              ).length;
              if (copiesOnCompany >= companyDupLimit.max) {
                logDetail(`${def.name}: cannot be duplicated on company ${company.id as string} (${copiesOnCompany} active constraint(s))`);
                continue;
              }
            }
            logDetail(`Resource short-event playable (end-of-org, company ${company.id as string}): ${def.name} (${handCard.instanceId as string})`);
            actions.push({
              action: {
                type: 'play-short-event',
                player: playerId,
                cardInstanceId: handCard.instanceId,
                targetCompanyId: company.id,
              },
              viable: true,
            });
            anyModeEmitted = true;
          }
        } else if (!eoTarget || (eoTarget.target !== 'character' && eoTarget.target !== 'company')) {
          logDetail(`Resource short-event playable (end-of-org): ${def.name} (${handCard.instanceId as string})`);
          actions.push({
            action: { type: 'play-short-event', player: playerId, cardInstanceId: handCard.instanceId },
            viable: true,
          });
          anyModeEmitted = true;
        }
      }
      if (!anyModeEmitted) {
        logDetail(`${def.name}: end-of-org card not eligible — ${lastReason}`);
        actions.push(notPlayable(playerId, handCard.instanceId, lastReason || `${def.name} has no valid target`));
      }
      continue;
    }

    // Skip short events whose effects are only usable during combat
    // (e.g. Concealment's cancel-attack). These require an active attack.
    // Supporting effects like play-target and set-character-status do not
    // confer non-combat playability on their own — they merely describe how
    // the combat effect is applied (e.g. Escape: pick a character, cancel the
    // attack, wound them via set-character-status{inverted}). A move
    // (discard-in-play) effect whose `when` gate IS currently met represents a
    // genuine non-combat mode and does allow the card to be played outside
    // combat (e.g. The Cock Crows' GoM discard mode). A play-option effect
    // with a met `when` also represents a non-combat mode (e.g. Many Turns
    // and Doublings' hazard-limit reduction).
    // play-condition is a gate on playing the card, never an independent
    // effect — a gated combat-only card (Eye Never Sleeping as-82: "Playable
    // if you are Sauron. Cancel one hazard creature attack.") stays
    // combat-only. deck-restriction is a deck-construction-only marker (e.g.
    // "excluded-from-deck") with no runtime effect, so it never confers
    // non-combat playability either.
    const combatSupportTypes = new Set([...combatOnlyTypes, 'modify-attack', 'play-target', 'set-character-status', 'play-condition', 'deck-restriction']);
    const hasEffects = def.effects && def.effects.length > 0;
    const hasCombatEffect = hasEffects && def.effects.some(
      e => e.type === 'cancel-attack' || e.type === 'modify-attack' || e.type === 'company-combat-boost',
    );
    const allCombatOnly = hasEffects && def.effects.every(e => {
      if (combatSupportTypes.has(e.type)) return true;
      if (e.type === 'duplication-limit' && (e as { scope?: string }).scope === 'attack') return true;
      // A turn/company/character-scoped duplication-limit is also a
      // companion when the card's primary effect is combat-only (mirrors
      // `heroResourceShortEventActions`'s any-scope handling).
      if (hasCombatEffect && e.type === 'duplication-limit') return true;
      if (e.type === 'move' && e.when && !matchesCondition(e.when, { inPlay: inPlayNames })) return true;
      // company-site-phase-do-nothing is a downside companion to a
      // cancel-attack effect (Fifteen Birds in Five Firtrees dm-129), not an
      // independent non-combat mode — mirrors `heroResourceShortEventActions`.
      if (hasCombatEffect && e.type === 'company-site-phase-do-nothing') return true;
      return false;
    });
    if (allCombatOnly) {
      logDetail(`${def.name}: combat-only short-event, not playable outside combat`);
      continue;
    }

    // Resource-side `call-council` (e.g. Sudden Call, le-235): the caller
    // must meet endgame conditions (CoE rule 10.2) and must not have already
    // called. Mirrors the equivalent gate in `heroResourceShortEventActions`
    // (long-event.ts) — this function is the organization/site-phase sibling
    // of that one and must apply the same restriction, or a Ringwraith/Balrog
    // player could end the game via Sudden Call without having exhausted
    // their play deck or met the marshalling-point threshold.
    const resourceCallCouncil = def.effects?.find(
      (e): e is import('../../index.js').CallCouncilEffect => e.type === 'call-council' && e.lastTurnFor === 'opponent',
    );
    if (resourceCallCouncil) {
      if (!canCallEndgameNow(player)) {
        logDetail(`${def.name}: caller has not met end-of-game conditions`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name}: end-of-game conditions not met`));
        continue;
      }
      if (player.freeCouncilCalled || state.lastTurnFor !== null) {
        logDetail(`${def.name}: endgame already called`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name}: endgame already called`));
        continue;
      }
      logDetail(`Resource short-event "${def.name}" playable — caller meets end-of-game conditions`);
      actions.push({
        action: { type: 'play-short-event', player: playerId, cardInstanceId: handCard.instanceId },
        viable: true,
      });
      continue;
    }

    // play-condition requires: "site-type" (e.g. Glamour of Surpassing Excellence:
    // requires Border-hold or Free-hold). Only meaningful during the site phase.
    const siteTypeCondition = findPlayConditionEffect(def, 'site-type');
    if (siteTypeCondition) {
      let activeSiteType: string | null = null;
      if (currentPhase === 'site') {
        const sitePhaseState = state.phaseState as { activeCompanyIndex: number };
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[sitePhaseState.activeCompanyIndex];
        if (company?.currentSite) {
          const siteDef = defById(state, company.currentSite.definitionId);
          if (siteDef && 'siteType' in siteDef) {
            activeSiteType = (siteDef as { siteType: string }).siteType;
          }
        }
      }
      if (!activeSiteType || !siteTypeCondition.siteTypes?.includes(activeSiteType)) {
        logDetail(`${def.name}: play-condition site-type requires [${siteTypeCondition.siteTypes?.join(', ') ?? '?'}], active site type: ${activeSiteType ?? 'none'}`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} can only be played at: ${(siteTypeCondition.siteTypes ?? []).map((t: string) => t.replace(/-/g, ' ')).join(' or ')}`));
        continue;
      }
    }

    // play-condition requires: "site-has-resource" — active site must have the
    // given item subtype in its playableResources array. Only meaningful during
    // the site phase (after a company is selected).
    const siteHasResourceCondition = findPlayConditionEffect(def, 'site-has-resource');
    if (siteHasResourceCondition && siteHasResourceCondition.subtype) {
      let siteHasResource = false;
      if (currentPhase === 'site') {
        const sitePhaseState = state.phaseState as { activeCompanyIndex: number };
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[sitePhaseState.activeCompanyIndex];
        if (company?.currentSite) {
          const siteDef = defById(state, company.currentSite.definitionId);
          if (siteDef && isSiteCard(siteDef)) {
            siteHasResource = (siteDef.playableResources ?? []).includes(
              siteHasResourceCondition.subtype as Parameters<typeof siteDef.playableResources.includes>[0],
            );
            // Records Unread (as-130) mode B: a `site-resource-unlocked`
            // constraint (e.g. Information at any Shadow-hold) makes the
            // category playable at matching site types even when the site
            // does not list it natively.
            if (!siteHasResource && isSiteResourceUnlocked(state, playerId, siteDef, siteHasResourceCondition.subtype)) {
              logDetail(`${def.name}: ${siteHasResourceCondition.subtype} unlocked at ${siteDef.siteType} via site-resource-unlocked constraint`);
              siteHasResource = true;
            }
          }
        }
      }
      if (!siteHasResource) {
        logDetail(`${def.name}: play-condition site-has-resource requires ${siteHasResourceCondition.subtype} to be playable at the active site`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires a site where ${siteHasResourceCondition.subtype} is playable`));
        continue;
      }
    }

    // play-flag: "untapped-site-required" — a short event playable during the
    // site phase (e.g. Far-sight tw-238: "an untapped sage at an untapped
    // site") requires the active company's current site to be untapped.
    // Mirrors the permanent-event check in legal-actions/site.ts.
    if (hasPlayFlag(def, 'untapped-site-required') && currentPhase === 'site') {
      const sitePhaseState = state.phaseState as { activeCompanyIndex: number };
      const activePlayer = activePlayerState(state);
      const company = activePlayer?.companies[sitePhaseState.activeCompanyIndex];
      const siteIsTapped = company?.currentSite?.status === CardStatus.Tapped;
      if (siteIsTapped) {
        logDetail(`${def.name}: requires untapped site, but active site is already tapped`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name}: site must be untapped`));
        continue;
      }
    }

    // play-condition requires: "company-has-item" — at least one character in the
    // active company must carry an item of the given subtype. Only meaningful
    // during the site phase.
    const companyHasItemCondition = findPlayConditionEffect(def, 'company-has-item');
    if (companyHasItemCondition && companyHasItemCondition.subtype) {
      let companyHasItem = false;
      if (currentPhase === 'site') {
        const sitePhaseState = state.phaseState as { activeCompanyIndex: number };
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[sitePhaseState.activeCompanyIndex];
        if (company) {
          companyHasItem = company.characters.some(charId => {
            const char = player.characters[charId];
            return char?.items.some(item => {
              const itemDef = defById(state, item.definitionId);
              return itemDef && 'subtype' in itemDef
                && (itemDef as { subtype?: string }).subtype === companyHasItemCondition.subtype;
            });
          });
        }
      }
      if (!companyHasItem) {
        logDetail(`${def.name}: play-condition company-has-item requires a ${companyHasItemCondition.subtype} in the active company`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires a character in the company to have a ${companyHasItemCondition.subtype}`));
        continue;
      }
    }

    // play-condition requires: "active-company" — a generic DSL condition
    // evaluated against the active site-phase company's aggregate context
    // ({ site, company: { itemNames, characterNames, allyNames } }). Used by
    // the CoE 10.39 win cards (Cracks of Doom, Gollum's Fate) to require The
    // One Ring (and Gollum) at Mount Doom. Only meaningful during the site
    // phase after a company is selected.
    const activeCompanyCondition = findPlayConditionEffect(def, 'active-company');
    if (activeCompanyCondition?.condition) {
      let met = false;
      if (currentPhase === 'site') {
        const sitePhaseState = state.phaseState as { activeCompanyIndex: number; step?: string };
        const activePlayer = activePlayerState(state);
        const company = activePlayer?.companies[sitePhaseState.activeCompanyIndex];
        if (company) {
          met = matchesCondition(activeCompanyCondition.condition, buildActiveCompanyContext(state, player, company));
        }
      }
      if (!met) {
        logDetail(`${def.name}: play-condition active-company not satisfied`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name}: play conditions not met`));
        continue;
      }
    }

    // play-condition requires: "player-state" — a generic DSL condition
    // evaluated against the active player's avatar/alignment context
    // ({ player: { alignment, hasRingwraithInPlay }, opponent: { alignment } }).
    // Used by Above the Abyss (as-77): "if your opponent is a Wizard and your
    // Ringwraith is in play".
    if (!playerStateGateMet(state, player, playerId, def)) {
      logDetail(`${def.name}: play-condition player-state not satisfied`);
      actions.push(notPlayable(playerId, handCard.instanceId, `${def.name}: play conditions not met`));
      continue;
    }

    // play-condition requires: "card-in-play" — a named card must be in play for
    // the playing player (any in-play zone, including character-attached
    // permanent events). Used by Terror Heralds Doom (ba-78): "Playable during
    // the organization phase if Flame of Udûn is in play."
    const cardInPlayCondition = findPlayConditionEffect(def, 'card-in-play');
    if (cardInPlayCondition?.cardName) {
      const requiredName = cardInPlayCondition.cardName;
      if (!isCardNameInPlayForPlayer(state, player, requiredName)) {
        logDetail(`${def.name}: play-condition card-in-play requires ${requiredName} in play`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires ${requiredName} in play`));
        continue;
      }
    }

    // Cards declaring `play-option` DSL effects (e.g. Halfling Strength):
    // enumerate (target, option) pairs, emitting one legal action per
    // combination whose option `when` matches the target's context.
    const playTarget = getPlayTargetEffect(def);
    const playOptions = getPlayOptionEffects(def);

    // The Ring Leaves Its Mark (le-223): a dual-mode short event. Mode 1 fetches
    // one named Ringwraith mode card (Black Rider / Fell Rider / Heralded Lord)
    // from the sideboard or discard pile into the play deck and reshuffles;
    // mode 2 is "playable on your tapped Ringwraith" — a self-enters-play
    // `roll-then-apply` makes a roll and, on success, untaps it. Emit both:
    // mode 1 is a no-target play action (offered only when a matching card is
    // in the sideboard/discard), mode 2 one action per eligible tapped revealed
    // avatar (carried as `targetCharacterId`). The reducer discriminates the two
    // by the presence of `targetCharacterId`.
    const rollUntapOnEnter = def.effects?.find(
      (e): e is import('../../types/effects.js').OnEventEffect =>
        e.type === 'on-event'
        && e.event === 'self-enters-play'
        && e.apply?.type === 'roll-then-apply',
    );
    if (playTarget && playTarget.target === 'character' && rollUntapOnEnter) {
      let anyMode = false;
      // Mode 1: fetch — offered when the sideboard or discard holds a match.
      const fetchMove = (def.effects ?? []).find(
        (e): e is import('../../types/effects.js').MoveEffect =>
          e.type === 'move' && !!moveToFetchToDeckPayload(e),
      );
      if (fetchMove) {
        const fetchFilter = fetchMove.filter;
        const pileHasMatch = [...player.sideboard, ...player.discardPile].some(c => {
          const cd = defById(state, c.definitionId);
          return cd ? (fetchFilter ? matchesDefinition(cd, fetchFilter) : true) : false;
        });
        if (pileHasMatch) {
          logDetail(`Resource short-event playable (mode 1 fetch-to-deck): ${def.name}`);
          actions.push({
            action: { type: 'play-short-event', player: playerId, cardInstanceId: handCard.instanceId },
            viable: true,
          });
          anyMode = true;
        }
      }
      // Mode 2: roll to untap the player's own tapped revealed Ringwraith avatar.
      for (const targetId of eligiblePlayOptionTargets(state, player, playTarget)) {
        logDetail(`Resource short-event playable (mode 2 roll-to-untap, target ${String(targetId)}): ${def.name}`);
        actions.push({
          action: {
            type: 'play-short-event',
            player: playerId,
            cardInstanceId: handCard.instanceId,
            targetCharacterId: targetId,
          },
          viable: true,
        });
        anyMode = true;
      }
      if (!anyMode) {
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name}: no Black Rider, Fell Rider, or Heralded Lord to retrieve and no tapped Ringwraith to untap`));
      }
      continue;
    }

    if (playOptions.length > 0 && playTarget) {
      const optionActions = playOptionActionsForCard(
        state, player, playerId, handCard.instanceId, def, playTarget, playOptions, currentPhase,
      );
      if (optionActions.length === 0) {
        logDetail(`${def.name}: no eligible ${playTarget.target} targets — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `No eligible ${playTarget.target} to target`));
      } else {
        actions.push(...optionActions);
      }
      continue;
    }

    // A dual-mode "tap your avatar to fetch resources from your sideboard"
    // mode (Ancient Secrets ba-36 mode 2): a second `move` fetching up to N
    // resources sideboard → play deck. Only available during the organization
    // phase (per the card text) and only when at least one sideboard card
    // matches the fetch filter. Modelled as an alternative to the discard-in-
    // play mode below, discriminated at the reducer by the presence of a
    // `discardTargetInstanceId` on the play action (mode 1) vs its absence
    // (mode 2, which enqueues the fetch sub-flow).
    const sideboardFetch = findMoveEffectByShape(def, 'target', 'sideboard', 'deck');
    const sideboardModeAvailable = !!sideboardFetch
      && currentPhase === 'organization'
      && player.sideboard.some(c => {
        const cd = defById(state, c.definitionId);
        if (!cd) return false;
        return sideboardFetch.filter ? matchesDefinition(cd, sideboardFetch.filter) : true;
      });

    // Collect eligible discard-in-play targets (e.g. Marvels Told forces
    // discard of a hazard non-environment permanent/long event). If the
    // card has a discard-in-play move effect but no valid targets exist,
    // it cannot be played — UNLESS an alternative sideboard-fetch mode is
    // available (ba-36), in which case the card is still playable (mode 2
    // only) and simply offers no discard actions. A `when` gate on the effect
    // is also evaluated (e.g. The Cock Crows requires Gates of Morning in play).
    const discardInPlay = findMoveEffectByShape(def, 'target', 'in-play', 'discard');
    const discardWhenMet = !discardInPlay?.when
      || matchesCondition(discardInPlay.when, { inPlay: inPlayNames });
    let discardTargetIds: CardInstanceId[] | null = null;
    if (discardWhenMet && discardInPlay && discardInPlay.filter) {
      discardTargetIds = collectDiscardInPlayTargets(state, discardInPlay.filter, playerId);
      if (discardTargetIds.length === 0 && !sideboardModeAvailable) {
        logDetail(`${def.name}: no eligible discard-in-play target — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} has no valid target to discard`));
        continue;
      }
    }

    // duplication-limit: scope "turn" — cannot play if a copy was already
    // played this turn (tracked via active constraints sourced from this def).
    const turnDupLimit = findDuplicationLimitEffect(def, 'turn');
    if (turnDupLimit) {
      const priorConstraints = countConstraintsFromDefinition(state, def.id);
      if (priorConstraints >= turnDupLimit.max) {
        logDetail(`${def.name}: cannot be duplicated this turn (${priorConstraints} active constraint(s))`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} cannot be duplicated on a given turn`));
        continue;
      }
    }

    // Detect enqueue-ring-play-offer / enqueue-gold-ring-test applies: both
    // require per-(sage × gold ring) emission so the player picks the sage's
    // company AND which gold ring to test/replace via targetGoldRingInstanceId.
    const selfEntersApplyType = (e: { type: string }): string | undefined =>
      e.type === 'on-event'
        && (e as { event?: string }).event === 'self-enters-play'
        ? (e as { apply?: { type?: string } }).apply?.type
        : undefined;
    const hasRingPlayOffer = def.effects?.some(e => selfEntersApplyType(e) === 'enqueue-ring-play-offer') ?? false;
    const hasGoldRingTest = def.effects?.some(e => selfEntersApplyType(e) === 'enqueue-gold-ring-test') ?? false;
    const crossesGoldRing = hasRingPlayOffer || hasGoldRingTest;

    // Emit one play action per eligible target combination. When the card
    // has a play-target with tap cost AND discard-in-play, emit the cross-
    // product of (tap target × discard target). When the card has
    // enqueue-ring-play-offer, also cross with gold rings in the sage's company.
    // `playTargetId` names the play-target character when the card's target
    // carries no tap cost (the tap-cost case travels as `targetScoutInstanceId`).
    // The ring-test cards need it: Wizard's Test (tw-365) pairs the test with
    // "Wizard makes a corruption check modified by -1", and the check is made by
    // the play-target — the reducer reads it from `targetCharacterId`.
    const emitPlay = (
      tapTargetId: CardInstanceId | undefined,
      goldRingId?: CardInstanceId,
      playTargetId?: CardInstanceId,
    ) => {
      if (discardTargetIds) {
        for (const discardId of discardTargetIds) {
          logDetail(`Resource short-event playable (target ${String(tapTargetId)}, discard ${String(discardId)}): ${def.name}`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              ...(tapTargetId ? { targetScoutInstanceId: tapTargetId } : {}),
              discardTargetInstanceId: discardId,
            },
            viable: true,
          });
        }
      } else {
        logDetail(`Resource short-event playable${tapTargetId ? ` (target ${String(tapTargetId)})` : ''}${playTargetId ? ` (target ${String(playTargetId)})` : ''}${goldRingId ? ` (ring ${String(goldRingId)})` : ''}: ${def.name}`);
        actions.push({
          action: {
            type: 'play-short-event',
            player: playerId,
            cardInstanceId: handCard.instanceId,
            ...(tapTargetId ? { targetScoutInstanceId: tapTargetId } : {}),
            ...(playTargetId ? { targetCharacterId: playTargetId } : {}),
            ...(goldRingId ? { targetGoldRingInstanceId: goldRingId } : {}),
          },
          viable: true,
        });
      }
    };

    if (playTarget && playTarget.target === 'character' && playTarget.requiresControlledShadowMagicUserAtSite) {
      // A Malady Without Healing (le-159): cross-player targets gated on the
      // acting player controlling a shadow-magic user at the target's site.
      const maladyTargets = eligibleMaladyTargets(state, player, playTarget);
      if (maladyTargets.length === 0) {
        logDetail(`${def.name}: no eligible target (non-Ringwraith/Wizard character co-located with a controlled shadow-magic user) — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `${def.name}: no valid target character at a site with a shadow-magic user you control`));
      } else {
        for (const targetId of maladyTargets) {
          logDetail(`Resource short-event playable (malady target ${String(targetId)}): ${def.name}`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              targetCharacterId: targetId,
            },
            viable: true,
          });
        }
      }
    } else if (playTarget && playTarget.cost?.tap === 'character') {
      const tapTargets = eligiblePlayOptionTargets(state, player, playTarget);
      if (tapTargets.length === 0) {
        logDetail(`${def.name}: no eligible targets — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `No eligible ${playTarget.target} to target`));
      } else if (playTarget.itemFilter) {
        // Use Palantír (tw-355): "enable him to use one Palantír he bears" —
        // cross each eligible sage with the item(s) on him matching
        // itemFilter, emitting targetItemInstanceId so the player picks
        // which one when he bears more than one.
        let anyOffered = false;
        for (const targetId of tapTargets) {
          const targetChar = player.characters[targetId];
          const itemIds = targetChar ? itemsMatchingFilter(state, targetChar.items, playTarget.itemFilter) : [];
          for (const itemId of itemIds) {
            logDetail(`Resource short-event playable (sage ${String(targetId)}, item ${String(itemId)}): ${def.name}`);
            actions.push({
              action: {
                type: 'play-short-event',
                player: playerId,
                cardInstanceId: handCard.instanceId,
                targetScoutInstanceId: targetId,
                targetItemInstanceId: itemId,
              },
              viable: true,
            });
            anyOffered = true;
          }
        }
        if (!anyOffered) {
          logDetail(`${def.name}: no eligible (sage × item) pair — not playable`);
          actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires a sage bearing a matching item`));
        }
      } else if (crossesGoldRing) {
        // Cross sage targets with gold rings in each sage's company.
        let anyOffered = false;
        for (const targetId of tapTargets) {
          const sageCompany = findCharacterCompany(player.companies, targetId);
          const goldRings: CardInstanceId[] = [];
          if (sageCompany) {
            for (const charId of sageCompany.characters) {
              const char = player.characters[charId];
              if (!char) continue;
              for (const item of char.items) {
                const itemDef = defById(state, item.definitionId);
                if (itemDef && 'subtype' in itemDef && (itemDef as { subtype?: string }).subtype === 'gold-ring') {
                  goldRings.push(item.instanceId);
                }
              }
            }
          }
          for (const ringId of goldRings) {
            emitPlay(targetId, ringId);
            anyOffered = true;
          }
        }
        if (!anyOffered) {
          logDetail(`${def.name}: no eligible (sage × gold ring) pair — not playable`);
          actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires a sage and a gold ring in the same company`));
        }
      } else {
        for (const targetId of tapTargets) emitPlay(targetId);
      }
      // Alternative sideboard-fetch mode (ba-36 mode 2): one action per tap
      // target, carrying no discard target. The reducer routes it to the fetch
      // sub-flow precisely because `discardTargetInstanceId` is absent.
      if (sideboardModeAvailable) {
        for (const targetId of tapTargets) {
          logDetail(`Resource short-event playable (sideboard-fetch, target ${String(targetId)}): ${def.name}`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              targetScoutInstanceId: targetId,
              optionId: 'sideboard-fetch',
            },
            viable: true,
          });
        }
      }
    } else if (playTarget && playTarget.target === 'character' && playTarget.filter) {
      // Filter-only character target (no tap cost): emit one action per eligible
      // character so the reducer knows which character to apply effects to.
      const filterTargets = eligiblePlayOptionTargets(state, player, playTarget);
      if (filterTargets.length === 0) {
        logDetail(`${def.name}: no eligible character targets — not playable`);
        actions.push(notPlayable(playerId, handCard.instanceId, `No eligible ${playTarget.target} to target`));
      } else if (crossesGoldRing) {
        // Test of Fire (le-239) / Wizard's Test (tw-365): a skill or race filter
        // with no tap cost. Cross each eligible target with the gold rings borne
        // by characters in that target's company; emit targetGoldRingInstanceId
        // so the reducer tests the chosen ring. This enforces "test a gold ring
        // in a sage's company" / "only if a character in his company has a gold
        // ring". A company may hold several eligible targets; emit each gold
        // ring once regardless of how many could authorize its test, naming the
        // first as the play-target (whose corruption check tw-365 needs).
        const offeredRings = new Set<CardInstanceId>();
        for (const sageId of filterTargets) {
          const sageCompany = findCharacterCompany(player.companies, sageId);
          if (!sageCompany) continue;
          for (const charId of sageCompany.characters) {
            const char = player.characters[charId];
            if (!char) continue;
            for (const item of char.items) {
              if (offeredRings.has(item.instanceId)) continue;
              const itemDef = defById(state, item.definitionId);
              if (itemDef && 'subtype' in itemDef && (itemDef as { subtype?: string }).subtype === 'gold-ring') {
                emitPlay(undefined, item.instanceId, sageId);
                offeredRings.add(item.instanceId);
              }
            }
          }
        }
        if (offeredRings.size === 0) {
          logDetail(`${def.name}: no eligible (sage × gold ring) pair — not playable`);
          actions.push(notPlayable(playerId, handCard.instanceId, `${def.name} requires a sage and a gold ring in the same company`));
        }
      } else {
        // duplication-limit: scope "character" — "Cannot be duplicated on a
        // given character." A short event does not attach, but its rest-of-turn
        // effect leaves a character-targeted active constraint (e.g. Words of
        // Menace and Deceit le-258's +5 direct-influence character-stat-modifier)
        // whose `sourceDefinitionId` marks the card. Skip any target that already
        // bears the limit's worth of such constraints from this definition.
        const charDupLimit = findDuplicationLimitEffect(def, 'character');
        for (const targetId of filterTargets) {
          if (charDupLimit) {
            const copiesOnChar = state.activeConstraints.filter(
              c =>
                constraintFromCard(state, c, def.id) &&
                c.target.kind === 'character' &&
                c.target.characterId === targetId,
            ).length;
            if (copiesOnChar >= charDupLimit.max) {
              logDetail(`${def.name}: cannot be duplicated on character ${String(targetId)} (${copiesOnChar} active constraint(s))`);
              continue;
            }
          }
          logDetail(`Resource short-event playable (filter-target ${String(targetId)}): ${def.name}`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              targetCharacterId: targetId,
            },
            viable: true,
          });
        }
      }
    } else {
      emitPlay(undefined);
    }
  }

  return actions;
}
