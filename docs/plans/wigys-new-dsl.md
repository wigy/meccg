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
`filter` - after target is known, all entities of the type are collected from the game state
         then filter is applied, if defined
         each entity is evaluated versus the filter expression
`when` - name of the phase+step unless immediately
`mode` - compulsary or optional
`activity` - 'transfer' actual card from one place to another
             'rotate' actual card orientation
             'reveal' actual card turn face up
             'hide' actual card turn face down
             'create' new non-card effect affecting the play
             'destroy' an existing effect affecting the play
             'run' another generic effect by its name

Transfer
--------

`source` - 'my deck', 'opp deck', 'my hand', 'company 1'
`selection-method` - 'top', 'bottom', 'choose', <instance id>
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

Global Effects
--------------

All effects affecting the game are kept in the game state in one global array.

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

Examples
--------
