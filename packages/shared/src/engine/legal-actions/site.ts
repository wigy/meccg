/**
 * @module legal-actions/site
 *
 * Legal actions during the site phase. Each company resolves its site
 * phase sequentially: the resource player selects which company goes
 * next, decides whether to enter the site, faces automatic attacks
 * and on-guard/agent attacks, then may play resources.
 *
 * CoE rules section 2.V (lines 340–393).
 */

import type { GameState, PlayerId, GameAction, EvaluatedAction, SitePhaseState, HeroItemCard, HeroResourceEventCard } from '../../index.js';
import { getPlayerIndex, isSiteCard, isItemCard, CardStatus } from '../../index.js';
import { logDetail, logHeading } from './log.js';

/** Wrap plain GameActions as viable EvaluatedActions. */
function viable(actions: GameAction[]): EvaluatedAction[] {
  return actions.map(action => ({ action, viable: true }));
}

/**
 * Compute legal actions for the site phase.
 *
 * Dispatches to the appropriate sub-step handler based on the current
 * site phase step.
 */
export function siteActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const isActive = state.activePlayer === playerId;
  const siteState = state.phaseState as SitePhaseState;

  logHeading(`Site phase (step: ${siteState.step}): player is ${isActive ? 'active (resource)' : 'non-active (hazard)'}`);

  if (siteState.step === 'select-company') {
    return viable(selectCompanyActions(state, playerId, siteState));
  }

  if (siteState.step === 'enter-or-skip') {
    return viable(enterOrSkipActions(state, playerId, siteState));
  }

  if (siteState.step === 'reveal-on-guard-attacks') {
    return viable(revealOnGuardAttacksActions(state, playerId));
  }

  if (siteState.step === 'automatic-attacks') {
    return viable(automaticAttacksActions(state, playerId));
  }

  if (siteState.step === 'declare-agent-attack') {
    return viable(declareAgentAttackActions(state, playerId));
  }

  if (siteState.step === 'resolve-attacks') {
    return viable(resolveAttacksActions(state, playerId));
  }

  if (siteState.step === 'play-resources') {
    return playResourcesActions(state, playerId, siteState);
  }

  // TODO: play-minor-item

  if (!isActive) {
    logDetail(`Not active player, no site actions`);
    return [];
  }

  return viable([{ type: 'pass', player: playerId }]);
}

/**
 * Generate select-company actions for the site phase.
 *
 * The resource player picks which unhandled company resolves its site
 * phase next. Companies returned to their site of origin during M/H
 * are automatically skipped (CoE line 336). If only one company
 * remains, it is still offered as a choice for explicitness.
 */
function selectCompanyActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during select-company step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const handledSet = new Set(siteState.handledCompanyIds);

  const actions: GameAction[] = [];
  for (const company of player.companies) {
    if (handledSet.has(company.id)) {
      logDetail(`Company ${company.id} already handled — skipping`);
      continue;
    }
    logDetail(`Company ${company.id} not yet handled — offering select-company`);
    actions.push({ type: 'select-company', player: playerId, companyId: company.id });
  }

  logDetail(`${actions.length} unhandled company(ies) available for selection`);
  return actions;
}

/**
 * Generate enter-or-skip actions for the current company.
 *
 * The resource player decides whether to enter the site (facing attacks
 * and potentially playing resources) or do nothing (pass), which ends
 * that company's site phase immediately (CoE lines 341–343).
 */
function enterOrSkipActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during enter-or-skip step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  logDetail(`Company ${company.id}: offering enter-site and pass (do nothing)`);
  return [
    { type: 'enter-site', player: playerId, companyId: company.id },
    { type: 'pass', player: playerId },
  ];
}

/**
 * Stub: reveal-on-guard-attacks step (CoE Step 1, line 345).
 *
 * The hazard player may reveal on-guard creatures keyed to the site or
 * events affecting automatic-attacks. For now, only active player can pass.
 */
function revealOnGuardAttacksActions(
  state: GameState,
  playerId: PlayerId,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during reveal-on-guard-attacks step`);
    return [];
  }
  logDetail(`Reveal on-guard attacks — pass to advance`);
  return [{ type: 'pass', player: playerId }];
}

/**
 * Stub: automatic-attacks step (CoE Step 2, line 350).
 *
 * Each automatic attack listed on the site card triggers combat.
 * For now, only active player can pass.
 */
function automaticAttacksActions(
  state: GameState,
  playerId: PlayerId,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during automatic-attacks step`);
    return [];
  }
  logDetail(`Automatic attacks — pass to advance`);
  return [{ type: 'pass', player: playerId }];
}

/**
 * Stub: declare-agent-attack step (CoE Step 3, line 358).
 *
 * The hazard player may declare an agent at the site will attack.
 * For now, only active player can pass.
 */
function declareAgentAttackActions(
  state: GameState,
  playerId: PlayerId,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during declare-agent-attack step`);
    return [];
  }
  logDetail(`Declare agent attack — pass to advance`);
  return [{ type: 'pass', player: playerId }];
}

/**
 * Stub: resolve-attacks step (CoE Step 4, line 361).
 *
 * On-guard creature and agent attacks are resolved in resource player's
 * chosen order. For now, only active player can pass.
 */
function resolveAttacksActions(
  state: GameState,
  playerId: PlayerId,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during resolve-attacks step`);
    return [];
  }
  logDetail(`Resolve attacks — pass to advance`);
  return [{ type: 'pass', player: playerId }];
}

