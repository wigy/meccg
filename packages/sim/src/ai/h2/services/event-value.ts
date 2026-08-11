/**
 * @module ai/h2/services/event-value
 *
 * What an event does, read off the effect DSL.
 *
 * Lifted out of the `events` module because a second consumer needs the same
 * number and a second copy would be a second opinion. `card-price` prices a
 * hazard creature by its contribution to `hazard-plan`; every other card
 * without marshalling points — hazard events, resource events, corruption
 * cards — it priced at the flat floor, because there was nowhere to ask what
 * an event was worth.
 *
 * The corpus says that gap is expensive. Over 196 recorded discard decisions
 * where a human and the agent both discarded, the human threw a resource or
 * hazard *event* 44 times against the agent's 17 — and once every unpriceable
 * card was floored to the same value, which card the agent threw among them
 * became arbitrary, measured as discard agreement falling from 15.8% to 6.6%
 * and refusing to move at any floor between 1.0 and 0.1. A floor cannot
 * discriminate; only a valuation can.
 *
 * Two questions, one model. `forAction` answers what an event achieves when
 * played at a *named* target, which is what `events` scores. `held` answers
 * what it would achieve at the best target available, which is what a card in
 * hand is worth to keep. Sharing the effect reading between them is the point:
 * a card the agent would pay to play and refuses to keep is an incoherence
 * nothing in the output would explain.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { ModuleContext } from '../core/types.js';
import { namedCharacter, namedDiscardTarget } from '../core/action-fields.js';
import { computeDefence } from './defence.js';
import { rosterOf } from './strike/prowess.js';
import type { StrikeTarget } from './strike/prowess.js';

/** A declared effect, as far as this module reads one. */
export interface Effect {
  readonly type?: string;
  readonly from?: string | readonly string[];
  readonly to?: string;
  readonly count?: number;
  readonly filter?: Filter;
  readonly constraint?: string;
  readonly cost?: { readonly tap?: string };
  readonly apply?: Effect;
}

/** A DSL filter, as far as this module reads one. */
export type Filter = Readonly<Record<string, unknown>>;

/** What an event would achieve, and the reading that produced it. */
export interface EventGain {
  readonly tsd: number;
  readonly reason: string;
}

/**
 * Effect types that declare *how* a card may be played, not what it does.
 *
 * Deliberately short and deliberately conservative. A card whose whole effect
 * list is drawn from this set changes nothing when it resolves — that is a
 * statement about the DSL, not a judgement about the card — and anything not
 * listed here is treated as a real effect, so an unfamiliar type makes the
 * module decline rather than claim the card is worthless.
 */
const DECLARATION_ONLY = new Set([
  'play-flag',
  'play-window',
  'play-condition',
  'play-restriction',
  'duplication-limit',
  'deck-restriction',
  'name-alias',
]);

/**
 * The constraint that shuts a company to creatures for the turn.
 *
 * Stealth is the most-offered short event in the game by a wide margin — 150 of
 * 276 appearances in three self-play games — and this is what it does: "No
 * creature hazards may be played on his company this turn." That is not a
 * card-specific effect this module has to guess at. It is the whole of the
 * opponent's hazard plan against one company, and `defence` already computes
 * exactly that.
 */
const NO_CREATURES = 'no-creature-hazards-on-company';

/** Whether an effect's `from` names a zone, however it is written. */
function fromIncludes(effect: Effect, zone: string): boolean {
  const from = effect.from;
  if (typeof from === 'string') return from === zone;
  return Array.isArray(from) && from.includes(zone);
}

/**
 * Whether a card could be what a filter is asking for.
 *
 * Deliberately three-valued in effect: an operator or key this does not know
 * returns `true`, so an unread filter makes the module assume there *is* a
 * target and decline. The alternative — assuming no target — would let it
 * announce that a card does nothing on the strength of a filter it could not
 * read, which is exactly the mistake this replaced.
 */
