/**
 * @module legal-actions/combat
 *
 * Legal actions during combat. Combat is a self-contained sub-state machine
 * that interrupts the enclosing phase. When `state.combat` is non-null,
 * combat actions take priority over normal phase actions.
 *
 * Combat proceeds through three sub-phases:
 * 1. assign-strikes: defending player assigns strikes to characters, then attacker assigns remaining
 * 2. resolve-strike: defending player resolves each strike (tap-to-fight or stay untapped)
 * 3. body-check: attacking player rolls body check
 */

import type { GameState, PlayerId, EvaluatedAction, CombatState } from '../../index.js';
import { CardStatus } from '../../types/common.js';
import { logHeading, logDetail } from './log.js';

/**
 * Compute legal actions for the current combat sub-phase.
 * Only returns actions for the player whose turn it is to act.
 */
export function combatActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const combat = state.combat;
  if (!combat) return [];

  logHeading(`Combat actions (phase: ${combat.phase}, assignment: ${combat.assignmentPhase})`);

  switch (combat.phase) {
    case 'assign-strikes':
      return assignStrikeActions(state, playerId, combat);
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
      logDetail(`Defender can assign strike to ${charId as string}`);
      actions.push({
        action: { type: 'assign-strike', player: playerId, characterId: charId },
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
        logDetail(`Attacker can assign strike to unassigned ${charId as string}`);
        actions.push({
          action: { type: 'assign-strike', player: playerId, characterId: charId },
          viable: true,
        });
      }
    } else {
      // All characters have a strike — distribute excess as -1 prowess
      for (const charId of company.characters) {
        logDetail(`Attacker can assign excess strike to ${charId as string}`);
        actions.push({
          action: { type: 'assign-strike', player: playerId, characterId: charId, excess: true },
          viable: true,
        });
      }
    }

    return actions;
  }

  return [];
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
  logDetail(`Defender can resolve strike against ${currentStrike.characterId as string} (${isUntapped ? 'untapped' : 'tapped/wounded'})`);
  actions.push({
    action: { type: 'resolve-strike', player: playerId, tapToFight: true },
    viable: true,
  });
  if (isUntapped) {
    actions.push({
      action: { type: 'resolve-strike', player: playerId, tapToFight: false },
      viable: true,
    });
  }

  // Support: any untapped character in the same company who hasn't been assigned a strike
  // (CRF: "tap one or more of their untapped characters ... who hasn't been assigned a strike")
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const company = player.companies.find(c => c.id === combat.companyId);
  const assignedCharIds = new Set(combat.strikeAssignments.map(sa => sa.characterId as string));
  if (company) {
    for (const charId of company.characters) {
      if (assignedCharIds.has(charId as string)) continue;
      const charData = player.characters[charId as string];
      if (!charData || charData.status !== CardStatus.Untapped) continue;
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

  return actions;
}

/**
 * Actions during the body-check sub-phase.
 * The attacking player rolls 2d6 against the body value.
 */
function bodyCheckActions(
  _state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (playerId !== combat.attackingPlayerId) return [];

  logDetail('Attacker rolls body check');
  return [{
    action: { type: 'body-check-roll', player: playerId },
    viable: true,
  }];
}
