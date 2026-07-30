/**
 * @module reducer-untap
 *
 * Untap phase handlers for the game reducer. Manages untapping of cards,
 * hazard sideboard access, and transition to the organization phase.
 */

import type { GameState, CharacterInPlay, UntapPhaseState, GameAction } from '../index.js';
import { matchesContext } from '../effects/condition-matcher.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { shuffle } from '../rng.js';
import { getPlayerIndex, requirePhaseState } from '../state-utils.js';
import { isSiteCard, isAvatarCharacter, isCharacterCard, printedMind } from '../types/cards.js';
import { CardStatus, SiteType } from '../types/common.js';
import type { CardInstanceId, CompanyId } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { ownerOf } from '../types/state.js';
import { getEffectiveSiteType, resolveSiteInstanceTransform, siteConstraintFilterMatches } from './effective.js';
import { logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer-utils.js';
import { clonePlayers, defById, findEventMaintenanceEffect, getCardEffects, isHavenForPlayer, isSelfDiscardMove, purgeCompanyFollowers, toCardInstance, updatePlayer, wrongActionType } from './reducer-utils.js';
import { enqueueCorruptionCheck, enqueueResolution } from './pending.js';
import { enqueueMaintenanceUpkeep } from './event-maintenance.js';
import type { OnEventEffect, CardEffect } from '../types/effects.js';


/**
 * Handles the Untap phase. The resource player untaps; the hazard player
 * may access their sideboard. Both pass to advance to Organization.
 */
export function handleUntap(state: GameState, action: GameAction): ReducerResult {
  const untapState = requirePhaseState(state, Phase.Untap);

  if (action.type === 'start-hazard-sideboard-to-deck' || action.type === 'start-hazard-sideboard-to-discard') {
    const destination = action.type === 'start-hazard-sideboard-to-deck' ? 'deck' : 'discard';
    logDetail(`Untap: hazard player declares sideboard access (${destination})`);
    return {
      state: {
        ...state,
        phaseState: { ...untapState, hazardSideboardDestination: destination, hazardSideboardAccessed: true, hazardPlayerPassed: false },
      },
    };
  }

  if (action.type === 'fetch-hazard-from-sideboard') {
    return handleFetchHazardFromSideboard(state, action);
  }

  if (action.type === 'untap') {
    logDetail(`Untap: resource player ${action.player as string} untaps cards`);
    const untappedState = performUntap(state);
    const newUntapState = { ...untapState, untapped: true };
    if (newUntapState.hazardPlayerPassed) {
      return advanceToOrganization({ ...untappedState, phaseState: newUntapState });
    }
    return { state: { ...untappedState, phaseState: newUntapState } };
  }

  // 'pass' from the hazard player — either exits the sideboard sub-flow
  // or signals the hazard player is done. The resource player never has
  // a legal 'pass' here, so this branch always runs as the hazard player.
  if (untapState.hazardSideboardDestination === 'discard') {
    logDetail(`Hazard sideboard: player ${action.player as string} done fetching to discard (${untapState.hazardSideboardFetched} cards)`);
    const hazardIndex = getPlayerIndex(state, action.player);
    return {
      state: {
        ...updatePlayer(state, hazardIndex, p => ({ ...p, sideboardAccessedDuringUntap: true })),
        phaseState: { ...untapState, hazardSideboardDestination: null },
      },
    };
  }

  logDetail(`Untap: hazard player ${action.player as string} passed`);
  if (untapState.untapped) {
    return advanceToOrganization(state);
  }
  return {
    state: {
      ...state,
      phaseState: { ...untapState, hazardPlayerPassed: true },
    },
  };
}

/** Handle fetch-hazard-from-sideboard during the untap hazard sideboard sub-flow. */
function handleFetchHazardFromSideboard(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'fetch-hazard-from-sideboard') return wrongActionType(state, action, 'fetch-hazard-from-sideboard');

  const untapState = requirePhaseState(state, Phase.Untap);
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.sideboard.findIndex(c => c.instanceId === action.sideboardCardInstanceId);
  if (cardIdx === -1) return { state, error: 'Sideboard card not found' };
  const sideboardCard = player.sideboard[cardIdx];
  const def = defById(state, sideboardCard.definitionId)!;
  const destination = untapState.hazardSideboardDestination!;

  const newSideboard = [...player.sideboard];
  newSideboard.splice(cardIdx, 1);

  const newPlayers = clonePlayers(state);
  let newRng = state.rng;

  if (destination === 'discard') {
    logDetail(`Hazard sideboard → discard: ${def.name} (${action.sideboardCardInstanceId as string})`);
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      sideboard: newSideboard,
      discardPile: [...player.discardPile, sideboardCard],
    };
  } else {
    logDetail(`Hazard sideboard → play deck: ${def.name} (${action.sideboardCardInstanceId as string}), shuffling`);
    const [shuffledDeck, nextRng] = shuffle([...player.playDeck, sideboardCard], state.rng);
    newRng = nextRng;
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      sideboard: newSideboard,
      playDeck: shuffledDeck,
    };
  }

  // Mark sideboard accessed for hazard limit halving
  newPlayers[playerIndex] = { ...newPlayers[playerIndex], sideboardAccessedDuringUntap: true };

  const newUntapState: UntapPhaseState = {
    ...untapState,
    hazardSideboardFetched: untapState.hazardSideboardFetched + 1,
    // Deck destination: exit sub-flow after 1 card; discard: stay in sub-flow
    hazardSideboardDestination: destination === 'deck' ? null : destination,
  };

  return {
    state: {
      ...state,
      players: newPlayers,
      rng: newRng,
      phaseState: newUntapState,
    },
  };
}

