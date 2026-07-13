/**
 * @module engine/evil-hour
 *
 * Implements the two novel mechanics of **A More Evil Hour** (ba-48), a Balrog
 * permanent-event:
 *
 * 1. **Tap-on-opponent-scoring trigger** — "Tap this card when an opponent plays
 *    a card normally giving him three or more marshalling points." Modeled by
 *    the `evil-hour-tap-trigger` effect and applied as a passive reaction after
 *    every reducer step ({@link applyEvilHourTaps}): the engine diffs the
 *    opponent's in-play scoring zones between the pre-action and post-action
 *    state, and when a fresh card whose printed marshalling points meet the
 *    threshold entered play, it taps every untapped copy of the carrying card.
 *    "This card does not untap" is handled separately by the `no-auto-untap`
 *    play-flag (honoured in the untap phase).
 *
 * 2. **Conditional region-movement grant** — once discarded during the
 *    organization phase (see the `evil-hour-grant-movement` effect and its
 *    legal-action / reducer handler), the targeted company carries
 *    {@link Company.evilHourMovementBonus}. That company may move up to two
 *    additional regions whenever it moves **to** — or away **from** — a site
 *    where an opponent's company is present. The "and also, thereafter, when
 *    leaving this site" clause is read as the practical, symmetric reading:
 *    the bonus applies to a move whose origin **or** destination currently holds
 *    an opponent's company. {@link evilHourRegionBonus} computes the extra
 *    distance for a concrete origin→destination move.
 */

import type { GameState, PlayerId } from '../index.js';
import type { Company, PlayerState, CardInstanceId } from '../index.js';
import type { SiteCard } from '../types/cards.js';
import { CardStatus } from '../types/common.js';
import { defById, getCardEffects } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Collects the set of card **instance IDs** that occupy a player's in-play
 * scoring zones: bare cards in play (permanent-events, factions), every
 * character in every company, and the items and allies borne by those
 * characters. A card "played" by the player newly appears in this set; a card
 * that leaves play newly disappears from it. Piles (hand, deck, discard,
 * sideboard, set-aside) are deliberately excluded — only cards actually in play
 * can be "giving him marshalling points".
 */
function inPlayScoringInstances(player: PlayerState): Set<string> {
  const ids = new Set<string>();
  for (const cip of player.cardsInPlay) ids.add(cip.instanceId as string);
  for (const company of player.companies) {
    for (const charId of company.characters) {
      ids.add(charId as string);
      const char = player.characters[charId];
      if (!char) continue;
      for (const item of char.items) ids.add(item.instanceId as string);
      for (const ally of char.allies) ids.add(ally.instanceId as string);
    }
  }
  return ids;
}

/**
 * Printed ("normally giving") marshalling points of the card definition backing
 * an instance, or 0 when the definition carries no marshalling-point value
 * (sites, regions, most events).
 */
function printedMarshallingPoints(state: GameState, instanceId: CardInstanceId, player: PlayerState): number {
  // Resolve the definition from wherever the instance now sits in the player's
  // in-play zones.
  const cip = player.cardsInPlay.find(c => c.instanceId === instanceId);
  let definitionId = cip?.definitionId;
  if (!definitionId) {
    const char = player.characters[instanceId];
    if (char) definitionId = char.definitionId;
  }
  if (!definitionId) {
    for (const c of Object.values(player.characters)) {
      const item = c.items.find(i => i.instanceId === instanceId);
      if (item) { definitionId = item.definitionId; break; }
      const ally = c.allies.find(a => a.instanceId === instanceId);
      if (ally) { definitionId = ally.definitionId; break; }
    }
  }
  if (!definitionId) return 0;
  const def = defById(state, definitionId);
  const mp = (def as { marshallingPoints?: number } | undefined)?.marshallingPoints;
  return typeof mp === 'number' ? mp : 0;
}

/**
 * Passive reaction fired after every reducer step. For each player controlling
 * an untapped in-play card with an `evil-hour-tap-trigger` effect, taps that
 * card when the player's opponent just played (brought newly into play) a card
 * whose printed marshalling points meet the effect's threshold. Idempotent:
 * an already-tapped copy is untouched (and the companion `no-auto-untap`
 * play-flag keeps it tapped thereafter). `prev` is the pre-action state; `next`
 * is the post-action state.
 */
