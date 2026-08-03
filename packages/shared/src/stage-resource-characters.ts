/**
 * @module stage-resource-characters
 *
 * Helpers for relating a character-bound Stage resource to the drafted
 * character it is placed with.
 *
 * A `recruitment-vehicle` Stage resource (Thrall of the Voice, wh-82) is "placed
 * with a character" rather than bound to a site location: its card text reads
 * "Place this card with the character." Unlike Hidden Haven — whose site pairing
 * the player chooses explicitly (and which is stored in
 * {@link DraftPlayerState.stageResourceSites}) — the Thrall's character is chosen
 * deterministically when the draft is finalised: prefer an as-yet-unthralled
 * agent (the gate it most often lifts), then the highest-mind character.
 *
 * Both the engine (when finalising the draft) and the clients (when rendering the
 * draft board, so the Thrall hangs beside its character like a starting item
 * rather than floating in its own row) need the *same* pairing. This module is
 * the single source of truth for that rule so the displayed pairing always
 * matches the one the engine will actually apply.
 */

import type { CardDefinition, CharacterCard } from './types/cards.js';
import { isAvatarCharacter, isCharacterCard } from './types/cards.js';
import type { CardDefinitionId, CardInstanceId } from './types/common.js';
import type { PlayTargetEffect } from './types/effects.js';
import { matchesCondition } from './effects/condition-matcher.js';

/** The minimum a drafted character / Stage resource needs to be paired. */
export interface StageResourceCharacterRef {
  readonly instanceId: CardInstanceId;
  readonly definitionId: CardDefinitionId;
}

/** A resolved Thrall-of-the-Voice → character placement. */
export interface ThrallCharacterPairing {
  /** The recruitment-vehicle Stage resource (Thrall of the Voice). */
  readonly stageResourceInstanceId: CardInstanceId;
  /** The drafted character it is placed with. */
  readonly characterInstanceId: CardInstanceId;
}

/** A resolved character-targeting Stage resource → character placement. */
export interface StageResourceCharacterPairing {
  /** The character-targeting Stage resource (e.g. Squire of the Hunt). */
  readonly stageResourceInstanceId: CardInstanceId;
  /** The drafted character it is placed with. */
  readonly characterInstanceId: CardInstanceId;
}

/** True if `def` is an agent character (the draft gate Thrall most often lifts). */
function isAgent(def: CardDefinition | undefined): boolean {
  return isCharacterCard(def) && (def.keywords ?? []).includes('agent');
}

/** True if `def` carries a `recruitment-vehicle` effect (Thrall of the Voice). */
function isRecruitmentVehicle(def: CardDefinition | undefined): boolean {
  const effects = (def as { effects?: readonly { type: string }[] } | undefined)?.effects ?? [];
  return effects.some(e => e.type === 'recruitment-vehicle');
}

/**
 * The `play-target: character` effect on `def`, if any. Used to find Stage
 * resources (other than the recruitment-vehicle Thrall, paired separately by
 * {@link resolveThrallCharacterPairings}) that must be attached to a
 * character rather than entering play bare — e.g. Squire of the Hunt (wh-95),
 * Gandalf's Friend (wh-98): "Playable on one of your warrior characters ...
 * (or in your starting company)".
 */
