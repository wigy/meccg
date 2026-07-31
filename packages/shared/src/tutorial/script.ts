/**
 * @module tutorial/script
 *
 * The guided-tutorial curriculum (specs/2026-07-30-tutorial-plan.md):
 * presentation metadata for every step ({@link TUTORIAL_STEPS}) and the
 * strict ordered list of prescribed actions ({@link TUTORIAL_BEATS}).
 *
 * The script is data, not code: the game-server gates the human seat to the
 * current beat, plays the Mentor's beats, and the browser panel renders the
 * step whose beats are active. The headless integration test executes every
 * beat against the real engine, so an engine change that invalidates the
 * curriculum fails CI instead of confusing new players.
 */

import {
  GLORFINDEL_II, ELROND, GIMLI,
  DAGGER_OF_WESTERNESSE, GLAMDRING,
  GATES_OF_MORNING, MARVELS_TOLD, RIDERS_OF_ROHAN, CAVE_DRAKE,
  FOOLISH_WORDS, LURE_OF_THE_SENSES, RIVER, SUN,
  RIVENDELL, BARROW_DOWNS, OLD_FOREST, EDORAS, MORIA, LORIEN,
} from '../card-ids.js';
import {
  ARWEN, ANNALENA, ELROHIR, GILDOR_INGLORION,
  STAR_OF_HIGH_HOPE, SWORD_OF_GONDOLIN, GOLDBERRY, SHIELD_OF_IRON_BOUND_ASH,
  ORC_LIEUTENANT, MINIONS_STIR,
  THORIN_II, GLOIN, DIMRILL_DALE,
  RHUDAUR, CARDOLAN, ENEDHWAITH, GAP_OF_ISEN, ROHAN,
} from './ids.js';
import type { ActionMatcher, TutorialActor, TutorialBeat, TutorialStepInfo } from './match.js';

/** Shorthand beat constructor keeping the script table readable. */
function b(stepId: string, actor: TutorialActor, match: ActionMatcher, cheatRoll?: number): TutorialBeat {
  return cheatRoll === undefined ? { stepId, actor, match } : { stepId, actor, match, cheatRoll };
}

/**
 * Presentation text per curriculum step. Order follows the spec's
 * curriculum tables (steps are grouped: several beats share one step).
 */
