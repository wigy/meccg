/**
 * @module combat-actions
 *
 * The post-roll combat action handlers dispatched from reducer-combat's
 * COMBAT_HANDLERS map: body checks (handleBodyCheckRoll, handleShieldDiscardRoll
 * + helpers), strike modifiers (handleSupportStrike, handleCancelStrike,
 * handlePlayStrikeEvent, handleHalveStrikes, handleProtectFromStrikeAssignment,
 * handleTapItemForStrike, handleTapAllyCombatBoost, handleModifyAttack,
 * handleAgentStrikeRoll), salvage (handleSalvageItem, finishSalvage,
 * handleDiscardItemFromCompany), trophy resolution (handleTakeTrophy,
 * finalizeCombatFromTrophyOffer), creature-to-ally conversion, and haven-join.
 * Extracted from reducer-combat.ts as the provably-closed transitive closure of
 * these handlers (call-graph fixpoint) — it calls no other reducer-combat
 * function. reducer-combat imports the handlers it dispatches one-way from here;
 * this module imports only shared leaves plus combat-strike / combat-finalize /
 * combat-hazard-play, so no cycle forms.
 *
 * Pure relocation: the logic is unchanged from its previous home.
 */

import type { GameState, CombatState, StrikeAssignment, GameAction, GameEffect, CardInstanceId, CardDefinitionId, Company } from '../index.js';
import type { PlayerState } from '../types/state-player.js';
import type { CharacterInPlay } from '../types/state-cards.js';
import { formatSignedNumber } from '../format-helpers.js';
import { getPlayerIndex } from '../state-utils.js';
import { isCharacterCard } from '../types/cards.js';
import { Alignment, CardStatus, Race } from '../types/common.js';
import type { ModifyAttackEffect, StrikeModifierEffect, HalveStrikesEffect, CombatTapCompanyBoostEffect, AllyBodyCheckBoostEffect, FleeFromStrikeEffect, CancelStrikeEffect, ProtectFromStrikeAssignmentEffect, SacrificeOfFormEffect, MultiStrikeOptionEffect } from '../types/effects.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { Phase } from '../types/state-phases.js';
import { chargeHazardLimit } from './hazard-limit.js';
import { logDetail } from './legal-actions/log.js';
import { findAllyInCompany, findItemInCompany, buildPlayedModifyAttackContext } from './legal-actions/combat.js';
import { allyEffectiveBody } from './ally-stats.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { cardName, clonePlayers, companyById, companyShadowMagicUsers, companySubphaseScope, countNazgulPermanentEventsInPlay, defById, diceRollEffect, discardOrRecyclePlayedEvent, findAttachment, findById, findCharacterCompany, getCardEffects, getOnEventEffects, partitionLeavingAllies, removeAttachment, removeById, ringwraithReclaimMark, roll2d6, rollDiceForPlayer, toCardInstance, updateAttachment, updateCharacter, updatePlayer, wrongActionType } from './reducer-utils.js';
import { evaluateExpr } from './effects/expression-eval.js';
import { resolveEnemyBody, resolveDef } from './effects/index.js';
import { buildInPlayNames } from './recompute-derived.js';
import { enqueueCorruptionCheck, addConstraint, sweepExpired, countConstraintsFromDefinition } from './pending.js';
import { initiateOrPushChain } from './chain-reducer.js';
import { getAttackSourceCard, findTakePrisonerHazard, applyTakePrisoner, applyTakePrisonerAtSite } from './combat-hazard-play.js';
import { applyRule8_22AfterTrophyDecision, recordHazardEncountered, completeCombat } from './combat-finalize.js';
import { partitionLeavingTrophies } from './trophy-dispersal.js';
import { findCapturingPressGang, capturePressGang } from './press-gang.js';
import { captureCharacterInLieuOfBodyCheck, noBetterUseAlreadyUsed } from './no-better-use.js';
import { findEliminateInsteadOfDiscardHost, consumeEliminateInsteadOfDiscardHost } from './eliminate-instead-of-discard.js';
import { pruneLeaderFollowers, nextStrikePhase, advanceStrikeOrFinalize, eliminateCombatantFromStrike } from './combat-strike.js';
import { resolveChainStrikeModifier } from './combat-cancel.js';

/**
 * Accept a pending haven-join-attack offer.
 *
 * Removes the character from their haven company and inserts them into
 * the attacked company, optionally discarding their allies, marking them
 * as a forced strike target, and scheduling post-attack side-effects.
 * The offer is consumed so it cannot be accepted twice.
 *
 * Implements the reusable side of `on-event: creature-attack-begins` +
 * `apply: offer-char-join-attack` — composable for any card with this pattern
 * (currently Alatar, tw-117).
 */
export function handleHavenJoinAttack(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'haven-join-attack') return wrongActionType(state, action, 'haven-join-attack');
  const offers = combat.havenJumpOffers ?? [];
  const offer = offers.find(o => o.characterId === action.characterId && o.bearerPlayerId === action.player);
  if (!offer) return { state, error: 'No matching haven-join offer' };

  const playerIdx = state.players.findIndex(p => p.id === action.player);
  if (playerIdx < 0) return { state, error: 'Player not found' };
  const player = state.players[playerIdx];

  const originCompany = companyById(player.companies, offer.originCompanyId);
  const targetCompany = companyById(player.companies, offer.targetCompanyId);
  if (!originCompany || !targetCompany) return { state, error: 'Company not found' };

  const charInPlay = player.characters[action.characterId];
  if (!charInPlay) return { state, error: 'Character not in play' };

  // Discard attached allies if configured
  let updatedChar = charInPlay;
  let discardedAllies: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] = [];
  if (offer.discardOwnedAllies && charInPlay.allies.length > 0) {
    discardedAllies = charInPlay.allies.map(a => (toCardInstance(a)));
    updatedChar = { ...charInPlay, allies: [] };
    logDetail(`Haven-join: discarding ${discardedAllies.length} ally card(s) attached to joiner`);
  }

  // Move character: remove from origin company, append to target company.
  const newCompanies = player.companies.map(c => {
    if (c.id === offer.originCompanyId) {
      return { ...c, characters: c.characters.filter(id => id !== action.characterId) };
    }
    if (c.id === offer.targetCompanyId) {
      return { ...c, characters: [...c.characters, action.characterId] };
    }
    return c;
  });

  const newCharacters = { ...player.characters, [action.characterId as string]: updatedChar };

  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIdx] = {
    ...player,
    companies: newCompanies,
    characters: newCharacters,
    discardPile: [...player.discardPile, ...discardedAllies],
  };

  logDetail(`Haven-join: character ${action.characterId as string} moved from company ${offer.originCompanyId as string} to attacked company ${offer.targetCompanyId as string}`);

  const newForcedTargets = offer.forceStrike
    ? [...(combat.forcedStrikeTargets ?? []), action.characterId]
    : combat.forcedStrikeTargets;
  const newPostAttack = offer.postAttackEffects.length > 0
    ? [...(combat.postAttackEffects ?? []), ...offer.postAttackEffects]
    : combat.postAttackEffects;

  // Consume this offer
  const remainingOffers = offers.filter(o => o !== offer);

  const newCombat: CombatState = {
    ...combat,
    havenJumpOffers: remainingOffers.length > 0 ? remainingOffers : undefined,
    forcedStrikeTargets: newForcedTargets && newForcedTargets.length > 0 ? newForcedTargets : undefined,
    postAttackEffects: newPostAttack && newPostAttack.length > 0 ? newPostAttack : undefined,
  };

  return { state: { ...state, players: newPlayers, combat: newCombat } };
}

/**
 * Attacker rolls 2d6 for the agent's strike (rule 3.iv.6.1).
 * The total (2d6 + agent's modified prowess) is stored as `agentRollTotal`
 * and becomes the effective prowess the defender must beat.
 */
export function handleAgentStrikeRoll(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'agent-strike-roll') return wrongActionType(state, action, 'agent-strike-roll');
  if (combat.attackSource.type !== 'agent') return { state, error: 'agent-strike-roll only valid for agent attacks' };

  const atkPlayerIndex = getPlayerIndex(state, combat.attackingPlayerId);
  const atkPlayer = state.players[atkPlayerIndex];

  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  const agentRollTotal = rollTotal + combat.strikeProwess;

  // Resolve agent name for the log label
  const agentDefId = resolveInstanceId(state, combat.attackSource.instanceId);
  const agentName = agentDefId ? cardName(state, agentDefId, 'Agent') : 'Agent';

  logDetail(`Agent strike roll: ${agentName} rolls ${roll.die1}+${roll.die2}=${rollTotal} + prowess ${combat.strikeProwess} = ${agentRollTotal}`);

  const effect = diceRollEffect(atkPlayer.name, roll, `Agent Strike: ${agentName}`);

  return {
    state: { ...state, rng, cheatRollTotal, combat: { ...combat, agentRollTotal } },
    effects: [effect],
  };
}

/** Tap a supporting character for +1 prowess on the current strike. */
export function handleSupportStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'support-strike') return wrongActionType(state, action, 'support-strike');

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];

  // Bump the supportCount on the current strike so the +1 modifier is
  // visible to the legal-action computer (updates the displayed "need")
  // and applied by `resolveStrikeCore` when the dice are actually rolled.
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? { ...a, supportCount: (a.supportCount ?? 0) + 1 }
      : a,
  );
  const newSupportCount = (currentStrike?.supportCount ?? 0) + 1;
  const newCombat: CombatState = { ...combat, strikeAssignments: newAssignments };

  // Check if supporter is a character
  const supporterChar = defPlayer.characters[action.supportingCharacterId];
  if (supporterChar) {
    const nextState = updatePlayer(state, defPlayerIndex, p =>
      updateCharacter(p, action.supportingCharacterId, c => ({ ...c, status: CardStatus.Tapped })),
    );
    logDetail(`${action.supportingCharacterId as string} taps to support — +1 prowess (total support: +${newSupportCount})`);
    return { state: { ...nextState, combat: newCombat } };
  }

  // Check if supporter is an ally
  const tappedAlly = updateAttachment(defPlayer, 'allies', action.supportingCharacterId, a => ({ ...a, status: CardStatus.Tapped }));
  if (tappedAlly) {
    const nextState = updatePlayer(state, defPlayerIndex, () => tappedAlly.player);
    logDetail(`Ally ${action.supportingCharacterId as string} taps to support — +1 prowess (total support: +${newSupportCount})`);
    return { state: { ...nextState, combat: newCombat } };
  }

  return { state, error: 'Supporting character or ally not found' };
}

/**
 * Cancel the current strike by having another character in the company
 * tap. The strike is marked resolved with result 'canceled' and combat
 * advances to the next strike or finalizes.
 */
export function handleCancelStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-strike') return wrongActionType(state, action, 'cancel-strike');

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];

  const cancellerChar = defPlayer.characters[action.cancellerInstanceId];
  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];

  let nextState: GameState;
  if (cancellerChar) {
    const cancellerName = cardName(state, cancellerChar.definitionId, action.cancellerInstanceId as string);
    logDetail(`${cancellerName} taps to cancel strike against ${currentStrike.characterId as string}`);

    nextState = updatePlayer(state, defPlayerIndex, p =>
      updateCharacter(p, action.cancellerInstanceId, c => ({ ...c, status: CardStatus.Tapped })),
    );
  } else {
    // The canceller is an item or ally attached to the struck character. Locate
    // it so its cancel-strike cost variant can be inspected before paying.
    const located = findAttachment(defPlayer, 'items', action.cancellerInstanceId)
      ?? findAttachment(defPlayer, 'allies', action.cancellerInstanceId);
    if (!located) {
      return { state, error: 'Canceller not found as character, item, or ally' };
    }
    const cancellerLabel = cardName(state, located.attachment.definitionId);
    const cancelEffect = getCardEffects(defById(state, located.attachment.definitionId))
      .find((e): e is CancelStrikeEffect => e.type === 'cancel-strike');

    if (cancelEffect?.cost?.check === 'corruption') {
      // The One Ring (tw-347): instead of tapping, the bearer makes a corruption
      // check (modified by the effect's `cost.modifier`, e.g. -2) to cancel the
      // strike. The strike is canceled regardless of the check's outcome — the
      // check is the cost/risk, not a condition. The check surfaces as a pending
      // resolution (combat yields to it before further combat actions; see
      // computeLegalActions' combat/pending ordering).
      const modifier = cancelEffect.cost.modifier ?? 0;
      logDetail(`${cancellerLabel}: bearer ${located.charId as string} makes a corruption check (${formatSignedNumber(modifier)}) to cancel strike against ${currentStrike.characterId as string}`);
      nextState = enqueueCorruptionCheck(state, {
        source: action.cancellerInstanceId,
        actor: action.player,
        scope: companySubphaseScope(state.phaseState.phase, combat.companyId),
        characterId: located.charId,
        reason: cancellerLabel,
        modifier,
      });
    } else {
      // Tap the item/ally to pay the cancel cost (e.g. Enruned Shield taps to
      // cancel a strike against its Warrior bearer, or Noble Steed taps to
      // cancel a non-auto-attack strike against its bearer).
      const tap = <A extends { status: CardStatus }>(a: A): A => ({ ...a, status: CardStatus.Tapped });
      const tapped = updateAttachment(defPlayer, 'items', action.cancellerInstanceId, tap)
        ?? updateAttachment(defPlayer, 'allies', action.cancellerInstanceId, tap);
      if (!tapped) {
        return { state, error: 'Canceller not found as character, item, or ally' };
      }
      logDetail(`${cancellerLabel} taps to cancel strike against ${currentStrike.characterId as string}`);
      nextState = updatePlayer(state, defPlayerIndex, () => tapped.player);
    }
  }

  const newAssignments = [...combat.strikeAssignments];
  newAssignments[combat.currentStrikeIndex] = { ...currentStrike, resolved: true, result: 'canceled' };

  const combatWithAssignments = { ...combat, strikeAssignments: newAssignments };
  return advanceStrikeOrFinalize(nextState, combatWithAssignments);
}

/**
 * Tap an in-play item (or ally) to resolve the current strike against its own
 * bearer in dodge mode — full prowess, the strike still rolls normally, but
 * the bearer doesn't tap unless the strike wounds him (CoE 3.iv.3 territory,
 * paid by tapping the item instead of the usual -3 prowess penalty). Used by
 * Great-shield of Rohan (tw-250): "Warrior only: tap Great Shield of Rohan to
 * remain untapped against one strike (unless the bearer is wounded by the
 * strike)." Reuses `resolveChainStrikeModifier`'s dodge path, matching the
 * item-tap `cancel-strike` precedent of resolving immediately with no chain.
 */
export function handleDodgeStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'dodge-strike') return wrongActionType(state, action, 'dodge-strike');

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return { state, error: 'No active unresolved strike' };
  if (currentStrike.characterId !== action.characterInstanceId) return { state, error: 'Item bearer is not the current strike target' };

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  if (!defPlayer.characters[action.characterInstanceId]) return { state, error: 'Character not found' };

  const found = findAttachment(defPlayer, 'items', action.cardInstanceId)
    ?? findAttachment(defPlayer, 'allies', action.cardInstanceId);
  if (!found || found.charId !== action.characterInstanceId) return { state, error: 'Item not found on character' };
  if (found.attachment.status !== CardStatus.Untapped) return { state, error: 'Item must be untapped to activate' };

  const itemDef = defById(state, found.attachment.definitionId);
  const strikeEffect = getCardEffects(itemDef).find(
    (e): e is StrikeModifierEffect => e.type === 'strike-modifier' && e.dodge === true && e.cost?.tap === 'self',
  );
  if (!strikeEffect) return { state, error: 'Item has no dodge strike-modifier effect' };

  const itemName = (itemDef as { name?: string } | undefined)?.name ?? (found.attachment.definitionId as string);
  logDetail(`${itemName} taps so ${action.characterInstanceId as string} dodges the current strike (no tap unless wounded)`);

  const tap = <A extends { status: CardStatus }>(a: A): A => ({ ...a, status: CardStatus.Tapped });
  const tapped = updateAttachment(defPlayer, 'items', action.cardInstanceId, tap)
    ?? updateAttachment(defPlayer, 'allies', action.cardInstanceId, tap);
  if (!tapped) return { state, error: 'Item not found on character' };

  const nextState = updatePlayer(state, defPlayerIndex, () => tapped.player);
  return resolveChainStrikeModifier(nextState, strikeEffect);
}

/**
 * Fled into Darkness (ba-18): the defending player plays a `flee-from-strike`
 * permanent-event from hand during resolve-strike to make the named character
 * (The Balrog) flee the current strike. The strike is canceled, the character
 * taps if untapped, the card enters play attached to the character, and a
 * one-shot `skip-next-untap` constraint is installed so the character stays
 * tapped through his next untap phase (at which point this card is discarded).
 */
export function handleFleeFromStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'flee-from-strike') return wrongActionType(state, action, 'flee-from-strike');

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const handCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Flee-from-strike card not found in hand' };
  const cardDef = defById(state, handCard.definitionId);
  const effect = getCardEffects(cardDef).find(
    (e): e is FleeFromStrikeEffect => e.type === 'flee-from-strike',
  );
  if (!effect) return { state, error: 'Card has no flee-from-strike effect' };

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return { state, error: 'No current unresolved strike' };
  const targetCharId = currentStrike.characterId;
  const targetChar = defPlayer.characters[targetCharId];
  if (!targetChar) return { state, error: 'Struck character not found for flee-from-strike' };

  const cardLabel = cardName(state, handCard.definitionId);
  logDetail(`${cardLabel}: ${effect.characterName} flees the strike — strike canceled, character taps (if untapped), skip-next-untap installed`);

  // Remove the card from hand, place it into play attached to the character, and
  // tap the character if untapped.
  let nextState = updatePlayer(state, defPlayerIndex, p => {
    const withoutCard = removeById(p.hand, handCard.instanceId);
    const withInPlay = {
      ...p,
      hand: withoutCard,
      cardsInPlay: [
        ...p.cardsInPlay,
        {
          instanceId: handCard.instanceId,
          definitionId: handCard.definitionId,
          status: CardStatus.Untapped,
          attachedTo: targetCharId,
        },
      ],
    };
    const char = withInPlay.characters[targetCharId];
    if (!char || char.status !== CardStatus.Untapped) return withInPlay;
    return updateCharacter(withInPlay, targetCharId, c => ({ ...c, status: CardStatus.Tapped }));
  });

  // Install the one-shot skip-next-untap constraint on the character.
  nextState = addConstraint(nextState, {
    source: handCard.instanceId,
    sourceDefinitionId: handCard.definitionId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'character', characterId: targetCharId },
    kind: { type: 'skip-next-untap', cardInstanceId: handCard.instanceId },
  });

  // Cancel the current strike and advance combat.
  const newAssignments = [...combat.strikeAssignments];
  newAssignments[combat.currentStrikeIndex] = { ...currentStrike, resolved: true, result: 'canceled' };
  const combatWithAssignments = { ...combat, strikeAssignments: newAssignments };
  return advanceStrikeOrFinalize(nextState, combatWithAssignments);
}

