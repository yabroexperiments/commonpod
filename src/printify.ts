/**
 * Printify adapter — https://developers.printify.com (API v1).
 *
 * Credentials: `PRINTIFY_API_KEY` (Personal Access Token from
 * Printify → My Profile → Connections) — required for ALL endpoints
 * including catalog (only the top-level blueprint list is public).
 * Plus `PRINTIFY_SHOP_ID`; when absent the adapter resolves the
 * account's first shop via `GET /v1/shops.json` and caches it.
 *
 * Model differences vs Printful that drove the shared types:
 *   - A catalog item is (blueprint_id, print_provider_id, variant_id)
 *     — three keys, not two. `PodOrderItem.productId` carries the
 *     blueprint and `printProviderId` the producer.
 *   - API-created orders are NOT submitted to production — they sit
 *     `on-hold` until `POST .../send_to_production.json`. That IS our
 *     draft semantics; `confirmOrder` maps to send_to_production.
 *   - Money is integer cents (Printful uses decimal strings) —
 *     normalized to decimal strings here.
 *   - Recipient is first_name/last_name (we split `name` on the last
 *     space) and `country` is the ISO alpha-2 in a field named
 *     `country`, with `region` for state/province.
 *
 * Status mapping (Printify → PodOrderStatus):
 *   on-hold → draft · pending/payment-not-received → pending ·
 *   checking-quality/quality-approved/ready-for-production/
 *   sending-to-production/in-production/partially-fulfilled → inprocess ·
 *   fulfilled → fulfilled · canceled → canceled ·
 *   quality-declined/has-issues → failed · else → unknown
 */

import type {
  CatalogVariant,
  CreateOrderDraftInput,
  PodOrderResult,
  PodOrderStatus,
  PodProvider,
} from "./types";

const API_BASE = "https://api.printify.com/v1";

export interface PrintifyProviderConfig {
  /** Defaults to process.env.PRINTIFY_API_KEY. */
  apiKey?: string;
  /** Defaults to process.env.PRINTIFY_SHOP_ID, else the account's
   *  first shop (resolved once and cached on the instance). */
  shopId?: string;
  /** Override for tests. */
  apiBase?: string;
}

function mapStatus(s: unknown): PodOrderStatus {
  switch (String(s ?? "").toLowerCase()) {
    case "on-hold":
      return "draft";
    case "pending":
    case "payment-not-received":
      return "pending";
    case "checking-quality":
    case "quality-approved":
    case "ready-for-production":
    case "sending-to-production":
    case "in-production":
    case "partially-fulfilled":
      return "inprocess";
    case "fulfilled":
      return "fulfilled";
    case "canceled":
      return "canceled";
    case "quality-declined":
    case "has-issues":
      return "failed";
    default:
      return "unknown";
  }
}

function centsToDecimal(v: unknown): string | undefined {
  return typeof v === "number" ? (v / 100).toFixed(2) : undefined;
}

/** Split a single display name into Printify's first/last fields.
 *  Last token = last_name; Printify requires both to be non-empty. */
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: "-" };
  return {
    first: parts.slice(0, -1).join(" "),
    last: parts[parts.length - 1]!,
  };
}

type PrintifyOrder = {
  id: string;
  status?: string;
  total_price?: number;
  total_shipping?: number;
  total_tax?: number;
};

export class PrintifyProvider implements PodProvider {
  readonly name = "printify" as const;
  private readonly apiKey: string | undefined;
  private readonly apiBase: string;
  private shopId: string | undefined;

