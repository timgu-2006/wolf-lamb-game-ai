/*
 * Wolf and Lamb — distance to the end of the game.
 *
 * Reads the solved value tables (solver/tables/layer_<k>.bin, produced by
 * solve.c) and computes, for every won state s with winner X,
 *
 *   D(s) = the number of plies until the game ends with best play: X minimises,
 *          the opponent maximises. A capture contributes 1 + D of the position it
 *          lands in (0 if 3 or fewer lambs remain, the game is over). The
 *          100-turn clock is ignored here; repetition cannot matter because D
 *          strictly decreases along the winner's line.
 *
 *   S(s) = the number of plies until the next capture or the end of the game when
 *          X plays a D-optimal move that keeps this number smallest and the
 *          opponent plays to make it largest, counting only D-optimal lines whose
 *          captures land in positions that are themselves exact (see below);
 *          0xFFFF if no such line exists. If S(s) <= 100 - clock, a D-optimal
 *          strategy is legal under the 100-turn rule from s and every position it
 *          captures into is exact, so D(s) is exact under the full rules. Where
 *          S(s) is 0xFFFF or exceeds the remaining clock, D(s) is a lower bound:
 *          the winner must use a longer line. A lower-layer landing position is
 *          "exact" when its own S <= 100 (fresh clock after the capture).
 *          Rule: three or fewer lambs is a wolf win, so layers run from k = 4.
 *
 * Output: solver/tables/dist_<k>.bin and seg_<k>.bin, one uint16 per state
 * (same indexing as layer_<k>.bin), 0xFFFF for draws.
 *
 * Build: cc -O3 -o solver/dist solver/dist.c -lpthread
 * Run:   solver/dist [maxLayer] [threads]
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <pthread.h>
#include <time.h>

#define ALL ((1u << 25) - 1)
#define WOLF 1
#define LAMB 2
#define DRAW 3
#define NONE 0xffff
#define UNSET 0xfffe
#define INEXACT 0xfe      /* counter marker: some line out of here is not exact */
#define MAX_BUCKETS 8192
#ifndef TABLES_DIR
#define TABLES_DIR "solver/tables"
#endif

static uint32_t NOT_COL1, NOT_COL5;
static inline uint32_t up(uint32_t b) { return b >> 5; }
static inline uint32_t down(uint32_t b) { return (b << 5) & ALL; }
static inline uint32_t left(uint32_t b) { return (b >> 1) & NOT_COL5; }
static inline uint32_t right(uint32_t b) { return (b << 1) & NOT_COL1; }
static double now_s(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec * 1e-9; }
static inline int popcount32(uint32_t x) { return __builtin_popcount(x); }

