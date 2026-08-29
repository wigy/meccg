/**
 * @module short-event-discard
 *
 * Resolution of the "discard a card in play" mode of a resource short event —
 * both the single-target form (Voices of Malice le-250, Marvels Told td-134,
 * Ancient Secrets ba-36, The Cock Crows tw-342) and the sweep form that
 * discards every matching card in play (Wizard's River-horses tw-364).
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
import type { CardInstanceId, GameState, GameAction, PlayerId } from '../index.js';
import type { RegionType } from '../types/common.js';
import { CardStatus } from '../types/common.js';
import { getPlayerIndex } from '../state-utils.js';
import { ownerOf } from '../types/state.js';
import { logDetail } from './legal-actions/log.js';
import { addConstraint, enqueueCorruptionCheck } from './pending.js';
import { applyMove, dropConstraintsSourcedBy, findMoveEffectByShape } from './reducer-move.js';
import type { ReducerResult } from './reducer-utils.js';
import { defById, findAttachment, getCardEffects, matchesDefinition, toCardInstance, updateCharacter, updatePlayer } from './reducer-utils.js';
import { buildInPlayNames } from './recompute-derived.js';
import { resolveAttackProwess, resolveAttackStrikes } from './effects/resolver.js';
import type { RegionTransformEffect } from '../types/effects.js';

/**
 * Re-resolves a live attack's `all-attacks` strikes/prowess bonuses after a
 * card has just left play, and applies the delta to `combat`.
 *
 * CoE 3.i (Pre-Assignment Actions) lets the resource player "modify
 * attributes of the attack as a whole (e.g. the number of strikes ...
 * the prowess ... of the attack)" any time before strikes are assigned —
 * including indirectly, by discarding a hazard long/permanent-event that is
 * granting the attack a global bonus (e.g. Voices of Malice le-250 discarding
 * Wake of War tw-108 before a Spider attack's strikes are assigned). Once
 * assignment starts (CoE 3.ii/3.iii: "actions cannot be taken during this
 * step") the window closes, so this is a no-op past that point — mirroring
 * the gate `modifyAttackActions` uses for the dedicated modify-attack DSL
 * path in `legal-actions/combat.ts`.
 *
 * Computed as a delta (re-resolving at a zero base before and after the
 * discard) rather than a full from-scratch recompute, so it doesn't need to
 * know about the attack's own multi-attack multiplier, creature-self
 * modifiers, or other context baked into `combat.strikesTotal` /
 * `strikeProwess` at initiation — only how much the *global* `all-attacks`
 * bonus changed.
 *
 * @param before - State immediately before the discard was applied.
 * @param after - State immediately after the discard was applied.
 * @returns `after`, with `combat.strikesTotal`/`strikeProwess` adjusted by
 *   the bonus lost (or gained) from the discarded card, or `after` unchanged
 *   when no combat is in its pre-assignment window.
 */
