#!/usr/bin/env node
/**
 * @module update-readme
 *
 * Regenerates the progress metrics that the `/update-readme` skill (and, via
 * it, `/release`) keeps in sync with the tests and card data:
 *
 *   - `packages/shared/src/tests/rules/README.md` — refreshes the Overall
 *     Progress totals and each matrix row's status mark in place. The section
 *     breakdown and rule names are hand-curated, so they are left untouched.
 *   - `packages/shared/src/tests/cards/README.md` — fully regenerated from the
 *     card test files plus the card pool.
 *   - `README.md` — the Project Status table and the Deck Catalog table.
 *
 * A test file counts as done when it has at least one `test()` and no
 * `test.todo()`; `test.todo()` marks an effect that is specified but not yet
 * implemented. This mirrors the testing philosophy in
 * `packages/shared/CLAUDE.md`: the rule/card tests are a living spec.
 *
 * Usage: node bin/update-readme.mjs [--check]
 *
 * With `--check`, nothing is written and the script exits 1 if any file would
 * change — useful for verifying the READMEs are current without touching them.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..');

const DATA_DIR = join(PROJECT_DIR, 'packages/shared/src/data');
const CARDS_DIR = join(PROJECT_DIR, 'packages/shared/src/tests/cards');
const RULES_DIR = join(PROJECT_DIR, 'packages/shared/src/tests/rules');
const DECKS_DIR = join(PROJECT_DIR, 'data/decks');
const COE_DB = join(PROJECT_DIR, 'data/cards.json');
const README = join(PROJECT_DIR, 'README.md');

const CHECK_ONLY = process.argv.includes('--check');

/** Set prefixes in the order the card matrix and category breakdown use. */
const SETS = ['as', 'ba', 'dm', 'le', 'td', 'tw', 'wh'];

/** Percentage to one decimal place, as the README tables format it. */
const pct = (done, total) => (total === 0 ? '0.0' : ((done / total) * 100).toFixed(1));