/* ---- symmetry, orbits, indexing (as in solve.c) ------------------------ */
static int perm[8][25];
static uint32_t rowT[8][5][32];
static inline uint32_t xf(int t, uint32_t m) {
  return rowT[t][0][m & 31] | rowT[t][1][(m >> 5) & 31] | rowT[t][2][(m >> 10) & 31] |
         rowT[t][3][(m >> 15) & 31] | rowT[t][4][(m >> 20) & 31];
}
static void init_symmetry(void) {
  for (int r = 0; r < 5; r++) for (int c = 0; c < 5; c++) {
    int i = r * 5 + c;
    perm[0][i] = r * 5 + c; perm[1][i] = c * 5 + (4 - r); perm[2][i] = (4 - r) * 5 + (4 - c); perm[3][i] = (4 - c) * 5 + r;
    perm[4][i] = r * 5 + (4 - c); perm[5][i] = (4 - r) * 5 + c; perm[6][i] = c * 5 + r; perm[7][i] = (4 - c) * 5 + (4 - r);
  }
  for (int t = 0; t < 8; t++) for (int r = 0; r < 5; r++) for (int bits = 0; bits < 32; bits++) {
    uint32_t m = 0;
    for (int c = 0; c < 5; c++) if (bits & (1 << c)) m |= 1u << perm[t][r * 5 + c];
    rowT[t][r][bits] = m;
  }
}
static uint32_t binom[26][26];
static void init_binom(void) {
  for (int n = 0; n < 26; n++) { binom[n][0] = 1; for (int k = 1; k < 26; k++) binom[n][k] = (n == 0) ? 0 : binom[n - 1][k - 1] + binom[n - 1][k]; }
}
static inline int rank3(uint32_t w) {
  int a = __builtin_ctz(w); w &= w - 1; int b = __builtin_ctz(w); w &= w - 1; int c = __builtin_ctz(w);
  return binom[a][1] + binom[b][2] + binom[c][3];
}
#define NTRIPLES 2300
static uint16_t tripleOrbit[NTRIPLES];
static uint8_t tripleCosetN[NTRIPLES], tripleCoset[NTRIPLES][8];
static int nOrbits = 0;
static uint32_t orbitMask[NTRIPLES];
static int8_t orbitComp[NTRIPLES][25];
static uint32_t orbitExp8[NTRIPLES][3][256];
static uint8_t orbitStabN[NTRIPLES], orbitStab[NTRIPLES][8];
static void init_orbits(void) {
  uint32_t masks[NTRIPLES];
  for (int a = 0; a < 25; a++) for (int b = a + 1; b < 25; b++) for (int c = b + 1; c < 25; c++) { uint32_t w = (1u << a) | (1u << b) | (1u << c); masks[rank3(w)] = w; }
  for (int r = 0; r < NTRIPLES; r++) tripleOrbit[r] = 0xffff;
  for (int r = 0; r < NTRIPLES; r++) {
    uint32_t w = masks[r], canon = ALL;
    for (int t = 0; t < 8; t++) { uint32_t m = xf(t, w); if (m < canon) canon = m; }
    int cr = rank3(canon);
    if (tripleOrbit[cr] == 0xffff) {
      int o = nOrbits++; orbitMask[o] = canon; int ci = 0;
      for (int p = 0; p < 25; p++) orbitComp[o][p] = (canon >> p) & 1 ? -1 : ci++;
      int cells[22]; ci = 0;
      for (int p = 0; p < 25; p++) if (!((canon >> p) & 1)) cells[ci++] = p;
      for (int chunk = 0; chunk < 3; chunk++) for (int v = 0; v < 256; v++) {
        uint32_t m = 0;
        for (int bit = 0; bit < 8; bit++) { int c = chunk * 8 + bit; if (c < 22 && (v & (1 << bit))) m |= 1u << cells[c]; }
        orbitExp8[o][chunk][v] = m;
      }
      orbitStabN[o] = 0;
      for (int t = 0; t < 8; t++) if (xf(t, canon) == canon) orbitStab[o][orbitStabN[o]++] = t;
      tripleOrbit[cr] = o;
    }
    tripleOrbit[r] = tripleOrbit[cr]; tripleCosetN[r] = 0;
    for (int t = 0; t < 8; t++) if (xf(t, w) == canon) tripleCoset[r][tripleCosetN[r]++] = t;
  }
}
static inline uint32_t expandLambs(int o, uint32_t cm) { return orbitExp8[o][0][cm & 255] | orbitExp8[o][1][(cm >> 8) & 255] | orbitExp8[o][2][(cm >> 16) & 63]; }
static inline uint32_t rankLambs(int o, uint32_t lm) { uint32_t r = 0; int i = 0; while (lm) { int p = __builtin_ctz(lm); lm &= lm - 1; i++; r += binom[orbitComp[o][p]][i]; } return r; }
static inline uint32_t unrankCompressed(uint32_t r, int k) { uint32_t cm = 0; for (int i = k - 1; i >= 0; i--) { int c = 21; while (binom[c][i + 1] > r) c--; r -= binom[c][i + 1]; cm |= 1u << c; } return cm; }
static inline uint32_t nextComb(uint32_t cm) { uint32_t c = cm & -cm, r = cm + c; return (((r ^ cm) >> 2) / c) | r; }
static inline int isAlias(int o, uint32_t l) { for (int i = 1; i < orbitStabN[o]; i++) if (xf(orbitStab[o][i], l) < l) return 1; return 0; }

