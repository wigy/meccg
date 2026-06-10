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

import type { GameState, PlayerId, EvaluatedAction, CombatState, CardInstanceId } from '../../index.js';
import type { CancelAttackEffect, FlatteryCancelAttackEffect, StrikeModifierEffect, HalveStrikesEffect, ModifyAttackEffect, OnEventEffect, PlayConditionEffect, PlayWindowEffect, PlayTargetEffect, DuplicationLimitEffect, CompanyCombatBoostEffect, CombatTapCompanyBoostEffect, ProtectFromStrikeAssignmentEffect } from '../../types/effects.js';
import type { AllyInPlay } from '../../types/state-cards.js';
import type { PlayerState } from '../../types/state-player.js';
import { CardStatus, isCharacterCard, isAllyCard, isSiteCard, matchesCondition, SiteType, hasPlayFlag, isResourceEventCard, isAvatarCharacter, formatSignedNumber } from '../../index.js';
import { logHeading, logDetail } from './log.js';
import { computeCombatProwess } from '../recompute-derived.js';
import { canPayCost } from '../cost-evaluator.js';
import { heroResourceShortEventActions } from './long-event.js';
import { buildPlayOptionContext, getPlayTargetEffect } from './organization.js';
import { findCharacterCompany, playerById, getCardEffects, companyById, defById, defNamesOf, itemKeywordsOf, isCovertCompany } from '../reducer-utils.js';
import { countConstraintsFromDefinition } from '../pending.js';

/**
 * Find all allies in a company by iterating over each character's allies array.
 * Returns tuples of [allyInPlay, hostCharacterId] for combat targeting.
 */
