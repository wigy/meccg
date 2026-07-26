/**
 * @module short-event-discard
 *
 * Resolution of the "discard a card in play" mode of a resource short event
 * (Voices of Malice le-250, Marvels Told td-134, Ancient Secrets ba-36,
 * The Cock Crows tw-342).
 *
 * Playing a short event is an action like any other, so per CoE 9.4/9.5 it is
 * declared on the chain of effects and only resolves once both players have
 * passed priority. The declaration side lives in `reducer-events`
 * (`handlePlayResourceShortEvent`, which pays the tap cost and pushes the card
 * onto the chain carrying the chosen discard target); the resolution lives
 * here and is invoked by the chain resolver (`chain-reducer`). Keeping it in
 * its own module lets both sides share the code without an import cycle.
 */

import type { CardDefinition } from '../types/cards.js';
import type { CardInstanceId, GameState, PlayerId } from '../index.js';
import { getPlayerIndex } from '../state-utils.js';
import { ownerOf } from '../types/state.js';
import { logDetail } from './legal-actions/log.js';
import { enqueueCorruptionCheck } from './pending.js';
import { findMoveEffectByShape } from './reducer-move.js';
import type { ReducerResult } from './reducer-utils.js';
import { defById, findAttachment, getCardEffects, toCardInstance, updateCharacter, updatePlayer } from './reducer-utils.js';

/**
 * Move the chosen `discard-in-play` target to its owner's discard pile and
 * enqueue the follow-up corruption check, if the card prescribes one.
 *
 * The target may live either in the owner's general cards-in-play list (Eye of
 * Sauron long-events, free-standing permanent-events) or attached to one of
 * their characters as a hazard (Foolish Words, Lure of the Senses, etc.), so
 * both zones are searched.
 *
 * @param state - Game state at the moment the short event's chain entry resolves.
 * @param def - Definition of the short event being resolved.
 * @param sourceInstanceId - Instance of the short event (the corruption check's source).
 * @param actor - Player who declared the short event.
 * @param discardTargetInstanceId - The in-play card chosen at declaration time.
 * @param costTapCharacterId - The character tapped as the play cost, if any.
 *   Per rule 7.4 an ally that satisfied the skill requirement makes no
 *   corruption check, so the check is skipped in that case.
 * @returns The updated state, or an error when the target is no longer in play.
 */
export function applyShortEventDiscardInPlay(
  state: GameState,
  def: CardDefinition,
  sourceInstanceId: CardInstanceId,
  actor: PlayerId,
  discardTargetInstanceId: CardInstanceId,
  costTapCharacterId: CardInstanceId | undefined,
): ReducerResult {
  const discardInPlay = findMoveEffectByShape({ effects: getCardEffects(def) }, 'target', 'in-play', 'discard');
  if (!discardInPlay) return { state, error: `${def.name}: no discard-in-play effect` };

  const playerIndex = getPlayerIndex(state, actor);
  let foundOwnerIndex = -1;
  let foundCardsInPlayIdx = -1;
  let foundCharId: string | null = null;
  let foundHazardIdx = -1;
  for (let oi = 0; oi < state.players.length; oi++) {
    const idx = state.players[oi].cardsInPlay.findIndex(c => c.instanceId === discardTargetInstanceId);
    if (idx !== -1) { foundOwnerIndex = oi; foundCardsInPlayIdx = idx; break; }
    const chars = state.players[oi].characters;
    for (const charId of Object.keys(chars) as CardInstanceId[]) {
      const hIdx = chars[charId].hazards.findIndex(h => h.instanceId === discardTargetInstanceId);
      if (hIdx !== -1) { foundOwnerIndex = oi; foundCharId = charId; foundHazardIdx = hIdx; break; }
    }
    if (foundOwnerIndex !== -1) break;
  }
  if (foundOwnerIndex === -1) return { state, error: 'discard-in-play target not found in any zone' };

  let newState = state;
  const owner = newState.players[foundOwnerIndex];
  let targetInstance: { instanceId: CardInstanceId; definitionId: import('../index.js').CardDefinitionId };
  if (foundCardsInPlayIdx !== -1) {
    const targetCard = owner.cardsInPlay[foundCardsInPlayIdx];
    targetInstance = toCardInstance(targetCard);
    const newOwnerCardsInPlay = [...owner.cardsInPlay];
    newOwnerCardsInPlay.splice(foundCardsInPlayIdx, 1);
    newState = updatePlayer(newState, foundOwnerIndex, p => ({
      ...p,
      cardsInPlay: newOwnerCardsInPlay,
      discardPile: [...p.discardPile, targetInstance],
    }));
  } else {
    const charId = foundCharId! as CardInstanceId;
    const char = owner.characters[charId];
    const haz = char.hazards[foundHazardIdx];
    targetInstance = toCardInstance(haz);
    const newHazards = [...char.hazards];
    newHazards.splice(foundHazardIdx, 1);
    // Remove the hazard from the character (character belongs to foundOwnerIndex).
    newState = updatePlayer(newState, foundOwnerIndex, p => ({
      ...updateCharacter(p, charId, c => ({ ...c, hazards: newHazards })),
    }));
    // Discard to the card's actual owner's discard pile. In production, instance IDs
    // are player-prefixed (e.g. "p2-29"), so ownerOf() resolves to the hazard player.
    // In synthetic test states with "inst-N" IDs, fall back to foundOwnerIndex.
    const hazOwner = ownerOf(haz.instanceId) as string;
    let hazardOwnerIdx = newState.players.findIndex(p => (p.id as string) === hazOwner);
    if (hazardOwnerIdx === -1) hazardOwnerIdx = foundOwnerIndex;
    newState = updatePlayer(newState, hazardOwnerIdx, p => ({
      ...p,
      discardPile: [...p.discardPile, targetInstance],
    }));
  }
  const targetDef = defById(newState, targetInstance.definitionId)!;
  logDetail(`${def.name} discards ${targetDef.name} from ${owner.id as string}'s in-play`);

  if (discardInPlay.corruptionCheck && costTapCharacterId) {
    // Rule 7.4: allies never make corruption checks, but may still fulfill
    // the skill-only active condition that let them tap (e.g. a sage ally
    // tapping for Marvels Told). When the sage is an ally the discard is
    // still implemented but the corruption check is skipped entirely.
    const sageIsAlly = !newState.players[playerIndex].characters[costTapCharacterId]
      && findAttachment(newState.players[playerIndex], 'allies', costTapCharacterId) != null;
    if (sageIsAlly) {
      logDetail(`${def.name}: sage ${costTapCharacterId as string} is an ally — corruption check skipped (rule 7.4)`);
    } else {
      newState = enqueueCorruptionCheck(newState, {
        source: sourceInstanceId,
        actor,
        scope: { kind: 'phase' as const, phase: newState.phaseState.phase },
        characterId: costTapCharacterId,
        modifier: discardInPlay.corruptionCheck.modifier,
        reason: def.name,
      });
    }
  }

  return { state: newState };
}