function recomputeLiveAttackAfterDiscard(before: GameState, after: GameState): GameState {
  const combat = after.combat;
  if (!combat || combat.phase !== 'assign-strikes' || combat.strikeAssignments.length > 0) return after;

  const isAutomaticAttack = combat.attackSource.type === 'automatic-attack' || combat.attackSource.type === 'played-auto-attack';
  const isAgentAttack = combat.attackSource.type === 'agent';
  const beforeNames = buildInPlayNames(before);
  const afterNames = buildInPlayNames(after);

  // "Each character faces one strike" creatures (Watcher in the Water, etc.)
  // derive `strikesTotal` from the defending company's character count, not
  // from the printed/modified strikes stat (see chain-reducer.ts's
  // `oneStrikePerCharacter` branch) — an `all-attacks` strikes bonus like
  // Wake of War never fed into `strikesTotal` to begin with, so it must not
  // be subtracted back out when the card granting it leaves play.
  const strikesDelta = combat.eachCharacterFacesOneStrike
    ? 0
    : resolveAttackStrikes(after, 0, afterNames, combat.creatureRace, isAutomaticAttack, undefined, undefined, isAgentAttack)
      - resolveAttackStrikes(before, 0, beforeNames, combat.creatureRace, isAutomaticAttack, undefined, undefined, isAgentAttack);
  const prowessDelta = resolveAttackProwess(after, 0, afterNames, combat.creatureRace, isAutomaticAttack, undefined, undefined, isAgentAttack)
    - resolveAttackProwess(before, 0, beforeNames, combat.creatureRace, isAutomaticAttack, undefined, undefined, isAgentAttack);
  if (strikesDelta === 0 && prowessDelta === 0) return after;

  const newStrikesTotal = Math.max(1, combat.strikesTotal + strikesDelta);
  const newStrikeProwess = combat.strikeProwess + prowessDelta;
  logDetail(`Pre-assignment discard adjusted the live attack: strikes ${combat.strikesTotal} → ${newStrikesTotal}, prowess ${combat.strikeProwess} → ${newStrikeProwess}`);
  return { ...after, combat: { ...combat, strikesTotal: newStrikesTotal, strikeProwess: newStrikeProwess } };
}

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
  // The discarded card sheds any constraint it granted while in play (e.g.
  // The Moon Is Dead's auto-attack duplication) — see dropConstraintsSourcedBy.
  newState = dropConstraintsSourcedBy(newState, [targetInstance.instanceId]);
  // If a live attack is still in its pre-assignment window, the discarded
  // card may have been supplying an `all-attacks` strikes/prowess bonus
  // (e.g. Wake of War) — re-resolve and adjust it (CoE 3.i).
  newState = recomputeLiveAttackAfterDiscard(state, newState);

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
        // CoE 7.1.1: any corruption check declared but not yet resolved may
        // be supported by tapping untapped company mates for +1 each, not
        // just item-transfer/store checks — see rule-3.35's transfer fix.
        allowSupport: true,
      });
    }
  }

  return { state: newState };
}

/**
 * Resolve the "discard **every** matching card in play" mode of a resource
 * short event — a `move { select: 'filter-all', from: 'in-play', to: 'discard' }`
 * (Wizard's River-horses tw-364: "All Nazgûl events are discarded").
 *
 * The sibling of {@link applyShortEventDiscardInPlay}: where that one discards
 * a single target the player chose at declaration time, this one sweeps every
 * in-play card whose definition matches the effect's filter, in both players'
 * `cardsInPlay` and character attachments. Each card goes to its own owner's
 * discard pile (the shared {@link applyMove} primitive routes them).
 *
 * The follow-up corruption check is made by the character named as the event's
 * `play-target` (the Wizard), not by a tapped cost-payer — this mode has no
 * tap cost.
 *
 * @param state - Game state at the moment the short event's chain entry resolves.
 * @param def - Definition of the short event being resolved.
 * @param sourceInstanceId - Instance of the short event (the corruption check's source).
 * @param actor - Player who declared the short event.
 * @param targetCharacterId - The `play-target` character (the Wizard), if any.
 * @returns The updated state, or an error when the sweep could not be applied.
 */