function characterPlayTargetEffect(def: CardDefinition | undefined): PlayTargetEffect | undefined {
  const effects = (def as { effects?: readonly PlayTargetEffect[] } | undefined)?.effects ?? [];
  return effects.find((e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'character');
}

/**
 * True if a drafted Stage resource requires a character bearer to function —
 * a `play-target: character` effect, other than the recruitment-vehicle
 * Thrall (paired separately by {@link resolveThrallCharacterPairings}). Such
 * a card has no effect on its own, so if
 * {@link resolveCharacterTargetedStageResourcePairings} finds no qualifying
 * drafted character for it, the engine must keep it in hand rather than
 * putting it into play unattached.
 */
export function hasCharacterPlayTargetEffect(def: CardDefinition | undefined): boolean {
  return !isRecruitmentVehicle(def) && characterPlayTargetEffect(def) !== undefined;
}

/** Mind cost of a character definition, or 0 for a mindless / non-character card. */
function mindOf(def: CardDefinition | undefined): number {
  return isCharacterCard(def) && def.mind !== null ? def.mind : 0;
}

/**
 * Pair each `recruitment-vehicle` Stage resource (Thrall of the Voice) with the
 * drafted character it is placed with. Stage resources are processed in order;
 * each consumes a distinct character, preferring an as-yet-unthralled agent and
 * otherwise the highest-mind character. A Thrall with no remaining character to
 * pair (every drafted character already carries one, or there are none) is
 * omitted — the engine keeps such a card in hand, and the client shows it
 * full-size.
 *
 * @param characters - The drafted characters, in draft order.
 * @param stageResources - The drafted Stage resources, in draft order.
 * @param lookupDef - Resolves a definition id to its card definition.
 * @returns One pairing per Thrall that found a character.
 */
export function resolveThrallCharacterPairings(
  characters: readonly StageResourceCharacterRef[],
  stageResources: readonly StageResourceCharacterRef[],
  lookupDef: (defId: CardDefinitionId) => CardDefinition | undefined,
): readonly ThrallCharacterPairing[] {
  const used = new Set<string>();
  const pairings: ThrallCharacterPairing[] = [];
  for (const sr of stageResources) {
    if (!isRecruitmentVehicle(lookupDef(sr.definitionId))) continue;
    const candidates = characters.filter(c => !used.has(c.instanceId as string));
    if (candidates.length === 0) continue;
    const agents = candidates.filter(c => isAgent(lookupDef(c.definitionId)));
    const pickFrom = agents.length > 0 ? agents : candidates;
    const target = [...pickFrom].sort(
      (a, b) => mindOf(lookupDef(b.definitionId)) - mindOf(lookupDef(a.definitionId)),
    )[0];
    used.add(target.instanceId as string);
    pairings.push({ stageResourceInstanceId: sr.instanceId, characterInstanceId: target.instanceId });
  }
  return pairings;
}

/**
 * Build the `play-target: character` filter-matching context for a candidate
 * character definition. Mirrors the subset of the per-target context
 * `legal-actions/organization-events.ts` builds for a normal play-permanent-event
 * that is meaningful before a company or site exists yet (draft finalize
 * time, with no items attached): race, printed skills, name, mind, keywords,
 * and whether the candidate is the avatar.
 */
function characterFilterContext(def: CharacterCard): { readonly target: Record<string, unknown> } {
  return {
    target: {
      race: def.race,
      skills: def.skills,
      name: def.name,
      mind: def.mind,
      keywords: def.keywords ?? [],
      isAvatar: isAvatarCharacter(def),
    },
  };
}

/**
 * Pair each drafted Stage resource with a mandatory `play-target: character`
 * effect (other than the recruitment-vehicle Thrall, paired separately by
 * {@link resolveThrallCharacterPairings}) with the first drafted character
 * matching its filter. CoE 1.9.F4: "if not duplicated, the Stage resource is
 * put into play" — for a card whose sole effect requires a character bearer
 * (Squire of the Hunt wh-95, Gandalf's Friend wh-98, Pallando's Apprentice
 * wh-104, Wizard's Myrmidon wh-84, The Forge-master wh-117), "put into play"
 * means attached to a qualifying drafted character, exactly as its card
 * text's "(or in your starting company)" clause describes.
 *
 * @param characters - The drafted characters, in draft order.
 * @param stageResources - The drafted Stage resources, in draft order.
 * @param lookupDef - Resolves a definition id to its card definition.
 * @param alreadyPaired - Character instance ids already claimed by another
 *   Stage resource (e.g. a Thrall pairing) — excluded from consideration so
 *   one character never carries two mandatory-target Stage resources.
 * @returns One pairing per Stage resource that found a qualifying character.
 */
export function resolveCharacterTargetedStageResourcePairings(
  characters: readonly StageResourceCharacterRef[],
  stageResources: readonly StageResourceCharacterRef[],
  lookupDef: (defId: CardDefinitionId) => CardDefinition | undefined,
  alreadyPaired: ReadonlySet<string> = new Set(),
): readonly StageResourceCharacterPairing[] {
  const used = new Set(alreadyPaired);
  const pairings: StageResourceCharacterPairing[] = [];
  for (const sr of stageResources) {
    const def = lookupDef(sr.definitionId);
    if (isRecruitmentVehicle(def)) continue;
    const playTarget = characterPlayTargetEffect(def);
    if (!playTarget) continue;
    const target = characters.find(c => {
      if (used.has(c.instanceId as string)) return false;
      const cDef = lookupDef(c.definitionId);
      if (!cDef || !isCharacterCard(cDef)) return false;
      return !playTarget.filter || matchesCondition(playTarget.filter, characterFilterContext(cDef));
    });
    if (!target) continue;
    used.add(target.instanceId as string);
    pairings.push({ stageResourceInstanceId: sr.instanceId, characterInstanceId: target.instanceId });
  }
  return pairings;
}
