# Player Guide

## Card Lifecycle

Not all cards in the game are fully playable yet. Each card goes through several stages before it works correctly:

1. **Created** — the card's data is defined (name, stats, card text). The card exists in the game but its special effects do nothing.
2. **Certified** — the AI verifies that every effect on the card is implemented and working. Certification costs credits and takes time. Only certified cards are considered reliable to play.
3. **Tested and tuned** — even after certification, edge cases may surface during real games. Bug reports drive further fixes until the card is fully playable in all situations.

You can see how many cards are created and certified in the project status table in the README. If a card you want to play behaves incorrectly, filing a bug report is the fastest way to get it fixed — it will usually be addressed and released in the next release.

## Deck Lifecycle

There are some sample decks marked with a star. Those are more or less considered stable. At least
they have been played successfully through complete game without any bug reports. If you are
using sample deck without a star or your own deck, i recommend running it versus any AI until
you can finish complete game without bug reports. Tell admins to mark it with the star if it is
a sample deck included.

## Reporting a Bug

Click the **bug icon** during a game to file a report. Bug reports can only be submitted from within an active game.

You do not need to describe the game situation. The AI has full access to the complete game log and state, so it already knows everything about what happened. Just describe what you observed or expected and let the AI figure out the context.

Good bug reports:

- "The hazard limit showed 2 but I counted 3 hazards played."
- "Gandalf's special ability did not trigger when expected."
- "The game froze after I clicked Enter Site."

You will receive a reply in your inbox once the report has been processed.

## Requesting a Feature

Open **Mail** from the lobby navigation and click the **Feature Request** button. Describe the feature as clearly as you can.

Processing flow:

1. The AI analyses the request, estimates effort, and creates a planning reply.
2. The admin reviews and either **approves** or **declines** it.
3. If approved, the AI schedules implementation and you receive a follow-up.

Feature requests are not guaranteed to be implemented, and implementation order is decided by the admin. You will be kept informed through replies in your inbox.

## Credits

Your credit balance is visible in the lobby navigation bar. Credits exist solely to cap unintended AI expenses — they are not a payment of any kind. Each bug report or feature request you submit costs a small number of credits when the AI processes it.

Credits replenish over time: after you spend them, your balance is topped up again automatically, so you can keep contributing.

## The Inbox

All replies from the AI and the server arrive in your **Inbox** (accessible from the lobby). Check the Sent tab to follow up on messages you have already submitted.

## Game Saving

Games are saved automatically. If you close the browser tab, lose your connection, or the server restarts, the game is preserved and resumes exactly where it left off when both players reconnect.

The save is deleted once the game ends and both players have seen the final result, so there is nothing to manage manually under normal circumstances.

If you need to save and restore a specific point in a game — for example, to replay a situation during testing — use the **Save / Load** options in the Developer Tools menu (see [Developer Mode](#developer-mode) below).

## Developer Mode

Because the game is still under active development, a **Developer Mode** is available for testers. Enable it in the **Settings** dialog (gear icon in the game toolbar).

When enabled it adds two extra tools to the toolbar:

- **Debug view** — a raw JSON dump of the full game state, useful for verifying card data and tracking down rule bugs.
- **Developer tools menu** — a set of testing aids:
  - *Undo* — step back one action
  - *Save / Load* — snapshot and restore the game state
  - *Reseed* — re-randomise the remaining deck order
  - *Cheat roll* — force the next dice result to a specific value
  - *Summon* — add any card directly to your hand
  - *Swap Hand* — swap hands between the two players

Settings also contains an **Auto-pass** toggle that automatically takes the only available action after a short delay, which speeds up solo testing.

## Pseudo-AI Mode

When starting a solo game, you can enable pseudo-AI mode. In this mode you control both sides: a separate panel appears so you can pick actions for the second player. This is useful for testing specific game situations without needing an opponent.

## Keyboard

There are keyboard shortcuts for many actions. To see them, press Shift.
