/**
 * @module legal-actions/recruit-via-event
 *
 * Character recruitment via a short resource-event (A Chance Meeting tw-188,
 * We Have Come to Kill le-252). These events bring one character from hand into
 * play under relaxed recruitment rules — see {@link RecruitCharacterEffect}:
 *
 * - playable in the organization, movement/hazard, and site phases (any phase a
 *   company is at a site), so this helper is invoked from each of those phase
 *   aggregators and self-gates on a company being present at a qualifying site;
 * - the recruit enters an existing company whose current site type is one of the
 *   effect's `siteTypes`, controlled by a character in that company with enough
 *   unused direct influence;
 * - the play does not consume the one-character-per-turn slot.
 *
 * Each viable recruit produces a `play-character` action carrying
 * `viaEventInstanceId` (the event card) so the reducer can discard the event and
 * skip the normal one-character-per-turn bookkeeping.
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardInstanceId,
} from '../../index.js';
import { isCharacterCard, isSiteCard } from '../../types/cards.js';
import type { CardEffect, RecruitCharacterEffect } from '../../types/effects.js';
import { logDetail } from './log.js';
import { resolveDef } from '../effects/index.js';
import { characterEntries, defById, matchesDefinition, playerById, isUniqueCharacterInPlay } from '../reducer-utils.js';
import { manifestationOfEntityInPlay } from '../manifestations.js';
import { getEffectiveSiteType } from '../effective.js';
import { availableDI } from './organization.js';
import { isBalrogAvatarDef } from '../../state-utils.js';
import { hasFollowerGrantPermission, hasPlayFlag } from '../../effects/play-flags.js';

/**
 * Generates `play-character` actions enabled by an in-hand `recruit-character`
 * event for the active player. One action is emitted per
 * (event, recruit-in-hand, company-at-qualifying-site, direct-influence
 * controller) combination. Returns an empty list when the player holds no such
 * event or when no recruit is currently eligible.
 */
export function recruitViaEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  // Only the active player, on their own turn, may play a resource event.
  if (state.activePlayer !== playerId) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  // Find in-hand events carrying a recruit-character effect.
  const events: { instanceId: CardInstanceId; effect: RecruitCharacterEffect; name: string }[] = [];
  for (const card of player.hand) {
    const def = defById(state, card.definitionId);
    const effects = (def as { effects?: readonly CardEffect[] } | undefined)?.effects ?? [];
    const eff = effects.find((e): e is RecruitCharacterEffect => e.type === 'recruit-character');
    if (eff) {
      events.push({
        instanceId: card.instanceId,
        effect: eff,
        name: (def as { name?: string } | undefined)?.name ?? (card.definitionId as string),
      });
    }
  }
  if (events.length === 0) return [];

  const results: EvaluatedAction[] = [];

  for (const event of events) {
    // Companies whose current site type qualifies for this event.
    const qualifyingCompanies = player.companies.filter(c => {
      if (!c.currentSite) return false;
      const siteDef = resolveDef(state, c.currentSite.instanceId);
      if (!isSiteCard(siteDef)) return false;
      const effType = getEffectiveSiteType(state, c.currentSite.definitionId, siteDef.siteType, c.currentSite.instanceId);
      return event.effect.siteTypes.includes(effType);
    });
    if (qualifyingCompanies.length === 0) {
      logDetail(`${event.name}: no company at a qualifying site [${event.effect.siteTypes.join(', ')}] — no recruit possible`);
      continue;
    }

    for (const handCard of player.hand) {
      if (handCard.instanceId === event.instanceId) continue;
      const recruitDef = defById(state, handCard.definitionId);
      if (!recruitDef || !isCharacterCard(recruitDef)) continue;

      // Pure "Hazard Agent" cards (Lobelia dm-28, My Precious dm-29) are
      // deploy-only — they can never be brought into a company as characters.
      if (hasPlayFlag(recruitDef, 'hazard-agent-only')) continue;

      // The event brings a character in "with direct influence": an avatar
      // (mind null) cannot be controlled under direct influence.
      if (recruitDef.mind === null) continue;

      // Effect filter (e.g. exclude Wizards).
      if (event.effect.filter && !matchesDefinition(recruitDef, event.effect.filter)) {
        logDetail(`${event.name}: ${recruitDef.name} excluded by filter`);
        continue;
      }

      // Uniqueness: a unique character already in play cannot be recruited.
      if (recruitDef.unique && isUniqueCharacterInPlay(state, recruitDef.name)) {
        logDetail(`${event.name}: ${recruitDef.name} is unique and already in play`);
        continue;
      }

      // Glossary g.man.1: an in-play manifestation of the same entity also
      // blocks the recruit (e.g. Strider in play blocks Aragorn II).
      const blockingManifestation = manifestationOfEntityInPlay(state, recruitDef);
      if (blockingManifestation !== null) {
        logDetail(`${event.name}: ${blockingManifestation}, a manifestation of the same entity as ${recruitDef.name}, is in play (g.man.1)`);
        continue;
      }

      const costMind = recruitDef.mind;

      for (const company of qualifyingCompanies) {
        // Find controllers in this company with enough unused direct influence.
        // The Balrog (ba-3) "may not have any followers" — excluded, unless a
        // fána card such as Great Shadow (ba-62) grants him the permission
        // (`grants-followers` play-flag on an attached item).
        for (const [key, char] of characterEntries(player)) {
          if (!company.characters.includes(key)) continue;
          if (char.controlledBy !== 'general') continue;
          const ctrlDef = resolveDef(state, char.instanceId);
          if (!isCharacterCard(ctrlDef)) continue;
          if (isBalrogAvatarDef(ctrlDef) && !hasFollowerGrantPermission(char.items, state.cardPool)) continue;
          const avail = availableDI(state, key, player, recruitDef);
          if (avail < costMind) continue;

          logDetail(
            `${event.name}: recruit ${recruitDef.name} (mind ${costMind}) at ${company.currentSite!.definitionId as string} ` +
            `under ${ctrlDef.name}'s direct influence (avail DI ${avail})`,
          );
          results.push({
            action: {
              type: 'play-character',
              player: playerId,
              characterInstanceId: handCard.instanceId,
              atSite: company.currentSite!.instanceId,
              controlledBy: key,
              viaEventInstanceId: event.instanceId,
            },
            viable: true,
          });
        }
      }
    }
  }

  return results;
}
