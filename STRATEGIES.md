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
