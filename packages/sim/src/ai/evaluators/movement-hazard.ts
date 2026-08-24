/**
 * @module ai/evaluators/movement-hazard
 *
 * Heuristic scoring for the Movement/Hazard phase, including hazard play
 * (creatures and events keyed against the moving company), on-guard
 * placements, and effect ordering.
 *
 * Resource-side actions (select-company, declare-path) get a flat positive
 * weight so they actually progress — except among region-movement path
 * choices, which are scored by how much extra hazard exposure the declared
 * regions add. Hazard-side actions are scored based on the threat they
 * pose: prowess gap vs. defenders for creatures, corruption stacking for
 * corruption hazards, and a small baseline for events.
 */

import { RegionType } from '@meccg/shared';
import type { GameAction, CreatureCard, CardDefinition, OpponentCompanyView } from '@meccg/shared';
import type { ActionEvaluator } from './types.js';
import type { AiContext } from '../strategy.js';
import { attackIsDetainment } from '../detainment.js';
import {
  lookupDef,
  isCreature,
  isCorruption,
  isHazardEvent,
  freeDi,
  boostsCreatureAttack,
  enablesHandCardBonus,
  discardBenefitsSelf,
  diceSuccessPct,
} from './common.js';

/**
 * Extra hazard-keying exposure a region type adds to a declared region-move
 * path, relative to a plain Wilderness region (0). Border-land regions key
 * additional creatures (e.g. Ambusher, Abductor, Cave Worm) on top of
 * whatever the destination's own site path already keys, so crossing one
 * gratuitously — without shortening the path or avoiding a worse region —
 * is a pure downside for the resource player.
 */
const REGION_PATH_DANGER: Partial<Record<RegionType, number>> = {
  [RegionType.Free]: 0,
  [RegionType.Wilderness]: 0,
  [RegionType.Coastal]: 1,
  [RegionType.Border]: 3,
  [RegionType.Shadow]: 5,
  [RegionType.Dark]: 7,
};

/** Sum of {@link REGION_PATH_DANGER} over a declared region-movement path. */
function regionPathDanger(regionPath: readonly string[], pool: Readonly<Record<string, CardDefinition>>): number {
  let danger = 0;
  for (const regionId of regionPath) {
    const def = lookupDef(pool, regionId);
    danger += def?.cardType === 'region' ? REGION_PATH_DANGER[def.regionType] ?? 1 : 1;
  }
  return danger;
}

/**
 * The weight one `play-hazard` creature action carries, before the detainment
 * lift below.
 *
 * A creature keyed by more than one region-type/site-type reason appears as one
 * legal action per keying justification, all playing the identical card, so the
 * threat is split across them — see the call site.
 */
function creatureActionWeight(def: CreatureCard, defenderProwess: number, keyingVariants: number): number {
  return Math.max(1, creatureThreat(def, defenderProwess) / Math.max(1, keyingVariants));
}

/**
 * The best weight any *normal* creature attack in hand carries against this
 * company, which is what a detainment attack has to be lifted above.
 *
 * A detainment attack taps rather than wounds and awards no kill marshalling
 * points when it is defeated (CoE 3.II.3), so it is the one creature that costs
 * nothing to lose — and the defenders it taps face whatever is played behind it
 * at −1 prowess. That makes it the opener: spend the cheap attack first, and the
 * creature that *can* be beaten for points arrives against a company already
 * tapped. Sequencing it by adding this ceiling to its own weight keeps the
 * detainment creatures ordered among themselves while putting all of them ahead
 * of every attack that wounds — the same idiom {@link boostedCreatureThreatInHand}
 * uses to sequence a board-wide boost before the creature it improves.
 */
function normalCreatureCeiling(
  context: AiContext,
  pool: Readonly<Record<string, CardDefinition>>,
  targetCompany: OpponentCompanyView,
  defenderProwess: number,
): number {
  const view = context.view;
  let ceiling = 0;
  for (const other of context.legalActions) {
    if (other.type !== 'play-hazard') continue;
    if (other.targetCompanyId !== targetCompany.id) continue;
    const card = view.self.hand.find(c => c.instanceId === other.cardInstanceId);
    if (!card) continue;
    const def = lookupDef(pool, card.definitionId);
    if (!isCreature(def)) continue;
    if (attackIsDetainment(view, pool, targetCompany, card.definitionId, other.keyedBy)) continue;
    const variants = context.legalActions.filter(
      a => a.type === 'play-hazard' && a.cardInstanceId === other.cardInstanceId,
    ).length;
    ceiling = Math.max(ceiling, creatureActionWeight(def, defenderProwess, variants));
  }
  return ceiling;
}

