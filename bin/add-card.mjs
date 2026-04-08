#!/usr/bin/env node
/**
 * @module add-card
 *
 * Mechanically adds a card from the Council of Elrond database to the local
 * card data files. Invoked directly by `bin/handle-mail` for the
 * `card-request` topic; replaces the older Claude-based handle-card-request
 * skill with a deterministic script that performs the same field mapping.
 *
 * Usage: node bin/add-card.mjs <cardName> <deckId>
 *
 * Exits 0 on success, 1 on failure. Outputs structured status messages that
 * `bin/handle-mail` parses (e.g. "successfully added", card ID, commit hash).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Symbol lookup tables
// ---------------------------------------------------------------------------

/** Region type symbols (lowercase) used in CoE sitePath / creature playable */
const REGION_TYPE_SYMBOLS = {
  '{w}': 'wilderness',
  '{b}': 'border',
  '{f}': 'free',
  '{s}': 'shadow',
  '{d}': 'dark',
  '{c}': 'coastal-sea',
};

/** Site type symbols (uppercase) used in CoE siteType / creature playable */
const SITE_TYPE_SYMBOLS = {
  '{R}': 'ruins-and-lairs',
  '{F}': 'free-hold',
  '{S}': 'shadow-hold',
  '{D}': 'dark-hold',
  '{H}': 'haven',
  '{B}': 'border-hold',
};

/** Alignment mapping from CoE values to local values */
const ALIGNMENT_MAP = {
  Hero: 'wizard',
  Minion: 'ringwraith',
  'Fallen-wizard': 'fallen-wizard',
  Balrog: 'balrog',
};

/** Item subtype normalization */
const ITEM_SUBTYPE_MAP = {
  'Gold Ring Item': 'gold-ring',
  'Greater Item': 'greater',
  'Major Item': 'major',
  'Minor Item': 'minor',
  'Special Item': 'special',
};

/** Event subtype normalization */
const EVENT_SUBTYPE_MAP = {
  'Short-event': 'short',
  'Long-event': 'long',
  'Permanent-event': 'permanent',
  'Permanent-event/Short-event': 'permanent',
};

