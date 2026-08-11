/**
 * @module combat-cancel
 *
 * Attack- and strike-cancellation during combat: the cancel-attack action
 * handler (`handleCancelAttack`) and its by-ally / by-character / by-item
 * variants, the cancel-by-tap granted-action (`handleCancelByTap`), and the two
 * chain-resolution entry points consumed by the apply dispatcher and pending
 * reducers (`resolveCancelAttackEntry`, `resolveChainStrikeModifier`). Extracted
 * from `reducer-combat.ts` as the provably-closed transitive closure of
 * `handleCancelAttack` — it calls no other `reducer-combat` function.
 * `reducer-combat` imports the entry points it dispatches one-way from here;
 * `apply-dispatcher` and `pending-reducers` import the chain entry points from
 * here; this module imports only shared leaves plus `resolveStrikeCore` /
 * `nextStrikePhase` (combat-strike), so no cycle forms.
 *
 * Pure relocation: the logic is unchanged from its previous home.
 */

import type { GameState, CombatState, GameAction, PlayerState } from '../index.js';
import type { ReducerResult } from './reducer-utils.js';
import type { StrikeModifierEffect } from '../types/effects.js';
import { getPlayerIndex } from '../state-utils.js';
import { isCharacterCard, isSiteCard } from '../types/cards.js';
import { CardStatus } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { findAllyInCompany, findItemInCompany } from './legal-actions/combat.js';
import { attackSourceCreatureInstanceId, cardName, clonePlayers, companyById, companySubphaseScope, defById, discardOrRecyclePlayedEvent, findById, getCardEffects, removeById, toCardInstance, updateCharacter, updatePlayer, wrongActionType } from './reducer-utils.js';
import { applyCost } from './cost-evaluator.js';
import { enqueueCorruptionCheck, addConstraint, removeConstraint, enqueueResolution, sweepExpired } from './pending.js';
import { initiateOrPushChain } from './chain-reducer.js';
import { resolveStrikeCore, nextStrikePhase, advanceStrikeOrFinalize } from './combat-strike.js';
import { continueOrDisposeCardTriggeredAttack, recordHazardEncountered, finalizeCombat, initiateQueuedTraitorAttack } from './combat-finalize.js';
import { advanceGreatHuntReveal } from './great-hunt.js';
import { tapHuntBearerAfterwards } from './hunt.js';
import { cvccSides } from './cvcc-sides.js';

/**
 * Handle cancel-attack sourced from an in-play ally (e.g. The Warg-king's
 * "tap to cancel a Wolf or Animal attack"). Unlike a hand-played short event,
 * no chain entry is pushed — tapping the ally pays the cost and the
 * cancellation applies immediately via {@link resolveCancelAttackEntry}.
 */
export function handleCancelAttackByInPlayAlly(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };

  const found = findAllyInCompany(defPlayer, company.characters, action.cardInstanceId);
  if (!found) return { state, error: 'Cancel-attack source not in hand or defending company allies' };
  if (found.ally.status !== CardStatus.Untapped) {
    return { state, error: 'Ally must be untapped to cancel attack' };
  }

  const allyName = cardName(state, found.ally.definitionId);
  logDetail(`Cancel-attack declared: tapping ${allyName} to cancel ${combat.creatureRace ?? 'attack'}`);

  const tappedState = updatePlayer(state, defPlayerIndex, p =>
    updateCharacter(p, found.hostCharId, c => ({
      ...c,
      allies: c.allies.map(a =>
        a.instanceId === action.cardInstanceId ? { ...a, status: CardStatus.Tapped } : a,
      ),
    })),
  );
  return { state: resolveCancelAttackEntry(tappedState) };
}

/**
 * Handle cancel-attack sourced from an in-play controlled faction. The cost is
 * taken from the faction's `cancel-attack` effect:
 *   - `discard: "self"` — the faction is moved from `cardsInPlay` to the discard
 *     pile (paying with the loss of its marshalling point). Wild Hounds wh-40:
 *     "Discard this faction to cancel an automatic-attack at a Ruins & Lairs or
 *     an attack keyed to Wilderness or Ruins & Lairs."
 *   - `tap: "self"` — the faction card is tapped in place (it stays in play).
 *     Beasts of the Wood wh-38: "Tap this faction to cancel an attack keyed by
 *     name to one of the regions listed above."
 * Either way the cancellation applies immediately via
 * {@link resolveCancelAttackEntry} (in-play sources never push a chain entry).
 */
