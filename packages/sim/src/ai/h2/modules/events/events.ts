/**
 * @module ai/h2/modules/events/events
 *
 * The `events` module — short events, priced by what their effects declare.
 *
 * `play-short-event` is the largest unowned action type left, at 183 blocked
 * decisions in three self-play games, and it is the hardest kind of card to
 * price: an event does one specific thing, once, and the thing is the card's
 * text. That is the DSL's territory, not a module's.
 *
 * But the same seam that made `grants` possible is here too. The DSL declares
 * what an event does, and a few *families* of declared effect are worth
 * something this design already knows how to compute:
 *
 * - **A card comes back.** `move ... to: "hand"` or `to: "deck"` recovers a
 *   card, worth at least what a draw is worth — a floor, because the card is
 *   chosen rather than drawn.
 * - **A company is shut to creatures.** Stealth adds
 *   `no-creature-hazards-on-company` for the turn, and that is worth the whole
 *   hazard plan the opponent would otherwise aim at it — `defence`, against the
 *   creatures this opponent has actually shown. It is the most-offered short
 *   event in the game by a wide margin, 150 of 276 appearances in three games.
 *
 * Everything else is declined per action. That is the honest outcome and it is
 * most of them: an event whose value is "the opponent may not do X this turn"
 * cannot be priced without modelling X.
 *
 * The cost is the card itself, at its shadow price — which for an event whose
 * effect this module cannot read is the flat floor.
 *
 * ## Doing nothing is not the same as being unreadable
 *
 * An event is never scored negative for a family the module cannot *read*:
 * charging for the card and crediting nothing would make H2 refuse every event
 * in the game. But there are two cases where the module can **prove** the play
 * achieves nothing, and those are opinions rather than guesses:
 *
 * - **The card declares no effect this engine will execute.** Twilight's whole
 *   effect list is two `play-flag`s — declarations about *how* it may be played,
 *   not about what happens when it resolves. Its printed text cancels an
 *   environment card; the DSL does not say so, and the engine plays what the DSL
 *   declares. Playing it therefore spends a card for nothing. It was the second
 *   most-offered declined short event, 44 of 122 in three games. The rule is
 *   self-correcting: the day the cancel is written into the DSL, the effect list
 *   stops being declaration-only and the module goes back to declining.
 * - **A removal with nothing to remove.** Every short event in the pool that
 *   discards something from play — Marvels Told, Ancient Secrets, Voices of
 *   Malice, The Cock Crows, Wizard's River-horses — targets a *hazard event in
 *   play*, and with none in play the card resolves for nothing. When there is
 *   one, the module still declines, because what that event was doing is the
 *   thing it cannot price.
 *
 * That second case replaces a branch that was simply wrong. It read the same
 * `move ... from: "in-play" to: "discard"` and priced it as the corruption
 * relief of taking an attached hazard off one of our own characters — a
 * different effect, on a different target, that no card in this family has. The
 * module credited a benefit the card could not deliver whenever any of our
 * characters happened to be carrying a corrupting hazard.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { namedCharacter } from '../../core/action-fields.js';
import { computeCardPrices } from '../../services/card-price.js';
import { computeDefence } from '../../services/defence.js';
import { rosterOf } from '../../services/strike/prowess.js';
import type { StrikeTarget } from '../../services/strike/prowess.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = ['play-short-event'] as const;

/** A declared effect, as far as this module reads one. */
interface Effect {
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
type Filter = Readonly<Record<string, unknown>>;

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
function gainOf(
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
    return reliefFromRemoval(removal, context);
  }

  return null;
}

/**
 * What discarding the best reachable card in play is worth, or null.
 *
 * The only thing a card in play does that this module can price is what
 * `defence` already prices from the other direction: a hazard event declaring a
 * modifier on every attack. Minions Stir gives the Orcs coming at our companies
 * +1 strike and +1 prowess each, so taking it off the board is worth the harm it
 * stops — summed over our companies, each facing its own size in hazards, which
 * is the same convention `characters` compares company shapes with.
 *
 * The player picks the target in a later sub-flow, so the *best* reachable card
 * is priced rather than a named one, on the assumption that they will take it.
 * A target this cannot price leaves the card declined, which is the honest
 * outcome for "it discards something, and what that something was doing is its
 * own card's text".
 */
