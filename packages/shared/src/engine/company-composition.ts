/**
 * @module company-composition
 *
 * Primitives for permanent-events bound to a **company as a whole**
 * (`play-target` `target: "company"`, stored in `CardInPlay.companyId`) whose
 * rules read the bound company's roster:
 *
 * - `company-size-unlimited` — the bound company ignores the CoE 2.II.3.1
 *   maximum of seven effective characters outside a haven.
 * - `company-influence-exempt` — characters in the bound company matching a
 *   DSL filter cost no influence to control (and none to bring into play).
 * - `company-character-play-exempt` — characters matching a DSL filter may be
 *   brought into the bound company without touching the one-character-per-turn
 *   limit of CoE 2.II.2.1.
 * - `discard-self-when-company` — the company-scoped sibling of
 *   `discard-self-when`: the card is discarded the moment a condition over the
 *   bound company's composition holds.
 *
 * All four evaluate card-authored conditions against contexts built here, so a
 * card such as *An Unexpected Party* (dm-114) — whose whole text is a set of
 * company-composition clauses — needs no per-card engine branch.
 */
import type { GameState, CardDefinitionId, CardInstanceId, Company, CompanyId, PlayerState } from '../index.js';
import type { CharacterCard } from '../types/cards.js';
import type { CardEffect, Condition, CompanyInfluenceExemptEffect, CompanyCharacterPlayExemptEffect, DiscardSelfWhenCompanyEffect } from '../types/effects.js';
import { Phase } from '../types/state-phases.js';
import { matchesCondition } from '../effects/index.js';
import { isCharacterCard } from '../types/cards.js';
import { logDetail } from './legal-actions/log.js';
import { defById, getCardEffects, discardCardsInPlayWhere, isHavenForPlayer } from './reducer-utils.js';

/**
 * The per-character context every company-composition filter is matched
 * against. `mind` is the character's *effective* mind when a `stat-modifier`
 * has changed it (mirroring what general influence actually charges), falling
 * back to the printed value; avatars (printed mind `null`) expose no `mind` at
 * all, so `{ "character.mind": { "$gt": 5 } }` never matches one.
 */
export interface CompanyCharacterContext {
  readonly character: {
    readonly name: string;
    readonly race: string;
    readonly mind?: number;
    readonly unique: boolean;
    readonly isAvatar: boolean;
    readonly keywords: readonly string[];
  };
}

/**
 * Builds the {@link CompanyCharacterContext} for a character definition, using
 * `effectiveMind` (from `CharacterInPlay.effectiveStats.mind`) when the caller
 * has an in-play character to read it from.
 */
export function buildCompanyCharacterContext(
  charDef: CharacterCard,
  effectiveMind?: number,
): CompanyCharacterContext {
  const mind = effectiveMind ?? charDef.mind ?? undefined;
  return {
    character: {
      name: charDef.name,
      race: charDef.race as string,
      ...(mind !== null && mind !== undefined ? { mind } : {}),
      unique: charDef.unique === true,
      isAvatar: charDef.mind === null,
      keywords: charDef.keywords ?? [],
    },
  };
}

/**
 * Every in-play card bound to `companyId` (either player's `cardsInPlay`) that
 * carries an effect of `effectType`, returned as `[definition, effect]` pairs.
 * Set-aside hosts are skipped — their effects are dormant.
 */
function companyBoundEffects<T extends CardEffect>(
  state: GameState,
  companyId: CompanyId | undefined,
  effectType: T['type'],
): { readonly name: string; readonly effect: T }[] {
  if (companyId === undefined) return [];
  const found: { name: string; effect: T }[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      if ((card.companyId as string | undefined) !== (companyId as string)) continue;
      if (card.setAsideHost !== undefined) continue;
      const def = defById(state, card.definitionId);
      for (const effect of getCardEffects(def)) {
        if (effect.type === effectType) {
          found.push({ name: def && 'name' in def ? (def as { name: string }).name : (card.definitionId as string), effect: effect as T });
        }
      }
    }
  }
  return found;
}

/**
 * True when a `company-size-unlimited` permanent-event is bound to `companyId`
 * — the company then ignores the CoE 2.II.3.1 maximum size of seven.
 */
export function companyHasUnlimitedSize(state: GameState, companyId: CompanyId): boolean {
  const matches = companyBoundEffects(state, companyId, 'company-size-unlimited');
  if (matches.length > 0) {
    logDetail(`company-size-unlimited: "${matches[0].name}" lifts the size maximum on company ${companyId as string}`);
    return true;
  }
  return false;
}

/**
 * Resolves the definition of a character instance for the given player, or
 * `undefined` when the instance is not a character in play.
 */
function characterDefOf(state: GameState, player: PlayerState, charId: CardInstanceId): { def: CharacterCard; effectiveMind?: number } | undefined {
  const char = player.characters[charId];
  if (!char) return undefined;
  const def = defById(state, char.definitionId);
  if (!def || !isCharacterCard(def)) return undefined;
  return { def, effectiveMind: char.effectiveStats?.mind };
}

/**
 * True when a character matching one of `companyId`'s bound
 * `company-influence-exempt` filters — i.e. the character costs no influence to
 * control while it is in that company.
 *
 * `effectiveMind` is threaded in so an in-play character is judged by the same
 * mind general influence would charge.
 */
