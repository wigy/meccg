/**
 * @module legal-actions/combat
 *
 * Legal actions during combat. Combat is a self-contained sub-state machine
 * that interrupts the enclosing phase. When `state.combat` is non-null,
 * combat actions take priority over normal phase actions.
 *
 * Combat proceeds through four sub-phases:
 * 1. assign-strikes: defending player assigns strikes to characters, then attacker assigns remaining
 * 2. choose-strike-order: defending player picks which unresolved strike resolves next
 * 3. resolve-strike: defending player resolves the chosen strike (tap-to-fight or stay untapped)
 * 4. body-check: attacking player rolls body check
 */

import type { GameState, PlayerId, EvaluatedAction, CombatState, CardInstanceId, CardDefinitionId } from '../../index.js';
import type { CancelAttackEffect, ConvertCreatureToAllyEffect, FlatteryCancelAttackEffect, GoodwillCancelAttackEffect, RiddlingAttemptEffect, StrikeModifierEffect, HalveStrikesEffect, ModifyAttackEffect, OnEventEffect, PlayWindowEffect, PlayTargetEffect, CompanyCombatBoostEffect, CombatTapCompanyBoostEffect, ProtectFromStrikeAssignmentEffect, AllyBodyCheckBoostEffect, JoinCombatForceStrikeEffect, CombatDiscardOpponentItemEffect, SiteStormDevastationEffect, FleeFromStrikeEffect, SacrificeOfFormEffect } from '../../types/effects.js';
import type { AllyInPlay, Company } from '../../types/state-cards.js';
import type { PlayerState } from '../../types/state-player.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { formatSignedNumber } from '../../format-helpers.js';
import { isCharacterCard, isSiteCard, isResourceEventCard, isAvatarCharacter, isItemCard, isFactionCard } from '../../types/cards.js';
import { CardStatus, SiteType, Alignment, Race, Skill } from '../../types/common.js';
import { isBalrogAvatarDef, companyContainsBalrogAvatar } from '../../state-utils.js';
import { logHeading, logDetail } from './log.js';
import { computeCombatProwess, computeStayUntappedPenalty, buildInPlayNames, buildFactionPlayableRegions } from '../recompute-derived.js';
import { resolveDef, enemyRaceContext } from '../effects/index.js';
import { canPayCost } from '../cost-evaluator.js';
import { heroResourceShortEventActions } from './long-event.js';
import { buildPlayOptionContext, buildPlayerStateContext, getPlayTargetEffect, grantedActionActivations } from './organization.js';
import { attackSourceCreatureInstanceId, findCharacterCompany, playerById, getCardEffects, companyById, defById, defNamesOf, itemKeywordsOf, isCovertCompany, findDuplicationLimitEffect, findPlayConditionEffect, inPlayNamesForPlayerDeep, isCardNameInPlayForPlayer, countCopiesInPlay, companyShadowMagicUsers } from '../reducer-utils.js';
import { countConstraintsFromDefinition } from '../pending.js';
import { allyEffectiveProwess } from '../ally-stats.js';
import { Phase } from '../../types/state-phases.js';
import { hazardLimitStatus } from '../hazard-limit.js';
import { cvccSides } from '../cvcc-sides.js';

/**
 * Find all allies in a company by iterating over each character's allies array.
 * Returns tuples of [allyInPlay, hostCharacterId] for combat targeting.
 */
export function findCompanyAllies(
  player: PlayerState,
  companyCharacters: readonly CardInstanceId[],
): Array<{ ally: AllyInPlay; hostCharId: CardInstanceId }> {
  const result: Array<{ ally: AllyInPlay; hostCharId: CardInstanceId }> = [];
  for (const charId of companyCharacters) {
    const charData = player.characters[charId];
    if (!charData) continue;
    for (const ally of charData.allies) {
      result.push({ ally, hostCharId: charId });
    }
  }
  return result;
}

/**
 * Check whether a given instance ID belongs to an ally in the defending company.
 * Returns the ally data if found, or undefined.
 */
export function findAllyInCompany(
  player: PlayerState,
  companyCharacters: readonly CardInstanceId[],
  allyInstanceId: CardInstanceId,
): { ally: AllyInPlay; hostCharId: CardInstanceId } | undefined {
  for (const charId of companyCharacters) {
    const charData = player.characters[charId];
    if (!charData) continue;
    for (const ally of charData.allies) {
      if (ally.instanceId === allyInstanceId) {
        return { ally, hostCharId: charId };
      }
    }
  }
  return undefined;
}

/**
 * Check whether a given instance ID belongs to an item attached to any
 * character in the defending company.
 * Returns the item and its host character instance ID if found, or undefined.
 */
export function findItemInCompany(
  player: PlayerState,
  companyCharacters: readonly CardInstanceId[],
  itemInstanceId: CardInstanceId,
): { item: import('../../types/state-cards.js').ItemInPlay; hostCharId: CardInstanceId } | undefined {
  for (const charId of companyCharacters) {
    const charData = player.characters[charId];
    if (!charData) continue;
    for (const item of charData.items) {
      if (item.instanceId === itemInstanceId) {
        return { item, hostCharId: charId };
      }
    }
  }
  return undefined;
}

/**
 * Returns true if an ally's `no-attack-site-keyed` flag protects it from
 * the current combat's attack. Automatic-attacks are always "at the site"
 * so the flag applies unconditionally for those. For creature attacks the
 * flag applies only when the creature's `keyedTo` includes a site-type that
 * matches the company's effective site (destination during M/H, current
 * during site phase).
 */
export function isAllyImmuneToSiteKeyedAttack(
  state: GameState,
  ally: AllyInPlay,
  combat: CombatState,
): boolean {
  const allyDef = defById(state, ally.definitionId);
  if (!hasPlayFlag(allyDef as { effects?: readonly import('../../types/effects.js').CardEffect[] } | undefined, 'no-attack-site-keyed')) return false;

  if (combat.attackSource.type === 'automatic-attack' || combat.attackSource.type === 'played-auto-attack') {
    logDetail(`Ally ${ally.instanceId as string} immune to auto-attack (no-attack-site-keyed flag)`);
    return true;
  }

  if (combat.attackSource.type === 'creature' || combat.attackSource.type === 'on-guard-creature') {
    if (!combat.attackSiteKeyingTypes || combat.attackSiteKeyingTypes.length === 0) return false;
    const defPlayer = playerById(state, combat.defendingPlayerId);
    const company = companyById(defPlayer?.companies ?? [], combat.companyId);
    if (!company) return false;
    const effectiveSite = company.destinationSite ?? company.currentSite;
    if (!effectiveSite) return false;
    const siteDef = defById(state, effectiveSite.definitionId);
    if (!isSiteCard(siteDef)) return false;
    const isKeyed = (combat.attackSiteKeyingTypes as readonly string[]).includes(siteDef.siteType);
    if (isKeyed) {
      logDetail(`Ally ${ally.instanceId as string} immune to site-keyed creature (no-attack-site-keyed flag, site type ${siteDef.siteType})`);
    }
    return isKeyed;
  }

  return false;
}

/**
 * Compute legal actions for the current combat sub-phase.
 * Only returns actions for the player whose turn it is to act.
 */
export function combatActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const combat = state.combat;
  if (!combat) return [];

  logHeading(`Combat actions (phase: ${combat.phase}, assignment: ${combat.assignmentPhase})`);

  // Cancel-attack, halve-strikes, protect-from-assignment, and modify-attack
  // actions are available to the defending player before any strikes have been
  // assigned (pre-assignment window). Hand-card modify-attack effects support
  // either side per the card's `player` declaration (e.g. hazard-side Dragon's
  // Desolation Mode A).
  const cancelActions = cancelAttackActions(state, playerId, combat);
  // Whip of Many Thongs (ba-82): CvCC-only tap-to-cancel-a-weapon, available to
  // the Balrog's controller throughout the combat's action windows.
  const cancelWeaponActs = cancelWeaponActions(state, playerId, combat);
  // Scourge of Fire (ba-75): CvCC resource short-event that discards an item
  // from the opposing company, available to the Balrog's controller throughout
  // the combat's action windows (same windows as the Whip's cancel-weapon).
  const discardOppItemActs = combatDiscardOpponentItemActions(state, playerId, combat);
  // Crowned with Storm (ba-54): CvCC resource short-event that devastates
  // everyone at the site, available to the Balrog's controller throughout the
  // combat's action windows (same windows as the item-discard above).
  const stormAtSiteActs = siteStormAtSiteActions(state, playerId, combat);
  const convertActions = convertCreatureToAllyActions(state, playerId, combat);
  const halveActions = halveStrikesActions(state, playerId, combat);
  const protectActions = protectFromStrikeAssignmentActions(state, playerId, combat);
  const modifyActions = modifyAttackActions(state, playerId, combat);
  const companyCombatBoosts = companyCombatBoostActions(state, playerId, combat);
  const joinForceStrikes = joinCombatForceStrikeActions(state, playerId, combat);
  // Tap-ally combat boosts (e.g. Great Lord of Goblin-gate) are available to
  // the ally's owner during the assign-strikes and resolve-strike windows.
  const allyCombatBoosts = tapAllyCombatBoostActions(state, playerId, combat);
  // CoE rule 3.i (Pre-Assignment Actions): "prior to strikes being assigned",
  // the resource player may take any resource/character action that would
  // otherwise be legal during the current phase — not just the dedicated
  // cancel/modify-attack DSL types above. This covers general resource
  // short-events with no combat-specific effect type, e.g. Voices of Malice
  // (le-250) discarding a hazard long-event that is boosting the attack's
  // strikes/prowess (Wake of War tw-108): once discarded before assignment,
  // the boost no longer applies when strikesTotal/strikeProwess are computed.
  // Gated to `strikeAssignments.length === 0` because CoE 3.ii/3.iii close
  // the window the instant assignment starts ("actions cannot be taken
  // during this step"); the equivalent window between strike sequences
  // (rule 3.iv) is offered separately in `chooseStrikeOrderActions`.
  const preAssignmentResourceEvents = playerId === state.activePlayer && combat.strikeAssignments.length === 0
    ? heroResourceShortEventActions(state, playerId, state.phaseState.phase as string)
    : [];
  // Rule 2.1.1 / 3.i: the resource player may also activate any-phase
  // grant-actions during the pre-assignment window — most relevantly Cram's
  // discard-to-untap-bearer, letting a tapped character shed its tapped
  // status so it can be assigned a strike instead of only tapped/wounded
  // characters remaining eligible for the opponent's leftover assignments.
  // `combatActions` is a self-contained dispatcher (see module doc), so
  // without this the any-phase grant is unreachable during assign-strikes,
  // same gap fixed for `resolveStrikeActions` below.
  const preAssignmentGrantedActions = playerId === state.activePlayer && combat.strikeAssignments.length === 0
    ? grantedActionActivations(state, playerId, 'anyPhase')
    : [];

  switch (combat.phase) {
    case 'assign-strikes':
      if (combat.assignmentPhase === 'cancel-by-tap') {
        return cancelByTapActions(state, playerId, combat);
      }
      // Cancel-window: defender's pre-assignment window to cancel the attack
      // before the attacker assigns strikes (attacker-chooses-defenders).
      // Only the defending player may act: cancel-attack, halve-strikes,
      // protect-from-assignment, modify-attack, haven-join (e.g. Alatar), or pass.
      if (combat.assignmentPhase === 'cancel-window') {
        if (playerId !== combat.defendingPlayerId) return [];
        return [
          ...cancelActions,
          ...cancelWeaponActs,
          ...discardOppItemActs,
          ...stormAtSiteActs,
          ...convertActions,
          ...halveActions,
          ...protectActions,
          ...modifyActions,
          ...companyCombatBoosts,
          ...joinForceStrikes,
          ...allyCombatBoosts,
          ...havenJoinAttackActions(state, playerId, combat),
          ...preAssignmentResourceEvents,
          ...preAssignmentGrantedActions,
          { action: { type: 'pass' as const, player: playerId }, viable: true },
        ];
      }
      // CoE rule 3.i / 8.02 (Pre-Assignment Actions): while the attacker holds
      // a live pre-assignment modify-attack option (e.g. an unrevealed
      // on-guard Unabated in Malice ba-26 on an automatic-attack) and hasn't
      // yet passed, they hold an exclusive priority window — the defender may
      // not begin strike assignment yet. Mirrors the attackerStep1Done gate
      // used later in resolve-strike (rule 3.iv.1). CvCC has its own
      // strike-sequence rules with no pre-assignment hazard window (rule 8.42),
      // so it is excluded.
      if (combat.assignmentPhase === 'defender' && !combat.isCvCC && !combat.attackerPreAssignDone) {
        const attackerModifyOptions = modifyAttackActions(state, combat.attackingPlayerId, combat);
        if (attackerModifyOptions.length > 0) {
          const preAssignActions = [...cancelActions, ...cancelWeaponActs, ...discardOppItemActs, ...stormAtSiteActs, ...convertActions, ...halveActions, ...protectActions, ...modifyActions, ...companyCombatBoosts, ...joinForceStrikes, ...allyCombatBoosts];
          if (playerId === combat.attackingPlayerId) {
            logDetail(`Pre-assignment window: attacker has ${attackerModifyOptions.length} modify-attack option(s) — defender waits`);
            return [...preAssignActions, { action: { type: 'pass' as const, player: playerId }, viable: true }];
          }
          logDetail('Pre-assignment window: defender waits for attacker to reveal or decline a modify-attack option');
          return preAssignActions;
        }
      }
      return [...cancelActions, ...cancelWeaponActs, ...discardOppItemActs, ...stormAtSiteActs, ...convertActions, ...halveActions, ...protectActions, ...modifyActions, ...companyCombatBoosts, ...joinForceStrikes, ...allyCombatBoosts, ...preAssignmentResourceEvents, ...preAssignmentGrantedActions, ...assignStrikeActions(state, playerId, combat)];
    case 'choose-strike-order':
      // Each-character auto-attacks pre-assign strikes and open here, skipping
      // the `assign-strikes` cancel window. cancelActions is gated to the
      // pre-resolution window (see inCancelWindow), so it is empty for normal
      // multi-strike attacks that reach choose-strike-order after assignment.
      return [...cancelActions, ...chooseStrikeOrderActions(state, playerId, combat), ...sacrificeOfFormActions(state, playerId, combat)];
    case 'resolve-strike': {
      // CvCC resolve-strike: two-step sub-phase — attacker declares -3 first,
      // then defender resolves. No hazard window (rule 8.42: no hazards in CvCC).
      if (combat.isCvCC) {
        return [...cvccResolveStrikeActions(state, playerId, combat), ...cancelWeaponActs, ...discardOppItemActs, ...stormAtSiteActs, ...allyCombatBoosts];
      }

      // Rule 3.iv.6.1: for agent attacks the attacker must roll first before
      // the defender can resolve. Gate the entire resolve window behind the roll.
      if (combat.attackSource.type === 'agent' && combat.agentRollTotal === undefined) {
        if (playerId === combat.attackingPlayerId) {
          logDetail('Agent combat: attacker must roll for agent before defender can resolve');
          return [{ action: { type: 'agent-strike-roll' as const, player: playerId }, viable: true }];
        }
        logDetail('Agent combat: defender waits for attacker to roll for agent');
        return [];
      }

      // CoE rule 3.iv.1 — Strike Sequence, Step 1 (Attacking Player Actions).
      // While the attacker has any playable combat hazards and has not yet
      // passed on this strike sequence, they hold an exclusive priority
      // window: the defender may not resolve the strike until the attacker
      // passes. Without this gate the defender could resolve immediately,
      // burning the attacker's chance to play cards like Dragon's Curse.
      const hazardPlays = combatHazardPermanentPlays(state, playerId, combat);
      const leftBehindPlays = leftBehindActions(state, playerId, combat);
      const attackOptions = attackerAttackOptionActions(state, playerId, combat);
      if (!combat.attackerStep1Done) {
        const attackerWindowCount = combatHazardPermanentPlays(
          state,
          combat.attackingPlayerId,
          combat,
        ).length
          + leftBehindActions(state, combat.attackingPlayerId, combat).length
          + attackerAttackOptionActions(state, combat.attackingPlayerId, combat).length;
        if (attackerWindowCount > 0) {
          if (playerId === combat.attackingPlayerId) {
            logDetail(`Strike sequence Step 1: attacker has ${attackerWindowCount} action(s) to declare — defender waits`);
            return [
              ...hazardPlays,
              ...leftBehindPlays,
              ...attackOptions,
              { action: { type: 'pass' as const, player: playerId }, viable: true },
            ];
          }
          logDetail('Strike sequence Step 1: defender waits for attacker to pass');
          return [];
        }
      }
      return [
        // Single-character each-character auto-attacks open directly here with
        // no prior cancel window; cancelActions is gated to the pre-resolution
        // window so it stays empty for ordinary resolve-strike sequences.
        ...cancelActions,
        ...resolveStrikeActions(state, playerId, combat),
        ...fleeFromStrikeActions(state, playerId, combat),
        ...sacrificeOfFormActions(state, playerId, combat),
        ...hazardPlays,
        ...leftBehindPlays,
        ...attackOptions,
        ...allyCombatBoosts,
      ];
    }
    case 'trophy-offer':
      return trophyOfferActions(state, playerId, combat);
    case 'body-check':
      return [...bodyCheckActions(state, playerId, combat), ...tapAllyBodyCheckBoostActions(state, playerId, combat)];
    case 'shield-discard-roll':
      return shieldDiscardRollActions(state, playerId, combat);
    case 'item-salvage':
      return itemSalvageActions(state, playerId, combat);
    case 'discard-item-from-company':
      return discardItemFromCompanyActions(state, playerId, combat);
    default:
      return [];
  }
}

/**
 * Legal actions during the `trophy-offer` combat phase (MELE §8.37 / CoE
 * 3.IV.1). After a non-detainment creature defeat, the *defending* player may
 * assign the defeated creature (now in their kill pile) as a trophy to any
 * eligible Orc/Troll character that faced one of its strikes, or pass to
 * decline all trophies ("may take" — the offer is optional).
 *
 * Only the defending player acts here; the attacking player has no actions
 * during the trophy offer. Without this handler the combat sub-state machine
 * would produce no legal actions in `trophy-offer` and the game would stall
 * with "no valid actions".
 */
function trophyOfferActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];

  // The defeated creature instance — mirrors the derivation in finalizeCombat
  // so the take-trophy handler can locate it in the defender's kill pile.
  const creatureInstanceId = attackSourceCreatureInstanceId(combat);

  const eligible = combat.trophyEligibleCharacters ?? [];
  if (!creatureInstanceId || eligible.length === 0) {
    // No creature or no eligible character: defender may only decline so the
    // combat can finalize.
    logDetail('Trophy offer: nothing to assign — defender may only pass');
    return [{ action: { type: 'pass' as const, player: playerId }, viable: true }];
  }

  const actions: EvaluatedAction[] = [];
  for (const characterId of eligible) {
    logDetail(`Trophy offer: ${characterId as string} may take ${creatureInstanceId as string} as a trophy (MELE §8.37)`);
    actions.push({
      action: { type: 'take-trophy' as const, player: playerId, characterId, creatureInstanceId },
      viable: true,
    });
  }
  // Defender may decline all trophies (CoE 3.IV.1 — "may take").
  logDetail('Trophy offer: defender may also pass to decline all trophies');
  actions.push({ action: { type: 'pass' as const, player: playerId }, viable: true });
  return actions;
}

/**
 * One `haven-join-attack` action per pending haven-jump offer.
 *
 * Offers are raised in `initiateCreatureCombat` when any character of the
 * defending player sits at a haven and declares
 * `on-event: creature-attack-begins` + `apply: offer-char-join-attack`.
 * The action is legal during the assign-strikes cancel-window for the
 * defending player only (the owner of the offers).
 */
function havenJoinAttackActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  const offers = combat.havenJumpOffers;
  if (!offers || offers.length === 0) return [];
  if (playerId !== combat.defendingPlayerId) return [];
  const actions: EvaluatedAction[] = [];
  for (const offer of offers) {
    if (offer.bearerPlayerId !== playerId) continue;
    const player = playerById(state, playerId);
    const charInPlay = player?.characters[offer.characterId];
    if (!charInPlay) continue;
    // The offer names the companies it moves the joiner between, and the
    // reducer refuses when either has gone. An offer outlives the attack that
    // created it, and a company can dissolve in between — the origin empties
    // when its last character is taken — so the character still being in play
    // is not enough. Mirror the reducer's own condition rather than a proxy
    // for it, as `splitCompanyActions` and `moveToCompanyActions` do; offering
    // this aborted one of 100 games in a gate run (seed 28).
    if (!companyById(player.companies, offer.originCompanyId)
      || !companyById(player.companies, offer.targetCompanyId)) {
      logDetail(`  → skip: haven-join for ${offer.characterId as string} — a company named by the offer is gone`);
      continue;
    }
    logDetail(`Defender may accept haven-join for ${offer.characterId as string}`);
    actions.push({
      action: { type: 'haven-join-attack', player: playerId, characterId: offer.characterId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Actions during the assign-strikes sub-phase.
 *
 * The defending player assigns strikes to untapped characters first.
 * When they pass, the attacking player assigns remaining strikes to
 * any unassigned characters.
 */
function assignStrikeActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];

  if (combat.assignmentPhase === 'defender' && playerId === combat.defendingPlayerId) {
    // Find characters in the defending company
    const player = playerById(state, playerId);
    if (!player) return [];
    const rawCompany = companyById(player.companies, combat.companyId);
    if (!rawCompany) {
      // The defending company dissolved mid-combat — pass to fizzle the attack.
      logDetail('Defender assignment: defending company no longer exists — pass to fizzle the attack');
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });
      return actions;
    }
    // Burglary (td-103) failure: restrict assignment to the solo defender —
    // no other company member (nor an ally hosted by one) may face a strike.
    // An ally hosted by the solo defender himself is still reachable via
    // `findCompanyAllies`, since it counts as "what he himself can provide".
    const company = combat.soloDefenderInstanceId
      ? { ...rawCompany, characters: rawCompany.characters.filter(id => id === combat.soloDefenderInstanceId) }
      : rawCompany;

    const assignedCharIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));
    const strikesRemaining = combat.strikesTotal - combat.strikeAssignments.length;

    // A zero-strike attack (strike count reduced to nothing by an effect
    // before assignment began) leaves nothing to assign and nothing to
    // resolve — offer pass so the attack can fizzle via handleCombatPass.
    // Without this, neither player has a viable action and the game
    // deadlocks (heuristic self-play decks g/h, seed 2030024).
    if (combat.strikesTotal <= 0 && combat.strikeAssignments.length === 0) {
      logDetail('Defender assignment: attack has zero strikes — pass to fizzle the attack');
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });
      return actions;
    }

    if (strikesRemaining <= 0) return [];

    // CvCC defender phase: defender selects one of their untapped chars AND one
    // unpaired attacker → full pair immediately. No blind reservations.
    if (combat.isCvCC) {
      const atkSource = combat.attackSource;
      if (atkSource.type !== 'company-attack') return [];
      const atkPlayer = playerById(state, combat.attackingPlayerId);
      if (!atkPlayer) return [];
      const atkCompany = companyById(atkPlayer.companies, atkSource.attackingCompanyId);
      if (!atkCompany) return [];

      // Find unpaired attackers: attacker chars NOT already in strikeAssignments as attackingCharacterId
      const usedAttackerIds = new Set(
        combat.strikeAssignments
          .map(a => a.attackingCharacterId)
          .filter(Boolean)
          .map(id => id as string),
      );
      const unpairedAttackers = atkCompany.characters.filter(
        id => !usedAttackerIds.has(id as string),
      );

      if (unpairedAttackers.length === 0) {
        // All attackers already paired — pass only
        logDetail('CvCC defender phase: all attackers already paired, pass only');
        actions.push({ action: { type: 'pass', player: playerId }, viable: true });
        return actions;
      }

      // Collect eligible defenders: untapped, not yet assigned
      const cvccProtectedChars = new Set<string>(
        (combat.protectedFromStrikeAssignment ?? []).map(id => id as string),
      );

      const eligibleDefenders: CardInstanceId[] = [];
      for (const charId of company.characters) {
        if (assignedCharIds.has(charId as string)) continue;
        if (cvccProtectedChars.has(charId as string)) {
          logDetail(`CvCC defender phase: character ${charId as string} protected from assignment — skipping`);
          continue;
        }
        const charData = player.characters[charId];
        if (!charData) continue;
        if (charData.status !== CardStatus.Untapped) {
          logDetail(`CvCC defender phase: character ${charId as string} is ${charData.status} — not available`);
          continue;
        }
        eligibleDefenders.push(charId);
      }

      if (eligibleDefenders.length === 0) {
        logDetail('CvCC defender phase: no eligible defenders available, pass only');
        actions.push({ action: { type: 'pass', player: playerId }, viable: true });
        return actions;
      }

      // Generate one action per (untapped-unassigned-defender, unpaired-attacker) pair
      for (const defId of eligibleDefenders) {
        for (const atkId of unpairedAttackers) {
          logDetail(`CvCC defender phase: can pair defender ${defId as string} against attacker ${atkId as string}`);
          actions.push({
            action: {
              type: 'assign-strike',
              player: playerId,
              characterId: defId,
              attackingCharacterId: atkId,
            },
            viable: true,
          });
        }
      }

      // Defender may pass to hand over to attacker phase
      logDetail('CvCC defender phase: defender can pass');
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });

      return actions;
    }

    // "Each character faces one strike" (Wandering Eldar le-97, Watcher in the
    // Water le-99, …): every character in the company is assigned exactly one
    // strike, so there is nothing for either player to choose (CoE 3.ii.2).
    // The defender keeps their pre-assignment window (cancel/modify/protect
    // cards are still offered by `combatActions`) but the only assignment
    // action is `pass`, which assigns all strikes at once and skips the
    // attacker's assignment step (see `handleCombatPass`). If an effect has
    // reduced the attack below one strike per character (`halve-strikes`),
    // picking who faces them is a real choice again and the normal menu applies.
    if (combat.eachCharacterFacesOneStrike
      && combat.strikeAssignments.length === 0
      && combat.strikesTotal >= company.characters.length) {
      logDetail(`Each character faces one strike — assignment is automatic; defender may only close the pre-assignment window`);
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });
      return actions;
    }

    // Forced-strike targets (e.g. Alatar haven-join): each listed character
    // must receive a strike before any other assignment is legal. The filter
    // collapses the defender's legal menu to only the unassigned forced
    // targets while the list is non-empty.
    const unassignedForced = (combat.forcedStrikeTargets ?? [])
      .filter(id => !assignedCharIds.has(id as string));
    const restrictToForced = unassignedForced.length > 0;

    // strike-shield (Noble Hound dm-179): collect characters whose controlling
    // strike-shield ally has NOT yet been assigned a strike. Those characters
    // may not be assigned a strike while their ally is unassigned.
    const strikeShieldBlockedChars = new Set<string>();
    for (const charId of company.characters) {
      const charData = player.characters[charId];
      if (!charData) continue;
      for (const ally of charData.allies) {
        if (assignedCharIds.has(ally.instanceId as string)) continue;
        const allyDef = defById(state, ally.definitionId);
        const shieldEff = getCardEffects(allyDef).find(
          (e): e is import('../../types/effects.js').StrikeShieldEffect => e.type === 'strike-shield',
        );
        if (shieldEff) {
          logDetail(`strike-shield: ally ${ally.instanceId as string} not yet assigned — blocking strike on ${charId as string}`);
          strikeShieldBlockedChars.add(charId as string);
        }
      }
    }

    // protect-from-assignment (Ruse mode B): characters shielded by this
    // effect cannot be assigned any strike for the duration of this attack.
    const protectedChars = new Set<string>(
      (combat.protectedFromStrikeAssignment ?? []).map(id => id as string),
    );

    // Offer untapped characters that don't already have a strike
    for (const charId of company.characters) {
      if (assignedCharIds.has(charId as string)) continue;
      if (restrictToForced && !unassignedForced.includes(charId)) continue;
      const charData = player.characters[charId];
      if (!charData) continue;
      // A forced-strike target (e.g. The Balrog via Vanguard of Might ba-79)
      // must face a strike "regardless of any conflicting effects": its status
      // gate is bypassed so it can be assigned a strike even while tapped or
      // wounded. Alatar's haven-joiners are untapped, so this never changes them.
      const isForcedTarget = unassignedForced.includes(charId);
      if (strikeShieldBlockedChars.has(charId as string) && !isForcedTarget) {
        logDetail(`Character ${charId as string} shielded — must assign strike to ally first`);
        continue;
      }
      if (protectedChars.has(charId as string) && !isForcedTarget) {
        logDetail(`Character ${charId as string} protected from strike assignment (Ruse) — skipping`);
        continue;
      }
      // The solo defender (Burglary, td-103 failure) must face the attack
      // "regardless of any conflicting effects" — including his own tapped
      // status from making the burglary attempt itself.
      const isSoloDefender = combat.soloDefenderInstanceId === charId;
      if (charData.status !== CardStatus.Untapped && !isForcedTarget && !isSoloDefender) {
        logDetail(`Character ${charId as string} is ${charData.status} — not available for defender assignment`);
        continue;
      }
      // A forced-strike target overrides the avatar exclusion for the same
      // reason it overrides the status gate: the character must face a strike
      // "regardless of any conflicting effects", and the player opted into
      // that when joining the attack. Without this, Alatar's haven-join
      // (wh-1) into a Neeker-breekers attack (`excludeAvatarStrikes`) left the
      // forced target unassignable while `restrictToForced` blocked every
      // other character and forbade passing — zero legal actions for either
      // player (decks b/c, seed 424243).
      if (combat.excludeAvatarStrikes && !isForcedTarget) {
        const defId = charData.definitionId;
        const def = defId ? defById(state, defId) : undefined;
        if (isAvatarCharacter(def)) {
          logDetail(`Character ${charId as string} is an avatar — excluded from Neeker-breekers strike assignment`);
          continue;
        }
      }
      logDetail(`Defender can assign strike to ${charId as string} (untapped)${restrictToForced ? ' [forced target]' : ''}`);
      actions.push({
        action: { type: 'assign-strike', player: playerId, characterId: charId, tapped: false },
        viable: true,
      });
    }

    // Per CoE rule 2.V.2.2: Allies are treated as characters for combat purposes
    // (facing strikes, tapping in support, etc.). Offer untapped allies as strike targets.
    // Allies with `alwaysCountsAsUntapped` (e.g. Noble Hound) are offered even when
    // tapped or wounded — their status is irrelevant for assignability.
    // Skip entirely while a forced-strike target is still unassigned — the
    // forced target takes priority.
    if (!restrictToForced) {
      for (const { ally } of findCompanyAllies(player, company.characters)) {
        if (assignedCharIds.has(ally.instanceId as string)) continue;
        if (hasPlayFlag(state.cardPool[ally.definitionId] as { effects?: readonly import('../../types/effects.js').CardEffect[] } | undefined, 'no-attack')) {
          logDetail(`Ally ${ally.instanceId as string} may not be attacked — excluded from defender strike assignment`);
          continue;
        }
        if (isAllyImmuneToSiteKeyedAttack(state, ally, combat)) {
          logDetail(`Ally ${ally.instanceId as string} immune to this attack — excluded from defender strike assignment`);
          continue;
        }
        // Noble Hound (strike-shield + `alwaysCountsAsUntapped`) and Great Troll
        // (`assign-strike-when-tapped`) remain legal strike targets even while
        // tapped or wounded — their status is treated as untapped for
        // assignability only.
        const allyDef = defById(state, ally.definitionId);
        const alwaysUntapped = getCardEffects(allyDef).some(
          e => (e.type === 'strike-shield' && (e as { alwaysCountsAsUntapped?: boolean }).alwaysCountsAsUntapped)
            || e.type === 'assign-strike-when-tapped',
        );
        if (!alwaysUntapped && ally.status !== CardStatus.Untapped) {
          logDetail(`Ally ${ally.instanceId as string} is ${ally.status} — not available for defender assignment`);
          continue;
        }
        logDetail(`Defender can assign strike to ally ${ally.instanceId as string}${alwaysUntapped ? ' (alwaysCountsAsUntapped)' : ''}`);
        actions.push({
          action: { type: 'assign-strike', player: playerId, characterId: ally.instanceId, tapped: false },
          viable: true,
        });
      }
    }

    // face-strike-on-tap (Bow of Alatar wh-90): a bearer in the defending
    // company may tap such an item to face one of the attack's strikes even
    // while tapped/wounded and beyond the attack's normal capabilities. Offered
    // only when an unassigned strike remains, the bearer is not already facing a
    // strike, and no forced-strike target is pending.
    if (!restrictToForced && strikesRemaining > 0) {
      for (const charId of company.characters) {
        if (assignedCharIds.has(charId as string)) continue;
        const charData = player.characters[charId];
        if (!charData) continue;
        for (const item of charData.items) {
          if (item.status !== CardStatus.Untapped) continue;
          const itemDef = defById(state, item.definitionId);
          const hasFaceStrike = getCardEffects(itemDef).some(e => e.type === 'face-strike-on-tap');
          if (!hasFaceStrike) continue;
          logDetail(`Defender may tap ${item.instanceId as string} to have ${charId as string} face a strike (Bow of Alatar)`);
          actions.push({
            action: {
              type: 'face-strike-on-tap',
              player: playerId,
              cardInstanceId: item.instanceId,
              characterInstanceId: charId,
            },
            viable: true,
          });
        }
      }
    }

    // Defender may pass only when no forced-strike target is still unassigned
    // — unless the forced target turned out to be unassignable, in which case
    // withholding pass would leave no legal action at all. Every branch must
    // always offer something the reducer accepts.
    if (!restrictToForced) {
      logDetail(`Defender can pass (${strikesRemaining} strike(s) remaining)`);
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });
    } else if (actions.length === 0) {
      logDetail('Defender cannot assign the forced-strike target and has no other option — offering pass');
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });
    } else {
      logDetail(`Defender cannot pass: forced-strike target(s) still unassigned`);
    }

    return actions;
  }

  if (combat.assignmentPhase === 'attacker' && playerId === combat.attackingPlayerId) {
    // CvCC attacker phase: attacker pairs each of their untapped characters with a defending character
    if (combat.isCvCC) {
      return cvccAttackerAssignActions(state, playerId, combat, actions);
    }

    // Creature combat: attacker assigns remaining strikes to unassigned characters or as excess
    const defPlayer = playerById(state, combat.defendingPlayerId);
    if (!defPlayer) return [];
    const rawCompany = companyById(defPlayer.companies, combat.companyId);
    if (!rawCompany) {
      // The defending company dissolved mid-combat — nothing to strike.
      // Offer pass so the attack can fizzle (see handleCombatPass).
      logDetail('Attacker assignment: defending company no longer exists — pass to fizzle the attack');
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });
      return actions;
    }
    // Burglary (td-103) failure: restrict assignment to the solo defender (see
    // the defender-phase branch above for the full rationale).
    const company = combat.soloDefenderInstanceId
      ? { ...rawCompany, characters: rawCompany.characters.filter(id => id === combat.soloDefenderInstanceId) }
      : rawCompany;

    const assignedCharIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));
    const totalAllocated = combat.strikeAssignments.length
      + combat.strikeAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
    const strikesRemaining = combat.strikesTotal - totalAllocated;

    if (strikesRemaining <= 0) return [];

    // protect-from-assignment (Ruse mode B): collect IDs shielded from assignment.
    const attackerProtectedChars = new Set<string>(
      (combat.protectedFromStrikeAssignment ?? []).map(id => id as string),
    );

    // Forced-strike targets bypass the strike-shield block below, same as the
    // defender-phase branch — a forced target must face a strike "regardless
    // of any conflicting effects".
    const forcedTargetIds = new Set<string>(
      (combat.forcedStrikeTargets ?? []).map(id => id as string),
    );

    // strike-shield (Noble Hound dm-179): a character whose controlling
    // strike-shield ally has NOT yet been assigned a strike may not be
    // assigned one itself. This mirrors the defender-phase check above —
    // without it, automatic-attacks and other attacker-assigned combats
    // (assignmentPhase 'attacker') could strike a shielded character before
    // its ally, since only the defender phase enforced the shield.
    const strikeShieldBlockedChars = new Set<string>();
    for (const charId of company.characters) {
      const charData = defPlayer.characters[charId];
      if (!charData) continue;
      for (const ally of charData.allies) {
        if (assignedCharIds.has(ally.instanceId as string)) continue;
        const allyDef = defById(state, ally.definitionId);
        const shieldEff = getCardEffects(allyDef).find(
          (e): e is import('../../types/effects.js').StrikeShieldEffect => e.type === 'strike-shield',
        );
        if (shieldEff) {
          logDetail(`strike-shield: ally ${ally.instanceId as string} not yet assigned — blocking strike on ${charId as string}`);
          strikeShieldBlockedChars.add(charId as string);
        }
      }
    }

    // Collect all combatants: characters + allies (CoE rule 2.V.2.2)
    const allCombatantIds: Array<{ id: CardInstanceId; tapped: boolean }> = [];
    for (const charId of company.characters) {
      if (attackerProtectedChars.has(charId as string)) {
        logDetail(`Character ${charId as string} protected from strike assignment — excluded from attacker pool`);
        continue;
      }
      if (strikeShieldBlockedChars.has(charId as string) && !forcedTargetIds.has(charId as string)) {
        logDetail(`Character ${charId as string} shielded — must assign strike to ally first — excluded from attacker pool`);
        continue;
      }
      if (combat.excludeAvatarStrikes) {
        const charData = defPlayer.characters[charId];
        const def = charData?.definitionId ? defById(state, charData.definitionId) : undefined;
        if (isAvatarCharacter(def)) {
          logDetail(`Character ${charId as string} is an avatar — excluded from attacker assignment pool`);
          continue;
        }
      }
      const charData = defPlayer.characters[charId];
      allCombatantIds.push({ id: charId, tapped: charData?.status !== CardStatus.Untapped });
    }
    for (const { ally } of findCompanyAllies(defPlayer, company.characters)) {
      if (hasPlayFlag(state.cardPool[ally.definitionId] as { effects?: readonly import('../../types/effects.js').CardEffect[] } | undefined, 'no-attack')) {
        logDetail(`Ally ${ally.instanceId as string} may not be attacked — excluded from attacker assignment pool`);
        continue;
      }
      if (isAllyImmuneToSiteKeyedAttack(state, ally, combat)) {
        logDetail(`Ally ${ally.instanceId as string} immune to this attack — excluded from attacker assignment pool`);
        continue;
      }
      allCombatantIds.push({ id: ally.instanceId, tapped: ally.status !== CardStatus.Untapped });
    }

    if (allCombatantIds.length === 0 && combat.strikeAssignments.length === 0) {
      // Company still exists but no combatant can be struck (all eliminated
      // or excluded) — offer pass so the attack can fizzle.
      logDetail('Attacker assignment: no assignable combatants remain — pass to fizzle the attack');
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });
      return actions;
    }

    const unassigned = allCombatantIds.filter(c => !assignedCharIds.has(c.id as string));

    // Forced-strike targets (e.g. Alatar haven-join): even when the attacker
    // chooses defenders (Assassin tw-8's combat-attacker-chooses-defenders),
    // each listed character must receive a strike before any other
    // assignment is legal. Mirrors the defender-phase restriction above —
    // without it, an attacker-chooses creature can strike past a forced
    // target entirely.
    const unassignedForced = (combat.forcedStrikeTargets ?? [])
      .filter(id => !assignedCharIds.has(id as string));
    const forcedUnassigned = unassignedForced.length > 0
      ? unassigned.filter(c => unassignedForced.includes(c.id))
      : unassigned;
    const restrictedUnassigned = forcedUnassigned.length > 0 ? forcedUnassigned : unassigned;

    if (restrictedUnassigned.length > 0) {
      // Still unassigned combatants — must assign to them first
      for (const { id, tapped } of restrictedUnassigned) {
        logDetail(`Attacker can assign strike to unassigned ${id as string} (${tapped ? 'tapped' : 'untapped'})`);
        actions.push({
          action: { type: 'assign-strike', player: playerId, characterId: id, tapped },
          viable: true,
        });
      }
    } else {
      // All combatants have a strike — distribute excess as -1 prowess
      for (const { id, tapped } of allCombatantIds) {
        logDetail(`Attacker can assign excess strike to ${id as string} (${tapped ? 'tapped' : 'untapped'})`);
        actions.push({
          action: { type: 'assign-strike', player: playerId, characterId: id, excess: true, tapped },
          viable: true,
        });
      }
    }

    return actions;
  }

  // CvCC defender-any phase: defender assigns remaining unpaired attackers to any of their characters
  if (combat.assignmentPhase === 'defender-any' && combat.isCvCC && playerId === combat.defendingPlayerId) {
    return cvccDefenderAnyAssignActions(state, playerId, combat);
  }

  return [];
}

/**
 * CvCC attacker phase: attacker picks one of their untapped characters AND
 * a defending character to pair with. Targets may be a pre-reserved defender
 * (from phase 1) or any unassigned defender. Pass is available when all
 * attacker's untapped characters have been committed.
 */
function cvccAttackerAssignActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
  actions: EvaluatedAction[],
): EvaluatedAction[] {
  // Find the attacking company's characters
  const atkPlayer = playerById(state, combat.attackingPlayerId);
  if (!atkPlayer) return actions;
  const atkSource = combat.attackSource;
  if (atkSource.type !== 'company-attack') return actions;
  const atkCompany = companyById(atkPlayer.companies, atkSource.attackingCompanyId);
  if (!atkCompany) return actions;

  // Characters already committed as attackers in this round
  const usedAttackerIds = new Set(
    combat.strikeAssignments
      .map(a => a.attackingCharacterId)
      .filter(Boolean)
      .map(id => id as string),
  );

  // Untapped attackers not yet committed
  const availableAttackers: CardInstanceId[] = [];
  for (const charId of atkCompany.characters) {
    if (usedAttackerIds.has(charId as string)) continue;
    const charData = atkPlayer.characters[charId];
    if (charData?.status !== CardStatus.Untapped) {
      logDetail(`CvCC attacker ${charId as string} is ${charData?.status ?? 'unknown'} — not available`);
      continue;
    }
    availableAttackers.push(charId);
  }

  if (availableAttackers.length === 0) {
    // No more untapped attackers — pass only
    logDetail('CvCC attacker: no more untapped attackers available, must pass');
    actions.push({ action: { type: 'pass', player: playerId }, viable: true });
    return actions;
  }

  // Find defender targets: unassigned defenders (not in any strikeAssignment as characterId)
  const defPlayer = playerById(state, combat.defendingPlayerId);
  if (!defPlayer) return actions;
  const defCompany = companyById(defPlayer.companies, combat.companyId);
  if (!defCompany) return actions;

  const assignedDefenderIds = new Set(
    combat.strikeAssignments.map(a => a.characterId as string),
  );

  // Defenders not yet assigned at all
  const unassignedDefenders: CardInstanceId[] = defCompany.characters.filter(
    id => !assignedDefenderIds.has(id as string),
  );

  const validTargets: CardInstanceId[] = unassignedDefenders;

  if (validTargets.length === 0) {
    logDetail('CvCC attacker: no defender targets available, must pass');
    actions.push({ action: { type: 'pass', player: playerId }, viable: true });
    return actions;
  }

  // Generate one action per (attacker, target) pair
  for (const atkId of availableAttackers) {
    for (const defId of validTargets) {
      logDetail(`CvCC: attacker can pair ${atkId as string} → ${defId as string}`);
      actions.push({
        action: {
          type: 'assign-strike',
          player: playerId,
          characterId: defId,
          attackingCharacterId: atkId,
        },
        viable: true,
      });
    }
  }

  // Attacker may pass once all untapped characters are committed or all targets filled
  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  return actions;
}

/**
 * CvCC defender-any phase: defender must assign every unpaired attacker to
 * one of their characters. Any character (including tapped/wounded) may be
 * chosen. No pass until all attackers are paired.
 */
function cvccDefenderAnyAssignActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  const atkSource = combat.attackSource;
  if (atkSource.type !== 'company-attack') return [];
  const atkPlayer = playerById(state, combat.attackingPlayerId);
  if (!atkPlayer) return [];
  const atkCompany = companyById(atkPlayer.companies, atkSource.attackingCompanyId);
  if (!atkCompany) return [];

  const defPlayer = playerById(state, combat.defendingPlayerId);
  if (!defPlayer) return [];
  const defCompany = companyById(defPlayer.companies, combat.companyId);
  if (!defCompany) return [];

  // Find attackers that are not yet paired
  const usedAttackerIds = new Set(
    combat.strikeAssignments
      .map(a => a.attackingCharacterId)
      .filter(Boolean)
      .map(id => id as string),
  );
  const unpairedAttackers = atkCompany.characters.filter(
    id => !usedAttackerIds.has(id as string),
  );

  if (unpairedAttackers.length === 0) return [];

  // Only offer defenders that have not yet received any strike assignment.
  // Defenders already assigned (reservation or full pair) are not "remaining characters".
  const assignedDefIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));
  const unassignedDefs = defCompany.characters.filter(id => !assignedDefIds.has(id as string));

  if (unassignedDefs.length === 0) return [];

  const actions: EvaluatedAction[] = [];
  for (const atkId of unpairedAttackers) {
    for (const defId of unassignedDefs) {
      logDetail(`CvCC defender-any: can assign attacker ${atkId as string} to ${defId as string}`);
      actions.push({
        action: {
          type: 'assign-strike',
          player: playerId,
          characterId: defId,
          attackingCharacterId: atkId,
        },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Actions during the choose-strike-order sub-phase.
 *
 * The defending player picks which unresolved strike to resolve next.
 * Per CRF: "In an order chosen by the defending player, each assigned
 * strike is then resolved by proceeding through an individual strike sequence."
 *
 * Additionally, per rule 3.iv, strike sequences do not immediately follow
 * one another — between (and before/after) strike sequences, the resource
 * player may take any action that would otherwise be legal during the
 * current phase of the game. In the site phase this includes resource
 * short-events (rule 2.1.1).
 */
function chooseStrikeOrderActions(state: GameState, playerId: PlayerId, combat: CombatState): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];

  const defPlayer = playerById(state, combat.defendingPlayerId);
  if (!defPlayer) return [];
  const company = companyById(defPlayer.companies, combat.companyId);

  const actions: EvaluatedAction[] = [];
  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    const sa = combat.strikeAssignments[i];
    if (sa.resolved) continue;
    // Target may be a character or ally (CoE rule 2.V.2.2)
    const charData = defPlayer.characters[sa.characterId];
    const allyMatch = !charData && company
      ? findAllyInCompany(defPlayer, company.characters, sa.characterId)
      : undefined;
    const targetStatus = charData?.status ?? allyMatch?.ally.status ?? CardStatus.Untapped;
    const isTapped = targetStatus !== CardStatus.Untapped;
    logDetail(`Defender can choose to resolve strike ${i} (combatant ${sa.characterId as string}, ${isTapped ? 'tapped' : 'untapped'})`);
    actions.push({
      action: { type: 'choose-strike-order', player: playerId, strikeIndex: i, characterId: sa.characterId, tapped: isTapped },
      viable: true,
    });
  }

  // Rule 3.iv: between strike sequences the resource player may take any
  // action otherwise legal during the current phase (rule 2.1.1). Pass the
  // enclosing phase so play-window restrictions are evaluated correctly
  // regardless of whether combat is taking place in the site or M/H phase.
  if (playerId === state.activePlayer) {
    const currentPhase = state.phaseState.phase as string;
    logDetail(`Between strike sequences: offering resource short-events for phase '${currentPhase}' (rule 3.iv)`);
    actions.push(...heroResourceShortEventActions(state, playerId, currentPhase));
  }

  return actions;
}

/**
 * Build the `attack` sub-context exposed to a `cancel-strike` effect's `when`
 * clause. Mirrors the keying fields already surfaced to `cancel-attack`
 * conditions (see {@link resolveStrikeActions}'s `whenContext`): `source` (the
 * attack-source discriminator), plus the attack's region-type keying
 * (`keying`), site-type keying (`siteKeyingTypes`), and region-name keying
 * (`keyingRegionNames`) when populated. Lets a self-tap cancel-strike item gate
 * on where the hazard creature was keyed — e.g. Shadow-cloak (le-344) cancels a
 * strike only from a creature keyed to a Shadow-land [{s}], Shadow-hold [{S}],
 * Dark-domain [{d}], or Dark-hold [{D}]. Automatic attacks leave every keying
 * field empty, so a keying-gated cancel never fires against them.
 */
function buildAttackKeyingCtx(combat: CombatState): Record<string, unknown> {
  const attackCtx: Record<string, unknown> = { source: combat.attackSource.type };
  if (combat.attackKeying && combat.attackKeying.length > 0) {
    attackCtx.keying = combat.attackKeying;
  }
  if (combat.attackSiteKeyingTypes && combat.attackSiteKeyingTypes.length > 0) {
    attackCtx.siteKeyingTypes = combat.attackSiteKeyingTypes;
  }
  if (combat.attackKeyingRegionNames && combat.attackKeyingRegionNames.length > 0) {
    attackCtx.keyingRegionNames = combat.attackKeyingRegionNames;
  }
  return attackCtx;
}

/**
 * Build the `when` evaluation context shared by both `modify-attack` scopes
 * (whole-attack in {@link modifyAttackActions} and `"current-strike"` in
 * {@link tapItemForStrikeActions}): `bearer.*` (race/skills/name),
 * `enemy.race`, and `attack.*` (`source`, `keying`, `siteKeyed`,
 * `weaponsIneffective`). `attack.siteKeyed` is true only for a
 * creature/on-guard-creature attack keyed purely to a site type or name (no
 * region-type keying) — lets a card gate on "a hazard creature attack not
 * keyed to a site" (Bow of Dragon-horn td-102, Arrows Shorn of Ebony td-99).
 */
function modifyAttackWhenContext(
  combat: CombatState,
  bearer: { race: Race; skills: readonly string[]; name?: string },
): Record<string, unknown> {
  const ctx: Record<string, unknown> = { bearer };
  if (combat.creatureRace) ctx['enemy'] = { race: combat.creatureRace };
  const attackCtx: Record<string, unknown> = { source: combat.attackSource.type };
  if (combat.attackKeying && combat.attackKeying.length > 0) attackCtx['keying'] = combat.attackKeying;
  const isSiteKeyedCreature = (
    combat.attackSource.type === 'creature' || combat.attackSource.type === 'on-guard-creature'
  ) && !(combat.attackKeying && combat.attackKeying.length > 0)
    && !!(combat.attackSiteKeyingTypes && combat.attackSiteKeyingTypes.length > 0);
  attackCtx['siteKeyed'] = isSiteKeyedCreature;
  // `attack.weaponsIneffective` is true for attacks whose strikes carry the
  // printed "weapons do not modify prowess" clause (Trap, Lava Flows, Rock
  // Fall). Dwarven Light-stone (dm-168) taps to lower such an attack's
  // prowess by 2.
  attackCtx['weaponsIneffective'] = combat.weaponsIneffective === true;
  ctx['attack'] = attackCtx;
  return ctx;
}

/**
 * Scan `candidates` (a struck character's untapped items/allies, or a struck
 * ally itself) for `cancel-strike` effects that tap themselves to protect their
 * bearer (cost `tap: 'self'`, target absent or `'self'`), emitting one
 * `cancel-strike` action per eligible match. `buildCtx` supplies the `when`
 * evaluation context (with a `bearer` field for the bearer scan, without it for
 * the ally-as-target scan); `targetName` is for log traceability. Shared by the
 * three identical scans in {@link resolveStrikeActions}.
 */
function selfCancelStrikeActions(
  state: GameState,
  playerId: PlayerId,
  targetCharacterId: CardInstanceId,
  targetName: string,
  candidates: ReadonlyArray<{ readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId; readonly status: CardStatus }>,
  buildCtx: () => Record<string, unknown>,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  for (const c of candidates) {
    const def = defById(state, c.definitionId);
    if (!def) continue;
    for (const eff of getCardEffects(def)) {
      if (eff.type !== 'cancel-strike') continue;
      if (eff.target && eff.target !== 'self') continue;
      // Two cost variants pay for a self-protecting cancel:
      //  • tap cost (Enruned Shield, Noble Steed): the source taps, so it must
      //    be untapped to be available.
      //  • corruption-check cost (The One Ring tw-347): the bearer makes a
      //    corruption check instead of tapping, so the source's tapped status
      //    is irrelevant to availability.
      const isTapCost = eff.cost?.tap === 'self';
      const isCorruptionCost = eff.cost?.check === 'corruption';
      if (!isTapCost && !isCorruptionCost) continue;
      if (isTapCost && c.status !== CardStatus.Untapped) continue;

      const name = (def as { name?: string }).name ?? (c.definitionId as string);
      if (eff.when && !matchesCondition(eff.when, buildCtx())) {
        logDetail(`Cancel-strike ${name}: when condition not met (target ${targetName})`);
        continue;
      }

      const how = isCorruptionCost ? 'make a corruption check to cancel' : 'tap to cancel';
      logDetail(`Cancel-strike available: ${name} can ${how} strike against ${targetName}`);
      actions.push({
        action: {
          type: 'cancel-strike',
          player: playerId,
          cancellerInstanceId: c.instanceId,
          targetCharacterId,
        },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Fled into Darkness (ba-18): during resolve-strike the defending player may
 * play a `flee-from-strike` permanent-event from hand to cancel the current
 * strike against the named character (The Balrog), provided the strike's prowess
 * is strictly higher than that character's effective prowess and no copy of the
 * card is already in play ("Cannot be duplicated"). The struck target must be a
 * real character (not an ally) — only characters untap, which the delayed
 * skip-next-untap needs.
 */
function fleeFromStrikeActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.phase !== 'resolve-strike') return [];
  if (playerId !== combat.defendingPlayerId) return [];
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return [];

  const defPlayer = playerById(state, playerId);
  if (!defPlayer) return [];
  const struck = defPlayer.characters[currentStrike.characterId];
  if (!struck) return [];
  const struckDef = defById(state, struck.definitionId);
  if (!struckDef || !isCharacterCard(struckDef)) return [];
  const struckName = struckDef.name;

  // The prowess the character is actually facing (agents use their rolled total
  // once known; every other attack uses the base strike prowess).
  const strikeProwess = combat.attackSource.type === 'agent' && combat.agentRollTotal !== undefined
    ? combat.agentRollTotal
    : combat.strikeProwess;
  const charProwess = struck.effectiveStats.prowess;

  const actions: EvaluatedAction[] = [];
  for (const card of defPlayer.hand) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const effect = getCardEffects(def).find(
      (e): e is FleeFromStrikeEffect => e.type === 'flee-from-strike',
    );
    if (!effect) continue;
    if (effect.characterName !== struckName) continue;
    if (strikeProwess <= charProwess) {
      logDetail(`Flee-from-strike ${def.name}: strike prowess ${strikeProwess} not higher than ${struckName}'s prowess ${charProwess}`);
      continue;
    }
    if (countCopiesInPlay(state, def.name ?? '') > 0) {
      logDetail(`Flee-from-strike ${def.name}: a copy is already in play — cannot be duplicated`);
      continue;
    }
    logDetail(`Flee-from-strike available: ${def.name} can cancel strike (prowess ${strikeProwess}) against ${struckName}`);
    actions.push({
      action: { type: 'flee-from-strike', player: playerId, cardInstanceId: card.instanceId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Sacrifice of Form (tw-321): Wizard-only permanent-event playable from hand
 * after strikes are assigned against the Wizard's company, before any strike
 * of the attack has resolved. Not usable in company-vs-company combat.
 * Cannot be duplicated on a given Wizard — blocked while any in-play card
 * already names that Wizard's instance ID via
 * `sacrificeOfFormCharacterInstanceId`.
 */
function sacrificeOfFormActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.attackSource.type === 'company-attack') return [];
  if (combat.strikeAssignments.length === 0 || combat.strikeAssignments.some(a => a.resolved)) return [];

  const defPlayer = playerById(state, playerId);
  if (!defPlayer) return [];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company) return [];

  const wizardId = company.characters.find(charId => {
    const char = defPlayer.characters[charId];
    if (!char) return false;
    const def = defById(state, char.definitionId);
    return isCharacterCard(def) && isAvatarCharacter(def) && def.alignment === Alignment.Wizard;
  });
  if (!wizardId) return [];

  const actions: EvaluatedAction[] = [];
  for (const card of defPlayer.hand) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const effect = getCardEffects(def).find((e): e is SacrificeOfFormEffect => e.type === 'sacrifice-of-form');
    if (!effect) continue;
    const alreadyBound = defPlayer.cardsInPlay.some(c => c.sacrificeOfFormCharacterInstanceId === wizardId);
    if (alreadyBound) {
      logDetail(`${def.name}: cannot be duplicated on a given Wizard — already in play for ${wizardId as string}`);
      continue;
    }
    logDetail(`${def.name}: playable — all strikes of the current attack against ${wizardId as string}'s company would fail`);
    actions.push({
      action: { type: 'play-sacrifice-of-form', player: playerId, cardInstanceId: card.instanceId, characterInstanceId: wizardId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Actions during the resolve-strike sub-phase.
 *
 * The defending player chooses to tap-to-fight (normal) or stay untapped
 * (-3 prowess penalty). They may also have untapped characters support
 * the current strike (+1 prowess each).
 */
function resolveStrikeActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];

  const actions: EvaluatedAction[] = [];
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return [];

  // Resolve-strike: tap to fight (normal) or stay untapped (-3 prowess)
  // The -3 option is only available if the combatant is currently untapped
  const player0 = playerById(state, playerId);
  if (!player0) return [];
  const charData = player0.characters[currentStrike.characterId];
  const company0 = companyById(player0.companies, combat.companyId);

  // The strike target may be a character or an ally (CoE rule 2.V.2.2)
  const allyMatch = !charData && company0
    ? findAllyInCompany(player0, company0.characters, currentStrike.characterId)
    : undefined;

  // The assigned target may have left play mid-combat (e.g. eliminated by
  // an earlier strike's body check) — the strike cannot be resolved. Offer
  // pass so the reducer can skip it (see handleCombatPass).
  if (!charData && !allyMatch) {
    logDetail(`Resolve-strike: target ${currentStrike.characterId as string} no longer in play — pass to skip the strike`);
    actions.push({ action: { type: 'pass', player: playerId }, viable: true });
    return actions;
  }

  const targetStatus = charData?.status ?? allyMatch?.ally.status ?? CardStatus.Untapped;
  const targetDefId = charData?.definitionId ?? allyMatch?.ally.definitionId;
  const isUntapped = targetStatus === CardStatus.Untapped;

  // Compute prowess and need for both tap/untap options
  // Must match the reducer's prowess calculation: base effective prowess,
  // then -1 if tapped, -2 if wounded, -N for excess strikes (CoE 3.iv.7.3)
  const charDef = defById(state, targetDefId);
  const charName = charDef?.name ?? (currentStrike.characterId as string);
  // Recompute prowess with combat context when creature race is known,
  // so combat-conditional weapon effects (e.g. Glamdring vs Orcs) apply.
  // The tap and untap options are computed with their own `strikeMode` so a
  // "when tapping to face a strike" modifier (Stabbing Tongue of Fire ba-81,
  // Whip of Many Thongs ba-82) is reflected in the tap need but not the
  // stay-untapped need.
  let baseProwessTap: number;
  let baseProwessUntap: number;
  if (combat.defenderProwessFromMind && !allyMatch && charDef && isCharacterCard(charDef) && charDef.mind !== null) {
    // Neeker-breekers: use the character's mind attribute as base prowess.
    // Must match the reducer's calculation in combat-strike.ts.
    baseProwessTap = baseProwessUntap = charDef.mind;
  } else if (allyMatch) {
    // Allies use prowess from their instance override (e.g. a creature
    // converted by Ready to His Will) or their card definition.
    baseProwessTap = baseProwessUntap = allyEffectiveProwess(state, allyMatch.ally);
  } else if (combat.creatureRace && charDef && isCharacterCard(charDef) && charData) {
    baseProwessTap = computeCombatProwess(state, charData, charDef, combat.creatureRace, 'tap');
    baseProwessUntap = computeCombatProwess(state, charData, charDef, combat.creatureRace, 'untap');
  } else {
    baseProwessTap = baseProwessUntap = charData?.effectiveStats?.prowess ?? 0;
  }
  // For agent attacks, use the agent's rolled total (2d6 + modified prowess) as
  // the effective prowess the character must beat (rule 3.iv.6.1).
  const strikeProwess = combat.attackSource.type === 'agent' && combat.agentRollTotal !== undefined
    ? combat.agentRollTotal
    : combat.strikeProwess;
  let statusPenalty = 0;
  if (targetStatus === CardStatus.Tapped) statusPenalty = 1;
  if (targetStatus === CardStatus.Inverted) statusPenalty = 2; // Wounded
  const excessPenalty = currentStrike.excessStrikes > 0 ? currentStrike.excessStrikes : 0;

  // Tap: full prowess; Untap: -3 prowess penalty.
  // Add +1 per character/ally that has tapped to support this strike
  // (CoE rule 3.iv.4) so the displayed "need" updates as the defender
  // taps supporters.
  const supportBonus = currentStrike.supportCount ?? 0;
  const strikeBonus = currentStrike.strikeProwessBonus ?? 0;
  const tapProwess = baseProwessTap - statusPenalty - excessPenalty + supportBonus + strikeBonus;
  const untapProwess = baseProwessUntap - computeStayUntappedPenalty(state, charData, charDef) - statusPenalty - excessPenalty + supportBonus + strikeBonus;

  const tapNeed = Math.max(2, strikeProwess - tapProwess + 1);
  const tapExplanation = combat.attackSource.type === 'agent'
    ? `Tapped: need ${tapNeed}+ (prowess ${tapProwess} vs agent roll ${strikeProwess})`
    : `Tapped: need ${tapNeed}+ (prowess ${tapProwess} vs ${strikeProwess})`;
  const untapNeed = Math.max(2, strikeProwess - untapProwess + 1);
  const untapExplanation = combat.attackSource.type === 'agent'
    ? `Untapped: need ${untapNeed}+ (prowess ${untapProwess} vs agent roll ${strikeProwess})`
    : `Untapped: need ${untapNeed}+ (prowess ${untapProwess} vs ${strikeProwess})`;

  logDetail(`Defender can resolve strike against ${charName} (${isUntapped ? 'untapped' : 'tapped/wounded'})`);
  actions.push({
    action: { type: 'resolve-strike', player: playerId, tapToFight: true, need: tapNeed, explanation: tapExplanation },
    viable: true,
  });
  if (isUntapped) {
    actions.push({
      action: { type: 'resolve-strike', player: playerId, tapToFight: false, need: untapNeed, explanation: untapExplanation },
      viable: true,
    });
  }

  // strike-modifier short events: scan hand once for cards with a `strike-modifier`
  // effect. Mode is determined by effect flags: cancel (outright, no roll),
  // dodge (no-tap), reroll (two rolls), or default (prowess/body accumulator).
  // All four emit `play-strike-event`.
  const struckSkills = charData && charDef && isCharacterCard(charDef) ? (charDef.skills ?? []) : [];
  for (const handCard of player0.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const strikeEffect = getCardEffects(cardDef).find(
      (e): e is StrikeModifierEffect => e.type === 'strike-modifier',
    );
    if (!strikeEffect) continue;

    let explanation: string;
    let need: number;

    if (strikeEffect.cancel) {
      if (strikeEffect.filter) {
        if (!charDef) continue;
        const targetObj: Record<string, unknown> = {};
        if ('race' in charDef) targetObj.race = (charDef as { race: Race }).race;
        if ('skills' in charDef) targetObj.skills = (charDef as { skills: readonly string[] }).skills;
        if ('name' in charDef) targetObj.name = (charDef as { name: string }).name;
        if (!matchesCondition(strikeEffect.filter, { target: targetObj })) {
          logDetail(`Cancel strike ${handCard.definitionId as string}: filter not met for ${charName}`);
          continue;
        }
      }
      explanation = `${(cardDef as { name?: string } | undefined)?.name ?? 'Strike event'}: cancels the strike against ${charName} outright (no roll)`;
      need = 0;
      logDetail(`Cancel strike available: ${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string} for ${charName}`);
    } else if (strikeEffect.dodge) {
      if (strikeEffect.requiredSkill && !struckSkills.some(s => s === strikeEffect.requiredSkill)) {
        logDetail(`${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string}: ${charName} lacks required skill '${strikeEffect.requiredSkill}' — not playable`);
        continue;
      }
      if (strikeEffect.requiredSkill && currentStrike.requiredSkillEventPlayed) {
        logDetail(`${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string}: a skill-required resource has already been played against this strike (CoE 3.iv.5) — not playable`);
        continue;
      }
      explanation = `Dodge: need ${tapNeed}+ (prowess ${tapProwess} vs ${strikeProwess}, no tap)`;
      need = tapNeed;
      logDetail(`Dodge available: ${handCard.definitionId as string} for ${charName}`);
    } else if (strikeEffect.reroll) {
      if (strikeEffect.filter) {
        if (!charDef) continue;
        const targetObj: Record<string, unknown> = {};
        if ('race' in charDef) targetObj.race = (charDef as { race: Race }).race;
        if ('skills' in charDef) targetObj.skills = (charDef as { skills: readonly string[] }).skills;
        if ('name' in charDef) targetObj.name = (charDef as { name: string }).name;
        if (!matchesCondition(strikeEffect.filter, { target: targetObj })) {
          logDetail(`Reroll strike ${handCard.definitionId as string}: filter not met for ${charName}`);
          continue;
        }
      }
      // A reroll card's text (e.g. Swift Strokes, Lucky Strike) says nothing
      // about tapping, so it doesn't override the defender's independent
      // CoE 3.iv.3 tap/stay-untapped choice — offer both, mirroring the
      // plain resolve-strike tap/untap split above. The stay-untapped variant
      // is only offered while the combatant is actually untapped.
      const rerollBonus = strikeEffect.prowessBonus ?? 0;
      const rerollBonusNote = rerollBonus !== 0 ? `, ${formatSignedNumber(rerollBonus)}` : '';
      const rerollTapProwess = tapProwess + rerollBonus;
      const rerollTapNeed = Math.max(2, strikeProwess - rerollTapProwess + 1);
      logDetail(`Reroll strike available (tapped): ${handCard.definitionId as string} for ${charName}`);
      actions.push({
        action: {
          type: 'play-strike-event',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          tapToFight: true,
          need: rerollTapNeed,
          explanation: `Reroll (tapped): need ${rerollTapNeed}+ (prowess ${rerollTapProwess} vs ${strikeProwess}, better of two rolls${rerollBonusNote})`,
        },
        viable: true,
      });
      if (isUntapped) {
        const rerollUntapProwess = untapProwess + rerollBonus;
        const rerollUntapNeed = Math.max(2, strikeProwess - rerollUntapProwess + 1);
        logDetail(`Reroll strike available (stay untapped): ${handCard.definitionId as string} for ${charName}`);
        actions.push({
          action: {
            type: 'play-strike-event',
            player: playerId,
            cardInstanceId: handCard.instanceId,
            tapToFight: false,
            need: rerollUntapNeed,
            explanation: `Reroll (stay untapped): need ${rerollUntapNeed}+ (prowess ${rerollUntapProwess} vs ${strikeProwess}, better of two rolls${rerollBonusNote})`,
          },
          viable: true,
        });
      }
      continue;
    } else {
      if (strikeEffect.requiredSkill && !struckSkills.some(s => s === strikeEffect.requiredSkill)) {
        logDetail(`${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string}: ${charName} lacks required skill '${strikeEffect.requiredSkill}' — not playable`);
        continue;
      }
      if (strikeEffect.requiredSkill && currentStrike.requiredSkillEventPlayed) {
        logDetail(`${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string}: a skill-required resource has already been played against this strike (CoE 3.iv.5) — not playable`);
        continue;
      }
      const bonus = strikeEffect.prowessBonus ?? 0;
      const modifiedTapProwess = tapProwess + bonus;
      const modifiedNeed = Math.max(2, strikeProwess - modifiedTapProwess + 1);
      const bodyPenalty = strikeEffect.bodyPenalty ?? 0;
      const bodyNote = bodyPenalty ? `, body ${formatSignedNumber(bodyPenalty)}` : '';
      explanation = `${(cardDef as { name?: string } | undefined)?.name ?? 'Strike event'}: need ${modifiedNeed}+ (prowess ${modifiedTapProwess} vs ${strikeProwess}${bonus !== 0 ? `, ${formatSignedNumber(bonus)}` : ''}${bodyNote})`;
      need = modifiedNeed;
      logDetail(`Strike event available: ${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string} for ${charName} — ${explanation}`);
    }

    actions.push({
      action: {
        type: 'play-strike-event',
        player: playerId,
        cardInstanceId: handCard.instanceId,
        need,
        explanation,
      },
      viable: true,
    });
  }

  // Support: any untapped character in the same company who hasn't been assigned a strike,
  // or any untapped ally in the company.
  // (CRF: "tap one or more of their untapped characters ... who hasn't been assigned a strike")
  const player = playerById(state, playerId);
  if (!player) return [];
  const company = companyById(player.companies, combat.companyId);
  const assignedCharIds = new Set(combat.strikeAssignments.map(sa => sa.characterId as string));
  if (company) {
    for (const charId of company.characters) {
      // Untapped characters without a strike can support
      if (!assignedCharIds.has(charId as string)) {
        const charData = player.characters[charId];
        if (charData && charData.status === CardStatus.Untapped) {
          logDetail(`Untapped character ${charId as string} can support (no strike assigned)`);
          actions.push({
            action: {
              type: 'support-strike',
              player: playerId,
              supportingCharacterId: charId,
              targetCharacterId: currentStrike.characterId,
            },
            viable: true,
          });
        }
      }

      // Untapped allies on any character in the company can support
      const hostChar = player.characters[charId];
      if (hostChar) {
        for (const ally of hostChar.allies) {
          if (ally.status !== CardStatus.Untapped) continue;
          logDetail(`Untapped ally ${ally.instanceId as string} can support`);
          actions.push({
            action: {
              type: 'support-strike',
              player: playerId,
              supportingCharacterId: ally.instanceId,
              targetCharacterId: currentStrike.characterId,
            },
            viable: true,
          });
        }
      }
    }
  }

  // Cancel-strike: scan characters in the company for cancel-strike effects
  // targeting other characters (e.g. Fatty Bolger taps to cancel a hobbit's strike).
  if (company0) {
    const strikeTargetDef = charDef;
    for (const compCharId of company0.characters) {
      if (compCharId === currentStrike.characterId) continue;
      const compCharData = player0.characters[compCharId];
      if (!compCharData || compCharData.status !== CardStatus.Untapped) continue;
      const compCharDef = defById(state, compCharData.definitionId);
      if (!compCharDef || !isCharacterCard(compCharDef)) continue;
      if (!compCharDef.effects) continue;

      for (const eff of compCharDef.effects) {
        if (eff.type !== 'cancel-strike') continue;
        const csEff = eff;
        if (csEff.target !== 'other-in-company') continue;
        if (csEff.cost?.tap !== 'self') continue;

        // Check when condition (enemy filtering)
        if (csEff.when) {
          const ctx: Record<string, unknown> = {};
          if (combat.creatureRace) ctx.enemy = enemyRaceContext(combat);
          if (!matchesCondition(csEff.when, ctx)) continue;
        }

        // Check filter condition (target character filtering)
        if (csEff.filter) {
          if (!strikeTargetDef) continue;
          const targetObj: Record<string, unknown> = {};
          if ('race' in strikeTargetDef) targetObj.race = (strikeTargetDef as { race: Race }).race;
          if ('skills' in strikeTargetDef) targetObj.skills = (strikeTargetDef as { skills: readonly string[] }).skills;
          if ('name' in strikeTargetDef) targetObj.name = (strikeTargetDef as { name: string }).name;
          if (!matchesCondition(csEff.filter, { target: targetObj })) continue;
        }

        const cancellerName = compCharDef.name;
        logDetail(`Cancel-strike available: ${cancellerName} can tap to cancel strike against ${charName}`);
        actions.push({
          action: {
            type: 'cancel-strike',
            player: playerId,
            cancellerInstanceId: compCharId,
            targetCharacterId: currentStrike.characterId,
          },
          viable: true,
        });
      }
    }
  }

  // Cancel-strike: scan items and allies attached to the struck character for
  // cancel-strike effects with `cost: { tap: "self" }` and `target` absent or
  // "self" (item/ally taps to protect its bearer — e.g. Enruned Shield's
  // Warrior-only tap, or Noble Steed's "not from an automatic-attack" cancel).
  if (charData && charDef && isCharacterCard(charDef)) {
    const bearerSkills = charDef.skills ?? [];
    const bearerRace = charDef.race;
    const bearerName = charDef.name;

    // Build the cancel-strike condition context once (shared by item and ally scans).
    const buildCancelCtx = (): Record<string, unknown> => {
      const ctx: Record<string, unknown> = {
        bearer: { skills: bearerSkills, race: bearerRace, name: bearerName },
        attack: buildAttackKeyingCtx(combat),
      };
      if (combat.creatureRace) ctx.enemy = enemyRaceContext(combat);
      return ctx;
    };

    // Scan the bearer's untapped items and allies together (e.g. Enruned
    // Shield, Noble Steed) for self-tap cancel-strike effects.
    actions.push(...selfCancelStrikeActions(
      state, playerId, currentStrike.characterId, charName,
      [...charData.items, ...charData.allies], buildCancelCtx,
    ));
  }

  // Cancel-strike: when the strike target is an ally, scan the ally itself for
  // cancel-strike effects (CoE 2.V.2.2 — allies are treated as characters for
  // combat; e.g. Noble Steed can tap to cancel a strike against itself).
  if (allyMatch) {
    const { ally } = allyMatch;
    const cancelCtx = (): Record<string, unknown> => {
      const ctx: Record<string, unknown> = {
        attack: buildAttackKeyingCtx(combat),
      };
      if (combat.creatureRace) ctx.enemy = enemyRaceContext(combat);
      return ctx;
    };
    actions.push(...selfCancelStrikeActions(
      state, playerId, currentStrike.characterId, charName, [ally], cancelCtx,
    ));
  }

  // modify-attack with scope "current-strike": scan items on the current strike
  // target for tap-to-boost effects scoped to a single strike (e.g. Shield of Iron-bound Ash).
  actions.push(...tapItemForStrikeActions(state, playerId, combat, tapProwess, strikeProwess));

  // Rule 3.iv.5: the defending resource player may play resources on the
  // character facing the strike if doing so would affect the strike's
  // resolution (e.g. Vilya boosting Elrond's prowess/body).
  if (playerId === state.activePlayer) {
    actions.push(...shortEventsAffectingStrike(state, playerId, combat));
  }

  // Rule 2.1.1 / 3.iv.5: the defending resource player may activate any-phase
  // grant-actions on their turn — most relevantly Cram's discard-to-untap-bearer,
  // which lets the character facing the strike shed the already-tapped -1
  // prowess penalty and regain the "-3 to stay untapped" option (rule 3.iv.3).
  // `resolveStrikeActions` is entered as a whole-phase dispatch (combat.ts's
  // `combatActions` switch), not through the general per-phase action list
  // where `grantedActionActivations` normally runs, so without this the
  // any-phase grant is silently unreachable for the whole strike sequence.
  if (playerId === state.activePlayer) {
    actions.push(...grantedActionActivations(state, playerId, 'anyPhase'));
  }

  return actions;
}

/**
 * CvCC resolve-strike actions — two-step sub-phase:
 *
 * Sub-step 1 (attackerTapToFight === undefined): the ATTACKER declares
 * whether to tap (+full prowess) or stay untapped (-3 prowess). They choose
 * via a resolve-strike action with `tapToFight`. No other actions are legal
 * until the attacker declares.
 *
 * Sub-step 2 (attackerTapToFight defined): the DEFENDER resolves their side
 * (tap/untap choice + support), then both roll.
 *
 * Rule 8.42: no hazards during CvCC — the hazard-play window is skipped.
 */
function cvccResolveStrikeActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return [];

  const atkSource = combat.attackSource;
  if (atkSource.type !== 'company-attack') return [];

  // Sub-step 1: attacker has not yet declared -3 choice
  if (currentStrike.attackerTapToFight === undefined) {
    if (playerId !== combat.attackingPlayerId) {
      logDetail('CvCC resolve-strike sub-step 1: defender waits for attacker to declare -3 choice');
      return [];
    }

    // Look up the attacking character for prowess context
    const atkPlayer = playerById(state, combat.attackingPlayerId);
    if (!atkPlayer) return [];
    const atkCharData = currentStrike.attackingCharacterId
      ? atkPlayer.characters[currentStrike.attackingCharacterId]
      : undefined;
    const atkCharDef = atkCharData?.definitionId ? defById(state, atkCharData.definitionId) : undefined;
    const atkCharName = (atkCharDef as { name?: string } | undefined)?.name
      ?? (currentStrike.attackingCharacterId as string | undefined)
      ?? 'attacker';

    const atkStatus = atkCharData?.status ?? CardStatus.Untapped;
    const atkBaseProwess = atkCharData?.effectiveStats?.prowess ?? 0;
    const atkStatusPenalty = atkStatus === CardStatus.Tapped ? 1
      : atkStatus === CardStatus.Inverted ? 2 : 0;
    const atkUntapPenalty = computeStayUntappedPenalty(state, atkCharData, atkCharDef);
    const tapProwess = atkBaseProwess - atkStatusPenalty;
    const untapProwess = atkBaseProwess - atkStatusPenalty - atkUntapPenalty;

    logDetail(`CvCC sub-step 1: attacker ${atkCharName} declares untap choice (prowess ${tapProwess} or ${untapProwess})`);
    const tapExplanation = `Attacker tapped: prowess ${tapProwess}`;
    const untapExplanation = `Attacker untapped: prowess ${untapProwess} (-${atkUntapPenalty})`;

    const acts: EvaluatedAction[] = [
      { action: { type: 'resolve-strike', player: playerId, tapToFight: true, need: 2, explanation: tapExplanation }, viable: true },
    ];
    if (atkStatus === CardStatus.Untapped) {
      acts.push({ action: { type: 'resolve-strike', player: playerId, tapToFight: false, need: 2, explanation: untapExplanation }, viable: true });
    }
    // Rule 3.V.ii: attacker may allocate excess strikes as -1 modifiers before declaring tap choice
    if (combat.cvccExcessPool && combat.cvccExcessPool > 0) {
      logDetail(`CvCC excess pool: ${combat.cvccExcessPool} excess strike(s) available to allocate as -1`);
      acts.push({ action: { type: 'allocate-cvcc-excess', player: playerId }, viable: true });
    }
    return acts;
  }

  // Sub-step 2: attacker declared, now defender resolves
  if (playerId !== combat.defendingPlayerId) {
    logDetail('CvCC resolve-strike sub-step 2: attacker waits for defender to resolve');
    return [];
  }

  // Delegate to the standard resolveStrikeActions for the defender's side
  return resolveStrikeActions(state, playerId, combat);
}

/**
 * Returns `play-short-event` actions for resource short-events in the
 * defending player's hand that target the current strike character and
 * would affect the strike's resolution (rule 3.iv.5).
 *
 * A card qualifies if:
 * 1. It has a `play-target` effect whose filter matches the character
 *    currently facing the strike.
 * 2. It has at least one `on-event: self-enters-play` apply of type
 *    `add-constraint` with `constraint: "character-stat-modifier"` and
 *    `stat: "prowess"` or `stat: "body"` — directly improving the
 *    character's prowess or body for the strike roll / body check.
 */
function shortEventsAffectingStrike(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return [];

  const defPlayer = playerById(state, combat.defendingPlayerId);
  if (!defPlayer) return [];

  const strikeCharData = defPlayer.characters[currentStrike.characterId];
  if (!strikeCharData) return [];

  const actions: EvaluatedAction[] = [];

  for (const handCard of defPlayer.hand) {
    const def = defById(state, handCard.definitionId);
    if (!isResourceEventCard(def) || def.eventType !== 'short') continue;

    const playTarget = getPlayTargetEffect(def);
    if (!playTarget || playTarget.target !== 'character') continue;

    // Target filter must match the character facing this strike
    if (playTarget.filter) {
      const ctx = buildPlayOptionContext(state, strikeCharData, defPlayer);
      if (!matchesCondition(playTarget.filter, ctx)) {
        logDetail(`${def.name}: play-target filter does not match ${currentStrike.characterId as string} — not an affecting strike event`);
        continue;
      }
    }

    // Must have at least one effect that boosts prowess or body on the character
    const affectsStrike = getCardEffects(def).some(
      (e): e is OnEventEffect =>
        e.type === 'on-event'
        && e.event === 'self-enters-play'
        && e.apply.type === 'add-constraint'
        && e.apply.constraint === 'character-stat-modifier'
        && (e.apply.stat === 'prowess' || e.apply.stat === 'body'),
    );
    if (!affectsStrike) {
      logDetail(`${def.name}: no prowess/body modifier — not an affecting strike event`);
      continue;
    }

    // Check turn-scoped duplication limit (e.g. Vilya: max 1 per turn)
    const turnDupLimit = findDuplicationLimitEffect(def, 'turn');
    if (turnDupLimit) {
      const prior = countConstraintsFromDefinition(state, def.id);
      if (prior >= turnDupLimit.max) {
        logDetail(`${def.name}: duplication limit reached (${prior}/${turnDupLimit.max}) — not playable`);
        continue;
      }
    }

    logDetail(`Combat step 5: ${def.name} targets strike character ${currentStrike.characterId as string} and affects prowess/body — playable`);
    actions.push({
      action: {
        type: 'play-short-event',
        player: playerId,
        cardInstanceId: handCard.instanceId,
        targetCharacterId: currentStrike.characterId,
      },
      viable: true,
    });
  }

  return actions;
}

/**
 * Generate tap-item-for-strike actions for the defending player during
 * the resolve-strike phase. Scans items on the current strike target
 * character for `modify-attack` effects with `scope: "current-strike"`.
 * One action is emitted per eligible item — a `cost: { tap: "self" }` item
 * must be untapped; a `cost: { discard: "self" }` item is offered regardless
 * of status (it leaves play either way).
 *
 * Used by Shield of Iron-bound Ash (tw-327): tap to gain +1 prowess against
 * one strike. Used by Arrows Shorn of Ebony (td-99): discard to give -1
 * prowess, -2 body to one hazard-creature strike not keyed to a site.
 */
function tapItemForStrikeActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
  tapProwess: number,
  strikeProwess: number,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.phase !== 'resolve-strike') return [];

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return [];

  const defPlayer = playerById(state, playerId);
  if (!defPlayer) return [];
  const charData = defPlayer.characters[currentStrike.characterId];
  if (!charData) return [];

  const charDef = defById(state, charData.definitionId);
  if (!charDef || !isCharacterCard(charDef)) return [];

  // MEBA: The Balrog may not use items, so he never taps one to boost a strike.
  if (isBalrogAvatarDef(charDef)) {
    logDetail(`Tap-item-for-strike: ${charDef.name ?? ''} is the Balrog avatar — items have no effect, none offered`);
    return [];
  }

  const actions: EvaluatedAction[] = [];

  for (const item of charData.items) {
    const itemDef = defById(state, item.definitionId);
    if (!itemDef) continue;
    const effect = getCardEffects(itemDef).find(
      (e): e is ModifyAttackEffect => e.type === 'modify-attack' && (e).scope === 'current-strike',
    );
    if (!effect) continue;
    const isTapCost = effect.cost?.tap === 'self';
    const isDiscardCost = effect.cost?.discard === 'self';
    if (!isTapCost && !isDiscardCost) continue;
    if (isTapCost && item.status !== CardStatus.Untapped) continue;

    if (effect.when) {
      const ctx = modifyAttackWhenContext(combat, { race: charDef.race, skills: charDef.skills, name: charDef.name });
      if (!matchesCondition(effect.when, ctx)) {
        const itemName = itemDef?.name ?? (item.definitionId as string);
        logDetail(`Tap-item-for-strike ${itemName}: when condition not met for bearer ${charDef.name ?? ''}`);
        continue;
      }
    }

    const bonus = effect.prowessModifier ?? 0;
    const modifiedProwess = tapProwess + bonus;
    const modifiedNeed = Math.max(2, strikeProwess - modifiedProwess + 1);
    const itemName = itemDef?.name ?? (item.definitionId as string);
    const explanation = `${itemName}: need ${modifiedNeed}+ (prowess ${modifiedProwess} vs ${strikeProwess}, ${formatSignedNumber(bonus)})`;
    logDetail(`Tap-item-for-strike available: ${isDiscardCost ? 'discard' : 'tap'} ${itemName} on ${charDef.name ?? ''} — ${explanation}`);
    actions.push({
      action: {
        type: 'tap-item-for-strike',
        player: playerId,
        cardInstanceId: item.instanceId,
        characterInstanceId: currentStrike.characterId,
        need: modifiedNeed,
        explanation,
      },
      viable: true,
    });
  }

  return actions;
}

/**
 * Actions during the body-check sub-phase.
 * The attacking player rolls 2d6 against the body value.
 */
function bodyCheckActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  // Body check always belongs to the opponent of the entity being checked
  // (CoE 3.I.1):
  // - defender's character wounded → attacker (opponent) rolls
  // - attacker's character wounded (CvCC) → defender (opponent) rolls
  // - creature/agent's strike defeated → the creature/agent is controlled by
  //   the attacker, so the defender (opponent) rolls
  const roller = combat.bodyCheckTarget === 'attacker-character' || combat.bodyCheckTarget === 'creature'
    ? combat.defendingPlayerId
    : combat.attackingPlayerId;
  if (playerId !== roller) return [];

  let body: number;
  let targetLabel: string;
  if (combat.bodyCheckTarget === 'creature') {
    body = combat.creatureBody ?? 0;
    targetLabel = 'creature';
  } else if (combat.bodyCheckTarget === 'attacker-character') {
    // CvCC: roll for the attacking character's body
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const atkPlayer = playerById(state, combat.attackingPlayerId);
    const charData = atkPlayer?.characters[strike?.attackingCharacterId as CardInstanceId];
    const charDef = charData ? defById(state, charData.definitionId) : undefined;
    body = (charDef as { body?: number } | undefined)?.body ?? 9;
    targetLabel = charDef?.name ?? 'attacker';
  } else {
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const defPlayer = playerById(state, combat.defendingPlayerId);
    const charData = defPlayer?.characters[strike?.characterId];
    const charDef = charData ? defById(state, charData.definitionId) : undefined;
    body = (charDef as { body?: number } | undefined)?.body ?? 9;
    // Dodge body penalty
    if (strike?.dodged && strike.dodgeBodyPenalty) {
      body = body + strike.dodgeBodyPenalty;
    }
    // Modify-strike body penalty (e.g. Risky Blow's -1)
    if (strike?.strikeBodyPenalty) {
      body = body + strike.strikeBodyPenalty;
    }
    targetLabel = charDef?.name ?? 'character';
  }
  // +1 to body check roll if the character was already wounded before this strike (CoE rule 3.I)
  const isWounded = combat.bodyCheckTarget === 'character' &&
    combat.strikeAssignments[combat.currentStrikeIndex]?.wasAlreadyWounded === true;
  const woundedBonus = isWounded ? 1 : 0;
  // Attack-level body-check modifier (Traitor tw-105 +1, Cruel Caradhras td-9
  // +1, ...). The resolver adds it to the roll, so it lowers the roll needed to
  // eliminate the target by the same amount — the quoted `need` must match, or
  // the player is told the target is safer than it is.
  const attackBodyCheckModifier = combat.bodyCheckModifier ?? 0;
  const bcNeed = body + 1 - woundedBonus - attackBodyCheckModifier;
  const bcParts = [`${targetLabel} body ${body}`];
  if (woundedBonus) bcParts.push('+1 wounded');
  if (attackBodyCheckModifier) bcParts.push(`${formatSignedNumber(attackBodyCheckModifier)} attack`);

  logDetail(`${roller === combat.attackingPlayerId ? 'Attacker' : 'Defender'} rolls body check vs ${targetLabel} (body ${body}${isWounded ? ', wounded +1' : ''})`);
  return [{
    action: {
      type: 'body-check-roll',
      player: playerId,
      need: bcNeed,
      explanation: `Body check: need ${bcNeed}+ (${bcParts.join(', ')})`,
    },
    viable: true,
  }];
}

/**
 * Generate `tap-ally-body-check-boost` actions: while a body check against a
 * character (not an ally) is pending, the owner of an untapped in-play ally
 * carrying an `ally-body-check-boost` effect may tap it to add its value to
 * that character's effective body for the pending check — but only when the
 * ally itself was also struck by a strike from the same attack (both the ally
 * and its controlling character are targets of strikes from the same attack).
 *
 * Used by War-warg (le-156).
 */
function tapAllyBodyCheckBoostActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.bodyCheckTarget !== 'character') return [];
  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike) return [];

  const player = playerById(state, playerId);
  if (!player) return [];
  const charData = player.characters[strike.characterId];
  if (!charData) return [];

  const struckIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));

  const actions: EvaluatedAction[] = [];
  for (const ally of charData.allies) {
    if (ally.status !== CardStatus.Untapped) continue;
    if (!struckIds.has(ally.instanceId as string)) continue;
    const allyDef = defById(state, ally.definitionId);
    const boostEffect = getCardEffects(allyDef).find(
      (e): e is AllyBodyCheckBoostEffect => e.type === 'ally-body-check-boost',
    );
    if (!boostEffect) continue;
    const allyName = (allyDef as { name?: string } | undefined)?.name ?? (ally.definitionId as string);
    logDetail(`Tap-ally-body-check-boost available: ${allyName} (+${boostEffect.value} body to ${strike.characterId as string})`);
    actions.push({
      action: { type: 'tap-ally-body-check-boost', player: playerId, cardInstanceId: ally.instanceId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Generate the shield-discard-roll action offered to the attacking player
 * during the `'shield-discard-roll'` combat phase (Sable Shield, le-341).
 * The attacking player rolls 2d6; if the result strictly exceeds the item's
 * rollThreshold the shield is discarded, otherwise it stays in play.
 */
function shieldDiscardRollActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.attackingPlayerId) return [];
  if (!combat.shieldAbsorbItemId) return [];

  const itemDef = state.cardPool[
    (() => {
      const defPlayer = state.players.find(p => p.id === combat.defendingPlayerId);
      if (!defPlayer) return undefined;
      const strike = combat.strikeAssignments[combat.currentStrikeIndex];
      const charData = strike ? defPlayer.characters[strike.characterId] : undefined;
      return charData?.items.find(i => i.instanceId === combat.shieldAbsorbItemId)?.definitionId;
    })() ?? ('' as CardDefinitionId)
  ] as { effects?: readonly import('../../types/effects.js').CardEffect[] } | undefined;

  const absorbEffect = (itemDef?.effects ?? []).find(
    (e): e is import('../../types/effects.js').AbsorbWoundEffect => e.type === 'absorb-wound',
  );
  const threshold = absorbEffect?.rollThreshold ?? 6;

  logDetail(`Shield discard roll — attacker rolls; shield discarded if roll > ${threshold}`);
  return [{
    action: {
      type: 'shield-discard-roll' as const,
      player: playerId,
      rollThreshold: threshold,
      itemInstanceId: combat.shieldAbsorbItemId,
    },
    viable: true,
  }];
}

/**
 * Generate cancel-attack actions for the defending player during the
 * pre-assignment window (assign-strikes phase before any strikes assigned).
 *
 * Scans two sources for `cancel-attack` effects:
 * 1. Cards in the defending player's hand (short events like Concealment,
 *    Dark Quarrels).
 * 2. In-play allies attached to any character in the defending company
 *    (e.g. The Warg-king's "tap to cancel a Wolf or Animal attack"). For
 *    in-play sources the effect must declare `cost: { tap: "self" }`;
 *    the ally must be untapped. The action emits `cardInstanceId` of the
 *    ally itself — `handleCancelAttack` detects this and taps the ally
 *    instead of discarding from hand.
 */
/**
 * Offers `convert-creature-to-ally` actions (Ready to His Will le-220) to the
 * defending player during the creature's attack. The card may be played when:
 *
 * - the active attack is a single creature (`attackSource.type === 'creature'`),
 * - that creature's race is one of the effect's `races` and its printed strike
 *   count is ≤ `maxStrikes` ("one strike for each of its attacks"),
 * - the defender holds the card in hand, and
 * - the company has at least one untapped character to take control and tap.
 *
 * One action is generated per (card, eligible controlling character) pair.
 */
function convertCreatureToAllyActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];
  if (combat.attackSource.type !== 'creature') return [];

  const creatureDef = resolveDef(state, combat.attackSource.instanceId);
  if (!creatureDef || creatureDef.cardType !== 'hazard-creature') return [];
  const creatureRace = (creatureDef as { race: Race }).race;
  const creatureStrikes = (creatureDef as { strikes: number }).strikes;

  const player = playerById(state, playerId);
  if (!player) return [];
  const company = companyById(player.companies, combat.companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];
  for (const handCard of player.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const effect = getCardEffects(cardDef).find(
      (e): e is ConvertCreatureToAllyEffect => e.type === 'convert-creature-to-ally',
    );
    if (!effect) continue;
    if (creatureStrikes > effect.maxStrikes) {
      logDetail(`${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string}: creature has ${creatureStrikes} strikes (> ${effect.maxStrikes}) — not playable`);
      continue;
    }
    if (!effect.races.map(r => r.toLowerCase()).includes(creatureRace)) {
      logDetail(`${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string}: creature race "${creatureRace}" not eligible — not playable`);
      continue;
    }
    // Candidate controlling characters. When the card requires the controller
    // to tap (Ready to His Will le-220), only untapped characters qualify.
    // When it does not (Memories of Old Torture ba-67, "the character need
    // not tap"), any character in the company may take control.
    const candidateChars = effect.controllerTaps
      ? company.characters.filter(charId => {
          const ch = player.characters[charId];
          return ch && ch.status === CardStatus.Untapped;
        })
      : [...company.characters];
    if (candidateChars.length === 0) continue;
    for (const charId of candidateChars) {
      logDetail(`Convert-creature-to-ally available: "${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string}" controlled by ${charId as string}`);
      actions.push({
        action: {
          type: 'convert-creature-to-ally',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          controllingCharacterId: charId,
        },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Whether the defending player is currently in the pre-strike window during
 * which the attack as a whole may be canceled.
 *
 * Per CoE rule 3.ii.1 (Combat Step 1) the cancel/modify window precedes strike
 * assignment, and CRF 22 Annotation 13 confirms "an attack may not be canceled
 * once its strikes have been assigned".
 *
 * - Normal attacks: the defender's pre-assignment window during `assign-strikes`,
 *   before any strike has been assigned to a character.
 * - "Each character faces a strike" attacks (e.g. The Worthy Hills le-415):
 *   strikes are pre-assigned one per character and combat opens directly in
 *   `choose-strike-order` (multi-character) or `resolve-strike`
 *   (single-character) with no player-driven `assign-strikes` step. The rules
 *   cancel window still precedes that automatic assignment, so the defender may
 *   cancel until the first strike has resolved. Creature "each character faces
 *   one strike" attacks (e.g. Wandering Eldar le-97) do open an `assign-strikes`
 *   window and assign on the defender's `pass`; that pass sets
 *   `preAssignmentWindowClosed`, which ends the cancel window as usual.
 */
function inCancelWindow(combat: CombatState): boolean {
  if (combat.phase === 'assign-strikes') {
    return combat.strikeAssignments.length === 0;
  }
  if (combat.eachCharacterFacesOneStrike
    && !combat.preAssignmentWindowClosed
    && (combat.phase === 'choose-strike-order' || combat.phase === 'resolve-strike')) {
    return combat.strikeAssignments.every(sa => !sa.resolved);
  }
  return false;
}

/**
 * Candidate site-swap cancellations offered by an in-play card carrying a
 * `cancel-attack` effect with a `siteSwap` payload (Farmer Maggot as-48).
 *
 * "If one of your companies faces an attack while at a site in The Shire,
 * Arthedain, or Cardolan, you may immediately replace its site card with
 * another site card in The Shire, Arthedain, or Cardolan (from your location
 * deck)."
 *
 * Two gates apply:
 * - the defending company must be standing **at** a site in one of the listed
 *   regions. A company in the middle of a move is not "at" a site (its
 *   `currentSite` is only the origin it is leaving), so `destinationSite` must
 *   be null; and
 * - at least one site card in the controller's location deck must lie in one of
 *   those regions.
 *
 * One action is generated per candidate replacement site, each carrying its
 * instance id in `replacementSiteInstanceId` — the player chooses where to flee.
 */
function siteSwapCancelActions(
  state: GameState,
  playerId: PlayerId,
  player: PlayerState,
  company: import('../../types/state-cards.js').Company,
  hostCard: import('../../types/state-cards.js').CardInPlay,
  siteSwap: import('../../types/effects.js').SiteSwapCancel,
  label: string,
): EvaluatedAction[] {
  if (company.destinationSite) {
    logDetail(`Cancel-attack ${label}: company is moving — not "at a site", site swap unavailable`);
    return [];
  }
  if (!company.currentSite) {
    logDetail(`Cancel-attack ${label}: defending company has no current site — site swap unavailable`);
    return [];
  }
  const currentDef = defById(state, company.currentSite.definitionId);
  const currentRegion = currentDef && isSiteCard(currentDef) ? currentDef.region : undefined;
  if (!currentRegion || !siteSwap.regions.includes(currentRegion)) {
    logDetail(`Cancel-attack ${label}: company is at ${currentDef?.name ?? '?'} in "${currentRegion ?? 'unknown'}" — not one of [${siteSwap.regions.join(', ')}]`);
    return [];
  }
  const actions: EvaluatedAction[] = [];
  for (const siteInstance of player.siteDeck) {
    const siteDef = defById(state, siteInstance.definitionId);
    if (!siteDef || !isSiteCard(siteDef)) continue;
    if (!siteSwap.regions.includes(siteDef.region)) continue;
    logDetail(`Cancel-attack available: discard ${label} to replace ${currentDef?.name ?? '?'} with ${siteDef.name} (${siteDef.region})`);
    actions.push({
      action: {
        type: 'cancel-attack',
        player: playerId,
        cardInstanceId: hostCard.instanceId,
        replacementSiteInstanceId: siteInstance.instanceId,
      },
      viable: true,
    });
  }
  if (actions.length === 0) {
    logDetail(`Cancel-attack ${label}: no site in [${siteSwap.regions.join(', ')}] left in the location deck`);
  }
  return actions;
}

function cancelAttackActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  // Only the defending player can cancel, and only during the pre-strike
  // cancel window (see inCancelWindow). Each-character auto-attacks open
  // directly at choose-strike-order/resolve-strike, so the window is not
  // limited to the `assign-strikes` phase.
  if (playerId !== combat.defendingPlayerId) return [];
  if (!inCancelWindow(combat)) return [];
  // Forewarned Is Forearmed: isolated attacks cannot be canceled
  if (combat.uncancelable) {
    logDetail(`Cancel-attack suppressed: attack is uncancelable (Forewarned Is Forearmed)`);
    return [];
  }
  // Forced-strike targets (e.g. Alatar's haven-join, CRF 22: "he must face a
  // strike from that creature in all cases" / "overrides all other effects
  // pertaining to the assigning of strikes") cannot have their strike averted
  // by canceling the whole attack out from under them — the same override
  // that bypasses the tapped-status gate for these targets also blocks
  // cancellation while one is still pending.
  if (combat.forcedStrikeTargets && combat.forcedStrikeTargets.length > 0) {
    logDetail(`Cancel-attack suppressed: forced strike target(s) pending (${combat.forcedStrikeTargets.join(', ')})`);
    return [];
  }

  const player = playerById(state, playerId);
  if (!player) return [];
  const company = companyById(player.companies, combat.companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];

  // Resolve the defending company's site type so cancel-attack `when` clauses
  // can gate on `bearer.atHaven` (used by cards like Adûnaphel the Ringwraith,
  // which may tap to cancel only when at a Darkhaven).
  const siteDef = company.currentSite ? state.cardPool[company.currentSite.definitionId] : undefined;
  const siteType = siteDef && isSiteCard(siteDef) ? siteDef.siteType : null;
  const atHaven = siteType === SiteType.Haven;

  // Region the company is moving to (the destination site's region), or
  // undefined when the company is not moving. Lets a cancel-attack `when`
  // gate on "a company moving to a site in <regions>" — e.g. Last Child of
  // Ungoliant (le-153): Imlad Morgul / Ithilien / Gorgoroth.
  const destSiteDef = company.destinationSite ? state.cardPool[company.destinationSite.definitionId] : undefined;
  const destinationRegion = destSiteDef && isSiteCard(destSiteDef) ? destSiteDef.region : undefined;

  // Whether the defending company is at, or moving to or from, an Under-deeps
  // site. During movement `currentSite` is the origin and `destinationSite` the
  // target, so checking both covers "at" (origin, not moving), "moving from"
  // (origin), and "moving to" (destination). Lets a cancel-attack `when` gate on
  // `attack.atUnderDeeps` — Great Fissure (ba-61).
  const hasUnderDeeps = (d: unknown): boolean =>
    !!d && 'keywords' in (d as object)
    && !!(d as { keywords?: readonly string[] }).keywords?.includes('under-deeps');
  const atUnderDeeps = hasUnderDeeps(siteDef) || hasUnderDeeps(destSiteDef);

  // `enemy.unique` — the attacking creature's printed uniqueness, resolved
  // from its CardDefinition. Only known for creature-sourced attacks (played
  // hazard creatures, on-guard reveals, and played-auto-attacks); absent for
  // site automatic-attacks and other sources, which have no creature card.
  // Lets a card gate on "a non-unique hazard creature" (Fifteen Birds in Five
  // Firtrees dm-129) — hoisted above `whenContext` so the deferred
  // free-attack-cancel offering below can reuse it without recomputing.
  const enemyCreatureInstanceId = attackSourceCreatureInstanceId(combat);
  const enemyCreatureDef = enemyCreatureInstanceId ? resolveDef(state, enemyCreatureInstanceId) : undefined;
  const creatureUnique = (enemyCreatureDef as { unique?: boolean } | undefined)?.unique;

  const whenContext = (): Record<string, unknown> => {
    const ctx: Record<string, unknown> = {};
    if (combat.creatureRace || creatureUnique !== undefined) {
      ctx['enemy'] = { race: combat.creatureRace, unique: creatureUnique };
    }
    // Always expose `attack.source` (the AttackSource discriminator) so
    // cards can distinguish M/H creatures from on-guard reveals and site
    // automatic attacks. `attack.keying` is additive when present.
    // `attack.siteKeyed` is true for creature attacks whose keying has no
    // regional types (i.e. keyed purely to site types or site names).
    const attackCtx: Record<string, unknown> = { source: combat.attackSource.type };
    if (combat.attackKeying && combat.attackKeying.length > 0) {
      attackCtx['keying'] = combat.attackKeying;
    }
    // Site-type keying (e.g. a creature keyed to a Ruins & Lairs [{R}]). Lets a
    // card gate on "an attack keyed to Ruins & Lairs" (Wild Hounds wh-40).
    if (combat.attackSiteKeyingTypes && combat.attackSiteKeyingTypes.length > 0) {
      attackCtx['siteKeyingTypes'] = combat.attackSiteKeyingTypes;
    }
    // Region-name keying (e.g. a creature keyed by name to "Fangorn"). Lets a
    // card gate on "an attack keyed by name to <one of these regions>" (Beasts
    // of the Wood wh-38) via `attack.keyingRegionNames $includes <name>`.
    if (combat.attackKeyingRegionNames && combat.attackKeyingRegionNames.length > 0) {
      attackCtx['keyingRegionNames'] = combat.attackKeyingRegionNames;
    }
    const isSiteKeyedCreature = (
      combat.attackSource.type === 'creature' || combat.attackSource.type === 'on-guard-creature'
    ) && !(combat.attackKeying && combat.attackKeying.length > 0);
    attackCtx['siteKeyed'] = isSiteKeyedCreature;
    // `attack.heroCompany` is true only for character-vs-character combat in
    // which the attacking company belongs to a hero-side player (Wizard or
    // Fallen-wizard avatar). Hazard creature / automatic attacks are never a
    // "company" and so are never hero-company. Backs Helm of Fear's clause
    // "May not cancel combat with a hero company."
    let heroCompany = false;
    if (combat.isCvCC) {
      const atkAlignment = playerById(state, combat.attackingPlayerId)?.alignment;
      heroCompany = atkAlignment === Alignment.Wizard || atkAlignment === Alignment.FallenWizard;
    }
    attackCtx['heroCompany'] = heroCompany;
    // Whether the defending company is at, or moving to or from, an Under-deeps
    // site. Backs Great Fissure (ba-61): "cancel an attack against a company at,
    // or moving to or from, an Under-deeps site."
    attackCtx['atUnderDeeps'] = atUnderDeeps;
    ctx['attack'] = attackCtx;
    ctx['bearer'] = { companySize: company.characters.length, atHaven, destinationRegion };
    // The defending company's current site type (e.g. "ruins-and-lairs"). Lets a
    // card gate on "an automatic-attack at a Ruins & Lairs" (Wild Hounds wh-40).
    ctx['site'] = { type: siteType };
    // `defender.companyContainsBalrog` gates "an attack against The Balrog's
    // company"; `defender.inPlay` is attachment-aware (covers a permanent event
    // on The Balrog such as Great Shadow) — both back Darkness Wielded (ba-55).
    ctx['defender'] = {
      covert: isCovertCompany(company, player, state),
      companyContainsBalrog: companyContainsBalrogAvatar(state, player, company),
      inPlay: inPlayNamesForPlayerDeep(state, player),
    };
    return ctx;
  };

  // In-play characters in the defending company with a cancel-attack effect
  // and a "tap self" cost (e.g. Adûnaphel the Ringwraith's Darkhaven tap).
  for (const charId of company.characters) {
    const charData = player.characters[charId];
    if (!charData) continue;
    const charDef = defById(state, charData.definitionId);
    if (!charDef) continue;
    const cancelEffect = getCardEffects(charDef).find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    if (!cancelEffect) continue;
    if (cancelEffect.cost?.tap !== 'self') continue;
    if (charData.status !== CardStatus.Untapped) {
      logDetail(`Cancel-attack ${charDef.name ?? charData.definitionId as string}: character tapped, cannot activate`);
      continue;
    }
    if (cancelEffect.when && !matchesCondition(cancelEffect.when, whenContext())) {
      logDetail(`Cancel-attack ${charDef.name ?? charData.definitionId as string}: when condition not met (attack source: ${combat.attackSource.type}, atHaven: ${atHaven})`);
      continue;
    }
    logDetail(`Cancel-attack available: tap ${charDef.name ?? charData.definitionId as string} (in-play character)`);
    actions.push({
      action: {
        type: 'cancel-attack',
        player: playerId,
        cardInstanceId: charId,
      },
      viable: true,
    });
  }

  // In-play allies in the defending company with a cancel-attack effect
  // and a "tap self" cost (e.g. The Warg-king).
  for (const { ally } of findCompanyAllies(player, company.characters)) {
    const allyDef = defById(state, ally.definitionId);
    if (!allyDef) continue;
    const cancelEffect = getCardEffects(allyDef).find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    if (!cancelEffect) continue;
    if (cancelEffect.cost?.tap !== 'self') continue;
    if (ally.status !== CardStatus.Untapped) {
      logDetail(`Cancel-attack ${allyDef.name ?? ally.definitionId as string}: ally tapped, cannot activate`);
      continue;
    }
    if (cancelEffect.when && !matchesCondition(cancelEffect.when, whenContext())) {
      logDetail(`Cancel-attack ${allyDef.name ?? ally.definitionId as string}: when condition not met (creature race: ${combat.creatureRace ?? 'none'})`);
      continue;
    }
    logDetail(`Cancel-attack available: tap ${allyDef.name ?? ally.definitionId as string} (in-play ally)`);
    actions.push({
      action: {
        type: 'cancel-attack',
        player: playerId,
        cardInstanceId: ally.instanceId,
      },
      viable: true,
    });
  }

  // In-play items attached to characters in the defending company with a
  // cancel-attack effect. Supported tap costs:
  //   "self"            — tap the item only (e.g. Helm of Fear as-126);
  //                       the bearer's status is irrelevant.
  //   "self-and-bearer" — tap item AND bearer (e.g. Torque of Hues); both
  //                       must be untapped.
  //   "bearer"          — tap bearer only (e.g. Star-glass); bearer untapped.
  for (const charId of company.characters) {
    const charData = player.characters[charId];
    if (!charData) continue;
    // Printed skills only (mirrors the cancel-strike `bearer.skills` convention —
    // charDef.skills, not getEffectiveSkills — so a ring's own `grant-skill`
    // effect never retroactively satisfies its own "if the bearer is already a
    // <skill>" gate). Lets an item's `when` clause gate on the bearer's skills,
    // e.g. Magic Ring of Nature (tw-273): "If the bearer is already a ranger, he
    // may tap to cancel an attack against his company."
    const bearerCharDef = defById(state, charData.definitionId);
    const bearerSkills = bearerCharDef && isCharacterCard(bearerCharDef) ? bearerCharDef.skills : [];
    for (const item of charData.items) {
      const itemDef = defById(state, item.definitionId);
      if (!itemDef) continue;
      const cancelEffect = getCardEffects(itemDef).find(
        (e): e is CancelAttackEffect => e.type === 'cancel-attack',
      );
      if (!cancelEffect) continue;
      const tapCost = cancelEffect.cost?.tap;
      if (tapCost !== 'self' && tapCost !== 'self-and-bearer' && tapCost !== 'bearer') continue;
      const itemName = (itemDef as { name?: string }).name ?? (item.definitionId as string);
      // Costs that tap the item require the item itself to be untapped.
      if ((tapCost === 'self' || tapCost === 'self-and-bearer') && item.status !== CardStatus.Untapped) {
        logDetail(`Cancel-attack ${itemName}: item tapped, cannot activate`);
        continue;
      }
      // Costs that tap the bearer require the bearer to be untapped.
      if ((tapCost === 'bearer' || tapCost === 'self-and-bearer') && charData.status !== CardStatus.Untapped) {
        logDetail(`Cancel-attack ${itemName}: bearer tapped, cannot activate`);
        continue;
      }
      if (cancelEffect.when) {
        const baseCtx = whenContext();
        const itemCtx = { ...baseCtx, bearer: { ...(baseCtx.bearer as object), skills: bearerSkills } };
        if (!matchesCondition(cancelEffect.when, itemCtx)) {
          logDetail(`Cancel-attack ${itemName}: when condition not met`);
          continue;
        }
      }
      logDetail(`Cancel-attack available: tap ${tapCost === 'bearer' ? 'bearer via' : ''} ${itemName} (in-play item)`);
      actions.push({
        action: {
          type: 'cancel-attack',
          player: playerId,
          cardInstanceId: item.instanceId,
        },
        viable: true,
      });
    }
  }

  // Wild Hounds family (wh-40) / Beasts of the Wood family (wh-38): a
  // dual-alignment faction carrying a `cancel-attack` effect with
  // `handModeRequiresCovert`. Two sources:
  //   (a) the controlled faction in play — paid with the effect's cost
  //       (`discard: "self"` for wh-40, `tap: "self"` for wh-38), available to
  //       whoever controls it, no covert/alignment gate; and
  //   (b) the card in hand — played as a minion resource, but ONLY by a covert
  //       company and only by a minion (Ringwraith) player.
  // Both are handled here so they are not double-offered by the generic hand
  // loop below (which skips discard-cost / tap-cost cancel-attack cards).
  for (const inPlayCard of player.cardsInPlay) {
    const def = defById(state, inPlayCard.definitionId);
    const cancelEffect = getCardEffects(def).find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    if (!cancelEffect) continue;
    const inPlayCost = cancelEffect.cost;
    const discardCost = inPlayCost?.discard === 'self';
    const tapCost = inPlayCost?.tap === 'self';
    if (!discardCost && !tapCost) continue;
    // Site-swap cancel (Farmer Maggot as-48): the card is discarded to replace
    // the defending company's site card with another from the location deck,
    // canceling the attack. One action per candidate replacement site — the
    // player picks which site to flee to.
    if (cancelEffect.siteSwap) {
      const label = (def as { name?: string })?.name ?? inPlayCard.definitionId as string;
      for (const evaluated of siteSwapCancelActions(
        state, playerId, player, company, inPlayCard, cancelEffect.siteSwap, label,
      )) {
        actions.push(evaluated);
      }
      continue;
    }
    // A tap-cost faction (Beasts of the Wood wh-38) must itself be untapped.
    if (tapCost && inPlayCard.status !== CardStatus.Untapped) {
      logDetail(`Cancel-attack ${(def as { name?: string })?.name ?? inPlayCard.definitionId as string}: in-play faction is tapped, cannot tap to cancel`);
      continue;
    }
    // Company-bound restriction cards (Going Ever Under Dark ba-37) may only
    // cancel an attack against their own company, and only in company-vs-company
    // combat ("an attack against them by an opponent's company").
    if (inPlayCard.companyId && inPlayCard.companyId !== combat.companyId) {
      logDetail(`Cancel-attack ${(def as { name?: string })?.name ?? inPlayCard.definitionId as string}: bound to a different company — skipping`);
      continue;
    }
    if (cancelEffect.requiresCvCC && !combat.isCvCC) {
      logDetail(`Cancel-attack ${(def as { name?: string })?.name ?? inPlayCard.definitionId as string}: requires a company-vs-company attack — skipping`);
      continue;
    }
    if (cancelEffect.when && !matchesCondition(cancelEffect.when, whenContext())) {
      logDetail(`Cancel-attack ${(def as { name?: string })?.name ?? inPlayCard.definitionId as string}: when condition not met (in-play faction)`);
      continue;
    }
    logDetail(`Cancel-attack available: ${tapCost ? 'tap' : 'discard'} ${(def as { name?: string })?.name ?? inPlayCard.definitionId as string} (in-play faction)`);
    actions.push({
      action: { type: 'cancel-attack', player: playerId, cardInstanceId: inPlayCard.instanceId },
      viable: true,
    });
  }
  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    const cancelEffect = getCardEffects(def).find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    if (!cancelEffect || !cancelEffect.handModeRequiresCovert) continue;
    // "Playable if …" gates on the player's own state (e.g. Eye Never
    // Sleeping as-82: playable only while the player counts as Sauron) apply
    // whenever the card is played from hand.
    const covertModePlayerState = findPlayConditionEffect(def, 'player-state');
    if (covertModePlayerState?.condition
      && !matchesCondition(covertModePlayerState.condition, buildPlayerStateContext(state, player, playerId))) {
      logDetail(`Cancel-attack ${(def as { name?: string })?.name ?? handCard.definitionId as string}: play-condition player-state not satisfied`);
      continue;
    }
    // Minion resource card, only playable by a character in a covert company.
    if (player.alignment !== Alignment.Ringwraith) {
      logDetail(`Cancel-attack ${(def as { name?: string })?.name ?? handCard.definitionId as string}: hand (minion resource) mode requires a minion player`);
      continue;
    }
    if (!isCovertCompany(company, player, state)) {
      logDetail(`Cancel-attack ${(def as { name?: string })?.name ?? handCard.definitionId as string}: hand (minion resource) mode requires a covert company`);
      continue;
    }
    if (cancelEffect.when && !matchesCondition(cancelEffect.when, whenContext())) {
      logDetail(`Cancel-attack ${(def as { name?: string })?.name ?? handCard.definitionId as string}: when condition not met (minion resource)`);
      continue;
    }
    logDetail(`Cancel-attack available: play ${(def as { name?: string })?.name ?? handCard.definitionId as string} from hand (minion resource, covert company)`);
    actions.push({
      action: { type: 'cancel-attack', player: playerId, cardInstanceId: handCard.instanceId },
      viable: true,
    });
  }

  for (const handCard of player.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const cancelEffect = getCardEffects(cardDef).find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    if (!cancelEffect) continue;

    // Any tap cost involving the card itself or its bearer requires the card to
    // be in play as an equipped item. The in-play items section above already
    // handles 'self-and-bearer' and 'bearer'; 'self' is for ally/character
    // abilities also handled above. Skip all of these for hand cards.
    const tapCost = cancelEffect.cost?.tap;
    if (tapCost === 'self' || tapCost === 'self-and-bearer' || tapCost === 'bearer') {
      logDetail(`Cancel-attack ${handCard.definitionId as string}: tap cost "${tapCost}" requires card in play, skipping hand card`);
      continue;
    }
    // A `discard: "self"` cancel-attack is the Wild Hounds dual-faction mode
    // handled by the dedicated blocks above — do not also offer it here.
    if (cancelEffect.cost?.discard === 'self') {
      continue;
    }

    // play-condition requires: "player-state" — a "Playable if …" gate on the
    // player's own state, evaluated against the same context as the
    // organization-phase and any-phase short-event paths. Eye Never Sleeping
    // (as-82): "Playable if you are Sauron" via player.playsAsSauron.
    const playerStateCondition = findPlayConditionEffect(cardDef, 'player-state');
    if (playerStateCondition?.condition
      && !matchesCondition(playerStateCondition.condition, buildPlayerStateContext(state, player, playerId))) {
      logDetail(`Cancel-attack ${handCard.definitionId as string}: play-condition player-state not satisfied`);
      continue;
    }

    // Attack-scoped duplication check: if the card has duplication-limit scope
    // "attack", count already-played copies via activeConstraints markers.
    const cancelAttackDupLimit = findDuplicationLimitEffect(cardDef, 'attack');
    if (cancelAttackDupLimit) {
      const prior = countConstraintsFromDefinition(state, handCard.definitionId, 'attack');
      if (prior >= cancelAttackDupLimit.max) {
        logDetail(`Cancel-attack ${handCard.definitionId as string}: attack duplication limit reached (${prior}/${cancelAttackDupLimit.max})`);
        continue;
      }
    }

    // Turn-scoped duplication check: "Cannot be duplicated on a given turn"
    // (Fifteen Birds in Five Firtrees dm-129).
    const cancelTurnDupLimit = findDuplicationLimitEffect(cardDef, 'turn');
    if (cancelTurnDupLimit) {
      const prior = countConstraintsFromDefinition(state, handCard.definitionId, 'turn');
      if (prior >= cancelTurnDupLimit.max) {
        logDetail(`Cancel-attack ${handCard.definitionId as string}: turn duplication limit reached (${prior}/${cancelTurnDupLimit.max})`);
        continue;
      }
    }

    // Check `when` condition against full combat context (enemy.race, attack.source, attack.siteKeyed, etc.)
    if (cancelEffect.when && !matchesCondition(cancelEffect.when, whenContext())) {
      logDetail(`Cancel-attack ${handCard.definitionId as string}: when condition not met (creature race: ${combat.creatureRace ?? 'none'})`);
      continue;
    }

    // Cards with set-character-status { status: "inverted", target: "target-character" }
    // (e.g. Escape): one action per unwounded character in the defending company —
    // the player chooses which character to wound when they play the card.
    const hasWound = getCardEffects(cardDef).some(
      e => e.type === 'set-character-status'
        && (e as { status?: string }).status === 'inverted'
        && (e as { target?: string }).target === 'target-character',
    );
    if (!cancelEffect.requiredSkill && !cancelEffect.requiredRace && hasWound) {
      for (const charId of company.characters) {
        const charData = player.characters[charId];
        if (!charData) continue;
        if (charData.status === CardStatus.Inverted) {
          logDetail(`Cancel-attack (wound) ${handCard.definitionId as string}: skip wounded character ${charId as string}`);
          continue;
        }
        logDetail(`Cancel-attack (wound) ${handCard.definitionId as string}: targeting character ${charId as string}`);
        actions.push({
          action: {
            type: 'cancel-attack',
            player: playerId,
            cardInstanceId: handCard.instanceId,
            targetCharacterId: charId,
          },
          viable: true,
        });
      }
      continue;
    }

    // Costless cancel-attack: no skill/race requirement and no tap/check cost
    // (e.g. Dark Quarrels). A card with a cost but no skill/race requirement
    // (any character may pay) falls through to the character-gated branch
    // below instead (e.g. Praise to Elbereth tw-305).
    if (!cancelEffect.requiredSkill && !cancelEffect.requiredRace && !cancelEffect.cost) {
      logDetail(`Cancel-attack available (no cost): ${handCard.definitionId as string}`);
      actions.push({
        action: {
          type: 'cancel-attack',
          player: playerId,
          cardInstanceId: handCard.instanceId,
        },
        viable: true,
      });
      continue;
    }

    // Character-gated cancel-attack: a character matching requiredSkill or
    // requiredRace must be in the company. When the effect has a tap cost,
    // the character must be untapped (one action per qualifying character).
    // When the cost is a check (e.g. corruption), tapped characters qualify
    // too. When there is no cost, any matching character suffices. When
    // neither requiredSkill nor requiredRace is set but a cost is present,
    // any character in the company may pay it (e.g. Praise to Elbereth
    // tw-305: "For each of your characters ... that you choose to tap ...
    // cancel one Nazgûl attack" — no skill/race requirement).
    const matchesRequirement = (charDef: import('../../types/cards.js').CharacterCard): boolean => {
      if (cancelEffect.requiredSkill) {
        return charDef.skills.includes(cancelEffect.requiredSkill as import('../../types/common.js').Skill);
      }
      if (cancelEffect.requiredRace) {
        return charDef.race === cancelEffect.requiredRace;
      }
      return true;
    };

    if (cancelEffect.cost) {
      for (const charId of company.characters) {
        const charData = player.characters[charId];
        if (!charData) continue;
        if (!canPayCost(cancelEffect.cost, charData)) continue;

        const charDef = defById(state, charData.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;
        if (!matchesRequirement(charDef)) continue;

        const costKind = cancelEffect.cost.tap ? 'tap' : 'check';
        logDetail(`Cancel-attack available: ${handCard.definitionId as string} via ${charData.definitionId as string} (${costKind} cost)`);
        actions.push({
          action: {
            type: 'cancel-attack',
            player: playerId,
            cardInstanceId: handCard.instanceId,
            scoutInstanceId: charId,
          },
          viable: true,
        });
        // Dual-mode cards (e.g. The Tormented Earth) also offer a
        // "reduce attack prowess" variant paid by the same character.
        if (cancelEffect.prowessPenalty !== undefined) {
          logDetail(`Reduce-prowess (-${cancelEffect.prowessPenalty}) available: ${handCard.definitionId as string} via ${charData.definitionId as string}`);
          actions.push({
            action: {
              type: 'cancel-attack',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              scoutInstanceId: charId,
              mode: 'reduce-prowess',
            },
            viable: true,
          });
        }
      }
    } else {
      const hasMatch = company.characters.some(charId => {
        const charData = player.characters[charId];
        if (!charData) return false;
        const charDef = defById(state, charData.definitionId);
        if (!charDef || !isCharacterCard(charDef)) return false;
        return matchesRequirement(charDef);
      });
      if (hasMatch) {
        logDetail(`Cancel-attack available (no tap cost): ${handCard.definitionId as string}`);
        actions.push({
          action: {
            type: 'cancel-attack',
            player: playerId,
            cardInstanceId: handCard.instanceId,
          },
          viable: true,
        });
      }
    }
  }

  // Flattery-cancel-attack: hand cards with a `flattery-cancel-attack` effect
  // (e.g. Flatter a Foe). Only offered when the attacking creature's race has
  // a threshold entry in the effect. One `cancel-attack` action is emitted per
  // character in the defending company (the player selects who makes the attempt).
  for (const handCard of player.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const flatEffect = getCardEffects(cardDef).find(
      (e): e is FlatteryCancelAttackEffect => e.type === 'flattery-cancel-attack',
    );
    if (!flatEffect) continue;

    if (!combat.creatureRace) {
      logDetail(`Flattery-cancel-attack ${handCard.definitionId as string}: no creature race — skipping`);
      continue;
    }
    const matchedEntry = flatEffect.thresholds.find(t => t.races.includes(combat.creatureRace!));
    if (!matchedEntry) {
      logDetail(`Flattery-cancel-attack ${handCard.definitionId as string}: race "${combat.creatureRace}" not in thresholds — skipping`);
      continue;
    }

    // One action per character in the company — player picks who makes the attempt
    for (const charId of company.characters) {
      logDetail(`Flattery-cancel-attack ${handCard.definitionId as string}: offering for character ${charId as string}`);
      actions.push({
        action: {
          type: 'cancel-attack',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          targetCharacterId: charId,
        },
        viable: true,
      });
    }
  }

  // Riddling-attempt: hand cards with a `riddling-attempt` effect (e.g.
  // Riddling Talk). Only offered when the attacking creature's race has a
  // threshold entry in the effect. One `cancel-attack` action is emitted per
  // character in the defending company (the player selects who makes the
  // attempt) — the roll and, on success, the guess happen in later pending
  // resolutions.
  for (const handCard of player.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const riddlingEffect = getCardEffects(cardDef).find(
      (e): e is RiddlingAttemptEffect => e.type === 'riddling-attempt',
    );
    if (!riddlingEffect) continue;

    if (!combat.creatureRace) {
      logDetail(`Riddling-attempt ${handCard.definitionId as string}: no creature race — skipping`);
      continue;
    }
    const matchedEntry = riddlingEffect.thresholds.find(t => t.races.includes(combat.creatureRace!));
    if (!matchedEntry) {
      logDetail(`Riddling-attempt ${handCard.definitionId as string}: race "${combat.creatureRace}" not in thresholds — skipping`);
      continue;
    }

    for (const charId of company.characters) {
      logDetail(`Riddling-attempt ${handCard.definitionId as string}: offering for character ${charId as string}`);
      actions.push({
        action: {
          type: 'cancel-attack',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          targetCharacterId: charId,
        },
        viable: true,
      });
    }
  }

  // Goodwill-cancel-attack: hand cards with a `goodwill-cancel-attack` effect
  // (e.g. Token of Goodwill dm-160). Only offered when the facing attack's
  // race (or, for `matchAnyAgentAttack` entries, an Agent attack source) has
  // a threshold entry, the target is a diplomat, and the diplomat's company
  // carries at least one item of the entry's rank to discard.
  for (const handCard of player.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const goodwillEffect = getCardEffects(cardDef).find(
      (e): e is GoodwillCancelAttackEffect => e.type === 'goodwill-cancel-attack',
    );
    if (!goodwillEffect) continue;

    const isAgentAttack = combat.attackSource.type === 'agent';
    const matchedEntry = goodwillEffect.thresholds.find(t =>
      (combat.creatureRace !== undefined && t.races.includes(combat.creatureRace))
      || (t.matchAnyAgentAttack === true && isAgentAttack));
    if (!matchedEntry) {
      logDetail(`Goodwill-cancel-attack ${handCard.definitionId as string}: no matching race/Agent threshold — skipping`);
      continue;
    }

    const hasMatchingItem = company.characters.some(charId => {
      const bearer = player.characters[charId];
      if (!bearer) return false;
      return bearer.items.some(item => {
        const itemDef = defById(state, item.definitionId);
        return itemDef && isItemCard(itemDef) && itemDef.subtype === matchedEntry.itemSubtype;
      });
    });
    if (!hasMatchingItem) {
      logDetail(`Goodwill-cancel-attack ${handCard.definitionId as string}: no ${matchedEntry.itemSubtype} item in company — skipping`);
      continue;
    }

    // One action per diplomat in the company — player picks who makes the attempt
    for (const charId of company.characters) {
      const charData = player.characters[charId];
      if (!charData) continue;
      const charDef = defById(state, charData.definitionId);
      if (!charDef || !isCharacterCard(charDef) || !charDef.skills.includes(Skill.Diplomat)) continue;
      logDetail(`Goodwill-cancel-attack ${handCard.definitionId as string}: offering for diplomat ${charId as string}`);
      actions.push({
        action: {
          type: 'cancel-attack',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          targetCharacterId: charId,
        },
        viable: true,
      });
    }
  }

  // Deferred free cancellation (Darkness Wielded ba-55; Fifteen Birds in Five
  // Firtrees dm-129): a `free-attack-cancel` constraint granted earlier this
  // turn lets the defending player cancel one later attack at no cost.
  // Offered once per available constraint while the defending company/attack
  // qualifies.
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'free-attack-cancel') continue;
    if (constraint.target.kind !== 'player' || constraint.target.playerId !== playerId) continue;
    if (constraint.kind.restrictToBalrogCompany && !companyContainsBalrogAvatar(state, player, company)) {
      logDetail(`Free-later-cancel (${constraint.sourceDefinitionId as string}): defending company has no Balrog — not offered`);
      continue;
    }
    if (constraint.kind.restrictToCompanyId && constraint.kind.restrictToCompanyId !== company.id) {
      logDetail(`Free-later-cancel (${constraint.sourceDefinitionId as string}): granted to a different company — not offered`);
      continue;
    }
    if (constraint.kind.requireNonUniqueCreature && creatureUnique === true) {
      logDetail(`Free-later-cancel (${constraint.sourceDefinitionId as string}): attacking creature is unique — not offered`);
      continue;
    }
    logDetail(`Free-later-cancel available: ${constraint.sourceDefinitionId as string} grants a free cancellation of this attack`);
    actions.push({
      action: {
        type: 'cancel-attack',
        player: playerId,
        cardInstanceId: constraint.source,
        mode: 'free-later-cancel',
      },
      viable: true,
    });
  }

  // The Hunt (dm-143): "cannot use ... spells against the attack" drops every
  // cancel-attack option sourced from a `spell`-keyword card (Vanishment
  // tw-356, Wizard's River-horses tw-364), regardless of which loop above
  // offered it.
  if (combat.spellsIneffective) {
    return actions.filter(a => {
      if (a.action.type !== 'cancel-attack') return true;
      const def = resolveDef(state, a.action.cardInstanceId);
      const isSpell = !!def && 'keywords' in def && (def as { keywords?: readonly string[] }).keywords?.includes('spell');
      if (isSpell) {
        logDetail(`Cancel-attack ${(def as { name?: string })?.name ?? a.action.cardInstanceId as string}: suppressed — spells cannot be used against this attack (The Hunt)`);
      }
      return !isSpell;
    });
  }

  return actions;
}

/**
 * Generate protect-from-assignment actions for the defending player during
 * the assign-strikes phase. For each card in hand with a
 * `protect-from-strike-assignment` effect, one action is generated per
 * qualifying character in the defending company (those with the required
 * skill). Playing the card protects the chosen character from receiving any
 * strike in the current attack.
 *
 * Used by Ruse (le-225) mode B: play on a scout; no strikes may be assigned.
 */
function protectFromStrikeAssignmentActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.phase !== 'assign-strikes') return [];

  const player = playerById(state, playerId);
  if (!player) return [];
  const company = companyById(player.companies, combat.companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const protEff = getCardEffects(cardDef).find(
      (e): e is ProtectFromStrikeAssignmentEffect => e.type === 'protect-from-strike-assignment',
    );
    if (!protEff) continue;

    // Shared once per card: used both by the `filter`'s `company.hasShadowMagicUser`
    // context (Sojourn in Shadows wh-49) and, on play, by the corruptionCheck target.
    const hasShadowMagicUser = companyShadowMagicUsers(state, player, company).length > 0;

    for (const charId of company.characters) {
      const charData = player.characters[charId];
      if (!charData) continue;
      const charDef = defById(state, charData.definitionId);
      if (!charDef || !isCharacterCard(charDef)) continue;
      if (protEff.requiredSkill && !charDef.skills.includes(protEff.requiredSkill as import('../../types/common.js').Skill)) {
        logDetail(`protect-from-assignment ${handCard.definitionId as string}: ${charDef.name ?? charId as string} lacks skill "${protEff.requiredSkill}" — skipping`);
        continue;
      }
      if (protEff.filter) {
        const ctx = {
          target: {
            race: charDef.race,
            status: charData.status,
            skills: charDef.skills,
            name: charDef.name,
          },
          company: { hasShadowMagicUser },
        };
        if (!matchesCondition(protEff.filter, ctx)) {
          logDetail(`protect-from-assignment ${handCard.definitionId as string}: ${charDef.name ?? charId as string} fails filter — skipping`);
          continue;
        }
      }
      logDetail(`protect-from-assignment available: ${handCard.definitionId as string} can protect ${charDef.name ?? charId as string}`);
      actions.push({
        action: {
          type: 'protect-from-assignment',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          targetCharacterId: charId,
        },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Generate halve-strikes actions for the defending player during the
 * pre-assignment window. For each card in hand with a `halve-strikes`
 * effect whose `when` condition matches the combat context, generate
 * an action to play it (e.g. Dark Quarrels alternative mode).
 */
function halveStrikesActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const halveEffect = getCardEffects(cardDef).find(
      (e): e is HalveStrikesEffect => e.type === 'halve-strikes',
    );
    if (!halveEffect) continue;

    // Check `when` condition (e.g. "inPlay": "Gates of Morning")
    if (halveEffect.when) {
      const inPlayNames = buildInPlayNames(state);
      const ctx: Record<string, unknown> = { inPlay: inPlayNames };
      if (combat.creatureRace) {
        ctx['enemy'] = { race: combat.creatureRace };
      }
      ctx['attack'] = { source: combat.attackSource.type };
      if (!matchesCondition(halveEffect.when, ctx)) {
        logDetail(`Halve-strikes ${handCard.definitionId as string}: when condition not met`);
        continue;
      }
    }

    logDetail(`Halve-strikes available: ${handCard.definitionId as string}`);
    actions.push({
      action: {
        type: 'halve-strikes',
        player: playerId,
        cardInstanceId: handCard.instanceId,
      },
      viable: true,
    });
  }

  return actions;
}

/**
 * Resolve a CvCC combat into the four objects every Balrog CvCC card scanner
 * needs: the acting player with their participating company, and the opposing
 * player with theirs.
 *
 * {@link cancelWeaponActions}, {@link combatDiscardOpponentItemActions} and
 * {@link siteStormAtSiteActions} each repeated the same chain — {@link cvccSides}
 * to name the two companies, then `playerById`/`companyById` to resolve each of
 * them.
 *
 * @returns undefined if any step fails, which includes the acting player not
 * being a combatant in this CvCC.
 */
function cvccParticipants(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): {
  player: PlayerState;
  myCompany: Company;
  oppPlayer: PlayerState;
  oppCompany: Company;
} | undefined {
  const player = playerById(state, playerId);
  if (!player) return undefined;

  const sides = cvccSides(combat, playerId);
  if (!sides) return undefined;

  const myCompany = companyById(player.companies, sides.myCompanyId);
  if (!myCompany) return undefined;

  const oppPlayer = playerById(state, sides.oppPlayerId);
  if (!oppPlayer) return undefined;

  const oppCompany = companyById(oppPlayer.companies, sides.oppCompanyId);
  if (!oppCompany) return undefined;

  return { player, myCompany, oppPlayer, oppCompany };
}

/**
 * Whip of Many Thongs (ba-82) — `cancel-weapon-effects` actions.
 *
 * During a company-vs-company combat, the controller of an in-play
 * `combat-cancel-weapon` item (borne by The Balrog and untapped) may tap it to
 * cancel all effects of one weapon in the *opposing* company until the end of
 * the combat. One action is offered per un-suppressed `weapon`-keyword item on a
 * character in the opponent's company. Only the item's controller (whichever
 * side The Balrog is on) is offered the action; a non-CvCC combat offers none.
 *
 * The Balrog-specific Whip is an exception to the general MEBA rule that items
 * borne by the Balrog avatar have no effect, so this scan deliberately looks at
 * items on the Balrog (unlike {@link modifyAttackActions}, which skips them).
 */
function cancelWeaponActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (!combat.isCvCC) return [];

  const participants = cvccParticipants(state, playerId, combat);
  if (!participants) return [];
  const { player, myCompany, oppPlayer, oppCompany } = participants;

  // Find the in-play `combat-cancel-weapon` item borne by The Balrog, untapped.
  let whipInstanceId: CardInstanceId | undefined;
  for (const charId of myCompany.characters) {
    const charData = player.characters[charId];
    if (!charData) continue;
    const charDef = defById(state, charData.definitionId);
    if (!charDef || !isBalrogAvatarDef(charDef)) continue; // may only be borne by The Balrog
    for (const item of charData.items) {
      const itemDef = defById(state, item.definitionId);
      const eff = getCardEffects(itemDef).find(e => e.type === 'combat-cancel-weapon');
      if (!eff) continue;
      const itemName = itemDef?.name ?? (item.definitionId as string);
      if (item.status !== CardStatus.Untapped) {
        logDetail(`Cancel-weapon ${itemName}: item tapped, cannot activate`);
        continue;
      }
      whipInstanceId = item.instanceId;
      break;
    }
    if (whipInstanceId) break;
  }
  if (!whipInstanceId) return [];

  const alreadySuppressed = new Set(
    (combat.suppressedWeaponInstanceIds ?? []).map(i => i as string),
  );

  const actions: EvaluatedAction[] = [];
  for (const charId of oppCompany.characters) {
    const charData = oppPlayer.characters[charId];
    if (!charData) continue;
    for (const item of charData.items) {
      if (alreadySuppressed.has(item.instanceId as string)) continue;
      const itemDef = defById(state, item.definitionId);
      const keywords = itemDef && 'keywords' in itemDef
        ? (itemDef as { keywords?: readonly string[] }).keywords ?? []
        : [];
      if (!keywords.includes('weapon')) continue;
      logDetail(`Cancel-weapon available: tap Whip to cancel ${itemDef?.name ?? item.definitionId as string} on ${charId as string}`);
      actions.push({
        action: {
          type: 'cancel-weapon-effects',
          player: playerId,
          cardInstanceId: whipInstanceId,
          weaponInstanceId: item.instanceId,
        },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Scourge of Fire (ba-75) — `combat-discard-opponent-item` short-event plays.
 *
 * During a company-vs-company combat in which The Balrog is untapped and a
 * participant on the acting player's side, the acting player may play a hand
 * card carrying a `combat-discard-opponent-item` effect to choose and discard
 * one item borne by the *opposing* company. One `play-short-event` action is
 * offered per eligible hand card, gated on:
 *   - the combat being CvCC, with the acting player owning one of the two
 *     companies and The Balrog untapped in that company;
 *   - the opposing company bearing at least one genuine item (nothing to
 *     discard otherwise);
 *   - the card's `card-in-play` play-condition (Flame of Udûn in play);
 *   - the turn-scoped `duplication-limit` ("cannot be duplicated on a given
 *     turn").
 *
 * Like {@link cancelWeaponActions}, the action is offered to whichever side The
 * Balrog is on; a non-CvCC combat offers none.
 */
function combatDiscardOpponentItemActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (!combat.isCvCC) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  // Only proceed if the acting player has a hand card that carries the effect.
  const candidates = player.hand.filter(hc =>
    getCardEffects(defById(state, hc.definitionId)).some(
      (e): e is CombatDiscardOpponentItemEffect => e.type === 'combat-discard-opponent-item',
    ),
  );
  if (candidates.length === 0) return [];

  const participants = cvccParticipants(state, playerId, combat);
  if (!participants) return [];
  const { myCompany, oppPlayer, oppCompany } = participants;

  // The Balrog must be untapped and in the acting player's participating company.
  const balrogUntapped = myCompany.characters.some(charId => {
    const charData = player.characters[charId];
    if (!charData) return false;
    const charDef = defById(state, charData.definitionId);
    return !!charDef && isBalrogAvatarDef(charDef) && charData.status === CardStatus.Untapped;
  });
  if (!balrogUntapped) {
    logDetail('combat-discard-opponent-item: The Balrog is not untapped in the acting company — not offered');
    return [];
  }

  // The opposing company must bear at least one genuine item to discard.
  const oppHasItem = oppCompany.characters.some(charId => {
    const ch = oppPlayer.characters[charId];
    return !!ch && ch.items.some(it => isItemCard(defById(state, it.definitionId)));
  });
  if (!oppHasItem) {
    logDetail('combat-discard-opponent-item: opposing company bears no items — not offered');
    return [];
  }

  const actions: EvaluatedAction[] = [];
  for (const handCard of candidates) {
    const def = defById(state, handCard.definitionId);
    if (!def) continue;

    // Play-condition: the named card (Flame of Udûn) must be in play.
    const playCond = findPlayConditionEffect(def, 'card-in-play');
    if (playCond?.cardName && !isCardNameInPlayForPlayer(state, player, playCond.cardName)) {
      logDetail(`${def.name}: ${playCond.cardName} is not in play — not offered`);
      continue;
    }

    // Turn-scoped duplication limit ("cannot be duplicated on a given turn").
    const turnDupLimit = findDuplicationLimitEffect(def, 'turn');
    if (turnDupLimit) {
      const prior = countConstraintsFromDefinition(state, def.id);
      if (prior >= turnDupLimit.max) {
        logDetail(`${def.name}: duplication limit reached (${prior}/${turnDupLimit.max}) — not playable this turn`);
        continue;
      }
    }

    logDetail(`combat-discard-opponent-item available: ${def.name} may discard an item from the opposing company`);
    actions.push({
      action: {
        type: 'play-short-event',
        player: playerId,
        cardInstanceId: handCard.instanceId,
      },
      viable: true,
    });
  }
  return actions;
}

/**
 * Crowned with Storm (ba-54) — `site-storm-devastation` short-event plays.
 *
 * During a company-vs-company combat, the Balrog's controller may play a hand
 * card carrying a `site-storm-devastation` effect to devastate everyone at the
 * site. One `play-short-event` action is offered per eligible hand card, gated
 * on:
 *   - the combat being CvCC, with the acting player owning one of the two
 *     companies and The Balrog present in that company;
 *   - that company's current site **not** being an Under-deeps site;
 *   - the opposing company containing a Wizard (a character of race `wizard`).
 *
 * Like {@link combatDiscardOpponentItemActions}, the action is offered to
 * whichever side The Balrog is on; a non-CvCC combat offers none.
 */
function siteStormAtSiteActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (!combat.isCvCC) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  const candidates = player.hand.filter(hc =>
    getCardEffects(defById(state, hc.definitionId)).some(
      (e): e is SiteStormDevastationEffect => e.type === 'site-storm-devastation',
    ),
  );
  if (candidates.length === 0) return [];

  const participants = cvccParticipants(state, playerId, combat);
  if (!participants) return [];
  const { myCompany, oppPlayer, oppCompany } = participants;

  // The Balrog must be present in the acting player's participating company.
  if (!companyContainsBalrogAvatar(state, player, myCompany)) {
    logDetail('site-storm-devastation: The Balrog is not in the acting company — not offered');
    return [];
  }

  // The Balrog's company must not be at an Under-deeps site.
  const mySiteDef = myCompany.currentSite ? defById(state, myCompany.currentSite.definitionId) : undefined;
  const atUnderDeeps = !!mySiteDef && 'keywords' in mySiteDef && (mySiteDef.keywords?.includes('under-deeps') ?? false);
  if (atUnderDeeps) {
    logDetail('site-storm-devastation: The Balrog\'s company is at an Under-deeps site — not offered');
    return [];
  }

  // The opposing company must contain a Wizard (race `wizard`).
  const oppHasWizard = oppCompany.characters.some(charId => {
    const ch = oppPlayer.characters[charId];
    if (!ch) return false;
    const chDef = defById(state, ch.definitionId);
    return !!chDef && isCharacterCard(chDef) && chDef.race === Race.Wizard;
  });
  if (!oppHasWizard) {
    logDetail('site-storm-devastation: opposing company contains no Wizard — not offered');
    return [];
  }

  const actions: EvaluatedAction[] = [];
  for (const handCard of candidates) {
    const def = defById(state, handCard.definitionId);
    if (!def) continue;
    logDetail(`site-storm-devastation available: ${def.name} may devastate everyone at the site`);
    actions.push({
      action: {
        type: 'play-short-event',
        player: playerId,
        cardInstanceId: handCard.instanceId,
      },
      viable: true,
    });
  }
  return actions;
}

/**
 * Generate modify-attack actions for the pre-assignment window. Covers two
 * sources:
 *
 * 1. **In-play items** (defending player only): items with a `modify-attack`
 *    effect and no `fromHand` flag. One action per eligible untapped item.
 *    Activating taps (or discards) the item and applies modifiers to the
 *    whole attack. Used by Black Arrow (tw-494).
 *
 * 2. **Hand cards** (`fromHand: true`): either the attacker or defender may
 *    play, controlled by the effect's `player` field. The card is discarded
 *    after use. Used by Dragon's Desolation (tw-29) and Forewarned (tw-346).
 *
 * 3. **In-play dual-mode creature permanent-events**
 *    (`fromAltPermanentEvent: true`): the hazard player taps one during the
 *    opponent's M/H phase; it "becomes a short-event", leaves play, and its
 *    modifiers hit the live attack. Costs one hazard-limit slot. Used by
 *    Hoarmûrath of Dír (tw-44).
 */
function modifyAttackActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];

  // --- In-play items (defending player only) ---
  if (playerId === combat.defendingPlayerId) {
    const company = companyById(player.companies, combat.companyId);
    if (company) {
      for (const charId of company.characters) {
        const charData = player.characters[charId];
        if (!charData) continue;
        const charDef = defById(state, charData.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;
        // MEBA: items borne by the Balrog avatar have no effect — he cannot tap
        // one to modify an attack.
        if (isBalrogAvatarDef(charDef)) continue;

        for (const item of charData.items) {
          const itemDef = defById(state, item.definitionId);
          if (!itemDef) continue;
          const effect = getCardEffects(itemDef).find(
            (e): e is ModifyAttackEffect => e.type === 'modify-attack' && !(e).fromHand && (e).scope !== 'current-strike',
          );
          if (!effect) continue;
          const tapCost = effect.cost?.tap;
          if (tapCost !== 'self' && tapCost !== 'bearer') continue;
          if (tapCost === 'self' && item.status !== CardStatus.Untapped) continue;
          if (tapCost === 'bearer' && charData.status !== CardStatus.Untapped) continue;

          if (effect.when) {
            const ctx = modifyAttackWhenContext(combat, { race: charDef.race, skills: charDef.skills, name: charDef.name });
            if (!matchesCondition(effect.when, ctx)) {
              const itemName = itemDef?.name ?? item.definitionId as string;
              logDetail(`Modify-attack ${itemName}: when condition not met (bearer ${charDef.name ?? ''})`);
              continue;
            }
          }

          const itemName = itemDef?.name ?? item.definitionId as string;
          logDetail(`Modify-attack available: tap ${itemName} on ${charDef.name ?? ''} (prowess ${effect.prowessModifier ?? 0}, body ${effect.bodyModifier ?? 0})`);
          actions.push({
            action: { type: 'modify-attack', player: playerId, cardInstanceId: item.instanceId, characterInstanceId: charId },
            viable: true,
          });
        }
      }

      // In-play allies in the defending company with a modify-attack effect
      // and a "tap self" cost (e.g. Great Bats: tap to remove the "attacker
      // chooses defending characters" rule from the attack).
      for (const { ally, hostCharId } of findCompanyAllies(player, company.characters)) {
        const allyDef = defById(state, ally.definitionId);
        if (!allyDef) continue;
        const effect = getCardEffects(allyDef).find(
          (e): e is ModifyAttackEffect => e.type === 'modify-attack' && !e.fromHand && e.scope !== 'current-strike',
        );
        if (!effect) continue;
        if (effect.cost?.tap !== 'self') continue;
        const allyName = allyDef?.name ?? ally.definitionId as string;
        if (ally.status !== CardStatus.Untapped) {
          logDetail(`Modify-attack ${allyName}: ally tapped, cannot activate`);
          continue;
        }
        if (effect.removeAttackerChoosesDefenders && !combat.attackerChoosesDefenders) {
          logDetail(`Modify-attack ${allyName}: attack has no attacker-chooses-defenders rule to remove`);
          continue;
        }
        logDetail(`Modify-attack available: tap ${allyName} (in-play ally${effect.removeAttackerChoosesDefenders ? ', removes attacker-chooses-defenders' : ''})`);
        actions.push({
          action: { type: 'modify-attack', player: playerId, cardInstanceId: ally.instanceId, characterInstanceId: hostCharId },
          viable: true,
        });
      }
    }
  }

  // --- Hand cards (attacker or defender per effect.player) ---
  const inPlayNames = buildInPlayNames(state);

  // Candidate cards for a from-hand modify-attack play. This is the player's
  // own hand, plus — for the attacker — any unrevealed on-guard cards on the
  // defending company. On-guard cards are placed by the hazard player onto the
  // opponent's company, so during a site-phase attack they always belong to
  // the attacker. A hazard event with a `modify-attack` (fromHand) effect
  // placed on-guard (e.g. Unabated in Malice ba-26) is "revealed on the
  // automatic-attack" here, reusing the same from-hand machinery as a card
  // played straight from hand (rule 2.V.i: on-guard hazards that affect
  // automatic-attacks).
  const candidateCards: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] =
    player.hand.map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId }));
  if (playerId === combat.attackingPlayerId) {
    const defender = playerById(state, combat.defendingPlayerId);
    const defendingCompany = defender ? companyById(defender.companies, combat.companyId) : undefined;
    if (defendingCompany) {
      for (const og of defendingCompany.onGuardCards) {
        if (og.revealed) continue;
        candidateCards.push({ instanceId: og.instanceId, definitionId: og.definitionId });
      }
    }
  }

  for (const handCard of candidateCards) {
    const cardDef = defById(state, handCard.definitionId);
    const effect = getCardEffects(cardDef).find(
      (e): e is ModifyAttackEffect => e.type === 'modify-attack' && !!(e).fromHand,
    );
    if (!effect) continue;

    const expectedPlayerId = effect.player === 'attacker'
      ? combat.attackingPlayerId
      : combat.defendingPlayerId;
    if (playerId !== expectedPlayerId) continue;

    // Attack-scoped duplication check.
    const attackDupLimit = findDuplicationLimitEffect(cardDef, 'attack');
    if (attackDupLimit) {
      const prior = countConstraintsFromDefinition(state, handCard.definitionId, 'attack');
      if (prior >= attackDupLimit.max) {
        logDetail(`Modify-attack (from hand) ${handCard.definitionId as string}: attack duplication limit reached (${prior}/${attackDupLimit.max})`);
        continue;
      }
    }

    if (effect.when) {
      const ctx = buildPlayedModifyAttackContext(state, combat, inPlayNames);
      if (!matchesCondition(effect.when, ctx)) {
        logDetail(`Modify-attack (from hand) ${handCard.definitionId as string}: when condition not met`);
        continue;
      }
    }

    // CoE rule 8.12: a hazard action played during the strike-assignment
    // window of the opponent's M/H phase counts against the company's
    // hazard limit unless the card bypasses it (e.g. Dragon's Desolation,
    // tw-29 Mode A, carries `play-flag: no-hazard-limit`). Only applies to
    // the attacker's own plays (a defender's from-hand modify-attack, e.g.
    // Star-glass-style items played as resource short-events, is not a
    // hazard play) and only inside the M/H phase (`hazardLimitStatus`
    // returns `undefined` for site-phase combat, which has no hazard-limit
    // bookkeeping — on-guard reveals fall through this check for free).
    if (playerId === combat.attackingPlayerId) {
      const bypassesLimit = cardDef !== undefined && 'effects' in cardDef && hasPlayFlag(cardDef, 'no-hazard-limit');
      const hazardLimit = bypassesLimit ? undefined : hazardLimitStatus(state, combat.companyId);
      if (hazardLimit?.reached) {
        logDetail(`Modify-attack (from hand) ${handCard.definitionId as string}: hazard limit reached (${hazardLimit.played}/${hazardLimit.limit})`);
        actions.push({
          action: { type: 'modify-attack', player: playerId, cardInstanceId: handCard.instanceId },
          viable: false,
          reason: 'Hazard limit reached',
        });
        continue;
      }
    }

    logDetail(`Modify-attack (from hand) available: ${handCard.definitionId as string} (prowess ${effect.prowessModifier ?? 0}, body ${effect.bodyModifier ?? 0})`);
    actions.push({
      action: { type: 'modify-attack', player: playerId, cardInstanceId: handCard.instanceId },
      viable: true,
    });
  }

  // --- In-play dual-mode creature permanent-events (`fromAltPermanentEvent`) ---
  actions.push(...altPermanentEventModifyAttackActions(state, playerId, combat, inPlayNames));

  return actions;
}

/**
 * Build the `when` context for a *played* `modify-attack` — a hand card
 * (`fromHand`), an on-guard reveal, or an in-play dual-mode creature
 * permanent-event tapped in the same window (`fromAltPermanentEvent`).
 *
 * Exposes `inPlay`, `enemy.*` (prowess/race/name of the attacking creature),
 * `attack.*` (source discriminator, `automatic`, `detainment`, `keying`) and
 * `defender.*` (`covert`, `companyContainsBalrog`, `inPlay`, `minionCompany`).
 */
function buildPlayedModifyAttackContext(
  state: GameState,
  combat: CombatState,
  inPlayNames: readonly string[],
): Record<string, unknown> {
  let baseProwess = combat.strikeProwess;
  let creatureName: string | undefined;
  if (combat.attackSource.type === 'creature') {
    const atkPlayer = playerById(state, combat.attackingPlayerId);
    if (atkPlayer) {
      const creatureCard = atkPlayer.cardsInPlay.find(
        c => combat.attackSource.type === 'creature' && c.instanceId === (combat.attackSource as { type: 'creature'; instanceId: CardInstanceId }).instanceId,
      );
      if (creatureCard) {
        const cDef = defById(state, creatureCard.definitionId);
        if (cDef && 'prowess' in cDef) baseProwess = (cDef as { prowess: number }).prowess;
        if (cDef) creatureName = cDef.name;
      }
    }
  }
  // An automatic-attack is either a site's built-in attack or a played
  // auto-attack; exposed so cards can gate on "playable on an
  // automatic-attack" (e.g. Unabated in Malice ba-26).
  const isAutomatic = combat.attackSource.type === 'automatic-attack'
    || combat.attackSource.type === 'played-auto-attack';
  const enemyCtx: Record<string, unknown> = { prowess: baseProwess };
  if (combat.creatureRace) enemyCtx['race'] = combat.creatureRace;
  if (creatureName) enemyCtx['name'] = creatureName;
  const attackCtx: Record<string, unknown> = { source: combat.attackSource.type, automatic: isAutomatic, detainment: combat.detainment };
  if (combat.attackKeying && combat.attackKeying.length > 0) attackCtx['keying'] = combat.attackKeying;
  const defendingPlayer = playerById(state, combat.defendingPlayerId);
  const defendingCompany = defendingPlayer ? companyById(defendingPlayer.companies, combat.companyId) : undefined;
  const defenderCovert = defendingPlayer && defendingCompany ? isCovertCompany(defendingCompany, defendingPlayer, state) : false;
  // `defender.companyContainsBalrog` gates "playable on an attack against
  // The Balrog's company"; `defender.inPlay` is attachment-aware so a gate
  // on a character-attached permanent event (e.g. Great Shadow on The
  // Balrog) resolves — the plain global `inPlay` list misses it. Both back
  // Darkness Wielded (ba-55).
  const defenderContainsBalrog = defendingPlayer && defendingCompany
    ? companyContainsBalrogAvatar(state, defendingPlayer, defendingCompany) : false;
  const defenderInPlay = defendingPlayer ? inPlayNamesForPlayerDeep(state, defendingPlayer) : [];
  // `defender.minionCompany` gates "against a minion company" (FEAR! FIRE!
  // FOES! as-29 Mode B): true when the defending (resource) player is a
  // Ringwraith (minion) player.
  const defenderMinionCompany = defendingPlayer?.alignment === Alignment.Ringwraith;
  return {
    inPlay: inPlayNames,
    enemy: enemyCtx,
    attack: attackCtx,
    defender: {
      covert: defenderCovert,
      companyContainsBalrog: defenderContainsBalrog,
      inPlay: defenderInPlay,
      minionCompany: defenderMinionCompany,
    },
  };
}

/**
 * Offer converting an in-play dual-mode creature permanent-event to a
 * short-event that modifies the live attack (`modify-attack` with
 * `fromAltPermanentEvent`) — the Hoarmûrath of Dír (tw-44) mechanism:
 * "it will remain in play until tapped during the opponent's movement/hazard
 * phase (tapping counts against the hazard limit). When tapped, Hoarmûrath of
 * Dír becomes a short-event and gives +1 strike to any one attack."
 *
 * Offered in the same pre-assignment window as a from-hand `modify-attack`, so
 * "any one attack" is the attack actually being fought. Restricted to the
 * opponent's M/H phase (the card's printed timing) and gated on the company's
 * hazard limit, which the conversion consumes one slot of.
 */
function altPermanentEventModifyAttackActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
  inPlayNames: readonly string[],
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  if (!player) return actions;
  // Printed timing: "tapped during the opponent's movement/hazard phase".
  if (state.phaseState.phase !== Phase.MovementHazard) return actions;

  for (const card of player.cardsInPlay) {
    if (card.status !== CardStatus.Untapped) continue;
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const effects = getCardEffects(def);
    const altEvent = effects.find(e => e.type === 'creature-alt-event');
    if (altEvent?.type !== 'creature-alt-event' || altEvent.mode !== 'permanent-event' || altEvent.persistent) continue;
    const effect = effects.find(
      (e): e is ModifyAttackEffect => e.type === 'modify-attack' && !!e.fromAltPermanentEvent,
    );
    if (!effect) continue;

    const expectedPlayerId = effect.player === 'defender'
      ? combat.defendingPlayerId
      : combat.attackingPlayerId;
    if (playerId !== expectedPlayerId) continue;

    if (effect.when && !matchesCondition(effect.when, buildPlayedModifyAttackContext(state, combat, inPlayNames))) {
      logDetail(`Modify-attack (permanent-event tap) ${def.name}: when condition not met`);
      continue;
    }

    // The conversion is a hazard action and counts one against the company's
    // hazard limit (printed on the card, and CoE 8.12 for combat-window plays).
    const bypassesLimit = 'effects' in def && hasPlayFlag(def, 'no-hazard-limit');
    const hazardLimit = bypassesLimit ? undefined : hazardLimitStatus(state, combat.companyId);
    if (hazardLimit?.reached) {
      logDetail(`Modify-attack (permanent-event tap) ${def.name}: hazard limit reached (${hazardLimit.played}/${hazardLimit.limit})`);
      actions.push({
        action: { type: 'modify-attack', player: playerId, cardInstanceId: card.instanceId },
        viable: false,
        reason: 'Hazard limit reached',
      });
      continue;
    }

    logDetail(`Modify-attack (permanent-event tap) available: ${def.name} (strikes ${formatSignedNumber(effect.strikesModifier ?? 0)}, prowess ${formatSignedNumber(effect.prowessModifier ?? 0)})`);
    actions.push({
      action: { type: 'modify-attack', player: playerId, cardInstanceId: card.instanceId },
      viable: true,
    });
  }
  return actions;
}

