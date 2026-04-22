/**
 * @module legal-actions/movement-hazard
 *
 * Legal actions during the movement/hazard phase. Companies move to
 * their destinations while the opponent plays hazard cards. Combat
 * sub-states further constrain available actions.
 */

import type { GameState, PlayerId, GameAction, EvaluatedAction, MovementHazardPhaseState, SiteCard, CardDefinitionId, CardInstanceId, CompanyId, CreatureCard, CreatureKeyingMatch, PlayHazardAction, PlaceOnGuardAction, PlayConditionEffect, CreatureRaceChoiceEffect } from '../../index.js';
import { getPlayerIndex, isSiteCard, isCharacterCard, isFactionCard, buildMovementMap, findRegionPaths, RegionType, Race, hasPlayFlag, matchesCondition } from '../../index.js';
import { canCallEndgameNow, isWizard } from '../../state-utils.js';
import { resolveInstanceId } from '../../types/state.js';
import { resolveHandSize, isWardedAgainst } from '../effects/index.js';
import { buildInPlayNames } from '../recompute-derived.js';
import { MovementType } from '../../types/common.js';
import { logDetail, logHeading } from './log.js';
import { playPermanentEventActions, playShortEventActions } from './organization-events.js';
import { grantedActionActivations, ANY_PHASE_ONLY } from './organization.js';
import { heroResourceShortEventActions } from './long-event.js';
import { emitGrantedActionConstraintActions } from './granted-action-constraints.js';
import { currentHazardLimit } from '../reducer-movement-hazard.js';

/**
 * Count unresolved hazard-creature / hazard-event chain entries. Used
 * as a context field for granted-action constraints whose `when`
 * checks chain state (e.g. Great Ship needs at least one unresolved
 * hazard to offer a cancel).
 */
function countUnresolvedChainHazards(state: GameState): number {
  if (!state.chain) return 0;
  let n = 0;
  for (const e of state.chain.entries) {
    if (e.resolved || e.negated || !e.card) continue;
    const def = state.cardPool[e.card.definitionId as string];
    if (def && (def.cardType === 'hazard-creature' || def.cardType === 'hazard-event')) n++;
  }
  return n;
}

/**
 * Compute legal actions for the movement/hazard phase.
 *
 * The first step ('select-company') requires the resource player to choose
 * which of their unhandled companies will resolve next. No pass is allowed —
 * a company must be selected.
 */
export function movementHazardActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const isActive = state.activePlayer === playerId;
  const mhState = state.phaseState as MovementHazardPhaseState;

  logHeading(`Movement/hazard phase (step: ${mhState.step}): player is ${isActive ? 'active (mover)' : 'non-active (hazard player)'}`);

  // Wound corruption checks (Barrow-wight et al.) are now produced and
  // consumed via the unified pending-resolution system; the
  // resolution short-circuit in `legal-actions/index.ts` handles them
  // before this function is reached.

  if (mhState.step === 'select-company') {
    return viable(selectCompanyActions(state, playerId, mhState));
  }

  if (mhState.step === 'reveal-new-site') {
    return viable(revealNewSiteActions(state, playerId, mhState));
  }

  // set-hazard-limit step (CoE step 3): immediate, only pass to advance
  if (mhState.step === 'set-hazard-limit') {
    if (!isActive) {
      logDetail(`Not active player — no actions during set-hazard-limit step`);
      return [];
    }
    logDetail(`Set hazard limit — pass to advance to order-effects`);
    return viable([{ type: 'pass', player: playerId }]);
  }

  // order-effects step (CoE step 4): dummy for now, only pass to advance
  if (mhState.step === 'order-effects') {
    if (!isActive) {
      logDetail(`Not active player — no actions during order-effects step`);
      return [];
    }
    logDetail(`Order effects — pass to advance to draw-cards`);
    return viable([{ type: 'pass', player: playerId }]);
  }

  // draw-cards step (CoE step 5): both players draw cards simultaneously
  if (mhState.step === 'draw-cards') {
    return viable(drawCardsActions(state, playerId, mhState, isActive));
  }

  // play-hazards step (CoE step 7): hazard player plays hazards, both may pass
  if (mhState.step === 'play-hazards') {
    return playHazardsActions(state, playerId, mhState, isActive);
  }

  // reset-hand step (CoE step 8): players with excess cards choose discards
  if (mhState.step === 'reset-hand') {
    return resetHandActions(state, playerId);
  }

  // TODO: assign-strike, resolve-strike, support-strike
  if (!isActive) {
    logDetail(`Not active player, no movement/hazard actions`);
    return [];
  }

  return viable([{ type: 'pass', player: playerId }]);
}

/** Wrap plain GameActions as viable EvaluatedActions. */
function viable(actions: GameAction[]): EvaluatedAction[] {
  return actions.map(action => ({ action, viable: true }));
}

/**
 * Generate actions for the reveal-new-site step (CoE step 1).
 *
 * If the company is moving, computes all possible ways to reach the
 * destination (starter and/or region movement) and offers each as a
 * `declare-path` action. No pass action — the player must choose a path.
 *
 * If the company is not moving (no destination), only a pass action is
 * offered to advance to the next step.
 *
 * TODO: triggering events on site reveal
 * TODO: under-deeps movement roll (stay if roll < site number)
 */
function revealNewSiteActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): GameAction[] {
  if (state.activePlayer !== playerId) {
    logDetail(`Not active player — no actions during reveal-new-site step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const company = player.companies[mhState.activeCompanyIndex];
  if (!company) {
    logDetail(`No active company at index ${mhState.activeCompanyIndex}`);
    return [];
  }

  // Non-moving company: just pass
  if (!company.destinationSite) {
    logDetail(`Company ${company.id as string} is not moving — pass to advance`);
    return [{ type: 'pass', player: playerId }];
  }

  // Resolve origin and destination site definitions
  const originDef = resolveSiteDef(state, company.currentSite?.instanceId ?? null);
  const destDef = resolveSiteDef(state, company.destinationSite.instanceId);
  if (!originDef || !destDef) {
    logDetail(`Could not resolve site definitions — no actions`);
    return [];
  }

  const actions: GameAction[] = [];

  // --- Special movement (e.g. Gwaihir) ---
  if (company.specialMovement === 'gwaihir') {
    logDetail(`Special movement (Gwaihir): ${originDef.name} → ${destDef.name}`);
    actions.push({ type: 'declare-path', player: playerId, movementType: MovementType.Special });
    return actions;
  }

  const movementMap = buildMovementMap(state.cardPool);

  // --- Starter movement ---
  if (isStarterMovementPossible(movementMap, originDef, destDef)) {
    logDetail(`Starter movement available: ${originDef.name} → ${destDef.name}`);
    actions.push({ type: 'declare-path', player: playerId, movementType: MovementType.Starter });
  }

  // --- Region movement ---
  const originRegion = movementMap.siteRegion.get(originDef.name);
  const destRegion = movementMap.siteRegion.get(destDef.name);
  if (originRegion && destRegion) {
    // Build region name → definition ID map for converting path names to IDs
    const regionNameToId = buildRegionNameMap(state);
    const paths = findRegionPaths(movementMap, originRegion, destRegion, mhState.maxRegionDistance);
    // Sort paths: shortest first, then fewest distinct regions as tiebreaker
    paths.sort((a, b) => {
      const lenDiff = a.length - b.length;
      if (lenDiff !== 0) return lenDiff;
      return new Set(a).size - new Set(b).size;
    });
    for (const path of paths) {
      const regionIds = path.map(name => regionNameToId.get(name)).filter((id): id is CardDefinitionId => id !== undefined);
      if (regionIds.length !== path.length) {
        logDetail(`Region path ${path.join(' → ')} has unresolvable region names — skipping`);
        continue;
      }
      logDetail(`Region path: ${path.join(' → ')} (${path.length} regions)`);
      actions.push({
        type: 'declare-path',
        player: playerId,
        movementType: MovementType.Region,
        regionPath: regionIds,
      });
    }
  }

  logDetail(`${actions.length} possible movement path(s) for company ${company.id as string}`);
  return actions;
}

/**
 * Resolve a site card instance ID to its {@link SiteCard} definition.
 * Returns `undefined` if the instance or definition cannot be found.
 */
function resolveSiteDef(
  state: GameState,
  siteInstanceId: import('../../index.js').CardInstanceId | null,
): SiteCard | undefined {
  if (!siteInstanceId) return undefined;
  const defId = resolveInstanceId(state, siteInstanceId);
  if (!defId) return undefined;
  const def = state.cardPool[defId as string];
  if (!def || !isSiteCard(def)) return undefined;
  return def;
}

/**
 * Build a map from region name to its {@link CardDefinitionId}.
 * Scans the card pool for all region cards.
 */
function buildRegionNameMap(state: GameState): Map<string, CardDefinitionId> {
  const map = new Map<string, CardDefinitionId>();
  for (const [id, card] of Object.entries(state.cardPool)) {
    if (card.cardType === 'region') {
      map.set(card.name, id as CardDefinitionId);
    }
  }
  return map;
}

/**
 * Check whether starter movement is possible between two sites.
 *
 * Starter movement connects:
 * - A haven to its connected non-haven sites (via nearestHaven)
 * - A non-haven site to its nearest haven
 * - Two havens that list paths to each other (via havenPaths)
 */
function isStarterMovementPossible(
  movementMap: import('../../index.js').MovementMap,
  origin: SiteCard,
  dest: SiteCard,
): boolean {
  const originIsHaven = origin.siteType === 'haven';
  const destIsHaven = dest.siteType === 'haven';

  if (originIsHaven && destIsHaven) {
    const connected = movementMap.havenToHaven.get(origin.name);
    return connected?.has(dest.name) ?? false;
  }
  if (originIsHaven && !destIsHaven) {
    return dest.nearestHaven === origin.name;
  }
  if (!originIsHaven && destIsHaven) {
    return origin.nearestHaven === dest.name;
  }
  return false;
}

/**
 * Generate select-company actions for the resource player.
 *
 * Lists all of the active player's companies that have not yet been
 * handled this turn. Only the active (resource) player may select;
 * the hazard player receives no actions during this step.
 */
function selectCompanyActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during select-company step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const handledSet = new Set(mhState.handledCompanyIds);

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
 * Generate actions for the draw-cards step (CoE step 5).
 *
 * Both players act simultaneously. Each player who has not yet reached
 * their max draw count gets a `draw-cards` action (count: 1). After the
 * first mandatory draw, `pass` is also offered to stop early.
 * A player who has reached their max or has no cards left gets no actions.
 */
function drawCardsActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
  isResourcePlayer: boolean,
): GameAction[] {
  const drawnSoFar = isResourcePlayer ? mhState.resourceDrawCount : mhState.hazardDrawCount;
  const drawMax = isResourcePlayer ? mhState.resourceDrawMax : mhState.hazardDrawMax;
  const playerLabel = isResourcePlayer ? 'resource' : 'hazard';

  // Already done (hit max or passed — signaled by drawCount >= drawMax)
  if (drawnSoFar >= drawMax) {
    logDetail(`${playerLabel} player already done drawing (${drawnSoFar}/${drawMax})`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];

  // Deck exhaust exchange sub-flow: only exchange + pass actions
  if (player.deckExhaustPending) {
    return deckExhaustExchangeActions(state, player, playerId);
  }

  // Check if player has cards to draw
  if (player.playDeck.length === 0) {
    if (player.discardPile.length > 0) {
      logDetail(`${playerLabel} player deck empty — must exhaust (reshuffle discard)`);
      return [{ type: 'deck-exhaust', player: playerId }];
    }
    logDetail(`${playerLabel} player has no cards in play deck or discard — only pass`);
    return [{ type: 'pass', player: playerId }];
  }

  const actions: GameAction[] = [];

  // Draw 1 card action
  actions.push({ type: 'draw-cards', player: playerId, count: 1 });

  // Pass is allowed after the first mandatory draw
  if (drawnSoFar > 0) {
    actions.push({ type: 'pass', player: playerId });
  }

  logDetail(`${playerLabel} player draw-cards: ${drawnSoFar}/${drawMax} drawn, ${actions.length} action(s)`);
  return actions;
}

/**
 * Generate actions for the play-hazards step (CoE step 7).
 *
 * The hazard player may play hazard long-events from hand (up to the
 * hazard limit). Both players always have a pass action available.
 * The company's M/H phase ends when both players have passed.
 *
 * TODO: creatures, short-events, permanent-events
 */
function playHazardsActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
  isResourcePlayer: boolean,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const targetCompanyId = state.players[activeIdx].companies[mhState.activeCompanyIndex].id;
  const liveLimit = currentHazardLimit(state, mhState, targetCompanyId);
  const limitReached = mhState.hazardsPlayedThisCompany >= liveLimit;

  // Hazard player: offer playable hazard long-events
  if (!isResourcePlayer) {
    const playerIndex = getPlayerIndex(state, playerId);
    const player = state.players[playerIndex];
    const activeIndex = getPlayerIndex(state, state.activePlayer!);
    const resourcePlayer = state.players[activeIndex];
    const targetCompany = resourcePlayer.companies[mhState.activeCompanyIndex];

    for (const handCard of player.hand) {
      const cardInstId = handCard.instanceId;
      const def = state.cardPool[handCard.definitionId as string];
      if (!def) continue;

      const isCreature = def.cardType === 'hazard-creature';
      const isShortEvent = def.cardType === 'hazard-event' && def.eventType === 'short';
      const isEvent = def.cardType === 'hazard-event'
        && (def.eventType === 'long' || def.eventType === 'permanent');
      const isCorruption = def.cardType === 'hazard-corruption';
      // Resource-events tagged `playable-as-hazard` (e.g. Sudden Call, le-235)
      // piggyback on the hazard short-event path.
      const isResourceAsHazard = (def.cardType === 'hero-resource-event'
        || def.cardType === 'minion-resource-event')
        && hasPlayFlag(def, 'playable-as-hazard');
      if (!isCreature && !isEvent && !isShortEvent && !isCorruption && !isResourceAsHazard) continue;

      const action: PlayHazardAction = {
        type: 'play-hazard',
        player: playerId,
        cardInstanceId: cardInstId,
        targetCompanyId: targetCompany.id,
      };

      // Hazard limit reached (cards with no-hazard-limit bypass this)
      const bypassesLimit = 'effects' in def && hasPlayFlag(def, 'no-hazard-limit');
      const raceExempt = isCreature && isCreatureRaceExemptFromLimit(state, targetCompany.id, def.race);
      if (limitReached && !bypassesLimit && !raceExempt) {
        actions.push({ action, viable: false, reason: `Hazard limit reached (${liveLimit})` });
        continue;
      }

      // --- Creature keying check ---
      if (isCreature) {
        // Creatures must initiate a new chain — not playable in response (CoE rule 307)
        if (state.chain != null) {
          actions.push({ action, viable: false, reason: 'Creatures must initiate a new chain' });
          continue;
        }
        // Cancel-attacks site rule (e.g. Dol Guldur, Moria): when the target
        // company's effective site carries this rule, the hazard player may
        // not play creatures against it.
        const cancelSiteName = cancelAttacksSiteName(state, targetCompany);
        if (cancelSiteName) {
          logDetail(`Creature "${def.name}" cancelled by site-rule on ${cancelSiteName}`);
          actions.push({ action, viable: false, reason: `Attacks against this company are canceled at ${cancelSiteName}` });
          continue;
        }
        const matches = findCreatureKeyingMatches(def, mhState, state, targetCompany);
        const keyingBypassed = hasCreatureKeyingBypass(state, targetCompany.id, def.race);
        if (matches.length === 0 && !keyingBypassed) {
          const keyError = describeKeyingRequirement(def);
          logDetail(`Creature "${def.name}" not keyable: ${keyError}`);
          actions.push({ action, viable: false, reason: keyError });
          continue;
        }
        if (matches.length === 0 && keyingBypassed) {
          logDetail(`Creature "${def.name}" keyable via keying-bypass constraint (race "${def.race}")`);
          actions.push({
            action: { ...action, keyedBy: { method: 'keying-bypass', value: def.race } },
            viable: true,
          });
          continue;
        }
        for (const match of matches) {
          logDetail(`Creature "${def.name}" keyable by ${match.method}: ${match.value}`);
          actions.push({
            action: { ...action, keyedBy: match },
            viable: true,
          });
        }
        continue;
      }

      // --- Resource-as-hazard (e.g. Sudden Call, le-235) ---
      // The card is a minion-resource-event with the `playable-as-hazard`
      // flag, played by the hazard player on the opponent's turn. For
      // `call-council` effects (Sudden Call), the defending (resource)
      // player must be non-Wizard and must meet endgame conditions; per
      // rule 10.41 the caller (the hazard player here) gets the last turn.
      if (isResourceAsHazard && !isShortEvent) {
        const hazardResourcePlayerIdx = getPlayerIndex(state, playerId);
        const hazardPlayer = state.players[hazardResourcePlayerIdx];
        const defendingPlayer = resourcePlayer; // the active (resource) player being attacked
        const callEffect = def.effects?.find(
          (e): e is import('../../index.js').CallCouncilEffect => e.type === 'call-council' && e.lastTurnFor === 'self',
        );
        if (!callEffect) {
          // No hazard-side call-council effect → no viable hazard play of this card
          actions.push({ action, viable: false, reason: `${def.name}: no hazard-side effect defined` });
          continue;
        }
        if (isWizard(defendingPlayer)) {
          actions.push({ action, viable: false, reason: `${def.name}: cannot be played as a hazard against a ${defendingPlayer.alignment} player` });
          continue;
        }
        if (!canCallEndgameNow(defendingPlayer)) {
          actions.push({ action, viable: false, reason: `${def.name}: opponent has not met end-of-game conditions` });
          continue;
        }
        if (hazardPlayer.freeCouncilCalled || state.lastTurnFor !== null) {
          actions.push({ action, viable: false, reason: `${def.name}: endgame already called` });
          continue;
        }
        logDetail(`Resource-as-hazard "${def.name}" playable — opponent ${defendingPlayer.alignment} meets end-of-game conditions`);
        actions.push({ action, viable: true });
        continue;
      }

      // --- Short event ---
      if (isShortEvent) {
        // Duplication-limit: non-viable if max copies already on chain / in play / still in effect
        if (def.effects) {
          let blocked = false;
          for (const effect of def.effects) {
            if (effect.type !== 'duplication-limit') continue;
            if (effect.scope !== 'game' && effect.scope !== 'turn') continue;
            const copiesOnChain = state.chain?.entries.filter(e => {
              const cDef = e.card ? state.cardPool[e.card.definitionId as string] : undefined;
              return cDef && cDef.name === def.name;
            }).length ?? 0;
            const copiesInPlay = state.players.reduce((count, p) =>
              count + p.cardsInPlay.filter(c => {
                const cDef = state.cardPool[c.definitionId as string];
                return cDef && cDef.name === def.name;
              }).length, 0,
            );
            // For turn-scoped duplication limits on short events, a resolved
            // copy still counts as long as it left an active constraint in
            // play (the effect persists past the card's discard).
            const constraintCopies = effect.scope === 'turn'
              ? state.activeConstraints.filter(c => c.sourceDefinitionId === def.id).length
              : 0;
            if (copiesOnChain + copiesInPlay + constraintCopies >= effect.max) {
              logDetail(`Hazard short-event "${def.name}" cannot be duplicated (${copiesOnChain} on chain, ${copiesInPlay} in play, ${constraintCopies} active)`);
              actions.push({ action, viable: false, reason: `${def.name} cannot be duplicated` });
              blocked = true;
              break;
            }
          }
          if (blocked) continue;
        }

        // Environment-cancelers (e.g. Twilight) need an environment target in play
        if (hasPlayFlag(def, 'playable-as-resource')) {
          const envTargets = findEnvironmentTargets(state);
          if (envTargets.length === 0) {
            logDetail(`Hazard short-event "${def.name}": no environment in play to cancel`);
            actions.push({ action, viable: false, reason: 'No environment to cancel' });
            continue;
          }
          for (const target of envTargets) {
            const targetDef = state.cardPool[target.definitionId];
            logDetail(`Hazard short-event "${def.name}": can cancel environment ${targetDef?.name ?? target.definitionId}`);
            actions.push({
              action: {
                type: 'play-short-event',
                player: playerId,
                cardInstanceId: cardInstId,
                targetInstanceId: target.instanceId,
              },
              viable: true,
            });
          }
          continue;
        }

        // Play-condition check (e.g. Two or Three Tribes Present site-path requirement)
        if (def.effects) {
          const playCondition = def.effects.find(
            (e): e is PlayConditionEffect => e.type === 'play-condition',
          );
          if (playCondition && playCondition.requires === 'site-path') {
            if (!checkSitePathCondition(mhState, playCondition, state)) {
              logDetail(`Hazard short-event "${def.name}": site path condition not met`);
              actions.push({ action, viable: false, reason: 'Site path condition not met' });
              continue;
            }
          }

          // Creature-race-choice: generate one action per eligible race.
          // When the effect declares a `fixedRace`, emit a single action
          // with that race instead of offering a choice (e.g. Dragon's
          // Desolation — always Dragon).
          const raceChoice = def.effects.find(
            (e): e is CreatureRaceChoiceEffect => e.type === 'creature-race-choice',
          );
          if (raceChoice) {
            if (raceChoice.fixedRace) {
              logDetail(`Hazard short-event "${def.name}": playable with fixed race "${raceChoice.fixedRace}"`);
              actions.push({
                action: { ...action, chosenCreatureRace: raceChoice.fixedRace as Race },
                viable: true,
              });
            } else {
              const excludedRaces = new Set(raceChoice.exclude);
              const eligibleRaces = Object.values(Race).filter(r => !excludedRaces.has(r));
              for (const race of eligibleRaces) {
                logDetail(`Hazard short-event "${def.name}": playable with creature race "${race}"`);
                actions.push({
                  action: { ...action, chosenCreatureRace: race },
                  viable: true,
                });
              }
            }
            continue;
          }
        }

        const shortPlayTarget = def.effects?.find(
          (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target',
        );

        // Faction-targeting short events (e.g. Muster Disperses)
        if (shortPlayTarget?.target === 'faction') {
          let hasFactionTarget = false;
          for (const p of state.players) {
            for (const cip of p.cardsInPlay) {
              const cipDef = state.cardPool[cip.definitionId as string];
              if (cipDef && isFactionCard(cipDef)) {
                logDetail(`Hazard short-event "${def.name}" playable on faction ${cipDef.name} (${cip.instanceId as string})`);
                actions.push({
                  action: { ...action, targetFactionInstanceId: cip.instanceId },
                  viable: true,
                });
                hasFactionTarget = true;
              }
            }
          }
          if (!hasFactionTarget) {
            logDetail(`Hazard short-event "${def.name}" not playable — no factions in play`);
            actions.push({ action, viable: false, reason: 'No factions in play' });
          }
          continue;
        }

        // Character-targeting short events (e.g. Call of Home): one action per eligible character
        if (shortPlayTarget?.target === 'character') {
          for (const charId of targetCompany.characters) {
            if (shortPlayTarget.filter) {
              const charData = resourcePlayer.characters[charId as string];
              if (charData) {
                const charDef = state.cardPool[charData.definitionId as string];
                if (charDef && isCharacterCard(charDef)) {
                  const possessionNames = charData.items
                    .map(item => state.cardPool[item.definitionId as string]?.name)
                    .filter((n): n is string => n != null);
                  const ctx = {
                    target: {
                      race: charDef.race,
                      skills: charDef.skills,
                      name: charDef.name,
                      possessions: possessionNames,
                    },
                  };
                  if (!matchesCondition(shortPlayTarget.filter, ctx)) {
                    logDetail(`Hazard short-event "${def.name}" filter excludes ${charDef.name}`);
                    actions.push({
                      action: { ...action, targetCharacterId: charId },
                      viable: false,
                      reason: `${charDef.name} does not match play target filter`,
                    });
                    continue;
                  }
                }
              }
            }
            logDetail(`Hazard short-event "${def.name}" playable on character ${charId as string}`);
            actions.push({
              action: { ...action, targetCharacterId: charId },
              viable: true,
            });
          }
          continue;
        }

        // Site-targeting short events (e.g. Incite Defenders): apply filter on destination site
        if (shortPlayTarget?.target === 'site') {
          const destSiteInstanceId = targetCompany.destinationSite?.instanceId
            ?? targetCompany.currentSite?.instanceId
            ?? null;
          if (destSiteInstanceId) {
            const destSiteDefId = resolveInstanceId(state, destSiteInstanceId);
            if (destSiteDefId) {
              const siteDef = state.cardPool[destSiteDefId as string];
              const siteDefName = siteDef?.name ?? (destSiteDefId as string);
              if (shortPlayTarget.filter && siteDef && isSiteCard(siteDef)) {
                if (!matchesCondition(shortPlayTarget.filter, siteDef as unknown as Record<string, unknown>)) {
                  logDetail(`Hazard short-event "${def.name}" site filter excludes ${siteDefName}`);
                  actions.push({
                    action: { ...action, targetSiteDefinitionId: destSiteDefId },
                    viable: false,
                    reason: `${siteDefName} does not match site filter`,
                  });
                  continue;
                }
              }
              logDetail(`Hazard short-event "${def.name}" playable on site ${siteDefName}`);
              actions.push({
                action: { ...action, targetSiteDefinitionId: destSiteDefId },
                viable: true,
              });
              continue;
            }
          }
          continue;
        }

        logDetail(`Hazard short-event "${def.name}" is playable`);
        actions.push({ action, viable: true });
        continue;
      }

      // --- Long/permanent event checks ---
      // Uniqueness: non-viable if already in play
      if (def.unique) {
        const alreadyInPlay = state.players.some(p =>
          p.cardsInPlay.some(c => c.definitionId === def.id),
        );
        if (alreadyInPlay) {
          logDetail(`Hazard event "${def.name}" is unique and already in play`);
          actions.push({ action, viable: false, reason: `${def.name} is unique and already in play` });
          continue;
        }
      }

      // Duplication-limit: non-viable if max copies already in play
      if (def.effects) {
        let blocked = false;
        for (const effect of def.effects) {
          if (effect.type !== 'duplication-limit' || effect.scope !== 'game') continue;
          const copiesInPlay = state.players.reduce((count, p) =>
            count + p.cardsInPlay.filter(c => {
              const cDef = state.cardPool[c.definitionId as string];
              return cDef && cDef.name === def.name;
            }).length, 0,
          );
          if (copiesInPlay >= effect.max) {
            logDetail(`Hazard event "${def.name}" cannot be duplicated (${copiesInPlay}/${effect.max} in play)`);
            actions.push({ action, viable: false, reason: `${def.name} cannot be duplicated` });
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
      }

      // play-target DSL: permanent events / corruption cards targeting a character get one action per character
      const playTarget = def.effects?.find(
        (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target',
      );
      const isCharTargeting = playTarget?.target === 'character';
      // play-target DSL: site-targeting hazards (e.g. River) get one
      // action per candidate site. The candidate sites are the
      // destination of the active company (the obvious target) plus
      // any *current* site of any company on either side that the
      // hazard could meaningfully bind to. CoE rule wording for River
      // says "Playable on a site" with the understanding that the card
      // affects companies arriving at that location — the destination
      // of the company being attacked is the most useful target.
      const isSiteTargeting = playTarget?.target === 'site';
      if (isCharTargeting) {
        // maxCompanySize: card is only playable if the target company
        // has effective size ≤ the declared maximum (hobbits count half).
        if (playTarget.maxCompanySize !== undefined) {
          let halfCount = 0;
          let fullCount = 0;
          for (const cId of targetCompany.characters) {
            const cDefId = resolveInstanceId(state, cId);
            const cDef = cDefId ? state.cardPool[cDefId as string] : undefined;
            if (cDef && isCharacterCard(cDef) && cDef.race === 'hobbit') {
              halfCount++;
            } else {
              fullCount++;
            }
          }
          const effectiveSize = Math.ceil(fullCount + halfCount / 2);
          if (effectiveSize > playTarget.maxCompanySize) {
            logDetail(`Hazard "${def.name}" requires company size ≤ ${playTarget.maxCompanySize} (got ${effectiveSize})`);
            actions.push({ action, viable: false, reason: `${def.name} requires a company of size ≤ ${playTarget.maxCompanySize}` });
            continue;
          }
        }
        // Character-scoped duplication-limit: find the max copies allowed on one character
        const charDupLimit = def.effects?.find(
          (e): e is import('../../index.js').DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'character',
        );
        for (const charId of targetCompany.characters) {
          // Apply play-target filter condition (e.g. non-wizard, non-ringwraith)
          if (playTarget.filter) {
            const charData = resourcePlayer.characters[charId as string];
            if (charData) {
              const charDef = state.cardPool[charData.definitionId as string];
              if (charDef && isCharacterCard(charDef)) {
                const possessionNames = charData.items
                  .map(item => state.cardPool[item.definitionId as string]?.name)
                  .filter((n): n is string => n != null);
                const itemKeywords = charData.items.flatMap(item => {
                  const iDef = state.cardPool[item.definitionId as string];
                  return iDef && 'keywords' in iDef ? (iDef as { keywords?: readonly string[] }).keywords ?? [] : [];
                });
                const ctx = {
                  target: {
                    race: charDef.race,
                    skills: charDef.skills,
                    name: charDef.name,
                    mind: charDef.mind,
                    possessions: possessionNames,
                    itemKeywords,
                  },
                };
                if (!matchesCondition(playTarget.filter, ctx)) {
                  logDetail(`Hazard "${def.name}" filter excludes ${charDef.name}`);
                  actions.push({
                    action: { ...action, targetCharacterId: charId },
                    viable: false,
                    reason: `${charDef.name} does not match play target filter`,
                  });
                  continue;
                }
              }
            }
          }
          // Check character-scoped duplication limit
          if (charDupLimit) {
            const charData = resourcePlayer.characters[charId as string];
            if (charData) {
              const copiesOnChar = charData.hazards.filter(h => {
                const hDef = state.cardPool[h.definitionId as string];
                return hDef && hDef.name === def.name;
              }).length;
              if (copiesOnChar >= charDupLimit.max) {
                const charName = state.cardPool[charData.definitionId as string]?.name ?? (charId as string);
                logDetail(`Hazard "${def.name}" already on ${charName} (${copiesOnChar}/${charDupLimit.max})`);
                actions.push({
                  action: { ...action, targetCharacterId: charId },
                  viable: false,
                  reason: `${def.name} cannot be duplicated on ${charName}`,
                });
                continue;
              }
            }
          }
          // Ward check: if the target character carries an item with a
          // ward-bearer effect matching this hazard (e.g. Adamant Helmet
          // vs. dark enchantments), the play is pointless — the engine
          // would cancel it on resolution, so the legal-action computer
          // doesn't offer the character as a target at all.
          if (isWardedAgainst(state, activeIndex, charId, def)) {
            const charName = state.cardPool[resourcePlayer.characters[charId as string]?.definitionId as string]?.name ?? (charId as string);
            logDetail(`Hazard "${def.name}" cancelled by ward on ${charName}`);
            actions.push({
              action: { ...action, targetCharacterId: charId },
              viable: false,
              reason: `${charName} is warded against ${def.name}`,
            });
            continue;
          }
          logDetail(`Hazard "${def.name}" playable on character ${charId as string}`);
          actions.push({
            action: { ...action, targetCharacterId: charId },
            viable: true,
          });
        }
      } else if (isSiteTargeting) {
        // The destination site of the active company is the canonical
        // target — that's the site the company is moving to, which is
        // exactly what River cares about.
        const destSiteInstanceId = targetCompany.destinationSite?.instanceId
          ?? targetCompany.currentSite?.instanceId
          ?? null;
        if (destSiteInstanceId) {
          const destSiteDefId = resolveInstanceId(state, destSiteInstanceId);
          if (destSiteDefId) {
            const siteDef = state.cardPool[destSiteDefId as string];
            const siteDefName = siteDef?.name ?? (destSiteDefId as string);
            // Apply play-target filter (e.g. Incite Defenders: border-hold or free-hold)
            if (playTarget.filter && siteDef && isSiteCard(siteDef)) {
              if (!matchesCondition(playTarget.filter, siteDef as unknown as Record<string, unknown>)) {
                logDetail(`Hazard "${def.name}" site filter excludes ${siteDefName}`);
                actions.push({
                  action: { ...action, targetSiteDefinitionId: destSiteDefId },
                  viable: false,
                  reason: `${siteDefName} does not match site filter`,
                });
                continue;
              }
            }
            logDetail(`Hazard event "${def.name}" playable on site ${siteDefName}`);
            actions.push({
              action: { ...action, targetSiteDefinitionId: destSiteDefId },
              viable: true,
            });
          }
        }
      } else {
        logDetail(`Hazard event "${def.name}" is playable`);
        actions.push({ action, viable: true });
      }
    }

    // --- On-guard placement ---
    // One on-guard card per company per M/H phase; any hand card is eligible (bluffing allowed).
    // Counts against hazard limit. Must not be in a chain (placement starts no chain).
    if (!mhState.onGuardPlacedThisCompany && state.chain == null) {
      for (const handCard of player.hand) {
        const ogAction: PlaceOnGuardAction = {
          type: 'place-on-guard',
          player: playerId,
          cardInstanceId: handCard.instanceId,
        };
        if (limitReached) {
          actions.push({ action: ogAction, viable: false, reason: `Hazard limit reached (${liveLimit})` });
        } else {
          logDetail(`On-guard: card ${handCard.instanceId} eligible for placement`);
          actions.push({ action: ogAction, viable: true });
        }
      }
    }
  }

  // Rule 2.1.1: resource player may play resource permanent-events and
  // resource short-events during any phase of their turn. This covers both
  // hazard-event short-events flagged `playable-as-resource` (e.g. Twilight
  // cancelling an environment) and hero-resource-event short-events
  // (e.g. Marvels Told tapping a sage to discard a hazard long-event).
  if (isResourcePlayer) {
    actions.push(...playPermanentEventActions(state, playerId));
    actions.push(...playShortEventActions(state, playerId));
    actions.push(...heroResourceShortEventActions(state, playerId, 'movement-hazard'));
    // Granted-action constraints (Great Ship's cancel-chain-entry, etc.)
    const playerIndex = getPlayerIndex(state, playerId);
    const company = state.players[playerIndex].companies[mhState.activeCompanyIndex];
    if (company) {
      actions.push(...emitGrantedActionConstraintActions(state, playerId, company, 'movement-hazard', 'play-hazards', {
        path: mhState.resolvedSitePath,
        chain: {
          hazardCount: countUnresolvedChainHazards(state),
        },
      }));
    }
    actions.push(...grantedActionActivations(state, playerId, ANY_PHASE_ONLY));
  }

  // Player who already passed gets no actions (waiting for opponent)
  const alreadyPassed = isResourcePlayer ? mhState.resourcePlayerPassed : mhState.hazardPlayerPassed;
  if (alreadyPassed) {
    logDetail(`Play-hazards: ${isResourcePlayer ? 'resource' : 'hazard'} player already passed — waiting for opponent`);
    return [];
  }

  // Pass is always available if not already passed
  actions.push({ action: { type: 'pass', player: playerId }, viable: true });

  const viableCount = actions.filter(a => a.viable && (a.action.type === 'play-hazard' || a.action.type === 'play-short-event' || a.action.type === 'place-on-guard')).length;
  logDetail(`Play-hazards: ${isResourcePlayer ? 'resource' : 'hazard'} player has ${viableCount} viable hazard(s), ${actions.length} total action(s)`);
  return actions;
}



/**
 * Find all environment cards currently in play or declared in the active chain.
 * Searches player cardsInPlay and unresolved chain entries.
 */
function findEnvironmentTargets(state: GameState): { instanceId: CardInstanceId; definitionId: string }[] {
  const isEnv = (defId: string): boolean => {
    const d = state.cardPool[defId];
    return !!d && 'keywords' in d
      && !!(d as { keywords?: readonly string[] }).keywords?.includes('environment');
  };
  const targets: { instanceId: CardInstanceId; definitionId: string }[] = [];
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (isEnv(c.definitionId as string)) targets.push(c);
    }
  }
  if (state.chain) {
    for (const entry of state.chain.entries) {
      if (entry.resolved || entry.negated) continue;
      if (!entry.card) continue;
      if (isEnv(entry.card.definitionId as string)) {
        targets.push({ instanceId: entry.card.instanceId, definitionId: entry.card.definitionId as string });
      }
    }
  }
  return targets;
}

/**
 * Generate actions for the reset-hand step (CoE step 8).
 *
 * Players whose hand exceeds the base hand size must choose which cards
 * to discard. Each card in hand is offered as a `discard-card` action.
 * Players already at or below hand size get no actions.
 */
function resetHandActions(
  state: GameState,
  playerId: PlayerId,
): EvaluatedAction[] {
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const handSize = resolveHandSize(state, playerIndex);

  if (player.hand.length <= handSize) {
    logDetail(`Reset-hand: player ${player.name} at hand size (${player.hand.length}/${handSize}) — no actions`);
    return [];
  }

  const excess = player.hand.length - handSize;
  logDetail(`Reset-hand: player ${player.name} must discard ${excess} card(s) (${player.hand.length}/${handSize})`);

  return player.hand.map(handCard => ({
    action: { type: 'discard-card' as const, player: playerId, cardInstanceId: handCard.instanceId },
    viable: true,
  }));
}

/**
 * Check whether any of the creature's region types can be keyed to the
 * site path. Each distinct type is an independent option (OR). If the
 * same type appears N times, the path must have at least N of that type.
 */
function regionTypesMatch(required: readonly RegionType[], path: readonly RegionType[]): boolean {
  const requiredCounts = new Map<RegionType, number>();
  for (const rt of required) requiredCounts.set(rt, (requiredCounts.get(rt) ?? 0) + 1);
  const pathCounts = new Map<RegionType, number>();
  for (const rt of path) pathCounts.set(rt, (pathCounts.get(rt) ?? 0) + 1);
  for (const [rt, need] of requiredCounts) {
    if ((pathCounts.get(rt) ?? 0) >= need) return true;
  }
  return false;
}

/**
 * Find all keying matches for a creature against the current company's
 * travel path and destination site. Returns one entry per distinct match.
 *
 * Active `site-type-override` / `region-type-override` constraints (e.g.
 * from Choking Shadows with Doors of Night) extend the set of eligible
 * site-type and region-type keys — the override type is tried in
 * addition to the natural type.
 */
function findCreatureKeyingMatches(
  def: CreatureCard,
  mhState: MovementHazardPhaseState,
  state: GameState,
  targetCompany: { readonly destinationSite?: { readonly instanceId: CardInstanceId } | null },
): CreatureKeyingMatch[] {
  const matches: CreatureKeyingMatch[] = [];
  const seen = new Set<string>();

  // Gather attribute-modifier overrides in scope for this company's
  // arrival. See `ActiveConstraint.kind.attribute-modifier`.
  const destSiteDefId = targetCompany.destinationSite?.instanceId
    ? resolveInstanceId(state, targetCompany.destinationSite.instanceId)
    : null;
  const overriddenRegionTypes = new Map<string, import('../../types/common.js').RegionType>();
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'attribute-modifier' || c.kind.attribute !== 'region.type' || c.kind.op !== 'override') continue;
    const regionName = (c.kind.filter as { 'region.name'?: string } | undefined)?.['region.name'];
    if (!regionName || typeof regionName !== 'string') continue;
    if (mhState.resolvedSitePathNames.includes(regionName)) {
      overriddenRegionTypes.set(regionName, c.kind.value as import('../../types/common.js').RegionType);
    }
  }
  const effectiveRegionTypes: import('../../types/common.js').RegionType[] = [...mhState.resolvedSitePath];
  for (const rt of overriddenRegionTypes.values()) {
    if (!effectiveRegionTypes.includes(rt)) effectiveRegionTypes.push(rt);
  }
  const effectiveSiteTypes: import('../../types/common.js').SiteType[] = [];
  if (mhState.destinationSiteType) effectiveSiteTypes.push(mhState.destinationSiteType);
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'attribute-modifier' || c.kind.attribute !== 'site.type' || c.kind.op !== 'override') continue;
    const filterSiteDefId = (c.kind.filter as { 'site.definitionId'?: string } | undefined)?.['site.definitionId'];
    if (destSiteDefId === null || filterSiteDefId !== (destSiteDefId as unknown as string)) continue;
    const overrideType = c.kind.value as import('../../types/common.js').SiteType;
    if (!effectiveSiteTypes.includes(overrideType)) {
      effectiveSiteTypes.push(overrideType);
    }
  }

  const inPlayNames = buildInPlayNames(state);
  const whenContext = { inPlay: inPlayNames };
  for (const key of def.keyedTo) {
    if (key.when && !matchesCondition(key.when, whenContext)) continue;
    // Region type matches
    if (key.regionTypes && key.regionTypes.length > 0) {
      if (regionTypesMatch(key.regionTypes, effectiveRegionTypes)) {
        // Report each matching region type individually
        for (const rt of key.regionTypes) {
          if (effectiveRegionTypes.includes(rt)) {
            const k = `region-type:${rt}`;
            if (!seen.has(k)) { seen.add(k); matches.push({ method: 'region-type', value: rt }); }
          }
        }
      }
    }
    // Region name matches
    if (key.regionNames && key.regionNames.length > 0) {
      for (const rn of key.regionNames) {
        if (mhState.resolvedSitePathNames.includes(rn)) {
          const k = `region-name:${rn}`;
          if (!seen.has(k)) { seen.add(k); matches.push({ method: 'region-name', value: rn }); }
        }
      }
    }
    // Site type matches
    if (key.siteTypes && key.siteTypes.length > 0) {
      for (const st of effectiveSiteTypes) {
        if (key.siteTypes.includes(st)) {
          const k = `site-type:${st}`;
          if (!seen.has(k)) { seen.add(k); matches.push({ method: 'site-type', value: st }); }
        }
      }
    }
    // Site name matches (e.g. Smaug at "The Lonely Mountain")
    if (key.siteNames && key.siteNames.length > 0 && mhState.destinationSiteName) {
      for (const sn of key.siteNames) {
        if (sn === mhState.destinationSiteName) {
          const k = `site-name:${sn}`;
          if (!seen.has(k)) { seen.add(k); matches.push({ method: 'site-name', value: sn }); }
        }
      }
    }
  }

  return matches;
}

/**
 * If the target company's effective site (destination if moving, else
 * current) carries a `cancel-attacks` site-rule, return the site's name
 * so callers can mark creature plays non-viable and surface a reason.
 * Returns null when no such rule applies.
 */
function cancelAttacksSiteName(
  state: GameState,
  targetCompany: {
    readonly destinationSite?: { readonly instanceId: CardInstanceId } | null;
    readonly currentSite?: { readonly instanceId: CardInstanceId } | null;
  },
): string | null {
  const effectiveSiteInstanceId = targetCompany.destinationSite?.instanceId
    ?? targetCompany.currentSite?.instanceId
    ?? null;
  if (!effectiveSiteInstanceId) return null;
  const siteDefId = resolveInstanceId(state, effectiveSiteInstanceId);
  if (!siteDefId) return null;
  const siteDef = state.cardPool[siteDefId as unknown as string];
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) return null;
  const cancels = siteDef.effects.some(e => e.type === 'site-rule' && e.rule === 'cancel-attacks');
  return cancels ? siteDef.name : null;
}

/** Build a human-readable keying requirement string for error messages. */
function describeKeyingRequirement(def: CreatureCard): string {
  const keyDesc = def.keyedTo.map(k => {
    const parts: string[] = [];
    if (k.regionTypes?.length) parts.push(k.regionTypes.join('/'));
    if (k.regionNames?.length) parts.push(k.regionNames.join('/'));
    if (k.siteTypes?.length) parts.push(k.siteTypes.join('/'));
    if (k.siteNames?.length) parts.push(k.siteNames.join('/'));
    return parts.join(', ');
  }).join(' or ');
  return `Not keyable (requires ${keyDesc})`;
}

/**
 * Generate legal actions during the deck exhaust exchange sub-flow.
 * The player may exchange up to 5 cards between discard and sideboard,
 * then pass to complete the reshuffle.
 */
export function deckExhaustExchangeActions(
  state: GameState,
  player: { readonly discardPile: readonly import('../../index.js').CardInstance[]; readonly sideboard: readonly import('../../index.js').CardInstance[]; readonly deckExhaustExchangeCount: number },
  playerId: PlayerId,
): GameAction[] {
  const actions: GameAction[] = [];
  const MAX_EXCHANGES = 5;

  if (player.deckExhaustExchangeCount < MAX_EXCHANGES
    && player.discardPile.length > 0
    && player.sideboard.length > 0) {
    // Generate one exchange action per (discard, sideboard) pair
    for (const discardCard of player.discardPile) {
      for (const sideboardCard of player.sideboard) {
        actions.push({
          type: 'exchange-sideboard',
          player: playerId,
          discardCardInstanceId: discardCard.instanceId,
          sideboardCardInstanceId: sideboardCard.instanceId,
        });
      }
    }
  }

  // Pass is always available (0 exchanges is fine)
  actions.push({ type: 'pass', player: playerId });
  return actions;
}

/**
 * Check whether a creature's race is exempted from the hazard limit by
 * a `creature-type-no-hazard-limit` active constraint on the target company.
 */
function isCreatureRaceExemptFromLimit(
  state: GameState,
  companyId: CompanyId,
  race: string,
): boolean {
  if (!state.activeConstraints) return false;
  return state.activeConstraints.some(
    c => c.target.kind === 'company'
      && c.target.companyId === companyId
      && c.kind.type === 'creature-type-no-hazard-limit'
      && c.kind.exemptRace === race,
  );
}

/**
 * Check whether a creature's race is whitelisted by an active
 * `creature-keying-bypass` constraint on the target company with at
 * least one remaining use. Used by Dragon's Desolation Mode B to allow
 * a Dragon creature that would otherwise fail its path-keying check.
 */
function hasCreatureKeyingBypass(
  state: GameState,
  companyId: CompanyId,
  race: string,
): boolean {
  if (!state.activeConstraints) return false;
  return state.activeConstraints.some(
    c => c.target.kind === 'company'
      && c.target.companyId === companyId
      && c.kind.type === 'creature-keying-bypass'
      && c.kind.race === race
      && c.kind.remainingPlays > 0,
  );
}

/**
 * Evaluate a play-condition effect with `requires: 'site-path'` against
 * the current M/H phase state. Builds a context with:
 *
 * - `sitePath.*Count` — region-type counts from the resolved site path.
 * - `destinationSiteType` — the site type of the destination (e.g.
 *   `ruins-and-lairs`), enabling cards like Dragon's Desolation Mode B
 *   that gate on both path composition and destination site type.
 * - `inPlay` — names of all cards currently in play for both players,
 *   matching the shared `inPlay` condition semantics (e.g. Doors of
 *   Night as an alt-keying modifier).
 */
function checkSitePathCondition(
  mhState: MovementHazardPhaseState,
  effect: PlayConditionEffect,
  state?: GameState,
): boolean {
  const counts: Record<string, number> = {
    wildernessCount: 0, shadowCount: 0, darkCount: 0,
    coastalCount: 0, freeCount: 0, borderCount: 0,
  };
  for (const rt of mhState.resolvedSitePath) {
    switch (rt) {
      case RegionType.Wilderness: counts.wildernessCount++; break;
      case RegionType.Shadow: counts.shadowCount++; break;
      case RegionType.Dark: counts.darkCount++; break;
      case RegionType.Coastal: counts.coastalCount++; break;
      case RegionType.Free: counts.freeCount++; break;
      case RegionType.Border: counts.borderCount++; break;
    }
  }
  const ctx: Record<string, unknown> = { sitePath: counts };
  if (mhState.destinationSiteType) {
    ctx['destinationSiteType'] = mhState.destinationSiteType;
  }
  if (state) {
    const inPlayNames: string[] = [];
    for (const p of state.players) {
      for (const c of p.cardsInPlay) {
        const d = state.cardPool[c.definitionId as string];
        if (d && 'name' in d) inPlayNames.push((d as { name: string }).name);
      }
    }
    ctx['inPlay'] = inPlayNames;
  }
  return effect.condition ? matchesCondition(effect.condition, ctx) : true;
}

// mhWoundCorruptionCheckActions removed: wound corruption checks are
// now produced via the unified pending-resolution system. See
// `legal-actions/pending.ts` (corruptionCheckActions) and
// `engine/pending-reducers.ts` (applyCorruptionCheckResolution).
