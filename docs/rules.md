# MECCG Rules Reference

This document summarizes the core rules of the Middle-Earth Collectible Card Game (MECCG) by Iron Crown Enterprises (ICE), as relevant to this digital implementation.

## Game Objective

Each player takes on the role of a **Wizard** (Gandalf, Saruman, Radagast, Alatar, or Pallando). The goal is to accumulate **marshalling points (MPs)** by gathering allies, items, factions, and defeating enemies, then have the most MPs when the **Free Council** is called.

## Card Types

- **Characters** — Named individuals from Middle-earth. Stats: prowess, body, mind, direct influence, race, skills, marshalling points, corruption modifier.
- **Resources** — Beneficial cards played on the active player's turn.
  - Items (minor, major, greater, gold ring, special)
  - Factions — peoples/armies recruited via influence attempts
  - Allies — individual helpers attached to a company
  - Events (short-event, long-event, permanent-event)
- **Hazards** — Cards played by the opponent during the active player's movement phase.
  - Creatures — monsters that attack companies en route
  - Events (short-event, long-event, permanent-event)
  - Corruption cards — add corruption points to characters
- **Sites & Regions**
  - Region cards — geographic areas of Middle-earth; companies travel through sequences of regions
  - Site cards — specific locations to visit. Types: Haven, Free-hold, Border-hold, Ruins & Lairs, Shadow-hold, Dark-hold. Each site has an automatic attack, a site path, and lists playable resource types.

## Deck Construction

- **Play deck**: minimum 30 resource cards + 30 hazard cards, shuffled together. At least 12 creatures in the hazard portion. Max 3 copies of any card (1 for unique characters).
- **Site deck**: separate collection of site and region cards (not shuffled into the play deck).
- **Sideboard**: 15–30 extra cards accessible via special mechanics (e.g. tapping a Wizard).
- **Starting company**: characters placed at a Haven (typically Rivendell) at game start. The Wizard does not need to start in play.

## Turn Structure

1. **Untap Phase** — Refresh all tapped cards. Heal wounded characters at Havens.
2. **Organization Phase** — Assign characters to companies, split/merge companies, transfer items (requires corruption check), bring new characters into play at Havens, plan movement (place destination site face-down).
3. **Long-event Phase** — Resolve or remove long-events in play.
4. **Movement/Hazard Phase** — For each moving company:
   - Reveal the destination site.
   - Opponent plays hazard cards (creatures, events, corruption) against the company.
   - **Hazard limit** = company size (minimum 2).
   - Creatures must be **keyed** to the company's site path (matching region types or named regions).
   - Non-moving companies still have a movement/hazard phase (hazard limit 2).
5. **Site Phase** — For each company at a site:
   - Face any **automatic attacks**.
   - Play one resource appropriate to the site type (taps the site).
   - One additional character may tap to play a **minor item** for free.
   - Factions require an **influence attempt** (2d6 + direct influence vs. faction number).
6. **End-of-Turn Phase** — Draw or discard to hand size of 8.

## Movement

Two methods:

- **Starter movement** — Follow the **site path** printed on the destination card (region type icons). Typically requires returning to a Haven between non-Haven sites.
- **Region movement** — Lay out up to **4 region cards** connecting origin to destination. More flexible but exposes the company to hazards keyed to each named region.

**Havens** (Rivendell, Lorien, Grey Havens, Edhellond) are safe locations for healing, reorganization, and bringing new characters into play.

## Combat

### Hazard Play
- Opponent plays creature and event hazards during the Movement/Hazard phase.
- Creatures must be keyed to the site path.
- Hazard limit caps how many hazards can target a single company.

### Strike Resolution
- Each creature has a number of **strikes** and a **prowess** value.
- Strikes are assigned to characters (defender chooses first, attacker assigns remainder).
- Character prowess modifiers:
  - Untapped, choosing to tap: no penalty
  - Untapped, staying untapped: **−3 prowess**
  - Already tapped: **−1 prowess**
  - Wounded: **−2 prowess**
  - Untapped character not targeted may tap to give **+1 prowess** to another defender
- **Roll**: Defender rolls 2d6 + modified prowess.
  - Total > strike prowess → strike **fails** (defender wins)
  - Total ≤ strike prowess → character is **wounded**
- **Body check** (when wounded): Attacker rolls 2d6. If result > character's body → character **eliminated**.
- Defeating a creature can award **kill marshalling points**.

### Automatic Attacks
- Sites have built-in attacks faced before playing resources.
- Function like creature attacks but do not award marshalling points.

## Marshalling Points

Six categories:

| Category  | Source                    |
|-----------|---------------------------|
| Character | Characters in play        |
| Item      | Items on characters       |
| Faction   | Successfully recruited factions |
| Ally      | Allies in play            |
| Kill      | Defeated hazard creatures |
| Misc      | Special resource cards    |

### Scoring Rules
- **Doubling rule**: If your opponent has 0 or fewer MPs in any of the four categories (characters, items, factions, allies), you **double** your points in that category.
- **Diversity rule**: If more than half your total positive MPs come from a single category, that category is reduced to equal the sum of all other positive categories.

## Endgame: The Free Council

Triggered by:
- **Voluntary call**: When a player's play deck is exhausted for the **first time** and they have ≥25 MPs. Council convenes at end of opponent's next turn.
- **Automatic trigger**: When each player's deck has been exhausted **twice**. Council convenes at end of current turn.

At the Free Council:
1. Tally all marshalling points across six categories.
2. Apply diversity rule.
3. Apply doubling rule.
4. Player with the most MPs **wins**.
5. **Tiebreaker**: Each non-Wizard character gets +1 corruption and must make a corruption check. Recount MPs. If still tied, the game is a draw.

## Characters and Companies

### Characters
- Stats: prowess, body, mind, direct influence, race, skills, marshalling points, corruption modifier.
- **Unique** — only one copy of each named character can be in play across all players.

### Influence System
- Each player has **20 general influence** to control characters.
- Each character costs influence equal to their **mind** stat.
- Characters can also be controlled by another character's **direct influence** (becoming followers).
- The Wizard has high direct influence.

### Companies
- A group of characters traveling together.
- Company size determines the **hazard limit**.
- Companies at the same non-Haven site **must merge**.
- Companies can **split** during the Organization Phase at Havens.

## Corruption

Items and hazard cards add **corruption points** to characters, creating a risk/reward tension.

### Corruption Checks
Triggered by: transferring items, certain card effects, Free Council tiebreaker, hazard cards.

Roll **2d6** + character's corruption modifier:
- Roll **> corruption points** → safe
- Roll **= CP or CP−1** → character and all their items are **discarded** (removed from play)
- Roll **≤ CP−2** → character is **eliminated** and placed in opponent's MP pile (opponent gains those character MPs)