/**
 * Sacrifice of Form (tw-321): play from hand after strikes are assigned
 * against the Wizard's company. Sets `forcedStrikeDefeat` (every remaining
 * strike of this attack automatically resolves as defeated — the same
 * mechanism Liquid Fire wh-52 uses) with `forcedDefeatBodyCheckModifier`
 * raised by +3, and records `pendingSacrificeOfForm` so the deferred sweep
 * (`sacrifice-of-form.ts`) discards the Wizard and sets his items aside once
 * the whole attack has finished resolving — not immediately, so his
 * `CharacterInPlay` data stays available for any remaining strikes of this
 * attack still assigned to him.
 */
export function handleSacrificeOfForm(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'play-sacrifice-of-form') return wrongActionType(state, action, 'play-sacrifice-of-form');

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const handCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Sacrifice of Form card not found in hand' };
  const cardDef = defById(state, handCard.definitionId);
  const effect = getCardEffects(cardDef).find((e): e is SacrificeOfFormEffect => e.type === 'sacrifice-of-form');
  if (!effect) return { state, error: 'Card has no sacrifice-of-form effect' };

  const wizardId = action.characterInstanceId;
  if (!defPlayer.characters[wizardId]) return { state, error: 'Wizard not found in play' };
  if (combat.attackSource.type === 'company-attack') {
    return { state, error: 'Sacrifice of Form cannot be used in company-vs-company combat' };
  }
  if (combat.strikeAssignments.length === 0 || combat.strikeAssignments.some(a => a.resolved)) {
    return { state, error: 'Sacrifice of Form must be played after strikes are assigned, before any strike resolves' };
  }
  if (defPlayer.cardsInPlay.some(c => c.sacrificeOfFormCharacterInstanceId === wizardId)) {
    return { state, error: 'Sacrifice of Form cannot be duplicated on a given Wizard' };
  }

  const cardLabel = cardName(state, handCard.definitionId);
  logDetail(`${cardLabel}: played after strikes assigned — all strikes of this attack fail (+3 to any creature body checks); ${wizardId as string} will be discarded (items set aside) once the attack resolves`);

  const nextState = updatePlayer(state, defPlayerIndex, p => ({
    ...p,
    hand: removeById(p.hand, handCard.instanceId),
    cardsInPlay: [
      ...p.cardsInPlay,
      {
        instanceId: handCard.instanceId,
        definitionId: handCard.definitionId,
        status: CardStatus.Untapped,
        sacrificeOfFormCharacterInstanceId: wizardId,
      },
    ],
  }));

  const newCombat: CombatState = {
    ...combat,
    forcedStrikeDefeat: true,
    forcedDefeatBodyCheckModifier: (combat.forcedDefeatBodyCheckModifier ?? 0) + 3,
    pendingSacrificeOfForm: { hostInstanceId: handCard.instanceId, characterInstanceId: wizardId },
  };

  return { state: { ...nextState, combat: newCombat } };
}

/**
 * Play a `strike-modifier` short event from hand during resolve-strike.
 * Covers four resolution modes driven by the card's effect flags:
 *
 * - **cancel** (`effect.cancel`): moves the card to discard and immediately
 *   calls `resolveChainStrikeModifier` in cancel mode — the strike is
 *   canceled outright, no roll, no chain.
 * - **dodge** (`effect.dodge`): moves the card to discard, initiates a chain
 *   (opponent may respond), and on resolution calls `resolveChainStrikeModifier`
 *   in dodge mode — the character resolves without tapping.
 * - **reroll** (`effect.reroll`): moves the card to discard and immediately
 *   calls `resolveChainStrikeModifier` in reroll mode — two rolls, better wins.
 * - **default**: accumulates prowess/body bonuses on the current strike assignment
 *   immediately. `requiredSkillEventPlayed` is set at declaration time (CoE 3.iv.5).
 */
export function handlePlayStrikeEvent(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'play-strike-event') return { state, error: 'Expected play-strike-event' };

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const handCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Card not found in hand' };
  const cardDef = defById(state, handCard.definitionId);
  const effects = (cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects ?? [];
  const strikeEffect = effects.find((e): e is StrikeModifierEffect => e.type === 'strike-modifier');
  if (!strikeEffect) return { state, error: 'Card has no strike-modifier effect' };

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (strikeEffect.requiredSkill && currentStrike?.requiredSkillEventPlayed) {
    return { state, error: 'Only one resource that requires a skill may be played per strike (CoE 3.iv.5)' };
  }

  const cardLabel = cardName(state, handCard.definitionId);
  logDetail(`Playing strike event ${cardLabel} (mode: ${strikeEffect.cancel ? 'cancel' : strikeEffect.dodge ? 'dodge' : strikeEffect.reroll ? 'reroll' : 'modify'})`);

  let resultState = updatePlayer(state, defPlayerIndex, p => ({
    ...p,
    hand: removeById(p.hand, handCard.instanceId),
    discardPile: [...p.discardPile, toCardInstance(handCard)],
  }));

  if (strikeEffect.cancel) {
    // Cancel mode: resolves immediately, no chain (matches item-based
    // cancel-strike and flee-from-strike — no opponent response window).
    return resolveChainStrikeModifier(resultState, strikeEffect);
  }

  if (strikeEffect.dodge) {
    // Dodge mode: initiate chain so opponent may respond; resolution applies the dodge effect.
    // Set requiredSkillEventPlayed at declaration time (CoE 3.iv.5), same as default mode.
    if (strikeEffect.requiredSkill) {
      const newAssignments = combat.strikeAssignments.map((a, i) =>
        i === combat.currentStrikeIndex ? { ...a, requiredSkillEventPlayed: true } : a,
      );
      resultState = { ...resultState, combat: { ...combat, strikeAssignments: newAssignments } };
    }
    const payload: import('../index.js').ChainEntryPayload = { type: 'short-event' };
    resultState = initiateOrPushChain(resultState, action.player, handCard, payload);
    return { state: resultState };
  }

  if (strikeEffect.reroll) {
    // Reroll mode: resolve immediately — two rolls, better result used. The
    // defender's independent tap/stay-untapped choice (CoE 3.iv.3) survives
    // as action.tapToFight — a reroll card's text says nothing about tapping,
    // so it must not force one outcome over the other.
    return resolveChainStrikeModifier(resultState, strikeEffect, action.tapToFight);
  }

  // Default mode: accumulate prowess/body bonuses on the current strike.
  // Set requiredSkillEventPlayed at declaration time (CoE 3.iv.5).
  if (strikeEffect.requiredSkill) {
    const newAssignments = combat.strikeAssignments.map((a, i) =>
      i === combat.currentStrikeIndex ? { ...a, requiredSkillEventPlayed: true } : a,
    );
    resultState = { ...resultState, combat: { ...combat, strikeAssignments: newAssignments } };
  }
  return resolveChainStrikeModifier(resultState, strikeEffect);
}

/** Roll body check — attacker rolls 2d6 vs body value. */
/**
 * Sums `body-check-modifier` effect values from all items attached to the
 * character being body-checked (CoE rule 2.V.2.2). A negative total lowers
 * the effective roll, protecting the bearer. Backs Helm of Fear (as-126):
 * "All body checks against the bearer are modified by -1." Returns 0 when no
 * such item is attached.
 */
function bodyCheckRollModifier(state: GameState, charData: CharacterInPlay): number {
  const charDef = defById(state, charData.definitionId);
  const bearerRace = isCharacterCard(charDef) ? charDef.race : undefined;
  let total = 0;
  for (const item of charData.items) {
    const itemDef = defById(state, item.definitionId);
    if (!itemDef) continue;
    for (const effect of getCardEffects(itemDef)) {
      if (effect.type !== 'body-check-modifier') continue;
      if (effect.scope === 'all-attacks') continue; // global modifiers are collected separately
      if (effect.when && !matchesCondition(effect.when, { bearer: { race: bearerRace } })) continue;
      logDetail(`Body-check modifier ${formatSignedNumber(effect.value)} from ${(itemDef as { name?: string }).name ?? (item.definitionId as string)}`);
      total += effect.value;
    }
  }
  return total;
}

/**
 * Sums `scope: 'all-attacks'` `body-check-modifier` effects carried by any
 * in-play permanent-event (either player's `cardsInPlay`). Unlike the
 * item-attached modifier, these are global to combat and gated by `when`
 * against a context exposing `attack.creatureRace` (the attacking creature's
 * normalized race) and `target.race` (the body-checked character's race).
 * Backs Spawn of Ungoliant (ba-24): "+1 to all body checks for Elves,
 * Dwarves, Hobbits, Dúnedain, and Men resulting from Spider attacks." Returns
 * 0 when no such permanent-event is in play or none matches.
 */
function globalBodyCheckRollModifier(state: GameState, targetRace: Race | undefined, creatureRace: Race | undefined): number {
  let total = 0;
  const ctx = { attack: { creatureRace }, target: { race: targetRace } };
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = defById(state, card.definitionId);
      if (!def) continue;
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'body-check-modifier') continue;
        if (effect.scope !== 'all-attacks') continue;
        if (effect.when && !matchesCondition(effect.when, ctx)) continue;
        logDetail(`Global body-check modifier ${formatSignedNumber(effect.value)} from ${(def as { name?: string }).name ?? (card.definitionId as string)} (attack race ${creatureRace ?? '?'}, target race ${targetRace ?? '?'})`);
        total += effect.value;
      }
    }
  }
  return total;
}

/**
 * Sums `scope: 'bearer-combat'` `body-check-modifier` effects carried by an
 * item / attached permanent-event on the character *participating* in the
 * current body check, gated by `when` against a context describing the check.
 *
 * The relevant bearer depends on `combat.bodyCheckTarget`:
 * - `'creature'` / `'attacker-character'` — a strike against the defending
 *   character failed (was parried); the striker now body-checks. The bearer is
 *   the parrying **defender** (`strike.characterId`).
 * - `'character'` — the strike succeeded and the struck character body-checks.
 *   The bearer is the **successful striker**: in CvCC the attacking character
 *   (`strike.attackingCharacterId`); a hazard-creature striker bears nothing.
 *
 * Backs Flame of Udûn (ba-58): "+1 to all body checks resulting from failed
 * strikes against The Balrog" (`when: { bodyCheck.fromFailedStrike: true }`) and
 * "+1 to defending character's body check" when The Balrog attacks successfully
 * in CvCC (`when: { bodyCheck.target: 'character', combat.isCvCC: true }`).
 * Returns 0 when no participating bearer carries a matching effect.
 */
function bearerCombatBodyCheckModifier(state: GameState, combat: CombatState, strike: StrikeAssignment | undefined): number {
  if (!strike) return 0;
  const target = combat.bodyCheckTarget;
  const fromFailedStrike = target === 'creature' || target === 'attacker-character';

  let bearerCharId: CardInstanceId | undefined;
  let bearerPlayerId = combat.defendingPlayerId;
  if (fromFailedStrike) {
    // The defending character parried; the striker body-checks. Bearer = defender.
    bearerCharId = strike.characterId;
    bearerPlayerId = combat.defendingPlayerId;
  } else if (target === 'character' && combat.isCvCC && strike.attackingCharacterId) {
    // CvCC: the attacking character struck successfully. Bearer = the attacker.
    bearerCharId = strike.attackingCharacterId;
    bearerPlayerId = combat.attackingPlayerId;
  }
  if (!bearerCharId) return 0;

  const bearer = state.players[getPlayerIndex(state, bearerPlayerId)]?.characters[bearerCharId];
  if (!bearer) return 0;

  const ctx = {
    bodyCheck: { target, fromFailedStrike },
    combat: { isCvCC: !!combat.isCvCC },
  };
  let total = 0;
  for (const item of bearer.items) {
    const itemDef = defById(state, item.definitionId);
    if (!itemDef) continue;
    for (const effect of getCardEffects(itemDef)) {
      if (effect.type !== 'body-check-modifier') continue;
      if (effect.scope !== 'bearer-combat') continue;
      if (effect.when && !matchesCondition(effect.when, ctx)) continue;
      logDetail(`Bearer-combat body-check modifier ${formatSignedNumber(effect.value)} from ${(itemDef as { name?: string }).name ?? (item.definitionId as string)} (target ${target ?? '?'}, failedStrike ${fromFailedStrike}, cvcc ${!!combat.isCvCC})`);
      total += effect.value;
    }
  }
  return total;
}

/**
 * Discard a character defeated by a body check: mark its strike eliminated
 * (auto-resolving its other unresolved strikes, CoE 3.i.5), remove it from
 * its company, move it plus its allies/items to the defender's discard and
 * its hazards to the hazard player's discard, revert its followers to general
 * influence, and advance to the next strike (or finalize). Shared by the
 * `discardBodyCheck` (roll matches) and `character-body-check-equals-body`
 * (roll equals body) paths.
 */
function discardCharacterAfterBodyCheck(
  stateWithRoll: GameState,
  state: GameState,
  combat: CombatState,
  strike: StrikeAssignment,
  charData: CharacterInPlay,
  defPlayer: PlayerState,
  defPlayerIndex: number,
  company: Company | undefined,
  effects: GameEffect[],
): ReducerResult {
  const assignments = combat.strikeAssignments.map((a, i) => {
    if (i === combat.currentStrikeIndex) return { ...a, resolved: true, result: 'eliminated' as const };
    if (!a.resolved && a.characterId === strike.characterId) {
      logDetail(`Strike ${i} auto-resolved (discarded combatant, CoE 3.i.5)`);
      return { ...a, resolved: true, result: 'success' as const };
    }
    return a;
  });
  const combatWithDiscard = { ...combat, strikeAssignments: assignments };

  // Press-gang (ba-22): a character discarded by a body check is instead held
  // off to the side by the attacking (opponent's) Press-gang. The combat state
  // advances exactly as for a discard; only the character's disposition changes.
  const pressHost = findCapturingPressGang(stateWithRoll, defPlayerIndex);
  if (pressHost) {
    const captured = capturePressGang(stateWithRoll, defPlayerIndex, strike.characterId, pressHost);
    return advanceStrikeOrFinalize(captured, combatWithDiscard, effects);
  }

  // Pallando the Soul-keeper (as-17): a character that would be discarded from
  // play is instead *eliminated* — the character card goes to its owner's
  // out-of-play pile. Everything else about the removal is unchanged, so this
  // only redirects the character card's destination.
  const elimHost = findEliminateInsteadOfDiscardHost(stateWithRoll, defById(state, charData.definitionId));

  const newPlayers = clonePlayers(stateWithRoll);
  const newPlayerData = { ...defPlayer };
  if (company) {
    newPlayerData.companies = newPlayerData.companies.map(c =>
      c.id === combat.companyId
        ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
        : c,
    );
  }
  const discardedCharDefId = resolveInstanceId(state, strike.characterId);
  const removedCharCard = { instanceId: strike.characterId, definitionId: discardedCharDefId! };
  if (elimHost) {
    newPlayerData.outOfPlayPile = [...newPlayerData.outOfPlayPile, removedCharCard];
  } else {
    newPlayerData.discardPile = [...newPlayerData.discardPile, removedCharCard];
  }
  // An ally that returns to hand when its controller leaves play (Radagast's
  // Black Bird wh-114) is preserved to the owner's hand; the rest are discarded.
  {
    const { toHand, toDiscard } = partitionLeavingAllies(state, charData.allies);
    if (toHand.length > 0) logDetail(`${toHand.length} ally(ies) return to hand from discarded character`);
    newPlayerData.hand = [...newPlayerData.hand, ...toHand];
    newPlayerData.discardPile = [...newPlayerData.discardPile, ...toDiscard];
  }
  for (const item of charData.items) {
    logDetail(`Discarding item ${item.instanceId as string} from discarded character`);
    newPlayerData.discardPile = [...newPlayerData.discardPile, toCardInstance(item)];
  }
  let hazardDiscard = [...newPlayers[1 - defPlayerIndex].discardPile];
  for (const hazard of charData.hazards) {
    logDetail(`Discarding hazard ${hazard.instanceId as string} from discarded character`);
    hazardDiscard = [...hazardDiscard, toCardInstance(hazard)];
  }
  newPlayers[1 - defPlayerIndex] = { ...newPlayers[1 - defPlayerIndex], discardPile: hazardDiscard };
  // Relocate trophies per CoE 3.IV.4 — worth MP → the holder's marshalling-
  // point pile, otherwise removed from play — or the creature CardInstance
  // would vanish with the deleted character.
  {
    const { toKillPile, toOutOfPlay } = partitionLeavingTrophies(state, charData, 'discarded character');
    newPlayerData.killPile = [...newPlayerData.killPile, ...toKillPile];
    newPlayerData.outOfPlayPile = [...newPlayerData.outOfPlayPile, ...toOutOfPlay];
  }
  const { [strike.characterId]: _removed, ...remainingChars } = newPlayerData.characters;
  const updatedChars = { ...remainingChars };
  for (const followerId of charData.followers) {
    const follower = updatedChars[followerId];
    // Combat never happens during the controlling player's organization
    // phase, so the follower's mind subtraction from general influence is
    // deferred to that player's next organization phase (CoE rule 3.13).
    if (follower) updatedChars[followerId] = { ...follower, controlledBy: 'general', influenceUnsubtracted: true, ...ringwraithReclaimMark(stateWithRoll, follower) };
  }
  newPlayerData.characters = pruneLeaderFollowers(updatedChars, strike.characterId, charData.controlledBy);
  newPlayers[defPlayerIndex] = newPlayerData;
  let afterRemoval: GameState = { ...stateWithRoll, players: newPlayers };
  if (elimHost) afterRemoval = consumeEliminateInsteadOfDiscardHost(afterRemoval, elimHost);
  return advanceStrikeOrFinalize(afterRemoval, combatWithDiscard, effects);
}