function findCompanyAllies(
  player: PlayerState,
  companyCharacters: readonly CardInstanceId[],
): Array<{ ally: AllyInPlay; hostCharId: CardInstanceId }> {
  const result: Array<{ ally: AllyInPlay; hostCharId: CardInstanceId }> = [];
  for (const charId of companyCharacters) {
    const charData = player.characters[charId as string];
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
    const charData = player.characters[charId as string];
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
    const charData = player.characters[charId as string];
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
function isAllyImmuneToSiteKeyedAttack(
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
  const halveActions = halveStrikesActions(state, playerId, combat);
  const protectActions = protectFromStrikeAssignmentActions(state, playerId, combat);
  const modifyActions = modifyAttackActions(state, playerId, combat);
  const companyCombatBoosts = companyCombatBoostActions(state, playerId, combat);
  // Tap-ally combat boosts (e.g. Great Lord of Goblin-gate) are available to
  // the ally's owner during the assign-strikes and resolve-strike windows.
  const allyCombatBoosts = tapAllyCombatBoostActions(state, playerId, combat);

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
          ...halveActions,
          ...protectActions,
          ...modifyActions,
          ...companyCombatBoosts,
          ...allyCombatBoosts,
          ...havenJoinAttackActions(state, playerId, combat),
          { action: { type: 'pass' as const, player: playerId }, viable: true },
        ];
      }
      return [...cancelActions, ...halveActions, ...protectActions, ...modifyActions, ...companyCombatBoosts, ...allyCombatBoosts, ...assignStrikeActions(state, playerId, combat)];
    case 'choose-strike-order':
      return chooseStrikeOrderActions(state, playerId, combat);
    case 'resolve-strike': {
      // CvCC resolve-strike: two-step sub-phase — attacker declares -3 first,
      // then defender resolves. No hazard window (rule 8.42: no hazards in CvCC).
      if (combat.isCvCC) {
        return [...cvccResolveStrikeActions(state, playerId, combat), ...allyCombatBoosts];
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
      if (!combat.attackerStep1Done) {
        const attackerHazardCount = combatHazardPermanentPlays(
          state,
          combat.attackingPlayerId,
          combat,
        ).length;
        if (attackerHazardCount > 0) {
          if (playerId === combat.attackingPlayerId) {
            logDetail(`Strike sequence Step 1: attacker has ${attackerHazardCount} hazard(s) to declare — defender waits`);
            return [
              ...hazardPlays,
              { action: { type: 'pass' as const, player: playerId }, viable: true },
            ];
          }
          logDetail('Strike sequence Step 1: defender waits for attacker to pass');
          return [];
        }
      }
      return [
        ...resolveStrikeActions(state, playerId, combat),
        ...hazardPlays,
        ...allyCombatBoosts,
      ];
    }
    case 'body-check':
      return bodyCheckActions(state, playerId, combat);
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
    const charInPlay = playerById(state, playerId)?.characters[offer.characterId as string];
    if (!charInPlay) continue;
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
    const company = companyById(player.companies, combat.companyId);
    if (!company) return [];

    const assignedCharIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));
    const strikesRemaining = combat.strikesTotal - combat.strikeAssignments.length;

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
        const charData = player.characters[charId as string];
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
      const charData = player.characters[charId as string];
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
      const charData = player.characters[charId as string];
      if (!charData) continue;
      if (strikeShieldBlockedChars.has(charId as string)) {
        logDetail(`Character ${charId as string} shielded — must assign strike to ally first`);
        continue;
      }
      if (protectedChars.has(charId as string)) {
        logDetail(`Character ${charId as string} protected from strike assignment (Ruse) — skipping`);
        continue;
      }
      if (charData.status !== CardStatus.Untapped) {
        logDetail(`Character ${charId as string} is ${charData.status} — not available for defender assignment`);
        continue;
      }
      if (combat.excludeAvatarStrikes) {
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
        if (hasPlayFlag(state.cardPool[ally.definitionId as string] as { effects?: readonly import('../../types/effects.js').CardEffect[] } | undefined, 'no-attack')) {
          logDetail(`Ally ${ally.instanceId as string} may not be attacked — excluded from defender strike assignment`);
          continue;
        }
        if (isAllyImmuneToSiteKeyedAttack(state, ally, combat)) {
          logDetail(`Ally ${ally.instanceId as string} immune to this attack — excluded from defender strike assignment`);
          continue;
        }
        // Noble Hound and similar allies with `alwaysCountsAsUntapped` are always assignable.
        const allyDef = defById(state, ally.definitionId);
        const alwaysUntapped = getCardEffects(allyDef).some(
          e => e.type === 'strike-shield' && (e as { alwaysCountsAsUntapped?: boolean }).alwaysCountsAsUntapped,
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

    // Defender may pass only when no forced-strike target is still unassigned.
    if (!restrictToForced) {
      logDetail(`Defender can pass (${strikesRemaining} strike(s) remaining)`);
      actions.push({
        action: { type: 'pass', player: playerId },
        viable: true,
      });
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
    const company = companyById(defPlayer.companies, combat.companyId);
    if (!company) return [];

    const assignedCharIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));
    const totalAllocated = combat.strikeAssignments.length
      + combat.strikeAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
    const strikesRemaining = combat.strikesTotal - totalAllocated;

    if (strikesRemaining <= 0) return [];

    // protect-from-assignment (Ruse mode B): collect IDs shielded from assignment.
    const attackerProtectedChars = new Set<string>(
      (combat.protectedFromStrikeAssignment ?? []).map(id => id as string),
    );

    // Collect all combatants: characters + allies (CoE rule 2.V.2.2)
    const allCombatantIds: Array<{ id: CardInstanceId; tapped: boolean }> = [];
    for (const charId of company.characters) {
      if (attackerProtectedChars.has(charId as string)) {
        logDetail(`Character ${charId as string} protected from strike assignment — excluded from attacker pool`);
        continue;
      }
      if (combat.excludeAvatarStrikes) {
        const charData = defPlayer.characters[charId as string];
        const def = charData?.definitionId ? defById(state, charData.definitionId) : undefined;
        if (isAvatarCharacter(def)) {
          logDetail(`Character ${charId as string} is an avatar — excluded from attacker assignment pool`);
          continue;
        }
      }
      const charData = defPlayer.characters[charId as string];
      allCombatantIds.push({ id: charId, tapped: charData?.status !== CardStatus.Untapped });
    }
    for (const { ally } of findCompanyAllies(defPlayer, company.characters)) {
      if (hasPlayFlag(state.cardPool[ally.definitionId as string] as { effects?: readonly import('../../types/effects.js').CardEffect[] } | undefined, 'no-attack')) {
        logDetail(`Ally ${ally.instanceId as string} may not be attacked — excluded from attacker assignment pool`);
        continue;
      }
      if (isAllyImmuneToSiteKeyedAttack(state, ally, combat)) {
        logDetail(`Ally ${ally.instanceId as string} immune to this attack — excluded from attacker assignment pool`);
        continue;
      }
      allCombatantIds.push({ id: ally.instanceId, tapped: ally.status !== CardStatus.Untapped });
    }

    const unassigned = allCombatantIds.filter(c => !assignedCharIds.has(c.id as string));

    if (unassigned.length > 0) {
      // Still unassigned combatants — must assign to them first
      for (const { id, tapped } of unassigned) {
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
    const charData = atkPlayer.characters[charId as string];
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
    const charData = defPlayer.characters[sa.characterId as string];
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
  const charData = player0.characters[currentStrike.characterId as string];
  const company0 = companyById(player0.companies, combat.companyId);

  // The strike target may be a character or an ally (CoE rule 2.V.2.2)
  const allyMatch = !charData && company0
    ? findAllyInCompany(player0, company0.characters, currentStrike.characterId)
    : undefined;
  const targetStatus = charData?.status ?? allyMatch?.ally.status ?? CardStatus.Untapped;
  const targetDefId = charData?.definitionId ?? allyMatch?.ally.definitionId;
  const isUntapped = targetStatus === CardStatus.Untapped;

  // Compute prowess and need for both tap/untap options
  // Must match the reducer's prowess calculation: base effective prowess,
  // then -1 if tapped, -2 if wounded, -N for excess strikes (CoE 3.iv.7.3)
  const charDef = defById(state, targetDefId);
  const charName = charDef && 'name' in charDef ? (charDef as { name: string }).name : (currentStrike.characterId as string);
  // Recompute prowess with combat context when creature race is known,
  // so combat-conditional weapon effects (e.g. Glamdring vs Orcs) apply.
  let baseProwess: number;
  if (allyMatch) {
    // Allies use prowess from card definition directly
    baseProwess = isAllyCard(charDef) ? (charDef).prowess : 0;
  } else if (combat.creatureRace && charDef && isCharacterCard(charDef) && charData) {
    baseProwess = computeCombatProwess(state, charData, charDef, combat.creatureRace);
  } else {
    baseProwess = charData?.effectiveStats?.prowess ?? 0;
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
  const tapProwess = baseProwess - statusPenalty - excessPenalty + supportBonus + strikeBonus;
  const untapProwess = baseProwess - 3 - statusPenalty - excessPenalty + supportBonus + strikeBonus;

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
  // effect. Mode is determined by effect flags: dodge (no-tap), reroll (two rolls),
  // or default (prowess/body accumulator). All three emit `play-strike-event`.
  const struckSkills = charData && charDef && isCharacterCard(charDef) ? (charDef.skills ?? []) : [];
  for (const handCard of player0.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const strikeEffect = getCardEffects(cardDef).find(
      (e): e is StrikeModifierEffect => e.type === 'strike-modifier',
    );
    if (!strikeEffect) continue;

    let explanation: string;
    let need: number;

    if (strikeEffect.dodge) {
      explanation = `Dodge: need ${tapNeed}+ (prowess ${tapProwess} vs ${strikeProwess}, no tap)`;
      need = tapNeed;
      logDetail(`Dodge available: ${handCard.definitionId as string} for ${charName}`);
    } else if (strikeEffect.reroll) {
      if (strikeEffect.filter) {
        if (!charDef) continue;
        const targetObj: Record<string, unknown> = {};
        if ('race' in charDef) targetObj.race = (charDef as { race: string }).race;
        if ('skills' in charDef) targetObj.skills = (charDef as { skills: readonly string[] }).skills;
        if ('name' in charDef) targetObj.name = (charDef as { name: string }).name;
        if (!matchesCondition(strikeEffect.filter, { target: targetObj })) {
          logDetail(`Reroll strike ${handCard.definitionId as string}: filter not met for ${charName}`);
          continue;
        }
      }
      const rerollBonus = strikeEffect.prowessBonus ?? 0;
      const rerollProwess = tapProwess + rerollBonus;
      const rerollNeed = Math.max(2, strikeProwess - rerollProwess + 1);
      const rerollBonusNote = rerollBonus !== 0 ? `, ${formatSignedNumber(rerollBonus)}` : '';
      explanation = `Reroll: need ${rerollNeed}+ (prowess ${rerollProwess} vs ${strikeProwess}, better of two rolls${rerollBonusNote})`;
      need = rerollNeed;
      logDetail(`Reroll strike available: ${handCard.definitionId as string} for ${charName}`);
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
        const charData = player.characters[charId as string];
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
      const hostChar = player.characters[charId as string];
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
      const compCharData = player0.characters[compCharId as string];
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
          if (combat.creatureRace) ctx['enemy.race'] = combat.creatureRace;
          if (!matchesCondition(csEff.when, ctx)) continue;
        }

        // Check filter condition (target character filtering)
        if (csEff.filter) {
          if (!strikeTargetDef) continue;
          const targetObj: Record<string, unknown> = {};
          if ('race' in strikeTargetDef) targetObj.race = (strikeTargetDef as { race: string }).race;
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
        attack: { source: combat.attackSource.type },
      };
      if (combat.creatureRace) ctx.enemy = { race: combat.creatureRace };
      return ctx;
    };

    for (const item of charData.items) {
      if (item.status !== CardStatus.Untapped) continue;
      const itemDef = defById(state, item.definitionId);
      if (!itemDef) continue;
      for (const eff of getCardEffects(itemDef)) {
        if (eff.type !== 'cancel-strike') continue;
        const csEff = eff;
        if (csEff.cost?.tap !== 'self') continue;
        if (csEff.target && csEff.target !== 'self') continue;

        const itemName = (itemDef as { name?: string }).name ?? (item.definitionId as string);

        if (csEff.when && !matchesCondition(csEff.when, buildCancelCtx())) {
          logDetail(`Cancel-strike ${itemName}: when condition not met for bearer ${bearerName}`);
          continue;
        }

        logDetail(`Cancel-strike available: ${itemName} can tap to cancel strike against ${charName}`);
        actions.push({
          action: {
            type: 'cancel-strike',
            player: playerId,
            cancellerInstanceId: item.instanceId,
            targetCharacterId: currentStrike.characterId,
          },
          viable: true,
        });
      }
    }

    // Also scan allies on the bearer for cancel-strike effects (e.g. Noble Steed).
    for (const ally of charData.allies) {
      if (ally.status !== CardStatus.Untapped) continue;
      const allyDef = defById(state, ally.definitionId);
      if (!allyDef) continue;
      for (const eff of getCardEffects(allyDef)) {
        if (eff.type !== 'cancel-strike') continue;
        const csEff = eff;
        if (csEff.cost?.tap !== 'self') continue;
        if (csEff.target && csEff.target !== 'self') continue;

        const allyName = (allyDef as { name?: string }).name ?? (ally.definitionId as string);

        if (csEff.when && !matchesCondition(csEff.when, buildCancelCtx())) {
          logDetail(`Cancel-strike ${allyName}: when condition not met for bearer ${bearerName}`);
          continue;
        }

        logDetail(`Cancel-strike available: ${allyName} can tap to cancel strike against ${charName}`);
        actions.push({
          action: {
            type: 'cancel-strike',
            player: playerId,
            cancellerInstanceId: ally.instanceId,
            targetCharacterId: currentStrike.characterId,
          },
          viable: true,
        });
      }
    }
  }

  // Cancel-strike: when the strike target is an ally, scan the ally itself for
  // cancel-strike effects (CoE 2.V.2.2 — allies are treated as characters for
  // combat; e.g. Noble Steed can tap to cancel a strike against itself).
  if (allyMatch) {
    const { ally } = allyMatch;
    if (ally.status === CardStatus.Untapped) {
      const allyDef = defById(state, ally.definitionId);
      if (allyDef) {
        const allyName = 'name' in allyDef ? (allyDef as { name: string }).name : (ally.definitionId as string);
        const cancelCtx = (): Record<string, unknown> => {
          const ctx: Record<string, unknown> = {
            attack: { source: combat.attackSource.type },
          };
          if (combat.creatureRace) ctx.enemy = { race: combat.creatureRace };
          return ctx;
        };

        for (const eff of getCardEffects(allyDef)) {
          if (eff.type !== 'cancel-strike') continue;
          const csEff = eff;
          if (csEff.cost?.tap !== 'self') continue;
          if (csEff.target && csEff.target !== 'self') continue;

          if (csEff.when && !matchesCondition(csEff.when, cancelCtx())) {
            logDetail(`Cancel-strike ${allyName}: when condition not met (ally is strike target)`);
            continue;
          }

          logDetail(`Cancel-strike available: ${allyName} can tap to cancel strike against itself`);
          actions.push({
            action: {
              type: 'cancel-strike',
              player: playerId,
              cancellerInstanceId: ally.instanceId,
              targetCharacterId: currentStrike.characterId,
            },
            viable: true,
          });
        }
      }
    }
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
      ? atkPlayer.characters[currentStrike.attackingCharacterId as string]
      : undefined;
    const atkCharDef = atkCharData?.definitionId ? defById(state, atkCharData.definitionId) : undefined;
    const atkCharName = (atkCharDef as { name?: string } | undefined)?.name
      ?? (currentStrike.attackingCharacterId as string | undefined)
      ?? 'attacker';

    const atkStatus = atkCharData?.status ?? CardStatus.Untapped;
    const atkBaseProwess = atkCharData?.effectiveStats?.prowess ?? 0;
    const atkStatusPenalty = atkStatus === CardStatus.Tapped ? 1
      : atkStatus === CardStatus.Inverted ? 2 : 0;
    const tapProwess = atkBaseProwess - atkStatusPenalty;
    const untapProwess = atkBaseProwess - atkStatusPenalty - 3;

    logDetail(`CvCC sub-step 1: attacker ${atkCharName} declares -3 choice (prowess ${tapProwess} or ${untapProwess})`);
    const tapExplanation = `Attacker tapped: prowess ${tapProwess}`;
    const untapExplanation = `Attacker untapped: prowess ${untapProwess} (-3)`;

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

  const strikeCharData = defPlayer.characters[currentStrike.characterId as string];
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
    const turnDupLimit = getCardEffects(def).find(
      (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'turn',
    );
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
 * One action is emitted per eligible untapped item.
 *
 * Used by Shield of Iron-bound Ash (tw-327).
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
  const charData = defPlayer.characters[currentStrike.characterId as string];
  if (!charData) return [];

  const charDef = defById(state, charData.definitionId);
  if (!charDef || !isCharacterCard(charDef)) return [];

  const actions: EvaluatedAction[] = [];

  for (const item of charData.items) {
    if (item.status !== CardStatus.Untapped) continue;
    const itemDef = defById(state, item.definitionId);
    if (!itemDef) continue;
    const effect = getCardEffects(itemDef).find(
      (e): e is ModifyAttackEffect => e.type === 'modify-attack' && (e).scope === 'current-strike',
    );
    if (!effect) continue;
    if (effect.cost?.tap !== 'self') continue;

    if (effect.when) {
      const ctx: Record<string, unknown> = {
        bearer: {
          race: charDef.race,
          skills: charDef.skills,
          name: charDef.name,
        },
      };
      if (combat.creatureRace) ctx.enemy = { race: combat.creatureRace };
      if (!matchesCondition(effect.when, ctx)) {
        const itemName = 'name' in itemDef ? (itemDef as { name: string }).name : (item.definitionId as string);
        logDetail(`Tap-item-for-strike ${itemName}: when condition not met for bearer ${charDef.name ?? ''}`);
        continue;
      }
    }

    const bonus = effect.prowessModifier ?? 0;
    const modifiedProwess = tapProwess + bonus;
    const modifiedNeed = Math.max(2, strikeProwess - modifiedProwess + 1);
    const itemName = 'name' in itemDef ? (itemDef as { name: string }).name : (item.definitionId as string);
    const explanation = `${itemName}: need ${modifiedNeed}+ (prowess ${modifiedProwess} vs ${strikeProwess}, ${formatSignedNumber(bonus)})`;
    logDetail(`Tap-item-for-strike available: tap ${itemName} on ${charDef.name ?? ''} — ${explanation}`);
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
  // Body check always belongs to the opponent of the wounded character:
  // - defender's character wounded → attacker (opponent) rolls
  // - attacker's character wounded (CvCC) → defender (opponent) rolls
  const roller = combat.bodyCheckTarget === 'attacker-character'
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
    const charData = atkPlayer?.characters[strike?.attackingCharacterId as string];
    const charDef = charData ? defById(state, charData.definitionId) : undefined;
    body = (charDef as { body?: number } | undefined)?.body ?? 9;
    targetLabel = charDef && 'name' in charDef ? (charDef as { name: string }).name : 'attacker';
  } else {
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const defPlayer = playerById(state, combat.defendingPlayerId);
    const charData = defPlayer?.characters[strike?.characterId as string];
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
    targetLabel = charDef && 'name' in charDef ? (charDef as { name: string }).name : 'character';
  }
  // +1 to body check roll if the character was already wounded before this strike (CoE rule 3.I)
  const isWounded = combat.bodyCheckTarget === 'character' &&
    combat.strikeAssignments[combat.currentStrikeIndex]?.wasAlreadyWounded === true;
  const woundedBonus = isWounded ? 1 : 0;
  const bcNeed = body + 1 - woundedBonus;
  const bcParts = [`${targetLabel} body ${body}`];
  if (woundedBonus) bcParts.push('+1 wounded');

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
      const charData = strike ? defPlayer.characters[strike.characterId as string] : undefined;
      return charData?.items.find(i => i.instanceId === combat.shieldAbsorbItemId)?.definitionId as string | undefined;
    })() ?? ''
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
function cancelAttackActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  // Only the defending player can cancel, and only before any strikes are assigned
  if (playerId !== combat.defendingPlayerId) return [];
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];
  // Forewarned Is Forearmed: isolated attacks cannot be canceled
  if (combat.uncancelable) {
    logDetail(`Cancel-attack suppressed: attack is uncancelable (Forewarned Is Forearmed)`);
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

  const whenContext = (): Record<string, unknown> => {
    const ctx: Record<string, unknown> = {};
    if (combat.creatureRace) {
      ctx['enemy'] = { race: combat.creatureRace };
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
    const isSiteKeyedCreature = (
      combat.attackSource.type === 'creature' || combat.attackSource.type === 'on-guard-creature'
    ) && !(combat.attackKeying && combat.attackKeying.length > 0);
    attackCtx['siteKeyed'] = isSiteKeyedCreature;
    ctx['attack'] = attackCtx;
    ctx['bearer'] = { companySize: company.characters.length, atHaven };
    ctx['defender'] = { covert: isCovertCompany(company, player, state) };
    return ctx;
  };

  // In-play characters in the defending company with a cancel-attack effect
  // and a "tap self" cost (e.g. Adûnaphel the Ringwraith's Darkhaven tap).
  for (const charId of company.characters) {
    const charData = player.characters[charId as string];
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
  // cancel-attack effect and cost "self-and-bearer" (tap item AND bearer,
  // e.g. Torque of Hues) or cost "bearer" (tap bearer only, e.g. Star-glass).
  for (const charId of company.characters) {
    const charData = player.characters[charId as string];
    if (!charData) continue;
    if (charData.status !== CardStatus.Untapped) {
      logDetail(`Cancel-attack: bearer ${charId as string} is tapped, cannot activate item cancel`);
      continue;
    }
    for (const item of charData.items) {
      const itemDef = defById(state, item.definitionId);
      if (!itemDef) continue;
      const cancelEffect = getCardEffects(itemDef).find(
        (e): e is CancelAttackEffect => e.type === 'cancel-attack',
      );
      if (!cancelEffect) continue;
      const tapCost = cancelEffect.cost?.tap;
      if (tapCost !== 'self-and-bearer' && tapCost !== 'bearer') continue;
      if (tapCost === 'self-and-bearer' && item.status !== CardStatus.Untapped) {
        logDetail(`Cancel-attack ${(itemDef as { name?: string }).name ?? item.definitionId as string}: item tapped, cannot activate`);
        continue;
      }
      if (cancelEffect.when && !matchesCondition(cancelEffect.when, whenContext())) {
        logDetail(`Cancel-attack ${(itemDef as { name?: string }).name ?? item.definitionId as string}: when condition not met`);
        continue;
      }
      logDetail(`Cancel-attack available: tap ${tapCost === 'bearer' ? 'bearer via' : ''} ${(itemDef as { name?: string }).name ?? item.definitionId as string} (in-play item)`);
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

    // Attack-scoped duplication check: if the card has duplication-limit scope
    // "attack", count already-played copies via activeConstraints markers.
    const cancelAttackDupLimit = getCardEffects(cardDef).find(
      (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'attack',
    );
    if (cancelAttackDupLimit) {
      const prior = countConstraintsFromDefinition(state, handCard.definitionId, 'attack');
      if (prior >= cancelAttackDupLimit.max) {
        logDetail(`Cancel-attack ${handCard.definitionId as string}: attack duplication limit reached (${prior}/${cancelAttackDupLimit.max})`);
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
        const charData = player.characters[charId as string];
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

    // Costless cancel-attack: no skill/race requirement (e.g. Dark Quarrels)
    if (!cancelEffect.requiredSkill && !cancelEffect.requiredRace) {
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
    // too. When there is no cost, any matching character suffices.
    const matchesRequirement = (charDef: import('../../types/cards.js').CharacterCard): boolean => {
      if (cancelEffect.requiredSkill) {
        return charDef.skills.includes(cancelEffect.requiredSkill as import('../../types/common.js').Skill);
      }
      if (cancelEffect.requiredRace) {
        return charDef.race === cancelEffect.requiredRace;
      }
      return false;
    };

    if (cancelEffect.cost) {
      for (const charId of company.characters) {
        const charData = player.characters[charId as string];
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
      }
    } else {
      const hasMatch = company.characters.some(charId => {
        const charData = player.characters[charId as string];
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

    for (const charId of company.characters) {
      const charData = player.characters[charId as string];
      if (!charData) continue;
      const charDef = defById(state, charData.definitionId);
      if (!charDef || !isCharacterCard(charDef)) continue;
      if (!charDef.skills.includes(protEff.requiredSkill as import('../../types/common.js').Skill)) {
        logDetail(`protect-from-assignment ${handCard.definitionId as string}: ${charDef.name ?? charId as string} lacks skill "${protEff.requiredSkill}" — skipping`);
        continue;
      }
      logDetail(`protect-from-assignment available: ${handCard.definitionId as string} can protect ${charDef.name ?? charId as string} (skill: ${protEff.requiredSkill})`);
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
      const inPlayNames = [
        ...state.players[0].cardsInPlay.map(c => {
          const d = defById(state, c.definitionId);
          return d && 'name' in d ? (d as { name: string }).name : '';
        }),
        ...state.players[1].cardsInPlay.map(c => {
          const d = defById(state, c.definitionId);
          return d && 'name' in d ? (d as { name: string }).name : '';
        }),
      ];
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
        const charData = player.characters[charId as string];
        if (!charData) continue;
        const charDef = defById(state, charData.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;

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
            const ctx: Record<string, unknown> = {
              bearer: { race: charDef.race, skills: charDef.skills, name: charDef.name },
            };
            if (combat.creatureRace) ctx['enemy'] = { race: combat.creatureRace };
            const attackCtx: Record<string, unknown> = { source: combat.attackSource.type };
            if (combat.attackKeying && combat.attackKeying.length > 0) attackCtx['keying'] = combat.attackKeying;
            const isSiteKeyedCreature = (
              combat.attackSource.type === 'creature' || combat.attackSource.type === 'on-guard-creature'
            ) && !(combat.attackKeying && combat.attackKeying.length > 0)
              && !!(combat.attackSiteKeyingTypes && combat.attackSiteKeyingTypes.length > 0);
            attackCtx['siteKeyed'] = isSiteKeyedCreature;
            ctx['attack'] = attackCtx;
            if (!matchesCondition(effect.when, ctx)) {
              const itemName = 'name' in itemDef ? (itemDef as { name: string }).name : item.definitionId as string;
              logDetail(`Modify-attack ${itemName}: when condition not met (bearer ${charDef.name ?? ''})`);
              continue;
            }
          }

          const itemName = 'name' in itemDef ? (itemDef as { name: string }).name : item.definitionId as string;
          logDetail(`Modify-attack available: tap ${itemName} on ${charDef.name ?? ''} (prowess ${effect.prowessModifier ?? 0}, body ${effect.bodyModifier ?? 0})`);
          actions.push({
            action: { type: 'modify-attack', player: playerId, cardInstanceId: item.instanceId, characterInstanceId: charId },
            viable: true,
          });
        }
      }
    }
  }

  // --- Hand cards (attacker or defender per effect.player) ---
  const inPlayNames = [
    ...state.players[0].cardsInPlay.map(c => {
      const d = defById(state, c.definitionId);
      return d && 'name' in d ? (d as { name: string }).name : '';
    }),
    ...state.players[1].cardsInPlay.map(c => {
      const d = defById(state, c.definitionId);
      return d && 'name' in d ? (d as { name: string }).name : '';
    }),
  ];

  for (const handCard of player.hand) {
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
    const attackDupLimit = getCardEffects(cardDef).find(
      (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'attack',
    );
    if (attackDupLimit) {
      const prior = countConstraintsFromDefinition(state, handCard.definitionId, 'attack');
      if (prior >= attackDupLimit.max) {
        logDetail(`Modify-attack (from hand) ${handCard.definitionId as string}: attack duplication limit reached (${prior}/${attackDupLimit.max})`);
        continue;
      }
    }

    if (effect.when) {
      let baseProwess = combat.strikeProwess;
      if (combat.attackSource.type === 'creature') {
        const atkPlayer = playerById(state, combat.attackingPlayerId);
        if (atkPlayer) {
          const creatureCard = atkPlayer.cardsInPlay.find(
            c => combat.attackSource.type === 'creature' && c.instanceId === (combat.attackSource as { type: 'creature'; instanceId: import('../../types/common.js').CardInstanceId }).instanceId,
          );
          if (creatureCard) {
            const cDef = defById(state, creatureCard.definitionId);
            if (cDef && 'prowess' in cDef) baseProwess = (cDef as { prowess: number }).prowess;
          }
        }
      }
      const enemyCtx: Record<string, unknown> = { prowess: baseProwess };
      if (combat.creatureRace) enemyCtx['race'] = combat.creatureRace;
      const attackCtx: Record<string, unknown> = { source: combat.attackSource.type };
      if (combat.attackKeying && combat.attackKeying.length > 0) attackCtx['keying'] = combat.attackKeying;
      const defendingPlayer = playerById(state, combat.defendingPlayerId);
      const defendingCompany = defendingPlayer ? companyById(defendingPlayer.companies, combat.companyId) : undefined;
      const defenderCovert = defendingPlayer && defendingCompany ? isCovertCompany(defendingCompany, defendingPlayer, state) : false;
      const ctx: Record<string, unknown> = { inPlay: inPlayNames, enemy: enemyCtx, attack: attackCtx, defender: { covert: defenderCovert } };
      if (!matchesCondition(effect.when, ctx)) {
        logDetail(`Modify-attack (from hand) ${handCard.definitionId as string}: when condition not met`);
        continue;
      }
    }

    logDetail(`Modify-attack (from hand) available: ${handCard.definitionId as string} (prowess ${effect.prowessModifier ?? 0}, body ${effect.bodyModifier ?? 0})`);
    actions.push({
      action: { type: 'modify-attack', player: playerId, cardInstanceId: handCard.instanceId },
      viable: true,
    });
  }

  return actions;
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

  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardDef = defById(state, handCard.definitionId);
    const boostEffects = getCardEffects(cardDef).filter(
      (e): e is CompanyCombatBoostEffect => e.type === 'company-combat-boost',
    );
    if (boostEffects.length === 0) continue;

    if (!cardDef) continue;
    // Attack-scoped duplication check.
    const attackDupLimit = getCardEffects(cardDef).find(
      (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'attack',
    );
    if (attackDupLimit) {
      const prior = countConstraintsFromDefinition(state, cardDef.id, 'attack');
      if (prior >= attackDupLimit.max) {
        logDetail(`${(cardDef as { name?: string }).name}: attack duplication limit reached (${prior}/${attackDupLimit.max})`);
        continue;
      }
    }

    // At least one boost effect must match a character in the defending company.
    let hasMatch = false;
    for (const effect of boostEffects) {
      if (!effect.filter) { hasMatch = true; break; }
      for (const charId of company.characters) {
        const char = player.characters[charId as string];
        if (!char) continue;
        const charCardDef = defById(state, char.definitionId);
        if (!charCardDef || !('race' in charCardDef)) continue;
        const ctx = { target: { race: (charCardDef as { race?: string }).race ?? '', name: (charCardDef as { name?: string }).name ?? '', skills: (charCardDef as { skills?: readonly string[] }).skills ?? [] } };
        if (matchesCondition(effect.filter, ctx)) { hasMatch = true; break; }
      }
      if (hasMatch) break;
    }
    if (!hasMatch) {
      logDetail(`${(cardDef as { name?: string }).name}: no matching characters in company — company-combat-boost not offered`);
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
          const member = player.characters[memberId as string];
          if (!member) continue;
          const memberDef = defById(state, member.definitionId);
          if (!memberDef || !('race' in memberDef)) continue;
          const ctx = { target: {
            race: (memberDef as { race?: string }).race ?? '',
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

  // The target character is the one all strikes are assigned to
  const targetCharId = combat.strikeAssignments[0]?.characterId;
  if (!targetCharId) return [];

  const actions: EvaluatedAction[] = [];

  for (const charId of company.characters) {
    // By default the target character cannot tap to cancel (Assassin: "not the defending character").
    // When allowTargetToCancel is set (Slayer: "any one character"), the target may also tap.
    if (!combat.cancelByTapAllowTarget && charId === targetCharId) continue;
    const charData = player.characters[charId as string];
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
      const charData = playerById(state, playerId)?.characters[recipientId as string];
      const charDef = charData ? defById(state, charData.definitionId) : undefined;
      const charName = charDef && 'name' in charDef ? (charDef as { name: string }).name : (recipientId as string);
      const itemDef = defById(state, item.definitionId);
      const itemName = itemDef && 'name' in itemDef ? (itemDef as { name: string }).name : (item.instanceId as string);
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
    const itemName = itemDef && 'name' in itemDef ? (itemDef as { name: string }).name : (item.instanceId as string);
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

  const attacker = playerById(state, playerId);
  if (!attacker) return [];

  const defender = playerById(state, combat.defendingPlayerId);
  if (!defender) return [];
  const targetCharId = currentStrike.characterId;
  const targetChar = defender.characters[targetCharId as string];
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

    const playCondition = getCardEffects(def).find(
      (e): e is PlayConditionEffect => e.type === 'play-condition' && e.requires === 'combat-creature-race',
    );
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
    const charDupLimit = getCardEffects(def).find(
      (e): e is import('../../types/effects.js').DuplicationLimitEffect =>
        e.type === 'duplication-limit' && e.scope === 'character',
    );
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
