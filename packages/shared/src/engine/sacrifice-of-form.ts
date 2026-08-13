/**
 * @module engine/sacrifice-of-form
 *
 * Sacrifice of Form (tw-321) — the deferred half of the card's ability that
 * cannot run inside `handleSacrificeOfForm` (`combat-actions.ts`), because the
 * Wizard's `CharacterInPlay` data must stay available while any *other*
 * strikes of the same attack (assigned to him or to company-mates) still
 * resolve — the CRF ruling that he "faces any effects of a failed strike that
 * was assigned to him" (e.g. Dragon's Blood) depends on that.
 *
 * `handleSacrificeOfForm` sets `CombatState.forcedStrikeDefeat` /
 * `forcedDefeatBodyCheckModifier` (reusing Liquid Fire wh-52's mechanism) and
 * records `pendingSacrificeOfForm`. This module consumes that marker once the
 * whole attack — not just the current strike — has finished: `sweepSacrificeOfForm`
 * discards the Wizard (his items placed off to the side with the host card,
 * MEAS §1 via `set-aside.ts`) and `sweepSacrificeOfFormReturn` reattaches the
 * host and returns the items if the same Wizard is ever put back into play.
 *
 * Both sweeps are prev/next diffs hooked into `postReduce` (`reducer.ts`), the
 * same reactive pattern `post-attack-play.ts` uses to detect "an attack just
 * ended" regardless of which of the many combat-teardown paths (strikes
 * resolved, trophy taken/declined, tidings queue exhausted, …) was taken.
 */

import type { GameState, CardInstanceId } from '../index.js';
import type { CardInPlay, ItemInPlay } from '../types/state-cards.js';
import type { PlayerState } from '../types/state-player.js';
import type { StatModifierEffect } from '../types/effects.js';
import { CardStatus } from '../types/common.js';
import { logDetail } from './legal-actions/log.js';
import { cardName, cleanupEmptyCompanies, defById, getCardEffects, partitionLeavingAllies, toCardInstance } from './reducer-utils.js';
import { freeOrDiscardFollowers } from './follower-dispersal.js';
import { placeCardSetAside } from './set-aside.js';
import { ownerOf } from '../types/state.js';
import { sameAttack } from './post-attack-play.js';
import { addConstraint } from './pending.js';

/**
 * Discard the Wizard named by a just-concluded attack's `pendingSacrificeOfForm`
 * marker: his items go off to the side with the host card (kept in play even
 * if the host itself is later discarded — MEAS §1 `setAsideKeepOnRemoval`,
 * mirroring the existing doc note on that flag); his allies and attached
 * hazards are discarded normally; his followers disperse to general influence
 * (CRF: not discarded); the Wizard card itself goes to his owner's discard
 * pile ("he becomes unrevealed"). Records `PlayerState.wizardSacrificed` the
 * first time this fires for a given player.
 */
function performSacrifice(
  state: GameState,
  hostInstanceId: CardInstanceId,
  characterInstanceId: CardInstanceId,
): GameState {
  const ownerIdx = state.players.findIndex(p => p.characters[characterInstanceId] !== undefined);
  if (ownerIdx === -1) {
    logDetail(`Sacrifice of Form: ${characterInstanceId as string} already left play — no-op`);
    return state;
  }
  const owner = state.players[ownerIdx];
  const char = owner.characters[characterInstanceId];
  const charName = cardName(state, char.definitionId, characterInstanceId as string);

  const { toHand, toDiscard: allyDiscards } = partitionLeavingAllies(state, char.allies);

  const newCharacters = { ...owner.characters };
  freeOrDiscardFollowers(state, newCharacters, char, 'sacrifice-of-form');
  delete newCharacters[characterInstanceId];

  const newCompanies = owner.companies.map(c => ({
    ...c,
    characters: c.characters.filter(id => id !== characterInstanceId),
  }));

  logDetail(
    `Sacrifice of Form: discarding ${charName} (he becomes unrevealed) — ${char.items.length} item(s) placed off to the side, ` +
    `${allyDiscards.length} ally/allies discarded, ${char.hazards.length} hazard(s) discarded, ${char.followers.length} follower(s) revert to GI`,
  );

  let working: GameState = {
    ...state,
    players: state.players.map((p, idx): PlayerState => {
      if (idx !== ownerIdx) return p;
      return {
        ...p,
        characters: newCharacters,
        companies: newCompanies,
        hand: [...p.hand, ...toHand],
        discardPile: [...p.discardPile, toCardInstance(char), ...allyDiscards],
        wizardSacrificed: p.wizardSacrificed ?? char.definitionId,
      };
    }) as [PlayerState, PlayerState],
  };

  // Attached hazards (corruption cards, etc.) return to their own owners.
  for (const hazard of char.hazards) {
    const hazOwner = ownerOf(hazard.instanceId);
    working = {
      ...working,
      players: working.players.map(p =>
        p.id === hazOwner ? { ...p, discardPile: [...p.discardPile, toCardInstance(hazard)] } : p,
      ) as [PlayerState, PlayerState],
    };
  }

  // Items are placed "off to the side" with the host — still in play, kept
  // even if the host is later discarded (the card converts them, per the
  // existing `setAsideKeepOnRemoval` doc note naming this card as its example).
  for (const item of char.items) {
    working = placeCardSetAside(working, hostInstanceId, toCardInstance(item), true);
  }

  return cleanupEmptyCompanies(working);
}