/**
 * Enumerates every combination of `minCount`..`maxCount` items drawn from
 * `items` (order-independent, no repeats). Backs the discard-cost offering
 * for {@link CompanyCombatBoostEffect.costDiscard} (Alert the Folk td-97:
 * "discard any one or two factions"), where the player picks which matching
 * hand cards to sacrifice.
 */
function combinationsInRange<T>(items: readonly T[], minCount: number, maxCount: number): T[][] {
  const results: T[][] = [];
  const n = items.length;
  const build = (start: number, size: number, chosen: T[]) => {
    if (chosen.length === size) { results.push([...chosen]); return; }
    for (let i = start; i <= n - (size - chosen.length); i++) {
      chosen.push(items[i]);
      build(i + 1, size, chosen);
      chosen.pop();
    }
  };
  for (let size = minCount; size <= Math.min(maxCount, n); size++) {
    build(0, size, []);
  }
  return results;
}

/**
 * Returns `play-short-event` actions for resource short-events in the
 * defending player's hand that carry `company-combat-boost` effects.
 *
 * These events boost all characters in the defending company that match
 * the effect's optional `filter` (e.g. all Dwarves). The event must be
 * offered in the pre-assignment window of the `assign-strikes` phase,
 * before any strike has been assigned.
 *
 * Duplication check: the effect may carry a `duplication-limit` with
 * `scope: "attack"`. If so, attack-scoped constraints from this definition
 * are counted in `activeConstraints` — if the count equals `max`, the card
 * was already played this attack and is suppressed.
 *
 * `when` gate: restricts eligibility to attacks matching `{ enemy: { race,
 * name } }` (Alert the Folk td-97: Dragon/Drake attacks, excluding
 * Eärcaraxë by name).
 *
 * `costDiscard`: rather than a single action, one action is offered per
 * eligible combination of `minCount`..`maxCount` matching hand cards (see
 * {@link combinationsInRange}), each carrying `costDiscardInstanceIds` so
 * the reducer knows which cards to discard and sum for the dynamic value.
 */
function companyCombatBoostActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];
  if (playerId !== combat.defendingPlayerId) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  // Find the defending company's characters.
  const company = companyById(player.companies, combat.companyId);
  if (!company) return [];

  // Attack context for `when` gates (e.g. "facing a Dragon or Drake attack,
  // not Eärcaraxë" — Alert the Folk td-97). `name` is only known for
  // attacks backed by an actual creature card instance; site
  // automatic-attacks and other sources leave it empty, matching no
  // specific-name exclusion.
  const enemyCreatureInstanceId = attackSourceCreatureInstanceId(combat);
  const enemyCreatureDef = enemyCreatureInstanceId ? resolveDef(state, enemyCreatureInstanceId) : undefined;
  const attackWhenContext = {
    enemy: {
      race: combat.creatureRace,
      name: (enemyCreatureDef as { name?: string } | undefined)?.name ?? '',
    },
  };

  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const boostEffects = getCardEffects(cardDef).filter(
      (e): e is CompanyCombatBoostEffect => e.type === 'company-combat-boost',
    );
    if (boostEffects.length === 0) continue;

    if (!cardDef) continue;
    // Attack-scoped duplication check.
    const attackDupLimit = findDuplicationLimitEffect(cardDef, 'attack');
    if (attackDupLimit) {
      const prior = countConstraintsFromDefinition(state, cardDef.id, 'attack');
      if (prior >= attackDupLimit.max) {
        logDetail(`${(cardDef as { name?: string }).name}: attack duplication limit reached (${prior}/${attackDupLimit.max})`);
        continue;
      }
    }

    // Attack-eligibility gate: a boost carrying `when` is offered only when
    // the current attack matches; a boost with no `when` is unconditionally
    // eligible on this axis.
    const eligibleBoosts = boostEffects.filter(
      effect => !effect.when || matchesCondition(effect.when, attackWhenContext),
    );
    if (eligibleBoosts.length === 0) {
      logDetail(`${(cardDef as { name?: string }).name}: attack (race=${attackWhenContext.enemy.race ?? 'none'}, name=${attackWhenContext.enemy.name || 'none'}) does not match when-condition — company-combat-boost not offered`);
      continue;
    }

    // At least one boost effect must match a character in the defending
    // company. A boost with neither `filter` nor `companyFilter` matches
    // unconditionally; a `filter` matches when any character satisfies it
    // (per-character grant); a `companyFilter` gates the whole company on a
    // qualifying member (e.g. Foe Dismayed's leader-or-Balrog gate).
    let hasMatch = false;
    for (const effect of eligibleBoosts) {
      const gate = effect.companyFilter ?? effect.filter;
      if (!gate) { hasMatch = true; break; }
      for (const charId of company.characters) {
        const char = player.characters[charId];
        if (!char) continue;
        const charCardDef = defById(state, char.definitionId);
        if (!charCardDef || !('race' in charCardDef)) continue;
        const ctx = { target: {
          race: (charCardDef as { race?: Race }).race,
          name: (charCardDef as { name?: string }).name ?? '',
          skills: (charCardDef as { skills?: readonly string[] }).skills ?? [],
          keywords: (charCardDef as { keywords?: readonly string[] }).keywords ?? [],
        } };
        if (matchesCondition(gate, ctx)) { hasMatch = true; break; }
      }
      if (hasMatch) break;
    }
    if (!hasMatch) {
      logDetail(`${(cardDef as { name?: string }).name}: no matching characters in company — company-combat-boost not offered`);
      continue;
    }

    // Discard-cost dynamic value (Alert the Folk td-97): the player chooses
    // which matching hand cards to discard as payment; one action is offered
    // per eligible combination.
    const discardCostEffect = eligibleBoosts.find(e => e.costDiscard);
    if (discardCostEffect?.costDiscard) {
      const cost = discardCostEffect.costDiscard;
      const candidates = player.hand.filter(c => {
        if (c.instanceId === handCard.instanceId) return false;
        const cDef = defById(state, c.definitionId);
        if (!cDef) return false;
        const ctx: Record<string, unknown> = { ...cDef };
        if (isFactionCard(cDef)) {
          ctx.faction = { playableRegions: buildFactionPlayableRegions(state, cDef) };
        }
        return matchesCondition(cost.filter, ctx);
      });
      if (candidates.length < cost.minCount) {
        logDetail(`${(cardDef as { name?: string }).name}: only ${candidates.length} matching discard-cost card(s) in hand — need at least ${cost.minCount}`);
        continue;
      }
      for (const combo of combinationsInRange(candidates, cost.minCount, cost.maxCount)) {
        logDetail(`Company-combat-boost available: ${(cardDef as { name?: string }).name} (discard ${combo.map(c => defById(state, c.definitionId)?.name ?? c.definitionId as string).join(', ')})`);
        actions.push({
          action: {
            type: 'play-short-event',
            player: playerId,
            cardInstanceId: handCard.instanceId,
            costDiscardInstanceIds: combo.map(c => c.instanceId),
          },
          viable: true,
        });
      }
      continue;
    }

    logDetail(`Company-combat-boost available: ${(cardDef as { name?: string }).name}`);
    actions.push({
      action: {
        type: 'play-short-event',
        player: playerId,
        cardInstanceId: handCard.instanceId,
      },
      viable: true,
    });
  }

  return actions;
}

