/**
 * @module site-repeated-attack
 *
 * Shared combat-state construction for re-facing a site's automatic-attacks
 * outside the normal 'automatic-attacks' step sequence: the Troll-purse
 * (dm-95) item-trap re-face, the prisoner-rescue (CoE rule 8.36) rescue-attack,
 * and All the Bells Ringing (as-44)'s forced normal-attack re-face. Extracted
 * as a leaf module (no dependency on `reducer-site.ts`, `chain-reducer.ts`, or
 * `apply-dispatcher.ts`) so both `reducer-site.ts` (troll-purse/rescue) and
 * `combat-cancel.ts` (as-44, triggered from the shared `cancel-attack` apply
 * dispatch) can build this combat state without forming an import cycle.
 */

import type { GameState, PlayerState, CombatState, Company, CardInstanceId, AutomaticAttack } from '../index.js';
import type { StrikeAssignment } from '../types/state-combat.js';
import { getPlayerIndex } from '../state-utils.js';
import { defById, hazardPlayer, isCovertCompany, playerConvertsDetainmentToNormal, resolveAttackerChoosesDefenders, siteTypeForcesAutoAttacksNormal } from './reducer-utils.js';
import { normalizeCreatureRace, resolveAttackBody, resolveAttackProwess, resolveAttackStrikes } from './effects/index.js';
import { buildInPlayNames } from './recompute-derived.js';
import { getEffectiveSiteType, siteAutoAttacksForcedDetainment } from './effective.js';
import { isDetainmentAttack } from './detainment.js';
import { findCompanyAllies } from './legal-actions/combat.js';
import { hasPlayFlag } from '../effects/play-flags.js';

/**
 * Allies (per CoE 2.V.2.2) that must also face a strike in an "each character
 * faces 1 strike" automatic attack, excluding those made immune by a
 * `no-attack` or `no-attack-site-keyed` play-flag (site auto-attacks are
 * always "at the site", so `no-attack-site-keyed` always applies to them).
 */
export function facingAlliesFor(state: GameState, player: PlayerState, company: Company): CardInstanceId[] {
  return findCompanyAllies(player, company.characters)
    .filter(({ ally }) => {
      const allyDef = defById(state, ally.definitionId) as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
      return !hasPlayFlag(allyDef, 'no-attack') && !hasPlayFlag(allyDef, 'no-attack-site-keyed');
    })
    .map(({ ally }) => ally.instanceId);
}

/**
 * Build the combat state for re-facing one of the site's automatic-attacks,
 * shared by the Troll-purse (dm-95) item-trap re-face, the prisoner-rescue
 * (rule 8.36) rescue-attack, and All the Bells Ringing (as-44)'s forced
 * normal-attack re-face. Mirrors the normal site auto-attack combat
 * construction (detainment keying, each-character, attacker-chooses,
 * cannot-be-canceled, wound-eliminates).
 *
 * `opts.prowessBonus` adds to the attack's prowess (Troll-purse: +3; rescue
 * and Bells Ringing: 0). `opts.trollPursePrisoner`, when set, flags the combat
 * so a successful strike takes the character prisoner at the site instead of
 * wounding (handled in `reducer-combat.ts` `resolveStrike`).
 * `opts.protectedFromStrikeAssignment` excludes those characters from being
 * assigned strikes (held prisoners during a rescue-attack are captive, not
 * fighting). `opts.forceNormalOverride` unconditionally forces the re-faced
 * attack to resolve as a normal (non-detainment) attack, regardless of the
 * defending company's alignment or any site/attack-level forced-detainment
 * rule — All the Bells Ringing (as-44): "which attack normally, not as
 * detainment."
 */