export function handleCancelAttackByInPlayFaction(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];
  const factionEntry = defPlayer.cardsInPlay.find(c => c.instanceId === action.cardInstanceId);
  if (!factionEntry) return { state, error: 'Cancel-attack faction not in play' };

  const factionDef = defById(state, factionEntry.definitionId);
  const cancelEffect = getCardEffects(factionDef).find(
    (e): e is import('../types/effects.js').CancelAttackEffect => e.type === 'cancel-attack',
  );
  const tapCost = cancelEffect?.cost?.tap === 'self';

  const factionName = cardName(state, factionEntry.definitionId);

  // Roll-to-cancel (Going Ever Under Dark ba-37, Crept Along Carefully ba-29):
  // the card is discarded and a 2d6 dice-check enqueued; the attack is
  // cancelled only if the check passes.
  if (cancelEffect?.roll) {
    const roll = cancelEffect.roll;
    const company = companyById(defPlayer.companies, combat.companyId);
    let skillBonus = 0;
    if (roll.skillBonus && company) {
      for (const charId of company.characters) {
        const ch = defPlayer.characters[charId];
        const cDef = ch ? defById(state, ch.definitionId) : undefined;
        if (cDef && isCharacterCard(cDef) && cDef.skills.includes(roll.skillBonus)) skillBonus++;
      }
    }
    logDetail(`Cancel-attack declared: discarding ${factionName} and rolling to cancel (threshold ${roll.comparison} ${roll.threshold}, +${skillBonus} ${roll.skillBonus ?? 'n/a'})`);
    const discardedForRoll = updatePlayer(state, defPlayerIndex, p => ({
      ...p,
      cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== action.cardInstanceId),
      discardPile: [...p.discardPile, toCardInstance(factionEntry)],
    }));
    const scope = companySubphaseScope(state.phaseState.phase, combat.companyId);
    const queued = enqueueResolution(discardedForRoll, {
      source: action.cardInstanceId,
      actor: action.player,
      scope,
      kind: {
        type: 'dice-check',
        label: `${factionName}: roll to cancel attack`,
        roller: action.player,
        modifiers: skillBonus > 0 ? [{ kind: 'constant', value: skillBonus }] : [],
        threshold: roll.threshold,
        comparison: roll.comparison,
        onPass: { type: 'cancel-current-attack' },
        continuation: { kind: 'dequeue-only' },
      },
    });
    return { state: queued };
  }

  if (tapCost) {
    if (factionEntry.status !== CardStatus.Untapped) {
      return { state, error: 'Faction must be untapped to tap to cancel attack' };
    }
    logDetail(`Cancel-attack declared: tapping ${factionName} (in-play faction) to cancel ${combat.creatureRace ?? 'attack'}`);
    const tappedState = updatePlayer(state, defPlayerIndex, p => ({
      ...p,
      cardsInPlay: p.cardsInPlay.map(c =>
        c.instanceId === action.cardInstanceId ? { ...c, status: CardStatus.Tapped } : c,
      ),
    }));
    return { state: resolveCancelAttackEntry(tappedState) };
  }

  logDetail(`Cancel-attack declared: discarding ${factionName} (in-play faction) to cancel ${combat.creatureRace ?? 'attack'}`);

  const discardedState = updatePlayer(state, defPlayerIndex, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== action.cardInstanceId),
    discardPile: [...p.discardPile, toCardInstance(factionEntry)],
  }));
  return { state: resolveCancelAttackEntry(discardedState) };
}

/**
 * Handle a site-swap cancel-attack sourced from an in-play permanent-event
 * carrying `cancel-attack` with a `siteSwap` payload — Farmer Maggot (as-48):
 * "you may immediately replace its site card with another site card in The
 * Shire, Arthedain, or Cardolan (from your location deck). If your company
 * takes this option, the attack is canceled and this card is discarded."
 *
 * Order of operations:
 * 1. the defending company's current site card is disposed exactly as a
 *    departure site is (CoE 2.IV.viii — a tapped non-haven is discarded to the
 *    site discard pile, anything else returns to the location deck), unless a
 *    sibling company is still standing on that same site card;
 * 2. the chosen replacement site is pulled out of the location deck and becomes
 *    the company's current site, untapped;
 * 3. the host card is discarded; and
 * 4. the attack is canceled via {@link resolveCancelAttackEntry}.
 *
 * The company does not *move* to the replacement, so it does not face that
 * site's automatic-attacks: during the site phase the remaining automatic-attack
 * sequence for this company is abandoned (`autoAttacksSkipped`).
 */
export function handleCancelAttackBySiteSwap(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];
  const hostEntry = defPlayer.cardsInPlay.find(c => c.instanceId === action.cardInstanceId);
  if (!hostEntry) return { state, error: 'Cancel-attack card not in play' };

  const hostDef = defById(state, hostEntry.definitionId);
  const hostName = cardName(state, hostEntry.definitionId);
  const cancelEffect = getCardEffects(hostDef).find(
    (e): e is import('../types/effects.js').CancelAttackEffect => e.type === 'cancel-attack',
  );
  const siteSwap = cancelEffect?.siteSwap;
  if (!siteSwap) return { state, error: `${hostName} has no site-swap cancel-attack effect` };

  const companyIndex = defPlayer.companies.findIndex(c => c.id === combat.companyId);
  const company = companyIndex >= 0 ? defPlayer.companies[companyIndex] : undefined;
  if (!company) return { state, error: 'Defending company not found' };
  if (company.destinationSite) {
    return { state, error: `${hostName} requires a company at a site, but the company is moving` };
  }
  const currentSite = company.currentSite;
  if (!currentSite) return { state, error: 'Defending company has no current site' };

  const currentDef = defById(state, currentSite.definitionId);
  if (!currentDef || !isSiteCard(currentDef) || !siteSwap.regions.includes(currentDef.region)) {
    return {
      state,
      error: `${hostName}: company is not at a site in ${siteSwap.regions.join(', ')}`,
    };
  }

  const replacementId = action.replacementSiteInstanceId;
  if (!replacementId) return { state, error: `${hostName} requires a replacement site` };
  const replacement = findById(defPlayer.siteDeck, replacementId);
  if (!replacement) return { state, error: `${hostName}: replacement site is not in the location deck` };
  const replacementDef = defById(state, replacement.definitionId);
  if (!replacementDef || !isSiteCard(replacementDef) || !siteSwap.regions.includes(replacementDef.region)) {
    return {
      state,
      error: `${hostName}: replacement site is not in ${siteSwap.regions.join(', ')}`,
    };
  }

  logDetail(
    `Cancel-attack declared: discarding ${hostName} to replace ${currentDef.name} ` +
    `with ${replacementDef.name} (${replacementDef.region}) and cancel the attack`,
  );

  // A sibling company standing on the same site card keeps it in play; only the
  // card's owner disposes of it (mirrors the departure rules in M/H step 8).
  const siblingAtCurrentSite = defPlayer.companies.some(
    (c, i) => i !== companyIndex && c.currentSite?.instanceId === currentSite.instanceId,
  );

  const swapped = updatePlayer(state, defPlayerIndex, p => {
    let siteDeck = p.siteDeck;
    let siteDiscardPile = p.siteDiscardPile;

    if (company.siteCardOwned && !siblingAtCurrentSite) {
      const departureEntry = toCardInstance(currentSite);
      const isHaven = currentDef.siteType === 'haven';
      if (!isHaven && currentSite.status === CardStatus.Tapped) {
        logDetail(`${hostName}: replaced site ${currentDef.name} is a tapped non-haven — discarding to site discard pile`);
        siteDiscardPile = [...siteDiscardPile, departureEntry];
      } else {
        logDetail(`${hostName}: replaced site ${currentDef.name} is ${isHaven ? 'a haven' : 'untapped'} — returning to location deck`);
        siteDeck = [...siteDeck, departureEntry];
      }
    } else if (siblingAtCurrentSite) {
      logDetail(`${hostName}: replaced site ${currentDef.name} stays in play — a sibling company is still there`);
    }

    siteDeck = removeById(siteDeck, replacementId);

    return {
      ...p,
      siteDeck,
      siteDiscardPile,
      cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== hostEntry.instanceId),
      discardPile: [...p.discardPile, toCardInstance(hostEntry)],
      companies: p.companies.map((c, i) =>
        i === companyIndex
          ? {
              ...c,
              currentSite: {
                instanceId: replacement.instanceId,
                definitionId: replacement.definitionId,
                status: CardStatus.Untapped,
              },
              siteCardOwned: true,
            }
          : c,
      ),
    };
  });

  // The company was placed at the replacement rather than moving to it, so it
  // never "enters" that site: any automatic-attacks still queued for this
  // company's site-phase slot are abandoned.
  let resultState: GameState = swapped;
  if (resultState.phaseState.phase === Phase.Site
    && resultState.phaseState.activeCompanyIndex === companyIndex
    && resultState.activePlayer === action.player) {
    logDetail(`${hostName}: company is placed at ${replacementDef.name} without entering it — remaining automatic-attacks abandoned`);
    resultState = {
      ...resultState,
      phaseState: { ...resultState.phaseState, autoAttacksSkipped: true },
    };
  }

  return { state: resolveCancelAttackEntry(resultState) };
}

