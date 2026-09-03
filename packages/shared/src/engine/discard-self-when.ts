/**
 * @module discard-self-when
 *
 * Post-action housekeeping for the `discard-self-when` card effect: an in-play
 * card that must be discarded the moment a player-state condition holds. The
 * condition is evaluated against the card controller's player-state context (the
 * same `player.avatar` / `player.stagePoints` / `player.factionCount` context
 * used by the `play-condition` `requires: "player-state"` gate), so an effect
 * can express "stays in play only while …".
 *
 * Used by Prophet of Doom (wh-106): "Discard if you have fewer than 5 factions
 * in play." — a `discard-self-when` whose condition is
 * `{ "player.factionCount": { "$lt": 5 } }`.
 *
 * Distinct from the play-condition (which gates *entry* to play); this gates
 * *remaining* in play and runs as a `postReduce` sweep after every action.
 *
 * A card carrying this effect may also live as an **item** attached to a
 * character rather than bare in `cardsInPlay` — a resource permanent-event
 * played `play-target: "character"` attaches via the `in-play-on-character`
 * move destination, which files it under `CharacterInPlay.items`
 * (`inPlayOnCharacterSlot`, `chain-reducer.ts`). `sweepDiscardSelfWhenItems`
 * covers that case: The White Wizard (wh-36), attached to a Wizard who has
 * Sacrifice of Form, discards itself the moment the opposing player's avatar
 * is Saruman — `{ "opponent.avatarName": "Saruman" }`.
 */
import type { GameState } from '../index.js';
import { Phase } from '../types/state-phases.js';
import { matchesCondition } from '../effects/index.js';
import { logDetail } from './legal-actions/log.js';
import { defById, getCardEffects, discardCardsInPlayWhere, removeAttachment, toCardInstance, updatePlayer } from './reducer-utils.js';
import { buildPlayerStateContext } from './legal-actions/organization.js';

/**
 * Discards any in-play card carrying a `discard-self-when` effect whose
 * condition currently holds against its controller's player-state context —
 * both bare cards in `cardsInPlay` and items attached to a character.
 * Skipped during setup (starting-stage cards must never be swept before the
 * game proper begins).
 */
export function sweepDiscardSelfWhen(state: GameState): GameState {
  if (state.phaseState.phase === Phase.Setup) return state;

  const afterCardsInPlay = discardCardsInPlayWhere(
    state,
    (card, player) => {
      const def = defById(state, card.definitionId);
      const effect = getCardEffects(def).find(e => e.type === 'discard-self-when');
      if (!effect || effect.type !== 'discard-self-when') return false;
      const ctx = buildPlayerStateContext(state, player, player.id);
      return matchesCondition(effect.condition, ctx);
    },
    card => {
      const def = defById(state, card.definitionId);
      logDetail(`discard-self-when: discarding "${def?.name ?? (card.definitionId as string)}" — condition holds`);
    },
  ).state;

  return sweepDiscardSelfWhenItems(afterCardsInPlay);
}

/** The `cardsAttachedToCharacter`-adjacent sweep of {@link sweepDiscardSelfWhen} for character-borne items. */
function sweepDiscardSelfWhenItems(state: GameState): GameState {
  let working = state;
  for (let pi = 0; pi < working.players.length; pi++) {
    const player = working.players[pi];
    for (const ch of Object.values(player.characters)) {
      for (const item of [...ch.items]) {
        const def = defById(working, item.definitionId);
        const effect = getCardEffects(def).find(e => e.type === 'discard-self-when');
        if (!effect || effect.type !== 'discard-self-when') continue;
        const ctx = buildPlayerStateContext(working, player, player.id);
        if (!matchesCondition(effect.condition, ctx)) continue;
        logDetail(`discard-self-when: discarding item "${def?.name ?? (item.definitionId as string)}" from ${ch.instanceId as string} — condition holds`);
        const removed = removeAttachment(working.players[pi], 'items', item.instanceId);
        if (!removed) continue;
        working = updatePlayer(working, pi, () => ({
          ...removed.player,
          discardPile: [...removed.player.discardPile, toCardInstance(item)],
        }));
      }
    }
  }
  return working;
}