export function companyExemptsCharacterFromInfluence(
  state: GameState,
  companyId: CompanyId | undefined,
  charDef: CharacterCard,
  effectiveMind?: number,
): boolean {
  const effects = companyBoundEffects<CompanyInfluenceExemptEffect>(state, companyId, 'company-influence-exempt');
  if (effects.length === 0) return false;
  const ctx = buildCompanyCharacterContext(charDef, effectiveMind);
  for (const { name, effect } of effects) {
    if (matchesCondition(effect.filter, ctx as unknown as Record<string, unknown>)) {
      logDetail(`company-influence-exempt: "${name}" waives influence for ${charDef.name} in company ${companyId as string}`);
      return true;
    }
  }
  return false;
}

/**
 * True when `charDef` matches one of `companyId`'s bound
 * `company-character-play-exempt` filters — the character may be brought into
 * that company regardless of the one-character-per-turn limit, and doing so
 * does not consume the turn's slot.
 */
export function companyExemptsCharacterFromPlayLimit(
  state: GameState,
  companyId: CompanyId | undefined,
  charDef: CharacterCard,
): boolean {
  const effects = companyBoundEffects<CompanyCharacterPlayExemptEffect>(state, companyId, 'company-character-play-exempt');
  if (effects.length === 0) return false;
  const ctx = buildCompanyCharacterContext(charDef);
  for (const { name, effect } of effects) {
    if (matchesCondition(effect.filter, ctx as unknown as Record<string, unknown>)) {
      logDetail(`company-character-play-exempt: "${name}" exempts ${charDef.name} from the one-character-per-turn limit`);
      return true;
    }
  }
  return false;
}

/**
 * Finds the (first) company of `player` standing at the site instance
 * `siteInstanceId` — the company a character played at that site joins (see
 * `handlePlayCharacter`). Returns `undefined` when a new company would be
 * formed from the site deck instead.
 */
export function companyAtSiteInstance(
  player: PlayerState,
  siteInstanceId: CardInstanceId,
): Company | undefined {
  return player.companies.find(c => c.currentSite?.instanceId === siteInstanceId);
}

/**
 * Builds the condition context a {@link DiscardSelfWhenCompanyEffect} (or any
 * other company-composition-gated effect, e.g. {@link AllyTapExtraMHPhaseEffect})
 * is evaluated against: base company facts plus one `count.<as>` headcount per
 * declared filter.
 */
export function buildCompanyCompositionContext(
  state: GameState,
  player: PlayerState,
  company: Company,
  counts: readonly { readonly as: string; readonly filter: Condition }[],
): Record<string, unknown> {
  const siteDefId: CardDefinitionId | undefined = company.currentSite?.definitionId;
  const siteDef = siteDefId ? defById(state, siteDefId) : undefined;
  const contexts: CompanyCharacterContext[] = [];
  for (const charId of company.characters) {
    const resolved = characterDefOf(state, player, charId);
    if (!resolved) continue;
    contexts.push(buildCompanyCharacterContext(resolved.def, resolved.effectiveMind));
  }

  const count: Record<string, number> = {};
  for (const entry of counts) {
    count[entry.as] = contexts.filter(
      ctx => matchesCondition(entry.filter, ctx as unknown as Record<string, unknown>),
    ).length;
  }

  return {
    company: {
      characterCount: company.characters.length,
      atHaven: isHavenForPlayer(siteDef, player.alignment, { state, siteDefinitionId: siteDefId, playerId: player.id }),
      siteType: siteDef && 'siteType' in siteDef ? (siteDef as { siteType: string }).siteType : undefined,
    },
    count,
  };
}

/**
 * Discards every in-play card carrying a `discard-self-when-company` effect
 * whose condition currently holds against the composition of the company it is
 * bound to. A card whose company no longer exists is left alone — the
 * bound-to-empty-company sweep (CRF: "If all characters in a company are
 * removed … all resource permanent-events played on the company as a whole are
 * discarded") already owns that case.
 *
 * Runs as `postReduce` housekeeping, so every roster change (playing a
 * character, splitting, merging, elimination, being influenced away) is covered
 * by one chokepoint. Skipped during setup, where starting companies are still
 * being assembled.
 */
export function sweepDiscardSelfWhenCompany(state: GameState): GameState {
  if (state.phaseState.phase === Phase.Setup) return state;

  return discardCardsInPlayWhere(
    state,
    (card, player) => {
      if (card.companyId === undefined) return false;
      const def = defById(state, card.definitionId);
      const effect = getCardEffects(def).find(
        (e): e is DiscardSelfWhenCompanyEffect => e.type === 'discard-self-when-company',
      );
      if (!effect) return false;
      const company = player.companies.find(c => (c.id as string) === (card.companyId as string));
      if (!company) return false;
      const ctx = buildCompanyCompositionContext(state, player, company, effect.counts ?? []);
      return matchesCondition(effect.condition, ctx);
    },
    (card, player) => {
      const def = defById(state, card.definitionId);
      const company = player.companies.find(c => (c.id as string) === (card.companyId as string));
      const effect = getCardEffects(def).find(
        (e): e is DiscardSelfWhenCompanyEffect => e.type === 'discard-self-when-company',
      );
      const detail = company && effect
        ? JSON.stringify(buildCompanyCompositionContext(state, player, company, effect.counts ?? []).count)
        : '{}';
      logDetail(`discard-self-when-company: discarding "${def && 'name' in def ? (def as { name: string }).name : (card.definitionId as string)}" — company ${card.companyId as string} composition matches ${detail}`);
    },
  ).state;
}