/**
 * Handle cancel-attack sourced from an in-play character (e.g. Adûnaphel
 * the Ringwraith's Darkhaven tap). Mirrors {@link handleCancelAttackByInPlayAlly}
 * but taps the character directly.
 */
export function handleCancelAttackByInPlayCharacter(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };

  const charData = defPlayer.characters[action.cardInstanceId];
  if (!charData) return { state, error: 'Cancel-attack source character not found' };
  if (!company.characters.includes(action.cardInstanceId)) {
    return { state, error: 'Cancel-attack character is not in the defending company' };
  }
  if (charData.status !== CardStatus.Untapped) {
    return { state, error: 'Character must be untapped to cancel attack' };
  }

  const charName = cardName(state, charData.definitionId);
  logDetail(`Cancel-attack declared: tapping ${charName} to cancel ${combat.creatureRace ?? 'attack'}`);

  const tappedState = updatePlayer(state, defPlayerIndex, p =>
    updateCharacter(p, action.cardInstanceId, c => ({ ...c, status: CardStatus.Tapped })),
  );
  return { state: resolveCancelAttackEntry(tappedState) };
}

/**
 * Handle cancel-attack sourced from an in-play item with cost "self-and-bearer"
 * (tap item AND bearer, e.g. Torque of Hues) or cost "bearer" (tap bearer only,
 * e.g. Star-glass). Bearer makes a corruption check afterward if the effect
 * declares `enqueueCorruptionCheck`.
 */
export function handleCancelAttackByInPlayItem(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company) return { state, error: 'Defending company not found' };

  const found = findItemInCompany(defPlayer, company.characters, action.cardInstanceId);
  if (!found) return { state, error: 'Cancel-attack source item not found in defending company' };

  const { item, hostCharId } = found;

  const itemDef = defById(state, item.definitionId);
  const itemName = itemDef?.name ?? (item.definitionId as string);
  const cancelEffect = getCardEffects(itemDef).find(
    (e): e is import('../types/effects.js').CancelAttackEffect => e.type === 'cancel-attack',
  );

  const tapCost = cancelEffect?.cost?.tap;
  const bearerOnly = tapCost === 'bearer';
  const selfOnly = tapCost === 'self';
  const tapsItem = !bearerOnly; // 'self' and 'self-and-bearer' tap the item
  const tapsBearer = !selfOnly; // 'bearer' and 'self-and-bearer' tap the bearer

  if (tapsItem && item.status !== CardStatus.Untapped) {
    return { state, error: 'Item must be untapped to cancel attack' };
  }

  const bearerData = defPlayer.characters[hostCharId];
  if (!bearerData) return { state, error: 'Bearer character not found' };
  if (tapsBearer && bearerData.status !== CardStatus.Untapped) {
    return { state, error: 'Bearer must be untapped to cancel attack with this item' };
  }

  if (selfOnly) {
    logDetail(`Cancel-attack declared: tapping item ${itemName} to cancel ${combat.creatureRace ?? 'attack'}`);
  } else if (bearerOnly) {
    logDetail(`Cancel-attack declared: tapping bearer ${hostCharId as string} via ${itemName} to cancel ${combat.creatureRace ?? 'attack'}`);
  } else {
    logDetail(`Cancel-attack declared: tapping item ${itemName} and bearer ${hostCharId as string} to cancel ${combat.creatureRace ?? 'attack'}`);
  }

  // Tap the item and/or bearer per the cost variant.
  let tappedState = updatePlayer(state, defPlayerIndex, p =>
    updateCharacter(p, hostCharId, c => ({
      ...c,
      status: tapsBearer ? CardStatus.Tapped : c.status,
      items: tapsItem
        ? c.items.map(i =>
            i.instanceId === item.instanceId ? { ...i, status: CardStatus.Tapped } : i,
          )
        : c.items,
    })),
  );

  // Cancel the attack immediately (items, like allies, don't push a chain entry).
  tappedState = resolveCancelAttackEntry(tappedState);

  // Enqueue corruption check on bearer if effect declares it.
  if (cancelEffect?.enqueueCorruptionCheck) {
    const scope = companySubphaseScope(state.phaseState.phase, company.id);
    logDetail(`Cancel-attack: enqueuing corruption check on bearer ${hostCharId as string} (${itemName})`);
    tappedState = enqueueCorruptionCheck(tappedState, {
      source: item.instanceId,
      actor: action.player,
      scope,
      characterId: hostCharId,
      reason: itemName,
    });
  }

  return { state: tappedState };
}