/**
 * Remove an agent whose (only) strike was defeated and whose body check
 * failed (CoE 3.v — Agent Hazard Attacks). The agent card leaves the board:
 * a defending hero or Fallen-Wizard player claims it as kill marshalling
 * points (their kill pile); a Ringwraith or Balrog player instead removes it
 * from play (the agent owner's out-of-play pile). The agent's site stack is
 * returned to its owner's site deck so no card instance is lost.
 */
function removeDefeatedAgent(state: GameState, combat: CombatState, agentInstId: CardInstanceId): GameState {
  const ownerIdx = getPlayerIndex(state, combat.attackingPlayerId);
  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const agent = state.players[ownerIdx].agents.find(a => a.character.instanceId === agentInstId);
  if (!agent) return state;
  const agentCard = toCardInstance(agent.character);
  // "Hero" players are Wizard-aligned; Fallen-Wizard players may also claim
  // agents as kill MPs. Ringwraith/Balrog players cannot.
  const defenderClaimsMP =
    state.players[defIdx].alignment === Alignment.Wizard ||
    state.players[defIdx].alignment === Alignment.FallenWizard;
  let next = updatePlayer(state, ownerIdx, p => ({
    ...p,
    agents: p.agents.filter(a => a.character.instanceId !== agentInstId),
    siteDeck: [...p.siteDeck, ...agent.siteStack],
  }));
  if (defenderClaimsMP) {
    next = updatePlayer(next, defIdx, p => ({ ...p, killPile: [...p.killPile, agentCard] }));
    logDetail(`Agent ${agentInstId as string} defeated — placed in defender's kill pile for kill MPs (CoE 3.v)`);
  } else {
    next = updatePlayer(next, ownerIdx, p => ({ ...p, outOfPlayPile: [...p.outOfPlayPile, agentCard] }));
    logDetail(`Agent ${agentInstId as string} defeated — removed from play (CoE 3.v)`);
  }
  return next;
}

export function handleBodyCheckRoll(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'body-check-roll') return wrongActionType(state, action, 'body-check-roll');

  const atkPlayerIndex = getPlayerIndex(state, combat.attackingPlayerId);
  // The roll (and its lastDiceRoll) is recorded on the attacking player.
  const { roll, total: rollTotal, rollEffect, state: stateWithRoll } = rollDiceForPlayer(state, atkPlayerIndex, `Body check: ${combat.bodyCheckTarget}`);
  const roller = combat.bodyCheckTarget === 'attacker-character' || combat.bodyCheckTarget === 'creature'
    ? combat.defendingPlayerId
    : combat.attackingPlayerId;
  logDetail(`Body check roll: target=${combat.bodyCheckTarget} roller=${roller as string} roll=${roll.die1}+${roll.die2}=${rollTotal} (lastDiceRoll stored on attacker ${combat.attackingPlayerId as string})`);
  const effects: GameEffect[] = [rollEffect];
  // Broadcast the body-check outcome as a text notification so the result is
  // recorded in every client's text log. The dice-roll effect above only
  // carries the raw roll; clients otherwise derive the wounded/eliminated
  // outcome by diffing the combat state, which is impossible once this body
  // check finalizes combat (`view.combat` becomes null). Emitting the outcome
  // from the engine makes it visible regardless of whether combat continues.
  const noteOutcome = (message: string): void => {
    effects.push({ effect: 'text-notification', message });
  };

  if (combat.bodyCheckTarget === 'creature') {
    // Body check against creature — apply enemy-modifier effects (e.g. Éowyn halves Nazgûl body)
    let body = combat.creatureBody ?? 0;
    const strike2 = combat.strikeAssignments[combat.currentStrikeIndex];
    // Per-strike creature body modifier (Arrows Shorn of Ebony td-99: "-2
    // body") — applies only to this strike's own creature body check, unlike
    // a whole-attack `modify-attack`'s persistent `CombatState.creatureBody` change.
    if (strike2?.strikeCreatureBodyModifier) {
      const modified = body + strike2.strikeCreatureBodyModifier;
      logDetail(`Strike-scoped creature body modifier: ${body} ${formatSignedNumber(strike2.strikeCreatureBodyModifier)} = ${modified}`);
      body = modified;
    }
    if (strike2 && combat.creatureRace) {
      const defIdx2 = getPlayerIndex(stateWithRoll, combat.defendingPlayerId);
      const charData2 = stateWithRoll.players[defIdx2].characters[strike2.characterId];
      if (charData2) {
        const inPlayNames2 = buildInPlayNames(stateWithRoll);
        const enemy2 = { race: combat.creatureRace, name: '', prowess: combat.strikeProwess, body: combat.creatureBody };
        // Mechanical Bow (wh-53): "-1 to the body of any strike its bearer faces
        // if he taps to face the strike." The recorded `strikeMode` gates the
        // bearer's `enemy-modifier` body reduction on `combat.strikeMode: tap`.
        const modifiedBody = resolveEnemyBody(stateWithRoll, charData2, enemy2, body, inPlayNames2, strike2.strikeMode);
        if (modifiedBody !== body) {
          logDetail(`Enemy body modified by character effects: ${body} → ${modifiedBody}`);
          body = modifiedBody;
        }
      }
    }
    // Biter and Beater! (as-46): "lower the body of strikes their bearers
    // face by 1" — a short-event counterpart to an item's `enemy-modifier`,
    // reaching the bearer without requiring the bonus to live on a borne item.
    // One `character-creature-body-modifier` constraint per matching weapon
    // (see `handlePlayResourceShortEvent`'s `company-combat-boost` block).
    if (strike2) {
      const creatureBodyMods = stateWithRoll.activeConstraints.filter(
        c => c.kind.type === 'character-creature-body-modifier' && c.kind.characterId === strike2.characterId,
      );
      for (const mod of creatureBodyMods) {
        if (mod.kind.type !== 'character-creature-body-modifier') continue;
        const reduced = Math.max(0, body - mod.kind.value);
        if (reduced !== body) {
          logDetail(`Creature body modified by character-creature-body-modifier constraint: ${body} → ${reduced}`);
          body = reduced;
        }
      }
    }
    // Agent hazard attacks (CoE 3.v): when a character defeats an agent's
    // strike, the agent is *wounded* and must make a body check — unlike an
    // ordinary hazard creature, which is never wounded and simply survives or
    // is defeated. The body check gets a +1 modifier if the agent was already
    // wounded before this strike (CoE 3.I.1). A failed body check defeats the
    // strike and removes the agent; a passed body check leaves the agent in
    // play but wounded.
    const isAgent = combat.attackSource.type === 'agent';
    const agentInstId = isAgent ? combat.attackSource.instanceId : null;
    const agentBefore = agentInstId
      ? stateWithRoll.players[getPlayerIndex(stateWithRoll, combat.attackingPlayerId)]
          .agents.find(a => a.character.instanceId === agentInstId)
      : undefined;
    const agentAlreadyWounded = agentBefore?.character.status === CardStatus.Inverted;
    const woundedBonus = agentAlreadyWounded ? 1 : 0;
    // bearer-combat body-check modifier (Flame of Udûn ba-58): a failed strike
    // against the parrying character raises the striker's body check.
    const bearerMod = bearerCombatBodyCheckModifier(stateWithRoll, combat, strike2);
    // Liquid Fire (wh-52): "resulting body checks for the creature are
    // modified by -2" — applies to every creature body check this
    // forced-defeat attack produces (see `forcedStrikeDefeat` in combat-strike.ts).
    const forcedMod = combat.forcedDefeatBodyCheckModifier ?? 0;
    const effectiveRoll = rollTotal + woundedBonus + bearerMod + forcedMod;
    const entityLabel = isAgent ? 'agent' : 'creature';
    logDetail(`Body check vs ${entityLabel}: roll ${rollTotal}${woundedBonus ? '+1(wounded)' : ''}${bearerMod ? `${formatSignedNumber(bearerMod)}(bearer)` : ''}${forcedMod ? `${formatSignedNumber(forcedMod)}(Liquid Fire)` : ''} = ${effectiveRoll} vs body ${body}`);
    // CoE 3.iv.7: the strike is defeated only if the body check FAILS (roll >
    // body). If the body check passes, the strike was not defeated and the
    // creature/agent survives. Record 'survived' (vs the parry's 'success') so
    // finalizeCombat does not count this strike toward defeating the entity.
    let combatAfterBodyCheck = combat;
    let stateAfterOutcome = stateWithRoll;
    if (effectiveRoll > body) {
      logDetail(`${isAgent ? 'Agent' : 'Creature'} body check failed — strike defeated`);
      noteOutcome(`Body check failed — strike defeated (rolled ${effectiveRoll} vs body ${body})`);
      if (isAgent) {
        // Strike defeated: with a single strike this defeats the agent, which
        // is removed from play — or claimed as kill MPs by a defending hero /
        // Fallen-Wizard player (CoE 3.v).
        stateAfterOutcome = removeDefeatedAgent(stateWithRoll, combat, agentInstId!);
      }
      // Arrows Shorn of Ebony (td-99): this strike carries cascadesOnDefeat
      // and is now confirmed defeated (creature body check failed too) —
      // every other still-unresolved strike of the attack auto-defeats.
      if (strike2?.cascadesOnDefeat) {
        logDetail('Cascade defeat (Arrows Shorn of Ebony): remaining strikes of this attack automatically defeated');
        combatAfterBodyCheck = { ...combatAfterBodyCheck, forcedStrikeDefeat: true };
      }
    } else {
      logDetail(`${isAgent ? 'Agent' : 'Creature'} body check passed — ${isAgent ? 'agent survives (wounded)' : 'creature survives'}`);
      noteOutcome(`Body check passed — the ${isAgent ? 'agent survives but is wounded' : 'creature survives'} (rolled ${effectiveRoll} vs body ${body})`);
      const survivedAssignments = combat.strikeAssignments.map((a, i) =>
        i === combat.currentStrikeIndex ? { ...a, result: 'survived' as const } : a,
      );
      combatAfterBodyCheck = { ...combat, strikeAssignments: survivedAssignments };
      if (isAgent) {
        // CoE 3.v: the agent is wounded because its strike was defeated, even
        // though it survives the body check.
        stateAfterOutcome = updatePlayer(
          stateWithRoll,
          getPlayerIndex(stateWithRoll, combat.attackingPlayerId),
          p => ({
            ...p,
            agents: p.agents.map(a => a.character.instanceId === agentInstId
              ? { ...a, character: { ...a.character, status: CardStatus.Inverted } }
              : a),
          }),
        );
        logDetail(`Agent ${agentInstId as string} wounded (strike defeated, CoE 3.v)`);
      }
    }

    // Advance to next strike or finalize
    return advanceStrikeOrFinalize(stateAfterOutcome, combatAfterBodyCheck, effects);
  }

  if (combat.bodyCheckTarget === 'character') {
    // Body check against character or ally (CoE rule 2.V.2.2)
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const defPlayerIndex = getPlayerIndex(stateWithRoll, combat.defendingPlayerId);
    const defPlayer = stateWithRoll.players[defPlayerIndex];
    const charData = defPlayer.characters[strike.characterId];
    const company = companyById(defPlayer.companies, combat.companyId);
    const allyMatch = !charData && company
      ? findAllyInCompany(defPlayer, company.characters, strike.characterId)
      : undefined;
    if (!charData && !allyMatch) return { state, error: 'Character not found for body check' };

    const targetDefId = charData?.definitionId ?? allyMatch!.ally.definitionId;
    const targetName = cardName(stateWithRoll, targetDefId, allyMatch ? 'ally' : 'character');
    const charDef2 = stateWithRoll.cardPool[targetDefId] as { body?: number } | undefined;
    // Allies with an instance stat override (e.g. a creature converted by
    // Ready to His Will) use that body; otherwise fall back to the definition.
    const allyOverrideBody = allyMatch ? allyEffectiveBody(stateWithRoll, allyMatch.ally) : undefined;
    // A character checks against its *effective* body, not the printed value:
    // body modifiers from items and from `character-stat-modifier` constraints
    // (Akhôrahil tw-4's on-tap "-1 to any one character's body", Glance of Arien
    // ba-19, Vilya) are folded into `effectiveStats.body` by recomputeDerived,
    // which the reducer runs after every action. Allies bear no items and have
    // no effectiveStats, so they keep the printed/override value.
    const printedBody = allyOverrideBody
      ?? (charData && !allyMatch ? charData.effectiveStats.body : undefined)
      ?? charDef2?.body ?? 9;
    let body = printedBody; // Default body if not specified
    // CvCC weapon effects: the attacking character's `enemy-modifier` (body,
    // subtract/halve) effects reduce the defending character's body-check
    // target, mirroring how the same DSL effect reduces a hazard creature's
    // body. Used by Ancient Black Axe (as-122): "Warrior only: -1 to strike's
    // body."
    if (combat.isCvCC && strike.attackingCharacterId && charData && !allyMatch) {
      const atkPlayerIdxCvCC = getPlayerIndex(stateWithRoll, combat.attackingPlayerId);
      const attackerCharData = stateWithRoll.players[atkPlayerIdxCvCC].characters[strike.attackingCharacterId];
      if (attackerCharData) {
        const targetCharDef = defById(stateWithRoll, charData.definitionId);
        if (isCharacterCard(targetCharDef)) {
          const inPlayNamesAtk = buildInPlayNames(stateWithRoll);
          const enemyCtx = { race: targetCharDef.race, name: targetName, prowess: 0, body };
          const modifiedBody = resolveEnemyBody(stateWithRoll, attackerCharData, enemyCtx, body, inPlayNamesAtk);
          if (modifiedBody !== body) {
            logDetail(`CvCC attacker weapon modified defender body: ${body} → ${modifiedBody}`);
            body = modifiedBody;
          }
        }
      }
    }
    // Dodge body penalty: if the character was dodging and got wounded, apply body modifier
    if (strike.dodged && strike.dodgeBodyPenalty) {
      logDetail(`Dodge body penalty: body ${body} + (${strike.dodgeBodyPenalty}) = ${body + strike.dodgeBodyPenalty}`);
      body = body + strike.dodgeBodyPenalty;
    }
    // Modify-strike body penalty (e.g. Risky Blow's -1).
    if (strike.strikeBodyPenalty) {
      logDetail(`Strike event body penalty: body ${body} + (${strike.strikeBodyPenalty}) = ${body + strike.strikeBodyPenalty}`);
      body = body + strike.strikeBodyPenalty;
    }
    const woundedBonus = strike.wasAlreadyWounded ? 1 : 0;
    // Attack-level body-check modifier (e.g. Cruel Caradhras td-9: +1 to any
    // resulting body check). Positive values make elimination more likely.
    const attackBodyCheckModifier = combat.bodyCheckModifier ?? 0;
    // Item-granted body-check modifiers (e.g. Helm of Fear -1) only apply to
    // characters (allies do not bear items).
    const itemBodyMod = charData && !allyMatch ? bodyCheckRollModifier(stateWithRoll, charData) : 0;
    // Global body-check modifiers from in-play permanent-events (e.g. Spawn of
    // Ungoliant ba-24: +1 to certain races' body checks from Spider attacks).
    const targetRaceForBody = charData && !allyMatch && isCharacterCard(defById(stateWithRoll, charData.definitionId))
      ? (defById(stateWithRoll, charData.definitionId) as { race?: Race }).race
      : undefined;
    const globalBodyMod = globalBodyCheckRollModifier(stateWithRoll, targetRaceForBody, combat.creatureRace);
    // bearer-combat body-check modifier (Flame of Udûn ba-58): a successful CvCC
    // strike by the bearer raises the defending character's body check.
    const bearerMod = bearerCombatBodyCheckModifier(stateWithRoll, combat, strike);
    const effectiveRoll = rollTotal + woundedBonus + attackBodyCheckModifier + itemBodyMod + globalBodyMod + bearerMod;

    logDetail(`Body check vs ${allyMatch ? 'ally' : 'character'}: roll ${rollTotal}${woundedBonus ? '+1(wounded)' : ''}${attackBodyCheckModifier ? ` ${formatSignedNumber(attackBodyCheckModifier)}(attack)` : ''}${itemBodyMod ? `${formatSignedNumber(itemBodyMod)}(item)` : ''}${globalBodyMod ? `${formatSignedNumber(globalBodyMod)}(global)` : ''}${bearerMod ? `${formatSignedNumber(bearerMod)}(bearer)` : ''} = ${effectiveRoll} vs body ${body}`);

    // MELE §8.R1: if the *unmodified* roll is exactly 7 or 8 and the target is a
    // Ringwraith avatar, the Ringwraith returns to hand instead of being eliminated.
    if (charData && !allyMatch && (rollTotal === 7 || rollTotal === 8)) {
      const rwDef = defById(stateWithRoll, charData.definitionId);
      if (rwDef && isCharacterCard(rwDef) && rwDef.race === Race.Ringwraith) {
        logDetail(`Ringwraith body check roll is ${rollTotal} (7 or 8 unmodified) — Ringwraith returned to hand (MELE §8.R1)`);
        noteOutcome(`${targetName} returns to hand instead of being eliminated (body check ${rollTotal})`);
        const newAssignmentsRW = combat.strikeAssignments.map((a, i) => {
          if (i === combat.currentStrikeIndex) return { ...a, resolved: true, result: 'eliminated' as const };
          if (!a.resolved && a.characterId === strike.characterId) {
            logDetail(`Strike ${i} auto-resolved (Ringwraith returned to hand, CoE 3.i.5)`);
            return { ...a, resolved: true, result: 'success' as const };
          }
          return a;
        });
        const newPlayersRW = clonePlayers(stateWithRoll);
        const newPlayerDataRW = { ...defPlayer };
        const combatWithRW = { ...combat, strikeAssignments: newAssignmentsRW };

        // Remove from company
        if (company) {
          newPlayerDataRW.companies = newPlayerDataRW.companies.map(c =>
            c.id === combat.companyId
              ? { ...c, characters: c.characters.filter(ch => ch !== strike.characterId) }
              : c,
          );
        }
        // Move the Ringwraith card instance to the player's hand (not eliminated)
        const rwInstance = toCardInstance(charData);
        newPlayerDataRW.hand = [...newPlayerDataRW.hand, rwInstance];
        // Discard allies, items, and hazards on the returned Ringwraith
        for (const ally of charData.allies) {
          logDetail(`Discarding ally ${ally.instanceId as string} from returned Ringwraith`);
          newPlayerDataRW.discardPile = [...newPlayerDataRW.discardPile, toCardInstance(ally)];
        }
        for (const item of charData.items) {
          logDetail(`Discarding item ${item.instanceId as string} from returned Ringwraith`);
          newPlayerDataRW.discardPile = [...newPlayerDataRW.discardPile, toCardInstance(item)];
        }
        const hazardPlayerRW = newPlayersRW[1 - defPlayerIndex];
        let hazardDiscardRW = [...hazardPlayerRW.discardPile];
        for (const hazard of charData.hazards) {
          logDetail(`Discarding hazard ${hazard.instanceId as string} from returned Ringwraith`);
          hazardDiscardRW = [...hazardDiscardRW, toCardInstance(hazard)];
        }
        newPlayersRW[1 - defPlayerIndex] = { ...hazardPlayerRW, discardPile: hazardDiscardRW };
        const { [strike.characterId]: _rw, ...remainingCharsRW } = newPlayerDataRW.characters;
        // Revert followers to general influence with the mind subtraction
        // deferred to the player's next organization phase (CoE rule 3.13 —
        // combat never happens during the controller's organization phase).
        const updatedCharsRW = { ...remainingCharsRW };
        for (const followerId of charData.followers) {
          const follower = updatedCharsRW[followerId];
          if (follower) updatedCharsRW[followerId] = { ...follower, controlledBy: 'general', influenceUnsubtracted: true, ...ringwraithReclaimMark(stateWithRoll, follower) };
        }
        newPlayerDataRW.characters = pruneLeaderFollowers(updatedCharsRW, strike.characterId, charData.controlledBy);
        // Record the returned Ringwraith's definition ID for reveal restrictions
        newPlayerDataRW.ringwraithReturnedToHand = charData.definitionId;
        newPlayersRW[defPlayerIndex] = newPlayerDataRW;

        return advanceStrikeOrFinalize({ ...stateWithRoll, players: newPlayersRW }, combatWithRW, effects);
      }
    }

    // Check if the character's printed discard number (discardBodyCheck) is triggered.
    // When the body check roll matches a value in the character's discardBodyCheck array,
    // the character is discarded to the discard pile (not eliminated).
    // protect-from-body-check on an attached item suppresses this discard, leaving the character wounded.
    // Allies cannot benefit from this protection.
    if (!allyMatch && charData) {
      const charDefForDiscard = defById(stateWithRoll, charData.definitionId);
      const printedDiscardBodyCheckValues = isCharacterCard(charDefForDiscard) && charDefForDiscard.cardType === 'minion-character' && charDefForDiscard.discardBodyCheck != null
        ? charDefForDiscard.discardBodyCheck
        : [];
      // CoE rule 8.31: effects that modify the character's body (e.g. a dodge
      // or strike-event body penalty) shift the discard number by the same
      // amount, so the printed values track `body`'s delta from its printed value.
      const bodyDelta = body - printedBody;
      const discardBodyCheckValues = printedDiscardBodyCheckValues.map(v => v + bodyDelta);
      if ((discardBodyCheckValues).includes(effectiveRoll)) {
        const isProtected = charData.items.some(item => {
          const itemDef = state.cardPool[item.definitionId];
          return getCardEffects(itemDef).some(e => e.type === 'protect-from-body-check');
        });
        if (isProtected) {
          logDetail(`Body check roll ${effectiveRoll} matches discardBodyCheck — discard suppressed by protect-from-body-check; character survives wounded`);
          noteOutcome(`${targetName} survives the body check (rolled ${effectiveRoll}, body ${body})`);
          const survivedAssignments = combat.strikeAssignments.map((a, i) =>
            i === combat.currentStrikeIndex ? { ...a, resolved: true, result: 'wounded' as const } : a,
          );
          return advanceStrikeOrFinalize(stateWithRoll, { ...combat, strikeAssignments: survivedAssignments }, effects);
        }
        logDetail(`Body check roll ${effectiveRoll} matches discardBodyCheck — character discarded to discard pile`);
        noteOutcome(`${targetName} is discarded by the body check (rolled ${effectiveRoll})`);
        return discardCharacterAfterBodyCheck(stateWithRoll, state, combat, strike, charData, defPlayer, defPlayerIndex, company, effects);
      }
    }

    if (effectiveRoll > body) {
      logDetail(`${allyMatch ? 'Ally' : 'Character'} eliminated (body check roll ${effectiveRoll} > body ${body})`);
      noteOutcome(`${targetName} is eliminated by the body check (rolled ${effectiveRoll}, body ${body})`);
      return eliminateCombatantFromStrike(stateWithRoll, combat, effects);
    }

    // Check for on-event: character-body-check-equals-body on the attack source.
    // Example: Giant Spiders discards non-Wizard/non-Ringwraith characters when
    // the body check roll exactly equals (not exceeds) the character's body.
    if (effectiveRoll === body && charData && !allyMatch) {
      const sourceCard = getAttackSourceCard(stateWithRoll, combat);
      const equalsBodyEvent = getOnEventEffects(sourceCard, 'character-body-check-equals-body')[0];
      if (equalsBodyEvent) {
        const targetCharDef = defById(stateWithRoll, targetDefId);
        const targetRace = isCharacterCard(targetCharDef) ? targetCharDef.race : undefined;
        const condContext: Record<string, unknown> = { target: { race: targetRace } };
        const conditionMet = !equalsBodyEvent.when || matchesCondition(equalsBodyEvent.when, condContext);
        if (conditionMet && equalsBodyEvent.apply.type === 'discard-character') {
          logDetail(`Body check equals body — character discarded to discard pile (not eliminated)`);
          noteOutcome(`${targetName} is discarded by the body check (rolled ${effectiveRoll}, body ${body})`);
          return discardCharacterAfterBodyCheck(stateWithRoll, state, combat, strike, charData, defPlayer, defPlayerIndex, company, effects);
        }
      }
    }

    logDetail(`${allyMatch ? 'Ally' : 'Character'} survives body check`);
    noteOutcome(`${targetName} survives the body check (rolled ${effectiveRoll}, body ${body})`);
    // CvCC strikes (resolveStrikeCvCC) leave `resolved: false` on the pending
    // body check so it can be finalized here; mark it resolved now or
    // `nextStrikePhase` will treat this strike as still pending and re-enter
    // resolve-strike for the same character (CvCC combat would loop forever).
    const survivedAssignments = combat.strikeAssignments.map((a, i) =>
      i === combat.currentStrikeIndex ? { ...a, resolved: true } : a,
    );
    return advanceStrikeOrFinalize(stateWithRoll, { ...combat, strikeAssignments: survivedAssignments }, effects);
  }

  if (combat.bodyCheckTarget === 'attacker-character') {
    // CvCC: defender won; roll body check for the attacking character
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    if (!strike?.attackingCharacterId) return { state, error: 'CvCC body check: no attacking character' };

    const atkPlayerIdx = getPlayerIndex(stateWithRoll, combat.attackingPlayerId);
    const atkPlayer = stateWithRoll.players[atkPlayerIdx];
    const charData = atkPlayer.characters[strike.attackingCharacterId];
    if (!charData) return { state, error: 'CvCC body check: attacking character not found' };

    const charDef = defById(stateWithRoll, charData.definitionId);
    // Like the defending-character branch above, check against the *effective*
    // body: item body modifiers (The Mithril-coat tw-345) and
    // `character-stat-modifier` constraints are folded into
    // `effectiveStats.body` by recomputeDerived; the printed value ignores
    // them, so the two sides of one CvCC would be checked under different
    // rules.
    const body = charData.effectiveStats.body;
    const charName = (charDef as { name?: string } | undefined)?.name ?? (strike.attackingCharacterId as string);

    // Item-granted body-check modifiers (e.g. Helm of Fear -1) apply to the
    // bearer regardless of whether they are attacking or defending in CvCC.
    const itemBodyMod = bodyCheckRollModifier(stateWithRoll, charData);
    // bearer-combat body-check modifier (Flame of Udûn ba-58): the CvCC defender
    // parried this attacking character's strike, so a failed strike against the
    // defender raises the attacker's body check.
    const bearerMod = bearerCombatBodyCheckModifier(stateWithRoll, combat, strike);
    // CoE rule 3.I: +1 to the body check roll if the character was already
    // wounded before whatever caused the check — the attacker's pre-strike
    // status is recorded on the assignment by resolveStrikeCvCC (the character
    // is Inverted by the lost strike itself, so it cannot be read from status
    // here).
    const woundedBonus = strike.attackerWasAlreadyWounded ? 1 : 0;
    const effectiveRoll = rollTotal + woundedBonus + itemBodyMod + bearerMod;
    logDetail(`CvCC body check vs attacking character ${charName} (body ${body}): roll ${rollTotal}${woundedBonus ? '+1(wounded)' : ''}${itemBodyMod ? `${formatSignedNumber(itemBodyMod)}(item)` : ''}${bearerMod ? `${formatSignedNumber(bearerMod)}(bearer)` : ''} = ${effectiveRoll}`);

    const newAssignments = combat.strikeAssignments.map((a, i) =>
      i === combat.currentStrikeIndex ? { ...a, resolved: true } : a,
    );
    const newCombat = { ...combat, strikeAssignments: newAssignments, bodyCheckTarget: null };

    if (effectiveRoll > body) {
      logDetail(`CvCC: ${charName} eliminated (roll ${effectiveRoll} > body ${body})`);
      noteOutcome(`${charName} is eliminated by the body check (rolled ${effectiveRoll}, body ${body})`);
      // Eliminate the attacking character
      const newPlayers = clonePlayers(stateWithRoll);
      const charInstance = toCardInstance(charData);
      const atkCompanySource = combat.attackSource;
      if (atkCompanySource.type !== 'company-attack') return { state, error: 'Not a company attack' };
      const defIdx = getPlayerIndex(stateWithRoll, combat.defendingPlayerId);

      // Find attacker's company to remove character from
      const atkCompany = newPlayers[atkPlayerIdx].companies.find(c => c.id === atkCompanySource.attackingCompanyId);
      if (atkCompany) {
        const updatedCompany = { ...atkCompany, characters: atkCompany.characters.filter(id => id !== strike.attackingCharacterId) };
        // Disperse the eliminated character's attached cards — they live only
        // on this CharacterInPlay record, so deleting it without moving them
        // drops the instances from the game (no-card-disappears invariant).
        // Mirrors the defender-side eliminateCombatantFromStrike, with the
        // attacking player as owner:
        //  - allies to the attacker's hand (Radagast's Black Bird wh-114) or
        //    discard;
        //  - items (and non-item permanent events borne alongside them) to the
        //    attacker's discard pile;
        //  - hazards to the opposing (defending) player's discard;
        //  - followers revert to general influence, mind subtraction deferred
        //    to the controller's next org phase (CoE 3.13).
        // (The optional CoE 3.I.2 salvage-to-company-mate offer is not made on
        // the attacker side — the item-salvage phase is defender-scoped; a
        // separate change would be needed to offer it here.)
        const { toHand, toDiscard } = partitionLeavingAllies(stateWithRoll, charData.allies);
        const atkItemsToDiscard = charData.items.map(toCardInstance);
        const atkRemaining: Record<string, CharacterInPlay> = Object.fromEntries(
          Object.entries(newPlayers[atkPlayerIdx].characters).filter(([id]) => id !== (strike.attackingCharacterId as string)),
        );
        for (const followerId of charData.followers) {
          const follower = atkRemaining[followerId];
          if (follower) atkRemaining[followerId] = { ...follower, controlledBy: 'general', influenceUnsubtracted: true, ...ringwraithReclaimMark(stateWithRoll, follower) };
        }
        // Trophies borne by the eliminated attacker are relocated per CoE
        // 3.IV.4 — worth MP → the attacker's marshalling-point pile, otherwise
        // removed from play — or the creature CardInstance would disappear.
        const { toKillPile: atkTrophyKill, toOutOfPlay: atkTrophyOop } =
          partitionLeavingTrophies(stateWithRoll, charData, 'eliminated attacker');
        newPlayers[atkPlayerIdx] = {
          ...newPlayers[atkPlayerIdx],
          characters: pruneLeaderFollowers(atkRemaining, strike.attackingCharacterId, charData.controlledBy),
          companies: newPlayers[atkPlayerIdx].companies.map(c => c.id === atkCompany.id ? updatedCompany : c),
          hand: [...newPlayers[atkPlayerIdx].hand, ...toHand],
          discardPile: [...newPlayers[atkPlayerIdx].discardPile, ...toDiscard, ...atkItemsToDiscard],
          killPile: [...newPlayers[atkPlayerIdx].killPile, ...atkTrophyKill],
          outOfPlayPile: [...newPlayers[atkPlayerIdx].outOfPlayPile, ...atkTrophyOop],
        };
        // Defender gets kill MP (character card) and the eliminated character's
        // hazards (owned by the opposing/hazard player) return to their discard.
        newPlayers[defIdx] = {
          ...newPlayers[defIdx],
          killPile: [...newPlayers[defIdx].killPile, charInstance],
          discardPile: [...newPlayers[defIdx].discardPile, ...charData.hazards.map(toCardInstance)],
        };
      }

      const combatWithElim = { ...newCombat, strikeAssignments: newAssignments.map((a, i) =>
        i === combat.currentStrikeIndex ? { ...a, attackerResult: 'eliminated' as const } : a,
      ) };
      return advanceStrikeOrFinalize({ ...stateWithRoll, players: newPlayers }, combatWithElim, effects);
    } else {
      logDetail(`CvCC: ${charName} survives body check (roll ${effectiveRoll} <= body ${body})`);
      noteOutcome(`${charName} survives the body check (rolled ${effectiveRoll}, body ${body})`);
      return advanceStrikeOrFinalize(stateWithRoll, newCombat, effects);
    }
  }

  return { state, error: 'Invalid body check target' };
}