/** All `*.test.ts` files under `dir`, recursively. */
function testFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...testFiles(path));
    else if (entry.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/**
 * Counts implemented vs pending tests in a test file. `test.todo(` is counted
 * separately from `test(`; the two patterns cannot overlap, because `test.todo`
 * has a `.` where the implemented form has its `(`.
 *
 * The leading `(?<![.\w])` is load-bearing: `\b` alone also matches after a
 * dot, so `/unique/i.test(reason)` — a RegExp method call, not a test — was
 * counted as an effect and inflated the Effects column on every card whose
 * assertions use one.
 */
function counts(file) {
  const src = readFileSync(file, 'utf8');
  const todo = (src.match(/(?<![.\w])test\.todo\s*\(/g) || []).length;
  const impl = (src.match(/(?<![.\w])test\s*\(/g) || []).length;
  return { impl, todo, total: impl + todo, done: impl > 0 && todo === 0 };
}

/** ☑ = fully implemented, ☐ = all todo, ◐ = partially implemented. */
const mark = (c) => (c.done ? '☑' : c.impl === 0 ? '☐' : '◐');

/**
 * The card a test file is about, for pool lookups. Test files may carry a
 * descriptive suffix (`as-79-the-dark-power.test.ts`), which is not part of the
 * card id; matching to the end of the string missed those entirely, leaving the
 * card unnamed in the matrix. Files with no card id at all (parity suites such
 * as `le-pending-effects-parity`) return unchanged and simply find no card.
 */
function cardIdOf(id) {
  return /^[a-z]+-\d+(?=-|$)/.exec(id)?.[0] ?? id;
}

/** Sort key placing cards by set, then numerically; ids with no number sort last within their set. */
function idKey(id) {
  const numbered = /^([a-z]+)-0*(\d+)(?=-|$)/.exec(id);
  if (numbered) return [SETS.indexOf(numbered[1]), parseInt(numbered[2], 10)];
  const set = /^([a-z]+)-/.exec(id);
  return [set ? SETS.indexOf(set[1]) : SETS.length, Number.MAX_SAFE_INTEGER];
}

/** Every card definition across the per-set data files, keyed by id. */
function loadCardPool() {
  const pool = {};
  for (const file of readdirSync(DATA_DIR)) {
    if (!file.endsWith('.json')) continue;
    const json = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
    if (Array.isArray(json)) for (const card of json) if (card?.id) pool[card.id] = card;
  }
  return pool;
}

const changed = [];

/** Writes `content` to `path`, or records the pending change under `--check`. */
function emit(path, content) {
  if (readFileSync(path, 'utf8') === content) return;
  changed.push(path.slice(PROJECT_DIR.length + 1));
  if (!CHECK_ONLY) writeFileSync(path, content);
}

// ---------------------------------------------------------------------------
// Card tests README
// ---------------------------------------------------------------------------

/**
 * Rebuilds the card README. Card names come from the pool; the Type column is
 * carried over from the existing table, which is the only record of it.
 */
function updateCardsReadme(pool) {
  const old = readFileSync(join(CARDS_DIR, 'README.md'), 'utf8');
  const carried = new Map();
  for (const m of old.matchAll(/^\| ([a-z]{2}-[\w-]+) \| ([^|]*?) \| ([^|]*?) \|/gm)) {
    carried.set(m[1], { name: m[2].trim(), type: m[3].trim() });
  }

  const files = testFiles(CARDS_DIR)
    .map((file) => ({ id: file.split('/').pop().replace('.test.ts', ''), file }))
    .sort((a, b) => {
      const [aSet, aNum] = idKey(a.id);
      const [bSet, bNum] = idKey(b.id);
      return aSet - bSet || aNum - bNum || a.id.localeCompare(b.id);
    });

  const rows = [];
  const categories = {};
  let done = 0;

  for (const { id, file } of files) {
    const c = counts(file);
    const category = id.split('-')[0].toUpperCase();
    categories[category] ??= { total: 0, done: 0 };
    categories[category].total++;
    if (c.done) {
      categories[category].done++;
      done++;
    }
    const name = pool[cardIdOf(id)]?.name ?? carried.get(id)?.name ?? '—';
    const type = carried.get(id)?.type ?? '—';
    rows.push(`| ${id} | ${name} | ${type} | ${c.total} | ${mark(c)} |`);
  }

  const total = files.length;
  let md = `# Card Tests Coverage

> One test file per card with special rules/effects. Each \`test()\` covers one effect; \`test.todo()\` marks unimplemented effects.

## Overall Progress

| Total Cards | Certified | Remaining | Progress |
|:-----------:|:---------:|:---------:|:--------:|
| ${total} | ${done} | ${total - done} | ${pct(done, total)}% |

## Category Breakdown

| Category | Cards | Done | % |
|:---------|:-----:|:----:|:-:|
`;
  for (const category of Object.keys(categories).sort()) {
    const s = categories[category];
    md += `| ${category} | ${s.total} | ${s.done} | ${pct(s.done, s.total)}% |\n`;
  }
  md += `
## Detailed Test Matrix

| Card | Name | Type | Effects | Status |
|:-----|:-----|:-----|:-------:|:------:|
${rows.join('\n')}

---
*Legend: ☐ = todo, ☑ = implemented, ◐ = partial*
`;

  emit(join(CARDS_DIR, 'README.md'), md);
  return { done, total };
}

// ---------------------------------------------------------------------------
// Rule tests README
// ---------------------------------------------------------------------------

/**
 * Refreshes the rule README's totals and per-row status marks in place. Each
 * matrix row links to its test file, so the mark is recomputed from the link
 * target; rows whose link does not resolve are left as-is.
 */
function updateRulesReadme() {
  const files = testFiles(RULES_DIR);
  const total = files.length;
  let done = 0;
  for (const file of files) if (counts(file).done) done++;

  let md = readFileSync(join(RULES_DIR, 'README.md'), 'utf8');

  md = md.replace(
    /^(\|[^|]*\|[^|]*\|[^|]*\()([^)]+\.test\.ts)(\)[^|]*\| )([☑☐◐])( \|)$/gm,
    (row, pre, rel, mid, _status, post) => {
      try {
        return pre + rel + mid + mark(counts(join(RULES_DIR, rel))) + post;
      } catch {
        return row;
      }
    },
  );

  md = md.replace(
    /(\| Total Rules \| Implemented \| Remaining \| Progress \|\n\|[^\n]*\|\n\| )\d+ \| \d+ \| \d+ \| [\d.]+% \|/,
    `$1${total} | ${done} | ${total - done} | ${pct(done, total)}% |`,
  );

  emit(join(RULES_DIR, 'README.md'), md);
  return { done, total };
}

// ---------------------------------------------------------------------------
// Top-level README
// ---------------------------------------------------------------------------

/** Total cards in the Council of Elrond database, summed across sets. */
function coeCardCount() {
  const db = JSON.parse(readFileSync(COE_DB, 'utf8'));
  let total = 0;
  for (const set of Object.values(db)) if (set?.cards) total += Object.keys(set.cards).length;
  return total;
}

function projectStatusTable(rules, cards, pool) {
  const created = Object.keys(pool).length;
  const certified = Object.values(pool).filter((c) => c.certified).length;

  const rows = [
    ['Rule tests', rules.done, rules.total],
    ['Card tests', cards.done, cards.total],
    ['Cards created', created, coeCardCount()],
    ['Cards certified', certified, created],
  ];
  const done = rows.reduce((sum, r) => sum + r[1], 0);
  const total = rows.reduce((sum, r) => sum + r[2], 0);

  let md = `## Project Status

| Metric | Done | Total | Progress |
|:-------|-----:|------:|---------:|
`;
  for (const [name, d, t] of rows) md += `| ${name} | ${d} | ${t} | ${pct(d, t)}% |\n`;
  md += `| **Total** | **${done}** | **${total}** | **${pct(done, total)}%** |\n`;
  return md;
}

/**
 * Counts every card entry in a deck across its pool, sites, sideboard and the
 * character/hazard/resource piles, honouring `qty` (default 1).
 */
function deckCatalogTable(pool) {
  const rows = [];
  for (const file of readdirSync(DECKS_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const deck = JSON.parse(readFileSync(join(DECKS_DIR, file), 'utf8'));
    const groups = [
      deck.pool,
      deck.sites,
      deck.sideboard,
      deck.deck?.characters,
      deck.deck?.hazards,
      deck.deck?.resources,
    ];

    let cards = 0;
    let available = 0;
    let certified = 0;
    for (const group of groups) {
      if (!Array.isArray(group)) continue;
      for (const entry of group) {
        const qty = entry.qty ?? 1;
        cards += qty;
        const card = pool[entry.card];
        if (!card) continue;
        available += qty;
        if (card.certified) certified += qty;
      }
    }

    rows.push(
      `| ${deck.name} | ${deck.alignment} | ${cards} ` +
        `| ${available} (${pct(available, cards)}%) | ${certified} (${pct(certified, cards)}%) |`,
    );
  }

  return `### Deck Catalog

| Deck | Alignment | Cards | Data Available | Certified |
|:-----|:----------|------:|---------------:|----------:|
${rows.join('\n')}
`;
}

function updateProjectReadme(rules, cards, pool) {
  const before = readFileSync(README, 'utf8');
  let md = before;

  const status = projectStatusTable(rules, cards, pool);
  const catalog = deckCatalogTable(pool);

  md = md.replace(/## Project Status\n[\s\S]*?(?=### Deck Catalog)/, `${status}\n`);
  md = md.replace(/### Deck Catalog\n[\s\S]*?(?=\n## |$)/, catalog);

  if (md === before && !before.includes(status)) {
    console.error('ERROR: README.md section markers not found — nothing replaced.');
    process.exit(1);
  }

  emit(README, md);
  return status;
}

// ---------------------------------------------------------------------------

const pool = loadCardPool();
const cards = updateCardsReadme(pool);
const rules = updateRulesReadme();
const status = updateProjectReadme(rules, cards, pool);

process.stdout.write(`${status}\n`);

if (CHECK_ONLY && changed.length > 0) {
  console.error(`Out of date:\n${changed.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(changed.length ? `Updated:\n${changed.map((f) => `  ${f}`).join('\n')}` : 'Already up to date.');