typedef struct { int k; uint32_t c22k; uint64_t n; uint16_t *val; uint16_t *dist; uint16_t *seg; } Layer;
static inline uint64_t canonIndex(const Layer *L, uint32_t w, uint32_t l, int side) {
  int r = rank3(w), o = tripleOrbit[r]; uint32_t best = 0xffffffffu;
  for (int i = 0; i < tripleCosetN[r]; i++) { uint32_t m = xf(tripleCoset[r][i], l); if (m < best) best = m; }
  return (((uint64_t)o * L->c22k + rankLambs(o, best)) << 1) | side;
}
static inline void stateOf(const Layer *L, uint64_t idx, uint32_t *w, uint32_t *l, int *side) {
  *side = idx & 1; uint64_t s = idx >> 1; int o = (int)(s / L->c22k); uint32_t r = (uint32_t)(s % L->c22k);
  *w = orbitMask[o]; *l = expandLambs(o, unrankCompressed(r, L->k));
}
#define WINNER(v) ((v) >> 14)

typedef struct { uint32_t w, l; uint8_t cap; } Child;
static inline int genChildren(uint32_t w, uint32_t l, int side, Child *out) {
  uint32_t empty = ALL & ~(w | l); int n = 0; uint32_t b;
  if (side == 0) {
#define WSTEP(dir, back) b = dir(w) & empty; while (b) { int t = __builtin_ctz(b); b &= b - 1; uint32_t f = back(1u << t); out[n].w = (w ^ f) | (1u << t); out[n].l = l; out[n].cap = 0; n++; }
#define WCAP(dir, back) b = dir(dir(w) & empty) & l; while (b) { int t = __builtin_ctz(b); b &= b - 1; uint32_t f = back(back(1u << t)); out[n].w = (w ^ f) | (1u << t); out[n].l = l & ~(1u << t); out[n].cap = 1; n++; }
    WCAP(up, down) WCAP(down, up) WCAP(left, right) WCAP(right, left)
    WSTEP(up, down) WSTEP(down, up) WSTEP(left, right) WSTEP(right, left)
  } else {
#define LSTEP(dir, back) b = dir(l) & empty; while (b) { int t = __builtin_ctz(b); b &= b - 1; uint32_t f = back(1u << t); out[n].w = w; out[n].l = (l ^ f) | (1u << t); out[n].cap = 0; n++; }
    LSTEP(up, down) LSTEP(down, up) LSTEP(left, right) LSTEP(right, left)
  }
  return n;
}
static inline int genPreds(uint32_t w, uint32_t l, int side, Child *out) {
  uint32_t empty = ALL & ~(w | l); int n = 0; uint32_t b;
  if (side == 1) {
#define WUN(dir, back) b = dir(w) & empty; while (b) { int f = __builtin_ctz(b); b &= b - 1; uint32_t t = back(1u << f); out[n].w = (w ^ t) | (1u << f); out[n].l = l; n++; }
    WUN(up, down) WUN(down, up) WUN(left, right) WUN(right, left)
  } else {
#define LUN(dir, back) b = dir(l) & empty; while (b) { int f = __builtin_ctz(b); b &= b - 1; uint32_t t = back(1u << f); out[n].w = w; out[n].l = (l ^ t) | (1u << f); n++; }
    LUN(up, down) LUN(down, up) LUN(left, right) LUN(right, left)
  }
  return n;
}

typedef struct { uint32_t *a; uint64_t n, cap; } Vec;
static void vpush(Vec *v, uint32_t x) {
  if (v->n == v->cap) { v->cap = v->cap ? v->cap * 2 : 1024; v->a = realloc(v->a, v->cap * sizeof(uint32_t)); if (!v->a) { fprintf(stderr, "oom\n"); exit(1); } }
  v->a[v->n++] = x;
}

/* ---- the D pass -------------------------------------------------------- */
static Layer cur, prev;
static uint8_t *cnt;
static int nThreads = 8, X;
static Vec bucket[MAX_BUCKETS];

