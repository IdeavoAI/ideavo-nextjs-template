# Dev Server Memory Investigation

**Context:** This template is used as a starter by a coding agent inside an E2B sandbox
(4 GB RAM / 2 vCPU). The dev server (`next dev --turbopack`, port 4000) stays running for
the entire build session. Symptom: memory occasionally spikes to 100% and crashes the
sandbox, with `next-server` holding essentially all of it.

**Investigated:** 2026-08-27 · `next@15.5.12`, `node v22.19.0`, `bun 1.3.9`

---

## TL;DR

There are **two** independent problems that compound:

1. **A burst** — the `next/image` optimizer decodes remote images in-process with `sharp`,
   unthrottled, at 8 widths each. Measured **+508 MB from a single image**. This is what
   actually crashes the sandbox.
2. **A creeping floor** — Turbopack on Next 15.5 holds its whole compilation graph in RAM
   with no eviction and no filesystem cache, so the baseline climbs monotonically across
   an agent session. The burst then lands on top of an already-high floor.

Two amplifiers make both worse: the tagger loader's `hires` sourcemaps (~30× larger than
necessary) and an unbounded `tsc --noEmit` mandated after every task (~503 MB peak).

Nothing supervises the dev server, so when it goes, the sandbox goes with it.

---

## Root causes

### 1. The image optimizer is the spike — this is the crash

Hitting `/_next/image` with **one** Unsplash photo at 8 widths concurrently:

```
before:   98 MB
during:  245 MB
after:   606 MB   ← +508 MB from a single image
```

Why this template is especially exposed:

| Factor | Where | Effect |
|---|---|---|
| `hostname: '**'` over http **and** https | `next.config.ts:11-18` | Any remote image an agent drops in gets pulled in and decoded |
| `sharp` is installed | `node_modules/sharp` | Decoding happens **in-process** in `next-server`; a 4000×3000 JPEG is ~48 MB raw RGBA before resize buffers |
| 8 `deviceSizes` + 8 `imageSizes` | `next/dist/shared/lib/image-config.js:31` | One `<Image sizes=...>` can trigger up to 8 separate decodes |
| Sharp concurrency = core count, **no queue** in front | `next/dist/server/image-optimizer.js:741` | Decodes run fully parallel with nothing bounding them |

An agent-built landing page with 10–15 hero/gallery images, rendered in a preview iframe
that reloads on every HMR, produces dozens of concurrent full-resolution decodes.
Multi-GB burst on a 4 GB box.

This matches the "*sometimes* spikes" symptom precisely — it is **request-triggered**,
not gradual.

### 2. Turbopack's graph never shrinks on Next 15.5

On `next@15.5.12` with `--turbopack`, Turbopack keeps its entire compilation graph in RAM
with **no filesystem cache and no eviction**. Both landed upstream later:

- **16.1** — Turbopack filesystem caching
- **16.3** — memory eviction (`experimental.turbopackMemoryEviction`)

Because the dev server survives the whole build session across hundreds of agent edits,
the floor only goes up.

> ⚠️ `NODE_OPTIONS=--max-old-space-size` does **not** help here. Turbopack's allocations
> are Rust-side, outside the V8 heap, so the flag never sees them.

### 3. The tagger loader amplifies #2 by ~30×

`@ideavo/webpack-tagger` emits `ms.generateMap({ hires: true })`
(`node_modules/@ideavo/webpack-tagger/dist/index.js:71`). Measured on
`src/components/ui/sidebar.tsx`:

```
source:       21,638 bytes
hires map:   105,056 bytes   ← 4.9× the source
normal map:    3,467 bytes   ← 30× smaller
```

This runs on **every** `.jsx/.tsx` — 70 files in the template alone, plus everything the
agent writes — is regenerated on every HMR edit, and every result is retained in the
non-evicting graph. It also Babel-parses each file in a separate Node worker process
(`.next/webpack-loaders.js`).

### 4. `tsc --noEmit` lands concurrently

`AGENTS.md` mandates `bun run typecheck` after every task. Measured peak RSS: **503 MB**,
unbounded, on top of everything above.

### 5. Nothing supervises the dev server

No memory ceiling, no restart-on-threshold. The sandbox just dies.

---

## Fixes, ranked by impact-per-effort

### Tier 1 — cheap, no migration, kills the spike

The single biggest win is turning off image optimization in dev. In a sandbox preview
iframe it buys nothing.

```ts
// next.config.ts
images: {
  unoptimized: process.env.NODE_ENV === 'development',
  deviceSizes: [640, 828, 1200, 1920],
  imageSizes: [64, 128, 256],
  remotePatterns: [/* unchanged */],
},
experimental: {
  imgOptConcurrency: 1,
  imgOptMaxInputPixels: 30_000_000,
  imgOptSequentialRead: true,
  imgOptTimeoutInSeconds: 7,
},
```

All five `imgOpt*` knobs exist in 15.5.12 (`next/dist/server/config-shared.d.ts:403-407`),
and gating `unoptimized` on `NODE_ENV` keeps Vercel production builds fully optimized.

Alongside it:

- Set `hires: false` in the tagger (needs a `@ideavo/webpack-tagger@1.0.2` publish, or a
  local `bun patch`).
- Cap the typecheck: `NODE_OPTIONS=--max-old-space-size=512 tsc --noEmit`.
- `middleware.ts` is a no-op that matches every non-asset path — deleting it removes a
  compile step and a per-request hop. Minor, but free.

### Tier 2 — structural

