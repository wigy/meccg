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
 *   effect's `siteTypes`, paid for by the influence the effect permits
 *   (`controlledBy`): a character in that company with enough unused direct
 *   influence, the player's unused general influence, or either;
 * - an agent may be recruited only when the event says so (`allowAgents`),
 *   overriding rule 2.II.2.2.5's home-site confinement;
 * - a Ringwraith avatar card may be recruited only as a *Ringwraith follower*
 *   of the player's revealed Ringwraith, and only when the event enables it
 *   (`allowRingwraithFollowers`, rule 2.II.2.1.R4–R5);
 * - the play does not consume the one-character-per-turn slot.
 *
 * Each viable recruit produces a `play-character` action carrying
 * `viaEventInstanceId` (the event card) so the reducer can discard the event and
 * skip the normal one-character-per-turn bookkeeping.
 */

import type {
  GameState,
  PlayerId,
  PlayerState,
  EvaluatedAction,
  CardInstanceId,
  CharacterCard,
  Company,
} from '../../index.js';
import { isCharacterCard, isSiteCard } from '../../types/cards.js';
import { Alignment, Race } from '../../types/common.js';
import type {
  CardEffect,
  RecruitCharacterEffect,
  RingwraithFollowerSlotsEffect,
} from '../../types/effects.js';
import { logDetail } from './log.js';
import { resolveDef } from '../effects/index.js';
import {
  characterEntries,
  companyBlocksJoins,
  defById,
  findCharacterCompany,
  findPlayerAvatar,
  generalInfluenceControlLimit,
  isUniqueCharacterInPlay,
  matchesDefinition,
  playerById,
  playerPlaysAsSauron,
} from '../reducer-utils.js';
import { manifestationOfEntityInPlay } from '../manifestations.js';
import { getEffectiveSiteType } from '../effective.js';
import { availableDI } from './organization.js';
import { isBalrogAvatarDef } from '../../state-utils.js';
import { hasFollowerGrantPermission, hasPlayFlag } from '../../effects/play-flags.js';

/** An in-hand event carrying a `recruit-character` effect. */
interface RecruitEvent {
  readonly instanceId: CardInstanceId;
  readonly effect: RecruitCharacterEffect;
  readonly name: string;
}

/** Returns true when the effect permits paying with direct influence. */
function allowsDirectInfluence(effect: RecruitCharacterEffect): boolean {
  return effect.controlledBy === 'direct-influence' || effect.controlledBy === 'either';
}

/** Returns true when the effect permits paying with general influence. */
function allowsGeneralInfluence(effect: RecruitCharacterEffect): boolean {
  return effect.controlledBy === 'general-influence' || effect.controlledBy === 'either';
}

/** Rule 1.3.W2/1.3.B2: Wizard and Balrog players treat agent cards as hazards. */
function agentsAreHazardsFor(alignment: Alignment): boolean {
  return alignment === Alignment.Wizard || alignment === Alignment.Balrog;
}

/**
 * Emits the Ringwraith-follower plays this event enables (rule 2.II.2.1.R4–R5):
 * `recruitDef` (a Ringwraith avatar card in hand) joins the company of the
 * player's revealed Ringwraith, which must be one of `qualifyingCompanies`.
 *
 * Per R5 the follower costs one point of the revealed Ringwraith's direct
 * influence, unless a no-influence ability covers it — a free
 * `ringwraith-follower-slots` slot on the revealed Ringwraith (The Witch-king
 * le-58, Khamûl le-55) or `ringwraith-self-follower` on the card being played
 * (Ûvatha le-57).
 */