export const TUTORIAL_STEPS: readonly TutorialStepInfo[] = [
  // ---- Part 1 — Setup ----
  { id: 'draft-first-pick', title: 'The character draft', body: 'Both players secretly pick starting characters, one per round. Your general influence — 20 mind — is the budget. Pick Glorfindel II, a mighty Elf-lord of Rivendell.',
    concepts: [
      { term: 'Mind', explanation: 'Every character has a mind stat — the cost in influence to bring them into play and keep them loyal. Glorfindel has mind 8.' },
      { term: 'General influence (GI)', explanation: 'Your leadership budget, 20 points. Drafted characters use it up mind for mind; whatever is left stays available during the game.' },
    ],
    pointers: [{ anchor: 'general-influence', label: 'Your general influence — the 20-point draft budget' }],
    // Mind sits in the white head icon on the left edge of a character card.
    card: { cardDefId: GLORFINDEL_II, highlight: { x: 0.14, y: 0.22, r: 0.09 } } },
  { id: 'draft-twins', title: 'Build the company', body: 'Pick Annalena, then Elrohir. The running total is shown — together with Glorfindel II they bring you to 15 mind.' },
  { id: 'draft-stop', title: 'Know when to stop', body: 'Elrond would be 25 mind — over the limit, so the pick is blocked. Stop drafting here: the 5 unused mind stays free as general influence, and you will need it soon. Press DONE.' },
  { id: 'item-draft', title: 'Starting items', body: 'Each character may carry starting minor items — at most two in total. Give the Dagger of Westernesse to Annalena — it brings her prowess to 4.',
    concepts: [
      { term: 'Minor item', explanation: 'A small, easily carried item. Items attach to a character — their bearer — and grant small bonuses. Minor items are worth no marshalling points.' },
      { term: 'Prowess', explanation: 'A character’s fighting strength — the number added to their dice when resolving a strike. Annalena’s prowess is 3.' },
      { term: 'Weapon', explanation: 'An item class that boosts its bearer’s prowess. The Dagger of Westernesse gives +1 prowess to a maximum of 8, so Annalena fights at 4.' },
    ],
    // Prowess sits before the "/" in the lower-left corner of the card.
    card: { cardDefId: ANNALENA, highlight: { x: 0.13, y: 0.89, r: 0.09 } } },
  { id: 'item-draft-shield', title: 'A shield for Elrohir', body: 'Give the Shield of Iron-bound Ash to Elrohir. Read the card: its +1 body cannot pass 8, and Elrohir is there already — but it can also tap for +1 prowess against a single strike.',
    concepts: [
      { term: 'Body', explanation: 'A character’s toughness — the number after the “/” in the lower-left corner. When a strike gets through, the body check is rolled against it: the higher the body, the likelier the character survives.' },
    ],
    // The prowess/body pair sits in the lower-left corner of the card.
    card: { cardDefId: ELROHIR, highlight: { x: 0.13, y: 0.89, r: 0.09 } } },
  { id: 'deck-draft', title: 'Characters for the deck', body: 'Undrafted characters need not be wasted: add Elrond and Gildor Inglorion to your play deck — you may play them later in the game.',
    concepts: [
      { term: 'Play deck', explanation: 'Your draw pile for the whole game: resources, hazards, and any characters you did not draft.' },
    ],
    pointers: [
      { anchor: 'score-box', label: 'Click your score box to reveal your piles' },
      { anchor: 'play-deck', label: 'Your play deck' },
    ] },
  { id: 'deck-shuffle', title: 'A Haven to start from', body: 'Wizard companies begin at Rivendell — with only one legal starting site, it is chosen for you automatically. (Two-site avatars — Ringwraiths, the Balrog — would also place characters between sites here.) Now shuffle: normally this shuffles your play deck, but in the tutorial the order is fixed so every draw can be explained.',
    concepts: [
      { term: 'Site deck', explanation: 'A separate deck of location cards. When your companies travel, destinations come from here, not from your hand.' },
    ],
    pointers: [{ anchor: 'site-deck', label: 'Your site deck — the places you may travel to' }] },
  { id: 'initial-draw', title: 'Your opening hand', body: 'Draw 8 cards — your hand size. Your hand holds characters, resources to play on your own turns, and hazards to play on your opponent’s.',
    concepts: [
      { term: 'Hand size', explanation: 'Both players hold 8 cards: at the end of every turn each player draws or discards back to 8.' },
    ],
    pointers: [{ anchor: 'hand', label: 'Your hand' }] },
  { id: 'initiative', title: 'Who goes first', body: 'Both players roll two dice; the higher roll takes the first turn. The dice favour you today.',
    pointers: [{ anchor: 'dice', label: 'Your dice land here' }] },
  // ---- Part 2 — Round 1 ----
  { id: 'untap-1', title: 'The untap phase', body: 'A turn runs untap → organization → long-event → movement/hazard → site → end-of-turn (see the phase meter). Untap readies your tapped cards — nothing is tapped yet, but the phase still runs.',
    footer: 'TO BE CONTINUED....',
    concepts: [
      { term: 'Tapping', explanation: 'A card turned sideways is tapped: it has been used this turn — to fight, to influence, to yield an item. Tapped cards ready again in your untap phase.' },
    ],
    pointers: [{ anchor: 'phase-meter', label: 'The phase meter — where in the turn you are' }] },
  { id: 'org-play-arwen', title: 'Play a character', body: 'Characters come into play at their home site. Arwen’s home is Rivendell — play her. Her 3 mind is covered by the 5 general influence you saved in the draft.',
    pointers: [{ anchor: 'general-influence', label: 'General influence pays Arwen’s 3 mind' }] },
  { id: 'org-di-annalena', title: 'Direct influence', body: 'Characters can also be controlled by another character’s direct influence (DI). Glorfindel II has 2 — and +1 against Elves, just enough for Annalena’s 3 mind. Move her under his influence: she becomes his follower, and 3 general influence is freed.',
    concepts: [
      { term: 'Direct influence (DI)', explanation: 'A character’s own leadership, printed on the left side of the card below mind. A character may control followers whose total mind does not exceed their DI — saving your general influence for others. Followers travel with their leader.' },
    ],
    pointers: [{ anchor: 'general-influence', label: 'The freed influence shows here' }],
    // The DI icon sits on the left edge of the card, below the mind head.
    card: { cardDefId: GLORFINDEL_II, highlight: { x: 0.14, y: 0.33, r: 0.09 } } },
  { id: 'org-move', title: 'Declare movement', body: 'Companies declare movement in the organization phase. Send the company to the Barrow-downs: a two-region journey, Rhudaur then Cardolan.',
    concepts: [
      { term: 'Company', explanation: 'A group of characters travelling together. Companies move, face hazards, and enter sites as one unit.' },
    ] },
  { id: 'long-event-star', title: 'The long-event phase', body: 'Long-events last until your next long-event phase. Play Star of High Hope: an environment giving every Elf in your company +1 prowess.' },
  { id: 'mh-select', title: 'The movement/hazard phase', body: 'Each moving company resolves its journey in turn. Select your company.' },
  { id: 'mh-reveal', title: 'Reveal the destination', body: 'Reveal the site path to your opponent. The hazard limit — how many hazards can be played on you — is the company’s size, here 4.',
    concepts: [
      { term: 'Hazard limit', explanation: 'The most hazards your opponent may play on a moving company this phase — normally the company’s size, never less than two.' },
    ],
    pointers: [{ anchor: 'hazard-limit', label: 'The hazard limit for the moving company' }] },
  { id: 'mh-draw', title: 'Draw cards', body: 'Both players draw based on the destination’s draw numbers. Draw — you find Gates of Morning.' },
  { id: 'mh-gates', title: 'Card synergy', body: 'Resource events can be played during the hazard window too. Play Gates of Morning: hazard environments are swept away, and Star of High Hope now gives +2. The Mentor plays nothing — a quiet first journey.' },
  { id: 'site-enter-barrow', title: 'The Barrow-downs', body: 'Enter the site. Ruins like these have automatic-attacks: Undead — one strike of 8 prowess. Assign the strike to Annalena and resolve it untapped: riskier (no tapping bonus), but she stays ready if she prevails.',
    concepts: [
      { term: 'Automatic-attack', explanation: 'An attack printed on the site itself — the price of entering dangerous places. It resolves before anything else can happen there.' },
      { term: 'Strike', explanation: 'One duel within an attack, assigned to one character: the character rolls two dice plus prowess against the strike’s prowess. Tapping to face it adds +1 but leaves the character tapped.' },
    ] },
  { id: 'site-wounded', title: 'Wounds and body checks', body: 'The strike succeeded: Annalena is struck down. She makes a body check — wounded, not eliminated — and the Barrow-downs force a corruption check on the wounded. She resists it. Combat has costs.',
    concepts: [
      { term: 'Body check', explanation: 'When a strike succeeds, the character rolls two dice against their body stat: over it and they are eliminated; otherwise they are wounded — face down, unable to act.' },
      { term: 'Corruption check', explanation: 'Roll two dice minus the character’s corruption points: 6 or more resists; less, and the character is lost to corruption.' },
    ] },
  { id: 'site-sword', title: 'Claim the prize', body: 'A tapped site yields its treasure: play Sword of Gondolin on Elrohir. It taps him and the site, and is worth 2 marshalling points.',
    concepts: [
      { term: 'Marshalling points (MP)', explanation: 'Victory points. Items, factions, allies and slain foes all score them; the player with the most marshalling points wins the endgame council.' },
    ],
    pointers: [{ anchor: 'marshalling-points', label: 'Your marshalling points' }] },
  { id: 'eot-1', title: 'End of turn', body: 'You may discard a card you don’t need — let go of Sun, its work is done by Gates of Morning. Then refill your hand to 8. Your turn ends.' },
  { id: 'mentor-untap-1', title: 'Roles swap', body: 'On your opponent’s turn you are the hazard player. You could fetch from your sideboard now, but that would halve your hazard limit all turn — decline.',
    concepts: [
      { term: 'Sideboard', explanation: 'A reserve of cards outside your play deck. You may fetch from it during your opponent’s untap phase — at the cost of a halved hazard limit that turn.' },
    ],
    pointers: [{ anchor: 'sideboard', label: 'Your sideboard — the reserve pile' }] },
  { id: 'mentor-org-1', title: 'The Mentor moves out', body: 'Watch: the Mentor’s dwarves head for Moria. You have no actions in your opponent’s organization phase.' },
  { id: 'mentor-mh-1', title: 'Your first hazard', body: 'The Mentor reveals its path. Draw, then play the Orc-lieutenant on the dwarves — creatures are keyed to regions and site types on the path. The Mentor defends: Gimli taps and defeats the Orc, and the Mentor takes the kill marshalling points. Both sides score in this game.',
    concepts: [
      { term: 'Keyed to', explanation: 'Where a hazard creature may attack: each creature lists region and site types, and the moving company’s path must include one of them.' },
    ] },
  { id: 'mentor-site-1', title: 'The Mentor at Moria', body: 'The dwarves enter Moria and face its automatic-attack: Orcs, four strikes of 7 prowess — more strikes than dwarves. As hazard player, YOU assign the leftover strikes; pile them on the already-tapped Gimli. Thorin fights untapped, wins, and stays ready to claim Glamdring. Round 1 ends.' },
  { id: 'mentor-eot-1', title: 'Hands reset', body: 'Both players refill to 8 at the end of every turn.' },
  // ---- Part 3 — Round 2 ----
  { id: 'untap-2', title: 'Wounded stay wounded', body: 'Untap — but Annalena stays wounded: healing happens at Havens during untap. Time to send her home.' },
  { id: 'org-split', title: 'Split the company', body: 'A follower travels with her leader, so first move Annalena back under your general influence. Then split the company: Annalena alone toward Rivendell; Glorfindel II, Elrohir and Arwen toward the Old Forest. Declare movement for both companies.' },
  { id: 'long-event-2', title: 'Long-events expire', body: 'Star of High Hope is discarded now — long-events last exactly until your next long-event phase.' },
  { id: 'mh-2', title: 'Two companies travel', body: 'Each company resolves its movement in turn. The Mentor stays quiet — but note: a lone wounded character is exactly what hazard players prey on. Escorts matter.' },
  { id: 'site-goldberry', title: 'An ally at the Old Forest', body: 'Enter the Old Forest and play Goldberry — allies join a character and score marshalling points. Annalena rests at Rivendell.',
    concepts: [
      { term: 'Ally', explanation: 'A companion creature played on a character. Allies travel with their keeper, may tap for their own abilities, and are worth marshalling points.' },
    ] },
  { id: 'eot-2', title: 'End of turn 2', body: 'Refill your hand. The Mentor’s turn.' },
  { id: 'mentor-org-2', title: 'The Mentor turns south', body: 'Watch: the dwarves leave Moria for Lórien.' },
  { id: 'mentor-mh-2', title: 'Corruption and long-events', body: 'Draw, then play Lure of the Senses on Thorin II — 2 corruption points; the check comes due at the end of his next untap phase. Play Minions Stir too: a hazard long-event. Your own Gates of Morning does not touch it — it is not an environment.',
    concepts: [
      { term: 'Corruption points (CP)', explanation: 'The weight of temptation a character carries — from hazards like this, but also from rings and treasures. Each point makes every future corruption check one harder.' },
    ] },
  { id: 'mentor-site-2', title: 'Safe haven', body: 'Watch: the dwarves reach Lórien. Havens have no automatic-attacks.',
    concepts: [
      { term: 'Haven', explanation: 'A refuge site: no automatic-attacks, new characters may join there, and the wounded heal during the untap phase.' },
    ] },
  { id: 'mentor-eot-2', title: 'Round 2 ends', body: 'Hands refill. Your turn again.' },
  // ---- Part 4 — Round 3 ----
  { id: 'untap-heal', title: 'Healing at a Haven', body: 'Untap — Annalena, home at Rivendell, heals. The round trip paid off.' },
  { id: 'org-edoras', title: 'The long road to Edoras', body: 'Send the main company from the Old Forest to Edoras: Cardolan, Enedhwaith, Gap of Isen, Rohan — exactly four regions, the movement maximum.',
    concepts: [
      { term: 'Region movement', explanation: 'Companies travel region by region across the map, at most four regions per turn. The longer the path, the more hazards it can expose you to.' },
    ] },
  { id: 'mh-3', title: 'Something waits at Edoras', body: 'During your journey the Mentor places a card face-down on-guard at Edoras. It counts against the hazard limit — you will meet it soon.',
    concepts: [
      { term: 'On-guard', explanation: 'A hazard played face-down at your destination instead of resolved at once. It lies in wait and may be revealed when you act at the site.' },
    ] },
  { id: 'site-faction', title: 'Factions and the chain of effects', body: 'Enter Edoras and attempt the Riders of Rohan: tap Glorfindel II — with his influence you need a roll of 8. The Mentor reveals Foolish Words from on-guard: −4, so only a perfect 12 will do… and the dice deliver! Then answer the slander for good: Marvels Told — Arwen, a sage, taps to force its discard, resisting the ritual’s corruption check. The Riders of Rohan join you: 3 marshalling points.',
    concepts: [
      { term: 'Faction', explanation: 'A people or army won to your cause: tap a character at the faction’s home site and roll two dice plus the character’s influence against the faction’s number. Success scores marshalling points.' },
      { term: 'Chain of effects', explanation: 'Cards played in response to one another stack into a chain, which resolves in reverse order — the last card played takes effect first.' },
    ] },
  { id: 'eot-3', title: 'A full ledger', body: 'Item, ally, faction — your marshalling points are mounting. End your turn.' },
  { id: 'mentor-untap-3', title: 'Corruption comes due', body: 'Watch: Thorin II makes the corruption check from Lure of the Senses — and passes. Had he failed, he would have been discarded.' },
  { id: 'mentor-mh-3', title: 'Hazards that are not creatures', body: 'The dwarves march for Dimrill Dale. Draw, then play River on their destination: their company must do nothing during its site phase. A ranger could tap to cancel it — the Mentor has none.' },
  { id: 'mentor-site-3', title: 'Stopped by the River', body: 'Watch: the dwarves arrive… and can do nothing. Hazards need not kill to hurt.' },
  { id: 'tutorial-complete', title: 'Tutorial complete', body: 'You have played three full rounds: drafting, movement, combat, wounds and healing, allies, corruption, factions and the chain of effects. Next: a real game against the AI — and the player guide when you need it.' },
];