Upgrade to **Next 16.3+** for Turbopack filesystem caching plus memory eviction. Real
migration cost, but it is the only thing that genuinely solves the creeping-floor half.

### Tier 3 — safety net (worth doing regardless)

- A watchdog sampling `next-server` RSS that restarts it past a threshold (~1.6 GB)
  *before* the kernel OOM-kills the sandbox. Restart cost is tiny — measured
  `Ready in 1167ms`.
- Better: run the dev server in its own cgroup with a hard memory limit, so the kernel
  kills **it** rather than the whole sandbox, and let the supervisor bring it back.

---

## Caveats on the measurements

- All numbers were taken on **macOS**, where RSS is muddied by memory compression. Treat
  them as directional rather than exact for the Linux sandbox.
- A tuned-config re-test showed a smaller spike (**+300 MB** vs **+508 MB**), but a noisy
  baseline made that one run not cleanly conclusive. The structural argument — halving the
  decode count and serializing sharp — is stronger than that single measurement.

---

## Sources

- [vercel/next.js#81161 — Turbopack dev server uses too much RAM and CPU](https://github.com/vercel/next.js/issues/81161)
- [vercel/next.js#94915 — Turbopack dev: unbounded RAM/CPU growth, persistent cache bloat](https://github.com/vercel/next.js/issues/94915)
- [Turbopack: What's New in Next.js 16.3](https://nextjs.org/blog/next-16-3-turbopack)
- [Next.js — Turbopack API Reference](https://nextjs.org/docs/app/api-reference/turbopack)

---

## Follow-up: does Next.js 16 remove the need for this?

**Short answer: no for the burst, yes for the creeping floor.**

Next 16's `next/image` changes are about **defaults and security**, not the decode memory
model. Sharp still decodes **in-process** inside `next-server`, still with no queue in
front of it, still with concurrency defaulting to core count. The `imgOpt*` knobs are
unchanged. A 4000×3000 JPEG is still ~48 MB of raw RGBA, and N concurrent requests still
allocate N of them.

What 16 *does* shave off the multiplier:

| Change | Effect on sandbox memory |
| --- | --- |
| `qualities` defaults to `[75]` | An agent writing `quality={90}` no longer creates a whole extra variant set — it is coerced to 75 |
| `minimumCacheTTL` `60s` → `4h` | Far fewer re-optimizations of the same image across a long session. Genuinely helpful here |
| `16` removed from `imageSizes` | One fewer variant per image |
| `maximumRedirects` unlimited → `3` | Bounds a pathological remote-fetch case |

Useful, but they trim the multiplier rather than the underlying spike. **Conclusion: keep
the Tier 1 image fix even after upgrading.**

Where 16 genuinely helps is the *other* root cause — Turbopack filesystem caching is on by
default for dev (`experimental.turbopackFileSystemCacheForDev`), and 16.3 adds memory
eviction. That is the real fix for §2.

### Do we need image optimization in the sandbox at all?

**No.** The preview is an iframe on a dev server that one person looks at. Nobody's Core
Web Vitals depend on it. Optimization buys nothing there and costs the sandbox.

`images.unoptimized` and the `unoptimized` prop are **still fully supported in 16.3.3**
(verified against the current `next/image` API reference — some third-party blogs claim
otherwise; they are wrong). So this stays correct across the upgrade:

```ts
images: {
  unoptimized: process.env.NODE_ENV === 'development',
}
```

Production builds on Vercel remain fully optimized. The only thing worth spot-checking is
`placeholder="blur"` rendering, since blur data is produced at compile time rather than by
the `/_next/image` endpoint.

---

## The minimal safety net

No daemon, no new dependency, no cgroup delegation. A ~25-line wrapper that polls the dev
server's **process-group** RSS and restarts it before the kernel OOM-kills the sandbox.

Committed as [`scripts/dev-guard.sh`](scripts/dev-guard.sh). Point the platform's start
command at it instead of `bun run dev`:

```bash
PORT=4000 DEV_MEM_LIMIT_MB=1500 ./scripts/dev-guard.sh
```

Why it is built the way it is:

- `set -m` puts the dev server in its own **process group**, so one
  `ps -eo rss=,pgid=` pass sums the entire tree — `bun` → `next dev` → `next-server` →
  loader workers — and one `kill -TERM -$pid` reaps all of it.
- A `trap` on `INT TERM EXIT` prevents orphaning the server when the guard itself is
  killed. *(Verified: without the trap the first smoke test left live `next-server`
  processes behind.)*
- Restart cost is negligible — measured `Ready in ~1.0s` across three forced restarts, and
  the browser HMR client reconnects on its own.

Smoke test with a deliberately low ceiling:

```
✓ Ready in 1002ms
[dev-guard] 470MB > 300MB ceiling - restarting dev server
✓ Ready in 992ms
[dev-guard] 467MB > 300MB ceiling - restarting dev server
✓ Ready in 989ms
```

### Approaches deliberately rejected

| Option | Why not |
| --- | --- |
| `ulimit -v` | Virtual-memory caps break Node and Rust, which reserve huge address space up front. Would fail immediately and misleadingly |
| `NODE_OPTIONS=--max-old-space-size` | Does not bound Turbopack at all (Rust-side allocations, outside the V8 heap). Still worth applying to `tsc`, which *is* pure V8 |
| `systemd-run -p MemoryMax=` | Cleanest on paper, but E2B sandboxes cannot be assumed to have systemd |
| Writing `memory.max` in cgroup v2 | Needs privileges and cgroup delegation that E2B may not grant. Worth revisiting if it does — kernel-enforced beats polling |