/**
 * Handle the shield-discard-roll phase (Sable Shield le-341).
 *
 * The attacking player rolls 2d6. If the result strictly exceeds the item's
 * rollThreshold, the shield is discarded from the bearer. Combat then advances
 * to the next strike or finalizes.
 */
export function handleShieldDiscardRoll(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'shield-discard-roll') return wrongActionType(state, action, 'shield-discard-roll');

  const atkPlayerIndex = getPlayerIndex(state, combat.attackingPlayerId);
  const { total: rollTotal, rollEffect, state: stateWithRoll } = rollDiceForPlayer(state, atkPlayerIndex, 'Shield discard roll');
  const effects: GameEffect[] = [rollEffect];

  const threshold = action.rollThreshold;
  logDetail(`Shield discard roll: attacker rolled ${rollTotal}, threshold ${threshold} — shield ${rollTotal > threshold ? 'DISCARDED' : 'survives'}`);

  let stateAfterShield = stateWithRoll;
  if (rollTotal > threshold && combat.shieldAbsorbItemId) {
    // Discard the shield from the bearer
    const defPlayerIndex = getPlayerIndex(stateWithRoll, combat.defendingPlayerId);
    const defPlayer = stateWithRoll.players[defPlayerIndex];
    const strike = combat.strikeAssignments[combat.currentStrikeIndex];
    const charData = defPlayer.characters[strike.characterId];

    if (charData) {
      const shieldItem = charData.items.find(i => i.instanceId === combat.shieldAbsorbItemId);
      if (shieldItem) {
        logDetail(`Discarding shield ${shieldItem.instanceId as string} from ${strike.characterId as string}`);
        const newItems = charData.items.filter(i => i.instanceId !== combat.shieldAbsorbItemId);
        const newDiscardPile = [...defPlayer.discardPile, toCardInstance(shieldItem)];
        stateAfterShield = updatePlayer(stateWithRoll, defPlayerIndex, p => ({
          ...p,
          characters: {
            ...p.characters,
            [strike.characterId]: { ...charData, items: newItems },
          },
          discardPile: newDiscardPile,
        }));
      }
    }
  }

  // Clear the shield-discard-roll field and advance combat
  const combatCleared: CombatState = { ...combat, phase: 'resolve-strike' as const, shieldAbsorbItemId: undefined };
  return advanceStrikeOrFinalize(stateAfterShield, combatCleared, effects);
}

/**
 * Declare a cancel-attack action by playing a short-event card from hand.
 *
 * Follows the MECCG chain-of-effects rule: playing a cancel-attack card
 * declares a chain entry rather than immediately cancelling combat. The
 * opponent has priority to respond (e.g. with a hazard that cancels the
 * cancellation). When both players pass chain priority, the chain
 * auto-resolves and the cancel-attack entry applies its effect to the
 * active combat via {@link resolveCancelAttackEntry}.
 *
 * Costs (tapping a scout or enqueuing a corruption check) are paid
 * immediately at declaration per CoE rule 9.5.2 — active conditions do
 * not initiate their own chain and cannot be refunded by negation.
 * The card itself moves from hand to discard pile at declaration, matching
 * the behaviour of other short events.
 */
/**
 * Handle a `convert-creature-to-ally` action (Ready to His Will le-220).
 *
 * Validates eligibility, then:
 * 1. taps the controlling character (if the card requires it),
 * 2. moves the attacking creature card from the attacker's cards-in-play into
 *    the controlling character's `allies` with the effect's stat overrides
 *    (mind, body, prowess = creature prowess + prowessModifier),
 * 3. moves the event card from the defender's hand into their cards-in-play
 *    with `attachedTo` set to the new ally ("Place this card with the
 *    creature"), where it scores its 1 ally marshalling point, and
 * 4. cancels all the creature's attacks by ending combat, running the same
 *    attack-end housekeeping as a cancel-attack.
 */