/**
 * Handle the `cancel-weapon-effects` action — Whip of Many Thongs (ba-82).
 *
 * During a company-vs-company combat the controller of an in-play
 * `combat-cancel-weapon` item (the Whip, borne by The Balrog) taps it to cancel
 * all effects of one weapon in the opposing company until the end of the combat.
 * The chosen weapon's instance is added to
 * {@link CombatState.suppressedWeaponInstanceIds}; the weapon is NOT discarded.
 * Suppression is read by `collectCharacterEffects` / `computeEffectiveStats` and
 * clears automatically when combat finalizes.
 */
export function handleCancelWeaponEffects(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'cancel-weapon-effects') return wrongActionType(state, action, 'cancel-weapon-effects');
  if (!combat.isCvCC) return { state, error: 'Cancel-weapon requires a company-vs-company combat' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  if (!player) return { state, error: 'Cancel-weapon: acting player not found' };

  // Locate the acting player's participating company and the opponent's.
  const sides = cvccSides(combat, action.player);
  if (!sides) {
    return { state, error: 'Cancel-weapon: acting player is not a combatant' };
  }
  const { myCompanyId, oppPlayerId, oppCompanyId } = sides;

  const myCompany = companyById(player.companies, myCompanyId);
  if (!myCompany) return { state, error: 'Cancel-weapon: participating company not found' };

  // Validate the Whip: an untapped in-play combat-cancel-weapon item, borne by
  // a character in the participating company (The Balrog per the card).
  const found = findItemInCompany(player, myCompany.characters, action.cardInstanceId);
  if (!found) return { state, error: 'Cancel-weapon source item not found in company' };
  const { item: whip, hostCharId } = found;
  const whipDef = defById(state, whip.definitionId);
  const eff = getCardEffects(whipDef).find(e => e.type === 'combat-cancel-weapon');
  if (!eff) return { state, error: 'Item has no combat-cancel-weapon effect' };
  if (whip.status !== CardStatus.Untapped) return { state, error: 'Whip must be untapped to cancel a weapon' };

  // Validate the target: a `weapon`-keyword item on a character in the opponent's
  // company, not already suppressed this combat.
  const alreadySuppressed = combat.suppressedWeaponInstanceIds ?? [];
  if (alreadySuppressed.includes(action.weaponInstanceId)) {
    return { state, error: 'That weapon is already suppressed this combat' };
  }
  const oppPlayerIndex = getPlayerIndex(state, oppPlayerId);
  const oppPlayer = state.players[oppPlayerIndex];
  const oppCompany = oppPlayer ? companyById(oppPlayer.companies, oppCompanyId) : undefined;
  if (!oppPlayer || !oppCompany) return { state, error: 'Cancel-weapon: opposing company not found' };
  const targetFound = findItemInCompany(oppPlayer, oppCompany.characters, action.weaponInstanceId);
  if (!targetFound) return { state, error: 'Cancel-weapon target not found in opposing company' };
  const targetDef = defById(state, targetFound.item.definitionId);
  const targetKeywords = targetDef && 'keywords' in targetDef
    ? (targetDef as { keywords?: readonly string[] }).keywords ?? []
    : [];
  if (!targetKeywords.includes('weapon')) {
    return { state, error: 'Cancel-weapon target is not a weapon' };
  }

  // Tap the Whip (the weapon itself is untouched — "does not discard the weapon").
  const tappedState = updatePlayer(state, playerIndex, p =>
    updateCharacter(p, hostCharId, c => ({
      ...c,
      items: c.items.map(i =>
        i.instanceId === whip.instanceId ? { ...i, status: CardStatus.Tapped } : i,
      ),
    })),
  );

  logDetail(
    `Whip of Many Thongs: tap to cancel all effects of ${targetDef?.name ?? action.weaponInstanceId as string} `
    + `(${action.weaponInstanceId as string}) until end of combat`,
  );

  return {
    state: {
      ...tappedState,
      combat: { ...combat, suppressedWeaponInstanceIds: [...alreadySuppressed, action.weaponInstanceId] },
    },
  };
}

