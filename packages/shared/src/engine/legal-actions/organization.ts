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
  HeroResourceEventCard,
  OrganizationPhaseState,
  SiteCard,
} from '../../index.js';
import { GENERAL_INFLUENCE, SiteType, isCharacterCard, isSiteCard, buildMovementMap, getReachableSites } from '../../index.js';
import { logDetail } from './log.js';
import { resolveDef } from '../effects/index.js';
import { isRegressive } from '../reverse-actions.js';

/**
 * Computes the available (unused) direct influence for a character in play.
 *
 * A character's DI is their effectiveStats.directInfluence minus the sum
 * of mind values of all their followers.
 */
function availableDI(
  state: GameState,
  controllerInstanceId: CardInstanceId,
  player: { readonly characters: Readonly<Record<string, import('../../index.js').CharacterInPlay>> },
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
    readonly companies: readonly import('../../index.js').Company[];
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

    const charName = cardDef.name;
    const isAvatar = cardDef.mind === null;

    logDetail(`Evaluating play-character: ${charName} (mind ${cardDef.mind ?? 'avatar'}, DI ${cardDef.directInfluence})`);

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

    if (isAvatar) {
      // Avatars are always controlled under general influence and cost no mind
      for (const site of playableSites) {
        logDetail(`  → viable: play avatar at ${site.siteName}`);
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
    } else {
      // Non-avatar: check GI/DI constraints
      const charMind = cardDef.mind;
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
  }

  return results;
}

/**
 * Evaluates permanent-event resource cards in hand for play during organization.
 * Permanent resource events can be played directly to the table without a site.
 * Unique permanent events cannot be played if one with the same name is already in play.
 */
function playPermanentEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const cardInstanceId of player.hand) {
    const inst = state.instanceMap[cardInstanceId as string];
    if (!inst) continue;
    const def = state.cardPool[inst.definitionId as string] as HeroResourceEventCard | undefined;
    if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'permanent') continue;

    // Check uniqueness: unique permanent events can't be played if already in play
    if (def.unique) {
      const alreadyInPlay = state.players.some(p =>
        p.cardsInPlay.some(c => {
          const cDef = state.cardPool[c.definitionId as string];
          return cDef && cDef.name === def.name;
        }),
      );
      if (alreadyInPlay) {
        logDetail(`Permanent event ${def.name}: unique and already in play`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} is unique and already in play`,
        });
        continue;
      }
    }

    // Check duplication-limit with scope "game": cannot play if a copy is already in play
    const dupLimit = def.effects?.find((e): e is import('../../index.js').DuplicationLimitEffect => {
      if (e.type !== 'duplication-limit') return false;
      return e.scope === 'game';
    });
    if (dupLimit) {
      const copiesInPlay = state.players.reduce((count, p) =>
        count + p.cardsInPlay.filter(c => {
          const cDef = state.cardPool[c.definitionId as string];
          return cDef && cDef.name === def.name;
        }).length, 0,
      );
      if (copiesInPlay >= dupLimit.max) {
        logDetail(`Permanent event ${def.name}: cannot be duplicated (${copiesInPlay}/${dupLimit.max} in play)`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} cannot be duplicated`,
        });
        continue;
      }
    }

    logDetail(`Permanent event ${def.name}: playable`);
    actions.push({
      action: { type: 'play-permanent-event', player: playerId, cardInstanceId },
      viable: true,
    });
  }

  return actions;
}

/**
 * Computes plan-movement actions for each company.
 * For every company, emits one viable action per reachable site in the player's
 * site deck, determined by the movement map (starter and region movement).
 * Companies that already have a destination planned are skipped.
 */
function planMovementActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];
  const movementMap = buildMovementMap(state.cardPool);

  for (const company of player.companies) {
    if (!company.currentSite) continue;
    if (company.destinationSite !== null) continue;

    const currentSiteInst = state.instanceMap[company.currentSite as string];
    if (!currentSiteInst) continue;
    const currentSiteDef = state.cardPool[currentSiteInst.definitionId as string];
    if (!currentSiteDef || !isSiteCard(currentSiteDef)) continue;

    // Build candidate sites from the player's site deck
    const candidateSites: SiteCard[] = [];
    const siteInstMap = new Map<string, CardInstanceId>();
    for (const siteInstId of player.siteDeck) {
      const siteInst = state.instanceMap[siteInstId as string];
      if (!siteInst) continue;
      const siteDef = state.cardPool[siteInst.definitionId as string];
      if (!siteDef || !isSiteCard(siteDef)) continue;
      candidateSites.push(siteDef);
      siteInstMap.set(siteDef.name, siteInstId);
    }

    const reachable = getReachableSites(movementMap, currentSiteDef, candidateSites);
    // Deduplicate: a site reachable by both starter and region movement only needs one action
    const seen = new Set<string>();
    logDetail(`Company ${company.id as string} at ${currentSiteDef.name}: ${reachable.length} reachable site(s)`);

    for (const r of reachable) {
      const destInstId = siteInstMap.get(r.site.name);
      if (!destInstId) continue;
      if (seen.has(destInstId as string)) continue;
      seen.add(destInstId as string);
      const candidate: GameAction = {
        type: 'plan-movement',
        player: playerId,
        companyId: company.id,
        destinationSite: destInstId,
      };
      const regress = isRegressive(candidate, state.reverseActions);
      actions.push({
        action: { ...candidate, ...(regress ? { regress: true } : {}) },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Computes move-to-influence actions during the organization phase.
 *
 * Two types of influence reassignment (CoE rules lines 227-228):
 *
 * 1. **To DI (become follower)**: A non-avatar character under GI, who has
 *    no followers themselves, can be moved under the DI of a non-follower
 *    character in the same company. The character's mind must not exceed
 *    the controller's available direct influence.
 *
 * 2. **To GI (un-follow)**: A follower can be moved to general influence,
 *    provided the total non-follower mind would not exceed the player's
 *    maximum general influence.
 */
function moveToInfluenceActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const company of player.companies) {
    for (const charInstId of company.characters) {
      const char = player.characters[charInstId as string];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;

      const isAvatar = charDef.mind === null;

      if (char.controlledBy === 'general' && !isAvatar && char.followers.length === 0) {
        // Rule 227: Move non-avatar character without followers to DI of a
        // non-follower character in the same company
        for (const ctrlInstId of company.characters) {
          if (ctrlInstId === charInstId) continue;
          const ctrl = player.characters[ctrlInstId as string];
          if (!ctrl) continue;
          // Controller must be under GI (non-follower)
          if (ctrl.controlledBy !== 'general') continue;
          const avail = availableDI(state, ctrl.instanceId, player);
          if (avail >= charDef.mind) {
            const ctrlDef = resolveDef(state, ctrl.instanceId);
            const ctrlName = isCharacterCard(ctrlDef) ? ctrlDef.name : '?';
            logDetail(`  → viable: move ${charDef.name} (mind ${charDef.mind}) under DI of ${ctrlName} (avail DI ${avail})`);
            const candidate: GameAction = {
              type: 'move-to-influence',
              player: playerId,
              characterInstanceId: charInstId,
              controlledBy: ctrlInstId,
            };
            const regress = isRegressive(candidate, state.reverseActions);
            actions.push({
              action: { ...candidate, ...(regress ? { regress: true } : {}) },
              viable: true,
            });
          }
        }
      } else if (char.controlledBy !== 'general') {
        // Rule 228: Move a follower to general influence if GI allows
        const remainingGI = GENERAL_INFLUENCE - player.generalInfluenceUsed;
        if (charDef.mind !== null && charDef.mind <= remainingGI) {
          logDetail(`  → viable: move ${charDef.name} (mind ${charDef.mind}) to GI (remaining GI ${remainingGI})`);
          const candidate: GameAction = {
            type: 'move-to-influence',
            player: playerId,
            characterInstanceId: charInstId,
            controlledBy: 'general',
          };
          const regress = isRegressive(candidate, state.reverseActions);
          actions.push({
            action: { ...candidate, ...(regress ? { regress: true } : {}) } as GameAction,
            viable: true,
          });
        }
      }
    }
  }

  return actions;
}

/**
 * Computes transfer-item actions during the organization phase.
 *
 * Per CoE rules (2.II.5), items can be transferred between two characters
 * at the same site (not necessarily in the same company). After the transfer,
 * the initial bearer must make a corruption check — the reducer sets
 * {@link OrganizationPhaseState.pendingCorruptionCheck} which gates all
 * other actions until the check is resolved.
 *
 * Emits one viable action per valid (item, fromCharacter, toCharacter) triple.
 */
function transferItemActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  // Build a map from site instance ID → list of character instance IDs at that site
  const siteToCharacters = new Map<string, CardInstanceId[]>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteKey = company.currentSite as string;
    const existing = siteToCharacters.get(siteKey) ?? [];
    existing.push(...company.characters);
    siteToCharacters.set(siteKey, existing);
  }

  // For each character with items, find valid transfer targets at the same site
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteKey = company.currentSite as string;
    const charsAtSite = siteToCharacters.get(siteKey) ?? [];

    for (const charInstId of company.characters) {
      const char = player.characters[charInstId as string];
      if (!char || char.items.length === 0) continue;

      const charDef = resolveDef(state, char.instanceId);
      const charName = isCharacterCard(charDef) ? charDef.name : '?';

      for (const item of char.items) {
        const itemInst = state.instanceMap[item.instanceId as string];
        if (!itemInst) continue;
        const itemDef = state.cardPool[itemInst.definitionId as string];
        const itemName = itemDef?.name ?? '?';

        for (const targetInstId of charsAtSite) {
          if (targetInstId === charInstId) continue;
          const target = player.characters[targetInstId as string];
          if (!target) continue;

          const targetDef = resolveDef(state, target.instanceId);
          const targetName = isCharacterCard(targetDef) ? targetDef.name : '?';

          logDetail(`  → viable: transfer ${itemName} from ${charName} to ${targetName}`);
          const candidate: GameAction = {
            type: 'transfer-item',
            player: playerId,
            itemInstanceId: item.instanceId,
            fromCharacterId: charInstId,
            toCharacterId: targetInstId,
          };
          const regress = isRegressive(candidate, state.reverseActions);
          actions.push({
            action: { ...candidate, ...(regress ? { regress: true } : {}) },
            viable: true,
          });
        }
      }
    }
  }

  return actions;
}