export function handleConvertCreatureToAlly(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'convert-creature-to-ally') return wrongActionType(state, action, 'convert-creature-to-ally');
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only the defending player may convert a creature' };
  if (combat.phase !== 'assign-strikes' || combat.strikeAssignments.length > 0) {
    return { state, error: 'Creature may only be converted before strikes are assigned' };
  }
  if (combat.attackSource.type !== 'creature') return { state, error: 'Attack is not a single creature' };

  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const atkIdx = getPlayerIndex(state, combat.attackingPlayerId);
  const defPlayer = state.players[defIdx];

  // The event card being played.
  const handCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Conversion card not in hand' };
  const cardDef = defById(state, handCard.definitionId);
  const effect = getCardEffects(cardDef).find(
    (e): e is import('../types/effects.js').ConvertCreatureToAllyEffect => e.type === 'convert-creature-to-ally',
  );
  if (!effect) return { state, error: 'Card has no convert-creature-to-ally effect' };

  // The attacking creature card.
  const creatureInstanceId = combat.attackSource.instanceId;
  const creatureDef = resolveDef(state, creatureInstanceId);
  if (!creatureDef || creatureDef.cardType !== 'hazard-creature') return { state, error: 'Attacking creature not found' };
  const creatureRace = (creatureDef as { race: Race }).race;
  const creatureStrikes = (creatureDef as { strikes: number }).strikes;
  if (creatureStrikes > effect.maxStrikes) return { state, error: 'Creature has too many strikes to convert' };
  if (!effect.races.map(r => r.toLowerCase()).includes(creatureRace)) return { state, error: 'Creature race is not eligible for conversion' };

  // The controlling character.
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company || !company.characters.includes(action.controllingCharacterId)) {
    return { state, error: 'Controlling character not in defending company' };
  }
  const controller = defPlayer.characters[action.controllingCharacterId];
  if (!controller) return { state, error: 'Controlling character not found' };
  if (effect.controllerTaps && controller.status !== CardStatus.Untapped) {
    return { state, error: 'Controlling character must be untapped to take control' };
  }

  const creatureInPlay = findById(state.players[atkIdx].cardsInPlay, creatureInstanceId);
  if (!creatureInPlay) return { state, error: 'Creature card not in attacker cards-in-play' };

  const creatureName = (creatureDef as { name?: string }).name ?? (creatureInstanceId as string);
  const allyProwess = (creatureDef as { prowess: number }).prowess + effect.ally.prowessModifier;
  const statOverride: import('../types/state-cards.js').AllyStatOverride = {
    mind: effect.ally.mind,
    prowess: allyProwess,
    body: effect.ally.body,
  };
  const newAlly: import('../types/state-cards.js').AllyInPlay = {
    instanceId: creatureInstanceId,
    definitionId: creatureInPlay.definitionId,
    status: CardStatus.Untapped,
    statOverride,
  };

  logDetail(
    `Convert-creature-to-ally: "${(cardDef as { name?: string } | undefined)?.name ?? handCard.definitionId as string}" converts ${creatureName} ` +
    `into an ally (mind ${statOverride.mind}, prowess ${statOverride.prowess}, body ${statOverride.body}) ` +
    `controlled by ${action.controllingCharacterId as string}${effect.controllerTaps ? ' (taps)' : ''}`,
  );

  let newState: GameState = state;

  // Remove the creature from the attacker's cards-in-play.
  newState = updatePlayer(newState, atkIdx, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
  }));

  // Add the ally to the controlling character and tap that character.
  newState = updatePlayer(newState, defIdx, p => updateCharacter(p, action.controllingCharacterId, ch => ({
    ...ch,
    status: effect.controllerTaps ? CardStatus.Tapped : ch.status,
    allies: [...ch.allies, newAlly],
  })));

  // Move the event card from hand to cards-in-play, "placed with the creature"
  // (attachedTo the new ally so the two are discarded together). The event card
  // scores its printed 1 ally marshalling point while in play.
  newState = updatePlayer(newState, defIdx, p => ({
    ...p,
    hand: p.hand.filter(c => c.instanceId !== action.cardInstanceId),
    cardsInPlay: [
      ...p.cardsInPlay,
      {
        instanceId: handCard.instanceId,
        definitionId: handCard.definitionId,
        status: CardStatus.Untapped,
        attachedTo: creatureInstanceId,
      },
    ],
  }));

  // All attacks of the creature are canceled — end combat and run the same
  // attack-end housekeeping as a cancel-attack.
  newState = { ...newState, combat: null };
  newState = sweepExpired(newState, { kind: 'attack-end' });
  newState = recordHazardEncountered(newState, state, combat);

  logDetail('Creature converted to ally — combat ended, returning to enclosing phase');
  return { state: newState };
}

/**
 * Halve the number of strikes in the current attack (rounded up) by
 * discarding a short event card from hand. Only allowed during the
 * assign-strikes phase before any strikes have been assigned.
 *
 * For a multi-attack creature (e.g. Slayer le-90 — "two attacks of one
 * strike each"), CoE 2.IV.vii.2.1 resolves each attack as a separate combat
 * in succession, and 3.i's "modify attributes of the attack as a whole"
 * window only covers the *current* attack. `combat.strikesTotal` pools the
 * remaining attacks' strikes together (`multiAttackCount × strikesPerAttack`)
 * for bookkeeping, but a strike-reduction effect must only touch the current
 * attack's share (`strikesPerAttack`) — the other, not-yet-resolved attacks
 * are untouched and contribute their full strikes back into the new total.
 */
export function handleHalveStrikes(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'halve-strikes') return wrongActionType(state, action, 'halve-strikes');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only halve strikes before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to halve' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can halve strikes' };

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];

  const discardedCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!discardedCard) return { state, error: 'Card not in hand' };

  const originalStrikes = combat.strikesTotal;
  const perAttackStrikes = combat.strikesPerAttack ?? originalStrikes;
  const remainingAttacks = Math.max(0, (combat.multiAttackCount ?? 1) - 1);
  const untouchedStrikes = perAttackStrikes * remainingAttacks;
  const currentAttackStrikes = originalStrikes - untouchedStrikes;

  const cardDef = state.cardPool[discardedCard.definitionId];
  const halveEffect = getCardEffects(cardDef).find(
    (e): e is HalveStrikesEffect => e.type === 'halve-strikes',
  );
  const op = halveEffect?.op ?? 'halve';
  let newCurrentAttackStrikes: number;
  if (op === 'subtract') {
    const subtractValue = halveEffect?.value ?? 2;
    const min = halveEffect?.min ?? 1;
    newCurrentAttackStrikes = Math.max(min, currentAttackStrikes - subtractValue);
    logDetail(`Strikes reduced by ${subtractValue} (min ${min}): current attack ${currentAttackStrikes} → ${newCurrentAttackStrikes} (${untouchedStrikes} untouched from ${remainingAttacks} further attack(s)) (${discardedCard.definitionId as string} played)`);
  } else {
    newCurrentAttackStrikes = Math.ceil(currentAttackStrikes / 2);
    logDetail(`Strikes halved: current attack ${currentAttackStrikes} → ${newCurrentAttackStrikes} (${untouchedStrikes} untouched from ${remainingAttacks} further attack(s)) (${discardedCard.definitionId as string} played)`);
  }
  const newStrikes = newCurrentAttackStrikes + untouchedStrikes;

  const newHand = removeById(defPlayer.hand, discardedCard.instanceId);
  const newDiscard = [...defPlayer.discardPile, toCardInstance(discardedCard)];

  return {
    state: {
      ...updatePlayer(state, defPlayerIndex, p => ({ ...p, hand: newHand, discardPile: newDiscard })),
      combat: { ...combat, strikesTotal: newStrikes },
    },
  };
}

/**
 * Play a `protect-from-strike-assignment` short event from hand during the
 * assign-strikes phase. The targeted character (or, with `includeAllies`, an
 * ally) is added to `CombatState.protectedFromStrikeAssignment`, preventing
 * any strike in the current attack from being assigned to them. The card is
 * discarded.
 *
 * Used by Ruse (le-225) mode B: play on a scout; no strikes may be assigned
 * to that scout for the rest of the current attack. Also used by Sojourn in
 * Shadows (wh-49): play on any character in a shadow-magic-using character's
 * company; the effect's optional `corruptionCheck` then forces that
 * shadow-magic user to make a corruption check (skipped if he's a
 * Ringwraith). Also used by More Sense than You (td-140): play on an
 * untapped character or ally (`requireUntapped`); the effect's `tapTarget`
 * flag also taps the chosen target as a side effect of playing the card.
 */
export function handleProtectFromStrikeAssignment(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'protect-from-assignment') return wrongActionType(state, action, 'protect-from-assignment');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only protect from strike assignment before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to protect from assignment' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can protect a character from strike assignment' };

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];

  const playedCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!playedCard) return { state, error: 'Card not in hand' };

  const protEff = getCardEffects(defById(state, playedCard.definitionId))
    .find((e): e is ProtectFromStrikeAssignmentEffect => e.type === 'protect-from-strike-assignment');
  if (!protEff) return { state, error: 'Card has no protect-from-strike-assignment effect' };

  const targetChar = defPlayer.characters[action.targetCharacterId];
  const targetAlly = targetChar ? null : findAttachment(defPlayer, 'allies', action.targetCharacterId);
  if (!targetChar && !targetAlly) return { state, error: 'Target character or ally not in defending company' };
  if (targetAlly && !protEff.includeAllies) return { state, error: 'This card cannot target an ally' };

  const targetStatus = targetChar ? targetChar.status : targetAlly!.attachment.status;
  if (protEff.requireUntapped && targetStatus !== CardStatus.Untapped) {
    return { state, error: 'Target must be untapped' };
  }

  const targetDefinitionId = targetChar ? targetChar.definitionId : targetAlly!.attachment.definitionId;
  const cardName_ = cardName(state, playedCard.definitionId);
  const targetName_ = cardName(state, targetDefinitionId, action.targetCharacterId as string);
  logDetail(`${cardName_} played — ${targetName_} is now protected from strike assignment this attack`);

  const newHand = removeById(defPlayer.hand, playedCard.instanceId);

  const alreadyProtected = combat.protectedFromStrikeAssignment ?? [];
  const newProtected = alreadyProtected.includes(action.targetCharacterId)
    ? alreadyProtected
    : [...alreadyProtected, action.targetCharacterId];

  const tap = <A extends { status: CardStatus }>(a: A): A => ({ ...a, status: CardStatus.Tapped });

  let nextState: GameState = {
    ...discardOrRecyclePlayedEvent(
      updatePlayer(state, defPlayerIndex, p => {
        let updated = { ...p, hand: newHand };
        if (protEff.tapTarget) {
          updated = targetChar
            ? updateCharacter(updated, action.targetCharacterId, tap)
            : (updateAttachment(updated, 'allies', action.targetCharacterId, tap)?.player ?? updated);
        }
        return updated;
      }),
      defPlayerIndex,
      toCardInstance(playedCard),
    ),
    combat: { ...combat, protectedFromStrikeAssignment: newProtected },
  };
  if (protEff.tapTarget) {
    logDetail(`${targetName_} is tapped (${cardName_})`);
  }

  // Sojourn in Shadows (wh-49): "Unless he is a Ringwraith, the shadow-magic
  // using character makes a corruption check modified by -4." If any
  // qualifying shadow-magic user in the target's company is a Ringwraith, no
  // check is made at all (matches A Malady Without Healing le-159's caster
  // rule, reducer-events.ts).
  if (protEff?.corruptionCheck) {
    const targetCompany = findCharacterCompany(defPlayer.companies, action.targetCharacterId);
    const users = targetCompany ? companyShadowMagicUsers(state, defPlayer, targetCompany) : [];
    const nonRingwraithUser = users.find(u => !u.isRingwraith);
    if (users.some(u => u.isRingwraith)) {
      logDetail(`${cardName_}: shadow-magic user is a Ringwraith — no corruption check`);
    } else if (nonRingwraithUser) {
      const modifier = protEff.corruptionCheck.modifier;
      logDetail(`${cardName_}: shadow-magic user ${nonRingwraithUser.id as string} makes a corruption check (${formatSignedNumber(modifier)})`);
      nextState = enqueueCorruptionCheck(nextState, {
        source: playedCard.instanceId,
        actor: action.player,
        scope: companySubphaseScope(state.phaseState.phase, combat.companyId),
        characterId: nonRingwraithUser.id,
        reason: cardName_,
        modifier,
      });
    }
  }

  return { state: nextState };
}

/**
 * Play a `multi-strike-option` short event (Many Foes He Fought td-131)
 * during the pre-assignment window. No target is chosen here — this simply
 * flags `combat.multiStrikeSkill` with the effect's required skill for the
 * rest of the attack, letting `assignStrikeActions` (`legal-actions/combat.ts`)
 * offer additional-strike assignments (`assign-strike`'s `extraSequence`
 * flag) to any company character carrying that skill who already faces a
 * strike this attack.
 */
export function handleEnableMultiStrikeOption(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'enable-multi-strike-option') return wrongActionType(state, action, 'enable-multi-strike-option');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only enable multi-strike option before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to enable multi-strike option' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can enable multi-strike option' };

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];

  const playedCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!playedCard) return { state, error: 'Card not in hand' };

  const cardDef = defById(state, playedCard.definitionId);
  const effect = getCardEffects(cardDef).find(
    (e): e is MultiStrikeOptionEffect => e.type === 'multi-strike-option',
  );
  if (!effect) return { state, error: 'Card has no multi-strike-option effect' };

  const cardName_ = cardName(state, playedCard.definitionId);
  logDetail(`${cardName_} played — characters with skill "${effect.requiredSkill}" may face additional strikes this attack`);

  const newHand = removeById(defPlayer.hand, playedCard.instanceId);

  const nextState: GameState = {
    ...discardOrRecyclePlayedEvent(
      updatePlayer(state, defPlayerIndex, p => ({ ...p, hand: newHand })),
      defPlayerIndex,
      toCardInstance(playedCard),
    ),
    combat: { ...combat, multiStrikeSkill: effect.requiredSkill },
  };

  return { state: nextState };
}

/**
 * Tap an in-play item to boost the bearer's prowess for the one strike
 * currently being resolved. The item must be untapped and belong to the
 * character assigned the current strike. Tapping it accumulates
 * `prowessBonus` onto `StrikeAssignment.strikeProwessBonus`, benefiting
 * only that one defender for that one strike.
 *
 * Used by Shield of Iron-bound Ash (tw-327).
 */
export function handleTapItemForStrike(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'tap-item-for-strike') return wrongActionType(state, action, 'tap-item-for-strike');
  if (combat.phase !== 'resolve-strike') return { state, error: 'Can only tap item for strike during resolve-strike phase' };

  const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!currentStrike || currentStrike.resolved) return { state, error: 'No active unresolved strike' };
  if (currentStrike.characterId !== action.characterInstanceId) return { state, error: 'Item bearer is not the current strike target' };

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];

  if (!defPlayer.characters[action.characterInstanceId]) return { state, error: 'Character not found' };

  const found = findAttachment(defPlayer, 'items', action.cardInstanceId);
  if (!found || found.charId !== action.characterInstanceId) return { state, error: 'Item not found on character' };

  const itemDef = defById(state, found.attachment.definitionId);
  const effect = getCardEffects(itemDef).find(
    (e): e is ModifyAttackEffect => e.type === 'modify-attack' && (e).scope === 'current-strike',
  );
  if (!effect) return { state, error: 'Item has no modify-attack(current-strike) effect' };

  // `cost: { discard: "self" }` (Arrows Shorn of Ebony td-99) removes the item
  // from play instead of tapping it (`cost: { tap: "self" }`, Shield of
  // Iron-bound Ash tw-327) — the discard variant has no status requirement.
  const isDiscardCost = effect.cost?.discard === 'self';
  let newDefPlayer: PlayerState;
  if (isDiscardCost) {
    const removed = removeAttachment(defPlayer, 'items', action.cardInstanceId);
    if (!removed) return { state, error: 'Item not found on character' };
    newDefPlayer = { ...removed.player, discardPile: [...removed.player.discardPile, toCardInstance(removed.attachment)] };
  } else {
    if (found.attachment.status !== CardStatus.Untapped) return { state, error: 'Item must be untapped to activate' };
    const tapped = updateAttachment(defPlayer, 'items', action.cardInstanceId, it => ({ ...it, status: CardStatus.Tapped }));
    if (!tapped) return { state, error: 'Item not found on character' };
    newDefPlayer = tapped.player;
  }

  const itemName = (itemDef as { name?: string } | undefined)?.name ?? (found.attachment.definitionId as string);
  const prowessBonus = effect.prowessModifier ?? 0;
  const bodyModifier = effect.bodyModifier ?? 0;
  const cascade = effect.cascadeDefeatOnSuccess === true;
  logDetail(`Tap-item-for-strike: ${isDiscardCost ? 'discarding' : 'tapping'} ${itemName} on ${action.characterInstanceId as string} (${formatSignedNumber(prowessBonus)} prowess${bodyModifier ? `, ${formatSignedNumber(bodyModifier)} creature body` : ''} for current strike${cascade ? ' — cascades to defeat the rest of the attack if defeated' : ''})`);

  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? {
          ...a,
          strikeProwessBonus: (a.strikeProwessBonus ?? 0) + prowessBonus,
          ...(bodyModifier ? { strikeCreatureBodyModifier: (a.strikeCreatureBodyModifier ?? 0) + bodyModifier } : {}),
          ...(cascade ? { cascadesOnDefeat: true as const } : {}),
        }
      : a,
  );

  return {
    state: {
      ...updatePlayer(state, defPlayerIndex, () => newDefPlayer),
      combat: { ...combat, strikeAssignments: newAssignments },
    },
  };
}

/**
 * Tap a `face-strike-on-tap` item (e.g. Bow of Alatar wh-90) during the
 * `assign-strikes` defender phase to let its bearer face one of the attack's
 * strikes regardless of the attack's normal capabilities and the bearer's
 * status. Taps the item and adds a forced strike assignment to the bearer,
 * flagged (`reduceAttackBodyOnParry`) so that a parry lowers the attack's body.
 *
 * The bearer may already be tapped or wounded — the status check that gates
 * ordinary defender assignment is intentionally bypassed here ("regardless of
 * … his status"). The assignment always adds one strike-facing; combat advances
 * to resolution once every strike is allocated.
 */