/* distance contributed by a capture into (w,l): 1 + D of the landing state, or NONE if not an X win */
static inline uint32_t capDist(uint32_t w, uint32_t l) {
  if (popcount32(l) < 4) return X == WOLF ? 1 : NONE;            /* game over at once */
  uint64_t i = canonIndex(&prev, w, l, 1);
  if (WINNER(prev.val[i]) != X) return NONE;
  return 1u + prev.dist[i];
}

typedef struct { int tid; Vec *buckets; } InitArg;
static void *initWorker(void *arg) {
  InitArg *A = arg; Child ch[64]; uint64_t seen[64]; int k = cur.k;
  for (int o = A->tid; o < nOrbits; o += nThreads) {
    uint32_t cm = (1u << k) - 1, rank = 0; uint64_t base = (uint64_t)o * cur.c22k;
    for (; cm < (1u << 22); cm = nextComb(cm), rank++) {
      uint32_t w = orbitMask[o], l = expandLambs(o, cm);
      if (isAlias(o, l)) continue;
      for (int side = 0; side < 2; side++) {
        uint64_t idx = ((base + rank) << 1) | side;
        if (WINNER(cur.val[idx]) != X) continue;
        int mover = side == 0 ? WOLF : LAMB;
        int n = genChildren(w, l, side, ch);
        if (mover == X) {
          uint32_t best = NONE;
          for (int i = 0; i < n; i++) if (ch[i].cap) { uint32_t d = capDist(ch[i].w, ch[i].l); if (d < best) best = d; }
          if (best != NONE) { cur.dist[idx] = (uint16_t)best; vpush(&A->buckets[best], (uint32_t)idx); }
        } else {
          if (n == 0) { cur.dist[idx] = 0; vpush(&A->buckets[0], (uint32_t)idx); continue; }
          int nStep = 0; uint32_t mx = 0;
          for (int i = 0; i < n; i++) {
            if (ch[i].cap) { uint32_t d = capDist(ch[i].w, ch[i].l); if (d == NONE) { fprintf(stderr, "internal: loser escapes from a won state\n"); exit(1); } if (d > mx) mx = d; }
            else {
              uint64_t ci = canonIndex(&cur, ch[i].w, ch[i].l, side ^ 1);
              if (WINNER(cur.val[ci]) != X) { fprintf(stderr, "internal: loser steps out of a won state\n"); exit(1); }
              int dup = 0; for (int j = 0; j < nStep; j++) if (seen[j] == ci) { dup = 1; break; }
              if (!dup) seen[nStep++] = ci;
            }
          }
          if (nStep == 0) { cur.dist[idx] = (uint16_t)mx; vpush(&A->buckets[mx], (uint32_t)idx); }
          else cnt[idx] = (uint8_t)nStep;
        }
      }
    }
  }
  return NULL;
}

static uint32_t maxChildDist(uint64_t idx) {
  uint32_t w, l; int side; stateOf(&cur, idx, &w, &l, &side);
  Child ch[64]; int n = genChildren(w, l, side, ch); uint32_t mx = 0;
  for (int i = 0; i < n; i++) {
    uint32_t d = ch[i].cap ? capDist(ch[i].w, ch[i].l) : 1u + cur.dist[canonIndex(&cur, ch[i].w, ch[i].l, side ^ 1)];
    if (d == NONE || d > 0xfffe) { fprintf(stderr, "internal: unresolved child at counter zero\n"); exit(1); }
    if (d > mx) mx = d;
  }
  return mx;
}

