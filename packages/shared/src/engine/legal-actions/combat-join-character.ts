/**
 * @module legal-actions/combat-join-character
 *
 * Legal actions for `combat-join-character` permanent resource-events (Helm of
 * Her Secrecy td-122): a named character in the defending player's hand joins
 * the attacked company before strikes are assigned, paid for with available
 * influence, and the event is placed with the character.
 *
 * Offered to the defending player on their own turn in the pre-assignment
 * window of the `assign-strikes` sub-phase (no strikes assigned yet). Each
 * viable combination of (event, influence source) yields one `play-character`
 * action carrying `viaCombatEventInstanceId`.
 */

import type { GameState, PlayerId, EvaluatedAction, CombatState, CardInstanceId } from '../../index.js';
import type { CombatJoinCharacterEffect } from '../../types/effects.js';
import { isCharacterCard } from '../../types/cards.js';
import { isBalrogAvatarDef } from '../../state-utils.js';
import { hasFollowerGrantPermission } from '../../effects/play-flags.js';
import { logDetail } from './log.js';
import { availableDI } from './organization.js';
import {
  companyBlocksJoins,
  companyById,
  defById,
  generalInfluenceControlLimit,
  getCardEffects,
  isUniqueCharacterInPlay,
  playerById,
} from '../reducer-utils.js';
import { manifestationOfEntityInPlay } from '../manifestations.js';

/** True if `homesite` (a comma-separated list of site names) includes `siteName`. */
export function homesiteListIncludes(homesite: string | undefined, siteName: string): boolean {
  if (!homesite) return false;
  return homesite.split(',').map(s => s.trim()).includes(siteName);
}

/**
 * Generate `play-character` actions (with `viaCombatEventInstanceId`) for
 * in-hand `combat-join-character` events.
 */
export function combatJoinCharacterActions(
  state: GameState,
  playerId: PlayerId,
  combat: CombatState,
): EvaluatedAction[] {
  if (combat.phase !== 'assign-strikes') return [];
  if (combat.strikeAssignments.length > 0) return [];
  if (playerId !== combat.defendingPlayerId) return [];
  // A resource event is played only during its owner's own turn.
  if (playerId !== state.activePlayer) return [];

  const player = playerById(state, playerId);
  if (!player) return [];
  const company = companyById(player.companies, combat.companyId);
  if (!company) return [];

  const actions: EvaluatedAction[] = [];
  for (const eventCard of player.hand) {
    const eventDef = defById(state, eventCard.definitionId);
    const effect = getCardEffects(eventDef).find(
      (e): e is CombatJoinCharacterEffect => e.type === 'combat-join-character',
    );
    if (!effect) continue;
    const eventName = (eventDef as { name?: string }).name ?? (eventCard.definitionId as string);

    if (effect.requiresCompanyHomesite) {
      const hasHomesite = company.characters.some(id => {
        const ch = player.characters[id];
        const chDef = ch ? defById(state, ch.definitionId) : undefined;
        return isCharacterCard(chDef) && homesiteListIncludes(chDef.homesite, effect.requiresCompanyHomesite!);
      });
      if (!hasHomesite) {
        logDetail(`${eventName}: no character in the company has ${effect.requiresCompanyHomesite} as a home site — not offered`);
        continue;
      }
    }

    if (companyBlocksJoins(state, company.id)) {
      logDetail(`${eventName}: company ${company.id as string} is closed to new joins — not offered`);
      continue;
    }

    for (const charCard of player.hand) {
      const charDef = defById(state, charCard.definitionId);
      if (!isCharacterCard(charDef) || charDef.name !== effect.characterName) continue;
      if (charDef.unique && isUniqueCharacterInPlay(state, charDef.name)) {
        logDetail(`${eventName}: ${charDef.name} is unique and already in play`);
        continue;
      }
      if (manifestationOfEntityInPlay(state, charDef) !== null) {
        logDetail(`${eventName}: a manifestation of ${charDef.name} is already in play`);
        continue;
      }
      const mind = charDef.mind;
      if (mind === null) continue;

      const base = {
        type: 'play-character' as const,
        player: playerId,
        characterInstanceId: charCard.instanceId,
        atSite: (company.currentSite?.instanceId ?? '') as CardInstanceId,
        viaCombatEventInstanceId: eventCard.instanceId,
      };

      const remainingGI = generalInfluenceControlLimit(state, playerId) - player.generalInfluenceUsed;
      if (mind <= remainingGI) {
        logDetail(`${eventName}: ${charDef.name} (mind ${mind}) joins under general influence (remaining ${remainingGI})`);
        actions.push({ action: { ...base, controlledBy: 'general' }, viable: true });
      }

      for (const ctrlId of company.characters) {
        const ctrl = player.characters[ctrlId];
        if (!ctrl || ctrl.controlledBy !== 'general') continue;
        const ctrlDef = defById(state, ctrl.definitionId);
        if (!isCharacterCard(ctrlDef)) continue;
        if (isBalrogAvatarDef(ctrlDef) && !hasFollowerGrantPermission(ctrl.items, state.cardPool)) continue;
        const avail = availableDI(state, ctrlId, player, charDef);
        if (avail < mind) continue;
        logDetail(`${eventName}: ${charDef.name} (mind ${mind}) joins under ${ctrlDef.name}'s direct influence (avail ${avail})`);
        actions.push({ action: { ...base, controlledBy: ctrlId }, viable: true });
      }
    }
  }
  return actions;
}
