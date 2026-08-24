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
 *
 * **Chapter one is what ships.** {@link TUTORIAL_STEPS} / {@link TUTORIAL_BEATS}
 * hold the player's own first turn — draft through End Turn — and the
 * tutorial ends there with {@link TUTORIAL_COMPLETION}. The rest of the
 * curriculum (the Mentor's turns and rounds 2–3) lives in
 * {@link LATER_CHAPTER_STEPS} / {@link LATER_CHAPTER_BEATS}: written, engine-
 * verified by the integration tests as a continuation of chapter one, but
 * not played by the tutorial until it is split into chapters of its own.
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
  HORN_OF_ANOR, ORC_LIEUTENANT, MINIONS_STIR,
  THORIN_II, GLOIN, DIMRILL_DALE,
  RHUDAUR, CARDOLAN, ENEDHWAITH, GAP_OF_ISEN, ROHAN,
} from './ids.js';
import type { ActionMatcher, TutorialActor, TutorialBeat, TutorialStepInfo } from './match.js';

/** Shorthand beat constructor keeping the script table readable. */
function b(stepId: string, actor: TutorialActor, match: ActionMatcher, cheatRoll?: number, waitForContinue?: boolean): TutorialBeat {
  return {
    stepId, actor, match,
    ...(cheatRoll === undefined ? {} : { cheatRoll }),
    ...(waitForContinue === undefined ? {} : { waitForContinue }),
  };
}

