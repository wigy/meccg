/**
 * @module visibility
 *
 * Identity-reveal bookkeeping for card instances.
 *
 * MECCG card identities are either public (known to all players and
 * spectators) or private (known only to the owner, or to whoever last
 * touched them). The authoritative record of which identities have
 * become public is {@link GameState.revealedInstances}. It is grown by
 * {@link accrueRevealedInstances} in a single post-reducer pass, so no
 * individual reducer path needs to call a reveal helper — any instance
 * that lands in a location classified public to the opponent is picked
 * up automatically.
 *
 * The classification mirrors {@link buildOpponentView}'s redaction in
 * `projection.ts`: whatever the opponent can see the identity of there
 * counts as public here. Locations the opponent sees only as UNKNOWN
 * (hand, play deck, site deck, sideboard, own discard, unrevealed
 * on-guard, unrevealed destination site, draft pools) are private and
 * their contents are not added.
 *
 * The map is append-only: once an instance is revealed it stays revealed
 * even if it later moves into a private location (e.g. a played short
 * event ends up face-down in its owner's discard pile — the opponent
 * already saw the identity when the card transited the chain, so the
 * record persists). It drives only the opponent's *toast* naming
 * ({@link extractActionCardDefs}) — never the hand/play-deck redaction in
 * `projection.ts`.
 *
 * A second, narrower map, {@link GameState.handRevealedInstances}, tracks
 * identities an explicit effect revealed while the card sat in a
 * normally-private pile (a forced hand reveal, a deck peek). It is grown
 * only by {@link revealInstances} — never by the automatic accrual pass —
 * and is what `projection.ts` consults to redact the opponent's hand and
 * play deck. The split matters because {@link accrueRevealedInstances}
 * also picks up identities from zones that can later become private again
 * (e.g. a character played into a company, then returned to hand by a
 * CoE 2.II.8 general-influence overflow): the opponent legitimately knew
 * the identity while the character was in play, but that must not leak
 * into the hand view once it is back in a private hand.
 */

import type { GameState, CardInstance } from '../types/state.js';
import { Phase } from '../types/state.js';
import type { CardInstanceId, CardDefinitionId } from '../types/common.js';
import { activePlayerState } from './reducer-utils.js';

/**
 * Explicitly record one or more instances as publicly known. Use this
 * for reducer paths that play a card without transiting a public pile
 * (e.g. a short event that skips the chain and goes straight to its
 * owner's face-down discard — see CoE rule on card plays always being
 * public), or that force a genuine reveal of cards sitting in an
 * otherwise-private pile (e.g. Rolled down to the Sea, wh-29, forcing the
 * opponent to reveal their hand; Riddling Talk, td-148, revealing it for a
 * guess). The post-reducer accrual would otherwise miss these: the played
 * card's final location is private, and hand/play-deck contents are never
 * swept by {@link accrueRevealedInstances} at all.
 *
 * Also grows {@link GameState.handRevealedInstances}, which drives the
 * opponent's hand/play-deck redaction in `projection.ts`. That map only
 * ever grows from explicit calls like this one — never from the automatic
 * public-occupancy accrual — so an instance that merely passed through an
 * unrelated public zone (e.g. a character played into a company) does not
 * leak its identity if it later lands back in a private hand.
 *
 * TODO: when the reducer is refactored so short events always transit
 * the chain (the chain is public, so accrual picks them up naturally),
 * the play-without-transiting-a-pile calls can be dropped.
 */
export function revealInstances(
  state: GameState,
  instances: readonly CardInstance[],
): GameState {
  if (instances.length === 0) return state;
  const next: Record<string, CardDefinitionId> = { ...state.revealedInstances };
  const nextHand: Record<string, CardDefinitionId> = { ...state.handRevealedInstances };
  let changed = false;
  let handChanged = false;
  for (const inst of instances) {
    const key = inst.instanceId as string;
    if (next[key] !== inst.definitionId) {
      next[key] = inst.definitionId;
      changed = true;
    }
    if (nextHand[key] !== inst.definitionId) {
      nextHand[key] = inst.definitionId;
      handChanged = true;
    }
  }
  if (!changed && !handChanged) return state;
  return {
    ...state,
    revealedInstances: changed ? next : state.revealedInstances,
    handRevealedInstances: handChanged ? nextHand : state.handRevealedInstances,
  };
}