static int distPass(void) {
  cnt = calloc(cur.n, 1);
  for (int i = 0; i < MAX_BUCKETS; i++) bucket[i].n = 0;
  pthread_t th[64]; InitArg args[64];
  for (int t = 0; t < nThreads; t++) { args[t].tid = t; args[t].buckets = calloc(MAX_BUCKETS, sizeof(Vec)); pthread_create(&th[t], NULL, initWorker, &args[t]); }
  for (int t = 0; t < nThreads; t++) {
    pthread_join(th[t], NULL);
    for (int d = 0; d < MAX_BUCKETS; d++) { for (uint64_t i = 0; i < args[t].buckets[d].n; i++) vpush(&bucket[d], args[t].buckets[d].a[i]); free(args[t].buckets[d].a); }
    free(args[t].buckets);
  }
  Child pr[64]; uint64_t seen[64]; int maxD = 0;
  for (int d = 0; d < MAX_BUCKETS; d++) {
    for (uint64_t bi = 0; bi < bucket[d].n; bi++) {
      uint64_t idx = bucket[d].a[bi];
      if (cur.dist[idx] != d) continue;                      /* stale */
      maxD = d;
      uint32_t w, l; int side; stateOf(&cur, idx, &w, &l, &side);
      int n = genPreds(w, l, side, pr), ns = 0;
      for (int i = 0; i < n; i++) {
        uint64_t q = canonIndex(&cur, pr[i].w, pr[i].l, side ^ 1);
        int dup = 0; for (int j = 0; j < ns; j++) if (seen[j] == q) { dup = 1; break; }
        if (dup) continue; seen[ns++] = q;
        if (WINNER(cur.val[q]) != X) continue;
        int qMover = (side ^ 1) == 0 ? WOLF : LAMB;
        if (qMover == X) {
          if (cur.dist[q] > (uint32_t)d + 1) { cur.dist[q] = (uint16_t)(d + 1); vpush(&bucket[d + 1], (uint32_t)q); }
        } else {
          if (cnt[q] == 0) { fprintf(stderr, "internal: counter underflow\n"); exit(1); }
          if (--cnt[q] == 0) {
            uint32_t D = maxChildDist(q);
            if (D >= MAX_BUCKETS) { fprintf(stderr, "distance overflow\n"); exit(1); }
            cur.dist[q] = (uint16_t)D; vpush(&bucket[D], (uint32_t)q);
          }
        }
      }
    }
    free(bucket[d].a); bucket[d].a = NULL; bucket[d].n = bucket[d].cap = 0;
  }
  free(cnt); cnt = NULL;
  return maxD;
}

