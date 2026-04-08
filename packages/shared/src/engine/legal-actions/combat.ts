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

import type { GameState, PlayerId, EvaluatedAction, CombatState } from '../../index.js';
import type { CancelAttackEffect } from '../../types/effects.js';
import { CardStatus, isCharacterCard } from '../../index.js';
import { logHeading, logDetail } from './log.js';
import { computeCombatProwess } from '../recompute-derived.js';

/**
 * Compute legal actions for the current combat sub-phase.
 * Only returns actions for the player whose turn it is to act.
 */
export function combatActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const combat = state.combat;
  if (!combat) return [];

  logHeading(`Combat actions (phase: ${combat.phase}, assignment: ${combat.assignmentPhase})`);

  // Cancel-attack actions are available to the defending player before
  // any strikes have been assigned (pre-assignment window per CoE rules).
  const cancelActions = cancelAttackActions(state, playerId, combat);

  switch (combat.phase) {
    case 'assign-strikes':
      if (combat.assignmentPhase === 'cancel-by-tap') {
        return cancelByTapActions(state, playerId, combat);
      }
      return [...cancelActions, ...assignStrikeActions(state, playerId, combat)];
    case 'choose-strike-order':
      return chooseStrikeOrderActions(state, playerId, combat);
    case 'resolve-strike':
      return resolveStrikeActions(state, playerId, combat);
    case 'body-check':
      return bodyCheckActions(state, playerId, combat);
    default:
      return [];
  }
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
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    const player = state.players[playerIndex];
    const company = player.companies.find(c => c.id === combat.companyId);
    if (!company) return [];

    const assignedCharIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));
    const strikesRemaining = combat.strikesTotal - combat.strikeAssignments.length;

    if (strikesRemaining <= 0) return [];

    // Offer untapped characters that don't already have a strike
    for (const charId of company.characters) {
      if (assignedCharIds.has(charId as string)) continue;
      const charData = player.characters[charId as string];
      if (!charData) continue;
      if (charData.status !== CardStatus.Untapped) {
        logDetail(`Character ${charId as string} is ${charData.status} — not available for defender assignment`);
        continue;
      }
      logDetail(`Defender can assign strike to ${charId as string} (untapped)`);
      actions.push({
        action: { type: 'assign-strike', player: playerId, characterId: charId, tapped: false },
        viable: true,
      });
    }

    // Defender can always pass to let attacker assign remaining
    logDetail(`Defender can pass (${strikesRemaining} strike(s) remaining)`);
    actions.push({
      action: { type: 'pass', player: playerId },
      viable: true,
    });

    return actions;
  }

  if (combat.assignmentPhase === 'attacker' && playerId === combat.attackingPlayerId) {
    // Attacker assigns remaining strikes to unassigned characters or as excess
    const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
    const defPlayer = state.players[defPlayerIndex];
    const company = defPlayer.companies.find(c => c.id === combat.companyId);
    if (!company) return [];

    const assignedCharIds = new Set(combat.strikeAssignments.map(a => a.characterId as string));
    const totalAllocated = combat.strikeAssignments.length
      + combat.strikeAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
    const strikesRemaining = combat.strikesTotal - totalAllocated;

    if (strikesRemaining <= 0) return [];

    const unassignedChars = company.characters.filter(c => !assignedCharIds.has(c as string));

    if (unassignedChars.length > 0) {
      // Still unassigned characters — must assign to them first
      for (const charId of unassignedChars) {
        const charData = defPlayer.characters[charId as string];
        const isTapped = charData?.status !== CardStatus.Untapped;
        logDetail(`Attacker can assign strike to unassigned ${charId as string} (${isTapped ? 'tapped' : 'untapped'})`);
        actions.push({
          action: { type: 'assign-strike', player: playerId, characterId: charId, tapped: isTapped },
          viable: true,
        });
      }
    } else {
      // All characters have a strike — distribute excess as -1 prowess
      for (const charId of company.characters) {
        const charData = defPlayer.characters[charId as string];
        const isTapped = charData?.status !== CardStatus.Untapped;
        logDetail(`Attacker can assign excess strike to ${charId as string} (${isTapped ? 'tapped' : 'untapped'})`);
        actions.push({
          action: { type: 'assign-strike', player: playerId, characterId: charId, excess: true, tapped: isTapped },
          viable: true,
        });
      }
    }

    return actions;
  }

  return [];
}

/**
 * Actions during the choose-strike-order sub-phase.
 *
 * The defending player picks which unresolved strike to resolve next.
 * Per CRF: "In an order chosen by the defending player, each assigned
 * strike is then resolved by proceeding through an individual strike sequence."
 */
