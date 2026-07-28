/**
 * @module engine/discard-substitute
 *
 * Shared plumbing for the `discard-substitute` replacement effect — an item
 * that may be thrown away *in place of* another card its company is being
 * forced to discard (Leaf Brooch, dm-171: "If a non-special item must be
 * discarded from the company of Leaf Brooch's bearer (according to any hazard
 * or resource effect), you may discard Leaf Brooch instead to fulfill this
 * requirement.").
 *
 * Every engine site that force-discards cards out of a company routes through
 * here: instead of moving the doomed cards to the discard pile it calls
 * {@link enqueueDiscardSubstituteOffer}, which either
 *
 * - returns a state carrying a `discard-substitute-offer` pending resolution
 *   (a substitute is present, so the owner gets to choose), or
 * - returns `null`, meaning "no substitute applies — do the discard yourself".
 *
 * The pending resolution *owns* the discard: whichever way the owner answers,
 * `applyDiscardSubstituteOfferResolution` performs the card movements. That
 * keeps the replacement decision in exactly one place instead of duplicating a
 * "did the brooch save this one?" branch in every forced-discard path.
 *
 * The wired-in paths are the ones the card text names — discards demanded by a
 * hazard or resource effect:
 *
 * - `discard-one-company-item` (Brigands tw-17/le-64, Pirates le-88, and
 *   Scourge of Fire ba-75, where the *opponent* picks the item),
 * - `move { from: 'items-on-wounded' }` wound triggers (the Trolls tw-016 /
 *   tw-103 / tw-112, which strip every non-special item off their victims),
 * - the gold-ring test discard (Rule 9.21), per CRF 22's Leaf Brooch ruling
 *   that the saved ring's bearer — not the brooch's — receives the special ring.
 *
 * Requirements phrased as "discard **one item** of the defender's choice" (the
 * combat `discard-item-from-company` sub-phase of An Article Missing dm-43, and
 * the choice half of `discard-one-company-item`) need no replacement machinery
 * of their own: the substitute is itself an item in the company, so the owner
 * fulfils the requirement simply by naming it.
 */

import type {
  GameState,
  PlayerId,
  CompanyId,
  CardInstanceId,
  CardDefinition,
  PendingResolution,
} from '../index.js';
import type { DiscardSubstituteEffect } from '../types/effects.js';
import { clonePlayers, defById, getCardEffects, companyById, matchesDefinition, toCardInstance } from './reducer-utils.js';
import { enqueueResolution } from './pending.js';
import { logDetail } from './legal-actions/log.js';

/** A `discard-substitute` item in play, paired with the effect that makes it one. */
export interface DiscardSubstituteInPlay {
  /** The substitute card instance (e.g. a Leaf Brooch on some company member). */
  readonly instanceId: CardInstanceId;
  /** Printed name of the substitute, for logging. */
  readonly name: string;
  /** The effect declaring what this card may stand in for. */
  readonly effect: DiscardSubstituteEffect;
}

/**
 * Every `discard-substitute` card borne by a character of `companyId`,
 * excluding any instance in `exclude` (a card cannot substitute for itself,
 * and a substitute already consumed by an earlier offer is gone).
 */
export function findDiscardSubstitutes(
  state: GameState,
  playerIndex: number,
  companyId: CompanyId,
  exclude: ReadonlySet<CardInstanceId> = new Set(),
): readonly DiscardSubstituteInPlay[] {
  const player = state.players[playerIndex];
  if (!player) return [];
  const company = companyById(player.companies, companyId);
  if (!company) return [];

  const found: DiscardSubstituteInPlay[] = [];
  for (const charId of company.characters) {
    const ch = player.characters[charId];
    if (!ch) continue;
    for (const item of ch.items) {
      if (exclude.has(item.instanceId)) continue;
      const itemDef = defById(state, item.definitionId);
      const effect = getCardEffects(itemDef)
        .find((e): e is DiscardSubstituteEffect => e.type === 'discard-substitute');
      if (effect) {
        found.push({
          instanceId: item.instanceId,
          name: itemDef?.name ?? (item.definitionId as string),
          effect,
        });
      }
    }
  }
  return found;
}

/**
 * True when `substitute` is allowed to stand in for the card `doomedDef`,
 * i.e. the substitute's `filter` (if any) matches that card's definition.
 */
