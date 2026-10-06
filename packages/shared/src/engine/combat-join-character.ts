/**
 * @module combat-join-character
 *
 * Reducer for a `play-character` carrying `viaCombatEventInstanceId` — a
 * `combat-join-character` permanent resource-event (Helm of Her Secrecy
 * td-122) bringing a named character from hand into the attacked company
 * before strikes are assigned. See {@link CombatJoinCharacterEffect}.
 *
 * The character enters play untapped in the attacked company under the chosen
 * influence (general, or as a follower of a character in that company), with
 * the event placed with it (in its `items`, so the event's `stat-modifier`
 * effects apply to it as bearer). Unless the attack satisfies the effect's
 * `keepWhen`, a {@link PostAttackEffect} discards the event following the
 * attack; the character stays in play either way.
 */

import type { GameState, GameAction, CombatState, CharacterInPlay, CardInstanceId } from '../index.js';
import type { CombatJoinCharacterEffect } from '../types/effects.js';
import { ZERO_EFFECTIVE_STATS } from '../types/state-cards.js';
import { CardStatus } from '../types/common.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { combatJoinCharacterActions } from './legal-actions/combat-join-character.js';
import {
  type ReducerResult,
  defById,
  findById,
  getCardEffects,
  removeById,
  sweepCompanyMembershipChangedEvents,
  updatePlayer,
  wrongActionType,
} from './reducer-utils.js';
import { getPlayerIndex } from '../state-utils.js';

/** Handle a combat-join `play-character` (Helm of Her Secrecy td-122). */
export function handleCombatJoinCharacter(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'play-character') return wrongActionType(state, action, 'play-character');
  const eventId = action.viaCombatEventInstanceId;
  if (!eventId) return { state, error: 'play-character during combat requires a combat-join event' };

  const offered = combatJoinCharacterActions(state, action.player, combat).some(ea => {
    const a = ea.action;
    return a.type === 'play-character'
      && a.characterInstanceId === action.characterInstanceId
      && a.viaCombatEventInstanceId === eventId
      && a.controlledBy === action.controlledBy;
  });
  if (!offered) return { state, error: 'Combat-join character play is not legal now' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const eventCard = findById(player.hand, eventId)!;
  const charCard = findById(player.hand, action.characterInstanceId)!;
  const eventDef = defById(state, eventCard.definitionId);
  const effect = getCardEffects(eventDef).find(
    (e): e is CombatJoinCharacterEffect => e.type === 'combat-join-character',
  )!;
  const eventName = (eventDef as { name?: string }).name ?? (eventCard.definitionId as string);

  const charId = charCard.instanceId;
  const newChar: CharacterInPlay = {
    instanceId: charId,
    definitionId: charCard.definitionId,
    status: CardStatus.Untapped,
    items: [{ instanceId: eventCard.instanceId, definitionId: eventCard.definitionId, status: CardStatus.Untapped }],
    allies: [],
    hazards: [],
    followers: [],
    controlledBy: action.controlledBy,
    effectiveStats: ZERO_EFFECTIVE_STATS,
  };

  const characters: Record<CardInstanceId, CharacterInPlay> = { ...player.characters, [charId]: newChar };
  if (action.controlledBy !== 'general') {
    const ctrl = characters[action.controlledBy];
    characters[action.controlledBy] = { ...ctrl, followers: [...ctrl.followers, charId] };
  }

  let next = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: removeById(removeById(p.hand, eventId), charId),
    characters,
    companies: p.companies.map(c => c.id === combat.companyId ? { ...c, characters: [...c.characters, charId] } : c),
  }));
  logDetail(`${eventName}: ${(defById(state, charCard.definitionId) as { name?: string }).name} joins company ${combat.companyId as string} (controlledBy ${action.controlledBy as string}) with ${eventName} placed on them`);

  const attackCtx = { attack: { creatureRace: combat.creatureRace, creatureRaces: combat.creatureRaces ?? (combat.creatureRace ? [combat.creatureRace] : []) } };
  const keep = effect.keepWhen !== undefined && matchesCondition(effect.keepWhen, attackCtx);
  if (!keep) {
    logDetail(`${eventName}: will be discarded following the attack`);
    next = {
      ...next,
      combat: {
        ...next.combat!,
        postAttackEffects: [...(next.combat!.postAttackEffects ?? []), { targetCharacterId: charId, discardAttachedInstanceId: eventId }],
      },
    };
  } else {
    logDetail(`${eventName}: attack matches keep condition — stays with the character`);
  }

  return { state: sweepCompanyMembershipChangedEvents(next, [combat.companyId]) };
}