export function applyEvilHourTaps(prev: GameState, next: GameState): GameState {
  // Nothing to do unless some card with the trigger is in play and untapped.
  const anyTrigger = next.players.some(p => p.cardsInPlay.some(cip => {
    if (cip.status !== CardStatus.Untapped) return false;
    return getCardEffects(defById(next, cip.definitionId)).some(e => e.type === 'evil-hour-tap-trigger');
  }));
  if (!anyTrigger) return next;

  let players = next.players;
  for (let controllerIdx = 0; controllerIdx < players.length; controllerIdx++) {
    const controller = players[controllerIdx];
    const triggers = controller.cardsInPlay.filter(cip =>
      cip.status === CardStatus.Untapped &&
      getCardEffects(defById(next, cip.definitionId)).some(e => e.type === 'evil-hour-tap-trigger'));
    if (triggers.length === 0) continue;

    const opponentIdx = 1 - controllerIdx;
    const opponent = players[opponentIdx];
    const beforeIds = inPlayScoringInstances(prev.players[opponentIdx]);
    const afterIds = inPlayScoringInstances(opponent);

    let opponentScored = false;
    let scoredMax = 0;
    for (const id of afterIds) {
      if (beforeIds.has(id)) continue;
      // A card newly in the opponent's in-play scoring zones — i.e. just played.
      for (const trigger of triggers) {
        const eff = getCardEffects(defById(next, trigger.definitionId)).find(e => e.type === 'evil-hour-tap-trigger');
        if (eff?.type !== 'evil-hour-tap-trigger') continue;
        const mp = printedMarshallingPoints(next, id as CardInstanceId, opponent);
        if (mp >= eff.mpThreshold) { opponentScored = true; scoredMax = Math.max(scoredMax, mp); }
      }
    }
    if (!opponentScored) continue;

    logDetail(`A More Evil Hour: ${opponent.name} played a card worth ${scoredMax}+ marshalling points → tapping ${controller.name}'s A More Evil Hour`);
    const newCardsInPlay = controller.cardsInPlay.map(cip => {
      if (cip.status !== CardStatus.Untapped) return cip;
      const hasTrigger = getCardEffects(defById(next, cip.definitionId)).some(e => e.type === 'evil-hour-tap-trigger');
      return hasTrigger ? { ...cip, status: CardStatus.Tapped } : cip;
    });
    players = players.map((p, i) => i === controllerIdx ? { ...p, cardsInPlay: newCardsInPlay } : p) as unknown as typeof players;
  }

  if (players === next.players) return next;
  return { ...next, players };
}

/**
 * True when any company belonging to a player **other than** `playerId` is
 * currently present at the physical site location named `siteName`. Matched by
 * site *name* so that opposing-alignment copies of the same physical location
 * count as co-located (the same convention used elsewhere for "at the same
 * site" checks).
 */
export function siteHasOpponentCompany(state: GameState, playerId: PlayerId, siteName: string): boolean {
  for (const p of state.players) {
    if (p.id === playerId) continue;
    for (const company of p.companies) {
      if (!company.currentSite) continue;
      const def = defById(state, company.currentSite.definitionId);
      if (def?.name === siteName) return true;
    }
  }
  return false;
}

/**
 * Additional region distance the A More Evil Hour grant contributes to a
 * concrete `origin → destination` region move for `company`. Returns 0 unless
 * the company carries {@link Company.evilHourMovementBonus} **and** either
 * endpoint currently holds an opponent's company (the "moving to a site where an
 * opponent's company is present" and "thereafter, when leaving this site"
 * clauses). The bonus is a fixed +2 (the card's "up to two additional regions").
 */
export function evilHourRegionBonus(
  state: GameState,
  player: PlayerState,
  company: Company,
  originDef: SiteCard | undefined,
  destDef: SiteCard | undefined,
): number {
  if (!company.evilHourMovementBonus) return 0;
  const originHasOpp = !!originDef && siteHasOpponentCompany(state, player.id, originDef.name);
  const destHasOpp = !!destDef && siteHasOpponentCompany(state, player.id, destDef.name);
  if (!originHasOpp && !destHasOpp) return 0;
  logDetail(`A More Evil Hour: company ${company.id as string} gains +2 region distance (${originHasOpp ? 'leaving' : 'moving to'} an opponent-occupied site)`);
  return 2;
}
