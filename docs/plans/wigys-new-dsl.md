DSL
===

Hard examples to go through: Alatar, Choking Shadows, Great Ship.

- All steps and things player can do are implemented using generic effects. Even basic engine running the game, just executes pre-defined DSL-expressions.

Generic Effect
--------------

`name` - universal id for particular effect type in game used also refer in other effects
       e.g. 'untap', 'play card', 'initiate attack'
       also card definition id is one universal effect which equals to playing the card
`ops` - a list of atomic operations happening as a part of it in definition order

Atomic Op
---------

`target-type` - e.g. 'character', 'item', 'hand card', 'site', 'attack', 'strike', 'roll'
`event`- situation where happening, e.g. 'play', 'enter', 'leave'
`filter` - after target is known, all entities of the type are collected from the game state
         then filter is applied, if defined
         each entity is evaluated versus the filter expression
`when` - expression when activated, by default immediately
`optional` - if true, player can voluntarily skip this
`cost` - a payment to be done to activate effect, if any.
         values are the same than in the `activity`
`activity` - 'transfer' actual card from one place to another
             'rotate' actual card orientation
             'reveal' actual card turn face up
             'hide' actual card turn face down
             'create' new non-card effect affecting the play (e.g. river, sun)
             'destroy' an existing effect affecting the play (e.g. cancel attack)
             'run' another generic effect by its name
(How to express roll or decision based branching?)

Transfer
--------

`source` - 'my deck', 'opp deck', 'my hand', 'company 1'
`selection-method` - 'top', 'bottom', 'choose', 'instance-id', 'card-id'
`destination` - 'company 2', 'my discard', 'character 1', 'my hand'
`count` - how many if anything else than 1

Queries
-------

All values that needs to be solved are done via queries to the game state.
The base value comes from the entity definition itself, but is escalated
to every higher level of ownership. For example permanent event on item has
a lookup chain

   permanent event -> item -> characer -> company -> player -> global

It also does the lookup to entities attached to it, for example

   company <- characters <- allies

The lookup scans from bottom to up, i.e. first entities owned by/belonging to
the entity queried.

Phases and Steps
----------------

The game is a series of phases, which are divided to steps. Some phases like
M/H and site may happen more than once. Also in the beginning and in the end
there are special phases 'setup' and 'free-council'. Then 'combat' is a special
phase initiated by the gameflow, which is inserted in between the normal flow.

Data is always organized so that the current player is player 0 and hazard
player is player 1. Their data is physically swapped between turns to make
rule expression construction easier. (Or maybe not needed, just an idea?)

Game engine starts from the first step of the beginning phase and stops after
executing last step of the final phase. Each step has a generic effect describing
activities to be executed in that step.

Engine may execute rules automatically until it faces a decision that needs to
be made by player. They will presented with the current legal actions. Also
non-viable actions are created as they currently are. (Do we need compulsory
'pass' between phases or does it come implicitly?)

Global Effects
--------------

All effects affecting the game are kept in the game state in one global array.
It works in FIFO-principle. When we enter new step, the list of effects for
that particular step are inserted there for handling. (Is this the same than
to one in the state currently? Or do we need separate for long term effects?)

When an action arrives, the effect handler is activated with

- Every variable in the game state
- Every variable in the phase state
- A variable 'action' containing a legal action to be executed.

Transfers
---------

A key element of all playing is transfering card instances from the one place to
another. Let us dive deeper in details.

Transfer source or destination is one of the following. Note that some combinations
may never be used.

- 'my pool'   card instances from my deck for the character draft
- 'opp pool'  card instances from opponent's deck for the character draft
- 'my pick'   card instance i picked during the draft
- 'opp pick'  card instance opponent picked during the draft
- 'my draft'  my card instances drafted successfully
- 'opp draft' opponent's card instances drafted successfully
- 'aside'     used in character draft for bouncing characters

Examples
--------

1. Game begins and we do character draft. The following effect from
   `globalEffects['character-draft']` is added to the handling FIFO.

    ```js
    {
        name: 'setup/character-draft',
        ops: [
            {
                target-type: 'card',
                optional: true,
                activity: {
                    type: 'transfer',
                    source: 'my pool',
                    destination: 'my pick',
                    selection-method: 'choose',
                    filter: {'card.cardType': {'$in': ['hero-character', 'minion-character']}}
                }
            },
            {
                target-type: 'card',
                when: {
                    'draftState[me].currentPick.CardDefinitionId':
                        'draftState[opp].currentPick.CardDefinitionId'
                },
                activity: {
                    type: 'transfer',
                    source: 'my pick',
                    destination: 'aside'
                    selection-method: 'instance-id'
                    id: 'draftState[me].currentPick.instanceId'
                }
            },
            {
                target-type: 'card',
                when: {
                    'draftState[me].currentPick.CardDefinitionId':
                        'draftState[opp].currentPick.CardDefinitionId'
                },
                activity: {
                    type: 'transfer',
                    source: 'opp pick',
                    destination: 'aside'
                    selection-method: 'instance-id'
                    id: 'draftState[opp].currentPick.instanceId'
                }
            },
            {
                target-type: 'card',
                when: {
                    '$and': {
                        'draftState[me].currentPick.CardDefinitionId'
                            {'$not': 'draftState[opp].currentPick.CardDefinitionId'},
                        'draftState[me].currentPick.CardDefinitionId'
                            {'$not': null},
                        'draftState[opp].currentPick.CardDefinitionId'
                            {'$not': null},
                    }
                },
                activity: {
                    type: 'transfer',
                    source: 'my pick',
                    destination: 'my draft'
                    selection-method: 'instance-id'
                    id: 'draftState[me].currentPick.instanceId'
                }
            },
            {
                target-type: 'card',
                when: {
                    '$and': {
                        'draftState[me].currentPick.CardDefinitionId'
                            {'$not': 'draftState[opp].currentPick.CardDefinitionId'},
                        'draftState[me].currentPick.CardDefinitionId'
                            {'$not': null},
                        'draftState[opp].currentPick.CardDefinitionId'
                            {'$not': null},
                    }
                },
                activity: {
                    type: 'transfer',
                    source: 'opp pick',
                    destination: 'opp draft'
                    selection-method: 'instance-id'
                    id: 'draftState[opp].currentPick.instanceId'
                }
            }
        ]
    }
    ```

    - A list of legal actions are generated based on the 'optional' field and 'selection-method'.
      Because it is optional, a 'pass' action is generated. Then one option to transfer a card
      for every card matching the filter, i.e. characters.
    - Note that effects are handled in parallel in that sense that all transfers takes place
      simultaneously after every rule is evaluated. So both picked cards moves to drafted pile
      and not just one.
    - Transfer implementation works for arrays trivially and single variables by holding a single
      copy at time and being `null` other times.
