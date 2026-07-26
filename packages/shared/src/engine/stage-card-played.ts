/**
 * @module stage-card-played
 *
 * Fires the `on-event: stage-card-played` trigger — an attached card that
 * reacts every time the character's controlling player brings a **stage card**
 * (MEWH §1: any card carrying `alignment: "stage"`) into play.
 *
 * Stage cards are the Fallen-wizard's progress track, so a hazard riding his
 * avatar can punish that progress. Used by Inner Rot (wh-23): "The target makes
 * a corruption check whenever his controlling player plays a stage card."
 *
 * Most stage cards are permanent-events and enter play when their chain entry
 * resolves (`chain-reducer.ts`); a handful are stage items, a stage ally
 * (wh-88/89/114) or stage factions (wh-86/87) that enter play through the site
 * phase (`reducer-site.ts`). All those seams call {@link fireStageCardPlayedTriggers}
 * once the card is actually in play, so "plays a stage card" is read as "a stage
 * card of his enters play" — a faction whose influence attempt fails never
 * enters play and never triggers.
 */
import type { GameState } from '../index.js';
import type { CardDefinition } from '../types/cards.js';
import { isCharacterCard } from '../types/cards.js';
import { matchesContext } from '../effects/index.js';
import { buildBearerContext, resolveDef } from './effects/index.js';
import { enqueueCorruptionCheck } from './pending.js';
import { logDetail } from './legal-actions/log.js';
import { defById, getOnEventEffects } from './reducer-utils.js';

/** True when the card definition is a stage card (MEWH §1 progress track). */
export function isStageCard(def: CardDefinition | null | undefined): boolean {
  return !!def && (def as { alignment?: string }).alignment === 'stage';
}

/**
 * Fires every `on-event: stage-card-played` trigger carried by a card attached
 * to one of `playerIndex`'s characters, after that player has played a stage
 * card. Currently the only supported apply is `force-check` corruption on the
 * bearer, matching Inner Rot (wh-23).
 *
 * A no-op unless `playedDef` is a stage card, so call sites can invoke it
 * unconditionally on any resource entering play.
 *
 * @param state - Game state with the stage card already in play.
 * @param playerIndex - The player who played the stage card (the "controlling
 *   player" the card text names).
 * @param playedDef - Definition of the card just played.
 */
export function fireStageCardPlayedTriggers(
  state: GameState,
  playerIndex: number,
  playedDef: CardDefinition | null | undefined,
): GameState {
  if (!isStageCard(playedDef)) return state;
  const playedName = playedDef!.name;

  let next = state;
  for (const char of Object.values(state.players[playerIndex].characters)) {
    const charDef = resolveDef(state, char.instanceId);
    if (!isCharacterCard(charDef)) continue;
    const ctx = { reason: 'stage-card-played', bearer: buildBearerContext(charDef) };
    for (const attachment of [...char.items, ...char.hazards]) {
      const attachedDef = defById(state, attachment.definitionId);
      for (const onEvent of getOnEventEffects(attachedDef, 'stage-card-played')) {
        if (onEvent.when && !matchesContext(onEvent.when, ctx)) {
          logDetail(`stage-card-played: skipping "${attachedDef?.name ?? '?'}" on ${charDef.name} — when condition not met`);
          continue;
        }
        if (onEvent.apply.type !== 'force-check' || onEvent.apply.check !== 'corruption') continue;
        const modifier = onEvent.apply.modifier ?? 0;
        logDetail(
          `stage-card-played ("${playedName}"): enqueuing corruption check for `
          + `"${attachedDef?.name ?? '?'}" on ${charDef.name} (modifier ${modifier})`,
        );
        next = enqueueCorruptionCheck(next, {
          source: attachment.instanceId,
          // The bearer's controlling player makes the check, even though the
          // hazard belongs to his opponent.
          actor: state.players[playerIndex].id,
          scope: { kind: 'phase', phase: next.phaseState.phase },
          characterId: char.instanceId,
          modifier,
          reason: attachedDef?.name ?? 'Stage card played',
        });
      }
    }
  }
  return next;
}