export function substituteCovers(
  substitute: DiscardSubstituteInPlay,
  doomedDef: CardDefinition | undefined,
): boolean {
  if (!doomedDef) return false;
  if (!substitute.effect.filter) return true;
  return matchesDefinition(doomedDef, substitute.effect.filter);
}

/**
 * Enqueue a `discard-substitute-offer` in place of a forced discard.
 *
 * Returns `null` when no substitute in the company covers any of the doomed
 * cards — the caller must then perform the discard itself, exactly as before.
 * When a state is returned, the queued resolution owns the discard and the
 * caller must **not** move the cards.
 */
export function enqueueDiscardSubstituteOffer(
  state: GameState,
  opts: {
    /** Card instance that forced the discard (for the resolution's provenance). */
    readonly source: PendingResolution['source'];
    /** Owner of the doomed cards — the player who decides. */
    readonly owner: PlayerId;
    /** Auto-clear boundary for the queued resolution. */
    readonly scope: PendingResolution['scope'];
    /** Company holding both the doomed cards and any substitute. */
    readonly companyId: CompanyId;
    /** The cards the triggering effect requires to be discarded. */
    readonly requiredInstanceIds: readonly CardInstanceId[];
    /** Name of the card forcing the discard, for logging. */
    readonly sourceName: string;
  },
): GameState | null {
  const ownerIndex = state.players.findIndex(p => p.id === opts.owner);
  if (ownerIndex < 0 || opts.requiredInstanceIds.length === 0) return null;

  const substitutes = findDiscardSubstitutes(state, ownerIndex, opts.companyId, new Set(opts.requiredInstanceIds));
  if (substitutes.length === 0) return null;

  const player = state.players[ownerIndex];
  const doomedDefs = new Map<CardInstanceId, CardDefinition | undefined>();
  for (const ch of Object.values(player.characters)) {
    for (const item of ch.items) {
      if (opts.requiredInstanceIds.includes(item.instanceId)) {
        doomedDefs.set(item.instanceId, defById(state, item.definitionId));
      }
    }
  }

  const substitute = substitutes.find(s =>
    opts.requiredInstanceIds.some(id => substituteCovers(s, doomedDefs.get(id))),
  );
  if (!substitute) return null;

  logDetail(`${opts.sourceName}: ${substitute.name} may be discarded instead of ${opts.requiredInstanceIds.length} doomed card(s) — offering substitution`);

  return enqueueResolution(state, {
    source: opts.source,
    actor: opts.owner,
    scope: opts.scope,
    kind: {
      type: 'discard-substitute-offer',
      companyId: opts.companyId,
      substituteInstanceId: substitute.instanceId,
      requiredInstanceIds: [...opts.requiredInstanceIds],
      sourceName: opts.sourceName,
    },
  });
}

/**
 * Move the named cards off their bearers into `playerIndex`'s discard pile.
 * Instances that are no longer borne (already gone) are skipped, so the helper
 * is safe to call with a stale list.
 */
export function discardCardsFromCompany(
  state: GameState,
  playerIndex: number,
  instanceIds: readonly CardInstanceId[],
  reason: string,
): GameState {
  if (instanceIds.length === 0) return state;
  const targets = new Set(instanceIds);
  const cloned = clonePlayers(state);
  const player = cloned[playerIndex];
  if (!player) return state;

  const newCharacters = { ...player.characters };
  const discarded: ReturnType<typeof toCardInstance>[] = [];
  for (const [charId, charData] of Object.entries(newCharacters)) {
    const hits = charData.items.filter(i => targets.has(i.instanceId));
    if (hits.length === 0) continue;
    newCharacters[charId as CardInstanceId] = {
      ...charData,
      items: charData.items.filter(i => !targets.has(i.instanceId)),
    };
    for (const item of hits) {
      discarded.push(toCardInstance(item));
      const name = defById(state, item.definitionId)?.name ?? (item.definitionId as string);
      logDetail(`${reason}: discarding ${name}`);
    }
  }
  if (discarded.length === 0) return state;

  cloned[playerIndex] = {
    ...player,
    characters: newCharacters,
    discardPile: [...player.discardPile, ...discarded],
  };
  return { ...state, players: cloned };
}
