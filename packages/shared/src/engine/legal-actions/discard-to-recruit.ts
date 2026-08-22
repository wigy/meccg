/**
 * @module legal-actions/discard-to-recruit
 *
 * Emits `discard-to-recruit` actions for in-play characters carrying a
 * `discard-to-recruit` effect (e.g. Folco Boffin dm-180: "You may discard
 * Folco Boffin at a Haven to play any Hobbit from your hand with his
 * company").
 *
 * Per CRF 22 (Folco Boffin) the replacement "can be done at any time that a
 * normal resource could be played", so — like `manifestation-swap` — the
 * emitter is wired into the controller's organization, movement/hazard, and
 * site phase aggregators. The replacement is not a character play: it never
 * consumes the one-character-per-turn slot and needs no site or influence
 * eligibility beyond the bearer being in a company (with `requireHaven`, that
 * company must be at a Haven).
 */

import type { GameState, PlayerId, EvaluatedAction } from '../../index.js';
import type { DiscardToRecruitEffect } from '../../types/effects.js';
import { isCharacterCard } from '../../types/cards.js';
import { SiteType } from '../../types/common.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { logDetail } from './log.js';
import { characterEntries, companySiteDef, defById, findCharacterCompany, getCardEffects, isUniqueCharacterInPlay, playerById } from '../reducer-utils.js';
import { manifestationOfEntityInPlay } from '../manifestations.js';

/**
 * One action per (in-play recruit-carrying character, matching hand card)
 * pair. Only the acting player's own characters and hand are consulted, and
 * only on their own turn (resources are played by the active player).
 */
export function discardToRecruitActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.activePlayer !== playerId) return [];
  const player = playerById(state, playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  for (const [charId, char] of characterEntries(player)) {
    const def = defById(state, char.definitionId);
    if (!def || !isCharacterCard(def)) continue;
    const recruit = getCardEffects(def).find(
      (e): e is DiscardToRecruitEffect => e.type === 'discard-to-recruit',
    );
    if (!recruit) continue;

    // "with <bearer>'s company" — the bearer must be in a company.
    const company = findCharacterCompany(player.companies, charId);
    if (!company) {
      logDetail(`discard-to-recruit on ${def.name}: bearer has no company`);
      continue;
    }

    // "at a Haven" — the company's current site must be a Haven.
    if (recruit.requireHaven) {
      const siteDef = companySiteDef(state, company);
      if (siteDef?.siteType !== SiteType.Haven) {
        logDetail(`discard-to-recruit on ${def.name}: company not at a Haven (${company.currentSite ? siteDef?.name : 'no site'})`);
        continue;
      }
    }

    for (const handCard of player.hand) {
      const handDef = defById(state, handCard.definitionId);
      if (!handDef || !isCharacterCard(handDef)) continue;
      if (recruit.filter && !matchesCondition(recruit.filter, { target: handDef })) continue;

      // Bringing a character into play via this effect is still a character
      // play, so the state-corrupting eligibility gates apply. (The
      // home-site-only flag does NOT: Folco's text explicitly plays "any
      // Hobbit ... at a Haven", and every Hobbit is home-site-only to Bag End,
      // a free-hold — gating on it would make the ability permanently dead.)
      // Uniqueness: a unique character already in play cannot be recruited.
      if (handDef.unique && isUniqueCharacterInPlay(state, handDef.name)) {
        logDetail(`discard-to-recruit: ${handDef.name} is unique and already in play`);
        continue;
      }
      // Glossary g.man.1: an in-play manifestation of the same entity blocks it.
      const blockingManifestation = manifestationOfEntityInPlay(state, handDef);
      if (blockingManifestation !== null) {
        logDetail(`discard-to-recruit: ${blockingManifestation}, a manifestation of the same entity as ${handDef.name}, is in play (g.man.1)`);
        continue;
      }

      logDetail(`discard-to-recruit available: ${handDef.name} may be brought in for discarded ${def.name}`);
      actions.push({
        action: {
          type: 'discard-to-recruit',
          player: playerId,
          characterId: charId,
          cardInstanceId: handCard.instanceId,
        },
        viable: true,
      });
    }
  }
  return actions;
}