  constructor(config: PrintifyProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.PRINTIFY_API_KEY;
    this.shopId = config.shopId ?? process.env.PRINTIFY_SHOP_ID;
    this.apiBase = config.apiBase ?? API_BASE;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error(
        "commonpod/printify: PRINTIFY_API_KEY is not set (required for all Printify endpoints).",
      );
    }
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // Printify asks API clients to identify themselves.
        "User-Agent": "commonpod (yabroexperiments)",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as
      | (T & { error?: unknown; errors?: unknown })
      | null;
    if (!res.ok || (json && (json.error || json.errors))) {
      const message = json
        ? JSON.stringify(json.error ?? json.errors ?? json)
        : `HTTP ${res.status}`;
      throw new Error(
        `commonpod/printify ${method} ${path}: ${message.slice(0, 300)}`,
      );
    }
    if (!json) throw new Error(`commonpod/printify ${method} ${path}: empty response`);
    return json;
  }

  private async resolveShopId(): Promise<string> {
    if (this.shopId) return this.shopId;
    const shops = await this.request<Array<{ id: number; title: string }>>(
      "GET",
      "/shops.json",
    );
    const first = shops[0];
    if (!first) {
      throw new Error(
        "commonpod/printify: account has no shops. Create one in the Printify dashboard or set PRINTIFY_SHOP_ID.",
      );
    }
    this.shopId = String(first.id);
    return this.shopId;
  }

  async getCatalogVariant(
    productId: number,
    variantId: number,
    opts?: { printProviderId?: number },
  ): Promise<CatalogVariant | null> {
    const pp = opts?.printProviderId;
    if (!pp) {
      throw new Error(
        "commonpod/printify: getCatalogVariant needs opts.printProviderId (a Printify variant lives under blueprint + print provider).",
      );
    }
    type R = {
      variants: Array<{
        id: number;
        title: string;
        // catalog variants endpoint exposes no wholesale price field
        // consistently across providers; cost comes back on the order.
        price?: number;
        is_enabled?: boolean;
        is_available?: boolean;
      }>;
    };
    let result: R;
    try {
      result = await this.request<R>(
        "GET",
        `/catalog/blueprints/${productId}/print_providers/${pp}/variants.json`,
      );
    } catch (err) {
      if (err instanceof Error && /404|not found/i.test(err.message)) return null;
      throw err;
    }
    const v = result.variants.find((x) => x.id === variantId);
    if (!v) return null;
    return {
      id: v.id,
      name: v.title,
      price: centsToDecimal(v.price) ?? "0.00",
      currency: "USD",
      inStock: v.is_available ?? v.is_enabled,
    };
  }

  async createOrderDraft(input: CreateOrderDraftInput): Promise<PodOrderResult> {
    const shopId = await this.resolveShopId();

    for (const item of input.items) {
      if (!item.productId || !item.printProviderId) {
        throw new Error(
          "commonpod/printify: each item needs productId (blueprint) AND printProviderId.",
        );
      }
    }

    const { first, last } = splitName(input.recipient.name);
    // API-created orders stay on-hold (= draft) until an explicit
    // send_to_production — no confirm flag exists or is needed.
    const order = await this.request<PrintifyOrder>(
      "POST",
      `/shops/${shopId}/orders.json`,
      {
        external_id: input.externalId,
        label: input.note?.slice(0, 100),
        line_items: input.items.map((item) => ({
          blueprint_id: item.productId,
          print_provider_id: item.printProviderId,
          variant_id: item.variantId,
          quantity: item.quantity,
          print_areas: { front: item.printFileUrl },
        })),
        shipping_method: 1, // standard
        send_shipping_notification: false,
        address_to: {
          first_name: first,
          last_name: last,
          email: input.recipient.email,
          phone: input.recipient.phone,
          country: input.recipient.countryCode,
          region: input.recipient.stateCode ?? "",
          address1: input.recipient.address1,
          address2: input.recipient.address2,
          city: input.recipient.city,
          zip: input.recipient.zip,
        },
      },
    );
    // Create response can be sparse — read the order back for status+costs.
    return this.getOrder(order.id);
  }

  async getOrder(providerOrderId: string): Promise<PodOrderResult> {
    const shopId = await this.resolveShopId();
    const order = await this.request<PrintifyOrder>(
      "GET",
      `/shops/${shopId}/orders/${providerOrderId}.json`,
    );
    return {
      providerOrderId: order.id,
      status: mapStatus(order.status),
      costs: {
        currency: "USD",
        subtotal: centsToDecimal(order.total_price),
        shipping: centsToDecimal(order.total_shipping),
        tax: centsToDecimal(order.total_tax),
      },
      dashboardUrl: "https://printify.com/app/orders",
      raw: order,
    };
  }

  /** Submit to production — this is the money/production step. */
  async confirmOrder(providerOrderId: string): Promise<PodOrderResult> {
    const shopId = await this.resolveShopId();
    await this.request(
      "POST",
      `/shops/${shopId}/orders/${providerOrderId}/send_to_production.json`,
    );
    return this.getOrder(providerOrderId);
  }
}

export function createPrintifyProvider(
  config?: PrintifyProviderConfig,
): PrintifyProvider {
  return new PrintifyProvider(config);
}