/**
 * Presentation text per step of chapter one — the player's own first turn,
 * from the character draft to End Turn. Order follows the spec's curriculum
 * tables (steps are grouped: several beats share one step).
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
  { id: 'draft-stop', title: 'Know when to stop', body: 'Elrond would be 25 mind — over the limit, so the pick is blocked. Stop drafting here: the 5 unused mind stays free as general influence, and you will need it soon. Press [[Done]].',
    pointers: [{ anchor: 'general-influence', label: 'Hover here to see a breakdown of your GI usage', side: 'right' }] },
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
      { anchor: 'score-box', label: 'Click your score box to reveal your piles', side: 'right' },
      { anchor: 'play-deck', label: 'Your play deck' },
    ] },
  { id: 'deck-shuffle', title: 'A Haven to start from', body: 'Wizard companies begin at Rivendell — with only one legal starting site, it is chosen for you automatically. Now shuffle: normally this shuffles your play deck, but in the tutorial the order is fixed so every draw can be explained. Press [[Shuffle]].',
    concepts: [
      { term: 'Site deck', explanation: 'A separate deck of location cards. When your companies travel, destinations come from here, not from your hand.' },
    ],
    pointers: [{ anchor: 'site-deck', label: 'Your site deck — the places you may travel to' }] },
  { id: 'initial-draw', title: 'Your opening hand', body: 'Draw 8 cards — your hand size. Your hand holds characters, resources to play on your own turns, and hazards to play on your opponent’s.',
    concepts: [
      { term: 'Hand size', explanation: 'Both players hold 8 cards: at the end of every turn each player draws or discards back to 8.' },
    ],
    pointers: [
      { anchor: 'hand', label: 'Your hand' },
      { anchor: 'text-log', label: 'The text log — every play, roll and draw of the game is recorded here.', side: 'below' },
    ] },
  { id: 'initiative', title: 'Who goes first', body: 'Both players roll two dice; the higher roll takes the first turn. The dice favour you today. Press [[Roll]].',
    pointers: [{ anchor: 'dice', label: 'Your dice land here' }] },
  // ---- Part 2 — Round 1 ----
  { id: 'untap-1', title: 'The untap phase', body: 'A turn runs untap → organization → long-event → movement/hazard → site → end-of-turn (see the phase meter). Untap readies your tapped cards. Nothing is tapped yet, so there is nothing to untap — press [[Untap]] anyway to run the phase and move on.',
    concepts: [
      { term: 'Tapping', explanation: 'A card turned sideways is tapped: it has been used this turn — to fight, to influence, to yield an item. Tapped cards ready again in your untap phase.' },
    ],
    pointers: [
      { anchor: 'phase-meter', label: 'The phase meter — where in the turn you are' },
      { anchor: 'player-name', label: 'The glow around your name means it is your turn.' },
      { anchor: 'opponent-dice', label: 'This shows the latest dice roll for the player.' },
    ] },
  { id: 'org-play-arwen', title: 'Play a character', body: 'Characters come into play either at their home site or at a Haven like Rivendell. Arwen’s home site IS Rivendell, so she qualifies twice over — she simply walks downstairs. Play her; her 3 mind is covered by the 5 general influence you saved in the draft.',
    pointers: [{ anchor: 'general-influence', label: 'General influence pays Arwen’s 3 mind' }] },
  { id: 'org-di-annalena', title: 'Direct influence', body: 'Characters can also be controlled by another character’s direct influence (DI). Glorfindel II has 2 — and +1 against Elves, just enough for Annalena’s 3 mind. Move her under his influence: she becomes his follower, and 3 general influence is freed.',
    concepts: [
      { term: 'Direct influence (DI)', explanation: 'A character’s own leadership, printed on the left side of the card below mind. A character may control followers whose total mind does not exceed their DI — saving your general influence for others. Followers travel with their leader.' },
    ],
    pointers: [
      { anchor: 'general-influence', label: 'The freed influence shows here' },
      { anchor: 'view-toggle', label: 'Switch between one-company and all-companies view here — the all-companies view shows your opponent’s companies too.', side: 'below' },
    ],
    // The DI icon sits on the left edge of the card, below the mind head.
    card: { cardDefId: GLORFINDEL_II, highlight: { x: 0.14, y: 0.33, r: 0.09 } } },
  { id: 'org-move', title: 'Declare movement', body: 'Companies declare movement in the organization phase. First click the company’s current site — Rivendell — then click the Barrow-downs to make it the destination: a two-region journey, Rhudaur then Cardolan.',
    concepts: [
      { term: 'Company', explanation: 'A group of characters travelling together. Companies move, face hazards, and enter sites as one unit.' },
      { term: 'Region', explanation: 'Middle-earth is divided into named regions — the lands a journey crosses. A site path lists every region from the current site to the destination, at most four in one turn.' },
      { term: 'Map', explanation: 'The minimap in the corner shows Middle-earth with a dot for every company: gold pulsing — the active company, grey — your other companies, red — your opponent’s.' },
    ],
    pointers: [{ anchor: 'map', label: 'The map — your companies and their journeys. Click it to open the full-size map.', side: 'left' }] },
  { id: 'org-done', title: 'Organization done', body: 'We are done organizing. Let’s continue to the long-event phase — click [[Continue]].' },
  { id: 'long-event-star', title: 'The long-event phase', body: 'Long-events last until your next long-event phase. Play Star of High Hope: an environment giving every Elf in your company +1 prowess.',
    concepts: [
      { term: 'Race', explanation: 'Every character belongs to a race — Elf, Dwarf, Man, Hobbit and others — printed after the character’s classes. Many cards care about it: Star of High Hope boosts only Elves, and Glorfindel’s +1 direct influence works only against Elves.' },
    ],
    // The race is the last word of the class line ("Scout/Sage Elf").
    card: { cardDefId: ARWEN, highlight: { x: 0.885, y: 0.6, r: 0.06 } } },
  { id: 'chain-of-effects', title: 'The chain of effects', body: 'A resource card play does not resolve on the spot — it opens a chain of effects. Before it resolves, your opponent may declare a response, you may respond to that, and so on; once both players pass, the chain resolves in reverse order of declaration. Press [[Pass Priority]] to see if your opponent has anything to play. If not, then press [[Movement/Hazard]] to continue.',
    concepts: [
      { term: 'Chain of effects', explanation: 'The queue of declared actions waiting to resolve. Each response is declared on top of the previous one, and the chain resolves last-declared first — so a cancel resolves before the card it targets.' },
    ] },
  { id: 'mh-select', title: 'The movement/hazard phase', body: 'Each moving company resolves its journey in turn. Select your company.' },
  { id: 'mh-path', title: 'Ways to travel', body: 'There are two ways to travel. We are using region movement: you name the chain of regions leading to the destination. Declare the path to the Barrow-downs: Rhudaur, then Cardolan.',
    concepts: [
      { term: 'Region', explanation: 'A named stretch of land of one of six types, shown by a symbol on region and site cards: {{free}} Free-domain, {{border}} Border-land, {{wilderness}} Wilderness, {{shadow}} Shadow-land, {{dark}} Dark-domain and {{coastal}} Coastal Sea. The darker the land, the deadlier the hazards it invites.' },
      { term: 'Region movement', explanation: 'Travel by crossing adjacent regions to the destination. A site path may contain at most four regions.' },
      { term: 'Starter movement', explanation: 'The simpler alternative for new players: travel using the fixed site path printed on the destination site card, with no region planning.' },
      { term: 'Region path', explanation: 'The ordered chain of regions your journey crosses — here Rhudaur, then Cardolan. Hazard creatures are keyed to regions, so the path determines what can attack you.' },
    ] },
  { id: 'mh-reveal', title: 'Reveal the destination', body: 'Your site path is revealed to your opponent. The hazard limit — how many hazards can be played on you — is the company’s size, here 4. Press [[Draw]].',
    concepts: [
      { term: 'Hazard limit', explanation: 'The most hazards your opponent may play on a moving company this phase — normally the company’s size, never less than two. For company size, Hobbits (and Orc scouts) count as only half a character, rounded up.' },
      { term: 'Draw numbers', explanation: 'The two boxes in the site card’s lower-left corner: the top number is how many cards your opponent draws, the bottom how many you draw when your company moves here.' },
    ],
    pointers: [{ anchor: 'hazard-limit', label: 'The hazard limit for the moving company' }],
    // The circled lower-left boxes are the draw numbers (opponent on top,
    // moving player on the bottom).
    card: { cardDefId: BARROW_DOWNS, highlight: { x: 0.11, y: 0.9, r: 0.06 } } },
  { id: 'mh-draw', title: 'Draw cards', body: 'Both players draw based on the destination’s draw numbers — you find Gates of Morning. Watch: the Mentor draws too.' },
  { id: 'mh-gates', title: 'Card synergy', body: 'Resource events can be played during the hazard window too. Play Gates of Morning: hazard environments are swept away, and Star of High Hope now gives +2.' },
  { id: 'mh-gates-effect', title: 'The numbers change', body: 'See how the numbers changed: with Gates of Morning in play, Star of High Hope gives +2 prowess to every Elf — Arwen now fights at 4 instead of her printed 2. The Mentor plays nothing — a quiet first journey. Press [[Pass Priority]] and then [[Pass Hazards]] to continue.',
    pointers: [{ cardDefId: ARWEN, label: 'Arwen’s effective prowess is now 4, as shown in the bottom right corner.', side: 'below' }] },
  { id: 'site-select', title: 'The site phase', body: 'Every company has a site phase of its own, and they are handled one by one in the order of your choosing. You have only one company today — select it.' },
  { id: 'site-enter-barrow', title: 'The Barrow-downs', body: 'Every company may either enter its site or skip it — skipping avoids the dangers, but forfeits everything the site offers. Ruins usually hold dangers in the form of automatic-attacks — at the Barrow-downs, it is Undead. Let’s go in — press [[Enter]].',
    concepts: [
      { term: 'Automatic-attack', explanation: 'An attack printed on the site itself — the price of entering dangerous places. It resolves before anything else can happen there.' },
    ] },
  { id: 'site-undead', title: 'The Undead attack', body: 'The barrow-wights rise: an automatic-attack of one strike at 8 prowess. There is no way around it — press [[Continue]] to face it.' },
  { id: 'site-assign', title: 'Assign the strike', body: 'Each strike of an attack must be assigned to a character in the company — and counting prowess before you choose is half the game. Run the numbers on Glorfindel II: prowess 8, +2 from the Star of High Hope, and even refusing to tap (a −3 you will learn about shortly) he fights at 7. The worst roll two dice can give is 2, and 7 + 2 = 9 still beats the wights’ 8 — he cannot lose this fight, and in a real game he is the obvious choice. But this game is for learning, and the costs of combat are better met here than in a game that matters: give the strike to Elrohir and his new shield instead. Click Elrohir.',
    concepts: [
      { term: 'Strike', explanation: 'One duel within an attack, assigned to one character: the character rolls two dice plus prowess against the strike’s prowess.' },
    ] },
  { id: 'site-shield', title: 'Raise the shield', body: 'Items can help in a fight: Elrohir’s Shield of Iron-bound Ash may tap for +1 prowess against a single strike. Click the shield to raise it.' },
  { id: 'site-resolve', title: 'Tap or stay ready', body: 'Shield raised (+1 prowess), one choice remains: Elrohir can tap to face the strike at full prowess, or stay untapped at the cost of −3 — riskier, but he would stay ready to claim the site’s treasure. Confidence wins over caution: resolve the strike untapped.' },
  { id: 'site-bodycheck', title: 'The body check', body: 'Snake eyes! Even a strong warrior behind a shield can stumble: the strike succeeds and Elrohir is struck down. Watch — the Mentor, as the attack’s hazard player, now rolls the body check against him.',
    concepts: [
      { term: 'Body check', explanation: 'When a strike succeeds, the hazard player rolls two dice against the struck character’s body stat: over it and the character is eliminated; otherwise they are wounded — face down, unable to act.' },
    ] },
  { id: 'site-wounded', title: 'Wounded', body: 'Wounded — not eliminated: the Mentor would have needed to beat Elrohir’s body of 8 — a 9 or more — to eliminate him. So he lies face down, unable to act. And the Barrow-downs force a corruption check on the wounded: press [[Roll]] — he holds firm. Combat has costs.',
    concepts: [
      { term: 'Corruption', explanation: 'The lure of power and treasure weighing on a character’s heart. Rings, treasures and certain hazards add corruption points (CP) — the more a character carries, the harder it is to stay true.' },
      { term: 'Corruption check', explanation: 'Roll two dice against the character’s corruption point total: roll higher and they resist. Equal or one less, a hero forsakes the quest and is discarded; lower still, the character is eliminated.' },
    ] },
  { id: 'site-aftermath', title: 'The mound falls silent', body: 'The fight is over and Elrohir’s wound is the price paid. Nothing more stands between you and the site’s treasure — press [[Continue]] until the spoils are within reach.' },
  { id: 'site-sword', title: 'Claim the prize', body: 'A tapped site yields its treasure. Click the Sword of Gondolin in your hand, then click Glorfindel II to make him its bearer — the wounded Elrohir cannot bear it. Playing the sword taps Glorfindel and the site, and it is worth 2 marshalling points. Then press [[Pass Resources]] to finish the site phase.',
    concepts: [
      { term: 'Marshalling points (MP)', explanation: 'Victory points. Items, factions, allies and slain foes all score them; whoever holds the most wins the endgame council. Spread your sources: points in a source where your opponent has none are doubled at the council — these item points count twice if the Mentor wins no items of his own — and no single source (your characters, say) may supply more than half of your final total.' },
    ],
    pointers: [{ anchor: 'marshalling-points', label: 'Your marshalling points', side: 'right' }] },
  { id: 'eot-1', title: 'End of turn', body: 'You may discard a card you don’t need — let go of the spare Sword of Gondolin, its twin is already in Glorfindel’s hands: click the sword in your hand and choose Discard. Then press [[Draw]] to refill your hand to 8.' },
  { id: 'eot-1-end', title: 'Turn over', body: 'All done — now click [[End Turn]]. That is a full turn played, and the end of chapter one.' },
];

/**
 * The chapter-one closing card: shown centered on the board once the last
 * beat of {@link TUTORIAL_BEATS} has been performed, with the tutorial's
 * only way out beside it. Not a {@link TutorialStepInfo} — no beat leads to
 * it; the script is over when it appears.
 */