/**
 * Generate play-resources actions for the current company (CoE lines 362–374).
 *
 * After entering a site, the resource player may play resources. Each hand
 * card is evaluated for playability:
 * - Permanent resource events are playable (same rules as organization phase).
 * - Items (minor, major, greater) are playable if the site allows that subtype
 *   and there is an untapped character in the company to carry the item.
 * - All other cards are marked as not-playable with a reason.
 *
 * Pass is always available to end the company's site phase.
 */
function playResourcesActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): EvaluatedAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during play-resources step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];
  const actions: EvaluatedAction[] = [];

  // Look up the site's playable resource types
  const siteInstanceId = company.currentSite;
  const siteInstance = siteInstanceId ? state.instanceMap[siteInstanceId as string] : undefined;
  const siteDef = siteInstance ? state.cardPool[siteInstance.definitionId as string] : undefined;
  const playableTypes = siteDef && isSiteCard(siteDef) ? new Set(siteDef.playableResources) : new Set<string>();
  const siteName = siteDef?.name ?? 'unknown site';

  const siteIsTapped = siteInstance?.status === CardStatus.Tapped;
  logDetail(`Site ${siteName}: playable resource types: ${[...playableTypes].join(', ') || 'none'}, tapped: ${siteIsTapped}`);

  // Find untapped characters in this company for item attachment
  const untappedCharacters = company.characters
    .map(cId => player.characters[cId as string])
    .filter(ch => ch !== undefined && ch.status === CardStatus.Untapped);

  logDetail(`Untapped characters in company: ${untappedCharacters.length}`);

  // Evaluate each hand card
  const evaluatedInstances = new Set<string>();

  for (const cardInstanceId of player.hand) {
    const inst = state.instanceMap[cardInstanceId as string];
    if (!inst) continue;
    const def = state.cardPool[inst.definitionId as string];
    if (!def) continue;

    // Permanent resource events — playable like in organization phase
    if (def.cardType === 'hero-resource-event') {
      const eventDef = def as HeroResourceEventCard;
      if (eventDef.eventType === 'permanent') {
        evaluatedInstances.add(cardInstanceId as string);

        // Check uniqueness
        if (eventDef.unique) {
          const alreadyInPlay = state.players.some(p =>
            p.cardsInPlay.some(c => {
              const cDef = state.cardPool[c.definitionId as string];
              return cDef && cDef.name === eventDef.name;
            }),
          );
          if (alreadyInPlay) {
            logDetail(`Permanent event ${eventDef.name}: unique and already in play`);
            actions.push({
              action: { type: 'not-playable', player: playerId, cardInstanceId },
              viable: false,
              reason: `${eventDef.name} is unique and already in play`,
            });
            continue;
          }
        }

        logDetail(`Permanent event ${eventDef.name}: playable`);
        actions.push({
          action: { type: 'play-permanent-event', player: playerId, cardInstanceId },
          viable: true,
        });
        continue;
      }
    }

    // Items — check site is untapped, allows the subtype, and there's an untapped character
    if (isItemCard(def)) {
      const itemDef = def as HeroItemCard;
      evaluatedInstances.add(cardInstanceId as string);

      if (siteIsTapped) {
        logDetail(`Item ${itemDef.name}: site is already tapped`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${itemDef.name}: site is already tapped`,
        });
        continue;
      }

      if (!playableTypes.has(itemDef.subtype)) {
        logDetail(`Item ${itemDef.name} (${itemDef.subtype}): not playable at ${siteName}`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${itemDef.name}: ${itemDef.subtype} items cannot be played at ${siteName}`,
        });
        continue;
      }

      if (untappedCharacters.length === 0) {
        logDetail(`Item ${itemDef.name}: no untapped character to carry it`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${itemDef.name}: no untapped character in company`,
        });
        continue;
      }

      // One action per untapped character that could carry the item
      for (const ch of untappedCharacters) {
        const charDef = state.cardPool[ch.definitionId as string];
        const charName = charDef?.name ?? ch.instanceId;
        logDetail(`Item ${itemDef.name}: playable on ${charName}`);
        actions.push({
          action: {
            type: 'play-hero-resource',
            player: playerId,
            cardInstanceId,
            companyId: company.id,
            attachToCharacterId: ch.instanceId,
          },
          viable: true,
        });
      }
      continue;
    }

    // TODO: factions, allies, information
  }

  // Mark remaining hand cards as not playable
  for (const cardInstanceId of player.hand) {
    if (evaluatedInstances.has(cardInstanceId as string)) continue;
    const inst = state.instanceMap[cardInstanceId as string];
    const def = inst ? state.cardPool[inst.definitionId as string] : undefined;
    const name = def?.name ?? 'card';
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId },
      viable: false,
      reason: `${name}: not playable during site phase`,
    });
  }

  // Pass to end this company's site phase
  actions.push({ action: { type: 'pass', player: playerId }, viable: true });

  return actions;
}
