# CoE Rules Test Suite

> Auto-generated test scaffold — one test file per rule, using `test()` for implemented rules and `test.todo()` for pending work. Source rules: `docs/coe-rules.md`.

## Overall Progress

| Total Rules | Implemented | Remaining | Progress |
|:-----------:|:-----------:|:---------:|:--------:|
| 307 | 112 | 195 | 36.5% |

## Section Breakdown

| # | Section | Rules | Done | % |
|:-:|:--------|:-----:|:----:|:-:|
| 00 | [Engine](00-engine/) | 3 | 3 | 100.0% |
| 01 | [Deck Construction & Setup](01-deck-construction/) | 59 | 12 | 20.3% |
| 02 | [Untap Phase](02-untap-phase/) | 13 | 10 | 76.9% |
| 03 | [Organization Phase](03-organization-phase/) | 48 | 20 | 41.7% |
| 04 | [Long-Event Phase](04-long-event-phase/) | 3 | 3 | 100.0% |
| 05 | [Movement/Hazard Phase](05-movement-hazard-phase/) | 34 | 14 | 41.2% |
| 06 | [Site Phase](06-site-phase/) | 21 | 11 | 52.4% |
| 07 | [End-of-Turn Phase](07-end-of-turn-phase/) | 2 | 1 | 50.0% |
| 08 | [Combat](08-combat/) | 42 | 10 | 23.8% |
| 09 | [Agents, Events, Items & Rings](09-agents-events-items/) | 29 | 10 | 34.5% |
| 10 | [Corruption, Influence, Actions/Timing & Ending the Game](10-corruption-influence-endgame/) | 53 | 18 | 34.0% |

## Detailed Test Matrix