function couldMatch(filter: Filter | undefined, def: CardDefinition | undefined): boolean {
  if (!filter) return true;
  const card = def as unknown as {
    cardType?: string; eventType?: string; keywords?: readonly string[];
  } | undefined;
  if (!card) return true;

  /** Whether a value the filter names is satisfied by a field on the card. */
  const satisfies = (expected: unknown, actual: string | undefined): boolean => {
    if (typeof expected === 'string') return expected === actual;
    const operators = expected as { $in?: readonly string[] } | null;
    if (operators && Array.isArray(operators.$in)) return operators.$in.includes(actual ?? '');
    return true;
  };

  for (const [key, value] of Object.entries(filter)) {
    switch (key) {
      case '$and':
        if (!(value as Filter[]).every(clause => couldMatch(clause, def))) return false;
        break;
      case '$not':
        if (couldMatch(value as Filter, def)) return false;
        break;
      case 'cardType':
        if (!satisfies(value, card.cardType)) return false;
        break;
      case 'eventType':
        if (!satisfies(value, card.eventType)) return false;
        break;
      case 'keywords': {
        const includes = (value as { $includes?: string } | null)?.$includes;
        if (typeof includes !== 'string') break;
        if (!(card.keywords ?? []).includes(includes)) return false;
        break;
      }
      // An operator this does not know: assume it could match, so the caller
      // declines rather than declaring the card useless.
      default:
        break;
    }
  }
  return true;
}

/** Whether anything on the board could be what a removal is aimed at. */
function hasRemovalTarget(removal: Effect, context: ModuleContext): boolean {
  const { view, cardPool } = context;
  const zones = [view.self.cardsInPlay, view.opponent.cardsInPlay];
  for (const zone of zones) {
    for (const card of zone) {
      if (couldMatch(removal.filter, cardPool[card.definitionId])) return true;
    }
  }
  // Hazards attached to characters are in play too, on either side.
  for (const characters of [view.self.characters, view.opponent.characters]) {
    for (const character of Object.values(characters)) {
      for (const hazard of character.hazards) {
        if (couldMatch(removal.filter, cardPool[hazard.definitionId])) return true;
      }
    }
  }
  return false;
}

/**
 * Locates an in-play instance across both the free-standing `cardsInPlay`
 * zone and hazards attached to characters, on either side, mirroring
 * {@link hasRemovalTarget}. Null when the instance is not in either.
 *
 * `attached` matters beyond bookkeeping: a free-standing card in either
 * zone is priced correctly regardless of whose zone lists it, because
 * `defence` already measures its effect on *our* companies directly — a
 * hazard event the opponent played still boosts attacks on us no matter
 * whose bucket the engine happens to file it under. A hazard attached to a
 * character is different: `defence` has no model for what it does to that
 * character (corruption, say), so the only provable fact about it is *whose*
 * character carries it — the corruption of a character we do not control
 * cannot be a benefit to us, whatever it is.
 */
function findInPlay(
  view: ModuleContext['view'],
  instanceId: CardInstanceId,
): { readonly ours: boolean; readonly attached: boolean; readonly definitionId: string } | null {
  const self = view.self.cardsInPlay.find(c => c.instanceId === instanceId);
  if (self) return { ours: true, attached: false, definitionId: self.definitionId as string };
  const opponent = view.opponent.cardsInPlay.find(c => c.instanceId === instanceId);
  if (opponent) return { ours: false, attached: false, definitionId: opponent.definitionId as string };
  for (const character of Object.values(view.self.characters)) {
    const hazard = character.hazards.find(h => h.instanceId === instanceId);
    if (hazard) return { ours: true, attached: true, definitionId: hazard.definitionId as string };
  }
  for (const character of Object.values(view.opponent.characters)) {
    const hazard = character.hazards.find(h => h.instanceId === instanceId);
    if (hazard) return { ours: false, attached: true, definitionId: hazard.definitionId as string };
  }
  return null;
}

/** Every effect the card declares, including the ones nested under `apply`. */
function flatten(effects: readonly Effect[]): Effect[] {
  return effects.flatMap(effect => (effect.apply ? [effect, ...flatten([effect.apply])] : [effect]));
}

/**
 * The company a `play-target: character` action is aimed at, from our own seat.
 *
 * Stealth taps a scout to protect *his* company, so the action names the
 * character and the value is about the company he is in.
 *
 * It names him in `targetScoutInstanceId`, though — not the `targetCharacterId`
 * other character-targeting short events use. Reading one field where the
 * engine keeps the answer in another has now caused six bugs here, so the
 * spellings live in `core/action-fields` rather than in each module's guess.
 */