/* ---- the S pass: capture-free stretch needed by an exact D-optimal strategy */
static inline int landingExact(uint32_t w, uint32_t l) {
  if (popcount32(l) < 4) return 1;
  return prev.seg[canonIndex(&prev, w, l, 1)] <= 100;
}
typedef struct { int tid; Vec q0, q1; } SegArg;
static void *segInitWorker(void *arg) {
  SegArg *A = arg; Child ch[64]; uint64_t seen[64]; int k = cur.k;
  for (int o = A->tid; o < nOrbits; o += nThreads) {
    uint32_t cm = (1u << k) - 1, rank = 0; uint64_t base = (uint64_t)o * cur.c22k;
    for (; cm < (1u << 22); cm = nextComb(cm), rank++) {
      uint32_t w = orbitMask[o], l = expandLambs(o, cm);
      if (isAlias(o, l)) continue;
      for (int side = 0; side < 2; side++) {
        uint64_t idx = ((base + rank) << 1) | side;
        if (WINNER(cur.val[idx]) != X) continue;
        int mover = side == 0 ? WOLF : LAMB;
        int n = genChildren(w, l, side, ch);
        if (mover == X) {
          for (int i = 0; i < n; i++) if (ch[i].cap && capDist(ch[i].w, ch[i].l) == cur.dist[idx] && landingExact(ch[i].w, ch[i].l)) { cur.seg[idx] = 1; vpush(&A->q1, (uint32_t)idx); break; }
        } else {
          if (n == 0) { cur.seg[idx] = 0; vpush(&A->q0, (uint32_t)idx); continue; }
          int nStep = 0, bad = 0;
          for (int i = 0; i < n; i++) {
            if (ch[i].cap) { if (!landingExact(ch[i].w, ch[i].l)) bad = 1; continue; }
            uint64_t ci = canonIndex(&cur, ch[i].w, ch[i].l, side ^ 1);
            int dup = 0; for (int j = 0; j < nStep; j++) if (seen[j] == ci) { dup = 1; break; }
            if (!dup) seen[nStep++] = ci;
          }
          if (bad) cnt[idx] = INEXACT;
          else if (nStep == 0) { cur.seg[idx] = 1; vpush(&A->q1, (uint32_t)idx); }
          else cnt[idx] = (uint8_t)nStep;
        }
      }
    }
  }
  return NULL;
}
static int segPass(uint64_t *over100) {
  cnt = calloc(cur.n, 1);
  pthread_t th[64]; SegArg args[64];
  for (int t = 0; t < nThreads; t++) { args[t].tid = t; memset(&args[t].q0, 0, sizeof(Vec)); memset(&args[t].q1, 0, sizeof(Vec)); pthread_create(&th[t], NULL, segInitWorker, &args[t]); }
  Vec curq = {0}, nextq = {0};
  for (int t = 0; t < nThreads; t++) {
    pthread_join(th[t], NULL);
    for (uint64_t i = 0; i < args[t].q0.n; i++) vpush(&curq, args[t].q0.a[i]);
    for (uint64_t i = 0; i < args[t].q1.n; i++) vpush(&nextq, args[t].q1.a[i]);
    free(args[t].q0.a); free(args[t].q1.a);
  }
  Child pr[64]; uint64_t seen[64]; int level = 0, maxS = 0; uint64_t nOver = 0;
  while (curq.n || nextq.n) {
    for (uint64_t bi = 0; bi < curq.n; bi++) {
      uint64_t idx = curq.a[bi];
      if (cur.seg[idx] != level) { fprintf(stderr, "internal: seg level mismatch\n"); exit(1); }
      maxS = level; if (level > 100) nOver++;
      uint32_t w, l; int side; stateOf(&cur, idx, &w, &l, &side);
      int n = genPreds(w, l, side, pr), ns = 0;
      for (int i = 0; i < n; i++) {
        uint64_t q = canonIndex(&cur, pr[i].w, pr[i].l, side ^ 1);
        int dup = 0; for (int j = 0; j < ns; j++) if (seen[j] == q) { dup = 1; break; }
        if (dup) continue; seen[ns++] = q;
        if (WINNER(cur.val[q]) != X) continue;
        int qMover = (side ^ 1) == 0 ? WOLF : LAMB;
        if (qMover == X) {
          if (cur.seg[q] == UNSET && cur.dist[q] == cur.dist[idx] + 1) { cur.seg[q] = (uint16_t)(level + 1); vpush(&nextq, (uint32_t)q); }
        } else {
          if (cnt[q] == INEXACT) continue;
          if (cnt[q] == 0) { fprintf(stderr, "internal: seg counter underflow\n"); exit(1); }
          if (--cnt[q] == 0) { cur.seg[q] = (uint16_t)(level + 1); vpush(&nextq, (uint32_t)q); }
        }
      }
    }
    free(curq.a); curq = nextq; memset(&nextq, 0, sizeof(Vec)); level++;
  }
  free(cnt); cnt = NULL;
  /* won states never reached have no exact D-optimal line */
  for (uint64_t i = 0; i < cur.n; i++) if (WINNER(cur.val[i]) == X && cur.seg[i] == UNSET) cur.seg[i] = NONE;
  *over100 = nOver;
  return maxS;
}

/* ---- driver ------------------------------------------------------------ */
static int readTable(const char *name, int k, uint16_t **out, uint64_t n) {
  char path[256]; snprintf(path, sizeof path, TABLES_DIR "/%s_%d.bin", name, k);
  FILE *f = fopen(path, "rb"); if (!f) return 0;
  *out = malloc(n * 2); if (fread(*out, 2, n, f) != n) { fclose(f); free(*out); *out = NULL; return 0; }
  fclose(f); return 1;
}
static void writeTable(const char *name, int k, const uint16_t *t, uint64_t n) {
  char path[256]; snprintf(path, sizeof path, TABLES_DIR "/%s_%d.bin", name, k);
  FILE *f = fopen(path, "wb"); if (!f || fwrite(t, 2, n, f) != n) { fprintf(stderr, "write failed %s\n", path); exit(1); } fclose(f);
}