export const TUTORIAL_COMPLETION: {
  readonly title: string;
  readonly body: string;
  readonly learned: readonly string[];
  readonly footer: string;
} = {
  title: 'Chapter one complete',
  body: 'That was a full turn of MECCG, from the character draft to End Turn. Along the way you learned:',
  learned: [
    'Drafting a company against your 20 general influence, and arming it with starting items.',
    'Bringing a character into play at a Haven, and moving another under a leader’s direct influence.',
    'Declaring a journey region by region, and reading the destination’s hazard limit and draw numbers.',
    'Playing a long-event, and how a chain of effects resolves last-declared first.',
    'Entering a ruin: its automatic-attack, assigning a strike, the body check and the corruption check that follow.',
    'Claiming the site’s treasure for your first marshalling points, then refilling your hand to eight.',
  ],
  footer: 'Chapter two — the Mentor’s turn, where the hazards are yours to play — is still to come.',
};

/**
 * The curriculum beyond chapter one: the Mentor's first turn and rounds 2–3.
 * Kept as a continuation of {@link TUTORIAL_STEPS} — the integration tests
 * replay it right after chapter one so it stays engine-verified — but the
 * tutorial does not play it yet.
 */
export const LATER_CHAPTER_STEPS: readonly TutorialStepInfo[] = [
  { id: 'mentor-untap-1', title: 'Roles swap', body: 'On your opponent’s turn you are the hazard player: now it is your job to make the Mentor’s journey dangerous. Watch the Mentor untap, then click [[End Untap]].' },
  { id: 'mentor-org-1', title: 'The Mentor moves out', body: 'Watch: the Mentor’s dwarves head for Moria. You have no actions in your opponent’s organization phase.' },
  { id: 'mentor-mh-1', title: 'The dwarves march', body: 'The Mentor reveals its site path to you. Both players draw cards based on the destination’s draw numbers — press [[Draw]], then pass.' },
  { id: 'mentor-hazard-1', title: 'Your first hazard', body: 'Now it is your moment: play the Orc-lieutenant on the dwarves — creatures are keyed to regions and site types, and the company’s path must include one of them. The Mentor defends: Gimli taps and defeats the Orc, and the Mentor takes the kill marshalling points. Both sides score in this game.',
    concepts: [
      { term: 'Keyed to', explanation: 'Where a hazard creature may attack: each creature lists region and site types, and the moving company’s path must include one of them.' },
    ] },
  { id: 'mentor-site-1', title: 'The Mentor at Moria', body: 'The dwarves enter Moria and face its automatic-attack: Orcs, four strikes of 7 prowess — more strikes than dwarves. As hazard player, YOU assign the leftover strikes; pile them on the already-tapped Gimli. Thorin fights untapped, wins, and stays ready to claim Glamdring. Round 1 ends.' },
  { id: 'mentor-eot-1', title: 'Hands reset', body: 'Both players refill to 8 at the end of every turn.' },
  // ---- Part 3 — Round 2 ----
  { id: 'untap-2', title: 'Wounded stay wounded', body: 'Untap — but Elrohir stays wounded: healing happens at Havens during untap. Time to send him home.' },
  { id: 'org-split', title: 'Split the company', body: 'First move Annalena from Glorfindel’s influence back under your general influence — you will need his full influence at Edoras next turn. Then split the company: the wounded Elrohir travels alone toward Rivendell to heal, while the rest head for the Old Forest. Declare movement for both companies.' },
  { id: 'long-event-2', title: 'Long-events expire', body: 'Star of High Hope is discarded now — long-events last exactly until your next long-event phase.' },
  { id: 'mh-2', title: 'Two companies travel', body: 'Each company resolves its movement in turn. The Mentor stays quiet — but note: a lone wounded character is exactly what hazard players prey on. Escorts matter.' },
  { id: 'site-goldberry', title: 'An ally at the Old Forest', body: 'Enter the Old Forest and play Goldberry — allies join a character and score marshalling points. Elrohir rests at Rivendell.',
    concepts: [
      { term: 'Ally', explanation: 'A companion creature played on a character. Allies travel with their keeper, may tap for their own abilities, and are worth marshalling points.' },
    ] },
  { id: 'site-minor-item-bonus', title: 'A bonus for tapping the site', body: 'Goldberry tapped the Old Forest to join you — and a resource that taps the site opens a bonus: one more character may tap to play a minor item, even at an already-tapped site. Give Arwen the spare Dagger of Westernesse.',
    concepts: [
      { term: 'Additional minor item', explanation: 'When a resource card (ally, faction, or item) taps the site, the resource player may immediately play one more minor item as a bonus — even though the site is already tapped.' },
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
 * Chapter one's prescribed action sequence. Beats sharing a `stepId` are
 * performed while that step's instruction is on screen; order is strict.
 * The last beat is the player's End Turn — the tutorial ends there.
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
  b('org-done', 'human', { type: 'pass' }),
  b('long-event-star', 'human', { type: 'play-long-event', cardDef: STAR_OF_HIGH_HOPE }),
  b('chain-of-effects', 'human', { type: 'pass' }),
  b('mh-select', 'human', { type: 'select-company' }),
  b('mh-path', 'human', { type: 'declare-path', fields: { movementType: 'region', regionPath: [RHUDAUR, CARDOLAN] as string[] } }),
  b('mh-reveal', 'human', { type: 'draw-cards' }),
  b('mh-draw', 'mentor', { type: 'draw-cards' }),
  b('mh-draw', 'mentor', { type: 'pass' }),
  b('mh-gates', 'human', { type: 'play-permanent-event', cardDef: GATES_OF_MORNING }),
  b('mh-gates-effect', 'mentor', { type: 'pass' }),
  b('mh-gates-effect', 'human', { type: 'pass' }),
  b('mh-gates-effect', 'mentor', { type: 'discard-card', cardDef: CAVE_DRAKE }),
  b('site-select', 'human', { type: 'select-company' }),
  b('site-enter-barrow', 'human', { type: 'enter-site' }),
  b('site-undead', 'mentor', { type: 'pass' }),
  b('site-undead', 'human', { type: 'pass' }),
  b('site-assign', 'human', { type: 'assign-strike', cardDef: ELROHIR }),
  b('site-shield', 'human', { type: 'tap-item-for-strike', cardDef: SHIELD_OF_IRON_BOUND_ASH }),
  b('site-resolve', 'human', { type: 'resolve-strike', fields: { tapToFight: false } }, 2),
  // Continue-gated: the "Watch — the Mentor rolls the body check" narration
  // must be read at the player's own pace before the roll lands.
  b('site-bodycheck', 'mentor', { type: 'body-check-roll' }, 5, true),
  b('site-wounded', 'human', { type: 'corruption-check', cardDef: ELROHIR }, 7),
  b('site-aftermath', 'human', { type: 'pass' }),
  b('site-aftermath', 'mentor', { type: 'pass' }),
  b('site-aftermath', 'human', { type: 'pass' }),
  b('site-sword', 'human', { type: 'play-hero-resource', cardDef: SWORD_OF_GONDOLIN, alsoRefs: [GLORFINDEL_II] }),
  b('site-sword', 'human', { type: 'pass' }),
  b('eot-1', 'human', { type: 'discard-card', cardDef: SWORD_OF_GONDOLIN }),
  b('eot-1', 'mentor', { type: 'pass' }),
  b('eot-1', 'human', { type: 'draw-cards' }),
  b('eot-1', 'mentor', { type: 'pass' }),
  b('eot-1-end', 'human', { type: 'pass' }),
];

/**
 * The beats of {@link LATER_CHAPTER_STEPS}, continuing from the state
 * {@link TUTORIAL_BEATS} leaves behind. Replayed by the tutorial tests
 * immediately after chapter one, never by the tutorial itself.
 */
export const LATER_CHAPTER_BEATS: readonly TutorialBeat[] = [
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
  b('mentor-hazard-1', 'human', { type: 'play-hazard', cardDef: ORC_LIEUTENANT }),
  b('mentor-hazard-1', 'mentor', { type: 'assign-strike', cardDef: GIMLI }),
  b('mentor-hazard-1', 'mentor', { type: 'resolve-strike', fields: { tapToFight: true } }, 8),
  b('mentor-hazard-1', 'human', { type: 'pass' }),
  b('mentor-hazard-1', 'mentor', { type: 'pass' }),
  b('mentor-hazard-1', 'mentor', { type: 'discard-card', cardDef: CAVE_DRAKE }),
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
  b('org-split', 'human', { type: 'split-company', cardDef: ELROHIR }),
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
  b('site-minor-item-bonus', 'human', { type: 'play-hero-resource', cardDef: DAGGER_OF_WESTERNESSE, alsoRefs: [ARWEN] }),
  b('site-minor-item-bonus', 'human', { type: 'pass' }),
  b('site-minor-item-bonus', 'human', { type: 'select-company', fields: { companyId: 'company-p1-1' } }),
  b('site-minor-item-bonus', 'human', { type: 'pass' }),
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
  b('mh-3', 'human', { type: 'discard-card', cardDef: HORN_OF_ANOR }),
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

/** Map from stepId to its presentation info, across every chapter. */
export const TUTORIAL_STEP_BY_ID: ReadonlyMap<string, TutorialStepInfo> =
  new Map([...TUTORIAL_STEPS, ...LATER_CHAPTER_STEPS].map(step => [step.id, step]));
