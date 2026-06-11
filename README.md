# commonpod

Provider-agnostic **print-on-demand** integration for the
yabroexperiments portfolio. Lets an application create and track POD
fulfillment orders behind one `PodProvider` interface, so switching or
adding providers never touches product code.

Sibling packages: [`commonpayment`](https://github.com/yabroexperiments/commonpayment)
(Taiwan payment aggregators) · [`commongenerator`](https://github.com/yabroexperiments/commongenerator)
(AI image generation engine).

## Why

FurryBooth (English/international market) fulfills via **Printful**.
A Traditional-Chinese FurryBooth at `hahadoggo.com/booth` is a likely
future spin-up, and Printful's Asia coverage/economics may not fit —
candidates from the 2026-05 POD research include 巨茂 / 理想 / Doabag.
One interface now means a future Asia adapter is a single new file,
and each app picks its provider via its own settings/env.

## Providers

| Name | Status | Credentials |
|---|---|---|
| `printful` | ✅ v1 | `PRINTFUL_API_KEY` env (catalog lookups work keyless) |
| `printify` | ✅ v1 | `PRINTIFY_API_KEY` (+ optional `PRINTIFY_SHOP_ID`; first shop auto-resolved). All endpoints need the key. |

Provider model note: a Printful item is `(productId, variantId)`; a
Printify item is `(productId=blueprint, printProviderId, variantId)` —
set `printProviderId` on `PodOrderItem` / pass it to
`getCatalogVariant` when using Printify. API-created Printify orders
sit `on-hold` (= our `draft`) until `confirmOrder()` sends them to
production.

## Install

```bash
npm install github:yabroexperiments/commonpod
```

Bumps re-resolve `#main`; commit the updated `package-lock.json`.

## Quick start

```ts
import { createProvider } from "commonpod";

const pod = createProvider("printful");

// Validate configured catalog IDs (public endpoint, no key needed):
const variant = await pod.getCatalogVariant(19, 1320); // 11oz mug

// Create a DRAFT order (never auto-confirms):
const draft = await pod.createOrderDraft({
  externalId: myOrderId,                  // your ID, for cross-reference
  recipient: { name, address1, city, countryCode: "US", zip },
  items: [{ variantId: 1320, quantity: 1, printFileUrl: signedUrl }],
});

// Later: pod.getOrder(draft.providerOrderId) / pod.confirmOrder(...)
```

Print files must be fetchable by the provider — for private storage
buckets pass a **signed URL** (≥ a few hours TTL; 24h recommended).

## Design rules (same as commonpayment)

- **Storage-agnostic**: the package never reads your DB/settings to
  pick a provider; adapters read only their own credential env vars.
- **Drafts by default**: `createOrderDraft` pins draft mode; confirming
  (= money + production) is always an explicit separate step.
- Raw provider responses ride along in `result.raw` for debugging —
  never branch on them in app code.