function ringwraithFollowerRecruits(
  state: GameState,
  playerId: PlayerId,
  player: PlayerState,
  event: RecruitEvent,
  recruitDef: CharacterCard,
  recruitInstanceId: CardInstanceId,
  qualifyingCompanies: readonly Company[],
): EvaluatedAction[] {
  // Only a Ringwraith avatar can be a Ringwraith follower; a Wizard,
  // Fallen-wizard or Balrog avatar never enters play this way.
  if (recruitDef.race !== Race.Ringwraith) {
    logDetail(`${event.name}: ${recruitDef.name} is an avatar and not a Ringwraith — it cannot be brought in as a Ringwraith follower`);
    return [];
  }

  // The Lidless Eye (le-203) / Sauron (ba-43): "You may not ... play Ringwraith
  // followers."
  if (playerPlaysAsSauron(state, player)) {
    logDetail(`${event.name}: ${recruitDef.name} not offered — you are Sauron and may not play Ringwraith followers`);
    return [];
  }

  const avatar = findPlayerAvatar(state, player);
  const avatarDef = avatar ? resolveDef(state, avatar.instanceId) : undefined;
  if (!avatar || !isCharacterCard(avatarDef) || avatarDef.race !== Race.Ringwraith) {
    logDetail(`${event.name}: ${recruitDef.name} not offered — a Ringwraith follower can only be controlled by a revealed Ringwraith (rule 2.II.2.1.R5)`);
    return [];
  }

  const avatarCompany = findCharacterCompany(player.companies, avatar.instanceId);
  if (!avatarCompany || !qualifyingCompanies.some(c => c.id === avatarCompany.id)) {
    logDetail(`${event.name}: ${recruitDef.name} not offered — ${avatarDef.name} is not at a qualifying site [${event.effect.siteTypes.join(', ')}]`);
    return [];
  }
  if (companyBlocksJoins(state, avatarCompany.id)) {
    logDetail(`${event.name}: ${recruitDef.name} not offered — ${avatarDef.name}'s company is closed to new joins`);
    return [];
  }

  // A free slot on the revealed Ringwraith, or the follower's own
  // self-granting ability, makes the follower cost no influence.
  const slots = (avatarDef.effects ?? []).find(
    (e): e is RingwraithFollowerSlotsEffect => e.type === 'ringwraith-follower-slots',
  );
  const selfFollower = (recruitDef.effects ?? []).some(e => e.type === 'ringwraith-self-follower');
  const followersControlled = avatar.followers.filter(fid => {
    const follower = player.characters[fid];
    if (!follower) return false;
    const fDef = resolveDef(state, follower.instanceId);
    return isCharacterCard(fDef) && fDef.mind === null;
  }).length;
  const freeSlot = slots !== undefined && followersControlled < slots.count;

  if (!freeSlot && !selfFollower) {
    // Rule 2.II.2.1.R5: one point of direct influence to control.
    const avail = availableDI(state, avatar.instanceId, player, recruitDef);
    if (avail < 1) {
      logDetail(`${event.name}: ${recruitDef.name} not offered — ${avatarDef.name} has no unused direct influence for a Ringwraith follower (rule 2.II.2.1.R5)`);
      return [];
    }
    logDetail(`${event.name}: Ringwraith follower ${recruitDef.name} joins ${avatarDef.name} at ${avatarCompany.currentSite!.definitionId as string} for 1 direct influence (avail ${avail})`);
  } else {
    logDetail(`${event.name}: Ringwraith follower ${recruitDef.name} joins ${avatarDef.name} at ${avatarCompany.currentSite!.definitionId as string} with no influence (${freeSlot ? `${avatarDef.name}'s slot` : 'self-granted'})`);
  }

  return [{
    action: {
      type: 'play-character',
      player: playerId,
      characterInstanceId: recruitInstanceId,
      atSite: avatarCompany.currentSite!.instanceId,
      controlledBy: avatar.instanceId,
      viaEventInstanceId: event.instanceId,
    },
    viable: true,
  }];
}

/**
 * Generates `play-character` actions enabled by an in-hand `recruit-character`
 * event for the active player. One action is emitted per
 * (event, recruit-in-hand, company-at-qualifying-site, influence source)
 * combination. Returns an empty list when the player holds no such event or
 * when no recruit is currently eligible.
 */
export function recruitViaEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  // Only the active player, on their own turn, may play a resource event.
  if (state.activePlayer !== playerId) return [];

  const player = playerById(state, playerId);
  if (!player) return [];

  // Find in-hand events carrying a recruit-character effect.
  const events: RecruitEvent[] = [];
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
  // General influence left for controlling characters (the same pool the
  // organization phase spends).
  const remainingGI = generalInfluenceControlLimit(state, playerId) - player.generalInfluenceUsed;

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

      // Avatars enter play by their own reveal rules (2.II.2.1) and cannot be
      // controlled by influence. The single exception is a Ringwraith avatar
      // played as a Ringwraith follower, which the event must expressly allow.
      if (recruitDef.mind === null) {
        if (!event.effect.allowRingwraithFollowers) {
          logDetail(`${event.name}: ${recruitDef.name} is an avatar — it cannot be brought into play as a recruit`);
          continue;
        }
        results.push(...ringwraithFollowerRecruits(
          state, playerId, player, event, recruitDef, handCard.instanceId, qualifyingCompanies,
        ));
        continue;
      }

      // Effect filter (e.g. exclude Wizards, or Ringwraiths/Fallen-wizards).
      if (event.effect.filter && !matchesDefinition(recruitDef, event.effect.filter)) {
        logDetail(`${event.name}: ${recruitDef.name} excluded by filter`);
        continue;
      }

      // Rule 2.II.2.2.5: an agent played as a character enters play only at its
      // own home site, unless the event lifts that (We Have Come to Kill).
      if ((recruitDef.keywords ?? []).includes('agent')) {
        if (!event.effect.allowAgents) {
          logDetail(`${event.name}: ${recruitDef.name} is an agent — this event does not allow agents to be brought in (rule 2.II.2.2.5)`);
          continue;
        }
        if (agentsAreHazardsFor(player.alignment)) {
          logDetail(`${event.name}: ${recruitDef.name} is an agent — a ${player.alignment} player treats agent cards as hazards (rule 1.3.W2/1.3.B2)`);
          continue;
        }
      }

      const costMind = recruitDef.mind;

      for (const company of qualifyingCompanies) {
        // Fell Rider (block-company-joins): no recruit may join a company
        // closed by a bound mode card.
        if (companyBlocksJoins(state, company.id)) {
          logDetail(`${event.name}: company at ${company.currentSite!.definitionId as string} is closed to new joins (block-company-joins)`);
          continue;
        }

        // General influence: the recruit is controlled by the player's own
        // unused general influence and joins the company at the site. The
        // event's site list replaces rule 2.II.2.2's avatar-site restriction.
        if (allowsGeneralInfluence(event.effect) && costMind <= remainingGI) {
          logDetail(
            `${event.name}: recruit ${recruitDef.name} (mind ${costMind}) at ${company.currentSite!.definitionId as string} ` +
            `under general influence (remaining GI ${remainingGI})`,
          );
          results.push({
            action: {
              type: 'play-character',
              player: playerId,
              characterInstanceId: handCard.instanceId,
              atSite: company.currentSite!.instanceId,
              controlledBy: 'general',
              viaEventInstanceId: event.instanceId,
            },
            viable: true,
          });
        }

        if (!allowsDirectInfluence(event.effect)) continue;

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
