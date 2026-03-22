/**
 * @module legal-actions/organization
 *
 * Legal actions during the organization phase. The active player can
 * reorganize companies, recruit characters, transfer items, and plan
 * movement for the upcoming movement/hazard phase.
 *
 * For play-character actions, every character card in the active player's
 * hand is evaluated against the CoE rules. A candidate action is generated
 * for each possible (site, controlledBy) combination. Non-viable candidates
 * carry a human-readable reason so the client can show why a character
 * cannot be played.
 */

import type {
  GameState,
  PlayerId,
  GameAction,
  EvaluatedAction,
  CardInstanceId,
  CharacterCard,
  OrganizationPhaseState,
  SiteCard,
} from '@meccg/shared';
import { GENERAL_INFLUENCE, SiteType, isCharacterCard, isSiteCard } from '@meccg/shared';
import { logDetail } from './log.js';
import { resolveDef } from '../effects/index.js';

/**
 * Computes the available (unused) direct influence for a character in play.
 *
 * A character's DI is their effectiveStats.directInfluence minus the sum
 * of mind values of all their followers.
 */
function availableDI(
  state: GameState,
  controllerInstanceId: CardInstanceId,
  player: { readonly characters: Readonly<Record<string, import('@meccg/shared').CharacterInPlay>> },
): number {
  const controller = player.characters[controllerInstanceId as string];
  if (!controller) return 0;

  let usedDI = 0;
  for (const followerId of controller.followers) {
    const followerChar = player.characters[followerId as string];
    if (!followerChar) continue;
    const followerDef = resolveDef(state, followerChar.instanceId);
    if (isCharacterCard(followerDef) && followerDef.mind !== null) {
      usedDI += followerDef.mind;
    }
  }

  return controller.effectiveStats.directInfluence - usedDI;
}

/**
 * Finds all sites where a character could potentially be played.
 *
 * Returns site instance IDs matching the character's homesite name or
 * havens. Sources include both company current sites (where a company
 * already exists) and the player's site deck (where a new company would
 * be formed).
 */
function findPlayableSites(
  state: GameState,
  player: {
    readonly companies: readonly import('@meccg/shared').Company[];
    readonly siteDeck: readonly CardInstanceId[];
  },
  charDef: CharacterCard,
): { instanceId: CardInstanceId; siteDef: SiteCard; siteName: string }[] {
  const results: { instanceId: CardInstanceId; siteDef: SiteCard; siteName: string }[] = [];
  const seen = new Set<string>();

  // Sites where the player already has a company
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteId = company.currentSite;
    if (seen.has(siteId as string)) continue;
    seen.add(siteId as string);

    const siteDef = resolveDef(state, siteId);
    if (!isSiteCard(siteDef)) continue;

    const isHaven = siteDef.siteType === SiteType.Haven;
    const isHomesite = siteDef.name === charDef.homesite;

    if (isHaven || isHomesite) {
      results.push({ instanceId: siteId, siteDef, siteName: siteDef.name });
    }
  }

  // Sites available in the player's site deck (character forms a new company)
  for (const siteId of player.siteDeck) {
    if (seen.has(siteId as string)) continue;
    seen.add(siteId as string);

    const siteDef = resolveDef(state, siteId);
    if (!isSiteCard(siteDef)) continue;

    const isHaven = siteDef.siteType === SiteType.Haven;
    const isHomesite = siteDef.name === charDef.homesite;

    if (isHaven || isHomesite) {
      results.push({ instanceId: siteId, siteDef, siteName: siteDef.name });
    }
  }

  return results;
}

/**
 * Checks whether a unique character with the given name is already in play
 * across any player.
 */
