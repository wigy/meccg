/**
 * @module reducer-untap
 *
 * Untap phase handlers for the game reducer. Manages untapping of cards,
 * hazard sideboard access, and transition to the organization phase.
 */

import type { GameState, CharacterInPlay, UntapPhaseState, GameAction } from '../index.js';
import { matchesContext } from '../effects/condition-matcher.js';
import { hasNoDirectInfluenceRestriction, hasPlayFlag } from '../effects/play-flags.js';
import { getPlayerIndex, requirePhaseState } from '../state-utils.js';
import { isSiteCard, isAvatarCharacter, isCharacterCard, printedMind } from '../types/cards.js';
import { Alignment, CardStatus, Race, SiteType } from '../types/common.js';
import type { CardInstanceId, CompanyId } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { ownerOf } from '../types/state.js';
import { getEffectiveSiteType, resolveSiteInstanceTransform, siteConstraintFilterMatches } from './effective.js';
import { logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer-utils.js';
import { defById, findEventMaintenanceEffect, getCardEffects, isHavenForPlayer, isSelfDiscardMove, moveSideboardCard, purgeCompanyFollowers, toCardInstance, updatePlayer, wrongActionType } from './reducer-utils.js';
import { enqueueCorruptionCheck, enqueueResolution } from './pending.js';
import { handleGrantActionApply } from './grant-action-apply.js';
import { enqueueMaintenanceUpkeep } from './event-maintenance.js';
import { countExtraAgentActions } from './mh-agents.js';
import type { OnEventEffect, CardEffect, UntapMindRollEffect, TakePrisonerEffect } from '../types/effects.js';


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

  // Rule 2.1.1: the resource player may activate any-phase grant-actions
  // (Gandalf tw-156 tapping to test a gold ring, td untap-bearer items)
  // during their own untap phase — untapActions offers them, so they must
  // be routed here like every other phase reducer does, or they'd fall
  // through to the hazard-pass branch below and be silently consumed.
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
  }

  // Everything below treats the action as the hazard player's pass; any
  // unhandled action type reaching it would be silently recorded as that
  // pass, so reject non-pass actions explicitly.
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass');

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
  const destination = untapState.hazardSideboardDestination!;

  const moved = moveSideboardCard(state, playerIndex, action.sideboardCardInstanceId, destination, 'Hazard sideboard');
  if (moved.error) return moved;

  // Mark sideboard accessed for hazard limit halving
  const marked = updatePlayer(moved.state, playerIndex, p => ({ ...p, sideboardAccessedDuringUntap: true }));

  const newUntapState: UntapPhaseState = {
    ...untapState,
    hazardSideboardFetched: untapState.hazardSideboardFetched + 1,
    // Deck destination: exit sub-flow after 1 card; discard: stay in sub-flow
    hazardSideboardDestination: destination === 'deck' ? null : destination,
  };

  return { state: { ...marked, phaseState: newUntapState } };
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
/**
 * Locates an in-play `untap-mind-roll` effect (Worn and Famished td-89) and
 * the card instance carrying it. Scanned across both players' `cardsInPlay`:
 * the restriction is a game-wide hazard long-event rule, not scoped to
 * whoever played it.
 */
function findUntapMindRollEffect(
  state: GameState,
): { effect: UntapMindRollEffect; sourceInstanceId: CardInstanceId; sourceName: string } | undefined {
  for (const p of state.players) {
    for (const card of p.cardsInPlay) {
      const def = defById(state, card.definitionId);
      for (const effect of getCardEffects(def)) {
        if (effect.type === 'untap-mind-roll') {
          return { effect, sourceInstanceId: card.instanceId, sourceName: def?.name ?? 'Worn and Famished' };
        }
      }
    }
  }
  return undefined;
}

/**
 * Whether an `untap-mind-roll` restriction exempts a tapped character from
 * the roll requirement: Wizards are always exempt ("non-Wizard character"),
 * as is any character whose company currently sits at one of the effect's
 * `exemptSiteTypes` (Haven/Free-hold/Border-hold for td-89).
 */