export function buildSiteRepeatedAttackCombat(
  state: GameState,
  company: Company,
  siteDef: import('../types/cards.js').SiteCard,
  aa: AutomaticAttack,
  attackIndex: number,
  opts: {
    prowessBonus: number;
    trollPursePrisoner?: { hostInstanceId: CardInstanceId; siteInstanceId: CardInstanceId };
    protectedFromStrikeAssignment?: readonly CardInstanceId[];
    forceNormalOverride?: boolean;
  },
): CombatState {
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const defendingCovert = isCovertCompany(company, state.players[activePlayerIndex], state);
  const siteDefId = company.currentSite!.definitionId;
  const effectiveSiteType = getEffectiveSiteType(state, siteDefId, siteDef.siteType, company.currentSite!.instanceId);
  const forcedDetainment = siteAutoAttacksForcedDetainment(state, siteDefId);
  const forcesNormalAttacks = opts.forceNormalOverride === true
    || playerConvertsDetainmentToNormal(state, state.players[activePlayerIndex])
    || siteTypeForcesAutoAttacksNormal(state, effectiveSiteType);
  const inPlayNames = buildInPlayNames(state);
  const creatureRace = normalizeCreatureRace(aa.creatureType);
  const boostCtx = { companyId: company.id };
  const baseProwess = resolveAttackProwess(state, aa.prowess, inPlayNames, creatureRace, true, undefined, boostCtx, false, effectiveSiteType);
  const effectiveProwess = baseProwess + opts.prowessBonus;
  const effectiveStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames, creatureRace, true, boostCtx, effectiveSiteType);
  const effectiveBody = resolveAttackBody(state, aa.body ?? null, inPlayNames, creatureRace, boostCtx);
  const isEachCharacter = aa.combatRules?.includes('each-character') ?? false;
  const aaAttackerChooses = resolveAttackerChoosesDefenders(
    state, aa.combatRules?.includes('attacker-chooses-defenders') ?? false, creatureRace,
  );
  const protectedSet = new Set((opts.protectedFromStrikeAssignment ?? []).map(id => id as string));
  // For each-character, only non-protected characters face a strike. Allies
  // (CoE 2.V.2.2) face a strike too, unless immune or themselves protected.
  const facingChars = company.characters.filter(id => !protectedSet.has(id as string));
  const facingAllies = isEachCharacter
    ? facingAlliesFor(state, state.players[activePlayerIndex], company).filter(id => !protectedSet.has(id as string))
    : [];
  const preAssignedStrikes: StrikeAssignment[] = isEachCharacter
    ? [
        ...facingChars.map(charId => ({ characterId: charId, excessStrikes: 0, resolved: false })),
        ...facingAllies.map(allyId => ({ characterId: allyId, excessStrikes: 0, resolved: false })),
      ]
    : [];
  const strikesTotalValue = isEachCharacter ? facingChars.length + facingAllies.length : effectiveStrikes;
  const detainment = (!forcesNormalAttacks && (forcedDetainment || aa.forceDetainment === true || aa.detainmentAgainstPlayer === state.activePlayer || (aa.detainmentAgainstOvert === true && !defendingCovert))) || isDetainmentAttack({
    attackEffects: siteDef.effects,
    attackRace: creatureRace ?? null,
    defendingAlignment: state.players[activePlayerIndex].alignment,
    defendingCovert,
    defendingSiteEffects: siteDef.effects,
    isAutomaticAttack: true,
    defenderForcesNormalAttacks: forcesNormalAttacks,
  });
  const base: CombatState = {
    attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayer(state).id,
    strikesTotal: strikesTotalValue,
    strikeProwess: effectiveProwess,
    creatureBody: effectiveBody,
    creatureRace,
    strikeAssignments: preAssignedStrikes,
    currentStrikeIndex: 0,
    phase: isEachCharacter ? 'resolve-strike' : 'assign-strikes',
    assignmentPhase: isEachCharacter ? 'done' : (aaAttackerChooses ? 'cancel-window' : 'defender'),
    bodyCheckTarget: null,
    detainment,
    ...(opts.trollPursePrisoner ? { trollPursePrisoner: opts.trollPursePrisoner } : {}),
    ...(protectedSet.size > 0 ? { protectedFromStrikeAssignment: [...protectedSet] as CardInstanceId[] } : {}),
    ...(aaAttackerChooses ? { attackerChoosesDefenders: true } : {}),
    ...(aa.combatRules?.includes('cannot-be-canceled') ? { uncancelable: true } : {}),
    ...(aa.combatRules?.includes('wound-eliminates') ? { woundEliminates: true } : {}),
    ...(aa.combatRules?.includes('weapons-ineffective') ? { weaponsIneffective: true } : {}),
    ...(isEachCharacter ? { eachCharacterFacesOneStrike: true } : {}),
  };
  if (isEachCharacter && preAssignedStrikes.length > 1) {
    return { ...base, phase: 'choose-strike-order', currentStrikeIndex: 0, bodyCheckTarget: null };
  }
  if (isEachCharacter && preAssignedStrikes.length === 1) {
    return { ...base, phase: 'resolve-strike', currentStrikeIndex: 0, attackerStep1Done: false, bodyCheckTarget: null };
  }
  return base;
}