export function applyShortEventDiscardAllInPlay(
  state: GameState,
  def: CardDefinition,
  sourceInstanceId: CardInstanceId,
  actor: PlayerId,
  targetCharacterId: CardInstanceId | undefined,
): ReducerResult {
  const sweep = findMoveEffectByShape({ effects: getCardEffects(def) }, 'filter-all', 'in-play', 'discard');
  if (!sweep) return { state, error: `${def.name}: no discard-all-in-play effect` };

  const playerIndex = getPlayerIndex(state, actor);
  const before = state.players.map(p => p.cardsInPlay.length);
  const moved = applyMove(state, sweep, {
    sourceCardId: sourceInstanceId,
    sourcePlayerIndex: playerIndex,
    ...(targetCharacterId ? { targetCharacterId } : {}),
  });
  if ('error' in moved) return { state, error: moved.error };
  let newState = moved.state;
  const discarded = before.reduce(
    (sum, count, i) => sum + (count - newState.players[i].cardsInPlay.length),
    0,
  );
  logDetail(`${def.name}: discarded ${discarded} matching card(s) from play`);
  // See recomputeLiveAttackAfterDiscard: a swept card may have been
  // supplying an `all-attacks` bonus to a live pre-assignment attack.
  newState = recomputeLiveAttackAfterDiscard(state, newState);

  if (sweep.corruptionCheck && targetCharacterId) {
    newState = enqueueCorruptionCheck(newState, {
      source: sourceInstanceId,
      actor,
      scope: { kind: 'phase' as const, phase: newState.phaseState.phase },
      characterId: targetCharacterId,
      modifier: sweep.corruptionCheck.modifier,
      reason: def.name,
      // CoE 7.1.1: any corruption check declared but not yet resolved may
      // be supported by tapping untapped company mates for +1 each, not
      // just item-transfer/store checks — see rule-3.35's transfer fix.
      allowSupport: true,
    });
  }

  return { state: newState };
}

/**
 * Resolve the "retype a named region" mode of a resource short event (Master
 * of Wood, Water, or Hill, td-136): install a permanent (`until-cleared`)
 * `region.type` `override` `attribute-modifier` constraint for the chosen
 * region and enqueue the sage's follow-up corruption check.
 *
 * Unlike Deeper Shadow's (le-179) `region-type-override` add-constraint —
 * `turn`-scoped and bound to a moving company's destination — this is
 * player-chosen at declaration time and lasts for the rest of the game:
 * `getEffectiveRegionType` (`engine/effective.ts`) folds it in wherever a
 * region's type is asked for (movement, creature keying, detainment), and
 * nothing here or elsewhere ever removes it. The `target` field is a
 * bookkeeping label only (`region.type` lookups key on the constraint's
 * `filter`, not its `target`); the acting player is the natural label since
 * the tap-cost payer may be an ally, which is not itself a valid character
 * target.
 *
 * @param state - Game state at the moment the short event's chain entry resolves.
 * @param def - Definition of the short event being resolved.
 * @param sourceInstanceId - Instance of the short event (the corruption check's source).
 * @param actor - Player who declared the short event.
 * @param regionName - The named region chosen at declaration time.
 * @param newRegionType - The type the region becomes.
 * @param costTapCharacterId - The character (or ally) tapped as the play cost, if any.
 *   Per rule 7.4 an ally that satisfied the skill requirement makes no
 *   corruption check, so the check is skipped in that case.
 */
export function applyShortEventRegionTransform(
  state: GameState,
  def: CardDefinition,
  sourceInstanceId: CardInstanceId,
  actor: PlayerId,
  regionName: string,
  newRegionType: RegionType,
  costTapCharacterId: CardInstanceId | undefined,
): ReducerResult {
  const regionTransform = getCardEffects(def).find(
    (e): e is RegionTransformEffect => e.type === 'region-transform',
  );
  if (!regionTransform) return { state, error: `${def.name}: no region-transform effect` };

  const playerIndex = getPlayerIndex(state, actor);
  logDetail(`${def.name}: region ${regionName} becomes ${newRegionType} (permanent)`);
  let newState = addConstraint(state, {
    source: sourceInstanceId,
    sourceDefinitionId: def.id,
    scope: { kind: 'until-cleared' },
    target: { kind: 'player', playerId: actor },
    kind: {
      type: 'attribute-modifier',
      attribute: 'region.type',
      op: 'override',
      value: newRegionType,
      filter: { 'region.name': regionName },
    },
  });

  if (costTapCharacterId) {
    // Rule 7.4: allies never make corruption checks, but may still fulfill
    // the skill-only active condition that let them tap (e.g. a sage ally
    // tapping for Marvels Told). When the sage is an ally the transform is
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
        modifier: regionTransform.corruptionCheck?.modifier ?? 0,
        reason: def.name,
        // CoE 7.1.1: any corruption check declared but not yet resolved may
        // be supported by tapping untapped company mates for +1 each.
        allowSupport: true,
      });
    }
  }

  return { state: newState };
}

