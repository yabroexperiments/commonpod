/**
 * POD (print-on-demand) provider abstraction — sibling of
 * `commonpayment`'s PaymentProvider contract, same design stance:
 *
 *   - **Storage-agnostic.** The package never reads the host app's DB
 *     or settings to PICK a provider; the consuming app decides and
 *     calls `createProvider(name)`. Adapters read only their own
 *     credentials from env (`PRINTFUL_API_KEY`, …).
 *   - **Thin v1 surface.** Catalog lookup, draft-order creation,
 *     order read, optional confirm. Webhooks, shipping-rate quotes,
 *     and mockup generation are deliberate later additions.
 *
 * Why this exists (Albert, 2026-06-11): multiple POD providers are on
 * the horizon — Printful for FurryBooth's English/international
 * market, and potentially an Asia-region provider for a Traditional-
 * Chinese FurryBooth at hahadoggo.com/booth (candidates from the
 * 2026-05 gogo-gallery POD research: 巨茂 / 理想 / Doabag). One
 * interface keeps the product code provider-neutral.
 */

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

/** Stable identifier per supported fulfillment provider. Persisted in
 *  consuming apps' DB/settings — keep values stable. */
export type ProviderName = "printful" | "printify";

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Shipping recipient. Field names follow the lowest common
 *  denominator across providers (Printful's shape, which is itself the
 *  industry-standard schema). */
export interface PodRecipient {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  /** State/province code where the country requires one (US/CA/AU…). */
  stateCode?: string;
  /** ISO 3166-1 alpha-2, e.g. "US", "TW", "JP". */
  countryCode: string;
  zip?: string;
  email?: string;
  phone?: string;
}

export interface PodOrderItem {
  /** Provider catalog variant ID (e.g. Printful variant 1320 =
   *  11oz mug; Printify variant within a blueprint+print-provider). */
  variantId: number;
  /** Catalog product ID. Printful infers it from the variant, so it's
   *  optional there; Printify REQUIRES it (blueprint_id). */
  productId?: number;
  /** Printify-only: which print provider produces the blueprint.
   *  Printful ignores this. */
  printProviderId?: number;
  quantity: number;
  /**
   * Publicly fetchable URL of the print file. For private storage
   * (e.g. a Supabase `originals` bucket) pass a SIGNED url with
   * enough TTL for the provider to ingest it (Printful downloads
   * within minutes of order creation; 24h is comfortable).
   */
  printFileUrl: string;
  /** Optional display name shown in the provider dashboard. */
  name?: string;
  /** Optional retail price (decimal string, e.g. "39.95") shown on
   *  packing slips where the provider supports it. */
  retailPrice?: string;
}

export interface CreateOrderDraftInput {
  /** The consuming app's own order/generation ID — stored as the
   *  provider's external_id so dashboards cross-reference. */
  externalId: string;
  recipient: PodRecipient;
  items: PodOrderItem[];
  /** Optional packing-slip / dashboard note. */
  note?: string;
}

/** Provider-neutral order status. Adapters map their own enums into
 *  this; unknown provider states map to "unknown" (never throw on a
 *  status we haven't seen). */
export type PodOrderStatus =
  | "draft"
  | "pending"
  | "inprocess"
  | "fulfilled"
  | "canceled"
  | "failed"
  | "unknown";

export interface PodOrderResult {
  /** Provider's order ID (string — Printful's is numeric, others may
   *  not be). */
  providerOrderId: string;
  status: PodOrderStatus;
  /** Item + shipping + tax costs as reported by the provider, if
   *  available at this stage. Decimal strings in `currency`. */
  costs?: {
    currency: string;
    subtotal?: string;
    shipping?: string;
    tax?: string;
    total?: string;
  };
  /** Deep link to the order in the provider dashboard, when the
   *  adapter can construct one. */
  dashboardUrl?: string;
  /** The provider's raw response — for logging/debugging only; do not
   *  branch on it in app code. */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface CatalogVariant {
  id: number;
  name: string;
  /** Provider's wholesale price as a decimal string. */
  price: string;
  currency: string;
  inStock?: boolean;
}

// ---------------------------------------------------------------------------
// The provider contract
// ---------------------------------------------------------------------------

export interface PodProvider {
  readonly name: ProviderName;

  /**
   * Look up one catalog variant (verify an ID, read current wholesale
   * price/stock). Returns null when the variant doesn't exist —
   * callers use this for config validation, so "not found" is a
   * value, not an exception.
   *
   * Provider notes: Printful works keyless here; Printify requires
   * `PRINTIFY_API_KEY` AND `opts.printProviderId`.
   */
  getCatalogVariant(
    productId: number,
    variantId: number,
    opts?: { printProviderId?: number },
  ): Promise<CatalogVariant | null>;

  /**
   * Create an order as a DRAFT — never auto-confirms. Confirming
   * (= charging the provider account + starting fulfillment) is a
   * separate explicit call or a human action in the dashboard.
   */
  createOrderDraft(input: CreateOrderDraftInput): Promise<PodOrderResult>;

  /** Read an order's current state. */
  getOrder(providerOrderId: string): Promise<PodOrderResult>;

  /**
   * Confirm a draft for fulfillment (charges the provider account).
   * Optional: adapters for providers without an API confirm step may
   * omit it — callers must feature-check before use.
   */
  confirmOrder?(providerOrderId: string): Promise<PodOrderResult>;
}
