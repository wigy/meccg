/**
 * @module company-split
 *
 * Peeling a single character off his company into a **new company sharing the
 * same site path** (`currentSite` / `destinationSite` / `movementPath`), so the
 * movement/hazard loop naturally gives him his own (separate) M/H phase. Left
 * Behind (td-41, `applyLeftBehindSplit` in `combat-finalize.ts`) and Turning
 * Hope to Despair (as-41, {@link splitCharacterOffCompany}) share the core and
 * differ only in the {@link CompanySplitMarks} they stamp on the companies.
 */
import type { GameState, CardInstanceId, CompanyId, Company } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { cleanupEmptyCompanies, clonePlayers, nextCompanyId } from './reducer-utils.js';

/** Caller-specific marks for {@link splitCharacterIntoNewCompany}. */
export interface CompanySplitMarks {
  /** Prefix for the `logDetail` lines (e.g. `"Left Behind"`). */
  readonly label: string;
  /**
   * Fields merged into the character's *own* company when he is alone in it
   * (no other company to peel him into) — callers flag it to run one more
   * separate M/H phase this turn instead.
   */
  readonly onLoneOrigin: Partial<Company>;
  /** Fields merged into the freshly created single-character company. */
  readonly onNewCompany: Partial<Company>;
}

/**
 * Peel `characterId` off `originCompanyId` into his own new {@link Company}
 * with the same site path, created *unhandled* so the movement/hazard loop
 * gives it its own separate M/H phase, and stamped with `marks.onNewCompany`.
 * If the character was **alone** in his company, that company is instead
 * updated with `marks.onLoneOrigin`.
 *
 * No-ops (returns `state` unchanged) if the origin company or the character
 * is no longer found — e.g. the character was eliminated by the same attack.
 */
export function splitCharacterIntoNewCompany(
  state: GameState,
  playerIndex: number,
  characterId: CardInstanceId,
  originCompanyId: CompanyId,
  marks: CompanySplitMarks,
): GameState {
  const newPlayers = clonePlayers(state);
  const player = newPlayers[playerIndex];

  const sourceIndex = player.companies.findIndex(c => c.id === originCompanyId);
  if (sourceIndex < 0) {
    logDetail(`${marks.label}: origin company ${originCompanyId as string} not found — split skipped`);
    return state;
  }
  const source = player.companies[sourceIndex];
  if (!source.characters.includes(characterId)) {
    logDetail(`${marks.label}: ${characterId as string} not in origin company — split skipped`);
    return state;
  }

  const updatedCompanies = [...player.companies];

  if (source.characters.length <= 1) {
    // Lone character — flag his company for one extra (separate) M/H phase.
    logDetail(`${marks.label}: ${characterId as string} is alone — his company gets a separate M/H phase (limit 1)`);
    updatedCompanies[sourceIndex] = { ...source, ...marks.onLoneOrigin };
    newPlayers[playerIndex] = { ...player, companies: updatedCompanies };
    return { ...state, players: newPlayers };
  }

  // Remove the character from his original company.
  updatedCompanies[sourceIndex] = {
    ...source,
    characters: source.characters.filter(id => id !== characterId),
  };

  // Create the separate company sharing the same site path.
  const newCompany: Company = {
    id: nextCompanyId(player),
    characters: [characterId],
    currentSite: source.currentSite,
    siteCardOwned: false,
    destinationSite: source.destinationSite,
    movementPath: source.movementPath,
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
    ...marks.onNewCompany,
  };
  updatedCompanies.push(newCompany);
  logDetail(`${marks.label}: ${characterId as string} splits off into ${newCompany.id as string} (same site path as ${source.id as string})`);

  newPlayers[playerIndex] = { ...player, companies: updatedCompanies };
  return cleanupEmptyCompanies({ ...state, players: newPlayers });
}

/**
 * Turning Hope to Despair (as-41) split: peel `characterId` off
 * `originCompanyId` into a new company flagged
 * {@link Company.forcedSoloHazardLimit} (its separate M/H phase snapshots the
 * hazard limit to 1). The auto-rejoining sibling of Left Behind (td-41): no
 * `leftBehind` flag is set, so after its M/H phase the new company merges
 * back through the normal rule 2.IV.6 same-site auto-merge. A lone character's
 * company is instead flagged {@link Company.forcedSoloExtraPhasePending}.
 */
export function splitCharacterOffCompany(
  state: GameState,
  playerIndex: number,
  characterId: CardInstanceId,
  originCompanyId: CompanyId,
): GameState {
  return splitCharacterIntoNewCompany(state, playerIndex, characterId, originCompanyId, {
    label: 'splitCharacterOffCompany',
    onLoneOrigin: { forcedSoloHazardLimit: true, forcedSoloExtraPhasePending: true },
    onNewCompany: { forcedSoloHazardLimit: true },
  });
}