export function handleCancelAttack(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-attack') return wrongActionType(state, action, 'cancel-attack');

  // Deferred free cancellation granted by a `free-attack-cancel` constraint
  // (Darkness Wielded ba-55, mode "cancel this attack and a latter attack …").
  // No card is played from hand: consume one matching constraint and cancel the
  // attack immediately (in-play-ability style, no chain entry).
  if (action.mode === 'free-later-cancel') {
    const constraint = state.activeConstraints.find(
      c => c.kind.type === 'free-attack-cancel'
        && c.target.kind === 'player' && c.target.playerId === action.player,
    );
    if (!constraint) return { state, error: 'No free-attack-cancel grant available' };
    logDetail(`Free-later-cancel: consuming ${constraint.sourceDefinitionId as string} grant to cancel this attack`);
    const consumed = removeConstraint(state, constraint.id);
    return { state: resolveCancelAttackEntry(consumed) };
  }

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];

  const handCard = findById(defPlayer.hand, action.cardInstanceId);
  if (!handCard) {
    // Source may be an in-play character tapping to cancel (e.g. Adûnaphel
    // the Ringwraith's Darkhaven tap), an in-play ally (e.g. The Warg-king),
    // or an in-play item with self-and-bearer cost (e.g. Torque of Hues).
    if (defPlayer.characters[action.cardInstanceId]) {
      return handleCancelAttackByInPlayCharacter(state, action, combat);
    }
    // A card in play discarded/tapped to cancel: either a site-swap permanent
    // event (Farmer Maggot as-48) or a controlled faction (Wild Hounds wh-40).
    const inPlayEntry = defPlayer.cardsInPlay.find(c => c.instanceId === action.cardInstanceId);
    if (inPlayEntry) {
      const inPlayCancel = getCardEffects(defById(state, inPlayEntry.definitionId)).find(
        (e): e is import('../types/effects.js').CancelAttackEffect => e.type === 'cancel-attack',
      );
      if (inPlayCancel?.siteSwap) {
        return handleCancelAttackBySiteSwap(state, action, combat);
      }
      return handleCancelAttackByInPlayFaction(state, action, combat);
    }
    // Check items before falling through to ally handler.
    const defCompany = companyById(defPlayer.companies, combat.companyId);
    if (defCompany && findItemInCompany(defPlayer, defCompany.characters, action.cardInstanceId)) {
      return handleCancelAttackByInPlayItem(state, action, combat);
    }
    return handleCancelAttackByInPlayAlly(state, action, combat);
  }

  // Look up the cancel-attack effect to determine cost type.
  const cardDef = defById(state, handCard.definitionId);
  const effects = (cardDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects;
  const cancelEffect = effects?.find(
    (e): e is import('../types/effects.js').CancelAttackEffect => e.type === 'cancel-attack',
  );

  // Pay character cost via cost-evaluator: tap or enqueue corruption check.
  // A cost-paying character whose race matches `costExemptRace` pays nothing
  // (e.g. The Tormented Earth: "Unless he is a Ringwraith, character makes a
  // corruption check…").
  let resultState: GameState = state;
  const exemptRace = cancelEffect?.costExemptRace;
  let costExempt = false;
  if (action.scoutInstanceId && exemptRace) {
    const scoutChar = defPlayer.characters[action.scoutInstanceId];
    const scoutDef = scoutChar ? defById(state, scoutChar.definitionId) : undefined;
    if (scoutDef && isCharacterCard(scoutDef) && scoutDef.race === exemptRace) {
      costExempt = true;
      logDetail(`Cancel-attack ${handCard.definitionId as string}: cost-payer is ${exemptRace} — corruption check skipped`);
    }
  }
  if (action.scoutInstanceId && cancelEffect?.cost && !costExempt) {
    const company = companyById(defPlayer.companies, combat.companyId);
    const companyId = company?.id;
    const scopeKind = state.phaseState.phase === Phase.MovementHazard
      ? 'company-mh-subphase' as const
      : 'company-site-subphase' as const;
    const costResult = applyCost(state, cancelEffect.cost, action.scoutInstanceId, {
      playerIndex: defPlayerIndex,
      sourceCardId: action.cardInstanceId,
      companyId,
      checkScopeKind: scopeKind,
      label: cardDef?.name ?? '?',
    });
    if ('error' in costResult) return { state, error: costResult.error };
    resultState = costResult.state;
  } else {
    logDetail(`Cancel-attack declared: ${handCard.definitionId as string} played via chain (no cost)`);
  }

  // Move card from hand to discard pile — short events are physically
  // discarded at play time; the chain holds only a reference. A magic
  // cancel-attack card (e.g. The Tormented Earth as-102) cast by a player
  // whose Ringwraith is Akhôrahil (le-51) is shuffled back into their play
  // deck instead of discarded (see `discardOrRecyclePlayedEvent`).
  resultState = updatePlayer(resultState, defPlayerIndex, p => ({
    ...p,
    hand: removeById(p.hand, handCard.instanceId),
  }));
  resultState = discardOrRecyclePlayedEvent(resultState, defPlayerIndex, toCardInstance(handCard));

  // Attack-scoped duplication limit: record this play as a constraint so the
  // legal-action scanner can block a second copy on the same attack. Applies
  // in both modes ("Cannot be duplicated against a given attack").
  const cancelDupLimit = getCardEffects(cardDef).find(
    e => e.type === 'duplication-limit' && (e as { scope: string }).scope === 'attack',
  );
  if (cancelDupLimit) {
    resultState = addConstraint(resultState, {
      source: handCard.instanceId,
      sourceDefinitionId: handCard.definitionId,
      scope: { kind: 'attack' },
      target: { kind: 'player', playerId: action.player },
      kind: { type: 'attack-card-played' },
    });
    logDetail(`${(cardDef as { name?: string }).name ?? handCard.definitionId as string}: added attack-card-played marker (cancel-attack duplication-limit scope attack)`);
  }

  // Turn-scoped duplication limit: record this play as a constraint so the
  // legal-action scanner can block a second copy this turn ("Cannot be
  // duplicated on a given turn" — Fifteen Birds in Five Firtrees dm-129).
  const cancelTurnDupLimit = getCardEffects(cardDef).find(
    e => e.type === 'duplication-limit' && (e as { scope: string }).scope === 'turn',
  );
  if (cancelTurnDupLimit) {
    resultState = addConstraint(resultState, {
      source: handCard.instanceId,
      sourceDefinitionId: handCard.definitionId,
      scope: { kind: 'turn' },
      target: { kind: 'player', playerId: action.player },
      kind: { type: 'attack-card-played' },
    });
    logDetail(`${(cardDef as { name?: string }).name ?? handCard.definitionId as string}: added turn-scoped duplication marker (cannot be duplicated on a given turn)`);
  }

  // Dual-mode "reduce prowess" variant (e.g. The Tormented Earth): instead of
  // cancelling, lower the attack's strike prowess uniformly. Like halve-strikes
  // and modify-attack, this is a direct combat modification applied immediately
  // (no chain) — only outright cancellation routes through the chain.
  if (action.mode === 'reduce-prowess' && cancelEffect?.prowessPenalty !== undefined) {
    if (!resultState.combat) return { state, error: 'No active combat to reduce prowess' };
    const before = resultState.combat.strikeProwess;
    const after = before - cancelEffect.prowessPenalty;
    logDetail(`${(cardDef as { name?: string }).name ?? handCard.definitionId as string}: reduce attack prowess ${before} → ${after} (-${cancelEffect.prowessPenalty})`);
    return { state: { ...resultState, combat: { ...resultState.combat, strikeProwess: after } } };
  }

  // Push/initiate chain entry — opponent gets priority to respond. On
  // resolution, the chain resolver applies the combat cancellation via
  // resolveCancelAttackEntry.
  const payload: import('../index.js').ChainEntryPayload = action.targetCharacterId
    ? { type: 'short-event', targetCharacterId: action.targetCharacterId }
    : { type: 'short-event' };
  resultState = initiateOrPushChain(resultState, action.player, handCard, payload);

  return { state: resultState };
}