int main(int argc, char **argv) {
  int maxLayer = argc > 1 ? atoi(argv[1]) : 15;
  if (argc > 2) nThreads = atoi(argv[2]);
  uint32_t col1 = 0, col5 = 0;
  for (int r = 0; r < 5; r++) { col1 |= 1u << (r * 5); col5 |= 1u << (r * 5 + 4); }
  NOT_COL1 = ALL & ~col1; NOT_COL5 = ALL & ~col5;
  init_symmetry(); init_binom(); init_orbits();
  memset(&prev, 0, sizeof prev); memset(&cur, 0, sizeof cur);
  for (int k = 4; k <= maxLayer; k++) {
    double t0 = now_s();
    cur.k = k; cur.c22k = binom[22][k]; cur.n = (uint64_t)nOrbits * cur.c22k * 2;
    if (!readTable("layer", k, &cur.val, cur.n)) { fprintf(stderr, "missing layer_%d.bin\n", k); return 1; }
    cur.dist = malloc(cur.n * 2); cur.seg = malloc(cur.n * 2);
    memset(cur.dist, 0xff, cur.n * 2); memset(cur.seg, 0xff, cur.n * 2);
    int maxD[3] = {0, 0, 0}, maxS[3] = {0, 0, 0}; uint64_t over[3] = {0, 0, 0};
    for (X = WOLF; X <= LAMB; X++) {
      maxD[X] = distPass();
      /* S starts unset for the won states of this X; draws keep 0xFFFF */
      for (uint64_t i = 0; i < cur.n; i++) if (WINNER(cur.val[i]) == X) cur.seg[i] = UNSET;
      maxS[X] = segPass(&over[X]);
    }
    /* aliases */
    for (int o = 0; o < nOrbits; o++) {
      if (orbitStabN[o] < 2) continue;
      uint32_t cm = (1u << k) - 1, rank = 0; uint64_t base = (uint64_t)o * cur.c22k;
      for (; cm < (1u << 22); cm = nextComb(cm), rank++) {
        uint32_t l = expandLambs(o, cm), best = l;
        for (int i = 1; i < orbitStabN[o]; i++) { uint32_t m = xf(orbitStab[o][i], l); if (m < best) best = m; }
        if (best != l) {
          uint64_t src = (base + rankLambs(o, best)) << 1, dst = (base + rank) << 1;
          cur.dist[dst] = cur.dist[src]; cur.dist[dst | 1] = cur.dist[src | 1];
          cur.seg[dst] = cur.seg[src]; cur.seg[dst | 1] = cur.seg[src | 1];
        }
      }
    }
    /* entries (aliases included) whose D is only a lower bound under the clock: no exact line, or one needing > 100 capture-free plies */
    uint64_t lb[3] = {0, 0, 0}, unset = 0;
    for (uint64_t i = 0; i < cur.n; i++) {
      int wn = WINNER(cur.val[i]);
      if (wn == DRAW) continue;
      if (cur.dist[i] == NONE) unset++;
      if (cur.seg[i] == NONE || cur.seg[i] > 100) lb[wn]++;
    }
    writeTable("dist", k, cur.dist, cur.n); writeTable("seg", k, cur.seg, cur.n);
    fprintf(stderr, "layer %2d: max D wolf %d lamb %d   max exact S wolf %d lamb %d   entries where D is only a lower bound under the clock: wolf %llu lamb %llu   unset %llu   %.0fs\n",
            k, maxD[1], maxD[2], maxS[1], maxS[2], (unsigned long long)lb[1], (unsigned long long)lb[2], (unsigned long long)unset, now_s() - t0);
    (void)over;
    if (prev.val) { free(prev.val); free(prev.dist); free(prev.seg); }
    prev = cur; cur.val = NULL; cur.dist = NULL; cur.seg = NULL;
  }
  return 0;
}
