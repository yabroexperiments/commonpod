# CLAUDE.md — commonpod

Provider-agnostic print-on-demand (POD) package. Sibling of
`commonpayment` — read that repo's CLAUDE.md for the shared library
conventions; this file covers only what differs.

## What this is

One `PodProvider` interface (src/types.ts) + per-provider adapters.
v1 surface: `getCatalogVariant` (config validation; keyless on
Printful), `createOrderDraft` (ALWAYS draft — confirming charges money
and is a separate explicit step), `getOrder`, optional `confirmOrder`.

Consumers: **furrybooth** (Printful, English market). Planned: a
Traditional-Chinese FurryBooth at hahadoggo.com/booth with an
Asia-region provider (2026-05 research candidates: 巨茂 / 理想 /
Doabag) — that's the whole reason this is a package and not app code.

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
