/**
 * @module engine/press-gang
 *
 * Press-gang (ba-22) — a hazard permanent-event that installs a *replacement
 * effect* on character removal. While a Press-gang is in play, whenever a
 * character controlled by the Press-gang controller's **opponent** would
 * otherwise be discarded from play — by any mechanism: combat body-check
 * elimination, corruption-check failure, or an effect-driven discard/eliminate —
 * the character is captured "off to the side" with the Press-gang instead of
 * leaving play (CRF 22).
 *
 * On capture (see {@link tryPressGangCharacter}):
 *
 * - all cards on the character are stripped — items and allies to their owner's
 *   discard pile, attached hazards back to their owners' discard piles. His
 *   **followers** are *not* discarded (CRF 22): they revert to general influence
 *   like any character that loses its controller, with the mind subtraction
 *   deferred (CoE 3.13 — removal happens outside the owner's organization phase);
 * - the character card is placed off to the side with the Press-gang host via the
 *   shared MEAS §1 set-aside machinery (so no instance is dropped);
 * - any character already held off to the side with that Press-gang is returned
 *   to its owner's hand (a Press-gang holds at most one captured character).
 *
 * A captured character gives his player negative character marshalling points;
 * that scoring lives in `recompute-derived.ts` (the set-aside MP pass reads the
 * host's `press-gang` effect and subtracts the captured character's printed MP).
 *
 * The interception is wired into every character-removal path: the central
 * {@link discardCharacter}/{@link eliminateCharacter} helper, the combat
 * body-check elimination (`combat-strike.ts`), the corruption-check resolutions
 * (`pending-reducers.ts`, `reducer-free-council.ts`), and the body-check discard
 * (`combat-actions.ts`).
 */

import type { GameState, CardInPlay, CardInstance, CardInstanceId, CharacterInPlay, Company, PlayerState } from '../index.js';
import { isCharacterCard } from '../types/cards.js';
import { ownerOf } from '../types/state.js';
import { defById, toCardInstance, cleanupEmptyCompanies, sweepCompanyMembershipChangedEvents } from './reducer-utils.js';
import { placeCardSetAside, isSetAsideCard } from './set-aside.js';
import { logDetail } from './legal-actions/log.js';

/** True when this card definition carries the `press-gang` marker effect. */
export function defHasPressGang(state: GameState, definitionId: CardInPlay['definitionId']): boolean {
  const def = defById(state, definitionId);
  if (!def || !('effects' in def)) return false;
  const effects = (def as { effects?: readonly { type: string }[] }).effects;
  return !!effects?.some(e => e.type === 'press-gang');
}

/**
 * Locate a live (non-set-aside) Press-gang permanent-event in the opponent of
 * `characterOwnerIndex`'s `cardsInPlay` — the card that would capture a
 * character of `characterOwnerIndex` about to leave play. Returns null when the
 * opponent controls no Press-gang.
 */
export function pressGangHostFor(state: GameState, characterOwnerIndex: number): CardInPlay | null {
  const opponentIndex = characterOwnerIndex === 0 ? 1 : 0;
  const opponent = state.players[opponentIndex];
  for (const card of opponent.cardsInPlay) {
    if (isSetAsideCard(card)) continue;
    if (defHasPressGang(state, card.definitionId)) return card;
  }
  return null;
}

/**
 * Apply Press-gang's replacement effect to a character (`characterId`, owned by
 * `characterOwnerIndex`) that would otherwise be discarded/eliminated from play.
 * Returns the resulting state when an opponent Press-gang captures the character,
 * or `null` when no Press-gang applies (the caller proceeds with the normal
 * removal). `charInPlay` is the character's full in-play record at the point of
 * removal (its items/allies/hazards/followers are read here).
 */