function chooseStrikeOrderActions(state: GameState, playerId: PlayerId, combat: CombatState): EvaluatedAction[] {
  if (playerId !== combat.defendingPlayerId) return [];

  const defPlayerIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];

  const actions: EvaluatedAction[] = [];
  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    const sa = combat.strikeAssignments[i];
    if (sa.resolved) continue;
    const charData = defPlayer.characters[sa.characterId as string];
    const isTapped = charData?.status !== CardStatus.Untapped;
    logDetail(`Defender can choose to resolve strike ${i} (character ${sa.characterId as string}, ${isTapped ? 'tapped' : 'untapped'})`);
    actions.push({
      action: { type: 'choose-strike-order', player: playerId, strikeIndex: i, characterId: sa.characterId, tapped: isTapped },
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
  // The -3 option is only available if the character is currently untapped
  const playerIndex0 = state.players.findIndex(p => p.id === playerId);
  const charData = state.players[playerIndex0].characters[currentStrike.characterId as string];
  const isUntapped = charData?.status === CardStatus.Untapped;
  // Compute prowess and need for both tap/untap options
  // Must match the reducer's prowess calculation: base effective prowess,
  // then -1 if tapped, -2 if wounded, -N for excess strikes (CoE 3.iv.7.3)
  const charDef = state.cardPool[charData?.definitionId as string];
  const charName = charDef && 'name' in charDef ? (charDef as { name: string }).name : (currentStrike.characterId as string);
  // Recompute prowess with combat context when creature race is known,
  // so combat-conditional weapon effects (e.g. Glamdring vs Orcs) apply.
  let baseProwess: number;
  if (combat.creatureRace && charDef && isCharacterCard(charDef) && charData) {
    baseProwess = computeCombatProwess(state, charData, charDef, combat.creatureRace);
  } else {
    baseProwess = charData?.effectiveStats?.prowess ?? 0;
  }
  const strikeProwess = combat.strikeProwess;
  let statusPenalty = 0;
  if (charData?.status === CardStatus.Tapped) statusPenalty = 1;
  if (charData?.status === CardStatus.Inverted) statusPenalty = 2; // Wounded
  const excessPenalty = currentStrike.excessStrikes > 0 ? currentStrike.excessStrikes : 0;

  // Tap: full prowess; Untap: -3 prowess penalty
  const tapProwess = baseProwess - statusPenalty - excessPenalty;
  const untapProwess = baseProwess - 3 - statusPenalty - excessPenalty;

  const tapNeed = Math.max(2, strikeProwess - tapProwess + 1);
  const tapExplanation = `Tapped: need ${tapNeed}+ (prowess ${tapProwess} vs ${strikeProwess})`;
  const untapNeed = Math.max(2, strikeProwess - untapProwess + 1);
  const untapExplanation = `Untapped: need ${untapNeed}+ (prowess ${untapProwess} vs ${strikeProwess})`;

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

  // Support: any untapped character in the same company who hasn't been assigned a strike,
  // or any untapped ally in the company.
  // (CRF: "tap one or more of their untapped characters ... who hasn't been assigned a strike")
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === combat.companyId);
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
  if (playerId !== combat.attackingPlayerId) return [];

  let body: number;
  let targetLabel: string;
  if (combat.bodyCheckTarget === 'creature') {
    body = combat.creatureBody ?? 0;
    targetLabel = 'creature';
  } else {
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const defPlayer = state.players.find(p => p.id === combat.defendingPlayerId);
    const charData = defPlayer?.characters[strike?.characterId as string];
    const charDef = charData ? state.cardPool[charData.definitionId as string] : undefined;
    body = (charDef as { body?: number } | undefined)?.body ?? 9;
    targetLabel = charDef && 'name' in charDef ? (charDef as { name: string }).name : 'character';
  }
  // +1 to body check roll if the character was already wounded before this strike (CoE rule 3.I)
  const isWounded = combat.bodyCheckTarget === 'character' &&
    combat.strikeAssignments[combat.currentStrikeIndex]?.wasAlreadyWounded === true;
  const woundedBonus = isWounded ? 1 : 0;
  const bcNeed = body + 1 - woundedBonus;
  const bcParts = [`${targetLabel} body ${body}`];
  if (woundedBonus) bcParts.push('+1 wounded');

  logDetail(`Attacker rolls body check vs ${targetLabel} (body ${body}${isWounded ? ', wounded +1' : ''})`);
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
 * Generate cancel-attack actions for the defending player during the
 * pre-assignment window (assign-strikes phase before any strikes assigned).
 *
 * For each card in the defending player's hand that has a `cancel-attack`
 * effect, and for each untapped character in the defending company with the
 * required skill, generate a cancel-attack action.
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

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === combat.companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardDef = state.cardPool[handCard.definitionId as string];
    if (!cardDef || !('effects' in cardDef)) continue;
    const cardWithEffects = cardDef as { effects?: readonly import('../../types/effects.js').CardEffect[] };
    if (!cardWithEffects.effects) continue;

    const cancelEffect = cardWithEffects.effects.find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    if (!cancelEffect) continue;

    // Find untapped characters in the company with the required skill
    for (const charId of company.characters) {
      const charData = player.characters[charId as string];
      if (!charData || charData.status !== CardStatus.Untapped) continue;

      const charDef = state.cardPool[charData.definitionId as string];
      if (!charDef || !isCharacterCard(charDef)) continue;

      if (!charDef.skills.includes(cancelEffect.requiredSkill as import('../../types/common.js').Skill)) continue;

      logDetail(`Cancel-attack available: ${handCard.definitionId as string} via ${charData.definitionId as string}`);
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

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === combat.companyId);
  if (!company) return [];

  // The target character is the one all strikes are assigned to
  const targetCharId = combat.strikeAssignments[0]?.characterId;
  if (!targetCharId) return [];

  const actions: EvaluatedAction[] = [];

  for (const charId of company.characters) {
    // Cannot tap the target character
    if (charId === targetCharId) continue;
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