/**
 * Resolve one pick of a `tap-discard-in-play` sub-flow (Praise to Elbereth
 * tw-305): tap the declaring player's chosen untapped character and discard
 * the opponent's chosen untapped in-play card matching the effect's filter.
 *
 * Unlike `applyShortEventDiscardInPlay`, this never rides the chain — the
 * whole point of the "may not be tapped in response" clause is that the
 * opponent gets no window between a card being chosen as this pick's target
 * and it being discarded. Resolving synchronously as part of the pending
 * `card-effect` sub-flow (see `pendingEffectLegalActions` /
 * `tapDiscardInPlayLegalActions`) guarantees that: there is no intervening
 * step where the opponent could declare a response (e.g. tapping a Nazgûl
 * permanent-event to convert it into its short-event mode first). The
 * discard never triggers the target's own on-tap ability, matching "Nazgûl
 * events discarded by Praise to Elbereth have no effect".
 *
 * The pending effect is left queued by the caller (`reducer.ts`) so the same
 * player may repeat the pick; `pass` ends the sub-flow via the shared
 * `resolvePendingEffect` (discarding the source event card).
 */
export function applyTapDiscardInPlay(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'tap-discard-in-play') return { state, error: 'Expected tap-discard-in-play action' };
  if (state.pendingEffects.length === 0) return { state, error: 'No effect sub-flow active' };
  const current = state.pendingEffects[0];
  if (current.type !== 'card-effect' || current.effect.type !== 'tap-discard-in-play') {
    return { state, error: `Expected tap-discard-in-play effect, got ${current.type}` };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const char = player?.characters[action.characterId];
  if (!char) return { state, error: `Character ${action.characterId as string} not found` };
  if (char.status !== CardStatus.Untapped) return { state, error: `Character ${action.characterId as string} is not untapped` };

  const opponentIndex = state.players.findIndex(p => p.id !== action.player);
  const opponentPlayer = opponentIndex !== -1 ? state.players[opponentIndex] : undefined;
  const target = opponentPlayer?.cardsInPlay.find(c => c.instanceId === action.targetInstanceId);
  if (!target) return { state, error: `Target ${action.targetInstanceId as string} not found in opponent's cardsInPlay` };
  if (target.status !== CardStatus.Untapped) return { state, error: `Target ${action.targetInstanceId as string} is not untapped` };
  const targetDef = defById(state, target.definitionId);
  if (!targetDef || !matchesDefinition(targetDef, current.effect.filter)) {
    return { state, error: `Target ${action.targetInstanceId as string} does not match the effect's filter` };
  }

  let newState = updatePlayer(state, playerIndex, p => updateCharacter(p, action.characterId, c => ({ ...c, status: CardStatus.Tapped })));
  const targetInstance = toCardInstance(target);
  const cardName = (targetDef as { name?: string }).name ?? (target.definitionId as string);
  newState = updatePlayer(newState, opponentIndex, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== action.targetInstanceId),
    discardPile: [...p.discardPile, targetInstance],
  }));
  newState = dropConstraintsSourcedBy(newState, [target.instanceId]);
  // See recomputeLiveAttackAfterDiscard: the discarded card may have been
  // supplying an `all-attacks` bonus to a live pre-assignment attack.
  newState = recomputeLiveAttackAfterDiscard(state, newState);
  logDetail(`tap-discard-in-play: tapped ${action.characterId as string}, discarded ${cardName} — resolved outside the chain (no response window)`);

  return { state: newState };
}