/** Estimate how dangerous a creature is against a target company. */
function creatureThreat(def: CreatureCard, defenderProwess: number): number {
  const baseThreat = def.prowess * def.strikes;
  // Subtract roughly half of company prowess so big companies absorb small creatures.
  return Math.max(1, baseThreat - Math.floor(defenderProwess / 2));
}

/**
 * Highest threat score among creature cards still in hand that a hazard
 * event's board-wide stat boost would strengthen — 0 if none match.
 *
 * A boost like Full of Froth and Rage only helps attacks that happen while
 * it's in play, so it must be sequenced *before* the creature it targets.
 * Scoring it above that creature's own threat (rather than the flat event
 * baseline) makes the AI prefer playing the boost first.
 */
function boostedCreatureThreatInHand(
  eventDef: CardDefinition,
  view: AiContext['view'],
  pool: Readonly<Record<string, CardDefinition>>,
): number {
  let best = 0;
  for (const card of view.self.hand) {
    const def = lookupDef(pool, card.definitionId);
    if (!isCreature(def)) continue;
    if (!boostsCreatureAttack(eventDef, def)) continue;
    best = Math.max(best, creatureThreat(def, 0));
  }
  return best;
}

export const movementHazardEvaluator: ActionEvaluator = {
  phases: ['movement-hazard'],

  score(action: GameAction, context: AiContext): number | null {
    const view = context.view;
    const pool = context.cardPool;

    switch (action.type) {
      case 'draw-cards':
        // Always draw the maximum number of cards — card advantage is
        // always worth taking.
        return 100;

      case 'select-company':
        return 10;

      case 'declare-path':
        // Prefer Starter movement (printed path) when available.
        if (action.movementType === 'starter') return 12;
        if (action.movementType === 'region' && action.regionPath) {
          // Region Movement lets the resource player declare any legal
          // consecutive-region path (CoE 2.IV.ii) — every candidate of equal
          // length previously scored the same flat 8, so the AI picked among
          // them uniformly at random. That let it pick a path combining the
          // disadvantages of shorter and longer alternatives (as many
          // wilderness regions as the shortest route, plus a gratuitous
          // border-land on top) with no offsetting benefit (bug report: Rivendell
          // to Lórien via Rhudaur → High Pass → Anduin Vales → Wold & Foothills,
          // instead of the equally-long, all-wilderness Rhudaur → Hollin →
          // Redhorn Gate → Wold & Foothills). Discount by the extra exposure
          // each crossed region adds so safer equal-length paths score higher.
          return Math.max(1, 8 - regionPathDanger(action.regionPath, pool));
        }
        return 8;

      case 'order-effects':
        return 10;

      case 'play-hazard': {
        const card = view.self.hand.find(c => c.instanceId === action.cardInstanceId);
        if (!card) return 1;
        const def = lookupDef(pool, card.definitionId);
        if (!def) return 1;

        if (isCreature(def)) {
          // Find the targeted opponent company to estimate defender prowess.
          const targetCompany = view.opponent.companies.find(c => c.id === action.targetCompanyId);
          let defenderProwess = 0;
          if (targetCompany) {
            for (const charId of targetCompany.characters) {
              const char = view.opponent.characters[charId];
              if (char) defenderProwess += char.effectiveStats.prowess;
            }
          }
          // A creature keyed by more than one region-type/site-type reason
          // (e.g. Orc-warband keyed by both "wilderness" and "ruins-and-lairs")
          // appears as one legal action per keying justification, all playing
          // the identical card. Left unsplit, each variant scores at full
          // creature-threat weight, so the combined probability of "play this
          // creature" roughly multiplies by the number of valid keyings —
          // drowning out a board-wide boost in hand that should reliably be
          // sequenced first (see boostedCreatureThreatInHand below). Split the
          // weight across the keying variants so they total one decision's
          // worth, mirroring the place-on-guard fix.
          const keyingVariants = context.legalActions.filter(
            a => a.type === 'play-hazard' && a.cardInstanceId === action.cardInstanceId,
          ).length;
          const weight = creatureActionWeight(def, defenderProwess, keyingVariants);
          // A detainment attack (CoE 3.II) taps instead of wounding and cannot
          // be beaten for kill MP, so it is spent first: it risks nothing, and
          // the defenders it taps meet the creature behind it at −1 prowess.
          if (targetCompany
            && attackIsDetainment(view, pool, targetCompany, card.definitionId, action.keyedBy)) {
            return weight + normalCreatureCeiling(context, pool, targetCompany, defenderProwess);
          }
          return weight;
        }
        if (isCorruption(def)) {
          // Foolish Words: target the character with the most free DI so the
          // threat of losing them to corruption is greatest.
          if (def.id === 'td-25' && action.targetCharacterId) {
            const target = view.opponent.characters[action.targetCharacterId];
            if (target) return 8 + freeDi(view, pool, target);
          }
          return 8;
        }
        if (isHazardEvent(def)) {
          // A board-wide boost (e.g. Full of Froth and Rage) is worthless
          // once played after the creature attack it targets has already
          // resolved — outscore that creature so the boost is sequenced first.
          const boosted = boostedCreatureThreatInHand(def, view, pool);
          if (boosted > 0) return boosted + 1;
          // An enabler like Doors of Night unlocks a bonus on another hazard
          // event still in hand (e.g. An Unexpected Outpost's double fetch).
          // Outscore the plain event baseline so the enabler plays first.
          if (enablesHandCardBonus(def, view, pool)) return 6;
          // A corruption-keyword event (e.g. Alone and Unadvised) offers one
          // legal action per eligible character in the targeted company, all
          // scoring the same flat baseline — left unscored, the AI picked
          // among them at random, as likely to hit a throwaway follower as a
          // corruption-primed hero (bug report: Alone and Unadvised landing
          // on a lone follower, Dâsakûn, instead of Théoden, who already
          // carried corruption points). Prefer the character closest to
          // being buried by corruption.
          if (def.keywords?.includes('corruption') && action.targetCharacterId) {
            const target = view.opponent.characters[action.targetCharacterId];
            if (target) return 5 + target.effectiveStats.corruptionPoints;
          }
          return 5;
        }
        return 3;
      }

      case 'play-short-event': {
        // A short event that forces the discard of an in-play hazard-event
        // (e.g. Marvels Told) offers one legal action per eligible target.
        // Left unscored, both a self-hurting target (discard my own hazard,
        // helping the opponent) and a self-helping target (discard the
        // opponent's hazard, helping me) get the same default weight — a
        // coin flip that regularly had the AI un-hindering its own hazard
        // placement on the opponent's character (bug report: Marvels Told
        // removing Foolish Words from Faramir, an opponent character).
        if (action.discardTargetInstanceId) {
          return discardBenefitsSelf(view, action.discardTargetInstanceId) ? 20 : 0;
        }
        return null;
      }

      case 'support-corruption-check': {
        // Tap-in-support (CoE 7.1.1): each tap is worth exactly what it buys
        // — the extra sliver of survival probability it adds to the roll.
        // Left unscored, every support option got the same flat default
        // weight as the roll action itself, so the AI kept tapping company
        // mates even after the check could no longer fail on any roll (bug
        // report: three characters tapped in support of a check that a
        // single support already made unfailable, needlessly leaving them
        // tapped for the site phase). Find the paired roll action to read
        // the check's current `need` and price the marginal point.
        const rollAction = context.legalActions.find(
          a => a.type === 'corruption-check' && a.characterId === action.targetCharacterId,
        );
        if (!rollAction || rollAction.type !== 'corruption-check') return 3;
        const currentSuccessPct = diceSuccessPct(rollAction.need);
        if (currentSuccessPct >= 100) return 0;
        const improvedSuccessPct = diceSuccessPct(rollAction.need - 1);
        return Math.max(1, improvedSuccessPct - currentSuccessPct);
      }

      case 'place-on-guard': {
        // Any hand card is eligible for placement (bluffing allowed), so one
        // action exists per hand card, but they're all the same underlying
        // decision — guard or not. Split a fixed total weight across them so
        // a bigger hand doesn't multiply the odds of guarding; otherwise a
        // 10-card hand would outweigh "pass" ~10x more strongly than a
        // 1-card hand for the exact same strategic situation.
        const guardOptions = context.legalActions.filter(a => a.type === 'place-on-guard').length;
        return 4 / Math.max(1, guardOptions);
      }

      case 'pass':
        // Never pass while cards can still be drawn — always take the
        // maximum number of draws offered.
        if (context.legalActions.some(a => a.type === 'draw-cards')) return 0;
        return 1;

      default:
        return null;
    }
  },
};