function isUniqueCharacterInPlay(state: GameState, charName: string): boolean {
  for (const p of state.players) {
    for (const char of Object.values(p.characters)) {
      const def = resolveDef(state, char.instanceId);
      if (isCharacterCard(def) && def.name === charName) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Generates play-character evaluated actions for each character in the
 * active player's hand. Each character is checked against:
 *
 * 1. Must be organization phase and active player's turn.
 * 2. Only one character play allowed per turn.
 * 3. Card must be a character card.
 * 4. If unique, must not already be in play (either player).
 * 5. Must have a matching site available (homesite or haven) — either
 *    where a company already exists or in the player's site deck.
 * 6. Must fit under general influence (mind ≤ remaining GI) or under
 *    direct influence of a character with enough unused DI.
 */
function playCharacterActions(
  state: GameState,
  playerId: PlayerId,
): EvaluatedAction[] {
  const phaseState = state.phaseState as OrganizationPhaseState;
  const player = state.players.find(p => p.id === playerId)!;
  const results: EvaluatedAction[] = [];

  for (const cardInstanceId of player.hand) {
    const cardDef = resolveDef(state, cardInstanceId);
    if (!isCharacterCard(cardDef)) continue;

    // Non-avatar characters only (mind !== null)
    if (cardDef.mind === null) continue;

    const charName = cardDef.name;
    const charMind = cardDef.mind;

    logDetail(`Evaluating play-character: ${charName} (mind ${charMind}, DI ${cardDef.directInfluence})`);

    // Rule: only one character play per turn
    if (phaseState.characterPlayedThisTurn) {
      logDetail(`  → blocked: already played a character this turn`);
      results.push({
        action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
        viable: false,
        reason: `${charName}: already played a character this turn`,
      });
      continue;
    }

    // Rule: unique characters cannot be in play twice
    if (cardDef.unique && isUniqueCharacterInPlay(state, charName)) {
      logDetail(`  → blocked: ${charName} is unique and already in play`);
      results.push({
        action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
        viable: false,
        reason: `${charName}: unique character already in play`,
      });
      continue;
    }

    // Find valid sites (homesite or haven — from companies or site deck)
    const playableSites = findPlayableSites(state, player, cardDef);
    if (playableSites.length === 0) {
      logDetail(`  → blocked: no homesite (${cardDef.homesite}) or haven available`);
      results.push({
        action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
        viable: false,
        reason: `${charName}: homesite (${cardDef.homesite}) and no haven available`,
      });
      continue;
    }

    // Check influence options for each valid site
    const remainingGI = GENERAL_INFLUENCE - player.generalInfluenceUsed;
    const canPlayUnderGI = charMind <= remainingGI;

    // Find characters with enough DI to control this character as a follower.
    // Only characters under general influence can take followers.
    const diControllers: { instanceId: CardInstanceId; name: string; availDI: number }[] = [];
    for (const [key, char] of Object.entries(player.characters)) {
      if (char.controlledBy !== 'general') continue;
      const ctrlDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(ctrlDef)) continue;
      const avail = availableDI(state, char.instanceId, player);
      if (avail >= charMind) {
        diControllers.push({ instanceId: key as CardInstanceId, name: ctrlDef.name, availDI: avail });
      }
    }

    if (!canPlayUnderGI && diControllers.length === 0) {
      logDetail(`  → blocked: mind ${charMind} exceeds remaining GI (${remainingGI}) and no character has enough DI`);
      results.push({
        action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
        viable: false,
        reason: `${charName}: mind ${charMind} exceeds remaining general influence (${remainingGI}) and no character has sufficient direct influence`,
      });
      continue;
    }

    // Generate viable actions for each (site, controlledBy) combination
    for (const site of playableSites) {
      if (canPlayUnderGI) {
        logDetail(`  → viable: play under GI at ${site.siteName} (mind ${charMind}, remaining GI ${remainingGI})`);
        results.push({
          action: {
            type: 'play-character',
            player: playerId,
            characterInstanceId: cardInstanceId,
            atSite: site.instanceId,
            controlledBy: 'general',
          },
          viable: true,
        });
      }

      // DI followers must be played into the same company as the controller
      for (const ctrl of diControllers) {
        // Check the controller is in a company at this site
        const companyAtSite = player.companies.find(
          c => c.currentSite === site.instanceId && c.characters.includes(ctrl.instanceId),
        );
        if (!companyAtSite) continue;

        logDetail(`  → viable: play under DI of ${ctrl.name} (avail DI ${ctrl.availDI}) at ${site.siteName}`);
        results.push({
          action: {
            type: 'play-character',
            player: playerId,
            characterInstanceId: cardInstanceId,
            atSite: site.instanceId,
            controlledBy: ctrl.instanceId,
          },
          viable: true,
        });
      }
    }
  }

  return results;
}

/**
 * Computes all legal actions during the organization phase.
 *
 * Returns {@link EvaluatedAction} items so that non-viable play-character
 * candidates carry a human-readable reason for the client to display.
 */
export function organizationActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.activePlayer !== playerId) {
    logDetail(`Not active player (active: ${state.activePlayer as string ?? 'null'}), no actions`);
    return [];
  }

  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];

  // Cancel movement for companies with planned destinations
  for (const company of player.companies) {
    if (company.destinationSite !== null) {
      logDetail(`Company ${company.id as string} has planned movement → can cancel`);
      actions.push({
        action: { type: 'cancel-movement', player: playerId, companyId: company.id } as GameAction,
        viable: true,
      });
    }
  }

  logDetail(`Organization: ${player.companies.length} company/companies, ${Object.keys(player.characters).length} character(s) in play`);

  // Play-character actions for each character card in hand
  actions.push(...playCharacterActions(state, playerId));

  // TODO: split-company, merge-companies, transfer-item, plan-movement

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  return actions;
}