/**
 * `postReduce` sweep: performs the deferred discard once the attack a
 * Sacrifice of Form was played into has fully concluded. A prev/next diff on
 * `combat` (same technique as `enqueuePostAttackPlayOffers`) rather than a
 * hook at any single finalize exit point, since a defeated non-detainment
 * creature may pass through the `trophy-offer` sub-phase before combat truly
 * ends.
 */
export function sweepSacrificeOfForm(prev: GameState, next: GameState): GameState {
  const combat = prev.combat;
  const pending = combat?.pendingSacrificeOfForm;
  if (!combat || !pending) return next;
  if (next.combat && sameAttack(next.combat, combat)) return next;
  return performSacrifice(next, pending.hostInstanceId, pending.characterInstanceId);
}

/** Move a formerly set-aside item card back onto its Wizard as an in-play item. */
function itemInPlayFrom(card: CardInPlay): ItemInPlay {
  return { instanceId: card.instanceId, definitionId: card.definitionId, status: CardStatus.Untapped };
}

/**
 * Reattach a Sacrifice of Form host to the Wizard it sacrificed: sets
 * `attachedTo` and moves every item held in its `setAside` list onto the
 * Wizard's `items[]`.
 *
 * `collectCharacterEffects` (`effects/resolver.ts`) has no generic pathway
 * that turns a plain `attachedTo`-attached permanent-event's own `effects`
 * into bearer stat modifiers (unlike `attachedToItem`, which does), so the
 * card's `+1 prowess/body/direct-influence` `stat-modifier` effects are
 * synthesised here into `until-cleared` `character-stat-modifier` active
 * constraints on the Wizard — the same delivery mechanism opposed-roll
 * outcomes and Vilya-style bonuses use (`collectCharacterStatModifierEffects`).
 */
function reattachSacrificeOfForm(
  state: GameState,
  playerIdx: number,
  hostInstanceId: CardInstanceId,
  wizardId: CardInstanceId,
): GameState {
  const player = state.players[playerIdx];
  const host = player.cardsInPlay.find(c => c.instanceId === hostInstanceId);
  if (!host) return state;
  const setAsideIds = new Set((host.setAside ?? []).map(id => id as string));

  const returningItems: ItemInPlay[] = [];
  const remainingCardsInPlay: CardInPlay[] = [];
  for (const c of player.cardsInPlay) {
    if (setAsideIds.has(c.instanceId as string) && c.setAsideHost === hostInstanceId) {
      returningItems.push(itemInPlayFrom(c));
      continue;
    }
    remainingCardsInPlay.push(c);
  }
  const newCardsInPlay = remainingCardsInPlay.map((c): CardInPlay => {
    if (c.instanceId !== hostInstanceId) return c;
    const { setAside: _s, ...rest } = c;
    void _s;
    return { ...rest, attachedTo: wizardId };
  });

  logDetail(`Sacrifice of Form: ${wizardId as string} put back into play — reattaching ${returningItems.length} item(s), card placed with him`);

  let working: GameState = {
    ...state,
    players: state.players.map((p, idx): PlayerState => {
      if (idx !== playerIdx) return p;
      const wizard = p.characters[wizardId];
      if (!wizard) return p;
      return {
        ...p,
        cardsInPlay: newCardsInPlay,
        characters: { ...p.characters, [wizardId as string]: { ...wizard, items: [...wizard.items, ...returningItems] } },
      };
    }) as [PlayerState, PlayerState],
  };

  const hostDef = defById(working, host.definitionId);
  const bearerStats: readonly ('prowess' | 'body' | 'direct-influence')[] = ['prowess', 'body', 'direct-influence'];
  const statBonuses = getCardEffects(hostDef).filter(
    (e): e is StatModifierEffect & { stat: 'prowess' | 'body' | 'direct-influence'; value: number } =>
      e.type === 'stat-modifier' && bearerStats.includes(e.stat as 'prowess' | 'body' | 'direct-influence') && typeof e.value === 'number',
  );
  for (const bonus of statBonuses) {
    logDetail(`Sacrifice of Form: granting ${wizardId as string} ${bonus.value > 0 ? '+' : ''}${bonus.value} ${bonus.stat} while the card stays with him`);
    working = addConstraint(working, {
      source: hostInstanceId,
      sourceDefinitionId: host.definitionId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: wizardId },
      kind: { type: 'character-stat-modifier', stat: bonus.stat, value: bonus.value, characterId: wizardId },
    });
  }

  return working;
}

/**
 * `postReduce` sweep: when a Wizard previously sacrificed by a Sacrifice of
 * Form host is put back into play by any means (a `characters` map entry
 * newly appears for an instance ID some in-play host still names via
 * `sacrificeOfFormCharacterInstanceId` with no `attachedTo` yet), reattach the
 * host and return his items. A prev/next diff so it fires regardless of how
 * the character re-entered play.
 */
export function sweepSacrificeOfFormReturn(prev: GameState, next: GameState): GameState {
  let working = next;
  for (let idx = 0; idx < working.players.length; idx++) {
    const player = working.players[idx];
    for (const card of player.cardsInPlay) {
      if (card.attachedTo) continue;
      const wizardId = card.sacrificeOfFormCharacterInstanceId;
      if (!wizardId) continue;
      const wasInPlay = prev.players[idx]?.characters[wizardId] !== undefined;
      const nowInPlay = player.characters[wizardId] !== undefined;
      if (wasInPlay || !nowInPlay) continue;
      working = reattachSacrificeOfForm(working, idx, card.instanceId, wizardId);
    }
  }
  return working;
}
