/**
 * @module legal-actions/free-council
 *
 * Legal actions during the Free Council (endgame) phase. All characters
 * must make corruption checks before final marshalling points are tallied.
 * Each player performs corruption checks in turn, starting with the player
 * who took the last turn. Characters already checked are tracked in
 * the phase state's `checkedCharacters` array.
 *
 * Per CoE rule 7.1.1, after a corruption check is declared but before it
 * resolves, other untapped characters in the same company may tap for
 * +1 support each. This is handled via the `pendingCheck` sub-state.
 */

import type { GameState, PlayerId, GameAction, CardInstanceId, FreeCouncilPhaseState, EvaluatedAction } from '../../index.js';
import { formatSignedNumber } from '../../format-helpers.js';
import { requirePhaseState, isBalrogAvatarDef } from '../../state-utils.js';
import { isCharacterCard } from '../../types/cards.js';
import { CardStatus, Race } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import { collectCharacterEffects, resolveCheckModifier } from '../effects/index.js';
import { logDetail } from './log.js';
import { grantedActionActivations, modifyCorruptionCheckGrantActions } from './organization.js';
import { reactiveCorruptionCheckPlays } from './pending.js';
import { characterIds, findCharacterCompany, playerById, defById } from '../reducer-utils.js';
import { asViable as viable } from './evaluated.js';

export function freeCouncilActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const fcState = requirePhaseState(state, Phase.FreeCouncil);

  if (fcState.step === 'done') {
    return [];
  }

  // Grant-actions flagged `freeCouncil: true` (e.g. Magical Harp) are
  // available to both players during the corruption-checks step, not
  // only the player currently running their checks. Collect them up
  // front and append to every exit below.
  const grantActions = grantedActionActivations(state, playerId, 'freeCouncil');

  // Only the current player performs corruption checks
  if (playerId !== fcState.currentPlayer) {
    return grantActions;
  }

  const player = playerById(state, playerId);
  if (!player) return grantActions;

  // If a corruption check is pending (awaiting support), offer support actions.
  // Permanent events that modify a corruption check by a company character
  // (When I Know Anything td-166) are activatable in this same window: the
  // bearer taps to add +3 to the pending check, then makes a check himself.
  // Per CoE 10.3.i, either player may also take resource/character actions
  // that would reduce the checked character's corruption point total or
  // prevent it from being discarded (e.g. Halfling Strength's +4 modifier) —
  // the same reactive short-event scan the generic pending-resolution
  // corruption-check window uses.
  if (fcState.pendingCheck) {
    const modifierGrants = modifyCorruptionCheckGrantActions(state, playerId, fcState.pendingCheck.characterId);
    const checkedChar = player.characters[fcState.pendingCheck.characterId];
    const reactivePlays = checkedChar ? reactiveCorruptionCheckPlays(state, playerId, checkedChar) : [];
    return [...viable(supportActions(state, playerId, fcState)), ...reactivePlays, ...modifierGrants, ...grantActions];
  }

  const checked = new Set(fcState.checkedCharacters);
  const actions: GameAction[] = [];

  // Corruption check for each unchecked character in play
  for (const charId of characterIds(player)) {
    if (checked.has(charId)) continue;
    const charInPlay = player.characters[charId];
    const charDef = defById(state, charInPlay.definitionId);
    const cp = charInPlay.effectiveStats.corruptionPoints;
    const checkContext = { reason: 'corruption-check' };
    let modifier = resolveCheckModifier(collectCharacterEffects(state, charInPlay, checkContext), 'corruption');

    // Rule 10.05: a character in the same company as a Ringwraith or the
    // Balrog receives an additional +2 modifier to corruption checks.
    const company = findCharacterCompany(player.companies, charId);
    const hasCorruptingAvatar = company?.characters.some(cid => {
      const compChar = player.characters[cid];
      if (!compChar) return false;
      const compDef = defById(state, compChar.definitionId);
      return isCharacterCard(compDef) && (compDef.race === Race.Ringwraith || isBalrogAvatarDef(compDef));
    }) ?? false;
    if (hasCorruptingAvatar) {
      modifier += 2;
      logDetail(`Corruption check +2 (rule 10.05): company includes a Ringwraith/Balrog avatar`);
    }
    const possessions: CardInstanceId[] = [
      ...charInPlay.items.map(i => i.instanceId),
      ...charInPlay.allies.map(a => a.instanceId),
      ...charInPlay.hazards.map(h => h.instanceId),
    ];
    const ccNeed = cp + 1 - modifier;
    const ccParts = [`CP ${cp}`];
    if (modifier !== 0) ccParts.push(`modifier ${formatSignedNumber(modifier)}`);
    logDetail(`Corruption check available for '${charDef?.name ?? charId}' (CP ${cp}, modifier ${formatSignedNumber(modifier)})`);
    actions.push({
      type: 'corruption-check',
      player: playerId,
      characterId: charId,
      corruptionPoints: cp,
      corruptionModifier: modifier,
      possessions,
      need: ccNeed,
      explanation: `Need roll > ${cp - modifier} (${ccParts.join(', ')})`,
    });
  }

  // Pass advances to scoring only after all characters have been checked
  if (actions.length === 0) {
    actions.push({ type: 'pass', player: playerId });
    logDetail('Free Council: all characters checked, pass available');
  } else {
    logDetail(`Free Council: ${actions.length} character(s) available for corruption checks`);
  }
  return [...viable(actions), ...grantActions];
}

/**
 * Computes support actions for a pending corruption check.
 *
 * Eligible supporters are untapped characters in the same company as the
 * character making the check (excluding the check target itself).
 * Each tapped supporter adds +1 to the roll (CoE rule 7.1.1).
 * Pass is always available to resolve the check without further support.
 */
function supportActions(
  state: GameState,
  playerId: PlayerId,
  fcState: FreeCouncilPhaseState,
): GameAction[] {
  const pending = fcState.pendingCheck!;
  const player = playerById(state, playerId)!;
  const actions: GameAction[] = [];

  // Find the company containing the character making the check
  const company = findCharacterCompany(player.companies, pending.characterId);
  if (company) {
    for (const charId of company.characters) {
      if (charId === pending.characterId) continue;
      const charInPlay = player.characters[charId];
      if (!charInPlay) continue;
      if (charInPlay.status !== CardStatus.Untapped) continue;

      const charDef = defById(state, charInPlay.definitionId);
      const charName = charDef?.name ?? (charId as string);
      logDetail(`Support available: ${charName} can tap for +1 to corruption check`);
      actions.push({
        type: 'support-corruption-check',
        player: playerId,
        supportingCharacterId: charId,
      });
    }
  }

  logDetail(`Corruption check support: ${actions.length} supporter(s) available, pass to resolve`);
  // Pass resolves the pending check with accumulated support
  actions.push({ type: 'pass', player: playerId });
  return actions;
}