| Rule | Section | Test | Status |
|:-----|:--------|:-----|:------:|
| — | Engine | [Active Constraints](00-engine/active-constraints.test.ts) | ☑ |
| — | Engine | [Last Action Card Defs](00-engine/last-action-card-defs.test.ts) | ☑ |
| — | Engine | [Pending Resolutions](00-engine/pending-resolutions.test.ts) | ☑ |
| 1.01 | Deck Construction & Setup | [Game Length](01-deck-construction/rule-1.01-game-length.test.ts) | ☐ |
| 1.02 | Deck Construction & Setup | [Player Type](01-deck-construction/rule-1.02-player-type.test.ts) | ☑ |
| 1.03 | Deck Construction & Setup | [Deck Composition](01-deck-construction/rule-1.03-deck-composition.test.ts) | ☐ |
| 1.04 | Deck Construction & Setup | [Unique Card Limits](01-deck-construction/rule-1.04-unique-card-limits.test.ts) | ☐ |
| 1.05 | Deck Construction & Setup | [Agent Mind Limit](01-deck-construction/rule-1.05-agent-mind-limit.test.ts) | ☐ |
| 1.06 | Deck Construction & Setup | [Dual Resource Hazard](01-deck-construction/rule-1.06-dual-resource-hazard.test.ts) | ☐ |
| 1.07 | Deck Construction & Setup | [Avatar Specific Cards](01-deck-construction/rule-1.07-avatar-specific-cards.test.ts) | ☐ |
| 1.08 | Deck Construction & Setup | [Hero Avatar Characters](01-deck-construction/rule-1.08-hero-avatar-characters.test.ts) | ☐ |
| 1.09 | Deck Construction & Setup | [Hero Non Avatar Characters](01-deck-construction/rule-1.09-hero-non-avatar-characters.test.ts) | ☐ |
| 1.10 | Deck Construction & Setup | [Hero Resources](01-deck-construction/rule-1.10-hero-resources.test.ts) | ☐ |
| 1.11 | Deck Construction & Setup | [Minion Avatar Characters](01-deck-construction/rule-1.11-minion-avatar-characters.test.ts) | ☐ |
| 1.12 | Deck Construction & Setup | [Minion Characters](01-deck-construction/rule-1.12-minion-characters.test.ts) | ☐ |
| 1.13 | Deck Construction & Setup | [Minion Resources](01-deck-construction/rule-1.13-minion-resources.test.ts) | ☐ |
| 1.14 | Deck Construction & Setup | [Fw Deck Restrictions](01-deck-construction/rule-1.14-fw-deck-restrictions.test.ts) | ☐ |
| 1.15 | Deck Construction & Setup | [Fw Hazard Resource Split](01-deck-construction/rule-1.15-fw-hazard-resource-split.test.ts) | ☐ |
| 1.16 | Deck Construction & Setup | [Fw Avatar Characters](01-deck-construction/rule-1.16-fw-avatar-characters.test.ts) | ☐ |
| 1.17 | Deck Construction & Setup | [Fw Non Avatar Characters](01-deck-construction/rule-1.17-fw-non-avatar-characters.test.ts) | ☐ |
| 1.18 | Deck Construction & Setup | [Fw Banned Cards](01-deck-construction/rule-1.18-fw-banned-cards.test.ts) | ☐ |
| 1.19 | Deck Construction & Setup | [Balrog Avatar Characters](01-deck-construction/rule-1.19-balrog-avatar-characters.test.ts) | ☐ |
| 1.20 | Deck Construction & Setup | [Balrog Non Avatar Characters](01-deck-construction/rule-1.20-balrog-non-avatar-characters.test.ts) | ☐ |
| 1.21 | Deck Construction & Setup | [Balrog Resources](01-deck-construction/rule-1.21-balrog-resources.test.ts) | ☐ |
| 1.22 | Deck Construction & Setup | [Balrog Additional Restrictions](01-deck-construction/rule-1.22-balrog-additional-restrictions.test.ts) | ☐ |
| 1.23 | Deck Construction & Setup | [Balrog Banned Cards](01-deck-construction/rule-1.23-balrog-banned-cards.test.ts) | ☐ |
| 1.24 | Deck Construction & Setup | [Location Deck General](01-deck-construction/rule-1.24-location-deck-general.test.ts) | ☐ |
| 1.25 | Deck Construction & Setup | [Location Deck Balrog Sites](01-deck-construction/rule-1.25-location-deck-balrog-sites.test.ts) | ☐ |
| 1.26 | Deck Construction & Setup | [Hero Location Deck](01-deck-construction/rule-1.26-hero-location-deck.test.ts) | ☐ |
| 1.27 | Deck Construction & Setup | [Minion Location Deck](01-deck-construction/rule-1.27-minion-location-deck.test.ts) | ☐ |
| 1.28 | Deck Construction & Setup | [Fw Location Deck](01-deck-construction/rule-1.28-fw-location-deck.test.ts) | ☐ |
| 1.29 | Deck Construction & Setup | [Balrog Location Deck](01-deck-construction/rule-1.29-balrog-location-deck.test.ts) | ☐ |
| 1.30 | Deck Construction & Setup | [Play Deck Composition](01-deck-construction/rule-1.30-play-deck-composition.test.ts) | ☐ |
| 1.31 | Deck Construction & Setup | [Sideboard Rules](01-deck-construction/rule-1.31-sideboard-rules.test.ts) | ☐ |
| 1.32 | Deck Construction & Setup | [Pool Rules](01-deck-construction/rule-1.32-pool-rules.test.ts) | ☐ |
| 1.33 | Deck Construction & Setup | [Fw Pool Stage Resources](01-deck-construction/rule-1.33-fw-pool-stage-resources.test.ts) | ☐ |
| 1.34 | Deck Construction & Setup | [Declaring Alignments](01-deck-construction/rule-1.34-declaring-alignments.test.ts) | ☐ |
| 1.35 | Deck Construction & Setup | [Cards Vs Ringwraith](01-deck-construction/rule-1.35-cards-vs-ringwraith.test.ts) | ☐ |
| 1.36 | Deck Construction & Setup | [Cards Vs Balrog](01-deck-construction/rule-1.36-cards-vs-balrog.test.ts) | ☐ |
| 1.37 | Deck Construction & Setup | [Fw Declaring Avatar](01-deck-construction/rule-1.37-fw-declaring-avatar.test.ts) | ☐ |
| 1.38 | Deck Construction & Setup | [Character Draft](01-deck-construction/rule-1.38-character-draft.test.ts) | ☐ |
| 1.39 | Deck Construction & Setup | [Draft Site Requirement](01-deck-construction/rule-1.39-draft-site-requirement.test.ts) | ☐ |
| 1.40 | Deck Construction & Setup | [Minion Draft Six](01-deck-construction/rule-1.40-minion-draft-six.test.ts) | ☐ |
| 1.41 | Deck Construction & Setup | [Minion Draft Agent Restriction](01-deck-construction/rule-1.41-minion-draft-agent-restriction.test.ts) | ☐ |
| 1.42 | Deck Construction & Setup | [Fw Draft Agent Restriction](01-deck-construction/rule-1.42-fw-draft-agent-restriction.test.ts) | ☐ |
| 1.43 | Deck Construction & Setup | [Fw Draft Orc Troll](01-deck-construction/rule-1.43-fw-draft-orc-troll.test.ts) | ☐ |
| 1.44 | Deck Construction & Setup | [Fw Draft Mind Restriction](01-deck-construction/rule-1.44-fw-draft-mind-restriction.test.ts) | ☐ |
| 1.45 | Deck Construction & Setup | [Fw Draft Stage Resources](01-deck-construction/rule-1.45-fw-draft-stage-resources.test.ts) | ☐ |
| 1.46 | Deck Construction & Setup | [Balrog Draft Six](01-deck-construction/rule-1.46-balrog-draft-six.test.ts) | ☐ |
| 1.47 | Deck Construction & Setup | [Starting Sites](01-deck-construction/rule-1.47-starting-sites.test.ts) | ☐ |
| 1.48 | Deck Construction & Setup | [Hero Starting Site](01-deck-construction/rule-1.48-hero-starting-site.test.ts) | ☐ |
| 1.49 | Deck Construction & Setup | [Minion Starting Sites](01-deck-construction/rule-1.49-minion-starting-sites.test.ts) | ☐ |
| 1.50 | Deck Construction & Setup | [Fw Starting Site](01-deck-construction/rule-1.50-fw-starting-site.test.ts) | ☐ |
| 1.51 | Deck Construction & Setup | [Balrog Starting Sites](01-deck-construction/rule-1.51-balrog-starting-sites.test.ts) | ☐ |
| 1.52 | Deck Construction & Setup | [Starting Hands](01-deck-construction/rule-1.52-starting-hands.test.ts) | ☐ |
| 1.53 | Deck Construction & Setup | [Hand Size Modifications](01-deck-construction/rule-1.53-hand-size-modifications.test.ts) | ☐ |
| 1.54 | Deck Construction & Setup | [Starting General Influence](01-deck-construction/rule-1.54-starting-general-influence.test.ts) | ☐ |
| 1.55 | Deck Construction & Setup | [Minion Extra Gi](01-deck-construction/rule-1.55-minion-extra-gi.test.ts) | ☐ |
| 1.56 | Deck Construction & Setup | [Balrog Extra Gi](01-deck-construction/rule-1.56-balrog-extra-gi.test.ts) | ☐ |
| 1.57 | Deck Construction & Setup | [Dice Rolling](01-deck-construction/rule-1.57-dice-rolling.test.ts) | ☐ |
| 1.58 | Deck Construction & Setup | [Determining First Player](01-deck-construction/rule-1.58-determining-first-player.test.ts) | ☐ |
| METD | Deck Construction & Setup | [Hoard Minor Starting Company](01-deck-construction/rule-metd-hoard-minor-starting-company.test.ts) | ☑ |
| 2.01 | Untap Phase | [Resource Hazard Roles](02-untap-phase/rule-2.01-resource-hazard-roles.test.ts) | ☑ |
| 2.02 | Untap Phase | [Resource Player Actions](02-untap-phase/rule-2.02-resource-player-actions.test.ts) | ☑ |
| 2.03 | Untap Phase | [Hazard Player Actions](02-untap-phase/rule-2.03-hazard-player-actions.test.ts) | ☑ |
| 2.04 | Untap Phase | [Uniqueness In Play](02-untap-phase/rule-2.04-uniqueness-in-play.test.ts) | ☑ |
| 2.05 | Untap Phase | [Avatar Eliminated](02-untap-phase/rule-2.05-avatar-eliminated.test.ts) | ☑ |
| 2.06 | Untap Phase | [Fw Avatar Leaves Play](02-untap-phase/rule-2.06-fw-avatar-leaves-play.test.ts) | ☐ |
| 2.07 | Untap Phase | [Company Loses All Characters](02-untap-phase/rule-2.07-company-loses-all-characters.test.ts) | ☐ |
| 2.08 | Untap Phase | [Play Deck Exhaustion](02-untap-phase/rule-2.08-play-deck-exhaustion.test.ts) | ◐ |
| 2.09 | Untap Phase | [Empty Play Deck And Discard](02-untap-phase/rule-2.09-empty-play-deck-and-discard.test.ts) | ☐ |
| 2.10 | Untap Phase | [No Mechanical Tracking](02-untap-phase/rule-2.10-no-mechanical-tracking.test.ts) | ☑ |
| 2.11 | Untap Phase | [Phase Transitions](02-untap-phase/rule-2.11-phase-transitions.test.ts) | ☑ |
| 2.12 | Untap Phase | [Untap Phase Rules](02-untap-phase/rule-2.12-untap-phase-rules.test.ts) | ☑ |
| 2.13 | Untap Phase | [Hazard Sideboard Access](02-untap-phase/rule-2.13-hazard-sideboard-access.test.ts) | ☑ |
| 3.01 | Organization Phase | [Organizing Declaration](03-organization-phase/rule-3.01-organizing-declaration.test.ts) | ☐ |
| 3.02 | Organization Phase | [Play Discard Character](03-organization-phase/rule-3.02-play-discard-character.test.ts) | ☑ |
| 3.03 | Organization Phase | [Avatar Play Location](03-organization-phase/rule-3.03-avatar-play-location.test.ts) | ☑ |
| 3.04 | Organization Phase | [Hero Avatar Location](03-organization-phase/rule-3.04-hero-avatar-location.test.ts) | ☐ |
| 3.05 | Organization Phase | [Minion Avatar Location](03-organization-phase/rule-3.05-minion-avatar-location.test.ts) | ☐ |
| 3.06 | Organization Phase | [Minion Ringwraith Play](03-organization-phase/rule-3.06-minion-ringwraith-play.test.ts) | ☐ |
| 3.07 | Organization Phase | [Ringwraith Company Composition](03-organization-phase/rule-3.07-ringwraith-company-composition.test.ts) | ☐ |
| 3.08 | Organization Phase | [Ringwraith Follower](03-organization-phase/rule-3.08-ringwraith-follower.test.ts) | ☐ |
| 3.09 | Organization Phase | [Fw Avatar Play](03-organization-phase/rule-3.09-fw-avatar-play.test.ts) | ☐ |
| 3.10 | Organization Phase | [Balrog Avatar Play](03-organization-phase/rule-3.10-balrog-avatar-play.test.ts) | ☐ |
| 3.11 | Organization Phase | [Non Avatar Character Play](03-organization-phase/rule-3.11-non-avatar-character-play.test.ts) | ☑ |
| 3.12 | Organization Phase | [Character Influence Control](03-organization-phase/rule-3.12-character-influence-control.test.ts) | ☐ |
| 3.13 | Organization Phase | [Follower Removed From Di](03-organization-phase/rule-3.13-follower-removed-from-di.test.ts) | ☐ |
| 3.14 | Organization Phase | [Restricted Direct Influence](03-organization-phase/rule-3.14-restricted-direct-influence.test.ts) | ☐ |
| 3.15 | Organization Phase | [Agent As Character](03-organization-phase/rule-3.15-agent-as-character.test.ts) | ☐ |
| 3.16 | Organization Phase | [Fw Character Mind Limit](03-organization-phase/rule-3.16-fw-character-mind-limit.test.ts) | ☐ |
| 3.17 | Organization Phase | [Fw Orc Troll Restriction](03-organization-phase/rule-3.17-fw-orc-troll-restriction.test.ts) | ☐ |
| 3.18 | Organization Phase | [Balrog Dark Hold Home](03-organization-phase/rule-3.18-balrog-dark-hold-home.test.ts) | ☐ |
| 3.19 | Organization Phase | [Balrog Extra Character](03-organization-phase/rule-3.19-balrog-extra-character.test.ts) | ☐ |
| 3.20 | Organization Phase | [Balrog Non Unique Source](03-organization-phase/rule-3.20-balrog-non-unique-source.test.ts) | ☐ |
| 3.21 | Organization Phase | [Character At New Site](03-organization-phase/rule-3.21-character-at-new-site.test.ts) | ☐ |
| 3.22 | Organization Phase | [Discarding Character](03-organization-phase/rule-3.22-discarding-character.test.ts) | ☐ |
| 3.23 | Organization Phase | [Company Composition](03-organization-phase/rule-3.23-company-composition.test.ts) | ☑ |
| 3.24 | Organization Phase | [Company Size Limits](03-organization-phase/rule-3.24-company-size-limits.test.ts) | ☐ |
| 3.25 | Organization Phase | [Race Mixing Restriction](03-organization-phase/rule-3.25-race-mixing-restriction.test.ts) | ☐ |
| 3.26 | Organization Phase | [Leader Restriction](03-organization-phase/rule-3.26-leader-restriction.test.ts) | ☐ |
| 3.27 | Organization Phase | [Move To Follower](03-organization-phase/rule-3.27-move-to-follower.test.ts) | ☐ |
| 3.28 | Organization Phase | [Move To Gi](03-organization-phase/rule-3.28-move-to-gi.test.ts) | ☐ |
| 3.29 | Organization Phase | [Move Between Companies](03-organization-phase/rule-3.29-move-between-companies.test.ts) | ☑ |
| 3.30 | Organization Phase | [Join Companies](03-organization-phase/rule-3.30-join-companies.test.ts) | ☑ |
| 3.31 | Organization Phase | [Split Companies](03-organization-phase/rule-3.31-split-companies.test.ts) | ☑ |
| 3.32 | Organization Phase | [Storing Cards](03-organization-phase/rule-3.32-storing-cards.test.ts) | ☐ |
| 3.33 | Organization Phase | [Fw Stored Stage](03-organization-phase/rule-3.33-fw-stored-stage.test.ts) | ☐ |
| 3.34 | Organization Phase | [Balrog No Store Barad Dur](03-organization-phase/rule-3.34-balrog-no-store-barad-dur.test.ts) | ☐ |
| 3.35 | Organization Phase | [Transferring Items](03-organization-phase/rule-3.35-transferring-items.test.ts) | ☐ |
| 3.36 | Organization Phase | [Avatar Sideboard Access](03-organization-phase/rule-3.36-avatar-sideboard-access.test.ts) | ☐ |
| 3.37 | Organization Phase | [Declaring Movement](03-organization-phase/rule-3.37-declaring-movement.test.ts) | ☐ |
| 3.38 | Organization Phase | [Same Destination Restriction](03-organization-phase/rule-3.38-same-destination-restriction.test.ts) | ☑ |
| 3.39 | Organization Phase | [Movement To Existing Site](03-organization-phase/rule-3.39-movement-to-existing-site.test.ts) | ☑ |
| 3.40 | Organization Phase | [Haven Movement](03-organization-phase/rule-3.40-haven-movement.test.ts) | ☐ |
| 3.41 | Organization Phase | [Ringwraith Movement](03-organization-phase/rule-3.41-ringwraith-movement.test.ts) | ☐ |
| 3.42 | Organization Phase | [Fw Site Usage](03-organization-phase/rule-3.42-fw-site-usage.test.ts) | ☐ |
| 3.43 | Organization Phase | [Starter Movement](03-organization-phase/rule-3.43-starter-movement.test.ts) | ☐ |
| 3.44 | Organization Phase | [Region Movement](03-organization-phase/rule-3.44-region-movement.test.ts) | ☐ |
| 3.45 | Organization Phase | [Under Deeps Movement](03-organization-phase/rule-3.45-under-deeps-movement.test.ts) | ☐ |
| 3.46 | Organization Phase | [Special Movement](03-organization-phase/rule-3.46-special-movement.test.ts) | ☐ |
| 3.47 | Organization Phase | [Influence Overflow](03-organization-phase/rule-3.47-influence-overflow.test.ts) | ☐ |
| 3.48 | Organization Phase | [Fw Discard Stage](03-organization-phase/rule-3.48-fw-discard-stage.test.ts) | ☐ |
| 4.01 | Long-Event Phase | [Discard Own Long Events](04-long-event-phase/rule-4.01-discard-own-long-events.test.ts) | ☑ |
| 4.02 | Long-Event Phase | [Play Resource Long Events](04-long-event-phase/rule-4.02-play-resource-long-events.test.ts) | ☑ |
| 4.03 | Long-Event Phase | [Discard Hazard Long Events](04-long-event-phase/rule-4.03-discard-hazard-long-events.test.ts) | ☑ |
| 5.01 | Movement/Hazard Phase | [Mh Phase Order](05-movement-hazard-phase/rule-5.01-mh-phase-order.test.ts) | ☐ |
| 5.02 | Movement/Hazard Phase | [Mh Step1 Reveal Site](05-movement-hazard-phase/rule-5.02-mh-step1-reveal-site.test.ts) | ☐ |
| 5.03 | Movement/Hazard Phase | [Under Deeps Roll](05-movement-hazard-phase/rule-5.03-under-deeps-roll.test.ts) | ☐ |
| 5.04 | Movement/Hazard Phase | [Illegal Movement](05-movement-hazard-phase/rule-5.04-illegal-movement.test.ts) | ☐ |
| 5.05 | Movement/Hazard Phase | [Mh Passive Conditions](05-movement-hazard-phase/rule-5.05-mh-passive-conditions.test.ts) | ☐ |
| 5.06 | Movement/Hazard Phase | [Mh Step2 Site Path](05-movement-hazard-phase/rule-5.06-mh-step2-site-path.test.ts) | ☐ |
| 5.07 | Movement/Hazard Phase | [Non Moving Company Site Path](05-movement-hazard-phase/rule-5.07-non-moving-company-site-path.test.ts) | ☐ |
| 5.08 | Movement/Hazard Phase | [Changed New Site](05-movement-hazard-phase/rule-5.08-changed-new-site.test.ts) | ☐ |
| 5.09 | Movement/Hazard Phase | [Region Modification Effects](05-movement-hazard-phase/rule-5.09-region-modification-effects.test.ts) | ☐ |
| 5.10 | Movement/Hazard Phase | [Mh Step3 Hazard Limit](05-movement-hazard-phase/rule-5.10-mh-step3-hazard-limit.test.ts) | ☐ |
| 5.11 | Movement/Hazard Phase | [Hazard Limit Active Condition](05-movement-hazard-phase/rule-5.11-hazard-limit-active-condition.test.ts) | ☐ |
| 5.12 | Movement/Hazard Phase | [Mh Step4 Ongoing Effects](05-movement-hazard-phase/rule-5.12-mh-step4-ongoing-effects.test.ts) | ☐ |
| 5.13 | Movement/Hazard Phase | [Mh Step5 Draw Cards](05-movement-hazard-phase/rule-5.13-mh-step5-draw-cards.test.ts) | ☐ |
| 5.14 | Movement/Hazard Phase | [Fw Draw Cards](05-movement-hazard-phase/rule-5.14-fw-draw-cards.test.ts) | ☐ |
| 5.15 | Movement/Hazard Phase | [Mh Step6 Passive Conditions](05-movement-hazard-phase/rule-5.15-mh-step6-passive-conditions.test.ts) | ☐ |
| 5.16 | Movement/Hazard Phase | [Mh Step7 Play Hazards](05-movement-hazard-phase/rule-5.16-mh-step7-play-hazards.test.ts) | ☐ |
| 5.17 | Movement/Hazard Phase | [Playing Agent Hazard](05-movement-hazard-phase/rule-5.17-playing-agent-hazard.test.ts) | ☐ |
| 5.18 | Movement/Hazard Phase | [Playing Creature](05-movement-hazard-phase/rule-5.18-playing-creature.test.ts) | ☐ |
| 5.19 | Movement/Hazard Phase | [Creature Resolves Combat](05-movement-hazard-phase/rule-5.19-creature-resolves-combat.test.ts) | ☐ |
| 5.20 | Movement/Hazard Phase | [Creature Keying Equivalence](05-movement-hazard-phase/rule-5.20-creature-keying-equivalence.test.ts) | ☐ |
| 5.21 | Movement/Hazard Phase | [Multi Attack Creature Key](05-movement-hazard-phase/rule-5.21-multi-attack-creature-key.test.ts) | ☐ |
| 5.22 | Movement/Hazard Phase | [Playing Event Hazard](05-movement-hazard-phase/rule-5.22-playing-event-hazard.test.ts) | ☐ |
| 5.23 | Movement/Hazard Phase | [On Guard Card](05-movement-hazard-phase/rule-5.23-on-guard-card.test.ts) | ☑ |
| 5.24 | Movement/Hazard Phase | [Sideboarding Nazgul](05-movement-hazard-phase/rule-5.24-sideboarding-nazgul.test.ts) | ☐ |
| 5.25 | Movement/Hazard Phase | [Fw Covert Overt Hazards](05-movement-hazard-phase/rule-5.25-fw-covert-overt-hazards.test.ts) | ☐ |
| 5.26 | Movement/Hazard Phase | [Mh Step8 End Phase](05-movement-hazard-phase/rule-5.26-mh-step8-end-phase.test.ts) | ◐ |
| 5.27 | Movement/Hazard Phase | [Hazard Player Resume](05-movement-hazard-phase/rule-5.27-hazard-player-resume.test.ts) | ☐ |
| 5.28 | Movement/Hazard Phase | [No Companies Skip Mh](05-movement-hazard-phase/rule-5.28-no-companies-skip-mh.test.ts) | ☐ |
| 5.29 | Movement/Hazard Phase | [Other Company Actions](05-movement-hazard-phase/rule-5.29-other-company-actions.test.ts) | ☐ |
| 5.30 | Movement/Hazard Phase | [Multiple Movements](05-movement-hazard-phase/rule-5.30-multiple-movements.test.ts) | ☐ |
| 5.31 | Movement/Hazard Phase | [Returned To Origin](05-movement-hazard-phase/rule-5.31-returned-to-origin.test.ts) | ☐ |
| 5.32 | Movement/Hazard Phase | [Company At Site](05-movement-hazard-phase/rule-5.32-company-at-site.test.ts) | ☐ |
| 5.33 | Movement/Hazard Phase | [Joining After Mh](05-movement-hazard-phase/rule-5.33-joining-after-mh.test.ts) | ☑ |
| METD | Movement/Hazard Phase | [Hazard Limit Lock](05-movement-hazard-phase/rule-metd-hazard-limit-lock.test.ts) | ☑ |
| 6.01 | Site Phase | [Site Phase Order](06-site-phase/rule-6.01-site-phase-order.test.ts) | ☐ |
| 6.02 | Site Phase | [Revealing On Guard Attacks](06-site-phase/rule-6.02-revealing-on-guard-attacks.test.ts) | ☑ |
| 6.03 | Site Phase | [Automatic Attacks](06-site-phase/rule-6.03-automatic-attacks.test.ts) | ☐ |
| 6.04 | Site Phase | [Auto Attack Hazard Creature](06-site-phase/rule-6.04-auto-attack-hazard-creature.test.ts) | ☐ |
| 6.05 | Site Phase | [Cancel Auto Attack](06-site-phase/rule-6.05-cancel-auto-attack.test.ts) | ☐ |
| 6.06 | Site Phase | [Auto Attack Site Leaves](06-site-phase/rule-6.06-auto-attack-site-leaves.test.ts) | ☐ |
| 6.07 | Site Phase | [Agent Attacks At Site](06-site-phase/rule-6.07-agent-attacks-at-site.test.ts) | ☐ |
| 6.08 | Site Phase | [Resolve On Guard Agent Attacks](06-site-phase/rule-6.08-resolve-on-guard-agent-attacks.test.ts) | ☐ |
| 6.09 | Site Phase | [Playing Resources At Site](06-site-phase/rule-6.09-playing-resources-at-site.test.ts) | ☑ |
| 6.10 | Site Phase | [Playing Ally](06-site-phase/rule-6.10-playing-ally.test.ts) | ☐ |
| 6.11 | Site Phase | [Playing Faction](06-site-phase/rule-6.11-playing-faction.test.ts) | ☐ |
| 6.12 | Site Phase | [Playing Item](06-site-phase/rule-6.12-playing-item.test.ts) | ☐ |
| 6.13 | Site Phase | [Additional Minor Item](06-site-phase/rule-6.13-additional-minor-item.test.ts) | ☑ |
| 6.14 | Site Phase | [On Guard Reveal At Resource](06-site-phase/rule-6.14-on-guard-reveal-at-resource.test.ts) | ☑ |
| 6.15 | Site Phase | [On Guard Restrictions](06-site-phase/rule-6.15-on-guard-restrictions.test.ts) | ☐ |
| 6.16 | Site Phase | [On Guard Chain Of Effects](06-site-phase/rule-6.16-on-guard-chain-of-effects.test.ts) | ☑ |
| 6.17 | Site Phase | [No Companies Skip Site](06-site-phase/rule-6.17-no-companies-skip-site.test.ts) | ☐ |
| 6.18 | Site Phase | [Untap Site Restriction](06-site-phase/rule-6.18-untap-site-restriction.test.ts) | ☐ |
| 6.19 | Site Phase | [Other Company Site Actions](06-site-phase/rule-6.19-other-company-site-actions.test.ts) | ☐ |
| 6.20 | Site Phase | [End Of Site Phase](06-site-phase/rule-6.20-end-of-site-phase.test.ts) | ☐ |
| 6.21 | Site Phase | [Fw Resource Alignment Match](06-site-phase/rule-6.21-fw-resource-alignment-match.test.ts) | ☐ |
| 7.01 | End-of-Turn Phase | [Eot Steps](07-end-of-turn-phase/rule-7.01-eot-steps.test.ts) | ☑ |
| 7.02 | End-of-Turn Phase | [Eot Site Replacement](07-end-of-turn-phase/rule-7.02-eot-site-replacement.test.ts) | ☐ |
| 8.01 | Combat | [Combat Initiation](08-combat/rule-8.01-combat-initiation.test.ts) | ☐ |
| 8.02 | Combat | [Combat Step1 Pre Assignment](08-combat/rule-8.02-combat-step1-pre-assignment.test.ts) | ☐ |
| 8.03 | Combat | [Faced Attack](08-combat/rule-8.03-faced-attack.test.ts) | ☐ |
| 8.04 | Combat | [Attack Modification Rules](08-combat/rule-8.04-attack-modification-rules.test.ts) | ☐ |
| 8.05 | Combat | [Multiple Strikes Assignment](08-combat/rule-8.05-multiple-strikes-assignment.test.ts) | ☐ |
| 8.06 | Combat | [Combat Step2 Defender Assigns](08-combat/rule-8.06-combat-step2-defender-assigns.test.ts) | ☑ |
| 8.07 | Combat | [Each Character Faces Strike](08-combat/rule-8.07-each-character-faces-strike.test.ts) | ☐ |
| 8.08 | Combat | [Strike Assignment Precedence](08-combat/rule-8.08-strike-assignment-precedence.test.ts) | ☐ |
| 8.09 | Combat | [Agent Attack Assignment](08-combat/rule-8.09-agent-attack-assignment.test.ts) | ☐ |
| 8.10 | Combat | [Combat Step3 Opponent Assigns](08-combat/rule-8.10-combat-step3-opponent-assigns.test.ts) | ☐ |
| 8.11 | Combat | [Combat Step4 Strike Sequences](08-combat/rule-8.11-combat-step4-strike-sequences.test.ts) | ☐ |
| 8.12 | Combat | [Ss Step1 Attacker Actions](08-combat/rule-8.12-ss-step1-attacker-actions.test.ts) | ☐ |
| 8.13 | Combat | [Ss Step2 Excess Strikes](08-combat/rule-8.13-ss-step2-excess-strikes.test.ts) | ☐ |
| 8.14 | Combat | [Ss Step3 Minus3 Untapped](08-combat/rule-8.14-ss-step3-minus3-untapped.test.ts) | ☐ |
| 8.15 | Combat | [Ss Step4 Tap Support](08-combat/rule-8.15-ss-step4-tap-support.test.ts) | ☑ |
| 8.16 | Combat | [Ss Step5 Defender Actions](08-combat/rule-8.16-ss-step5-defender-actions.test.ts) | ☐ |
| 8.17 | Combat | [Ss Step6 Roll](08-combat/rule-8.17-ss-step6-roll.test.ts) | ☐ |
| 8.18 | Combat | [Agent Attack Rolls](08-combat/rule-8.18-agent-attack-rolls.test.ts) | ☐ |
| 8.19 | Combat | [Ss Step7 Resolve Strike](08-combat/rule-8.19-ss-step7-resolve-strike.test.ts) | ☐ |
| 8.20 | Combat | [Strike Passive Conditions](08-combat/rule-8.20-strike-passive-conditions.test.ts) | ☐ |
| 8.21 | Combat | [Combat Step5 Resolve Attack](08-combat/rule-8.21-combat-step5-resolve-attack.test.ts) | ☐ |
| 8.22 | Combat | [Creature Mp By Alignment](08-combat/rule-8.22-creature-mp-by-alignment.test.ts) | ☐ |
| 8.23 | Combat | [Attack As Action](08-combat/rule-8.23-attack-as-action.test.ts) | ☐ |
| 8.24 | Combat | [Combat In Chain](08-combat/rule-8.24-combat-in-chain.test.ts) | ☐ |
| 8.25 | Combat | [Defender No Actions](08-combat/rule-8.25-defender-no-actions.test.ts) | ☐ |
| 8.26 | Combat | [Company Check At Attack](08-combat/rule-8.26-company-check-at-attack.test.ts) | ☐ |
| 8.27 | Combat | [No Return During Attack](08-combat/rule-8.27-no-return-during-attack.test.ts) | ☐ |
| 8.28 | Combat | [Body Check](08-combat/rule-8.28-body-check.test.ts) | ☑ |
| 8.29 | Combat | [Ringwraith Body Check](08-combat/rule-8.29-ringwraith-body-check.test.ts) | ☐ |
| 8.30 | Combat | [Character Eliminated](08-combat/rule-8.30-character-eliminated.test.ts) | ☑ |
| 8.31 | Combat | [Orc Troll Body Check](08-combat/rule-8.31-orc-troll-body-check.test.ts) | ☐ |
| 8.32 | Combat | [Detainment Attacks](08-combat/rule-8.32-detainment-attacks.test.ts) | ☑ |
| 8.33 | Combat | [Minion Detainment Rules](08-combat/rule-8.33-minion-detainment-rules.test.ts) | ☑ |
| 8.34 | Combat | [Detainment Creature Mp](08-combat/rule-8.34-detainment-creature-mp.test.ts) | ☐ |
| 8.35 | Combat | [Prisoners](08-combat/rule-8.35-prisoners.test.ts) | ☐ |
| 8.36 | Combat | [Rescuing Prisoners](08-combat/rule-8.36-rescuing-prisoners.test.ts) | ☐ |
| 8.37 | Combat | [Trophies](08-combat/rule-8.37-trophies.test.ts) | ☐ |
| 8.38 | Combat | [Cvcc Rules](08-combat/rule-8.38-cvcc-rules.test.ts) | ☐ |
| 8.39 | Combat | [Cvcc Strike Sequence](08-combat/rule-8.39-cvcc-strike-sequence.test.ts) | ☐ |
| 8.40 | Combat | [Cvcc Initiation](08-combat/rule-8.40-cvcc-initiation.test.ts) | ☐ |
| 8.41 | Combat | [Cvcc Alignment Restrictions](08-combat/rule-8.41-cvcc-alignment-restrictions.test.ts) | ☐ |
| 8.42 | Combat | [Cvcc Hazard Restrictions](08-combat/rule-8.42-cvcc-hazard-restrictions.test.ts) | ☐ |
| 9.01 | Agents, Events, Items & Rings | [Agent Actions](09-agents-events-items/rule-9.01-agent-actions.test.ts) | ☐ |
| 9.02 | Agents, Events, Items & Rings | [Agent Action Options](09-agents-events-items/rule-9.02-agent-action-options.test.ts) | ☐ |
| 9.03 | Agents, Events, Items & Rings | [Agent Reveal](09-agents-events-items/rule-9.03-agent-reveal.test.ts) | ☐ |
| 9.04 | Agents, Events, Items & Rings | [Agent Reveal Home](09-agents-events-items/rule-9.04-agent-reveal-home.test.ts) | ☐ |
| 9.05 | Agents, Events, Items & Rings | [Agent Uniqueness](09-agents-events-items/rule-9.05-agent-uniqueness.test.ts) | ☐ |
| 9.06 | Agents, Events, Items & Rings | [Agent Tapped Effect](09-agents-events-items/rule-9.06-agent-tapped-effect.test.ts) | ☐ |
| 9.07 | Agents, Events, Items & Rings | [Agent Haven Restriction](09-agents-events-items/rule-9.07-agent-haven-restriction.test.ts) | ☐ |
| 9.08 | Agents, Events, Items & Rings | [Agent Alignment Movement](09-agents-events-items/rule-9.08-agent-alignment-movement.test.ts) | ☐ |
| 9.09 | Agents, Events, Items & Rings | [Short Events](09-agents-events-items/rule-9.09-short-events.test.ts) | ☐ |
| 9.10 | Agents, Events, Items & Rings | [Short Event No Effect](09-agents-events-items/rule-9.10-short-event-no-effect.test.ts) | ☐ |
| 9.11 | Agents, Events, Items & Rings | [Short Event Duplication](09-agents-events-items/rule-9.11-short-event-duplication.test.ts) | ☐ |
| 9.12 | Agents, Events, Items & Rings | [Long Events](09-agents-events-items/rule-9.12-long-events.test.ts) | ☐ |
| 9.13 | Agents, Events, Items & Rings | [Permanent Events](09-agents-events-items/rule-9.13-permanent-events.test.ts) | ☐ |
| 9.14 | Agents, Events, Items & Rings | [Fw Stage Event Rules](09-agents-events-items/rule-9.14-fw-stage-event-rules.test.ts) | ☐ |
| 9.15 | Agents, Events, Items & Rings | [Item Usage](09-agents-events-items/rule-9.15-item-usage.test.ts) | ☑ |
| 9.16 | Agents, Events, Items & Rings | [Switching Items](09-agents-events-items/rule-9.16-switching-items.test.ts) | ☐ |
| 9.17 | Agents, Events, Items & Rings | [Item Modification Order](09-agents-events-items/rule-9.17-item-modification-order.test.ts) | ☐ |
| 9.18 | Agents, Events, Items & Rings | [Item Movement Restrictions](09-agents-events-items/rule-9.18-item-movement-restrictions.test.ts) | ☐ |
| 9.19 | Agents, Events, Items & Rings | [Ally Item Restriction](09-agents-events-items/rule-9.19-ally-item-restriction.test.ts) | ☐ |
| 9.20 | Agents, Events, Items & Rings | [Alignment Item Usage](09-agents-events-items/rule-9.20-alignment-item-usage.test.ts) | ☐ |
| 9.21 | Agents, Events, Items & Rings | [Gold Ring Test](09-agents-events-items/rule-9.21-gold-ring-test.test.ts) | ☐ |
| 9.22 | Agents, Events, Items & Rings | [Gold Ring Darkhaven Test](09-agents-events-items/rule-9.22-gold-ring-darkhaven-test.test.ts) | ☐ |
| 9.23 | Agents, Events, Items & Rings | [Gold Ring Ringwraith Test](09-agents-events-items/rule-9.23-gold-ring-ringwraith-test.test.ts) | ☐ |
| METD | Agents, Events, Items & Rings | [Check Kinds](09-agents-events-items/rule-metd-check-kinds.test.ts) | ☑ |
| METD | Agents, Events, Items & Rings | [Dragon At Home](09-agents-events-items/rule-metd-dragon-at-home.test.ts) | ☑ |
| METD | Agents, Events, Items & Rings | [Dragon Cascade](09-agents-events-items/rule-metd-dragon-cascade.test.ts) | ☑ |
| METD | Agents, Events, Items & Rings | [Dragon Manifestations](09-agents-events-items/rule-metd-dragon-manifestations.test.ts) | ☑ |
| METD | Agents, Events, Items & Rings | [Dragon Mp Attribution](09-agents-events-items/rule-metd-dragon-mp-attribution.test.ts) | ☑ |
| METD | Agents, Events, Items & Rings | [Hoard Item Play Site](09-agents-events-items/rule-metd-hoard-item-play-site.test.ts) | ☑ |
| 10.01 | Corruption, Influence, Actions/Timing & Ending the Game | [Corruption Check](10-corruption-influence-endgame/rule-10.01-corruption-check.test.ts) | ☐ |
| 10.02 | Corruption, Influence, Actions/Timing & Ending the Game | [Corruption Check Support](10-corruption-influence-endgame/rule-10.02-corruption-check-support.test.ts) | ☐ |
| 10.03 | Corruption, Influence, Actions/Timing & Ending the Game | [Corruption Check Zero](10-corruption-influence-endgame/rule-10.03-corruption-check-zero.test.ts) | ☐ |
| 10.04 | Corruption, Influence, Actions/Timing & Ending the Game | [Corruption Check Prevent Discard](10-corruption-influence-endgame/rule-10.04-corruption-check-prevent-discard.test.ts) | ☐ |
| 10.05 | Corruption, Influence, Actions/Timing & Ending the Game | [Ringwraith Corruption Bonus](10-corruption-influence-endgame/rule-10.05-ringwraith-corruption-bonus.test.ts) | ☐ |
| 10.06 | Corruption, Influence, Actions/Timing & Ending the Game | [Fw Orc Troll Corruption](10-corruption-influence-endgame/rule-10.06-fw-orc-troll-corruption.test.ts) | ☐ |
| 10.07 | Corruption, Influence, Actions/Timing & Ending the Game | [Corruption Cards](10-corruption-influence-endgame/rule-10.07-corruption-cards.test.ts) | ☑ |
| 10.08 | Corruption, Influence, Actions/Timing & Ending the Game | [Removing Corruption Cards](10-corruption-influence-endgame/rule-10.08-removing-corruption-cards.test.ts) | ☑ |
| 10.09 | Corruption, Influence, Actions/Timing & Ending the Game | [Corruption Immunity](10-corruption-influence-endgame/rule-10.09-corruption-immunity.test.ts) | ☐ |
| 10.10 | Corruption, Influence, Actions/Timing & Ending the Game | [Influence Attempt Declaration](10-corruption-influence-endgame/rule-10.10-influence-attempt-declaration.test.ts) | ☑ |
| 10.11 | Corruption, Influence, Actions/Timing & Ending the Game | [Influence Attempt Targets](10-corruption-influence-endgame/rule-10.11-influence-attempt-targets.test.ts) | ◐ |
| 10.12 | Corruption, Influence, Actions/Timing & Ending the Game | [Influence Attempt Resolution](10-corruption-influence-endgame/rule-10.12-influence-attempt-resolution.test.ts) | ☑ |
| 10.13 | Corruption, Influence, Actions/Timing & Ending the Game | [Influence Success Play](10-corruption-influence-endgame/rule-10.13-influence-success-play.test.ts) | ☐ |
| 10.14 | Corruption, Influence, Actions/Timing & Ending the Game | [Agent Influence](10-corruption-influence-endgame/rule-10.14-agent-influence.test.ts) | ☐ |
| 10.15 | Corruption, Influence, Actions/Timing & Ending the Game | [Cross Alignment Influence](10-corruption-influence-endgame/rule-10.15-cross-alignment-influence.test.ts) | ☑ |
| 10.16 | Corruption, Influence, Actions/Timing & Ending the Game | [Fw Influence Alignment Match](10-corruption-influence-endgame/rule-10.16-fw-influence-alignment-match.test.ts) | ☐ |
| 10.17 | Corruption, Influence, Actions/Timing & Ending the Game | [Actions Definition](10-corruption-influence-endgame/rule-10.17-actions-definition.test.ts) | ☐ |
| 10.18 | Corruption, Influence, Actions/Timing & Ending the Game | [Resource Hazard Action Types](10-corruption-influence-endgame/rule-10.18-resource-hazard-action-types.test.ts) | ☐ |
| 10.19 | Corruption, Influence, Actions/Timing & Ending the Game | [Optional Effects](10-corruption-influence-endgame/rule-10.19-optional-effects.test.ts) | ☐ |
| 10.20 | Corruption, Influence, Actions/Timing & Ending the Game | [Rule Changes Not Actions](10-corruption-influence-endgame/rule-10.20-rule-changes-not-actions.test.ts) | ☐ |
| 10.21 | Corruption, Influence, Actions/Timing & Ending the Game | [Active Conditions](10-corruption-influence-endgame/rule-10.21-active-conditions.test.ts) | ☐ |
| 10.22 | Corruption, Influence, Actions/Timing & Ending the Game | [Alternative Effects](10-corruption-influence-endgame/rule-10.22-alternative-effects.test.ts) | ☐ |
| 10.23 | Corruption, Influence, Actions/Timing & Ending the Game | [Tap Discard Active Conditions](10-corruption-influence-endgame/rule-10.23-tap-discard-active-conditions.test.ts) | ☐ |
| 10.24 | Corruption, Influence, Actions/Timing & Ending the Game | [Targeting Rules](10-corruption-influence-endgame/rule-10.24-targeting-rules.test.ts) | ☐ |
| 10.25 | Corruption, Influence, Actions/Timing & Ending the Game | [Auto Attack Targeting](10-corruption-influence-endgame/rule-10.25-auto-attack-targeting.test.ts) | ☐ |
| 10.26 | Corruption, Influence, Actions/Timing & Ending the Game | [Cross Player Targeting](10-corruption-influence-endgame/rule-10.26-cross-player-targeting.test.ts) | ☐ |
| 10.27 | Corruption, Influence, Actions/Timing & Ending the Game | [Fw Targeting Rules](10-corruption-influence-endgame/rule-10.27-fw-targeting-rules.test.ts) | ☐ |
| 10.28 | Corruption, Influence, Actions/Timing & Ending the Game | [Effects Definition](10-corruption-influence-endgame/rule-10.28-effects-definition.test.ts) | ☐ |
| 10.29 | Corruption, Influence, Actions/Timing & Ending the Game | [Chain Of Effects](10-corruption-influence-endgame/rule-10.29-chain-of-effects.test.ts) | ◐ |
| 10.30 | Corruption, Influence, Actions/Timing & Ending the Game | [Multiple Actions On Card](10-corruption-influence-endgame/rule-10.30-multiple-actions-on-card.test.ts) | ☐ |
| 10.31 | Corruption, Influence, Actions/Timing & Ending the Game | [Passive Conditions](10-corruption-influence-endgame/rule-10.31-passive-conditions.test.ts) | ☐ |
| 10.32 | Corruption, Influence, Actions/Timing & Ending the Game | [Passive Condition Discard](10-corruption-influence-endgame/rule-10.32-passive-condition-discard.test.ts) | ☐ |
| 10.33 | Corruption, Influence, Actions/Timing & Ending the Game | [Beginning Of Phase Passives](10-corruption-influence-endgame/rule-10.33-beginning-of-phase-passives.test.ts) | ☐ |
| 10.34 | Corruption, Influence, Actions/Timing & Ending the Game | [End Of Phase Passives](10-corruption-influence-endgame/rule-10.34-end-of-phase-passives.test.ts) | ☐ |
| 10.35 | Corruption, Influence, Actions/Timing & Ending the Game | [Duplicate Passive Conditions](10-corruption-influence-endgame/rule-10.35-duplicate-passive-conditions.test.ts) | ☐ |
| 10.36 | Corruption, Influence, Actions/Timing & Ending the Game | [Attribute Modification Passives](10-corruption-influence-endgame/rule-10.36-attribute-modification-passives.test.ts) | ☐ |
| 10.37 | Corruption, Influence, Actions/Timing & Ending the Game | [Game Condition Inactive](10-corruption-influence-endgame/rule-10.37-game-condition-inactive.test.ts) | ☐ |
| 10.38 | Corruption, Influence, Actions/Timing & Ending the Game | [Cards No Memory](10-corruption-influence-endgame/rule-10.38-cards-no-memory.test.ts) | ☐ |
| 10.39 | Corruption, Influence, Actions/Timing & Ending the Game | [Winning With One Ring](10-corruption-influence-endgame/rule-10.39-winning-with-one-ring.test.ts) | ☐ |
| 10.40 | Corruption, Influence, Actions/Timing & Ending the Game | [Calling The Game](10-corruption-influence-endgame/rule-10.40-calling-the-game.test.ts) | ☐ |
| 10.41 | Corruption, Influence, Actions/Timing & Ending the Game | [Minion Balrog Sudden Call](10-corruption-influence-endgame/rule-10.41-minion-balrog-sudden-call.test.ts) | ☑ |
| 10.42 | Corruption, Influence, Actions/Timing & Ending the Game | [Balrog Under Deeps Mp](10-corruption-influence-endgame/rule-10.42-balrog-under-deeps-mp.test.ts) | ☐ |
| 10.43 | Corruption, Influence, Actions/Timing & Ending the Game | [Free Council](10-corruption-influence-endgame/rule-10.43-free-council.test.ts) | ☐ |
| 10.44 | Corruption, Influence, Actions/Timing & Ending the Game | [Winner Step1 Corruption](10-corruption-influence-endgame/rule-10.44-winner-step1-corruption.test.ts) | ☐ |
| 10.45 | Corruption, Influence, Actions/Timing & Ending the Game | [Winner Step2 Total Mp](10-corruption-influence-endgame/rule-10.45-winner-step2-total-mp.test.ts) | ☐ |
| 10.46 | Corruption, Influence, Actions/Timing & Ending the Game | [Winner Step3 Doubling](10-corruption-influence-endgame/rule-10.46-winner-step3-doubling.test.ts) | ☐ |
| 10.47 | Corruption, Influence, Actions/Timing & Ending the Game | [Winner Step4 Half Rule](10-corruption-influence-endgame/rule-10.47-winner-step4-half-rule.test.ts) | ☐ |
| 10.48 | Corruption, Influence, Actions/Timing & Ending the Game | [Winner Step5 Duplicates](10-corruption-influence-endgame/rule-10.48-winner-step5-duplicates.test.ts) | ☐ |
| 10.49 | Corruption, Influence, Actions/Timing & Ending the Game | [Winner Step6 Avatar Penalty](10-corruption-influence-endgame/rule-10.49-winner-step6-avatar-penalty.test.ts) | ☐ |
| 10.50 | Corruption, Influence, Actions/Timing & Ending the Game | [Winner Step7 Compare](10-corruption-influence-endgame/rule-10.50-winner-step7-compare.test.ts) | ☐ |
| 10.51 | Corruption, Influence, Actions/Timing & Ending the Game | [Mp General Rules](10-corruption-influence-endgame/rule-10.51-mp-general-rules.test.ts) | ☐ |
| 10.52 | Corruption, Influence, Actions/Timing & Ending the Game | [Alignment Item Mp](10-corruption-influence-endgame/rule-10.52-alignment-item-mp.test.ts) | ☐ |
| METD | Corruption, Influence, Actions/Timing & Ending the Game | [Corruption No Tap](10-corruption-influence-endgame/rule-metd-corruption-no-tap.test.ts) | ☑ |

---
*Legend: ☐ = todo, ☑ = implemented, ◐ = partial*