/**
 * Walks every location in `state` that is public to the opponent and
 * collects `instanceId → definitionId` pairs. Combined with the state's
 * existing {@link GameState.revealedInstances} by {@link accrueRevealedInstances}.
 */
function collectPublicInstanceIds(state: GameState): Record<string, CardDefinitionId> {
  const out: Record<string, CardDefinitionId> = {};
  const add = (inst: { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId } | null | undefined): void => {
    if (!inst) return;
    out[inst.instanceId as string] = inst.definitionId;
  };
  const addAll = (list: readonly { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId }[] | undefined): void => {
    if (!list) return;
    for (const inst of list) add(inst);
  };

  // Chain of effects: cards being resolved are named publicly.
  if (state.chain) {
    for (const entry of state.chain.entries) {
      if (entry.card) add(entry.card);
    }
  }

  for (const player of state.players) {
    // Publicly visible piles.
    addAll(player.cardsInPlay);
    addAll(player.siteDiscardPile);
    addAll(player.killPile);
    addAll(player.outOfPlayPile);

    // Characters in play and their attachments.
    for (const ch of Object.values(player.characters)) {
      add(ch);
      addAll(ch.items);
      addAll(ch.allies);
      addAll(ch.hazards);
    }

    // Company zones.
    for (const company of player.companies) {
      add(company.currentSite);
      addAll(company.hazards);
      for (const og of company.onGuardCards) {
        if (og.revealed) add(og);
      }
    }
  }

  // Active company's destination site once the M/H phase has revealed it.
  if (state.phaseState.phase === Phase.MovementHazard) {
    const mh = state.phaseState;
    if (mh.siteRevealed && state.activePlayer !== null) {
      const active = activePlayerState(state);
      const activeCompany = active?.companies[mh.activeCompanyIndex];
      add(activeCompany?.destinationSite);
    }
  }

  // Setup phase: drafted characters and set-aside collision piles are
  // public once revealed; the pools and face-down picks are not.
  if (state.phaseState.phase === Phase.Setup) {
    const step = state.phaseState.setupStep;
    if (step.step === 'character-draft') {
      step.draftState.forEach((ds, i) => {
        addAll(ds.drafted);
        // Fallen-wizard Stage resources (e.g. Hidden Haven wh-75) are drafted
        // face-up and revealed to the opponent as they are taken (CRF 22), so
        // their identities are public.
        addAll(ds.draftedStageResources);
        // A Hidden Haven paired to a Ruins & Lairs "brings out" that site when
        // revealed (CRF 22: "you must bring out your starting site when you
        // reveal Hidden Haven"). The site card itself still lives in the
        // player's otherwise-private site deck, so reveal its identity here —
        // otherwise the opponent sees the pairing but not which site it names.
        for (const pairing of ds.stageResourceSites ?? []) {
          add(state.players[i]?.siteDeck.find(c => c.instanceId === pairing.siteInstanceId));
        }
      });
      for (const sa of step.setAside) addAll(sa);
    } else if (step.step === 'item-draft') {
      // Unassigned minor items are known throughout the draft and the
      // projection already shows them to both players. The carried-over
      // `remainingPool` is deliberately NOT added here: per CoE rule 1.8
      // leftover pool characters that end up shuffled into the play deck
      // in the subsequent character-deck-draft step must stay hidden
      // from the opponent. Treating them as public during item-draft
      // would leak their identities via `revealedInstances` into the
      // later private step.
      for (const ids of step.itemDraftState) addAll(ids.unassignedItems);
    }
    // character-deck-draft: remainingPool is private (opponent can't see
    // which pool characters are still available) — do not add.
    // starting-site-selection: selectedSites are ViewCards already; the
    // opponent sees them via their own channel. Not sourced here.
  }

  return out;
}

/**
 * Returns `state` with {@link GameState.revealedInstances} grown to
 * include every identity that is publicly visible in `state`. A no-op
 * if no new identities would be added. Idempotent: running it twice
 * yields the same map.
 */
export function accrueRevealedInstances(state: GameState): GameState {
  const additions = collectPublicInstanceIds(state);
  // Fast-path: nothing new.
  let changed = false;
  for (const id in additions) {
    if (state.revealedInstances[id as CardInstanceId] !== additions[id as CardInstanceId]) {
      changed = true;
      break;
    }
  }
  if (!changed) return state;
  return {
    ...state,
    revealedInstances: { ...state.revealedInstances, ...additions },
  };
}