/**
 * Generate `play-short-event` actions for `join-combat-force-strike` events
 * (Vanguard of Might ba-79). Offered to the defending player in the
 * pre-assignment window of the `assign-strikes` sub-phase (no strikes assigned
 * yet), gated on:
 *   - the defending company being at (currentSite) or moving to
 *     (destinationSite) a site carrying `requiresSiteKeyword` (e.g. under-deeps),
 *   - the `notInPlay` card not being in play (Flame of Udûn),
 *   - the named character (The Balrog) being in play for the defending player.
 */
function joinCombatForceStrikeActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];
  if (playerId !== combat.defendingPlayerId) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  const company = companyById(player.companies, combat.companyId);
  if (!company) return [];

  const inPlayNames = buildInPlayNames(state);
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const effect = getCardEffects(cardDef).find(
      (e): e is JoinCombatForceStrikeEffect => e.type === 'join-combat-force-strike',
    );
    if (!effect) continue;

    // Site gate: defending company must be at or moving to a qualifying site.
    if (effect.requiresSiteKeyword) {
      const siteHasKeyword = (site: { definitionId: CardDefinitionId } | null): boolean => {
        if (!site) return false;
        const siteDef = defById(state, site.definitionId) as { keywords?: readonly string[] } | undefined;
        return siteDef?.keywords?.includes(effect.requiresSiteKeyword!) ?? false;
      };
      if (!siteHasKeyword(company.currentSite) && !siteHasKeyword(company.destinationSite)) {
        logDetail(`${(cardDef as { name?: string }).name}: company not at/moving to a ${effect.requiresSiteKeyword} site — not offered`);
        continue;
      }
    }

    // Exclusion gate: the named card must not be in play.
    if (effect.notInPlay && inPlayNames.includes(effect.notInPlay)) {
      logDetail(`${(cardDef as { name?: string }).name}: ${effect.notInPlay} is in play — not offered`);
      continue;
    }

    // The named character must be in play for this player (avatar to summon).
    const namedInPlay = Object.values(player.characters).some(ch => {
      const chDef = defById(state, ch.definitionId) as { name?: string } | undefined;
      return chDef?.name === effect.characterName;
    });
    if (!namedInPlay) {
      logDetail(`${(cardDef as { name?: string }).name}: ${effect.characterName} not in play — not offered`);
      continue;
    }

    logDetail(`join-combat-force-strike available: ${(cardDef as { name?: string }).name} (summon ${effect.characterName})`);
    actions.push({
      action: {
        type: 'play-short-event',
        player: playerId,
        cardInstanceId: handCard.instanceId,
      },
      viable: true,
    });
  }

  return actions;
}