/**
 * The prescribed action sequence. Beats sharing a `stepId` are performed
 * while that step's instruction is on screen; order is strict.
 */
export const TUTORIAL_BEATS: readonly TutorialBeat[] = [
  // ---- Part 1 — Setup ----
  b('draft-first-pick', 'human', { type: 'draft-pick', cardDef: GLORFINDEL_II }),
  b('draft-first-pick', 'mentor', { type: 'draft-pick', cardDef: THORIN_II }),
  b('draft-twins', 'human', { type: 'draft-pick', cardDef: ANNALENA }),
  b('draft-twins', 'mentor', { type: 'draft-pick', cardDef: GIMLI }),
  b('draft-twins', 'human', { type: 'draft-pick', cardDef: ELROHIR }),
  b('draft-twins', 'mentor', { type: 'draft-pick', cardDef: GLOIN }),
  b('draft-stop', 'human', { type: 'draft-stop' }),
  b('item-draft', 'human', { type: 'assign-starting-item', cardDef: ANNALENA, fields: { itemDefId: DAGGER_OF_WESTERNESSE as string } }),
  b('item-draft-shield', 'human', { type: 'assign-starting-item', cardDef: ELROHIR, fields: { itemDefId: SHIELD_OF_IRON_BOUND_ASH as string } }),
  b('deck-draft', 'human', { type: 'add-character-to-deck', cardDef: ELROND }),
  b('deck-draft', 'human', { type: 'add-character-to-deck', cardDef: GILDOR_INGLORION }),
  b('deck-shuffle', 'human', { type: 'shuffle-play-deck' }),
  b('deck-shuffle', 'mentor', { type: 'shuffle-play-deck' }),
  b('initial-draw', 'human', { type: 'draw-cards', fields: { count: 8 } }),
  b('initial-draw', 'mentor', { type: 'draw-cards', fields: { count: 8 } }),
  b('initiative', 'human', { type: 'roll-initiative' }, 10),
  b('initiative', 'mentor', { type: 'roll-initiative' }, 4),

  // ---- Part 2 — Round 1: your turn ----
  b('untap-1', 'human', { type: 'untap' }),
  b('untap-1', 'mentor', { type: 'pass' }),
  b('org-play-arwen', 'human', { type: 'play-character', cardDef: ARWEN }),
  b('org-di-annalena', 'human', { type: 'move-to-influence', cardDef: ANNALENA, alsoRefs: [GLORFINDEL_II] }),
  b('org-move', 'human', { type: 'plan-movement', cardDef: BARROW_DOWNS }),
  b('org-move', 'human', { type: 'pass' }),
  b('long-event-star', 'human', { type: 'play-long-event', cardDef: STAR_OF_HIGH_HOPE }),
  b('long-event-star', 'human', { type: 'pass' }),
  b('mh-select', 'human', { type: 'select-company' }),
  b('mh-reveal', 'human', { type: 'declare-path', fields: { movementType: 'region', regionPath: [RHUDAUR, CARDOLAN] as string[] } }),
  b('mh-draw', 'human', { type: 'draw-cards' }),
  b('mh-draw', 'mentor', { type: 'draw-cards' }),
  b('mh-draw', 'mentor', { type: 'pass' }),
  b('mh-gates', 'human', { type: 'play-permanent-event', cardDef: GATES_OF_MORNING }),
  b('mh-gates', 'mentor', { type: 'pass' }),
  b('mh-gates', 'human', { type: 'pass' }),
  b('mh-gates', 'mentor', { type: 'discard-card', cardDef: CAVE_DRAKE }),
  b('site-enter-barrow', 'human', { type: 'select-company' }),
  b('site-enter-barrow', 'human', { type: 'enter-site' }),
  b('site-enter-barrow', 'mentor', { type: 'pass' }),
  b('site-enter-barrow', 'human', { type: 'pass' }),
  b('site-enter-barrow', 'human', { type: 'assign-strike', cardDef: ANNALENA }),
  b('site-wounded', 'human', { type: 'resolve-strike', fields: { tapToFight: false } }, 2),
  b('site-wounded', 'mentor', { type: 'body-check-roll' }, 5),
  b('site-wounded', 'human', { type: 'corruption-check', cardDef: ANNALENA }, 7),
  b('site-wounded', 'human', { type: 'pass' }),
  b('site-wounded', 'mentor', { type: 'pass' }),
  b('site-wounded', 'human', { type: 'pass' }),
  b('site-sword', 'human', { type: 'play-hero-resource', cardDef: SWORD_OF_GONDOLIN, alsoRefs: [ELROHIR] }),
  b('site-sword', 'human', { type: 'pass' }),
  b('eot-1', 'human', { type: 'discard-card', cardDef: SUN }),
  b('eot-1', 'mentor', { type: 'pass' }),
  b('eot-1', 'human', { type: 'draw-cards' }),
  b('eot-1', 'mentor', { type: 'pass' }),
  b('eot-1', 'human', { type: 'pass' }),

  // ---- Part 2 — Round 1: the Mentor's turn ----
  b('mentor-untap-1', 'mentor', { type: 'untap' }),
  b('mentor-untap-1', 'human', { type: 'pass' }),
  b('mentor-org-1', 'mentor', { type: 'plan-movement', cardDef: MORIA }),
  b('mentor-org-1', 'mentor', { type: 'pass' }),
  b('mentor-org-1', 'mentor', { type: 'pass' }),
  b('mentor-mh-1', 'mentor', { type: 'select-company' }),
  b('mentor-mh-1', 'mentor', { type: 'declare-path', fields: { movementType: 'region' } }),
  b('mentor-mh-1', 'mentor', { type: 'draw-cards' }),
  b('mentor-mh-1', 'human', { type: 'draw-cards' }),
  b('mentor-mh-1', 'human', { type: 'pass' }),
  b('mentor-mh-1', 'mentor', { type: 'pass' }),
  b('mentor-mh-1', 'human', { type: 'play-hazard', cardDef: ORC_LIEUTENANT }),
  b('mentor-mh-1', 'mentor', { type: 'assign-strike', cardDef: GIMLI }),
  b('mentor-mh-1', 'mentor', { type: 'resolve-strike', fields: { tapToFight: true } }, 8),
  b('mentor-mh-1', 'human', { type: 'pass' }),
  b('mentor-mh-1', 'mentor', { type: 'pass' }),
  b('mentor-mh-1', 'mentor', { type: 'discard-card', cardDef: CAVE_DRAKE }),
  b('mentor-site-1', 'mentor', { type: 'select-company' }),
  b('mentor-site-1', 'mentor', { type: 'enter-site' }),
  b('mentor-site-1', 'human', { type: 'pass' }),
  b('mentor-site-1', 'mentor', { type: 'pass' }),
  b('mentor-site-1', 'mentor', { type: 'assign-strike', cardDef: THORIN_II }),
  b('mentor-site-1', 'mentor', { type: 'assign-strike', cardDef: GLOIN }),
  b('mentor-site-1', 'mentor', { type: 'pass' }),
  b('mentor-site-1', 'human', { type: 'assign-strike', cardDef: GIMLI }),
  b('mentor-site-1', 'human', { type: 'assign-strike', cardDef: GIMLI, fields: { excess: true } }),
  b('mentor-site-1', 'mentor', { type: 'choose-strike-order', cardDef: THORIN_II }),
  b('mentor-site-1', 'mentor', { type: 'resolve-strike', fields: { tapToFight: false } }, 9),
  b('mentor-site-1', 'mentor', { type: 'choose-strike-order', cardDef: GLOIN }),
  b('mentor-site-1', 'mentor', { type: 'resolve-strike' }, 9),
  b('mentor-site-1', 'mentor', { type: 'resolve-strike' }, 12),
  b('mentor-site-1', 'mentor', { type: 'pass' }),
  b('mentor-site-1', 'human', { type: 'pass' }),
  b('mentor-site-1', 'mentor', { type: 'pass' }),
  b('mentor-site-1', 'mentor', { type: 'play-hero-resource', cardDef: GLAMDRING, alsoRefs: [THORIN_II] }),
  b('mentor-site-1', 'mentor', { type: 'pass' }),
  b('mentor-eot-1', 'human', { type: 'pass' }),
  b('mentor-eot-1', 'mentor', { type: 'pass' }),
  b('mentor-eot-1', 'mentor', { type: 'draw-cards' }),
  b('mentor-eot-1', 'human', { type: 'pass' }),
  b('mentor-eot-1', 'mentor', { type: 'pass' }),

  // ---- Part 3 — Round 2: your turn ----
  b('untap-2', 'human', { type: 'untap' }),
  b('untap-2', 'mentor', { type: 'pass' }),
  b('org-split', 'human', { type: 'move-to-influence', cardDef: ANNALENA, fields: { controlledBy: 'general' } }),
  b('org-split', 'human', { type: 'split-company', cardDef: ANNALENA }),
  b('org-split', 'human', { type: 'plan-movement', cardDef: OLD_FOREST }),
  b('org-split', 'human', { type: 'plan-movement', cardDef: RIVENDELL }),
  b('org-split', 'human', { type: 'pass' }),
  b('long-event-2', 'human', { type: 'pass' }),
  b('mh-2', 'human', { type: 'select-company', fields: { companyId: 'company-p1-0' } }),
  b('mh-2', 'human', { type: 'declare-path', fields: { movementType: 'region', regionPath: [CARDOLAN] as string[] } }),
  b('mh-2', 'human', { type: 'draw-cards' }),
  b('mh-2', 'mentor', { type: 'draw-cards' }),
  b('mh-2', 'mentor', { type: 'pass' }),
  b('mh-2', 'human', { type: 'pass' }),
  b('mh-2', 'human', { type: 'discard-card', cardDef: DAGGER_OF_WESTERNESSE }),
  b('mh-2', 'mentor', { type: 'discard-card', cardDef: SUN }),
  b('mh-2', 'human', { type: 'select-company', fields: { companyId: 'company-p1-1' } }),
  b('mh-2', 'human', { type: 'declare-path', fields: { movementType: 'region', regionPath: [CARDOLAN, RHUDAUR] as string[] } }),
  b('mh-2', 'human', { type: 'draw-cards' }),
  b('mh-2', 'mentor', { type: 'draw-cards' }),
  b('mh-2', 'mentor', { type: 'pass' }),
  b('mh-2', 'human', { type: 'pass' }),
  b('mh-2', 'mentor', { type: 'pass' }),
  b('mh-2', 'human', { type: 'discard-card', cardDef: CAVE_DRAKE }),
  b('mh-2', 'mentor', { type: 'discard-card', cardDef: DAGGER_OF_WESTERNESSE }),
  b('site-goldberry', 'human', { type: 'select-company', fields: { companyId: 'company-p1-0' } }),
  b('site-goldberry', 'human', { type: 'enter-site' }),
  b('site-goldberry', 'mentor', { type: 'pass' }),
  b('site-goldberry', 'human', { type: 'pass' }),
  b('site-goldberry', 'human', { type: 'play-hero-resource', cardDef: GOLDBERRY }),
  b('site-goldberry', 'human', { type: 'pass' }),
  b('site-goldberry', 'human', { type: 'select-company', fields: { companyId: 'company-p1-1' } }),
  b('site-goldberry', 'human', { type: 'pass' }),
  b('eot-2', 'human', { type: 'pass' }),
  b('eot-2', 'mentor', { type: 'pass' }),
  b('eot-2', 'human', { type: 'draw-cards' }),
  b('eot-2', 'mentor', { type: 'pass' }),
  b('eot-2', 'human', { type: 'pass' }),

  // ---- Part 3 — Round 2: the Mentor's turn ----
  b('mentor-org-2', 'mentor', { type: 'untap' }),
  b('mentor-org-2', 'human', { type: 'pass' }),
  b('mentor-org-2', 'mentor', { type: 'plan-movement', cardDef: LORIEN }),
  b('mentor-org-2', 'mentor', { type: 'pass' }),
  b('mentor-org-2', 'mentor', { type: 'pass' }),
  b('mentor-mh-2', 'mentor', { type: 'select-company' }),
  b('mentor-mh-2', 'mentor', { type: 'declare-path', fields: { movementType: 'region' } }),
  b('mentor-mh-2', 'mentor', { type: 'draw-cards' }),
  b('mentor-mh-2', 'human', { type: 'draw-cards' }),
  b('mentor-mh-2', 'human', { type: 'pass' }),
  b('mentor-mh-2', 'mentor', { type: 'pass' }),
  b('mentor-mh-2', 'human', { type: 'play-hazard', cardDef: LURE_OF_THE_SENSES, alsoRefs: [THORIN_II] }),
  b('mentor-mh-2', 'human', { type: 'play-hazard', cardDef: MINIONS_STIR }),
  b('mentor-mh-2', 'human', { type: 'pass' }),
  b('mentor-mh-2', 'mentor', { type: 'pass' }),
  b('mentor-mh-2', 'mentor', { type: 'discard-card', cardDef: SUN }),
  b('mentor-site-2', 'mentor', { type: 'select-company' }),
  b('mentor-site-2', 'mentor', { type: 'pass' }),
  b('mentor-eot-2', 'human', { type: 'pass' }),
  b('mentor-eot-2', 'mentor', { type: 'pass' }),
  b('mentor-eot-2', 'human', { type: 'pass' }),
  b('mentor-eot-2', 'mentor', { type: 'pass' }),
  b('mentor-eot-2', 'mentor', { type: 'pass' }),

  // ---- Part 4 — Round 3: your turn ----
  b('untap-heal', 'human', { type: 'untap' }),
  b('untap-heal', 'mentor', { type: 'pass' }),
  b('org-edoras', 'human', { type: 'plan-movement', cardDef: EDORAS }),
  b('org-edoras', 'human', { type: 'pass' }),
  b('org-edoras', 'human', { type: 'pass' }),
  b('mh-3', 'human', { type: 'select-company', fields: { companyId: 'company-p1-0' } }),
  b('mh-3', 'human', { type: 'declare-path', fields: { movementType: 'region', regionPath: [CARDOLAN, ENEDHWAITH, GAP_OF_ISEN, ROHAN] as string[] } }),
  b('mh-3', 'human', { type: 'draw-cards' }),
  b('mh-3', 'mentor', { type: 'draw-cards' }),
  b('mh-3', 'human', { type: 'pass' }),
  b('mh-3', 'mentor', { type: 'place-on-guard', cardDef: FOOLISH_WORDS }),
  b('mh-3', 'mentor', { type: 'pass' }),
  b('mh-3', 'human', { type: 'pass' }),
  b('mh-3', 'human', { type: 'discard-card', cardDef: SUN }),
  b('mh-3', 'human', { type: 'select-company', fields: { companyId: 'company-p1-1' } }),
  b('mh-3', 'human', { type: 'pass' }),
  b('mh-3', 'mentor', { type: 'pass' }),
  b('mh-3', 'human', { type: 'pass' }),
  b('site-faction', 'human', { type: 'select-company', fields: { companyId: 'company-p1-0' } }),
  b('site-faction', 'human', { type: 'enter-site' }),
  b('site-faction', 'mentor', { type: 'pass' }),
  b('site-faction', 'human', { type: 'pass' }),
  b('site-faction', 'human', { type: 'influence-attempt', cardDef: RIDERS_OF_ROHAN, alsoRefs: [GLORFINDEL_II] }),
  b('site-faction', 'mentor', { type: 'reveal-on-guard', cardDef: FOOLISH_WORDS }),
  b('site-faction', 'human', { type: 'faction-influence-roll', cardDef: RIDERS_OF_ROHAN }, 12),
  b('site-faction', 'human', { type: 'play-short-event', cardDef: MARVELS_TOLD, alsoRefs: [FOOLISH_WORDS, ARWEN] }),
  b('site-faction', 'human', { type: 'corruption-check', cardDef: ARWEN }, 8),
  b('site-faction', 'human', { type: 'pass' }),
  b('site-faction', 'human', { type: 'select-company', fields: { companyId: 'company-p1-1' } }),
  b('site-faction', 'human', { type: 'pass' }),
  b('eot-3', 'human', { type: 'pass' }),
  b('eot-3', 'mentor', { type: 'pass' }),
  b('eot-3', 'human', { type: 'draw-cards' }),
  b('eot-3', 'mentor', { type: 'pass' }),
  b('eot-3', 'human', { type: 'pass' }),

  // ---- Part 4 — Round 3: the Mentor's turn ----
  b('mentor-untap-3', 'mentor', { type: 'untap' }),
  b('mentor-untap-3', 'human', { type: 'pass' }),
  b('mentor-untap-3', 'mentor', { type: 'corruption-check', cardDef: THORIN_II }, 8),
  b('mentor-mh-3', 'mentor', { type: 'plan-movement', cardDef: DIMRILL_DALE }),
  b('mentor-mh-3', 'mentor', { type: 'pass' }),
  b('mentor-mh-3', 'mentor', { type: 'pass' }),
  b('mentor-mh-3', 'mentor', { type: 'select-company' }),
  b('mentor-mh-3', 'mentor', { type: 'declare-path', fields: { movementType: 'region' } }),
  b('mentor-mh-3', 'mentor', { type: 'draw-cards' }),
  b('mentor-mh-3', 'human', { type: 'draw-cards' }),
  b('mentor-mh-3', 'mentor', { type: 'pass' }),
  b('mentor-mh-3', 'human', { type: 'play-hazard', cardDef: RIVER }),
  b('mentor-mh-3', 'human', { type: 'pass' }),
  b('mentor-mh-3', 'mentor', { type: 'pass' }),
  b('mentor-mh-3', 'mentor', { type: 'discard-card', cardDef: DAGGER_OF_WESTERNESSE }),
  b('mentor-site-3', 'mentor', { type: 'select-company' }),
  b('mentor-site-3', 'mentor', { type: 'pass' }),
  b('tutorial-complete', 'human', { type: 'pass' }),
  b('tutorial-complete', 'mentor', { type: 'pass' }),
  b('tutorial-complete', 'human', { type: 'pass' }),
  b('tutorial-complete', 'mentor', { type: 'pass' }),
];

/** Map from stepId to its presentation info. */
export const TUTORIAL_STEP_BY_ID: ReadonlyMap<string, TutorialStepInfo> =
  new Map(TUTORIAL_STEPS.map(step => [step.id, step]));