/**
 * Perform the untap mechanics on the active player's cards.
 * Called when entering the untap phase (before any player actions).
 * Untaps all tapped characters, items, allies, and cards in play.
 * Heals wounded characters at havens to tapped position.
 */


/**
 * Perform the untap mechanics on the active player's cards.
 * Called when entering the untap phase (before any player actions).
 * Untaps all tapped characters, items, allies, and cards in play.
 * Heals wounded characters at havens to tapped position.
 */
function performUntap(state: GameState): GameState {
  const playerIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[playerIndex];

  // Build a set of character IDs at havens for healing wounded characters.
  // Also check site-type-override constraints (e.g. The White Tree makes
  // Minas Tirith a haven for healing purposes) and the intrinsic
  // `heal-during-untap` site-rule (e.g. Barad-dûr — Darkhaven during
  // untap phase).
  const charsAtHaven = new Set<string>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteDef = state.cardPool[company.currentSite.definitionId];
    if (!siteDef || !isSiteCard(siteDef)) continue;
    // MEWH §3: a Fallen-wizard heals only at his Wizardhavens; METW Havens and
    // MELE Darkhavens (siteType `haven`, other alignment) are not havens for him.
    let isHaven = isHavenForPlayer(siteDef, player.alignment, {
      state,
      siteDefinitionId: company.currentSite.definitionId,
      playerId: player.id,
    });
    if (!isHaven) {
      const siteDefId = company.currentSite.definitionId;
      isHaven = state.activeConstraints.some(c => {
        if (c.kind.type !== 'attribute-modifier'
          || c.kind.attribute !== 'site.type'
          || c.kind.op !== 'override'
          || c.kind.value !== SiteType.Haven) return false;
        return siteConstraintFilterMatches(c.kind.filter, siteDefId, siteDef.name, siteDef.siteType);
      });
    }
    if (!isHaven && siteDef.effects) {
      isHaven = siteDef.effects.some(
        e => e.type === 'site-rule' && e.rule === 'heal-during-untap',
      );
    }
    // Roots of the Earth (ba-74): the controller's associated Under-deeps
    // instance is transformed into a Darkhaven. Only an actual instance-scoped
    // `site-instance-transform` may promote a non-haven site to a healing haven
    // here — a plain METW Haven / MELE Darkhaven must still be gated by the
    // MEWH check above (a Fallen-wizard does not heal at a METW Haven), so we
    // require the transform to be present before honouring the effective type.
    if (!isHaven) {
      const transform = resolveSiteInstanceTransform(
        state, company.currentSite.definitionId, company.currentSite.instanceId,
      );
      isHaven = transform !== undefined
        && getEffectiveSiteType(
          state, company.currentSite.definitionId, siteDef.siteType, company.currentSite.instanceId,
        ) === SiteType.Haven;
    }
    if (isHaven) {
      for (const charId of company.characters) {
        charsAtHaven.add(charId as string);
      }
    }
  }

  // Collect characters with a bearer-cannot-untap or character-is-prisoner
  // constraint so we can skip them during normal untap processing.
  // Prisoners are fully locked — they cannot untap or heal (rule 8.35).
  const cannotUntapIds = new Set<string>();
  const prisonerIds = new Set<string>();
  // Fled into Darkness (ba-18): one-shot untap skips. Each maps a character to
  // the constraint id + the in-play card instance to discard when the skip
  // fires. Treated like `cannot-untap` for the tap logic below, then consumed
  // (constraint removed, card discarded) after the untap sweep.
  const skipNextUntap = new Map<string, { constraintId: string; cardInstanceId: string }>();
  for (const c of state.activeConstraints) {
    if (c.target.kind !== 'character') continue;
    if (c.kind.type === 'bearer-cannot-untap') {
      cannotUntapIds.add(c.target.characterId as string);
    }
    if (c.kind.type === 'character-is-prisoner' || c.kind.type === 'character-pressed') {
      // Prisoners (8.35) and Press-ganged characters (ba-22) are locked "off to
      // the side": they never untap or heal.
      prisonerIds.add(c.target.characterId as string);
      cannotUntapIds.add(c.target.characterId as string);
    }
    if (c.kind.type === 'skip-next-untap') {
      cannotUntapIds.add(c.target.characterId as string);
      skipNextUntap.set(c.target.characterId as string, {
        constraintId: c.id as string,
        cardInstanceId: c.kind.cardInstanceId as string,
      });
    }
  }

  // Untap all tapped characters and their items/allies;
  // heal wounded (inverted) characters at havens to tapped position.
  // Characters with a bearer-cannot-untap constraint are left tapped.
  const newCharacters: Record<string, CharacterInPlay> = {};
  let healedCount = 0;
  for (const [key, ch] of Object.entries(player.characters)) {
    const untappedItems = ch.items.map(item =>
      item.status === CardStatus.Tapped ? { ...item, status: CardStatus.Untapped } : item,
    );
    const untappedAllies = ch.allies.map(ally =>
      ally.status === CardStatus.Tapped ? { ...ally, status: CardStatus.Untapped } : ally,
    );
    let newStatus = ch.status;
    if (prisonerIds.has(key)) {
      // Prisoners cannot untap or heal (CoE rule 8.35: cannot take any actions
      // including healing or untapping).
      logDetail(`Untap: skipping ${key} — character is a prisoner`);
    } else if (cannotUntapIds.has(key)) {
      // bearer-cannot-untap blocks tapped→untapped only; healing (inverted→tapped)
      // at a haven is a separate operation and must still proceed (CoE rule 2.I.1).
      if (ch.status === CardStatus.Inverted && charsAtHaven.has(key)) {
        newStatus = CardStatus.Tapped;
        healedCount++;
        logDetail(`Untap: healing ${key} to tapped (bearer-cannot-untap blocks untap, not healing)`);
      } else {
        logDetail(`Untap: skipping untap for ${key} (bearer-cannot-untap constraint active)`);
      }
    } else if (ch.status === CardStatus.Tapped) {
      newStatus = CardStatus.Untapped;
    } else if (ch.status === CardStatus.Inverted && charsAtHaven.has(key)) {
      newStatus = CardStatus.Tapped;
      healedCount++;
    }
    newCharacters[key] = {
      ...ch,
      status: newStatus,
      items: untappedItems,
      allies: untappedAllies,
    };
  }

  // Untap all tapped cards in play (permanent events, factions, etc.)
  // Skip cards with a `no-auto-untap` effect (e.g. Power Built by Waiting).
  const newCardsInPlay = player.cardsInPlay.map(card => {
    if (card.status !== CardStatus.Tapped) return card;
    const def = defById(state, card.definitionId);
    const hasNoAutoUntap = def && 'effects' in def && hasPlayFlag(def, 'no-auto-untap');
    if (hasNoAutoUntap) {
      logDetail(`Untap: skipping ${card.definitionId as string} — no-auto-untap effect`);
      return card;
    }
    return { ...card, status: CardStatus.Untapped };
  });

  const tappedCharCount = Object.values(player.characters).filter(ch => ch.status === CardStatus.Tapped).length;
  logDetail(`Untap: untapping ${tappedCharCount} character(s), healing ${healedCount} wounded character(s) at havens/healing sites`);

  // Reset per-turn agent bookkeeping and untap tapped agents.
  // An agent that was in play before this untap is now eligible to take
  // agent actions (inPlayAtTurnStart → true). remainingActions is set to
  // 1 + extra-agent-actions effects in play (e.g. Great Need or Purpose).
  const extraAgentActions = state.players.reduce((sum, p) =>
    p.cardsInPlay.reduce((s, card) => {
      const def = defById(state, card.definitionId);
      return s + (getCardEffects(def) as CardEffect[]).reduce((n, e) => e.type === 'extra-agent-actions' ? n + (e as { value: number }).value : n, 0);
    }, sum), 0);
  const newAgents = player.agents.map(a => ({
    ...a,
    inPlayAtTurnStart: true,
    remainingActions: 1 + extraAgentActions,
    character: a.character.status === CardStatus.Tapped
      ? { ...a.character, status: CardStatus.Untapped }
      : a.character,
  }));

  const tappedAgentCount = player.agents.filter(a => a.character.status === CardStatus.Tapped).length;
  logDetail(`Untap: untapping ${tappedAgentCount} agent(s), setting inPlayAtTurnStart=true for ${newAgents.length} agent(s)`);

  let stateAfterUntap = updatePlayer(state, playerIndex, p => ({
    ...p,
    characters: newCharacters,
    cardsInPlay: newCardsInPlay,
    agents: newAgents,
  }));

  // Rule 9.04: Discard agents revealed without a home site. These belong to the
  // hazard player (the opponent of the active player). They are discarded at the
  // end of the turn in which they were revealed — which is the active player's turn.
  const hazardPlayerIndex = 1 - playerIndex;
  const hazardPlayer = stateAfterUntap.players[hazardPlayerIndex];
  const discarded = hazardPlayer.agents.filter(a => a.discardAtEndOfTurn);
  if (discarded.length > 0) {
    logDetail(`Untap: discarding ${discarded.length} hazard agent(s) revealed without home site (rule 9.04)`);
    const discardedCards = discarded.map(a => (toCardInstance(a.character)));
    const discardedSites = discarded.flatMap(a => a.siteStack);
    stateAfterUntap = updatePlayer(stateAfterUntap, hazardPlayerIndex, p => ({
      ...p,
      agents: p.agents.filter(a => !a.discardAtEndOfTurn),
      discardPile: [...p.discardPile, ...discardedCards],
      siteDeck: [...p.siteDeck, ...discardedSites],
    }));
  }

  // Consume the one-shot untap skips: the character was just held tapped (via
  // cannotUntapIds); now remove the constraint and discard the source card to
  // its owner's (the active player's) discard pile. The source may sit either in
  // `cardsInPlay` (Fled into Darkness ba-18's `flee-from-strike` card) or
  // attached to a character's `items` (Fireworks dm-130, a resource
  // permanent-event played on the sage).
  if (skipNextUntap.size > 0) {
    const consumedConstraintIds = new Set<string>();
    const discardCardIds = new Set<string>();
    for (const [charId, { constraintId, cardInstanceId }] of skipNextUntap) {
      logDetail(`Untap: consuming skip-next-untap on ${charId} — character stays tapped, discarding ${cardInstanceId}`);
      consumedConstraintIds.add(constraintId);
      discardCardIds.add(cardInstanceId);
    }
    // Collect the source cards wherever they live (general cards-in-play or a
    // character's items), then remove them from every zone in one player update.
    const player = stateAfterUntap.players[playerIndex];
    const cardsToDiscard: import('../types/state-cards.js').CardInstance[] = [];
    for (const c of player.cardsInPlay) {
      if (discardCardIds.has(c.instanceId as string)) cardsToDiscard.push(toCardInstance(c));
    }
    for (const ch of Object.values(player.characters)) {
      for (const item of ch.items) {
        if (discardCardIds.has(item.instanceId as string)) cardsToDiscard.push(toCardInstance(item));
      }
    }
    stateAfterUntap = updatePlayer(stateAfterUntap, playerIndex, p => ({
      ...p,
      cardsInPlay: p.cardsInPlay.filter(c => !discardCardIds.has(c.instanceId as string)),
      characters: Object.fromEntries(
        Object.entries(p.characters).map(([id, ch]) => [
          id,
          { ...ch, items: ch.items.filter(item => !discardCardIds.has(item.instanceId as string)) },
        ]),
      ),
      discardPile: [...p.discardPile, ...cardsToDiscard],
    }));
    stateAfterUntap = {
      ...stateAfterUntap,
      activeConstraints: stateAfterUntap.activeConstraints.filter(
        c => !consumedConstraintIds.has(c.id as string),
      ),
    };
  }

  return stateAfterUntap;
}