/**
 * Computes split-company actions during the organization phase.
 *
 * A character under general influence (with no restriction on having followers)
 * can split off from their company to form a new company at the same site.
 * The character's followers automatically accompany them. The source company
 * must retain at least one GI character after the split.
 *
 * Emits one action per GI character that can legally split off. Followers
 * move automatically with their host in the reducer.
 */
function splitCompanyActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const company of player.companies) {
    if (!company.currentSite) continue;

    // Count GI characters (non-followers) in this company
    const giChars = company.characters.filter(id => {
      const c = player.characters[id as string];
      return c && c.controlledBy === 'general';
    });

    // Need at least 2 GI characters to split (one stays, one leaves)
    if (giChars.length < 2) continue;

    for (const charInstId of giChars) {
      const char = player.characters[charInstId as string];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;

      logDetail(`  → viable: split ${charDef.name} (+ ${char.followers.length} followers) from ${company.id as string}`);
      const candidate: GameAction = {
        type: 'split-company',
        player: playerId,
        sourceCompanyId: company.id,
        characterId: charInstId,
      };
      const regress = isRegressive(candidate, state.reverseActions);
      actions.push({
        action: { ...candidate, ...(regress ? { regress: true } : {}) },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Computes move-to-company actions during the organization phase.
 *
 * A character under general influence can move to a different company at
 * the same site. Their followers automatically accompany them. The source
 * company must retain at least one GI character after the move.
 *
 * Emits one action per valid (character, targetCompany) pair.
 */
function moveToCompanyActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  // Build map from site definition ID → companies at that site
  const siteToCompanies = new Map<string, typeof player.companies[number][]>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteKey = company.currentSite as string;
    const existing = siteToCompanies.get(siteKey) ?? [];
    existing.push(company);
    siteToCompanies.set(siteKey, existing);
  }

  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const companiesAtSite = siteToCompanies.get(company.currentSite as string) ?? [];
    if (companiesAtSite.length < 2) continue;

    // Count GI characters in this company
    const giChars = company.characters.filter(id => {
      const c = player.characters[id as string];
      return c && c.controlledBy === 'general';
    });

    // Need at least 2 GI characters so one can leave and one stays
    if (giChars.length < 2) continue;

    for (const charInstId of giChars) {
      const char = player.characters[charInstId as string];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;

      for (const targetCompany of companiesAtSite) {
        if (targetCompany.id === company.id) continue;

        logDetail(`  → viable: move ${charDef.name} from ${company.id as string} to ${targetCompany.id as string}`);
        const candidate: GameAction = {
          type: 'move-to-company',
          player: playerId,
          characterInstanceId: charInstId,
          sourceCompanyId: company.id,
          targetCompanyId: targetCompany.id,
        };
        const regress = isRegressive(candidate, state.reverseActions);
        actions.push({
          action: { ...candidate, ...(regress ? { regress: true } : {}) },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Computes merge-companies actions during the organization phase.
 *
 * Two companies at the same site can be merged into one. All characters
 * from the source company move into the target company, and the source
 * company is dissolved. This increases the combined company's hazard limit
 * but consolidates combat strength.
 *
 * Emits one action per valid (sourceCompany, targetCompany) pair at the same site.
 */
function mergeCompaniesActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  // Build map from site instance ID → companies at that site
  const siteToCompanies = new Map<string, typeof player.companies[number][]>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteKey = company.currentSite as string;
    const existing = siteToCompanies.get(siteKey) ?? [];
    existing.push(company);
    siteToCompanies.set(siteKey, existing);
  }

  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const companiesAtSite = siteToCompanies.get(company.currentSite as string) ?? [];
    if (companiesAtSite.length < 2) continue;

    for (const targetCompany of companiesAtSite) {
      if (targetCompany.id === company.id) continue;

      logDetail(`  → viable: merge company ${company.id as string} into ${targetCompany.id as string}`);
      const candidate: GameAction = {
        type: 'merge-companies',
        player: playerId,
        sourceCompanyId: company.id,
        targetCompanyId: targetCompany.id,
      };
      const regress = isRegressive(candidate, state.reverseActions);
      actions.push({
        action: { ...candidate, ...(regress ? { regress: true } : {}) },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Computes all legal actions during the organization phase.
 *
 * Returns {@link EvaluatedAction} items so that non-viable play-character
 * candidates carry a human-readable reason for the client to display.
 */
export function organizationActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  if (state.activePlayer !== playerId) {
    logDetail(`Not active player (active: ${state.activePlayer as string ?? 'null'}), no actions`);
    return [];
  }

  const orgState = state.phaseState as OrganizationPhaseState;

  // When a corruption check is pending (after item transfer), only that check is legal
  if (orgState.pendingCorruptionCheck !== null) {
    const charId = orgState.pendingCorruptionCheck.characterId;
    const transferredItemId = orgState.pendingCorruptionCheck.transferredItemId;
    const char = player.characters[charId as string];
    if (char) {
      const charDef = resolveDef(state, char.instanceId);
      const charName = isCharacterCard(charDef) ? charDef.name : '?';

      // Include CP from the transferred item (already moved to target character)
      const transferredInst = state.instanceMap[transferredItemId as string];
      const transferredDef = transferredInst ? state.cardPool[transferredInst.definitionId as string] : undefined;
      const transferredCp = transferredDef && 'corruptionPoints' in transferredDef
        ? (transferredDef as { corruptionPoints: number }).corruptionPoints : 0;
      const cp = char.effectiveStats.corruptionPoints + transferredCp;

      const modifier = isCharacterCard(charDef) ? charDef.corruptionModifier : 0;

      // Include the transferred item in possessions (it's on the target but belongs to this check)
      const possessions: CardInstanceId[] = [
        transferredItemId,
        ...char.items.map(i => i.instanceId),
        ...char.allies.map(a => a.instanceId),
        ...char.corruptionCards,
      ];
      logDetail(`Pending corruption check for ${charName} (CP ${cp} incl. transferred item, modifier ${modifier >= 0 ? '+' : ''}${modifier}, ${possessions.length} possession(s)) after item transfer`);
      return [{
        action: {
          type: 'corruption-check',
          player: playerId,
          characterId: charId,
          corruptionPoints: cp,
          corruptionModifier: modifier,
          possessions,
        },
        viable: true,
      }];
    }
  }

  const actions: EvaluatedAction[] = [];

  // Cancel movement for companies with planned destinations
  for (const company of player.companies) {
    if (company.destinationSite !== null) {
      logDetail(`Company ${company.id as string} has planned movement → can cancel`);
      const candidate: GameAction = {
        type: 'cancel-movement',
        player: playerId,
        companyId: company.id,
      };
      const regress = isRegressive(candidate, state.reverseActions);
      actions.push({
        action: { ...candidate, ...(regress ? { regress: true } : {}) } as GameAction,
        viable: true,
      });
    }
  }

  logDetail(`Organization: ${player.companies.length} company/companies, ${Object.keys(player.characters).length} character(s) in play`);

  // Play-character actions for each character card in hand
  const characterActions = playCharacterActions(state, playerId);
  actions.push(...characterActions);

  // Collect instance IDs that already have a play-character evaluation
  const evaluatedInstances = new Set(
    characterActions.map(ea =>
      (ea.action as { characterInstanceId: CardInstanceId }).characterInstanceId as string,
    ),
  );

  // Play permanent-event resource cards from hand
  const permanentEventActions = playPermanentEventActions(state, playerId);
  actions.push(...permanentEventActions);
  const permanentEventInstances = new Set(
    permanentEventActions.map(ea =>
      (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId as string,
    ),
  );

  // Mark remaining hand cards as not playable during organization
  for (const cardInstanceId of player.hand) {
    if (evaluatedInstances.has(cardInstanceId as string)) continue;
    if (permanentEventInstances.has(cardInstanceId as string)) continue;
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId },
      viable: false,
      reason: 'Not playable during the organization',
    });
  }

  // Move-to-influence actions (reassign characters between GI and DI)
  actions.push(...moveToInfluenceActions(state, playerId));

  // Plan-movement actions for each company
  actions.push(...planMovementActions(state, playerId));

  // Transfer-item actions (move items between characters at the same site)
  actions.push(...transferItemActions(state, playerId));

  // Split-company actions (move GI character + followers to a new company)
  actions.push(...splitCompanyActions(state, playerId));

  // Move-to-company actions (move GI character + followers to an existing company at same site)
  actions.push(...moveToCompanyActions(state, playerId));

  // Merge-companies actions (join entire company into another at same site)
  actions.push(...mergeCompaniesActions(state, playerId));

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  return actions;
}