/**
 * Discard the canceled attack's source creature: remove it from the
 * attacker's cardsInPlay and push it to their discard pile. A canceled
 * creature never reaches the defender's kill pile (no kill-MP — contrast
 * the defeat routing in combat-finalize). No-op for non-creature attack
 * sources or when the creature is not in play (e.g. reveal-sequence
 * attacks whose creature never left its pile). Mutates `players` in place.
 */
function discardCanceledCreature(state: GameState, players: PlayerState[], combat: CombatState): void {
  const creatureInstanceId = attackSourceCreatureInstanceId(combat);
  if (!creatureInstanceId) return;
  const atkIdx = getPlayerIndex(state, combat.attackingPlayerId);
  const creatureInPlay = findById(players[atkIdx].cardsInPlay, creatureInstanceId);
  if (!creatureInPlay) return;
  players[atkIdx] = {
    ...players[atkIdx],
    cardsInPlay: players[atkIdx].cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
    discardPile: [...players[atkIdx].discardPile, toCardInstance(creatureInPlay)],
  };
}

/**
 * Apply the cancel-attack effect when its chain entry resolves.
 *
 * Called from the chain resolver when a short-event entry with a
 * `cancel-attack` effect is resolved (and not negated). Applies the
 * combat-cancellation logic that previously ran immediately in
 * {@link handleCancelAttack}:
 *
 * - For multi-attack creatures (e.g. Assassin), reduce `strikesTotal` by
 *   one rather than ending combat — each multi-attack sub-attack is a
 *   separate "attack".
 * - Otherwise, clear `state.combat` and move the attacking creature from
 *   the attacker's cardsInPlay to their discard pile.
 *
 * Returns the unchanged state if combat is no longer active (fizzle).
 */
export function resolveCancelAttackEntry(state: GameState): GameState {
  const combat = state.combat;
  if (!combat) {
    logDetail('Cancel-attack resolves: no active combat — fizzle');
    return state;
  }

  // Cancel protection (Unabated in Malice ba-26): the FIRST attempt to cancel
  // a protected attack instead strips the protecting card's modifiers, leaving
  // the (now unbuffed) attack in play. The cancel card was still spent. Once
  // consumed, a later cancellation ends the attack normally.
  if (combat.cancelProtection) {
    const cp = combat.cancelProtection;
    const restoredProwess = combat.strikeProwess - cp.prowessModifier;
    const restoredBody = combat.creatureBody === null ? null : combat.creatureBody - cp.bodyModifier;
    const restoredStrikes = Math.max(1, combat.strikesTotal - cp.strikesModifier);
    logDetail(
      `Cancel-attack resolves: attack is protected — cancellation redirected to strip the buff instead. ` +
      `strike prowess ${combat.strikeProwess} → ${restoredProwess}, ` +
      `creature body ${combat.creatureBody ?? 'n/a'} → ${restoredBody ?? 'n/a'}, ` +
      `strikes ${combat.strikesTotal} → ${restoredStrikes}. Attack continues.`,
    );
    const { cancelProtection: _removed, ...restCombat } = combat;
    return {
      ...state,
      combat: {
        ...restCombat,
        strikeProwess: restoredProwess,
        creatureBody: restoredBody,
        strikesTotal: restoredStrikes,
      },
    };
  }

  const newPlayers = clonePlayers(state);

  // For multi-attack creatures (e.g. Assassin), cancelling one attack
  // removes one strike rather than ending the entire combat.
  if (combat.forceSingleTarget && combat.strikesTotal > 1) {
    const newStrikesTotal = combat.strikesTotal - 1;
    logDetail(`Multi-attack: one attack canceled, strikes reduced ${combat.strikesTotal} → ${newStrikesTotal}`);
    const newCancelByTap = combat.cancelByTapRemaining !== undefined
      ? Math.min(combat.cancelByTapRemaining, newStrikesTotal)
      : undefined;
    return {
      ...state,
      players: newPlayers,
      combat: {
        ...combat,
        strikesTotal: newStrikesTotal,
        cancelByTapRemaining: newCancelByTap,
        multiAttackCount: combat.multiAttackCount !== undefined ? combat.multiAttackCount - 1 : undefined,
      },
    };
  }

  // If this was a creature attack, move creature card from attacker's
  // cardsInPlay to discard.
  discardCanceledCreature(state, newPlayers, combat);

  // card-triggered-attack cancelled: the attack never resolved, but the card is
  // still in play — continue the queued sequence or dispose of it, exactly as
  // finalization would.
  let stateWithCancelledPlayers: GameState = { ...state, players: newPlayers, combat: null };
  stateWithCancelledPlayers = continueOrDisposeCardTriggeredAttack(stateWithCancelledPlayers, combat, true);

  // The Great Hunt (wh-91): a canceled reveal-sequence attack still advances
  // the reveal queue to the next creature (the creature never moved out of its
  // pile, so nothing is disposed on cancel either).
  if (combat.attackSource.type === 'great-hunt-attack' && combat.attackSource.continuation === 'reveal') {
    stateWithCancelledPlayers = advanceGreatHuntReveal(stateWithCancelledPlayers, combat.attackSource.greatHuntInstanceId);
  }

  // The Hunt (dm-143): "If untapped, tap [the bearer] afterwards" applies
  // even when the attack is canceled — the forced-attack sequence still
  // "happened", just without strikes.
  if (combat.attackSource.type === 'hunt-attack') {
    stateWithCancelledPlayers = tapHuntBearerAfterwards(stateWithCancelledPlayers, combat.defendingPlayerId, combat.attackSource.bearerInstanceId);
  }

  // Sweep attack-scoped constraints (e.g. duplication-limit markers from
  // cancel-attack or modify-attack cards played on this attack) now that the
  // attack has ended via cancellation.
  stateWithCancelledPlayers = sweepExpired(stateWithCancelledPlayers, { kind: 'attack-end' });

  // Per CoE 3.i.1 and CRF 22 Annotation 14, a company is still considered to
  // have "faced" an attack once combat is initiated, even if the attack is
  // then canceled. Record the canceled creature in hazardsEncountered so that
  // subsequent creature self-effects see it — e.g. Orc-lieutenant's +4 prowess
  // "if played on a company that has already faced an Orc attack this turn"
  // must apply even when the prior Orc attack (e.g. Hobgoblins) was canceled.
  // recordHazardEncountered is a no-op outside the M/H phase and for
  // non-creature attack sources, so multi-attack partial cancels (which return
  // earlier with combat still active) and card-triggered attacks are unaffected.
  stateWithCancelledPlayers = recordHazardEncountered(stateWithCancelledPlayers, state, combat);

  logDetail('Combat canceled by chain resolution — returning to enclosing phase');
  // A Traitor attack queued mid-combat still fires after the cancellation
  // (no-op while a follow-up combat, e.g. a multi-attack card, is active).
  return initiateQueuedTraitorAttack(stateWithCancelledPlayers);
}