export function handleFaceStrikeOnTap(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'face-strike-on-tap') return wrongActionType(state, action, 'face-strike-on-tap');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only face a strike via item during strike assignment' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only the defending player may activate a face-strike item' };

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];

  const bearer = defPlayer.characters[action.characterInstanceId];
  if (!bearer) return { state, error: 'Bearer not in play' };

  // Bearer must be in the defending company.
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company || !company.characters.includes(action.characterInstanceId)) {
    return { state, error: 'Bearer is not in the defending company' };
  }

  // The strike-facing consumes one of the attack's strikes.
  const totalAllocated = combat.strikeAssignments.length
    + combat.strikeAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);
  if (totalAllocated >= combat.strikesTotal) {
    return { state, error: 'No unassigned strike remains for the bearer to face' };
  }
  if (combat.strikeAssignments.some(a => a.characterId === action.characterInstanceId)) {
    return { state, error: 'Bearer is already facing a strike' };
  }

  // Tap the (untapped) face-strike item on the bearer.
  const tapped = updateAttachment(defPlayer, 'items', action.cardInstanceId, it => ({ ...it, status: CardStatus.Tapped }));
  if (!tapped || tapped.charId !== action.characterInstanceId) return { state, error: 'Item not found on bearer' };
  const item = tapped.attachment;
  if (item.status !== CardStatus.Untapped) return { state, error: 'Item must be untapped to activate' };

  const itemDef = defById(state, item.definitionId);
  const effect = getCardEffects(itemDef).find(e => e.type === 'face-strike-on-tap');
  if (!effect) return { state, error: 'Item has no face-strike-on-tap effect' };
  const reduction = (effect as { bodyReductionOnParry?: number }).bodyReductionOnParry ?? 0;

  const itemName = (itemDef as { name?: string } | undefined)?.name ?? (item.definitionId as string);
  const bearerName = cardName(state, bearer.definitionId, action.characterInstanceId as string);
  logDetail(`Face-strike-on-tap: tapping ${itemName} — ${bearerName} faces a strike regardless of capabilities/status${reduction > 0 ? ` (attack body -${reduction} if parried)` : ''}`);

  const newAssignments: StrikeAssignment[] = [...combat.strikeAssignments, {
    characterId: action.characterInstanceId,
    excessStrikes: 0,
    resolved: false,
    ...(reduction > 0 ? { reduceAttackBodyOnParry: reduction } : {}),
  }];

  const newTotalAllocated = newAssignments.length
    + newAssignments.reduce((sum, a) => sum + a.excessStrikes, 0);

  let newCombat: CombatState = { ...combat, strikeAssignments: newAssignments };
  if (newTotalAllocated >= combat.strikesTotal) {
    const next = nextStrikePhase(newCombat);
    newCombat = { ...newCombat, assignmentPhase: 'done', ...next };
  }

  return {
    state: {
      ...updatePlayer(state, defPlayerIndex, () => tapped.player),
      combat: newCombat,
    },
  };
}

/**
 * Tap an in-play ally carrying a `combat-tap-company-boost` effect to grant an
 * attack-scoped stat boost to every matching character in the ally's own
 * company. Mirrors the `company-combat-boost` short-event path (one
 * `character-stat-modifier` constraint per matching character, `scope: attack`,
 * swept when the attack finalizes) but is triggered by tapping the ally instead
 * of playing a card from hand. Works for the defending company in creature
 * combat and for either company in CvCC.
 *
 * Used by Great Lord of Goblin-gate (as-75).
 *
 * Also handles the `cost: { tap: "bearer" }` variant sourced from an in-play
 * item (`action.characterInstanceId` set) — see Lore of the Ages (td-129).
 */
export function handleTapAllyCombatBoost(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'tap-ally-combat-boost') return wrongActionType(state, action, 'tap-ally-combat-boost');

  const playerIndex = getPlayerIndex(state, action.player);
  if (playerIndex < 0) return { state, error: 'Player not found' };
  const player = state.players[playerIndex];

  // --- Bearer-tap path: an in-play item (including a resource permanent-event
  // played "on a character", which is placed among their items) grants the
  // ability, but the *bearer* character taps instead of the source card
  // (Lore of the Ages td-129). ---
  if (action.characterInstanceId !== undefined) {
    const bearerCharId = action.characterInstanceId;
    const charData = player.characters[bearerCharId];
    if (!charData) return { state, error: 'Character not found' };
    if (charData.status !== CardStatus.Untapped) return { state, error: 'Bearer must be untapped to activate' };

    const itemMatch = charData.items.find(i => i.instanceId === action.cardInstanceId);
    const sourceDefinitionId = itemMatch?.definitionId;
    if (!sourceDefinitionId) return { state, error: 'Boost source not found on bearer' };

    const sourceDef = defById(state, sourceDefinitionId);
    const boostEffects = getCardEffects(sourceDef).filter(
      (e): e is CombatTapCompanyBoostEffect => e.type === 'combat-tap-company-boost' && e.cost?.tap === 'bearer',
    );
    if (boostEffects.length === 0) return { state, error: 'Source has no bearer-tap combat-tap-company-boost effect' };

    const company = player.companies.find(c => c.characters.includes(bearerCharId));
    if (!company) return { state, error: 'Bearer is not in a company' };
    const attackingCompanyId = combat.attackSource.type === 'company-attack' ? combat.attackSource.attackingCompanyId : undefined;
    const involved = company.id === combat.companyId || (combat.isCvCC === true && company.id === attackingCompanyId);
    if (!involved) return { state, error: 'Bearer company not involved in this combat' };

    const already = state.activeConstraints.some(c => c.source === action.cardInstanceId && c.scope.kind === 'attack');
    if (already) return { state, error: 'Boost already applied this attack' };

    const sourceName = (sourceDef as { name?: string } | undefined)?.name ?? (sourceDefinitionId as string);
    let newState = updatePlayer(state, playerIndex, p => updateCharacter(p, bearerCharId, c => ({ ...c, status: CardStatus.Tapped })));

    let applied = 0;
    for (const boostEffect of boostEffects) {
      for (const memberCharId of company.characters) {
        const memberData = newState.players[playerIndex].characters[memberCharId];
        if (!memberData) continue;
        const memberDef = defById(newState, memberData.definitionId);
        if (!memberDef) continue;
        if (boostEffect.filter) {
          const ctx = {
            target: {
              race: 'race' in memberDef ? (memberDef as { race?: Race }).race : undefined,
              name: (memberDef as { name?: string }).name ?? '',
              skills: ('skills' in memberDef ? (memberDef as { skills?: readonly string[] }).skills : undefined) ?? [],
            },
          };
          if (!matchesCondition(boostEffect.filter, ctx)) continue;
        }
        logDetail(`${sourceName}: adding attack-scoped ${formatSignedNumber(boostEffect.value)} ${boostEffect.stat} to ${memberCharId as string}`);
        newState = addConstraint(newState, {
          source: action.cardInstanceId,
          sourceDefinitionId,
          scope: { kind: 'attack' },
          target: { kind: 'character', characterId: memberCharId },
          kind: {
            type: 'character-stat-modifier',
            stat: boostEffect.stat,
            value: boostEffect.value,
            characterId: memberCharId,
          },
        });
        applied++;
      }
    }
    logDetail(`${sourceName}: bearer ${bearerCharId as string} tapped — applied combat boost to ${applied} character(s) in company ${company.id as string}`);

    if (boostEffects.some(e => e.enqueueCorruptionCheck)) {
      const scope = companySubphaseScope(newState.phaseState.phase, company.id);
      logDetail(`${sourceName}: enqueuing corruption check on bearer ${bearerCharId as string}`);
      newState = enqueueCorruptionCheck(newState, {
        source: action.cardInstanceId,
        actor: action.player,
        scope,
        characterId: bearerCharId,
        reason: sourceName,
      });
    }

    return { state: newState };
  }

  // Locate the ally and the character bearing it.
  const tapped = updateAttachment(player, 'allies', action.cardInstanceId, a => ({ ...a, status: CardStatus.Tapped }));
  if (!tapped) return { state, error: 'Ally not in play under this player' };
  const { charId: bearerCharId, attachment: ally } = tapped;
  if (ally.status !== CardStatus.Untapped) return { state, error: 'Ally must be untapped to activate' };

  const allyDef = defById(state, ally.definitionId);
  const boostEffects = getCardEffects(allyDef).filter(
    (e): e is CombatTapCompanyBoostEffect => e.type === 'combat-tap-company-boost',
  );
  if (boostEffects.length === 0) return { state, error: 'Ally has no combat-tap-company-boost effect' };

  // The bearer's company must be involved in the current combat (defending
  // company in creature combat, or either company in CvCC).
  const company = player.companies.find(c => c.characters.includes(bearerCharId));
  if (!company) return { state, error: 'Ally bearer is not in a company' };
  const attackingCompanyId = combat.attackSource.type === 'company-attack' ? combat.attackSource.attackingCompanyId : undefined;
  const involved = company.id === combat.companyId || (combat.isCvCC === true && company.id === attackingCompanyId);
  if (!involved) return { state, error: 'Ally company not involved in this combat' };

  // Each copy may apply its boost only once per attack (no stacking).
  const already = state.activeConstraints.some(c => c.source === ally.instanceId && c.scope.kind === 'attack');
  if (already) return { state, error: 'Ally boost already applied this attack' };

  // Tap the ally.
  const allyName = (allyDef as { name?: string } | undefined)?.name ?? (ally.definitionId as string);
  let newState = updatePlayer(state, playerIndex, () => tapped.player);

  // Apply one attack-scoped character-stat-modifier constraint per matching
  // character in the ally's company.
  let applied = 0;
  for (const boostEffect of boostEffects) {
    for (const charId of company.characters) {
      const charData = newState.players[playerIndex].characters[charId];
      if (!charData) continue;
      const charCardDef = defById(newState, charData.definitionId);
      if (!charCardDef) continue;
      if (boostEffect.filter) {
        const ctx = {
          target: {
            race: 'race' in charCardDef ? (charCardDef as { race?: Race }).race : undefined,
            name: (charCardDef?.name) ?? '',
            skills: ('skills' in charCardDef ? (charCardDef as { skills?: readonly string[] }).skills : undefined) ?? [],
          },
        };
        if (!matchesCondition(boostEffect.filter, ctx)) continue;
      }
      logDetail(`${allyName}: adding attack-scoped +${boostEffect.value} ${boostEffect.stat} to ${charId as string}`);
      newState = addConstraint(newState, {
        source: ally.instanceId,
        sourceDefinitionId: ally.definitionId,
        scope: { kind: 'attack' },
        target: { kind: 'character', characterId: charId },
        kind: {
          type: 'character-stat-modifier',
          stat: boostEffect.stat,
          value: boostEffect.value,
          characterId: charId,
        },
      });
      applied++;
    }
  }
  logDetail(`${allyName} tapped — applied combat boost to ${applied} character(s) in company ${company.id as string}`);

  return { state: newState };
}

/**
 * Tap an in-play ally carrying an `ally-body-check-boost` effect to add its
 * value to its controlling character's effective body for the pending body
 * check — the current strike (`combat.currentStrikeIndex`) must already
 * target that character. Mirrors the `strike-modifier` bodyPenalty path
 * (accumulates onto `StrikeAssignment.strikeBodyPenalty`, read by both
 * `bodyCheckActions` and the body-check roll resolution in
 * `handleBodyCheckRoll`) but is triggered by tapping the ally instead of
 * playing a card. Only offered (see `tapAllyBodyCheckBoostActions`) when the
 * ally itself was also struck by a strike from the same attack, so the
 * eligibility is re-checked here defensively rather than trusted blindly.
 *
 * Used by War-warg (le-156).
 */
export function handleTapAllyBodyCheckBoost(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'tap-ally-body-check-boost') return wrongActionType(state, action, 'tap-ally-body-check-boost');
  if (combat.bodyCheckTarget !== 'character') return { state, error: 'No character body check pending' };

  const playerIndex = getPlayerIndex(state, action.player);
  if (playerIndex < 0) return { state, error: 'Player not found' };
  const player = state.players[playerIndex];

  const tapped = updateAttachment(player, 'allies', action.cardInstanceId, a => ({ ...a, status: CardStatus.Tapped }));
  if (!tapped) return { state, error: 'Ally not in play under this player' };
  const { charId: bearerCharId, attachment: ally } = tapped;
  if (ally.status !== CardStatus.Untapped) return { state, error: 'Ally must be untapped to activate' };

  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike || strike.characterId !== bearerCharId) {
    return { state, error: 'Ally does not belong to the character facing this body check' };
  }
  const struckAlly = combat.strikeAssignments.some(a => a.characterId === ally.instanceId);
  if (!struckAlly) {
    return { state, error: 'Ally was not also targeted by a strike from this attack' };
  }

  const allyDef = defById(state, ally.definitionId);
  const boostEffect = getCardEffects(allyDef).find(
    (e): e is AllyBodyCheckBoostEffect => e.type === 'ally-body-check-boost',
  );
  if (!boostEffect) return { state, error: 'Ally has no ally-body-check-boost effect' };

  const allyName = (allyDef as { name?: string } | undefined)?.name ?? (ally.definitionId as string);
  logDetail(`${allyName} tapped — +${boostEffect.value} body to ${bearerCharId as string} for the pending body check`);

  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? { ...a, strikeBodyPenalty: (a.strikeBodyPenalty ?? 0) + boostEffect.value }
      : a,
  );

  return {
    state: {
      ...updatePlayer(state, playerIndex, () => tapped.player),
      combat: { ...combat, strikeAssignments: newAssignments },
    },
  };
}

/**
 * Handle `capture-in-lieu-of-body-check` (No Better Use, ba-41): instead of
 * rolling the pending CvCC character body check, tap the bearer to place the
 * opposing character "off to the side" with the card. Bypasses the roll
 * entirely — the outcome does not depend on the body value at all — and
 * marks the current strike `result: 'captured'` (the same disposition
 * `take-prisoner` uses) so `combat-finalize.ts`'s wound-triggered passives do
 * not fire on it.
 */
export function handleCaptureInLieuOfBodyCheck(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'capture-in-lieu-of-body-check') return wrongActionType(state, action, 'capture-in-lieu-of-body-check');
  if (!combat.isCvCC) return { state, error: 'No Better Use: not a company-vs-company combat' };
  if (combat.bodyCheckTarget !== 'character' && combat.bodyCheckTarget !== 'attacker-character') {
    return { state, error: 'No Better Use: no character body check pending' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  if (playerIndex < 0) return { state, error: 'Player not found' };
  const player = state.players[playerIndex];
  const bearer = player.characters[action.characterId];
  if (!bearer) return { state, error: 'No Better Use: bearer not in play' };
  if (bearer.status !== CardStatus.Untapped) return { state, error: 'No Better Use: bearer must be untapped' };

  const item = bearer.items.find(i => i.instanceId === action.cardInstanceId);
  if (!item) return { state, error: 'No Better Use: card not on bearer' };
  const itemDef = defById(state, item.definitionId);
  if (!getCardEffects(itemDef).some(e => e.type === 'cvcc-capture-in-lieu-of-body-check')) {
    return { state, error: 'No Better Use: card has no capture-in-lieu-of-body-check effect' };
  }
  if (noBetterUseAlreadyUsed(state, item.instanceId)) {
    return { state, error: 'No Better Use: already used' };
  }

  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  if (!strike) return { state, error: 'No Better Use: no pending strike' };

  let targetOwnerIndex: number;
  let targetCharacterId: CardInstanceId;
  if (combat.bodyCheckTarget === 'attacker-character') {
    if (!strike.attackingCharacterId) return { state, error: 'No Better Use: no attacking character' };
    targetOwnerIndex = getPlayerIndex(state, combat.attackingPlayerId);
    targetCharacterId = strike.attackingCharacterId;
  } else {
    targetOwnerIndex = getPlayerIndex(state, combat.defendingPlayerId);
    targetCharacterId = strike.characterId;
    if (!state.players[targetOwnerIndex].characters[targetCharacterId]) {
      return { state, error: 'No Better Use: target is not a character (allies are exempt)' };
    }
  }

  const targetDefId = state.players[targetOwnerIndex].characters[targetCharacterId]?.definitionId;
  const targetName = targetDefId ? cardName(state, targetDefId, 'character') : 'character';
  logDetail(`No Better Use: ${action.characterId as string} taps to capture ${targetName} in lieu of body check`);

  const tappedState = updatePlayer(state, playerIndex, p => updateCharacter(p, action.characterId, c => ({ ...c, status: CardStatus.Tapped })));

  // Snapshot the bearer's own company site for the eventual release.
  const bearerCompany = findCharacterCompany(player.companies, action.characterId);
  const site = bearerCompany?.currentSite ?? null;

  const captured = captureCharacterInLieuOfBodyCheck(
    tappedState,
    targetOwnerIndex,
    targetCharacterId,
    item.instanceId,
    action.characterId,
    action.player,
    site,
  );
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex ? { ...a, resolved: true, result: 'captured' as const } : a);
  const newCombat = { ...combat, strikeAssignments: newAssignments };

  return advanceStrikeOrFinalize(captured, newCombat, [
    { effect: 'text-notification', message: `${targetName} is placed off to the side by No Better Use, in lieu of the body check` },
  ]);
}

/**
 * Activate an in-play item's `modify-attack` effect to adjust the
 * current attack's prowess and/or body. When cost is `{ tap: "self" }` the
 * item taps — unless its `discardIfBearerNot` clause fires (bearer race
 * mismatch), in which case the item is discarded instead. When cost is
 * `{ tap: "bearer" }` only the bearer taps; the item stays untapped (e.g.
 * Star-glass). Modifiers apply uniformly: prowess to every strike (via
 * `combat.strikeProwess`) and body to the creature body check (via
 * `combat.creatureBody`). If `enqueueCorruptionCheck` is true, a corruption
 * check is enqueued on the bearer after the modification.
 *
 * Used by Black Arrow (tw-494) and Star-glass (tw-330).
 *
 * The no-`characterInstanceId` branch covers three *played* sources sharing the
 * same modifier math: a hand card (`fromHand`), an unrevealed on-guard card the
 * attacker placed, and — for `fromAltPermanentEvent` — an in-play dual-mode
 * creature permanent-event the hazard player converts to a short-event during
 * the opponent's M/H phase (Hoarmûrath of Dír tw-44), which additionally leaves
 * play and charges one hazard-limit slot.
 */