/**
 * Generate `tap-ally-combat-boost` actions: the owner of an untapped in-play
 * ally carrying a `combat-tap-company-boost` effect may tap it during combat to
 * grant an attack-scoped stat boost to matching characters in the ally's own
 * company. Offered during the assign-strikes and resolve-strike windows when
 * the ally's company is involved in the current combat (the defending company
 * in creature combat, or either company in CvCC) and at least one character in
 * that company matches the boost filter. Each ally may apply its boost only
 * once per attack.
 *
 * Used by Great Lord of Goblin-gate (as-75).
 */
function tapAllyCombatBoostActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  const player = playerById(state, playerId);
  if (!player) return [];

  const attackingCompanyId = combat.attackSource.type === 'company-attack'
    ? combat.attackSource.attackingCompanyId
    : undefined;

  const actions: EvaluatedAction[] = [];

  for (const [charId, charData] of Object.entries(player.characters)) {
    // The bearer's company must be involved in this combat.
    const company = player.companies.find(c => c.characters.includes(charId as CardInstanceId));
    if (!company) continue;
    const involved = company.id === combat.companyId
      || (combat.isCvCC === true && company.id === attackingCompanyId);
    if (!involved) continue;

    for (const ally of charData.allies) {
      if (ally.status !== CardStatus.Untapped) continue;
      const allyDef = defById(state, ally.definitionId);
      const boostEffects = getCardEffects(allyDef).filter(
        (e): e is CombatTapCompanyBoostEffect => e.type === 'combat-tap-company-boost',
      );
      if (boostEffects.length === 0) continue;

      // Already applied this attack? (no stacking)
      const already = state.activeConstraints.some(
        c => c.source === ally.instanceId && c.scope.kind === 'attack',
      );
      if (already) {
        logDetail(`Ally ${(allyDef as { name?: string } | undefined)?.name ?? (ally.definitionId as string)}: boost already applied this attack`);
        continue;
      }

      // At least one character in the company must match a boost filter.
      let hasMatch = false;
      for (const effect of boostEffects) {
        if (!effect.filter) { hasMatch = true; break; }
        for (const memberId of company.characters) {
          const member = player.characters[memberId];
          if (!member) continue;
          const memberDef = defById(state, member.definitionId);
          if (!memberDef || !('race' in memberDef)) continue;
          const ctx = { target: {
            race: (memberDef as { race?: Race }).race,
            name: (memberDef as { name?: string }).name ?? '',
            skills: (memberDef as { skills?: readonly string[] }).skills ?? [],
          } };
          if (matchesCondition(effect.filter, ctx)) { hasMatch = true; break; }
        }
        if (hasMatch) break;
      }
      if (!hasMatch) continue;

      logDetail(`Tap-ally-combat-boost available: ${(allyDef as { name?: string } | undefined)?.name ?? (ally.definitionId as string)}`);
      actions.push({
        action: { type: 'tap-ally-combat-boost', player: playerId, cardInstanceId: ally.instanceId },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Generate cancel-by-tap actions for the defending player during the
 * cancel-by-tap sub-phase. The defender can tap untapped non-target
 * characters in the company to cancel one strike each (e.g. Assassin).
 */
function cancelByTapActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.assignmentPhase !== 'cancel-by-tap') return [];
  if (!combat.cancelByTapRemaining || combat.cancelByTapRemaining <= 0) return [];

  const player = playerById(state, playerId);
  if (!player) return [];
  const company = companyById(player.companies, combat.companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];

  // Carrion Feeders (ba-11): "Each untapped character in the company may tap to
  // cancel a strike against a wounded character." Each strike is pre-assigned
  // to a distinct wounded character; the defender taps an untapped company
  // character to remove one strike, choosing which wounded character to protect.
  if (combat.cancelStrikeAgainstWounded) {
    const remainingStrikeChars = Array.from(new Set(
      combat.strikeAssignments.filter(a => !a.resolved).map(a => a.characterId as string),
    ));
    for (const charId of company.characters) {
      const charData = player.characters[charId];
      if (!charData || charData.status !== CardStatus.Untapped) continue;
      for (const woundedId of remainingStrikeChars) {
        logDetail(`Cancel-strike-vs-wounded available: tap ${charId as string} to cancel the strike against ${woundedId}`);
        actions.push({
          action: {
            type: 'cancel-by-tap',
            player: playerId,
            characterId: charId,
            strikeCharacterId: woundedId as CardInstanceId,
          },
          viable: true,
        });
      }
    }
    logDetail(`Defender can pass cancel-strike-vs-wounded (${combat.cancelByTapRemaining} tap(s) remaining)`);
    actions.push({ action: { type: 'pass', player: playerId }, viable: true });
    return actions;
  }

  // The target character is the one all strikes are assigned to
  const targetCharId = combat.strikeAssignments[0]?.characterId;
  if (!targetCharId) return [];

  for (const charId of company.characters) {
    // By default the target character cannot tap to cancel (Assassin: "not the defending character").
    // When allowTargetToCancel is set (Slayer: "any one character"), the target may also tap.
    if (!combat.cancelByTapAllowTarget && charId === targetCharId) continue;
    const charData = player.characters[charId];
    if (!charData || charData.status !== CardStatus.Untapped) continue;

    logDetail(`Cancel-by-tap available: tap ${charId as string} to cancel one attack`);
    actions.push({
      action: { type: 'cancel-by-tap', player: playerId, characterId: charId },
      viable: true,
    });
  }

  // Defender can always pass (decline to cancel more attacks)
  logDetail(`Defender can pass cancel-by-tap (${combat.cancelByTapRemaining} cancel(s) remaining)`);
  actions.push({
    action: { type: 'pass', player: playerId },
    viable: true,
  });

  return actions;
}

/**
 * Actions during the item-salvage sub-phase (CoE rule 3.I.2).
 *
 * After a character is eliminated by a body check, the defending player
 * may transfer one item per unwounded character in the same company.
 * The player can also pass to discard all remaining items.
 */
function itemSalvageActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];

  const { salvageItems, salvageRecipients } = combat;
  if (!salvageItems || !salvageRecipients || salvageItems.length === 0 || salvageRecipients.length === 0) return [];

  const actions: EvaluatedAction[] = [];

  // For each available item × each eligible recipient = one action
  for (const item of salvageItems) {
    for (const recipientId of salvageRecipients) {
      const charData = playerById(state, playerId)?.characters[recipientId];
      const charDef = charData ? defById(state, charData.definitionId) : undefined;
      const charName = charDef?.name ?? (recipientId as string);
      const itemDef = defById(state, item.definitionId);
      const itemName = itemDef?.name ?? (item.instanceId as string);
      logDetail(`Salvage available: ${itemName} → ${charName}`);
      actions.push({
        action: {
          type: 'salvage-item',
          player: playerId,
          itemInstanceId: item.instanceId,
          recipientCharacterId: recipientId,
        },
        viable: true,
      });
    }
  }

  // Player can always pass to skip remaining transfers
  logDetail('Defender can pass to discard remaining items');
  actions.push({
    action: { type: 'pass', player: playerId },
    viable: true,
  });

  return actions;
}