function targetCompanyRoster(
  action: GameAction,
  context: ModuleContext,
): { roster: readonly StrikeTarget[]; size: number } | null {
  const targetId = namedCharacter(action);
  if (!targetId) return null;
  const company = context.view.self.companies.find(c => c.characters.includes(targetId));
  if (!company) return null;
  return {
    roster: rosterOf(company, context.view.self.characters, context.cardPool),
    size: company.characters.length,
  };
}

/** What an event is worth if it resolves, or null when the family is unknown. */
export function gainOf(
  effects: readonly Effect[],
  context: ModuleContext,
  action: GameAction,
): { tsd: number; reason: string } | null {
  const { tunables } = context;

  // Shutting a company to creatures for the turn is worth the whole hazard plan
  // the opponent would otherwise aim at it — which is what `defence` computes,
  // against the creatures this opponent has actually shown.
  if (flatten(effects).some(e => e.type === 'add-constraint' && e.constraint === NO_CREATURES)) {
    const target = targetCompanyRoster(action, context);
    if (!target) return null;
    const defence = computeDefence(context.view, context.cardPool, context.standing, tunables);
    const harm = defence.expectedHarm(target.roster, target.size);
    return {
      tsd: harm,
      reason: `no creature may be played on that company this turn — ${harm.toFixed(1)} of harm `
        + `they cannot aim at its ${target.size} character(s)`,
    };
  }

  const recovery = effects.find(e => e.type === 'move' && (e.to === 'hand' || e.to === 'deck'));
  if (recovery) {
    const cards = recovery.count ?? 1;
    return {
      tsd: cards * tunables.resourceDrawValue,
      reason: `${cards} card(s) back to ${recovery.to}, at what a draw is worth — a floor, since `
        + 'the card is chosen rather than drawn',
    };
  }

  const removal = effects.find(e => e.type === 'move'
    && e.to === 'discard'
    && (fromIncludes(e, 'in-play') || String(e.from ?? '').startsWith('attached')));
  if (removal) {
    // With nothing to reach, the play resolves for nothing, and that is a fact.
    if (!hasRemovalTarget(removal, context)) {
      return { tsd: 0, reason: 'there is nothing in play it could discard' };
    }
    // With something to reach, the card is worth what *that* card was doing.
    // One thing it might be doing is declared: a hazard event that makes every
    // attack stronger. Anything else this module still cannot price.
    return reliefFromRemoval(removal, context, action);
  }

  return null;
}

/**
 * What discarding the reachable card this action actually names is worth, or
 * null.
 *
 * The only thing a card in play does that this module can price is what
 * `defence` already prices from the other direction: a hazard event declaring a
 * modifier on every attack. Minions Stir gives the Orcs coming at our companies
 * +1 strike and +1 prowess each, so taking it off the board is worth the harm it
 * stops — summed over our companies, each facing its own size in hazards, which
 * is the same convention `characters` compares company shapes with.
 *
 * Marvels Told, Voices of Malice, Ancient Secrets and The Cock Crows each
 * enumerate one `play-short-event` action per eligible target, on either
 * side of the table — the engine's legal-action generator does not restrict
 * these to a player's own hazards, and correctly so, but the engine, not a
 * later sub-flow, has already picked which card this specific action reaches
 * (`namedDiscardTarget`). Every one of those actions must be priced by *that*
 * card, not by whichever reachable card would be best. A module that priced
 * "the best reachable card" for all of them alike used to hand every one of
 * those actions the same score, including the ones that reach a hazard
 * *attached to a character on the opponent's side* — discarding one of those
 * relieves the opponent's character, not our companies, and `defence` has no
 * model of that character-specific effect to price it by, so it is a proven
 * zero rather than a guess.
 *
 * A free-standing card in either zone (Minions Stir, say) is priced by
 * `defence` directly regardless of whose zone lists it — a hazard event the
 * opponent played still boosts attacks on us no matter whose bucket the
 * engine files it under, so there is no ownership override for that case.
 * A target on our own side (or a free-standing one either side) whose relief
 * this cannot price still declines — that is the same "cannot price it"
 * honesty as before, just now scoped to the right card. A sweep-mode effect
 * (Wizard's River-horses) names no single target, so it falls back to
 * pricing the best reachable match across both sides — the sweep takes all
 * of them, wherever they are.
 */