/**
 * Apply a `strike-modifier` effect when its chain entry resolves (or immediately
 * in reroll/default mode). Dispatches to {@link resolveStrikeCore} for dodge and
 * reroll modes; accumulates prowess/body bonuses for the default modifier mode.
 *
 * Called from `apply-dispatcher.ts` (chain path) and directly from
 * {@link handlePlayStrikeEvent} for reroll and default modes.
 *
 * @param state - Current game state (must have active combat).
 * @param effect - The resolved `strike-modifier` effect from the card definition.
 * @param tapToFight - Reroll mode only (CoE 3.iv.3): `true` (default) taps
 *   the character to fight at full prowess; `false` keeps it untapped with
 *   the usual -3 penalty. Ignored by every other mode.
 */
export function resolveChainStrikeModifier(state: GameState, effect: StrikeModifierEffect, tapToFight = true): ReducerResult {
  const combat = state.combat;
  if (!combat) return { state, error: 'No active combat' };

  if (effect.cancel) {
    // Cancel mode (e.g. Orc Stealth le-217): the current strike is canceled
    // outright, no roll made — same outcome as the item-based `cancel-strike`
    // and `flee-from-strike` handlers.
    const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex];
    const newAssignments = [...combat.strikeAssignments];
    newAssignments[combat.currentStrikeIndex] = { ...currentStrike, resolved: true, result: 'canceled' };
    return advanceStrikeOrFinalize(state, { ...combat, strikeAssignments: newAssignments });
  }

  if (effect.dodge) {
    return resolveStrikeCore(state, combat, 'dodge', effect.bodyPenalty ?? 0, null);
  }
  if (effect.reroll) {
    // Apply any prowess bonus before resolving — supports combined reroll+bonus cards (e.g. Swift Strokes).
    let preState = state;
    if (effect.prowessBonus) {
      const bonus = effect.prowessBonus;
      const newAssignments = combat.strikeAssignments.map((a, i) =>
        i === combat.currentStrikeIndex
          ? { ...a, strikeProwessBonus: (a.strikeProwessBonus ?? 0) + bonus }
          : a,
      );
      preState = { ...state, combat: { ...combat, strikeAssignments: newAssignments } };
    }
    return resolveStrikeCore(preState, preState.combat!, 'reroll', 0, null, !tapToFight);
  }

  // Default: accumulate prowess/body bonuses on the current strike assignment.
  const prowessBonus = effect.prowessBonus ?? 0;
  const bodyPenalty = effect.bodyPenalty ?? 0;
  const newAssignments = combat.strikeAssignments.map((a, i) =>
    i === combat.currentStrikeIndex
      ? {
          ...a,
          strikeProwessBonus: (a.strikeProwessBonus ?? 0) + prowessBonus,
          strikeBodyPenalty: (a.strikeBodyPenalty ?? 0) + bodyPenalty,
        }
      : a,
  );
  return { state: { ...state, combat: { ...combat, strikeAssignments: newAssignments } } };
}

/**
 * Cancel one strike by tapping a non-target character in the defending
 * company. Used by the `cancel-attack-by-tap` combat rule (e.g. Assassin).
 * Removes one strike assignment and decrements cancelByTapRemaining.
 */