/**
 * Actions during the discard-item-from-company sub-phase (An Article Missing, dm-43).
 *
 * After a successful agent strike with strikeEffect 'discard-item', the defending
 * player must discard one item from any character in the company. One action per
 * available item is generated; the defender chooses which item to lose.
 */
function discardItemFromCompanyActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];

  const { discardItemOptions } = combat;
  if (!discardItemOptions || discardItemOptions.length === 0) return [];

  return discardItemOptions.map(item => {
    const itemDef = defById(state, item.definitionId);
    const itemName = itemDef?.name ?? (item.instanceId as string);
    logDetail(`Discard-item available: ${itemName}`);
    return {
      action: {
        type: 'discard-item-from-company' as const,
        player: playerId,
        itemInstanceId: item.instanceId,
      },
      viable: true,
    };
  });
}

/**
 * Emit `play-hazard` actions for hazard permanent-events in the
 * attacker's hand that declare `play-window { phase: 'combat', step:
 * 'resolve-strike' }`. Each candidate is gated on its
 * `play-condition` (currently only `requires: 'combat-creature-race'`
 * is understood here — matched against `combat.creatureRace`) and its
 * `play-target` filter (evaluated against the defender currently
 * facing the strike). Used by Dragon's Curse (td-16).
 */
function combatHazardPermanentPlays(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.phase !== 'resolve-strike') return [];
  if (playerId !== combat.attackingPlayerId) return [];

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return [];

  // CoE rule 8.12: hazard actions during a strike sequence in the opponent's
  // M/H phase count against the company's hazard limit — no further hazard
  // plays are offered once the limit is reached. (Site-phase combat has no
  // hazard-limit bookkeeping.)
  const hazardLimit = hazardLimitStatus(state, combat.companyId);
  if (hazardLimit?.reached) {
    logDetail(`Combat play-hazard: hazard limit reached (${hazardLimit.played}/${hazardLimit.limit}) — no mid-strike hazard plays`);
    return [];
  }

  const attacker = playerById(state, playerId);
  if (!attacker) return [];

  const defender = playerById(state, combat.defendingPlayerId);
  if (!defender) return [];
  const targetCharId = currentStrike.characterId;
  const targetChar = defender.characters[targetCharId];
  if (!targetChar) return [];
  const targetDef = defById(state, targetChar.definitionId);
  if (!targetDef || !isCharacterCard(targetDef)) return [];

  const results: EvaluatedAction[] = [];
  for (const handCard of attacker.hand) {
    const def = defById(state, handCard.definitionId);
    if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'permanent') continue;
    const playWindow = getCardEffects(def).find(
      (e): e is PlayWindowEffect => e.type === 'play-window',
    );
    if (!playWindow || playWindow.phase !== 'combat' || playWindow.step !== 'resolve-strike') continue;

    const playCondition = findPlayConditionEffect(def, 'combat-creature-race');
    if (playCondition) {
      if (!combat.creatureRace || combat.creatureRace !== playCondition.race) {
        logDetail(`Combat play-hazard "${def.name}": creature race "${combat.creatureRace ?? 'none'}" does not match required "${playCondition.race ?? '?'}"`);
        continue;
      }
    }

    const playTarget = getCardEffects(def).find(
      (e): e is PlayTargetEffect => e.type === 'play-target',
    );
    if (playTarget && playTarget.target === 'character' && playTarget.filter) {
      const possessionNames = defNamesOf(state, targetChar.items);
      const itemKeywords = itemKeywordsOf(state, targetChar.items);
      // Include `attack` in context so filters like `{ "attack.race": "Spider" }` work.
      const ctx = {
        target: {
          race: targetDef.race,
          skills: targetDef.skills,
          name: targetDef.name,
          mind: targetDef.mind,
          possessions: possessionNames,
          itemKeywords,
        },
        attack: {
          race: combat.creatureRace ?? null,
        },
      };
      if (!matchesCondition(playTarget.filter, ctx)) {
        logDetail(`Combat play-hazard "${def.name}" filter excludes ${targetDef.name}`);
        continue;
      }
    }

    // take-prisoner: require a valid rescue site in the hazard player's location deck.
    const takePrisonerEff = getCardEffects(def).find(
      (e): e is import('../../types/effects.js').TakePrisonerEffect => e.type === 'take-prisoner',
    );
    if (takePrisonerEff) {
      const hasRescueSite = attacker.siteDeck.some(site => {
        const siteDef = defById(state, site.definitionId);
        if (!siteDef || !('siteType' in siteDef)) return false;
        const siteType = (siteDef as { siteType: string }).siteType;
        return takePrisonerEff.rescueSiteTypes.includes(siteType);
      });
      if (!hasRescueSite) {
        const needed = takePrisonerEff.rescueSiteTypes.join(' or ');
        logDetail(`Combat play-hazard "${def.name}": no ${needed} rescue site in hazard location deck — not playable`);
        continue;
      }
    }

    // Per-character duplication limit: skip if a copy is already on the target.
    const charDupLimit = findDuplicationLimitEffect(def, 'character');
    if (charDupLimit) {
      const copies = targetChar.hazards.filter(h => {
        const hDef = defById(state, h.definitionId);
        return hDef && hDef.name === def.name;
      }).length;
      if (copies >= charDupLimit.max) {
        logDetail(`Combat play-hazard "${def.name}" already on ${targetDef.name} (${copies}/${charDupLimit.max})`);
        continue;
      }
    }

    const companyId = findCharacterCompany(defender.companies, targetCharId)?.id;
    if (!companyId) continue;

    logDetail(`Combat play-hazard "${def.name}" playable on ${targetDef.name}`);
    results.push({
      action: {
        type: 'play-hazard',
        player: playerId,
        cardInstanceId: handCard.instanceId,
        targetCompanyId: companyId,
        targetCharacterId: targetCharId,
      },
      viable: true,
    });
  }
  return results;
}

/**
 * Left Behind (td-41): offer the attacking (hazard) player the option to play
 * this short-event on a non-Wizard character in the defending company, provided
 * that company is facing an attack of five (`minStrikes`) or more strikes.
 *
 * Offered in the attacker's Step-1 priority window during the `resolve-strike`
 * phase (the same window as `combatHazardPermanentPlays`), before the current
 * strike has resolved, and only while the company's hazard limit has room (rule
 * 8.12). One action per (matching hand card × non-Wizard company member).
 */
function leftBehindActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.phase !== 'resolve-strike') return [];
  if (playerId !== combat.attackingPlayerId) return [];

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return [];

  // Rule 8.12: no further hazard plays once the company's hazard limit is met.
  if (hazardLimitStatus(state, combat.companyId)?.reached) return [];

  const attacker = playerById(state, playerId);
  if (!attacker) return [];
  const defender = playerById(state, combat.defendingPlayerId);
  if (!defender) return [];
  const defendingCompany = companyById(defender.companies, combat.companyId);
  if (!defendingCompany) return [];

  const attackStrikes = combat.strikesPerAttack ?? combat.strikesTotal;

  const results: EvaluatedAction[] = [];
  for (const handCard of attacker.hand) {
    const def = defById(state, handCard.definitionId);
    if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') continue;
    const effect = getCardEffects(def).find(
      (e): e is import('../../types/effects.js').LeftBehindSplitEffect => e.type === 'left-behind-split',
    );
    if (!effect) continue;
    if (attackStrikes < effect.minStrikes) {
      logDetail(`Left Behind "${def.name}": attack has ${attackStrikes} strikes (< ${effect.minStrikes}) — not playable`);
      continue;
    }
    const playTarget = getCardEffects(def).find(
      (e): e is PlayTargetEffect => e.type === 'play-target',
    );
    for (const charId of defendingCompany.characters) {
      const charInPlay = defender.characters[charId];
      if (!charInPlay) continue;
      const charDef = defById(state, charInPlay.definitionId);
      if (!charDef || !isCharacterCard(charDef)) continue;
      if (charDef.race === Race.Wizard) continue;
      if (playTarget?.target === 'character' && playTarget.filter) {
        const ctx = { target: { race: charDef.race, skills: charDef.skills, name: charDef.name, mind: charDef.mind } };
        if (!matchesCondition(playTarget.filter, ctx)) continue;
      }
      logDetail(`Left Behind "${def.name}" playable on ${charDef.name} (attack of ${attackStrikes} strikes)`);
      results.push({
        action: {
          type: 'play-hazard',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          targetCompanyId: combat.companyId,
          targetCharacterId: charId,
        },
        viable: true,
      });
    }
  }
  return results;
}

/**
 * Offers the attacking (hazard) player the option to apply an in-play
 * `attacker-attack-option` to the current attack. Used by Ungoliant's Progeny
 * (ba-27): "for each Spider attack your opponent faces, you can choose for it to
 * be at +1 prowess and detainment."
 *
 * Legal only in the attacker's Step 1 priority window (`resolve-strike`, CoE
 * rule 3.iv.1) before any strike has resolved — so the modifier, once applied,
 * affects the whole attack — and only once per attack. The option is offered
 * when the attacking player controls an in-play card whose
 * `attacker-attack-option` effect names the current attack's creature race and
 * applying it would still change something (add prowess, or make an
 * as-yet-non-detainment attack detainment).
 */
function attackerAttackOptionActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.phase !== 'resolve-strike') return [];
  if (playerId !== combat.attackingPlayerId) return [];
  if (combat.attackerAttackOptionApplied) return [];
  // Whole-attack decision: only before any strike has resolved.
  if (combat.strikeAssignments.some(s => s.resolved)) return [];
  const race = combat.creatureRace;
  if (!race) return [];
  const attacker = playerById(state, playerId);
  if (!attacker) return [];

  const results: EvaluatedAction[] = [];
  for (const card of attacker.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    for (const effect of getCardEffects(def)) {
      if (effect.type !== 'attacker-attack-option') continue;
      if (effect.creatureRace !== race) continue;
      const addsProwess = (effect.prowessModifier ?? 0) !== 0;
      const addsDetainment = effect.detainment === true && !combat.detainment;
      if (!addsProwess && !addsDetainment) continue; // nothing left to apply
      logDetail(
        `Attacker-attack-option available from "${def.name}" for ${race} attack (${effect.prowessModifier ? `${formatSignedNumber(effect.prowessModifier)} prowess` : ''}${addsDetainment ? ' detainment' : ''})`,
      );
      results.push({
        action: { type: 'apply-attacker-attack-option' as const, player: playerId, cardInstanceId: card.instanceId },
        viable: true,
      });
    }
  }
  return results;
}