function reliefFromRemoval(
  removal: Effect,
  context: ModuleContext,
  action: GameAction,
): { tsd: number; reason: string } | null {
  const { view, cardPool, standing, tunables } = context;
  const defence = computeDefence(view, cardPool, standing, tunables);
  const companies = view.self.companies.map(company => ({
    roster: rosterOf(company, view.self.characters, cardPool),
    size: company.characters.length,
  }));
  const now = companies.reduce((sum, c) => sum + defence.expectedHarm(c.roster, c.size), 0);
  const reliefFrom = (instanceId: string): number => now - companies.reduce(
    (sum, c) => sum + defence.harmWithout(instanceId, c.roster, c.size), 0,
  );

  const target = namedDiscardTarget(action);
  if (target) {
    const located = findInPlay(view, target);
    if (located?.attached && !located.ours) {
      return { tsd: 0, reason: 'attached to a character we do not control — discarding it relieves the '
        + 'opponent, not us' };
    }
    const relief = reliefFrom(target as string);
    if (relief <= 0) return null;
    const def = located ? cardPool[located.definitionId] : undefined;
    const name = (def as unknown as { name?: string } | undefined)?.name ?? (target as string);
    return {
      tsd: relief,
      reason: `discarding ${name} takes ${relief.toFixed(1)} of harm off our companies — `
        + 'the attacks it was strengthening go back to their printed numbers',
    };
  }

  // Sweep mode: no single named target, so price the best reachable match —
  // the effect takes all of them regardless.
  let best: { relief: number; name: string } | null = null;
  for (const zone of [view.self.cardsInPlay, view.opponent.cardsInPlay]) {
    for (const card of zone) {
      const def = cardPool[card.definitionId];
      if (!couldMatch(removal.filter, def)) continue;
      const relief = reliefFrom(card.instanceId as string);
      if (relief > 0 && (!best || relief > best.relief)) {
        best = {
          relief,
          name: (def as unknown as { name?: string } | undefined)?.name ?? (card.definitionId as string),
        };
      }
    }
  }
  if (!best) return null;
  return {
    tsd: best.relief,
    reason: `discarding ${best.name} takes ${best.relief.toFixed(1)} of harm off our companies — `
      + 'the attacks it was strengthening go back to their printed numbers',
  };
}

/** Whether anything the card declares will change the game when it resolves. */
export function declaresAnEffect(effects: readonly Effect[]): boolean {
  return flatten(effects).some(effect => !DECLARATION_ONLY.has(effect.type ?? ''));
}


/**
 * What an event in hand would achieve if it were played at its best target.
 *
 * The holding question, as against `gainOf`'s playing question. It is the same
 * reading of the same effects — a card the agent would pay to play and refuses
 * to keep is an incoherence nothing in the output would explain — with the one
 * part that needs a decision replaced: a played event names its target, and a
 * held one is worth whatever the best target available would make it worth.
 *
 * "Best" is the largest of our own companies for a protective effect, because
 * that is the one with most to lose and the one `defence` prices highest. That
 * is an optimistic reading, and it is the right sign of optimistic: the value
 * of *keeping* a card is the value of its best use, not its average one.
 *
 * Returns null for a family this cannot read, exactly as `gainOf` does. A
 * caller must treat that as "no opinion" and fall back to its floor — charging
 * zero for an unreadable card would make every event in the game the first
 * thing discarded, which is the failure this service exists to fix, inverted.
 */
export function heldGain(
  definitionId: string,
  context: ModuleContext,
): EventGain | null {
  const def = context.cardPool[definitionId];
  const effects = (def as unknown as { effects?: readonly Effect[] } | undefined)?.effects ?? [];
  if (!declaresAnEffect(effects)) {
    return { tsd: 0, reason: 'declares no effect this engine will execute' };
  }
  // The largest of our own companies stands in for the target a played event
  // would name. `gainOf` reads it off the action; there is no action here.
  const biggest = [...context.view.self.companies]
    .sort((a, b) => b.characters.length - a.characters.length)[0];
  const stand = biggest === undefined
    ? undefined
    : ({ companyId: biggest.id, characterInstanceId: biggest.characters[0] } as unknown as GameAction);
  return stand === undefined ? null : gainOf(effects, context, stand);
}
