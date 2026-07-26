# CLAUDE.md — commonpod

Provider-agnostic print-on-demand (POD) package. Sibling of
`commonpayment` — read that repo's CLAUDE.md for the shared library
conventions; this file covers only what differs.

## What this is

One `PodProvider` interface (src/types.ts) + per-provider adapters.
v1 surface: `getCatalogVariant` (config validation; keyless on
Printful), `createOrderDraft` (ALWAYS draft — confirming charges money
and is a separate explicit step), `getOrder`, optional `confirmOrder`.

Plus a second, non-adapter surface: **mockup imaging** (see below).

Consumers: **furrybooth** (Printful, English market). Planned: a
Traditional-Chinese FurryBooth at hahadoggo.com/booth with an
Asia-region provider (2026-05 research candidates: 巨茂 / 理想 /
Doabag) — that's the whole reason this is a package and not app code.

## Second surface: mockup imaging (NOT a provider adapter)

The package is no longer only `PodProvider` adapters. `src/lifestyle-mockup.ts`
(added 2026-07-26, SHA `2d91a38`) is **pure imaging math** with the same
package stance: dependency-free, storage-agnostic, raw RGBA buffers in/out.

- `compositeLifestyleMockup(scene, artwork, {quad, blend, featherPx, opacity})`
  — perspective-warps artwork onto a 4-corner print area in a product
  photo and molds it with the scene's own luminance (shadows/wrinkles
  read through the print). MUTATES `scene.data` in place.
  Helpers exported: `squareToQuad` (Heckbert), `invert3`,
  `applyHomography`, `isQuad`; types `Quad`/`QuadPoint`/`Mat3`/`RawImage`/
  `LifestyleCompositeOptions`.
- **Quad convention: 4 corners `[x,y]` as PERCENT of scene W/H, order
  TL, TR, BR, BL.** Same convention FurryBooth uses for
  `product-shelf-map.json` hotspots — keep it for any new map file.
- `blend` 0.85 ≈ fabric (wrinkles visible), ~0.6 ≈ flat surfaces
  (framed print, sticker).
- **WHY it exists / why deterministic:** re-render models (gpt-image,
  nano-banana, Flux Kontext) can stage a product in a real scene but they
  REPAINT the artwork — fatal when the artwork is a customer's pet
  portrait. Cutout services preserve pixels but can't do worn/held
  products. So: AI generates the scene with a **BLANK** product, this
  composites the exact design. Every artwork pixel comes from the artwork
  buffer, so design fidelity is guaranteed by construction. Full
  buy-vs-build research: furrybooth `docs/mockup-strategy-research-2026-07-23.md`.
- Consumer glue lives in the app (furrybooth `src/lib/lifestyle.ts` +
  `/admin/mockups`): storage, persistence, sharp decode/encode. If you
  add another imaging helper, keep that split — package = logic, app =
  I/O.
- ⚠️ TS is strict with `noUncheckedIndexedAccess`: buffer reads need `!`
  and fixed-length matrices need a tuple type (`Mat3`), not `number[]`,
  or `npm run typecheck` fails with dozens of "possibly undefined".

## Conventions (inherited from commonpayment)

- Storage-agnostic: never read host-app DB/settings; adapters read only
  their own env (`PRINTFUL_API_KEY`). Host app picks the provider name.
- `npm install github:yabroexperiments/commonpod` in consumers;
  `prepare: tsc` builds dist at install. Bump = `npm install commonpod`
  in the consumer + commit lockfile.
- TS strict, NodeNext, no runtime deps. `npm run typecheck` before push.
- AGENTS.md is a symlink to this file. Never replace with a regular file.

## Adding a provider

1. `src/<provider>.ts` implementing `PodProvider` (map statuses into
   `PodOrderStatus`; unknown → "unknown", never throw on status).
2. Add the name to `ProviderName` in types.ts + the factory in index.ts.
3. Document credentials env vars in README.
4. Keep drafts-by-default semantics whatever the provider's API does.

## Gotchas

- Printful `external_id` must be unique per store — pass the consumer's
  own order/generation ID through; a retry with the same ID fails
  loudly (good: no duplicate drafts).
- Print file URLs must be fetchable by the provider — signed URLs for
  private buckets, ≥ hours of TTL (Printful ingests within minutes).
- Printful catalog endpoints are public; order endpoints 401 without
  the key. `getCatalogVariant` intentionally runs keyless so config
  validation works before the operator creates the account.
- Printify: only the top-level blueprint LIST is public — provider/
  variant lookups and everything else 401 without `PRINTIFY_API_KEY`.
  A Printify item is (blueprint, printProviderId, variantId) — three
  keys; `PodOrderItem.printProviderId` is REQUIRED there. API-created
  orders sit `on-hold` (= draft) until `confirmOrder()`
  (send_to_production) — that call starts charging/production.
- Printify money fields are integer cents; adapters normalize to
  decimal strings (Printful's native format) at the boundary.

<!-- ECVP:BEGIN (managed by install-vet-protocol.sh — edit the yabro-hq copy, then re-run) -->
> **🛡️ EXTERNAL CODE VETTING PROTOCOL — mandatory, ALL projects
> (Albert, 2026-07-21).** NO external skill / plugin / MCP server /
> package / prompt / workflow enters any environment without passing
> the ECVP pipeline (run via **`/vet <url>`**; full spec in
> `docs/external-code-vetting-protocol.md` in this repo, or
> `~/.claude/docs/` for the global copy). Pipeline: intake
> (true-owner/typosquat check, trust tier) → scan (SkillSpector for
> skills, mcp-scan for MCP, Socket+OSV for packages) → full-file
> analysis (scanners are bypassable — a scan pass alone is NEVER a
> green light) → quarantine test in a secret-free throwaway session →
> merge pinned to exact SHA + row in the project's
> `docs/vetted-external-code.md` registry (present but unlisted =
> unvetted) → monitor (updates are new vettings). Hard rules: secrets
> and unvetted code never meet; unknown author + wants
> network/auth/secrets = automatic reject; Albert reads only
> plain-English GREEN/YELLOW/RED verdicts and makes the go/no-go call.
<!-- ECVP:END -->