function isExemptFromUntapMindRoll(
  state: GameState,
  ch: CharacterInPlay,
  charId: string,
  charSiteType: ReadonlyMap<string, SiteType | undefined>,
  effect: UntapMindRollEffect,
): boolean {
  const def = defById(state, ch.definitionId);
  if (isCharacterCard(def) && def.race === Race.Wizard) return true;
  const siteType = charSiteType.get(charId);
  return siteType !== undefined && effect.exemptSiteTypes.includes(siteType);
}

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

  // Worn and Famished (td-89): while an `untap-mind-roll` effect is in play
  // and this untapping player isn't exempted by `noEffectOnMinion`, build a
  // per-character effective site-type map so the untap sweep below can tell
  // which tapped characters are restricted (roll required) vs. exempt.
  const untapMindRoll = findUntapMindRollEffect(state);
  const untapMindRollActive = untapMindRoll !== undefined
    && !(untapMindRoll.effect.noEffectOnMinion && player.alignment === Alignment.Ringwraith);
  const charSiteType = new Map<string, SiteType | undefined>();
  if (untapMindRollActive) {
    for (const company of player.companies) {
      if (!company.currentSite) continue;
      const siteDef = state.cardPool[company.currentSite.definitionId];
      if (!siteDef || !isSiteCard(siteDef)) continue;
      const effectiveType = getEffectiveSiteType(
        state, company.currentSite.definitionId, siteDef.siteType, company.currentSite.instanceId,
      );
      for (const charId of company.characters) {
        charSiteType.set(charId as string, effectiveType);
      }
    }
    logDetail(`Untap: "${untapMindRoll.sourceName}" untap-mind-roll active for ${player.id as string}`);
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
  // Morgul-knife (tw-64) / The Pale Sword (tw-97): a character who attempted
  // to remove their attached corruption card "instead of untapping or
  // healing" this untap phase forgoes BOTH — unlike bearer-cannot-untap,
  // which still allows healing (see comment below).
  const skipUntapAndHealIds = new Set<string>();
  for (const c of state.activeConstraints) {
    if (c.target.kind !== 'character') continue;
    // This is the untapping player's own phase: a constraint on the other
    // player's character (e.g. Fireworks dm-130's skip-next-untap on their
    // sage) must not be scanned here — scanning both players unconditionally
    // caused the opponent's untap phase to consume (and discard the source
    // card for) a skip-next-untap constraint that was never actually honoured,
    // since the sweep below only ever walks `player.characters`.
    if (!(c.target.characterId in player.characters)) continue;
    if (c.kind.type === 'bearer-cannot-untap') {
      cannotUntapIds.add(c.target.characterId as string);
    }
    if (c.kind.type === 'character-is-prisoner' || c.kind.type === 'character-pressed') {
      // Prisoners (8.35) and Press-ganged characters (ba-22) are locked "off to
      // the side": they never untap or heal.
      prisonerIds.add(c.target.characterId as string);
      cannotUntapIds.add(c.target.characterId as string);
    }
    // Scoped to this player's own characters: a skip-next-untap constraint on
    // an opponent's character must not be consumed (and its source card
    // silently vanished) during THIS player's untap phase — it belongs to the
    // constrained character's own owner's next untap phase.
    if (c.kind.type === 'skip-next-untap' && c.target.characterId as string in player.characters) {
      cannotUntapIds.add(c.target.characterId as string);
      skipNextUntap.set(c.target.characterId as string, {
        constraintId: c.id as string,
        cardInstanceId: c.kind.cardInstanceId as string,
      });
    }
    if (c.kind.type === 'skip-untap-and-heal') {
      skipUntapAndHealIds.add(c.target.characterId as string);
    }
  }

  // Untap all tapped characters and their items/allies;
  // heal wounded (inverted) characters at havens to tapped position.
  // Characters with a bearer-cannot-untap constraint are left tapped.
  const newCharacters: Record<string, CharacterInPlay> = {};
  let healedCount = 0;
  // Worn and Famished (td-89): tapped, non-exempt characters under an active
  // `untap-mind-roll` restriction stay tapped here; a dice-check is enqueued
  // for each after the sweep instead of the plain untap below.
  const untapRollCandidates: Array<{ charId: CardInstanceId; effectiveMind: number; charName: string }> = [];
  for (const [key, ch] of Object.entries(player.characters)) {
    // Skip items carrying a `no-auto-untap` effect (Map to Mithril td-133:
    // "this card never untaps") — mirrors the same check for top-level
    // `cardsInPlay` entries below.
    const untappedItems = ch.items.map(item => {
      if (item.status !== CardStatus.Tapped) return item;
      const itemDef = defById(state, item.definitionId);
      if (itemDef && 'effects' in itemDef && hasPlayFlag(itemDef, 'no-auto-untap')) return item;
      return { ...item, status: CardStatus.Untapped };
    });
    // CoE rule 2.V.2.2: allies are treated as characters for healing — a
    // wounded (inverted) ally heals to tapped when its bearer's company is
    // at a haven, same as a wounded character.
    const untappedAllies = ch.allies.map(ally => {
      if (ally.status === CardStatus.Tapped) return { ...ally, status: CardStatus.Untapped };
      if (ally.status === CardStatus.Inverted && charsAtHaven.has(key)) {
        healedCount++;
        return { ...ally, status: CardStatus.Tapped };
      }
      return ally;
    });
    let newStatus = ch.status;
    if (skipUntapAndHealIds.has(key)) {
      // Morgul-knife / The Pale Sword: the bearer attempted removal "instead
      // of untapping or healing" — both are forgone this untap phase,
      // regardless of the removal roll's outcome.
      logDetail(`Untap: skipping untap and healing for ${key} (attempted corruption-card removal instead)`);
    } else if (prisonerIds.has(key)) {
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
      if (untapMindRollActive && !isExemptFromUntapMindRoll(state, ch, key, charSiteType, untapMindRoll.effect)) {
        const def = defById(state, ch.definitionId);
        const charName = isCharacterCard(def) ? def.name : key;
        const effectiveMind = ch.effectiveStats.mind ?? printedMind(def);
        logDetail(`Untap: ${charName} restricted by untap-mind-roll (not at Haven/Free-hold/Border-hold) — staying tapped, roll queued (mind ${effectiveMind})`);
        untapRollCandidates.push({ charId: key as CardInstanceId, effectiveMind, charName });
      } else {
        newStatus = CardStatus.Untapped;
      }
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
  // 1 + extra-agent-actions effects applicable to that specific agent — the
  // untargeted-global total (e.g. Great Need or Purpose dm-62) plus any
  // self/attached bonus scoped to it alone (My Precious dm-29's whileRevealed,
  // Never Seen Him dm-74's attached permanent event) — see countExtraAgentActions.
  const newAgents = player.agents.map(a => ({
    ...a,
    inPlayAtTurnStart: true,
    remainingActions: 1 + countExtraAgentActions(state, a.id),
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

  // Worn and Famished (td-89): enqueue the "may instead make a roll adding
  // his mind" dice-check for every character held tapped above. Rolling has
  // no downside (no `onFail` penalty), so the printed "may" is modeled as an
  // always-taken roll rather than an interactive decline; the pending
  // resolution takes priority over further untap-phase actions until resolved.
  if (untapRollCandidates.length > 0) {
    const rollEffect = untapMindRoll!.effect;
    for (const { charId, effectiveMind, charName } of untapRollCandidates) {
      logDetail(`Untap: enqueuing untap-mind-roll dice-check for ${charName} (${charId as string}) — need 2d6 + mind ${effectiveMind} > ${rollEffect.threshold}`);
      stateAfterUntap = enqueueResolution(stateAfterUntap, {
        source: untapMindRoll!.sourceInstanceId,
        actor: player.id,
        scope: { kind: 'phase', phase: Phase.Untap },
        kind: {
          type: 'dice-check',
          label: `${charName} — roll to untap (Worn and Famished)`,
          roller: player.id,
          modifiers: [{ kind: 'constant', value: effectiveMind }],
          threshold: rollEffect.threshold,
          comparison: 'gt',
          onPass: { type: 'set-character-status', status: 'untapped' },
          continuation: { kind: 'dequeue-only' },
          targetCharacterId: charId,
        },
      });
    }
  }

  // Rule 9.04: Discard agents revealed without a home site. They are discarded
  // at the end of the turn in which they were revealed. Since turns strictly
  // alternate between the two players, "the turn that just ended" was always
  // the other player's turn, and its hazard player — the one who revealed the
  // agent — is exactly the player now starting their own untap (playerIndex).
  // Using `1 - playerIndex` here would look at the wrong player's agents and
  // delay the discard by a full extra turn.
  const hazardPlayerIndex = playerIndex;
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
 * Intercepts an attempt to set `characterId` to untapped outside of the
 * untap-phase sweep (e.g. a short event like And Forth He Hastened td-98
 * that untaps a character directly). If a one-shot `skip-next-untap`
 * constraint (Fireworks dm-130, Fled into Darkness ba-18) is active on the
 * character, the untap is intercepted here — the constraint is consumed
 * (removed) and its source card discarded to its owner's discard pile — so
 * the caller must leave the character tapped instead of applying the
 * requested untap. Returns `intercepted: false` (state unchanged) when no
 * such constraint applies, so the caller proceeds with the untap normally.
 */
export function interceptSkipNextUntap(
  state: GameState,
  characterId: CardInstanceId,
): { state: GameState; intercepted: boolean } {
  const constraint = state.activeConstraints.find(
    c => c.target.kind === 'character'
      && c.target.characterId === characterId
      && c.kind.type === 'skip-next-untap',
  );
  if (!constraint || constraint.kind.type !== 'skip-next-untap') return { state, intercepted: false };
  const cardInstanceId = constraint.kind.cardInstanceId;
  const ownerIndex = state.players.findIndex(p => (characterId as string) in p.characters);
  if (ownerIndex < 0) return { state, intercepted: false };

  logDetail(`skip-next-untap: intercepting untap of ${characterId as string} — stays tapped, discarding ${cardInstanceId as string}`);
  let discardedCard: import('../types/state-cards.js').CardInstance | undefined;
  let newState = updatePlayer(state, ownerIndex, p => {
    const cardsInPlay = p.cardsInPlay.filter(c => {
      if (c.instanceId !== cardInstanceId) return true;
      discardedCard = toCardInstance(c);
      return false;
    });
    const characters = Object.fromEntries(Object.entries(p.characters).map(([id, ch]) => {
      const items = ch.items.filter(item => {
        if (item.instanceId !== cardInstanceId) return true;
        discardedCard = toCardInstance(item);
        return false;
      });
      return [id, items.length === ch.items.length ? ch : { ...ch, items }];
    }));
    return {
      ...p,
      cardsInPlay,
      characters,
      discardPile: discardedCard ? [...p.discardPile, discardedCard] : p.discardPile,
    };
  });
  newState = {
    ...newState,
    activeConstraints: newState.activeConstraints.filter(c => c.id !== constraint.id),
  };
  return { state: newState, intercepted: true };
}

/**
 * At the start of each of a prisoner's untap phases, some hazard hosts
 * (Spells of the Barrow-wights dm-90) require a periodic body check for the
 * character they hold — failure eliminates the character, which (CoE 3.III.4)
 * still counts against its owner in marshalling points even out of play.
 * Scans the newly-active player's characters for a `character-is-prisoner`
 * constraint whose host carries a `take-prisoner` effect with
 * `untapBodyCheck`, and enqueues one `dice-check` resolution per match —
 * rolled by the host's owner (CoE 3.I.1: the player who doesn't control the
 * entity rolls).
 */
function enqueuePrisonerUntapBodyChecks(state: GameState): GameState {
  const activeId = state.activePlayer;
  if (!activeId) return state;
  const activeIndex = getPlayerIndex(state, activeId);
  const player = state.players[activeIndex];
  let next = state;
  for (const constraint of state.activeConstraints) {
    const kind = constraint.kind;
    if (kind.type !== 'character-is-prisoner') continue;
    if (constraint.target.kind !== 'character') continue;
    const characterId = constraint.target.characterId;
    const charInPlay = player.characters[characterId];
    if (!charInPlay) continue;
    const host = state.hazardHosts.find(h => h.hostCard.instanceId === kind.hostInstanceId);
    if (!host) continue;
    const hostDef = defById(state, host.hostCard.definitionId);
    const effect = getCardEffects(hostDef).find(
      (e): e is TakePrisonerEffect => e.type === 'take-prisoner',
    );
    if (!effect?.untapBodyCheck) continue;
    const charDef = defById(state, charInPlay.definitionId);
    const charName = charDef?.name ?? String(characterId);
    const body = charInPlay.effectiveStats.body;
    const modifier = effect.untapBodyCheck.modifier;
    logDetail(`Untap: enqueuing periodic body check for prisoner ${charName} (body ${body}${modifier ? `, modifier ${modifier}` : ''}), rolled by ${host.ownedBy as string}`);
    next = enqueueResolution(next, {
      source: host.hostCard.instanceId,
      actor: host.ownedBy,
      scope: { kind: 'phase', phase: Phase.Untap },
      kind: {
        type: 'dice-check',
        label: `Prisoner body check: ${charName}`,
        modifiers: modifier !== 0 ? [{ kind: 'constant', value: modifier }] : [],
        threshold: body,
        comparison: 'gt',
        requireTargetPresent: true,
        targetCharacterId: characterId,
        onPass: { type: 'eliminate-character', awardKillMpTo: host.ownedBy },
        continuation: { kind: 'dequeue-only' },
      },
    });
  }
  return next;
}

/**
 * Build the untap phase state.
 * Called from all entry points into the untap phase.
 */
export function enterUntapPhase(state: GameState): GameState {
  // Reset sideboardAccessedDuringUntap for all players at the start of each
  // new turn. Per CoE rule 2.I.2, the hazard limit halving only applies to
  // "this turn's" movement/hazard phases — the flag must not carry over.
  // Also clear every character's `woundedByRaceThisTurn` history (Pale
  // Dream-maker dm-78, Endless Whispers dm-54): "this turn" resets with the
  // new turn regardless of which player it belongs to.
  const players = state.players.map(p => {
    const characters = Object.fromEntries(
      Object.entries(p.characters).map(([id, c]) =>
        c.woundedByRaceThisTurn && c.woundedByRaceThisTurn.length > 0
          ? [id, { ...c, woundedByRaceThisTurn: [] }]
          : [id, c],
      ),
    );
    // Companies' faced-attack history (Orc-lieutenant tw-073's "already faced
    // an Orc attack this turn") is likewise turn-scoped.
    const companies = p.companies.map(co =>
      co.facedHazardRaces && co.facedHazardRaces.length > 0
        ? { ...co, facedHazardRaces: [] }
        : co,
    );
    return p.sideboardAccessedDuringUntap
      ? { ...p, sideboardAccessedDuringUntap: false, characters, companies }
      : { ...p, characters, companies };
  }) as unknown as typeof state.players;
  const withPhase: GameState = {
    ...state,
    players,
    phaseState: { phase: Phase.Untap, untapped: false, hazardSideboardDestination: null, hazardSideboardFetched: 0, hazardSideboardAccessed: false, resourcePlayerPassed: false, hazardPlayerPassed: false },
  };
  return enqueuePrisonerUntapBodyChecks(withPhase);
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
            // CoE rule 7.1.1: a resource player may tap other characters in
            // the same company as the checking character to apply +1 to the
            // roll each, for any corruption check that hasn't resolved yet —
            // including this untap-phase-end trigger (Lure of the Senses etc.).
            allowSupport: true,
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

  // Release followers whose current direct-influence controller cannot legally
  // hold them because of a `no-direct-influence` restriction attached outside
  // an organization phase (e.g. Rebel-talk le-132). Per CRF-22, such a follower
  // "does not need to be controlled by general influence until [its player's]
  // next organization phase" — chain-reducer.ts therefore leaves `controlledBy`
  // untouched when the restriction is attached, so the company structure stays
  // exactly as it was until now. This is that next organization phase: the
  // follower is moved to general influence (CoE 2.II.2.2.3's "moved back under
  // the control of ... general influence"), counted immediately (no further
  // deferral — this organization phase IS the resolution), and recorded so it
  // is discarded ahead of the player's own choices if the phase ends without a
  // legal reassignment (CoE 3.47 tier 2).
  {
    const ap = advanced.players[activeIndex];
    const updatedChars = { ...ap.characters };
    const restrictedReleaseIds: CardInstanceId[] = [];
    for (const controller of Object.values(ap.characters)) {
      if (controller.followers.length === 0) continue;
      const stillFollowers = controller.followers.filter(followerId => {
        const follower = ap.characters[followerId];
        if (!follower || !hasNoDirectInfluenceRestriction(follower.hazards, advanced.cardPool)) return true;
        logDetail(`Organization phase begins: ${followerId as string} can no longer be controlled by direct influence (restriction on attached hazard) — released from ${controller.instanceId as string} to general influence (CoE 2.II.2.2.3 / CRF-22)`);
        updatedChars[followerId] = { ...follower, controlledBy: 'general' };
        restrictedReleaseIds.push(followerId);
        return false;
      });
      if (stillFollowers.length !== controller.followers.length) {
        updatedChars[controller.instanceId] = { ...controller, followers: stillFollowers };
      }
    }
    if (restrictedReleaseIds.length > 0) {
      advanced = updatePlayer(advanced, activeIndex, p => ({ ...p, characters: updatedChars }));
      const priorIds = requirePhaseState(advanced, Phase.Organization).influenceRevertedCharacterIds ?? [];
      advanced = {
        ...advanced,
        phaseState: {
          ...requirePhaseState(advanced, Phase.Organization),
          influenceRevertedCharacterIds: [...priorIds, ...restrictedReleaseIds],
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

