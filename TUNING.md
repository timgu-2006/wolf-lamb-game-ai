# Tuning log

All matches played with `selfplay.js`. The first two plies of every game are random
(seeded) so the games differ; the same seed gives the same set of openings, which
makes candidate-vs-default comparisons paired. Every move is validated against
`engine.js`.

Score column = wins + 0.5 × draws for the side being tested, out of the games played.

## Baseline (2026-09-26)

Default weights in `ai.js`:

| weight     | value | meaning                                              |
|------------|-------|------------------------------------------------------|
| lamb       | 100   | per captured lamb                                    |
| threshold  | 350   | extra per lamb below 5                               |
| wolfMob    | 28    | per legal wolf move                                  |
| trapped    | 250   | wolves have zero moves                               |
| confine    | 10    | per empty cell reachable by wolves                   |
| threat     | 55    | per capturable lamb, wolf to move                    |
| threatLamb | 20    | per capturable lamb, lamb to move                    |
| vulnerable | 14    | per lamb with an open jump lane                      |
| isolated   | 18    | per lamb with no lamb neighbour                      |
| base       | 500   | subtracted so the start position scores near 0       |
| contempt   | 150   | draws score this much against the root side          |

Sanity matches:

| wolf        | lamb        | games | wolf | lamb | draw |
|-------------|-------------|-------|------|------|------|
| random      | depth 6     | 10    | 0    | 10   | 0    |
| depth 6     | random      | 10    | 10   | 0    | 0    |
| time 1000ms | random      | 10    | 10   | 0    | 0    |
| depth 6     | depth 6     | 50    | 0    | 41   | 9    |
| depth 7     | depth 7     | 50    | 4    | 39   | 7    |

At equal search the lamb side dominates. Draws are almost all by the 100-turn rule.

### Fixes made before tuning

1. **Draw grabbing.** With draws scored 0 and the start position evaluating at about
   +5 for the wolf, the lamb AI took any repetition draw it could find, even against
   a random wolf (5 draws in 10). Fixed with a `base` offset so the start position
   scores about 0, plus a contempt of 150 so a draw is scored as slightly bad for
   the root side. After the fix: random wolf loses 10 of 10.

## Sweep 1: single-weight changes, depth 6, 30 games, seed 11

Each candidate is played as wolf against the default lamb, and as lamb against
the default wolf.

| candidate                          | as wolf (W/L/D) | score | as lamb (W/L/D) | score |
|------------------------------------|-----------------|-------|-----------------|-------|
| default                            | 0/21/9          | 4.5   | 21/0/9          | 25.5  |
| wolfMob 45                         | 1/22/7          | 4.5   | 28/0/2          | 29    |
| confine 22                         | 0/28/2          | 1     | 16/6/8          | 20    |
| threat 90, vulnerable 28           | 6/14/10         | 11    | 27/0/3          | 28.5  |
| trapped 600                        | 0/21/9          | 4.5   | 21/0/9          | 25.5  |
| lamb 160                           | 0/19/11         | 5.5   | 15/13/2         | 16    |
| isolated 40                        | 0/16/14         | 7     | 22/1/7          | 25.5  |
| wolfMob 15, confine 4              | 0/17/13         | 6.5   | 19/5/6          | 22    |

Observations: raising material (`lamb 160`) makes the lamb side passive and
clearly worse. Raising `confine` also hurts the lamb. `threat 90 / vulnerable 28`
looked like the only setting that improves both roles.

## Sweep 2: combinations, depth 6, 30 games, seed 11

| candidate                                     | as wolf  | score | as lamb  | score |
|-----------------------------------------------|----------|-------|----------|-------|
| wolfMob 45, threat 90, vulnerable 28          | 1/10/19  | 10.5  | 19/0/11  | 24.5  |
| threat 130, vulnerable 40                     | 0/17/13  | 6.5   | 10/5/15  | 17.5  |
| wolfMob 45, threat 130, vulnerable 40         | 0/22/8   | 4     | 20/0/10  | 25    |
| wolfMob 60, threat 90, vulnerable 28          | 5/14/11  | 10.5  | 21/5/4   | 23    |
| wolfMob 45, threat 90, vul 28, confine 16     | 0/24/6   | 3     | 18/0/12  | 24    |
| wolfMob 45, threat 90, vul 28, isolated 40    | 1/21/8   | 5     | 16/5/9   | 20.5  |

No combination beat the simple `threat 90 / vulnerable 28`.

## Confirmation: threat 90 / vulnerable 28 vs default, 50 games, seed 23

| depth | match                  | wolf | lamb | draw | tested side score |
|-------|------------------------|------|------|------|-------------------|
| 6     | NEW wolf vs OLD lamb   | 3    | 27   | 20   | 13 (default 4.5)  |
| 6     | OLD wolf vs NEW lamb   | 0    | 37   | 13   | 43.5 (default 45.5) |
| 7     | NEW wolf vs OLD lamb   | 4    | 40   | 6    | 7 (default 7.5)   |
| 7     | OLD wolf vs NEW lamb   | 8    | 32   | 10   | 37 (default 42.5) |
| 6     | NEW wolf vs NEW lamb   | 0    | 32   | 18   |                   |
| 7     | NEW wolf vs NEW lamb   | 12   | 24   | 14   |                   |

The gain seen in sweep 1 did not survive a different opening set: at depth 7 the
candidate is neutral as wolf and worse as lamb. Differences of this size are
within the noise of 30 to 50 games.

**Decision:** keep the default weights. The evaluation is not the bottleneck at
the moment; search depth is. Time-based play (depth 12 to 16 in one second)
is what ships in `index.html`.

## Acceptance (time-based)

| wolf        | lamb        | games | wolf | lamb | draw | notes                       |
|-------------|-------------|-------|------|------|------|-----------------------------|
| time 1000ms | random      | 10    | 10   | 0    | 0    | all by capturing to 2 lambs |
| time 200ms  | time 1000ms | 10    | 0    | 7    | 3    | draws by threefold repetition |

## Ideas not yet tried

- Tune with more games (200+) and several seeds before trusting any change.
- A wolf-specific feature: distance of wolves to the nearest lamb, so the wolves
  keep pressure instead of drifting when nothing is capturable.
- A lamb-specific feature: number of lambs on the "front line" adjacent to the
  wolves' region, to reward closing the net evenly.
- Endgame tablebase for positions with 6 or fewer lambs.