function reliefFromRemoval(
  removal: Effect,
  context: ModuleContext,
): { tsd: number; reason: string } | null {
  const { view, cardPool, standing, tunables } = context;
  const defence = computeDefence(view, cardPool, standing, tunables);
  const companies = view.self.companies.map(company => ({
    roster: rosterOf(company, view.self.characters, cardPool),
    size: company.characters.length,
  }));
  const now = companies.reduce((sum, c) => sum + defence.expectedHarm(c.roster, c.size), 0);

  let best: { relief: number; name: string } | null = null;
  for (const zone of [view.self.cardsInPlay, view.opponent.cardsInPlay]) {
    for (const card of zone) {
      const def = cardPool[card.definitionId];
      if (!couldMatch(removal.filter, def)) continue;
      const without = companies.reduce(
        (sum, c) => sum + defence.harmWithout(card.instanceId as string, c.roster, c.size), 0,
      );
      const relief = now - without;
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
function declaresAnEffect(effects: readonly Effect[]): boolean {
  return flatten(effects).some(effect => !DECLARATION_ONLY.has(effect.type ?? ''));
}

/**
 * The events module. No context gate: a short event is always its own, and
 * what it cannot price it declines per action rather than per decision.
 */
export const eventsModule: H2Module = {
  name: 'events',
  ownedActionTypes: OWNED_ACTION_TYPES,

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type !== 'play-short-event') return null;
    const instanceId = (action as unknown as { cardInstanceId?: CardInstanceId }).cardInstanceId;
    if (!instanceId) return null;
    const card = context.view.self.hand.find(c => c.instanceId === instanceId);
    if (!card) return null;

    const def = context.cardPool[card.definitionId];
    const effects = (def as unknown as { effects?: readonly Effect[] } | undefined)?.effects ?? [];
    // A card whose whole effect list declares how it may be played, and nothing
    // that happens when it resolves, does nothing when it resolves. That is a
    // reading of the DSL rather than a judgement about the card, and it is the
    // one case where charging for the card is an opinion rather than a guess.
    const gain = declaresAnEffect(effects)
      ? gainOf(effects, context, action)
      : {
        tsd: 0,
        reason: 'the card declares no effect this engine will execute — only how it may be played',
      };
    // A family this module cannot read is declined, not charged. Charging for
    // the card and crediting nothing would make H2 refuse every event in the
    // game, which is worse than having no opinion about them.
    if (!gain) return null;

    const { standing, tunables } = context;
    const price = computeCardPrices(context.view, context.cardPool, standing, tunables)
      .worth(instanceId);
    const spent = price?.tsd ?? tunables.provisionalCardPrice;
    const name = (def as unknown as { name?: string } | undefined)?.name ?? (card.definitionId as string);

    const dtsd = netTsdDelta({ realized: gain.tsd, tempo: spent }, tunables);
    const outcomes: Outcome[] = [{ p: 1, label: `play ${name} — ${gain.reason}`, dtsd }];
    const scored = standing.score(outcomes);

    const detail: Rationale[] = [
      leaf('event', name),
      leaf('what it does', gain.tsd, { unit: 'tsd', note: gain.reason }),
      leaf('the card it spends', spent, {
        unit: 'tsd',
        note: price?.reason ?? 'the flat price',
      }),
    ];

    return {
      action,
      module: 'events',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node(`play ${name}`, scored.utility, [
        node('the event', gain.tsd - spent, detail, { unit: 'tsd' }),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: [
        'an event is priced by the *family* of effect it declares, not by its text: a card that '
        + 'also restricts, cancels or enables something is under-valued here',
        'the play is assumed to cost only the card; a tap or discard the event also demands is not '
        + 'charged',
        'a card whose declared effects only say how it may be played is scored as doing nothing — '
        + 'true of this engine, and wrong about the printed card whenever the DSL is behind the text',
        'whether a removal has a target is decided by the filter keys this module reads (card type, '
        + 'event type, keywords); a filter it cannot read is assumed to have one, so the card is '
        + 'declined rather than called useless',
      ],
    };
  },
};