export function tryPressGangCharacter(
  state: GameState,
  characterOwnerIndex: number,
  characterId: CardInstanceId,
  charInPlay: CharacterInPlay,
): GameState | null {
  const host = pressGangHostFor(state, characterOwnerIndex);
  if (!host) return null;

  const charDef = defById(state, charInPlay.definitionId);
  const charName = isCharacterCard(charDef) ? charDef.name : (characterId as string);
  logDetail(`Press-gang: capturing ${charName} (${characterId as string}) off to the side with ${host.instanceId as string}`);

  const hostPlayerIndex = state.players.findIndex(p =>
    p.cardsInPlay.some(c => c.instanceId === host.instanceId),
  );
  const hazardPlayerIndex = characterOwnerIndex === 0 ? 1 : 0;

  // Mutable per-player accumulators (PlayerState is deeply readonly).
  const hands: CardInstance[][] = state.players.map(p => [...p.hand]);
  const discards: CardInstance[][] = state.players.map(p => [...p.discardPile]);
  const cardsInPlay: CardInPlay[][] = state.players.map(p => [...p.cardsInPlay]);
  const characters = state.players.map(p => ({ ...p.characters })) as
    Record<CardInstanceId, CharacterInPlay>[];
  const companies: Company[][] = state.players.map(p =>
    p.companies.map(c => ({ ...c, characters: [...c.characters] })));

  const playerIndexOf = (id: import('../index.js').PlayerId): number =>
    state.players.findIndex(p => p.id === id);

  // 1. Bump any character already held off to the side with this Press-gang back
  //    to its owner's hand (a Press-gang holds at most one captured character).
  const bumped = new Set<string>();
  cardsInPlay[hostPlayerIndex] = cardsInPlay[hostPlayerIndex].filter(c => {
    if (c.setAsideHost !== host.instanceId) return true;
    // Every character a Press-gang captures belongs to the controller's single
    // opponent, so a captured card's owner is always the same victim player
    // (`characterOwnerIndex`); use that when the instance id is not owner-prefixed.
    const ownerIdxRaw = playerIndexOf(ownerOf(c.instanceId));
    const ownerIdx = ownerIdxRaw === -1 ? characterOwnerIndex : ownerIdxRaw;
    hands[ownerIdx].push(toCardInstance(c));
    bumped.add(c.instanceId as string);
    logDetail(`Press-gang: returning previously-held ${c.instanceId as string} to owner's hand`);
    return false;
  });
  if (bumped.size > 0) {
    cardsInPlay[hostPlayerIndex] = cardsInPlay[hostPlayerIndex].map(c =>
      c.instanceId === host.instanceId
        ? { ...c, setAside: (c.setAside ?? []).filter(id => !bumped.has(id as string)) }
        : c);
  }

  // 2. Strip all cards on the character: items and allies to the owner's discard,
  //    attached hazards back to their owners' discard piles.
  for (const item of charInPlay.items) discards[characterOwnerIndex].push(toCardInstance(item));
  for (const ally of charInPlay.allies) discards[characterOwnerIndex].push(toCardInstance(ally));
  for (const hazard of charInPlay.hazards) {
    let hazOwnerIdx = playerIndexOf(ownerOf(hazard.instanceId));
    if (hazOwnerIdx === -1) hazOwnerIdx = hazardPlayerIndex;
    discards[hazOwnerIdx].push(toCardInstance(hazard));
  }

  // 3. Followers are NOT discarded (CRF 22): they revert to general influence,
  //    with the mind subtraction deferred (removal is outside the owner's org
  //    phase, CoE 3.13).
  for (const followerId of charInPlay.followers) {
    const follower = characters[characterOwnerIndex][followerId];
    if (follower && follower.controlledBy === characterId) {
      logDetail(`Press-gang: follower ${followerId as string} reverts to general influence (subtraction deferred)`);
      characters[characterOwnerIndex][followerId] = { ...follower, controlledBy: 'general', influenceUnsubtracted: true };
    }
  }

  // 4. Remove the character from its company and the owner's characters map.
  const affectedCompanies = companies[characterOwnerIndex]
    .filter(c => c.characters.includes(characterId))
    .map(c => c.id);
  delete characters[characterOwnerIndex][characterId];
  companies[characterOwnerIndex] = companies[characterOwnerIndex].map(c =>
    c.characters.includes(characterId)
      ? { ...c, characters: c.characters.filter(id => id !== characterId) }
      : c);

  const players = state.players.map((p, idx): PlayerState => ({
    ...p,
    hand: hands[idx],
    discardPile: discards[idx],
    cardsInPlay: cardsInPlay[idx],
    characters: characters[idx],
    companies: companies[idx],
  })) as [PlayerState, PlayerState];

  // 5. Register the character card off to the side with the Press-gang host.
  let working: GameState = { ...state, players };
  working = placeCardSetAside(working, host.instanceId, {
    instanceId: characterId,
    definitionId: charInPlay.definitionId,
  });

  // 6. Clean up empty companies and fire any company-membership-changed events.
  working = cleanupEmptyCompanies(working);
  working = sweepCompanyMembershipChangedEvents(working, affectedCompanies);
  return working;
}
