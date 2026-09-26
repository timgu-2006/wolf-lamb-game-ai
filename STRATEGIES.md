# Strategy notes from play

## Wolf "gatekeeper" formation (user's idea, 2026-09-26)

One wolf in the centre (3,3), one wolf on each flank of the upper half, e.g. (1,2)
and (2,5). Any lamb that steps into the upper half is captured; when nothing can be
captured, a flank wolf shuffles (2,4) <-> (2,5) to pass the move.

Shared game `solver/games/2026-09-26T21-18-13-190Z.json`, wolves by the user,
lambs by the tables (perfect, trap ranking):

```
1. (1,3) x (3,3)   (3,2) -> (2,2)
2. (1,4) x (3,4)   (3,1) -> (2,1)
3. (3,4) -> (2,4)  (2,2) -> (2,3)
4. (2,4) -> (2,5)  (2,3) -> (2,2)
5. (2,5) -> (2,4)  (2,2) -> (2,3)
6. (2,4) -> (2,5)  (2,3) -> (2,2)      position repeats: draw
```

```
. W . . .
L L . . W
. . W . L
L L L L L
L L L L L
```

Every wolf move kept the exact value (no blunder marks). At the repeated position
the tables give the wolf two drawing moves, (2,5) -> (2,4) and (3,3) -> (3,4);
the perfect lamb could not make progress and repeated as well.

Result of the game: draw by threefold repetition after 13 plies, no wolf blunder.

### The formation as a mechanical rule

`solver/rules.js` strategy "hold gatekeeper (1,2),(2,5),(3,3)": capture whenever
possible (the capture keeping the wolves closest to the formation), else step
toward the formation, else shuffle. From the start against every lamb reply
(2 million positions): 13.1% of decisions lose value, 35,861 of them a draw
turned into a loss. Typical failure: capturing the bait lamb on the flank,
(3,3) x (3,5), when the only drawing move is the other capture (1,2) x (3,2).
Games: 60 draws of 60 against the depth-6 engine lamb; 57 draws, 3 losses of 60
against a perfect lamb.

Static safety of the shape (lambs to move, no lamb capturable): lamb wins 100%
at 13 lambs, 99.5% at 12, 97% at 11, 84% at 10, 37% at 9, 0.8% at 8. The shape
becomes a fortress only once about 8 lambs remain; before that it holds only
through the capture threats, i.e. through choosing the right capture each time.

## The discovered double attack (user's observation, 2026-09-26)

A wolf steps off the square between a second wolf and a lamb: the second wolf's
capture is revealed, and the moving wolf threatens one or two more lambs itself.
The lambs can parry only one threat. Detector: `solver/tactics.js`
(`discoveredDouble`), search: `node solver/discovered.js`.

On 20,000 drawn wolf-to-move positions of the drawing frontier: the motif is
available in 22.6% of positions (8,240 such moves, 5,270 of which keep the draw)
and it is the ONLY drawing move in 327 positions. The archetype is move 3 of the
main line, (3,4) -> (2,4):

```
. W . . .
L L . . .
. . W W L      wolf to move: (3,4) -> (2,4) reveals (3,3) x (3,5) and adds
L L L L L      threats on (4,4) and (2,2); three lambs attacked, one can be saved
L L L L L
```

The page marks such moves with a lightning sign in exact mode.