/** Skill name normalization */
const SKILL_MAP = {
  Warrior: 'warrior',
  Scout: 'scout',
  Ranger: 'ranger',
  Sage: 'sage',
  Diplomat: 'diplomat',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNum(val) {
  if (val === undefined || val === null || val === '-' || val === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function parseSkills(skillStr) {
  if (!skillStr) return [];
  return skillStr
    .split('/')
    .map((s) => SKILL_MAP[s.trim()] || s.trim().toLowerCase())
    .filter(Boolean);
}

function parseRegionTypes(playable) {
  if (!playable) return [];
  const types = [];
  for (const [sym, name] of Object.entries(REGION_TYPE_SYMBOLS)) {
    if (playable.includes(sym)) types.push(name);
  }
  return types;
}

function parseSiteTypes(playable) {
  if (!playable) return [];
  const types = [];
  for (const [sym, name] of Object.entries(SITE_TYPE_SYMBOLS)) {
    if (playable.includes(sym)) types.push(name);
  }
  return types;
}

function parseSitePath(pathStr) {
  if (!pathStr) return [];
  const path = [];
  const matches = pathStr.match(/\{[^}]+\}/g) || [];
  for (const m of matches) {
    const name = REGION_TYPE_SYMBOLS[m];
    if (name) path.push(name);
  }
  return path;
}

function parseSiteType(siteTypeStr) {
  if (!siteTypeStr) return '';
  return SITE_TYPE_SYMBOLS[siteTypeStr] || siteTypeStr.toLowerCase();
}

function parseAutoAttacks(autoAttackStr) {
  if (!autoAttackStr) return [];
  // Format: "Race - N strike(s) with P prowess" possibly semicolon-separated
  const attacks = [];
  const parts = autoAttackStr.split(';').map((s) => s.trim());
  for (const part of parts) {
    const match = part.match(
      /^(.+?)\s*[-–—]\s*(\d+)\s*strikes?\s*with\s*(\d+)\s*prowess/i
    );
    if (match) {
      attacks.push({
        creatureType: match[1].trim(),
        strikes: parseInt(match[2], 10),
        prowess: parseInt(match[3], 10),
      });
    }
  }
  return attacks;
}

function parseCorruption(corr) {
  // Format: "2(3)" or "2" — take first number
  if (!corr) return 0;
  const match = corr.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseProwessModifier(prow) {
  // Format: "+2(4)" or "+3" — take first number
  if (!prow) return 0;
  const match = prow.match(/[+-]?(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseBodyModifier(body) {
  if (!body || body === '-') return 0;
  const match = body.match(/[+-]?(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseMarshallingPoints(mp) {
  // Format: "2(4)" or "2" — take first number
  if (!mp) return 0;
  const match = mp.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function imageUrl(set, imageFile) {
  return `https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/${set}/${imageFile}`;
}

// ---------------------------------------------------------------------------
// Card type derivation
// ---------------------------------------------------------------------------

function deriveCardType(coeCard) {
  const { type, alignment, attributes } = coeCard;
  const subtype = attributes?.subtype || '';

  if (type === 'Character') {
    if (alignment === 'Hero' || alignment === 'Fallen-wizard') return 'hero-character';
    if (alignment === 'Minion' || alignment === 'Balrog') return 'minion-character';
  }

  if (type === 'Resource') {
    const prefix =
      alignment === 'Hero' || alignment === 'Fallen-wizard'
        ? 'hero-resource'
        : 'minion-resource';

    if (subtype === 'Ally') return `${prefix}-ally`;
    if (subtype === 'Faction') return `${prefix}-faction`;
    if (subtype.includes('Item')) return `${prefix}-item`;
    // Events
    return `${prefix}-event`;
  }

  if (type === 'Hazard') {
    if (subtype.includes('Creature')) return 'hazard-creature';
    return 'hazard-event';
  }

  if (type === 'Site') {
    if (alignment === 'Hero') return 'hero-site';
    if (alignment === 'Minion') return 'minion-site';
    if (alignment === 'Fallen-wizard') return 'fallen-wizard-site';
    if (alignment === 'Balrog') return 'balrog-site';
  }

  if (type === 'Region') return 'region';

  throw new Error(
    `Cannot derive cardType from type=${type} alignment=${alignment} subtype=${subtype}`
  );
}

// ---------------------------------------------------------------------------
// Target file selection
// ---------------------------------------------------------------------------

/**
 * Determines which JSON data file the card belongs in, based on its set and
 * card type category.
 */
function targetFile(set, cardType) {
  const category = cardTypeCategory(cardType);
  const filename = `${set}-${category}.json`;
  return join(PROJECT_DIR, 'packages/shared/src/data', filename);
}

function cardTypeCategory(cardType) {
  if (cardType.endsWith('-character')) return 'characters';
  if (cardType.includes('-resource-item')) return 'items';
  if (cardType.includes('-resource-ally') || cardType.includes('-resource-faction') || cardType.includes('-resource-event'))
    return 'resources';
  if (cardType === 'hazard-creature') return 'creatures';
  if (cardType === 'hazard-event' || cardType === 'hazard-corruption') return 'hazards';
  if (cardType.endsWith('-site')) return 'sites';
  if (cardType === 'region') return 'regions';
  throw new Error(`Unknown card type category for ${cardType}`);
}

// ---------------------------------------------------------------------------
// Card definition builders
// ---------------------------------------------------------------------------

function buildCharacter(coeCard, cardType, set) {
  const a = coeCard.attributes;
  const alignment = ALIGNMENT_MAP[coeCard.alignment] || coeCard.alignment.toLowerCase();
  return {
    cardType,
    alignment,
    id: `${set}-${coeCard.id.split('-')[1]}`,
    name: coeCard.name.en,
    image: imageUrl(set, coeCard.image),
    unique: a.unique === true,
    race: (a.race || '').toLowerCase(),
    skills: parseSkills(a.skills),
    prowess: parseNum(a.prowess),
    body: parseNum(a.body),
    mind: parseNum(a.mind),
    directInfluence: parseNum(a.directInfluence) ?? 0,
    marshallingPoints: parseMarshallingPoints(a.marshallingPoints),
    marshallingCategory: 'character',
    corruptionModifier: 0,
    homesite: typeof a.homeSite === 'object' ? a.homeSite.en : (a.homeSite || ''),
    effects: [],
    text: stripHtml(coeCard.text.en),
  };
}

function buildItem(coeCard, cardType, set) {
  const a = coeCard.attributes;
  const alignment = ALIGNMENT_MAP[coeCard.alignment] || coeCard.alignment.toLowerCase();
  const subtype = ITEM_SUBTYPE_MAP[a.subtype] || a.subtype?.toLowerCase() || 'minor';

  // Extract keywords from card text (Weapon, Armor, Shield, etc.)
  const text = stripHtml(coeCard.text.en);
  const keywords = [];
  for (const kw of ['Weapon', 'Armor', 'Shield', 'Staff', 'Hoard']) {
    if (text.includes(kw + '.') || text.includes(kw + ',')) {
      keywords.push(kw.toLowerCase());
    }
  }

  return {
    cardType,
    alignment,
    id: `${set}-${coeCard.id.split('-')[1]}`,
    name: coeCard.name.en,
    image: imageUrl(set, coeCard.image),
    unique: a.unique === true,
    subtype,
    keywords,
    marshallingPoints: parseMarshallingPoints(a.marshallingPoints),
    marshallingCategory: 'item',
    corruptionPoints: parseCorruption(a.corruption),
    prowessModifier: parseProwessModifier(a.prowess),
    bodyModifier: parseBodyModifier(a.body),
    playableAt: parseSiteTypes(a.playable || ''),
    effects: [],
    text,
  };
}

function buildAlly(coeCard, cardType, set) {
  const a = coeCard.attributes;
  const alignment = ALIGNMENT_MAP[coeCard.alignment] || coeCard.alignment.toLowerCase();

  // Try to extract playable site from text
  const text = stripHtml(coeCard.text.en);
  const playableAt = [];
  const siteMatch = text.match(/[Pp]layable at (.+?)\./);
  if (siteMatch) {
    playableAt.push({ site: siteMatch[1] });
  }

  return {
    cardType,
    alignment,
    id: `${set}-${coeCard.id.split('-')[1]}`,
    name: coeCard.name.en,
    image: imageUrl(set, coeCard.image),
    unique: a.unique === true,
    prowess: parseNum(a.prowess),
    body: parseNum(a.body),
    marshallingPoints: parseMarshallingPoints(a.marshallingPoints),
    marshallingCategory: 'ally',
    playableAt,
    effects: [],
    text,
  };
}

function buildFaction(coeCard, cardType, set) {
  const a = coeCard.attributes;
  const alignment = ALIGNMENT_MAP[coeCard.alignment] || coeCard.alignment.toLowerCase();
  const text = stripHtml(coeCard.text.en);

  // Extract influence number from text: "greater than N"
  let influenceNumber = 0;
  const infMatch = text.match(/greater than (\d+)/);
  if (infMatch) influenceNumber = parseInt(infMatch[1], 10) + 1;

  // Extract playable site from text
  const playableAt = [];
  const siteMatch = text.match(/[Pp]layable at (.+?)[\.\s]/);
  if (siteMatch) {
    playableAt.push({ site: siteMatch[1] });
  }

  return {
    cardType,
    alignment,
    id: `${set}-${coeCard.id.split('-')[1]}`,
    name: coeCard.name.en,
    image: imageUrl(set, coeCard.image),
    unique: a.unique === true,
    marshallingPoints: parseMarshallingPoints(a.marshallingPoints),
    marshallingCategory: 'faction',
    influenceNumber,
    race: (a.race || '').toLowerCase(),
    playableAt,
    effects: [],
    text,
  };
}

function buildResourceEvent(coeCard, cardType, set) {
  const a = coeCard.attributes;
  const alignment = ALIGNMENT_MAP[coeCard.alignment] || coeCard.alignment.toLowerCase();
  const subtype = a.subtype || '';
  const eventType = EVENT_SUBTYPE_MAP[subtype] || 'short';
  const text = stripHtml(coeCard.text.en);

  // Extract keywords from text
  const keywords = [];
  if (text.startsWith('Environment.') || text.includes(' Environment.')) {
    keywords.push('environment');
  }

  return {
    cardType,
    alignment,
    id: `${set}-${coeCard.id.split('-')[1]}`,
    name: coeCard.name.en,
    image: imageUrl(set, coeCard.image),
    unique: a.unique === true,
    eventType,
    ...(keywords.length > 0 ? { keywords } : {}),
    marshallingPoints: 0,
    marshallingCategory: 'misc',
    effects: [],
    text,
  };
}

function buildCreature(coeCard, set) {
  const a = coeCard.attributes;
  const text = stripHtml(coeCard.text.en);

  const regionTypes = parseRegionTypes(a.playable);
  const siteTypes = parseSiteTypes(a.playable);
  const keyedTo = [];
  if (regionTypes.length > 0 || siteTypes.length > 0) {
    const entry = {};
    if (regionTypes.length > 0) entry.regionTypes = regionTypes;
    if (siteTypes.length > 0) entry.siteTypes = siteTypes;
    keyedTo.push(entry);
  }

  return {
    cardType: 'hazard-creature',
    id: `${set}-${coeCard.id.split('-')[1]}`,
    name: coeCard.name.en,
    image: imageUrl(set, coeCard.image),
    unique: a.unique === true,
    strikes: parseNum(a.strikes) ?? 1,
    prowess: parseNum(a.prowess) ?? 0,
    body: parseNum(a.body),
    killMarshallingPoints: parseMarshallingPoints(a.marshallingPoints),
    race: (a.race || '').toLowerCase(),
    keyedTo,
    effects: [],
    text,
  };
}

function buildHazardEvent(coeCard, set) {
  const a = coeCard.attributes;
  const subtype = a.subtype || '';
  const eventType = EVENT_SUBTYPE_MAP[subtype] || 'short';
  const text = stripHtml(coeCard.text.en);

  const keywords = [];
  if (text.startsWith('Environment.') || text.includes(' Environment.')) {
    keywords.push('environment');
  }

  return {
    cardType: 'hazard-event',
    id: `${set}-${coeCard.id.split('-')[1]}`,
    name: coeCard.name.en,
    image: imageUrl(set, coeCard.image),
    unique: a.unique === true,
    eventType,
    ...(keywords.length > 0 ? { keywords } : {}),
    effects: [],
    text,
  };
}

function buildSite(coeCard, cardType, set) {
  const a = coeCard.attributes;
  const alignment = ALIGNMENT_MAP[coeCard.alignment] || coeCard.alignment.toLowerCase();

  const result = {
    cardType,
    alignment,
    id: `${set}-${coeCard.id.split('-')[1]}`,
    name: coeCard.name.en,
    image: imageUrl(set, coeCard.image),
    siteType: parseSiteType(a.siteType),
    sitePath: parseSitePath(a.sitePath),
    nearestHaven: a.haven || '',
    region: a.region || '',
    playableResources: [],
    automaticAttacks: parseAutoAttacks(a.autoAttack),
    resourceDraws: parseNum(a.draw) ?? 1,
    hazardDraws: parseNum(a.drawOpponent) ?? 1,
    text: stripHtml(coeCard.text.en),
  };

  // Havens have havenPaths instead of sitePath/nearestHaven
  if (result.siteType === 'haven') {
    result.sitePath = [];
    result.nearestHaven = '';
    // havenPaths would need to be populated from region data — leave empty for manual setup
    result.havenPaths = {};
  }

  return result;
}

function buildRegion(coeCard, set) {
  const a = coeCard.attributes;
  return {
    cardType: 'region',
    id: `${set}-${coeCard.id.split('-')[1]}`,
    name: coeCard.name.en,
    image: imageUrl(set, coeCard.image),
    regionType: (a.regionType || '').toLowerCase(),
    adjacentRegions: [],
    text: stripHtml(coeCard.text?.en || ''),
  };
}

// ---------------------------------------------------------------------------
// Build card definition (dispatcher)
// ---------------------------------------------------------------------------

function buildCardDefinition(coeCard, cardType, set) {
  if (cardType.endsWith('-character')) return buildCharacter(coeCard, cardType, set);
  if (cardType.includes('-resource-item')) return buildItem(coeCard, cardType, set);
  if (cardType.includes('-resource-ally')) return buildAlly(coeCard, cardType, set);
  if (cardType.includes('-resource-faction')) return buildFaction(coeCard, cardType, set);
  if (cardType.includes('-resource-event')) return buildResourceEvent(coeCard, cardType, set);
  if (cardType === 'hazard-creature') return buildCreature(coeCard, set);
  if (cardType === 'hazard-event') return buildHazardEvent(coeCard, set);
  if (cardType.endsWith('-site')) return buildSite(coeCard, cardType, set);
  if (cardType === 'region') return buildRegion(coeCard, set);
  throw new Error(`No builder for cardType: ${cardType}`);
}

// ---------------------------------------------------------------------------
// File management
// ---------------------------------------------------------------------------

function ensureDataFile(filePath) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '[\n]\n');
    // Add import to index.ts
    addToIndex(filePath);
    return true;
  }
  return false;
}

function addToIndex(filePath) {
  const indexPath = join(PROJECT_DIR, 'packages/shared/src/data/index.ts');
  const indexContent = readFileSync(indexPath, 'utf8');

  const basename = filePath.split('/').pop().replace('.json', '');
  // Convert filename to camelCase variable name: tw-characters -> twCharacters
  const varName = basename.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  // Determine which set section to add to
  const setPrefix = basename.split('-')[0].toUpperCase();
  const setNames = {
    TW: 'The Wizards',
    AS: 'Against the Shadow',
    LE: 'The Lidless Eye',
    WH: 'The White Hand',
    TD: 'The Dragons',
    DM: 'Dark Minions',
    BA: 'The Balrog',
  };
  const setName = setNames[setPrefix] || setPrefix;

  // Add import line
  const importLine = `import ${varName} from './${basename}.json';`;
  // Add spread line
  const spreadLine = `  ...(${varName} as unknown as CardDefinition[]),`;

  // Find where to insert the import (after last import of same set, or at end of imports)
  let lines = indexContent.split('\n');

  // Find the last import line for this set, or last import line overall
  let lastImportIdx = -1;
  let lastSetImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('import ')) {
      lastImportIdx = i;
      if (lines[i].includes(`'./${setPrefix.toLowerCase()}-`)) {
        lastSetImportIdx = i;
      }
    }
  }

  const insertImportAt = lastSetImportIdx >= 0 ? lastSetImportIdx + 1 : lastImportIdx + 1;

  // Check if we need a set comment
  if (lastSetImportIdx < 0) {
    lines.splice(insertImportAt, 0, '', `// ---- ${setName} (${setPrefix}) ----`, importLine);
  } else {
    lines.splice(insertImportAt, 0, importLine);
  }

  // Find the allCards array and add the spread
  let lastSetSpreadIdx = -1;
  let lastSpreadIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('as unknown as CardDefinition[]')) {
      lastSpreadIdx = i;
      if (lines[i].includes(setPrefix.toLowerCase())) {
        lastSetSpreadIdx = i;
      }
    }
  }

  const insertSpreadAt =
    lastSetSpreadIdx >= 0 ? lastSetSpreadIdx + 1 : lastSpreadIdx >= 0 ? lastSpreadIdx + 1 : -1;
  if (insertSpreadAt >= 0) {
    // Check if we need a set comment in the array
    if (lastSetSpreadIdx < 0) {
      lines.splice(insertSpreadAt, 0, `  // ${setName}`, spreadLine);
    } else {
      lines.splice(insertSpreadAt, 0, spreadLine);
    }
  }

  writeFileSync(indexPath, lines.join('\n'));
}

function appendToDataFile(filePath, cardDef) {
  const content = readFileSync(filePath, 'utf8');
  const arr = JSON.parse(content);
  arr.push(cardDef);
  writeFileSync(filePath, JSON.stringify(arr, null, 2) + '\n');
}

function updateDeckFiles(cardName, cardId) {
  const updated = [];

  // Search data/decks/
  const deckDir = join(PROJECT_DIR, 'data/decks');
  if (existsSync(deckDir)) {
    for (const f of readdirSync(deckDir).filter((f) => f.endsWith('.json'))) {
      const fp = join(deckDir, f);
      if (updateDeckFile(fp, cardName, cardId)) updated.push(fp);
    }
  }

  // Search ~/.meccg/players/*/decks/
  const home = process.env.HOME || '';
  const playersDir = join(home, '.meccg/players');
  if (existsSync(playersDir)) {
    for (const player of readdirSync(playersDir)) {
      const decksDir = join(playersDir, player, 'decks');
      if (!existsSync(decksDir)) continue;
      for (const f of readdirSync(decksDir).filter((f) => f.endsWith('.json'))) {
        const fp = join(decksDir, f);
        if (updateDeckFile(fp, cardName, cardId)) updated.push(fp);
      }
    }
  }

  return updated;
}

function updateDeckFile(filePath, cardName, cardId) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const deck = JSON.parse(content);
    let changed = false;

    // Top-level sections: pool, sites, sideboard.
    // Play deck sections (characters, hazards, resources) live under deck.deck.
    const sectionContainers = [
      deck,
      ...(deck.deck && typeof deck.deck === 'object' ? [deck.deck] : []),
    ];

    for (const container of sectionContainers) {
      for (const section of ['pool', 'characters', 'hazards', 'resources', 'sites', 'sideboard']) {
        if (!Array.isArray(container[section])) continue;
        for (const entry of container[section]) {
          if (entry.name === cardName && (!entry.card || entry.card === '')) {
            entry.card = cardId;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      writeFileSync(filePath, JSON.stringify(deck, null, 2) + '\n');
    }
    return changed;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node bin/add-card.mjs <cardName> <deckId>');
    process.exit(1);
  }

  // Everything before the last arg is the card name (names may contain spaces)
  const deckId = args[args.length - 1];
  const cardName = args.slice(0, -1).join(' ');

  console.log(`Looking up card: "${cardName}" for deck: ${deckId}`);

  // Step 1: Read the deck for context
  const deckPath = join(PROJECT_DIR, 'data/decks', `${deckId}.json`);
  let deckAlignment = 'hero';
  if (existsSync(deckPath)) {
    const deck = JSON.parse(readFileSync(deckPath, 'utf8'));
    deckAlignment = deck.alignment || 'hero';
    console.log(`Deck alignment: ${deckAlignment}`);
  } else {
    console.log(`Warning: deck file ${deckPath} not found, assuming hero alignment`);
  }

  // Step 2: Search CoE database
  const dbPath = join(PROJECT_DIR, 'data/cards.json');
  if (!existsSync(dbPath)) {
    console.error('ERROR: CoE database not found at data/cards.json');
    process.exit(1);
  }
  const db = JSON.parse(readFileSync(dbPath, 'utf8'));

  // Search all sets for matching card name
  const matches = [];
  for (const [setCode, setData] of Object.entries(db)) {
    if (!setData.cards) continue;
    for (const [, card] of Object.entries(setData.cards)) {
      if (card.name?.en === cardName) {
        matches.push({ ...card, _setCode: setCode });
      }
    }
  }

  if (matches.length === 0) {
    console.error(`ERROR: Card "${cardName}" not found in CoE database`);
    process.exit(1);
  }

  // Disambiguate by deck alignment if multiple matches
  let coeCard;
  if (matches.length === 1) {
    coeCard = matches[0];
  } else {
    // Try to match alignment
    const alignmentFilter =
      deckAlignment === 'hero'
        ? 'Hero'
        : deckAlignment === 'minion'
          ? 'Minion'
          : deckAlignment === 'fallen-wizard'
            ? 'Fallen-wizard'
            : 'Hero';
    const filtered = matches.filter((m) => m.alignment === alignmentFilter);
    coeCard = filtered.length > 0 ? filtered[0] : matches[0];
    console.log(
      `Found ${matches.length} matches for "${cardName}", selected ${coeCard.alignment} version (${coeCard.id})`
    );
  }

  const set = coeCard._setCode.toLowerCase();
  const cardType = deriveCardType(coeCard);
  console.log(`Card type: ${cardType}, set: ${set}`);

  // Check if card already exists in data files
  const cardId = `${set}-${coeCard.id.split('-')[1]}`;
  const dataDir = join(PROJECT_DIR, 'packages/shared/src/data');
  for (const f of readdirSync(dataDir).filter((f) => f.endsWith('.json'))) {
    const content = readFileSync(join(dataDir, f), 'utf8');
    if (content.includes(`"${cardId}"`)) {
      console.error(`ERROR: Card ${cardId} already exists in ${f}`);
      process.exit(1);
    }
  }

  // Step 3: Determine target file
  const dataFile = targetFile(set, cardType);
  const createdFile = ensureDataFile(dataFile);
  if (createdFile) {
    console.log(`Created new data file: ${dataFile}`);
  }

  // Step 4: Build card definition
  const cardDef = buildCardDefinition(coeCard, cardType, set);
  console.log(`Built card definition: ${cardDef.id} (${cardDef.name})`);

  // Step 5: Add to data file
  appendToDataFile(dataFile, cardDef);
  console.log(`Added to ${dataFile}`);

  // Step 6: Update deck files
  const updatedDecks = updateDeckFiles(cardName, cardDef.id);
  if (updatedDecks.length > 0) {
    console.log(`Updated ${updatedDecks.length} deck file(s):`);
    updatedDecks.forEach((d) => console.log(`  - ${d}`));
  } else {
    console.log('No deck files needed updating');
  }

  // Step 7: Skip card-ids.ts (can be added manually if needed)

  // Step 8: Verify with TypeScript
  console.log('Running type check...');
  try {
    execSync('npx tsc --noEmit -p packages/shared/tsconfig.json', {
      cwd: PROJECT_DIR,
      stdio: 'pipe',
    });
    console.log('Type check passed');
  } catch (e) {
    console.error('Type check failed:');
    console.error(e.stderr?.toString() || e.stdout?.toString() || e.message);
    process.exit(1);
  }

  // Step 9: Commit and push
  const filesToStage = [dataFile, ...updatedDecks];
  if (createdFile) {
    filesToStage.push(join(PROJECT_DIR, 'packages/shared/src/data/index.ts'));
  }

  try {
    execSync(`git add ${filesToStage.map((f) => `"${f}"`).join(' ')}`, {
      cwd: PROJECT_DIR,
      stdio: 'pipe',
    });
    const commitMsg = `Add ${cardName} (${cardDef.id}) from card request`;
    execSync(`git commit -m "${commitMsg}"`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    execSync('git push', { cwd: PROJECT_DIR, stdio: 'pipe' });

    const commitHash = execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, stdio: 'pipe' })
      .toString()
      .trim();

    console.log(`\nCard ${cardName} (${cardDef.id}) successfully added and pushed.`);
    console.log(`commit hash: ${commitHash}`);
    console.log(`card id: ${cardDef.id}`);
  } catch (e) {
    console.error('Git operation failed:');
    console.error(e.stderr?.toString() || e.message);
    process.exit(1);
  }
}

main();