export function handleModifyAttack(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'modify-attack') return wrongActionType(state, action, 'modify-attack');
  if (combat.phase !== 'assign-strikes') return { state, error: 'Can only modify attack before strikes are assigned' };
  if (combat.strikeAssignments.length > 0) return { state, error: 'Strikes already assigned — too late to modify attack' };

  const playerIndex = state.players.findIndex(p => p.id === action.player);
  if (playerIndex < 0) return { state, error: 'Player not found' };
  const player = state.players[playerIndex];

  // --- From-hand path (also covers the attacker revealing a modify-attack
  //     hazard event they placed on-guard, e.g. Unabated in Malice ba-26) ---
  if (action.characterInstanceId === undefined) {
    let sourceCard = findById(player.hand, action.cardInstanceId);
    // On-guard fallback: an unrevealed modify-attack card the attacker placed
    // on the defending company plays exactly like a from-hand card, but is
    // removed from the on-guard zone instead of the hand (rule 2.V.i).
    let onGuard: { defenderIndex: number; companyIndex: number; ogIndex: number } | undefined;
    if (!sourceCard) {
      const defenderIndex = state.players.findIndex(p => p.id === combat.defendingPlayerId);
      if (defenderIndex >= 0) {
        const defender = state.players[defenderIndex];
        const companyIndex = defender.companies.findIndex(c => c.id === combat.companyId);
        if (companyIndex >= 0) {
          const ogIndex = defender.companies[companyIndex].onGuardCards.findIndex(
            og => !og.revealed && og.instanceId === action.cardInstanceId,
          );
          if (ogIndex >= 0) {
            const og = defender.companies[companyIndex].onGuardCards[ogIndex];
            sourceCard = { instanceId: og.instanceId, definitionId: og.definitionId };
            onGuard = { defenderIndex, companyIndex, ogIndex };
          }
        }
      }
    }
    // In-play fallback: a dual-mode creature permanent-event (tw-44) the hazard
    // player taps during the opponent's M/H phase. It "becomes a short-event" —
    // same modifier math as a hand card, but it leaves `cardsInPlay` and costs
    // one hazard-limit slot (charged below).
    let altPermanentEvent = false;
    if (!sourceCard) {
      const inPlayCard = findById(player.cardsInPlay, action.cardInstanceId);
      if (inPlayCard) {
        sourceCard = { instanceId: inPlayCard.instanceId, definitionId: inPlayCard.definitionId };
        altPermanentEvent = true;
        if (inPlayCard.status !== CardStatus.Untapped) return { state, error: 'modify-attack: permanent-event is already tapped' };
      }
    }
    if (!sourceCard) return { state, error: 'Card not in hand' };
    const handCard = sourceCard;
    const cardDef = defById(state, handCard.definitionId);
    if (!cardDef) return { state, error: 'Card definition not found' };
    // A card may declare multiple from-hand modify-attack effects (distinct
    // modes gated by different `player`/`when` combinations — Adûnaphel
    // Unleashed le-161). Pick the one matching the acting player and whose
    // `when` (if any) matches, mirroring `modifyAttackActions`'s selection so
    // the reducer applies exactly the effect that was offered as legal.
    const candidateEffects = getCardEffects(cardDef).filter(
      (e): e is import('../types/effects.js').ModifyAttackEffect =>
        e.type === 'modify-attack' && (altPermanentEvent ? !!(e).fromAltPermanentEvent : !!(e).fromHand),
    );
    const modifyCtx = candidateEffects.length > 1
      ? buildPlayedModifyAttackContext(state, combat, buildInPlayNames(state))
      : {};
    const effect = candidateEffects.find(e => {
      if (candidateEffects.length <= 1) return true;
      const expected = e.player === 'attacker' ? combat.attackingPlayerId : combat.defendingPlayerId;
      if (action.player !== expected) return false;
      if (e.when && !matchesCondition(e.when, modifyCtx)) return false;
      return true;
    });
    if (!effect) return { state, error: `Card has no modify-attack (${altPermanentEvent ? 'fromAltPermanentEvent' : 'fromHand'}) effect` };

    if (altPermanentEvent) {
      const altEvent = getCardEffects(cardDef).find(e => e.type === 'creature-alt-event');
      if (altEvent?.type !== 'creature-alt-event' || altEvent.mode !== 'permanent-event' || altEvent.persistent) {
        return { state, error: 'modify-attack: card in play is not a convertible creature-permanent-event' };
      }
      // Printed timing: "tapped during the opponent's movement/hazard phase".
      if (state.phaseState.phase !== Phase.MovementHazard) {
        return { state, error: 'modify-attack: a creature-permanent-event may only be tapped during the opponent\'s movement/hazard phase' };
      }
      if (!('effects' in cardDef && hasPlayFlag(cardDef, 'no-hazard-limit'))) {
        const charge = chargeHazardLimit(state, state.phaseState, combat.companyId, 'modify-attack');
        if ('error' in charge) return { state, error: charge.error };
      }
    }

    const expectedPlayerId = effect.player === 'attacker'
      ? combat.attackingPlayerId
      : combat.defendingPlayerId;
    if (action.player !== expectedPlayerId) {
      return { state, error: `Only ${effect.player === 'attacker' ? 'attacking' : 'defending'} player can play this card` };
    }

    // CoE rule 8.12: a plain from-hand modify-attack played by the attacker
    // counts against the company's hazard limit unless the card bypasses it
    // (`play-flag: no-hazard-limit`), mirroring the fromAltPermanentEvent
    // charge above. Site-phase combat has no hazard-limit bookkeeping, so
    // on-guard reveals (which reuse this same from-hand path) are unaffected.
    if (!altPermanentEvent && !onGuard && effect.player === 'attacker' && state.phaseState.phase === Phase.MovementHazard
      && !('effects' in cardDef && hasPlayFlag(cardDef, 'no-hazard-limit'))) {
      const charge = chargeHazardLimit(state, state.phaseState, combat.companyId, 'modify-attack');
      if ('error' in charge) return { state, error: charge.error };
    }

    // Prior copies of this exact card definition already played on this
    // attack (attack-scoped `attack-card-played` markers) — exposed to
    // `prowessModifierExpr` as `sameCardPlaysOnAttack` for cards whose bonus
    // scales with the running count (Prowess of Age td-55: this play's own
    // marker is added further below via `effect.trackAttackPlays`, after this
    // count is read, so it reflects prior plays only).
    const sameCardPlaysOnAttack = countConstraintsFromDefinition(state, handCard.definitionId, 'attack');
    const prowessModifier = effect.prowessModifierExpr !== undefined
      ? Math.round(evaluateExpr(effect.prowessModifierExpr, {
          nazgulPermanentEventsInPlay: countNazgulPermanentEventsInPlay(state),
          sameCardPlaysOnAttack,
        }))
      : effect.prowessModifier ?? 0;
    const bodyModifier = effect.bodyModifier ?? 0;
    const strikesModifier = effect.strikesModifier ?? 0;
    const newStrikeProwess = combat.strikeProwess + prowessModifier;
    const newCreatureBody = combat.creatureBody === null ? null : combat.creatureBody + bodyModifier;
    // Strike count. `setStrikesTo` reduces the attack to a fixed number of
    // strikes ("reduced to one strike", Darkness Wielded ba-55) — never
    // increasing the count and clamped to a minimum of 1. Otherwise
    // `strikesModifier` applies a delta (also clamped to a minimum of 1, same
    // rule as the in-play path).
    const newStrikesTotal = effect.setStrikesTo !== undefined
      ? Math.max(1, Math.min(combat.strikesTotal, effect.setStrikesTo))
      : strikesModifier !== 0 ? Math.max(1, combat.strikesTotal + strikesModifier) : combat.strikesTotal;
    // The applied strike delta (may differ from strikesModifier if clamped);
    // stored so a cancel-redirect reverses exactly what was applied.
    const appliedStrikesDelta = newStrikesTotal - combat.strikesTotal;
    // FEAR! FIRE! FOES! (as-29) Mode B: the detainment attack "becomes normal".
    const removesDetainment = effect.removeDetainment === true && combat.detainment;
    const newDetainment = removesDetainment ? false : combat.detainment;
    const cardLabel = cardDef.name;
    logDetail(`Modify-attack (${altPermanentEvent ? 'permanent-event tap' : onGuard ? 'on-guard reveal' : 'from hand'}): ${cardLabel} played — strike prowess ${combat.strikeProwess} → ${newStrikeProwess}, creature body ${combat.creatureBody ?? 'n/a'} → ${newCreatureBody ?? 'n/a'}, strikes ${combat.strikesTotal} → ${newStrikesTotal}${removesDetainment ? ', detainment → normal' : ''}${effect.firstExcessStrikePenalty !== undefined ? `, first excess strike penalty → -${effect.firstExcessStrikePenalty}` : ''}`);

    // Cancel protection: the first attempt to cancel the attack instead
    // strips these modifiers (Unabated in Malice ba-26). Record the exact
    // deltas applied so the redirect reverses them precisely.
    const cancelProtection = effect.firstCancelRemovesEffect
      ? {
          sourceInstanceId: handCard.instanceId,
          strikesModifier: appliedStrikesDelta,
          prowessModifier,
          bodyModifier,
        }
      : undefined;
    if (cancelProtection) {
      logDetail(`${cardLabel}: cancel protection active — first cancel attempt will strip this card's modifiers instead of ending the attack`);
    }

    // The attacker owns the card (whether played from hand or revealed
    // on-guard), so it always lands in the attacker's discard pile.
    const discarded = toCardInstance(handCard);
    let baseState: GameState;
    if (altPermanentEvent) {
      // "Becomes a short-event": leaves play and is discarded.
      baseState = updatePlayer(state, playerIndex, p => ({
        ...p,
        cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== handCard.instanceId),
        discardPile: [...p.discardPile, discarded],
      }));
      // Tapping counts one against the company's hazard limit (printed rule;
      // CoE 8.12 for combat-window hazard actions).
      if (baseState.phaseState.phase === Phase.MovementHazard && !('effects' in cardDef && hasPlayFlag(cardDef, 'no-hazard-limit'))) {
        const mhState = baseState.phaseState;
        const played = (mhState.hazardsPlayedThisCompany ?? 0) + 1;
        logDetail(`${cardDef.name}: permanent-event tapped in combat — counts against hazard limit (${played})`);
        baseState = { ...baseState, phaseState: { ...mhState, hazardsPlayedThisCompany: played } };
      }
    } else if (onGuard) {
      const og = onGuard;
      const withoutOnGuard = updatePlayer(state, og.defenderIndex, p => {
        const companies = [...p.companies];
        const company = companies[og.companyIndex];
        const onGuardCards = [...company.onGuardCards];
        onGuardCards.splice(og.ogIndex, 1);
        companies[og.companyIndex] = { ...company, onGuardCards };
        return { ...p, companies };
      });
      baseState = updatePlayer(withoutOnGuard, playerIndex, p => ({
        ...p,
        discardPile: [...p.discardPile, discarded],
      }));
    } else {
      baseState = updatePlayer(state, playerIndex, p => ({
        ...p,
        hand: removeById(p.hand, handCard.instanceId),
        discardPile: [...p.discardPile, discarded],
      }));
      // CoE rule 8.12: charge the hazard limit for the attacker's own plain
      // from-hand play (mirroring the fromAltPermanentEvent charge above).
      if (effect.player === 'attacker' && baseState.phaseState.phase === Phase.MovementHazard
        && !('effects' in cardDef && hasPlayFlag(cardDef, 'no-hazard-limit'))) {
        const mhState = baseState.phaseState;
        const played = (mhState.hazardsPlayedThisCompany ?? 0) + 1;
        logDetail(`${cardDef.name}: from-hand modify-attack played in combat — counts against hazard limit (${played})`);
        baseState = { ...baseState, phaseState: { ...mhState, hazardsPlayedThisCompany: played } };
      }
    }

    // Adûnaphel Unleashed (le-161) Mode B: "You choose defending characters."
    // Grants attacker-chooses-defenders for this attack. Strike assignment
    // has not started yet (checked above), so `assignmentPhase` is still
    // either `'defender'` (the normal CvCC/creature start) or `'cancel-window'`
    // (an attacker-chooses creature attack already pending the defender's
    // cancel opportunity) — only the former needs to be redirected; the latter
    // already routes to the attacker once the defender passes.
    const grantsAttackerChooses = effect.grantAttackerChoosesDefenders === true;
    const newAssignmentPhase = grantsAttackerChooses && combat.assignmentPhase === 'defender'
      ? 'attacker' as const
      : combat.assignmentPhase;
    const newBodyCheckModifier = effect.bodyCheckModifier
      ? (combat.bodyCheckModifier ?? 0) + effect.bodyCheckModifier
      : combat.bodyCheckModifier;
    if (grantsAttackerChooses) {
      logDetail(`${cardLabel}: grants attacker-chooses-defenders — assignment phase ${combat.assignmentPhase} → ${newAssignmentPhase}`);
    }
    if (effect.bodyCheckModifier) {
      logDetail(`${cardLabel}: body-check modifier ${combat.bodyCheckModifier ?? 0} → ${newBodyCheckModifier}`);
    }

    let newState: GameState = {
      ...baseState,
      combat: {
        ...combat,
        strikeProwess: newStrikeProwess,
        creatureBody: newCreatureBody,
        strikesTotal: newStrikesTotal,
        detainment: newDetainment,
        assignmentPhase: newAssignmentPhase,
        ...(grantsAttackerChooses ? { attackerChoosesDefenders: true } : {}),
        ...(newBodyCheckModifier !== undefined ? { bodyCheckModifier: newBodyCheckModifier } : {}),
        ...(effect.firstExcessStrikePenalty !== undefined ? { firstExcessStrikePenalty: effect.firstExcessStrikePenalty } : {}),
        ...(cancelProtection ? { cancelProtection } : {}),
        ...(effect.postAttackMindRollSplit
          ? { mindRollSplitPending: { threshold: effect.postAttackMindRollSplit.threshold } }
          : {}),
        ...(effect.attachCorruptionOnWound
          ? {
              pendingCorruptionAttach: {
                sourceCardInstanceId: handCard.instanceId,
                sourceCardDefinitionId: handCard.definitionId,
                ownerPlayerIndex: playerIndex,
              },
            }
          : {}),
      },
    };

    const attackDupLimit = getCardEffects(cardDef).find(
      (e): e is import('../types/effects.js').DuplicationLimitEffect =>
        e.type === 'duplication-limit' && (e as { scope: string }).scope === 'attack',
    );
    if (attackDupLimit || effect.trackAttackPlays) {
      newState = addConstraint(newState, {
        source: handCard.instanceId,
        sourceDefinitionId: handCard.definitionId,
        scope: { kind: 'attack' },
        target: { kind: 'player', playerId: action.player },
        kind: { type: 'attack-card-played' },
      });
      logDetail(`${cardLabel}: added attack-card-played marker (${attackDupLimit ? 'duplication-limit scope attack' : 'trackAttackPlays'})`);
    }

    return { state: newState };
  }

  // --- In-play item path ---
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can modify attack with an item' };

  const charData = player.characters[action.characterInstanceId];
  if (!charData) return { state, error: 'Character not found' };

  const itemIndex = charData.items.findIndex(it => it.instanceId === action.cardInstanceId);
  if (itemIndex < 0) {
    // --- In-play ally path (e.g. Great Bats: tap to remove the "attacker
    // chooses defending characters" rule from the attack) ---
    const allyIndex = charData.allies.findIndex(a => a.instanceId === action.cardInstanceId);
    if (allyIndex < 0) return { state, error: 'Card not found on character' };
    const ally = charData.allies[allyIndex];
    const allyDef = defById(state, ally.definitionId);
    if (!allyDef) return { state, error: 'Ally definition not found' };
    const allyEffect = getCardEffects(allyDef).find(
      (e): e is import('../types/effects.js').ModifyAttackEffect =>
        e.type === 'modify-attack' && !(e).fromHand && (e).scope !== 'current-strike',
    );
    if (!allyEffect) return { state, error: 'Ally has no modify-attack effect' };
    if (allyEffect.cost?.tap !== 'self') return { state, error: 'Ally modify-attack requires a tap-self cost' };
    if (ally.status !== CardStatus.Untapped) return { state, error: 'Ally must be untapped to activate' };
    if (allyEffect.removeAttackerChoosesDefenders && !combat.attackerChoosesDefenders) {
      return { state, error: 'Attack has no attacker-chooses-defenders rule to remove' };
    }

    const allyName = allyDef?.name ?? ally.definitionId as string;
    const updatedAllyChar = {
      ...charData,
      allies: charData.allies.map((a, i) => i === allyIndex ? { ...a, status: CardStatus.Tapped } : a),
    };
    const allyPlayers = clonePlayers(state);
    allyPlayers[playerIndex] = {
      ...allyPlayers[playerIndex],
      characters: { ...allyPlayers[playerIndex].characters, [action.characterInstanceId as string]: updatedAllyChar },
    };

    const allyProwessMod = allyEffect.prowessModifier ?? 0;
    const allyBodyMod = allyEffect.bodyModifier ?? 0;
    const allyStrikeProwess = combat.strikeProwess + allyProwessMod;
    const allyCreatureBody = combat.creatureBody === null ? null : combat.creatureBody + allyBodyMod;
    // Removing attacker-chooses-defenders hands strike assignment back to the
    // defender: clear the flag, and if the attacker was already up to assign
    // (no strikes placed yet — guaranteed by the pre-assignment gate above),
    // flip the assignment sub-phase back to the defender. In the cancel-window
    // the sub-phase stays put; the defender's eventual pass now routes to
    // 'defender' instead of 'attacker'.
    const removeRule = allyEffect.removeAttackerChoosesDefenders === true && combat.attackerChoosesDefenders === true;
    const newAssignmentPhase = removeRule && combat.assignmentPhase === 'attacker' ? 'defender' : combat.assignmentPhase;
    logDetail(`Modify-attack: tapping ally ${allyName}${removeRule ? ' — attacker-chooses-defenders removed, defender assigns strikes' : ''} (prowess ${formatSignedNumber(allyProwessMod)}, body ${formatSignedNumber(allyBodyMod)})`);

    return {
      state: {
        ...state,
        players: allyPlayers,
        combat: {
          ...combat,
          strikeProwess: allyStrikeProwess,
          creatureBody: allyCreatureBody,
          assignmentPhase: newAssignmentPhase,
          ...(removeRule ? { attackerChoosesDefenders: undefined } : {}),
        },
      },
    };
  }
  const item = charData.items[itemIndex];

  const itemDef = defById(state, item.definitionId);
  if (!itemDef) return { state, error: 'Item definition not found' };
  const effect = getCardEffects(itemDef).find(
    (e): e is import('../types/effects.js').ModifyAttackEffect =>
      e.type === 'modify-attack' &&
      !(e).fromHand &&
      (e).scope !== 'current-strike',
  );
  if (!effect) return { state, error: 'Item has no modify-attack effect' };

  const tapCost = effect.cost?.tap;
  const bearerOnly = tapCost === 'bearer';

  if (!bearerOnly && item.status !== CardStatus.Untapped) {
    return { state, error: 'Item must be untapped to activate' };
  }
  if (bearerOnly && charData.status !== CardStatus.Untapped) {
    return { state, error: 'Bearer must be untapped to activate this item' };
  }

  const charDef = defById(state, charData.definitionId);
  if (!charDef || !isCharacterCard(charDef)) return { state, error: 'Bearer is not a character' };

  const prowessModifier = effect.prowessModifier ?? 0;
  const bodyModifier = effect.bodyModifier ?? 0;
  const strikesModifier = effect.strikesModifier ?? 0;
  const itemName = itemDef.name;

  const shouldDiscard = !bearerOnly && effect.discardIfBearerNot
    ? !effect.discardIfBearerNot.race.includes(charDef.race)
    : false;

  let updatedChar;
  if (bearerOnly) {
    logDetail(`Modify-attack: bearer ${charDef.name ?? ''} taps via ${itemName} (prowess ${formatSignedNumber(prowessModifier)}, body ${formatSignedNumber(bodyModifier)})`);
    updatedChar = { ...charData, status: CardStatus.Tapped };
  } else if (shouldDiscard) {
    logDetail(`Modify-attack: ${itemName} tapped — bearer ${charDef.name ?? ''} is not a ${effect.discardIfBearerNot?.race.join('/') ?? ''}, discarding item`);
    updatedChar = { ...charData, items: charData.items.filter((_, i) => i !== itemIndex) };
  } else {
    logDetail(`Modify-attack: tapping ${itemName} on ${charDef.name ?? ''} (prowess ${formatSignedNumber(prowessModifier)}, body ${formatSignedNumber(bodyModifier)}, strikes ${formatSignedNumber(strikesModifier)})`);
    updatedChar = {
      ...charData,
      items: charData.items.map((it, i) => i === itemIndex ? { ...it, status: CardStatus.Tapped } : it),
    };
  }

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    characters: { ...newPlayers[playerIndex].characters, [action.characterInstanceId as string]: updatedChar },
  };

  if (shouldDiscard) {
    newPlayers[playerIndex] = {
      ...newPlayers[playerIndex],
      discardPile: [...newPlayers[playerIndex].discardPile, toCardInstance(item)],
    };
  }

  const newStrikeProwess = combat.strikeProwess + prowessModifier;
  const newCreatureBody = combat.creatureBody === null ? null : combat.creatureBody + bodyModifier;
  const newStrikesTotal = strikesModifier !== 0 ? Math.max(1, combat.strikesTotal + strikesModifier) : combat.strikesTotal;
  logDetail(`Modify-attack applied: strike prowess ${combat.strikeProwess} → ${newStrikeProwess}, creature body ${combat.creatureBody ?? 'n/a'} → ${newCreatureBody ?? 'n/a'}, strikes ${combat.strikesTotal} → ${newStrikesTotal}`);

  // Phial of Galadriel (dm-176): free strike assignment also overrides the
  // attack's own attacker-chooses-defenders rule, exactly like the
  // dedicated `removeAttackerChoosesDefenders` ally path above — hand
  // assignment back to the defender if the attacker was already up to
  // assign (no strikes placed yet, guaranteed by the pre-assignment gate).
  const overridesAttackerChooses = effect.grantsDefenderFreeStrikeAssignment === true
    && combat.attackerChoosesDefenders === true;
  const newAssignmentPhase = overridesAttackerChooses && combat.assignmentPhase === 'attacker'
    ? 'defender' as const
    : combat.assignmentPhase;
  if (effect.grantsDefenderFreeStrikeAssignment) {
    logDetail(`Modify-attack: ${itemName} grants free strike assignment — defender may assign to any character regardless of status${overridesAttackerChooses ? ', overriding attacker-chooses-defenders' : ''}`);
  }

  let resultState: GameState = {
    ...state,
    players: newPlayers,
    combat: {
      ...combat,
      strikeProwess: newStrikeProwess,
      creatureBody: newCreatureBody,
      strikesTotal: newStrikesTotal,
      assignmentPhase: newAssignmentPhase,
      ...(effect.grantsDefenderFreeStrikeAssignment ? { defenderFreeStrikeAssignment: true } : {}),
      ...(overridesAttackerChooses ? { attackerChoosesDefenders: undefined } : {}),
    },
  };

  if (effect.enqueueCorruptionCheck) {
    const company = companyById(player.companies, combat.companyId);
    const scope = companySubphaseScope(state.phaseState.phase, company!.id);
    logDetail(`Modify-attack: enqueuing corruption check on bearer ${action.characterInstanceId as string} (${itemName})`);
    resultState = enqueueCorruptionCheck(resultState, {
      source: item.instanceId,
      actor: action.player,
      scope,
      characterId: action.characterInstanceId,
      reason: itemName,
    });
  }

  return { state: resultState };
}