export function handleCancelByTap(state: GameState, action: GameAction, combat: CombatState): ReducerResult {
  if (action.type !== 'cancel-by-tap') return wrongActionType(state, action, 'cancel-by-tap');
  if (combat.phase !== 'assign-strikes' || combat.assignmentPhase !== 'cancel-by-tap') {
    return { state, error: 'Can only cancel-by-tap during cancel-by-tap sub-phase' };
  }
  if (action.player !== combat.defendingPlayerId) {
    return { state, error: 'Only defending player can cancel-by-tap' };
  }
  if (!combat.cancelByTapRemaining || combat.cancelByTapRemaining <= 0) {
    return { state, error: 'No cancel-by-tap opportunities remaining' };
  }

  const defPlayerIndex = getPlayerIndex(state, action.player);
  const defPlayer = state.players[defPlayerIndex];
  const company = companyById(defPlayer.companies, combat.companyId);
  if (!company || !company.characters.includes(action.characterId)) {
    return { state, error: 'Character not in defending company' };
  }

  // Carrion Feeders (ba-11): tap an untapped company character to cancel the
  // pre-assigned strike against a chosen wounded character.
  if (combat.cancelStrikeAgainstWounded) {
    const canceler = defPlayer.characters[action.characterId];
    if (!canceler || canceler.status !== CardStatus.Untapped) {
      return { state, error: 'Character must be untapped to cancel a strike' };
    }
    const strikeCharId = action.strikeCharacterId;
    const idx = strikeCharId
      ? combat.strikeAssignments.findIndex(a => !a.resolved && a.characterId === strikeCharId)
      : combat.strikeAssignments.findIndex(a => !a.resolved);
    if (idx < 0) return { state, error: 'No unresolved strike against that character to cancel' };

    const newPlayersW = clonePlayers(state);
    const newCharsW = { ...defPlayer.characters };
    newCharsW[action.characterId] = { ...canceler, status: CardStatus.Tapped };
    newPlayersW[defPlayerIndex] = { ...defPlayer, characters: newCharsW };

    logDetail(`Cancel-strike-vs-wounded: ${action.characterId as string} tapped to cancel the strike against ${strikeCharId as string}`);

    const newAssignmentsW = combat.strikeAssignments.filter((_, i) => i !== idx);
    const newCancelRemainingW = combat.cancelByTapRemaining - 1;
    const newStrikesTotalW = combat.strikesTotal - 1;

    // All wounded-character strikes canceled → the attack is fully canceled.
    if (newAssignmentsW.length === 0) {
      logDetail('All wounded-character strikes canceled — combat ends');
      discardCanceledCreature(state, newPlayersW, combat);
      return { state: initiateQueuedTraitorAttack({ ...state, players: newPlayersW, combat: null }) };
    }

    let newCombatW: CombatState = {
      ...combat,
      strikeAssignments: newAssignmentsW,
      strikesTotal: newStrikesTotalW,
      cancelByTapRemaining: newCancelRemainingW > 0 ? newCancelRemainingW : undefined,
    };
    // No untapped characters left to tap → proceed to strike resolution.
    if (newCancelRemainingW <= 0) {
      logDetail('No more untapped characters to cancel — proceeding to resolution');
      const nextW = nextStrikePhase(newCombatW);
      newCombatW = { ...newCombatW, assignmentPhase: 'done', ...nextW };
    }
    return { state: { ...state, players: newPlayersW, combat: newCombatW } };
  }

  // By default the target character cannot tap to cancel (Assassin: "not the defending character").
  // When cancelByTapAllowTarget is set (Slayer: "any one character"), the target may also tap.
  const targetCharId = combat.strikeAssignments[0]?.characterId;
  if (!combat.cancelByTapAllowTarget && action.characterId === targetCharId) {
    return { state, error: 'Cannot tap the defending character to cancel' };
  }

  const charData = defPlayer.characters[action.characterId];
  if (!charData || charData.status !== CardStatus.Untapped) {
    return { state, error: 'Character must be untapped' };
  }

  logDetail(`Cancel-by-tap: ${action.characterId as string} tapped to cancel one attack against ${targetCharId as string}`);

  // Tap the character
  const newPlayers = clonePlayers(state);
  const newCharacters = { ...defPlayer.characters };
  newCharacters[action.characterId] = { ...charData, status: CardStatus.Tapped };
  newPlayers[defPlayerIndex] = { ...defPlayer, characters: newCharacters };

  // Remove one full attack's worth of strike assignments.
  // For multi-attack creatures (e.g. Nameless Thing: 3 attacks × 2 strikes),
  // strikesPerAttack is set so one tap cancels one full attack (all its strikes).
  const strikesToRemove = combat.strikesPerAttack ?? 1;
  const newAssignments = [...combat.strikeAssignments];
  for (let i = 0; i < strikesToRemove; i++) newAssignments.pop();

  const newCancelRemaining = combat.cancelByTapRemaining - 1;
  const newStrikesTotal = combat.strikesTotal - strikesToRemove;

  logDetail(`Strikes reduced: ${combat.strikesTotal} → ${newStrikesTotal}, cancels remaining: ${newCancelRemaining}`);

  // If no strikes remain, cancel combat entirely
  if (newAssignments.length === 0) {
    logDetail('All strikes canceled — combat ends');
    // Move creature to discard
    const atkIdx = getPlayerIndex(state, combat.attackingPlayerId);
    const creatureInstanceId = attackSourceCreatureInstanceId(combat);
    if (creatureInstanceId) {
      const creatureInPlay = findById(newPlayers[atkIdx].cardsInPlay, creatureInstanceId);
      if (creatureInPlay) {
        newPlayers[atkIdx] = {
          ...newPlayers[atkIdx],
          cardsInPlay: newPlayers[atkIdx].cardsInPlay.filter(c => c.instanceId !== creatureInstanceId),
          discardPile: [...newPlayers[atkIdx].discardPile, toCardInstance(creatureInPlay)],
        };
      }
    }
    return { state: initiateQueuedTraitorAttack({ ...state, players: newPlayers, combat: null }) };
  }

  const newCombat: CombatState = {
    ...combat,
    strikeAssignments: newAssignments,
    strikesTotal: newStrikesTotal,
    cancelByTapRemaining: newCancelRemaining > 0 ? newCancelRemaining : undefined,
    multiAttackCount: combat.multiAttackCount !== undefined ? combat.multiAttackCount - 1 : undefined,
  };

  // The canceled attack may have been the last unresolved one — e.g. it was
  // canceled after the reopened post-attack window (CRF 22: "cancel one of the
  // attacks after facing another attack"), leaving only already-resolved
  // strikes behind. `nextStrikePhase` returning null means no unresolved
  // strikes remain, so combat is over regardless of any unused cancel
  // allowance — finalize it now rather than leaving a stale combat state.
  const next = nextStrikePhase(newCombat);
  if (next === null) {
    logDetail('No unresolved strikes remain after cancellation — finalizing combat');
    return finalizeCombat({ ...state, players: newPlayers, combat: newCombat });
  }

  // If no more cancels available, proceed to strike resolution
  if (newCancelRemaining <= 0) {
    logDetail('No more cancel-by-tap opportunities — proceeding to resolution');
    return { state: { ...state, players: newPlayers, combat: { ...newCombat, assignmentPhase: 'done', ...next } } };
  }

  return { state: { ...state, players: newPlayers, combat: newCombat } };
}