/**
 * Build the untap phase state.
 * Called from all entry points into the untap phase.
 */


/**
 * Build the untap phase state.
 * Called from all entry points into the untap phase.
 */
export function enterUntapPhase(state: GameState): GameState {
  // Reset sideboardAccessedDuringUntap for all players at the start of each
  // new turn. Per CoE rule 2.I.2, the hazard limit halving only applies to
  // "this turn's" movement/hazard phases — the flag must not carry over.
  const players = state.players.map(p =>
    p.sideboardAccessedDuringUntap ? { ...p, sideboardAccessedDuringUntap: false } : p,
  ) as unknown as typeof state.players;
  return {
    ...state,
    players,
    phaseState: { phase: Phase.Untap, untapped: false, hazardSideboardDestination: null, hazardSideboardFetched: 0, hazardSideboardAccessed: false, resourcePlayerPassed: false, hazardPlayerPassed: false },
  };
}

/**
 * Advance from the untap phase to the Organization phase.
 * Called when resource player has untapped and hazard player has passed.
 */


/**
 * Advance from the untap phase to the Organization phase.
 * Called when resource player has untapped and hazard player has passed.
 */
function advanceToOrganization(state: GameState): ReducerResult {
  logDetail('Untap: advancing to Organization phase');

  // Trigger `untap-phase-end` on-event effects (Lure of the Senses,
  // The Least of Gold Rings, etc.). Each character of the active
  // player scans its attached hazards/items/allies for matching
  // effects. An optional `when` condition on the effect is evaluated
  // against the bearer context ({ bearer: { siteType, atHaven } });
  // cards that should only fire at a haven (Lure) express that as
  // `when: { "bearer.atHaven": true }` instead of using a dedicated
  // event name. For every match, enqueue a corruption-check
  // resolution scoped to the Organization phase.
  let advanced: GameState = {
    ...state,
    phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null },
  };

  // Only scan the active (resource) player's characters — the card text
  // says "at the end of *his* untap phase", so it fires only when the
  // character's controller's untap phase transitions to organization.
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[activeIndex];
  const charSiteType = new Map<string, SiteType | null>();
  const charAtHaven = new Map<string, boolean>();
  const charCompanySize = new Map<string, number>();
  for (const company of player.companies) {
    const siteDef = company.currentSite ? state.cardPool[company.currentSite.definitionId] : undefined;
    const siteType = siteDef && isSiteCard(siteDef) ? siteDef.siteType : null;
    // `bearer.atHaven` follows the bearer's controller ({H} semantics):
    // any haven-class site for hero/minion players (Haven/Darkhaven), but for
    // a Fallen-wizard player his Wizardhavens — an FW-alignment haven site or
    // a `wizardhaven-conversion` site (Longing for the West wh-25: "…if not
    // at a Haven [{H}] (or Wizardhaven)").
    const atHaven = isHavenForPlayer(siteDef, player.alignment, {
      state,
      siteDefinitionId: company.currentSite?.definitionId,
      playerId: player.id,
    });
    for (const charId of company.characters) {
      charSiteType.set(charId as string, siteType);
      charAtHaven.set(charId as string, atHaven);
      charCompanySize.set(charId as string, company.characters.length);
    }
  }

  // Collect items to self-discard from untap-phase-end triggers (processed after scan).
  const untapEndDiscards: Array<{ charId: CardInstanceId; slot: 'items' | 'hazards' | 'allies'; cardInstanceId: string }> = [];
  // Collect cards to self-discard from organization-phase-start triggers (routed
  // to each card's owner, so an opponent-owned hazard returns to their pile).
  const orgStartDiscards: Array<{ charId: CardInstanceId; slot: 'items' | 'hazards' | 'allies'; cardInstanceId: string }> = [];

  for (const [charId, char] of Object.entries(player.characters)) {
    const siteType = charSiteType.get(charId) ?? null;
    const atHaven = charAtHaven.get(charId) ?? false;
    const companyCharCount = charCompanySize.get(charId) ?? 0;
    const bearerCtx = { bearer: { siteType, atHaven } };
    // Host character (the bearer of the attached cards) identity, for
    // conditions gated on who controls an ally — Evil Things Lingering (ba-45):
    // "If this ally's controlling character is not The Balrog …".
    const hostDef = defById(state, char.definitionId);
    const hostName = hostDef && isCharacterCard(hostDef) ? hostDef.name : undefined;
    const hostMind = printedMind(hostDef);
    // Context for `organization-phase-start` self-discard conditions that also
    // care about company size, e.g. So You've Come Back (le-138): "Discard …
    // if target character is in a company by himself and at a Haven [{H}]."
    const orgStartCtx = { bearer: { siteType, atHaven, name: hostName, mind: hostMind }, company: { characterCount: companyCharCount } };
    // Scan attached hazards, items, allies for matching on-event effects
    const attached = [...char.hazards, ...char.items, ...char.allies];
    for (const card of attached) {
      const def = defById(state, card.definitionId);
      for (const e of getCardEffects(def)) {
        if (e.type !== 'on-event') continue;
        const oe: OnEventEffect = e;
        // `organization-phase-start` on an attached card: either a self-discard
        // (le-138) or an opponent elimination roll (ba-45). Both honour the same
        // optional `when` gate evaluated at org-phase start.
        if (oe.event === 'organization-phase-start') {
          if (oe.when && !matchesContext(oe.when, orgStartCtx)) {
            logDetail(`organization-phase-start: skipping ${def?.name ?? '?'} on ${char.instanceId as string} — when not met (size=${companyCharCount}, atHaven=${atHaven})`);
            continue;
          }
          if (isSelfDiscardMove(oe.apply)) {
            const slot: 'items' | 'hazards' | 'allies' =
              char.items.some(i => i.instanceId === card.instanceId) ? 'items'
              : char.hazards.some(h => h.instanceId === card.instanceId) ? 'hazards' : 'allies';
            logDetail(`organization-phase-start: queuing self-discard for ${def?.name ?? '?'} on ${charId} (slot=${slot}, size=${companyCharCount}, atHaven=${atHaven})`);
            orgStartDiscards.push({ charId: charId as CardInstanceId, slot, cardInstanceId: card.instanceId as string });
            continue;
          }
          if (oe.apply.type === 'enqueue-opponent-elimination-roll') {
            // The opponent (the active player's opponent) rolls 2d6 + modifier;
            // the controlling character (this bearer) is eliminated if the total
            // exceeds his mind. Enqueued as a generic dice-check resolution.
            const opponentIndex = activeIndex === 0 ? 1 : 0;
            const opponentId = state.players[opponentIndex].id;
            logDetail(`organization-phase-start: enqueuing opponent elimination roll for ${def?.name ?? '?'} on ${charId} (opponent ${opponentId as string} rolls, modifier ${oe.apply.modifier}, threshold mind ${hostMind})`);
            advanced = enqueueResolution(advanced, {
              source: card.instanceId,
              actor: opponentId,
              scope: { kind: 'phase', phase: Phase.Organization },
              kind: {
                type: 'dice-check',
                label: `${def?.name ?? 'Elimination roll'}: ${hostName ?? '?'}`,
                roller: opponentId,
                modifiers: [{ kind: 'constant', value: oe.apply.modifier }],
                threshold: hostMind,
                comparison: 'gt',
                onPass: { type: 'eliminate-character' },
                continuation: { kind: 'dequeue-only' },
                requireTargetPresent: true,
                targetCharacterId: char.instanceId,
              },
            });
            continue;
          }
          continue;
        }
        if (oe.event !== 'untap-phase-end') continue;
        if (oe.when && !matchesContext(oe.when, bearerCtx)) {
          logDetail(`Untap-phase-end: skipping ${def?.name ?? '?'} on ${char.instanceId as string} — when condition not met (siteType=${siteType ?? 'none'})`);
          continue;
        }
        if (oe.apply.type === 'force-check' && oe.apply.check === 'corruption') {
          const modifier = oe.apply.modifier ?? 0;
          logDetail(`Untap-phase-end: enqueuing corruption check for ${def?.name ?? '?'} on ${char.instanceId as string} (modifier ${modifier})`);
          advanced = enqueueCorruptionCheck(advanced, {
            source: card.instanceId,
            actor: player.id,
            scope: { kind: 'phase', phase: Phase.Organization },
            characterId: char.instanceId,
            modifier,
            reason: def?.name ?? 'Untap-phase-end',
          });
        } else if (isSelfDiscardMove(oe.apply)) {
          // Determine which slot (items/hazards/allies) the card lives in
          const slot: 'items' | 'hazards' | 'allies' =
            char.items.some(i => i.instanceId === card.instanceId) ? 'items'
            : char.hazards.some(h => h.instanceId === card.instanceId) ? 'hazards' : 'allies';
          logDetail(`Untap-phase-end: queuing self-discard for ${def?.name ?? '?'} on ${charId} (slot=${slot})`);
          untapEndDiscards.push({ charId: charId as CardInstanceId, slot, cardInstanceId: card.instanceId as string });
        }
      }
    }
  }

  // Apply collected self-discard items after the scan loop to avoid mutation during iteration.
  for (const { charId, slot, cardInstanceId } of untapEndDiscards) {
    const char = advanced.players[activeIndex].characters[charId];
    if (!char) continue;
    const cardToDiscard = char[slot].find(c => c.instanceId === cardInstanceId);
    if (!cardToDiscard) continue;
    logDetail(`Untap-phase-end: discarding ${cardInstanceId} from character ${charId}`);
    advanced = updatePlayer(advanced, activeIndex, p => ({
      ...p,
      characters: {
        ...p.characters,
        [charId]: { ...char, [slot]: char[slot].filter(c => c.instanceId !== cardInstanceId) },
      },
      discardPile: [...p.discardPile, toCardInstance(cardToDiscard)],
    }));
  }

  // Apply organization-phase-start self-discards. The card is removed from the
  // active player's character and returned to *its owner's* discard pile — a
  // hazard (owned by the opponent) goes back to the opponent's pile.
  for (const { charId, slot, cardInstanceId } of orgStartDiscards) {
    const char = advanced.players[activeIndex].characters[charId];
    if (!char) continue;
    const cardToDiscard = char[slot].find(c => c.instanceId === cardInstanceId);
    if (!cardToDiscard) continue;
    const ownerIndex = getPlayerIndex(advanced, ownerOf(cardToDiscard.instanceId));
    logDetail(`organization-phase-start: discarding ${cardInstanceId} from ${charId} to owner player ${ownerIndex}`);
    // Detach from the active player's character.
    advanced = updatePlayer(advanced, activeIndex, p => ({
      ...p,
      characters: {
        ...p.characters,
        [charId]: { ...p.characters[charId], [slot]: p.characters[charId][slot].filter(c => c.instanceId !== cardInstanceId) },
      },
    }));
    // Return to the owner's discard pile.
    advanced = updatePlayer(advanced, ownerIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, toCardInstance(cardToDiscard)],
    }));
  }

  // Sweep `organization-phase-start` on-event triggers on company-bound permanent events.
  // Scan all players' cardsInPlay for entries with companyId bound to an active-player company;
  // evaluate the `when` condition against that company's site context and discard if it matches.
  const activePlayerCompanyIds = new Set(player.companies.map(c => c.id as string));
  const companyToSiteType = new Map<string, SiteType | null>();
  for (const co of player.companies) {
    const sDef = co.currentSite ? advanced.cardPool[co.currentSite.definitionId] : undefined;
    const sType = sDef && isSiteCard(sDef) ? sDef.siteType : null;
    companyToSiteType.set(co.id as string, sType);
  }

  for (let pi = 0; pi < 2; pi++) {
    const p = advanced.players[pi];
    // Resolve this player's avatar definition ID for organization-phase-start conditions
    let playerAvatarId: string | null = null;
    for (const char of Object.values(p.characters)) {
      const charDef = advanced.cardPool[char.definitionId];
      if (charDef && isCharacterCard(charDef) && isAvatarCharacter(charDef)) {
        playerAvatarId = char.definitionId as string;
        break;
      }
    }
    const toDiscard: typeof p.cardsInPlay[0][] = [];
    // Companies whose Ringwraith followers must also be discarded when the mode
    // card self-discards (Black Rider le-170's `alsoDiscardCompanyFollowers`).
    const followerPurgeCompanyIds: string[] = [];
    for (const card of p.cardsInPlay) {
      const cid = card.companyId as string | undefined;
      if (!cid || !activePlayerCompanyIds.has(cid)) continue;
      const eDef = advanced.cardPool[card.definitionId] as { readonly name?: string; readonly effects?: readonly CardEffect[] } | undefined;
      if (!eDef?.effects) continue;
      for (const e of eDef.effects) {
        if (e.type !== 'on-event') continue;
        const oe = e;
        if (oe.event !== 'organization-phase-start') continue;
        if (!isSelfDiscardMove(oe.apply)) continue;
        const siteType = companyToSiteType.get(cid) ?? null;
        const ctx = { company: { siteType, atHaven: siteType === SiteType.Haven }, player: { avatarId: playerAvatarId } };
        if (oe.when && !matchesContext(oe.when, ctx)) continue;
        logDetail(`organization-phase-start: discarding "${eDef.name ?? card.definitionId}" from company ${cid} (siteType=${siteType ?? 'none'})`);
        toDiscard.push(card);
        if ((oe.apply as { readonly alsoDiscardCompanyFollowers?: boolean }).alsoDiscardCompanyFollowers) {
          logDetail(`organization-phase-start: also discarding Ringwraith followers in company ${cid} (${eDef.name ?? card.definitionId})`);
          followerPurgeCompanyIds.push(cid);
        }
        break;
      }
    }
    if (toDiscard.length === 0) continue;
    const discardIds = new Set(toDiscard.map(c => c.instanceId as string));
    advanced = {
      ...advanced,
      players: advanced.players.map((pl, idx) => {
        if (idx !== pi) return pl;
        return {
          ...pl,
          cardsInPlay: pl.cardsInPlay.filter(c => !discardIds.has(c.instanceId as string)),
          discardPile: [...pl.discardPile, ...toDiscard.map(c => (toCardInstance(c)))],
        };
      }) as unknown as typeof advanced.players,
    };
    for (const cid of followerPurgeCompanyIds) {
      advanced = purgeCompanyFollowers(advanced, pi, cid as CompanyId);
    }
  }

  // Clear `influenceUnsubtracted` flags on the active player's characters: any
  // character removed from direct-influence control between organization phases
  // (e.g. by Rebel-talk) now has its mind counted against general influence again,
  // and the player must move it back under general/direct influence or discard it
  // during this organization phase (CoE 2.II.2.2.3).
  {
    const ap = advanced.players[activeIndex];
    const pending = Object.entries(ap.characters).filter(([, c]) => c.influenceUnsubtracted);
    if (pending.length > 0) {
      const clearedChars = { ...ap.characters };
      for (const [cid, c] of pending) {
        logDetail(`Organization phase begins: ${cid} mind now counts against general influence (CoE 2.II.2.2.3)`);
        const { influenceUnsubtracted: _drop, ...rest } = c;
        clearedChars[cid as CardInstanceId] = rest;
      }
      advanced = updatePlayer(advanced, activeIndex, p => ({ ...p, characters: clearedChars }));
      // Remember which characters arrived here that way: any of them still
      // under general influence when the phase ends is discarded ahead of the
      // player's own choices if the phase ends over general influence
      // (CoE 3.47 tier 2 / 2.II.2.2.3's "or else it must be discarded").
      advanced = {
        ...advanced,
        phaseState: {
          ...requirePhaseState(advanced, Phase.Organization),
          influenceRevertedCharacterIds: pending.map(([cid]) => cid as CardInstanceId),
        },
      };
    }
  }

  // Promote Ringwraith-follower reclaim flags on the active player's
  // characters from 'grace' to 'due': this organization phase is the "next"
  // one CoE rule 3.08 grants after their controlling Ringwraith avatar left
  // play. A character still flagged 'due' and not controlled by a Ringwraith
  // avatar when this phase ends is immediately discarded.
  {
    const ap = advanced.players[activeIndex];
    const pending = Object.entries(ap.characters).filter(([, c]) => c.ringwraithReclaim === 'grace');
    if (pending.length > 0) {
      const promoted = { ...ap.characters };
      for (const [cid, c] of pending) {
        logDetail(`Organization phase begins: Ringwraith follower ${cid} must be re-controlled by a Ringwraith avatar before this phase ends or be discarded (CoE 3.08)`);
        promoted[cid as CardInstanceId] = { ...c, ringwraithReclaim: 'due' };
      }
      advanced = updatePlayer(advanced, activeIndex, p => ({ ...p, characters: promoted }));
    }
  }

  // `event-maintenance` with trigger `controller-organization-phase-start`
  // (Balance Between Powers dm-118): "At the start of your organization phase,
  // discard this card or keep it in play by discarding an environment card from
  // your hand." Only the active player's own in-play cards fire — "your"
  // organization phase is the controller's.
  for (const card of advanced.players[activeIndex].cardsInPlay) {
    const def = defById(advanced, card.definitionId);
    const maintenance = findEventMaintenanceEffect(def);
    if (maintenance?.trigger !== 'controller-organization-phase-start') continue;
    logDetail(`Organization phase begins: queuing event-maintenance for "${def?.name ?? card.definitionId}"`);
    advanced = enqueueMaintenanceUpkeep(advanced, {
      controllerId: advanced.players[activeIndex].id,
      sourceInstanceId: card.instanceId,
      sourceDefinitionId: card.definitionId,
      scope: { kind: 'phase', phase: Phase.Organization },
    });
  }

  return { state: advanced };
}

/** Handle actions during the organization phase. */