/**
 * Transfer one item from an eliminated character to an unwounded companion.
 * Available during the 'item-salvage' combat phase (CoE rule 3.I.2).
 */
export function handleSalvageItem(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'salvage-item') return wrongActionType(state, action, 'salvage-item');
  if (combat.phase !== 'item-salvage') return { state, error: 'Not in item-salvage phase' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can salvage items' };

  const { salvageItems, salvageRecipients } = combat;
  if (!salvageItems || !salvageRecipients) return { state, error: 'No salvage state' };

  // Validate the item exists in salvage pool
  const itemIndex = salvageItems.findIndex(it => it.instanceId === action.itemInstanceId);
  if (itemIndex < 0) return { state, error: 'Item not available for salvage' };

  // Validate the recipient is eligible
  if (!salvageRecipients.includes(action.recipientCharacterId)) {
    return { state, error: 'Character not eligible to receive salvaged item' };
  }

  const item = salvageItems[itemIndex];
  const newPlayers = clonePlayers(state);
  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);
  const recipientChar = newPlayers[defIdx].characters[action.recipientCharacterId];
  if (!recipientChar) return { state, error: 'Recipient character not found' };

  logDetail(`Salvaging item ${item.instanceId as string} to character ${action.recipientCharacterId as string}`);

  // Transfer the item to the recipient character
  const newCharacters = { ...newPlayers[defIdx].characters };
  newCharacters[action.recipientCharacterId] = {
    ...recipientChar,
    items: [...recipientChar.items, item],
  };
  newPlayers[defIdx] = { ...newPlayers[defIdx], characters: newCharacters };

  // Remove item from salvage pool and recipient from eligible list
  const remainingItems = salvageItems.filter((_, i) => i !== itemIndex);
  const remainingRecipients = salvageRecipients.filter(r => r !== action.recipientCharacterId);

  // If no more items or no more recipients, finish salvage
  if (remainingItems.length === 0 || remainingRecipients.length === 0) {
    // Discard any remaining unsalvaged items
    for (const leftover of remainingItems) {
      logDetail(`Discarding unsalvaged item ${leftover.instanceId as string}`);
      newPlayers[defIdx] = {
        ...newPlayers[defIdx],
        discardPile: [...newPlayers[defIdx].discardPile, toCardInstance(leftover)],
      };
    }
    return finishSalvage({ ...state, players: newPlayers }, combat);
  }

  // More items and recipients available — stay in salvage phase
  logDetail(`Item salvage continues: ${remainingItems.length} item(s) remaining, ${remainingRecipients.length} recipient(s) remaining`);
  return {
    state: {
      ...state,
      players: newPlayers,
      combat: { ...combat, salvageItems: remainingItems, salvageRecipients: remainingRecipients },
    },
  };
}

/**
 * Transition out of item-salvage phase back to the normal combat flow.
 * Clears salvage fields and advances to the next strike or finalizes combat.
 */
export function finishSalvage(state: GameState, combat: CombatState): ReducerResult {
  const cleanCombat: CombatState = { ...combat, phase: 'body-check', salvageItems: undefined, salvageRecipients: undefined };
  return advanceStrikeOrFinalize(state, cleanCombat);
}

/**
 * Defender discards one item from the offered pool after a successful strike
 * with a `strikeEffect` (An Article Missing dm-43, Thief tw-102, Pick-pocket
 * tw-79) — `combat.discardItemOptions` was already scoped to the company or
 * to the struck character alone when the phase was entered. Once the item is
 * discarded, combat advances to the next strike or finalizes.
 */
export function handleDiscardItemFromCompany(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'discard-item-from-company') return wrongActionType(state, action, 'discard-item-from-company');
  if (combat.phase !== 'discard-item-from-company') return { state, error: 'Not in discard-item-from-company phase' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only defending player can discard the item' };

  const { discardItemOptions } = combat;
  if (!discardItemOptions) return { state, error: 'No discard-item options in combat state' };

  const itemIndex = discardItemOptions.findIndex(it => it.instanceId === action.itemInstanceId);
  if (itemIndex < 0) return { state, error: 'Item not available for discard' };

  const item = discardItemOptions[itemIndex];
  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);

  // Remove item from its bearer and add to discard pile
  const removed = removeAttachment(state.players[defIdx], 'items', item.instanceId);
  if (!removed) return { state, error: 'Item not found on any character in company' };

  logDetail(`discard-item strike effect: discarding item ${item.instanceId as string}`);
  const newPlayers = clonePlayers(state);
  newPlayers[defIdx] = {
    ...removed.player,
    discardPile: [...removed.player.discardPile, toCardInstance(item)],
  };

  const cleanCombat: CombatState = { ...combat, phase: 'resolve-strike', discardItemOptions: undefined };
  return advanceStrikeOrFinalize({ ...state, players: newPlayers }, cleanCombat);
}

/**
 * Handle a `cancel-prisoner-taking` action during the
 * `cancel-prisoner-taking-choice` combat phase (Noble Hound dm-179): the
 * defending player discards the protecting ally, canceling this strike's
 * prisoner-taking outcome. The struck character is wounded normally instead
 * (the card's "resolved normally... per combat result") and the combat
 * continues to the ordinary body check, exactly as any other wounded
 * character would.
 */
export function handleCancelPrisonerTaking(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-prisoner-taking') return wrongActionType(state, action, 'cancel-prisoner-taking');
  if (combat.phase !== 'cancel-prisoner-taking-choice') return { state, error: 'Not in cancel-prisoner-taking-choice phase' };
  if (action.player !== combat.defendingPlayerId) return { state, error: 'Only the defending player can cancel prisoner-taking' };
  if (combat.cancelPrisonerTakingOffer?.allyId !== action.cardInstanceId) return { state, error: 'Ally not offered for cancel-prisoner-taking' };

  const defIdx = getPlayerIndex(state, combat.defendingPlayerId);

  const removed = removeAttachment(state.players[defIdx], 'allies', action.cardInstanceId);
  if (!removed) return { state, error: 'Ally not found on any character in company' };

  logDetail(`cancel-prisoner-taking: discarding ${action.cardInstanceId as string} — ${removed.charId as string} is wounded instead of taken prisoner`);

  const woundedChar = { ...removed.player.characters[removed.charId], status: CardStatus.Inverted };
  const newPlayers = clonePlayers(state);
  newPlayers[defIdx] = {
    ...removed.player,
    characters: { ...removed.player.characters, [removed.charId as string]: woundedChar },
    discardPile: [...removed.player.discardPile, toCardInstance(removed.attachment)],
  };

  const newCombat: CombatState = { ...combat, phase: 'body-check', bodyCheckTarget: 'character', cancelPrisonerTakingOffer: undefined };
  return { state: { ...state, players: newPlayers, combat: newCombat } };
}

/**
 * Handle a `pass` action during the `cancel-prisoner-taking-choice` combat
 * phase (Noble Hound dm-179): the defending player declines to discard the
 * protecting ally, so the prisoner-taking proceeds normally — the character
 * is bound as a prisoner (CoE rule 8.35) instead of a body check.
 */
export function finalizeCombatFromCancelPrisonerTakingOffer(state: GameState, combat: CombatState): ReducerResult {
  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const strike = combat.strikeAssignments[combat.currentStrikeIndex];
  const charData = state.players[defPlayerIndex].characters[strike.characterId];

  let newState = state;
  if (charData) {
    const takePrisonerResult = findTakePrisonerHazard(state, defPlayerIndex, charData.hazards);
    if (takePrisonerResult) {
      newState = applyTakePrisoner(state, defPlayerIndex, strike.characterId, takePrisonerResult);
    } else if (combat.trollPursePrisoner) {
      newState = applyTakePrisonerAtSite(
        state, defPlayerIndex, strike.characterId,
        combat.trollPursePrisoner.hostInstanceId, combat.trollPursePrisoner.siteInstanceId,
      );
    }
  }

  logDetail(`cancel-prisoner-taking declined — ${strike.characterId as string} is taken prisoner`);
  const cleanCombat: CombatState = {
    ...combat,
    phase: 'resolve-strike',
    cancelPrisonerTakingOffer: undefined,
    // The paused assignment was recorded 'wounded' pending this choice — the
    // decline resolves it as a capture, so wound triggers must not fire.
    strikeAssignments: combat.strikeAssignments.map((a, i) =>
      i === combat.currentStrikeIndex ? { ...a, result: 'captured' as const } : a),
  };
  return advanceStrikeOrFinalize(newState, cleanCombat);
}

/**
 * Remove a card-triggered-attack card from cardsInPlay and send it to the
 * defending player's discard pile. Used when no untapped characters survive
 * the attack (or the attack is cancelled) so the card cannot be assigned.
 */

/**
 * Finalize combat after all strikes are resolved.
 *
 * If all strikes were defeated (result === 'success' — the character won the
 * roll and any creature body check failed), the creature card moves to the
 * defending player's marshalling point pile. If any strike was not defeated
 * (e.g. a creature that passed its body check, result === 'survived'), the
 * creature stays in the hazard player's discard pile.
 */
/**
 * Handle a `take-trophy` action during the `trophy-offer` combat phase.
 *
 * The chosen Orc/Troll character receives the defeated creature card as a
 * trophy (placed under the character). The creature is removed from the
 * kill pile (kill-MP was already counted in finalizeCombat) and stored on
 * the character instead. After taking a trophy the phase returns to normal
 * (removes the combat state).
 */
export function handleTakeTrophy(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'take-trophy') return wrongActionType(state, action, 'take-trophy');
  if (combat.phase !== 'trophy-offer') return { state, error: 'take-trophy only valid in trophy-offer phase' };

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const char = defPlayer.characters[action.characterId];
  if (!char) return { state, error: 'Trophy character not found' };

  // Find the creature instance in the kill pile (it was moved there in finalizeCombat)
  const creatureInKillPile = findById(defPlayer.killPile, action.creatureInstanceId);
  if (!creatureInKillPile) return { state, error: 'Creature not found in kill pile for trophy' };

  logDetail(`Trophy: ${action.characterId as string} takes ${action.creatureInstanceId as string} as a trophy (MELE §8.37)`);

  // Remove from kill pile and add to character's trophies
  const newKillPile = removeById(defPlayer.killPile, action.creatureInstanceId);
  const newTrophies = [...(char.trophies ?? []), creatureInKillPile];
  const newPlayers = clonePlayers(state);
  newPlayers[defPlayerIndex] = {
    ...defPlayer,
    killPile: newKillPile,
    characters: {
      ...defPlayer.characters,
      [action.characterId as string]: { ...char, trophies: newTrophies },
    },
  };

  // Clear combat and return (a Traitor attack queued mid-combat starts now)
  return { state: completeCombat({ ...state, players: newPlayers, combat: null }) };
}

/**
 * Handle a `pass` action during the `trophy-offer` combat phase.
 * The defending player declines to take any trophy; combat ends normally.
 * Applies rule 8.22: if the defeated creature is in the defender's kill pile
 * but alignment-mismatched, move it to out-of-play instead.
 */
export function finalizeCombatFromTrophyOffer(state: GameState, combat: CombatState): ReducerResult {
  logDetail('Trophy offer declined — combat finalized without trophy');
  const finalState = applyRule8_22AfterTrophyDecision(state, combat);
  return { state: completeCombat({ ...finalState, combat: null }) };
}

/**
 * Handle a `store-creature-in-item` action during the `creature-storage-offer`
 * combat phase (Elven Rope ba-34).
 *
 * The chosen item receives the defeated creature card, attached as
 * `ItemInPlay.storedCreature`. The creature is removed from the kill pile
 * (like `handleTakeTrophy`, rule 8.22's alignment-based kill-pile/out-of-play
 * routing never applies — the creature isn't left in the kill pile). After
 * storing, the phase returns to normal (removes the combat state).
 */
export function handleStoreCreatureInItem(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'store-creature-in-item') return wrongActionType(state, action, 'store-creature-in-item');
  if (combat.phase !== 'creature-storage-offer') return { state, error: 'store-creature-in-item only valid in creature-storage-offer phase' };

  const defPlayerIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defPlayer = state.players[defPlayerIndex];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };

  const found = findItemInCompany(defPlayer, company.characters, action.itemInstanceId);
  if (!found) return { state, error: 'Storage item not found in defending company' };

  const creatureInKillPile = findById(defPlayer.killPile, action.creatureInstanceId);
  if (!creatureInKillPile) return { state, error: 'Creature not found in kill pile for storage' };

  const { item, hostCharId } = found;
  const itemDef = defById(state, item.definitionId);
  const itemName = (itemDef as { name?: string } | undefined)?.name ?? (item.definitionId as string);

  logDetail(`Creature storage: ${itemName} stores ${action.creatureInstanceId as string} instead of scoring kill MP (Elven Rope ba-34)`);

  const newKillPile = removeById(defPlayer.killPile, action.creatureInstanceId);
  const newPlayers = clonePlayers(state);
  const hostChar = newPlayers[defPlayerIndex].characters[hostCharId];
  newPlayers[defPlayerIndex] = {
    ...newPlayers[defPlayerIndex],
    killPile: newKillPile,
    characters: {
      ...newPlayers[defPlayerIndex].characters,
      [hostCharId as string]: {
        ...hostChar,
        items: hostChar.items.map(i =>
          i.instanceId === action.itemInstanceId ? { ...i, storedCreature: creatureInKillPile } : i),
      },
    },
  };

  return { state: completeCombat({ ...state, players: newPlayers, combat: null }) };
}

/**
 * Handle a `pass` action during the `creature-storage-offer` combat phase.
 * The defending player declines to store the creature; combat ends normally,
 * with the creature already scored via the kill pile. Applies rule 8.22 the
 * same as a declined trophy offer.
 */
export function finalizeCombatFromCreatureStorageOffer(state: GameState, combat: CombatState): ReducerResult {
  logDetail('Creature storage offer declined — combat finalized without storage (Elven Rope ba-34)');
  const finalState = applyRule8_22AfterTrophyDecision(state, combat);
  return { state: completeCombat({ ...finalState, combat: null }) };
}
