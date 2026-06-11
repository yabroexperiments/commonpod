/**
 * Printful adapter — https://developers.printful.com (API v1).
 *
 * Credentials: `PRINTFUL_API_KEY` env var (a private token from
 * Printful → Settings → Stores → API). All order endpoints require it;
 * the public catalog endpoints (`GET /products*`) work without auth,
 * so `getCatalogVariant` degrades to keyless mode for config checks.
 *
 * Notes that drove the implementation:
 *   - `POST /orders` defaults to draft. We additionally pin
 *     `?confirm=false` so a future API default change can't silently
 *     start charging for fulfillment.
 *   - `external_id` must be unique per store — we pass the consuming
 *     app's order/generation ID through, so retries with the same ID
 *     fail loudly instead of duplicating drafts.
 *   - Printful downloads `files[].url` shortly after creation; signed
 *     URLs need a TTL of at least minutes (recommend 24h).
 *   - Status mapping: draft→draft, pending→pending, inprocess/partial
 *     →inprocess, fulfilled→fulfilled, canceled→canceled, failed→
 *     failed, anything else→unknown.
 */

import type {
  CatalogVariant,
  CreateOrderDraftInput,
  PodOrderResult,
  PodOrderStatus,
  PodProvider,
} from "./types";

const API_BASE = "https://api.printful.com";

export interface PrintfulProviderConfig {
  /** Defaults to process.env.PRINTFUL_API_KEY. */
  apiKey?: string;
  /** Override for tests. */
  apiBase?: string;
}

type PrintfulEnvelope<T> = {
  code: number;
  result: T;
  error?: { reason?: string; message?: string };
};

function mapStatus(s: unknown): PodOrderStatus {
  switch (String(s ?? "").toLowerCase()) {
    case "draft":
      return "draft";
    case "pending":
      return "pending";
    case "inprocess":
    case "partial":
    case "onhold":
      return "inprocess";
    case "fulfilled":
      return "fulfilled";
    case "canceled":
      return "canceled";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

type PrintfulOrder = {
  id: number;
  status?: string;
  dashboard_url?: string;
  costs?: {
    currency?: string;
    subtotal?: string;
    shipping?: string;
    tax?: string;
    total?: string;
  };
};

function toResult(order: PrintfulOrder): PodOrderResult {
  return {
    providerOrderId: String(order.id),
    status: mapStatus(order.status),
    costs: order.costs
      ? {
          currency: order.costs.currency ?? "USD",
          subtotal: order.costs.subtotal,
          shipping: order.costs.shipping,
          tax: order.costs.tax,
          total: order.costs.total,
        }
      : undefined,
    dashboardUrl:
      order.dashboard_url ??
      `https://www.printful.com/dashboard/default/orders?order_id=${order.id}`,
    raw: order,
  };
}

export class PrintfulProvider implements PodProvider {
  readonly name = "printful" as const;
  private readonly apiKey: string | undefined;
  private readonly apiBase: string;

  constructor(config: PrintfulProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.PRINTFUL_API_KEY;
    this.apiBase = config.apiBase ?? API_BASE;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    { auth = true }: { auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (auth) {
      if (!this.apiKey) {
        throw new Error(
          "commonpod/printful: PRINTFUL_API_KEY is not set (required for order endpoints).",
        );
      }
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as
      | PrintfulEnvelope<T>
      | null;
    if (!res.ok || !json || json.code >= 400) {
      const message =
        json?.error?.message ?? json?.result ?? `HTTP ${res.status}`;
      throw new Error(`commonpod/printful ${method} ${path}: ${String(message).slice(0, 300)}`);
    }
    return json.result;
  }

  async getCatalogVariant(
    productId: number,
    variantId: number,
  ): Promise<CatalogVariant | null> {
    // Public endpoint — works keyless, so config validation can run
    // before the operator has created a Printful account.
    type R = {
      variants: Array<{
        id: number;
        name: string;
        price: string;
        in_stock?: boolean;
      }>;
    };
    let result: R;
    try {
      result = await this.request<R>("GET", `/products/${productId}`, undefined, {
        auth: false,
      });
    } catch (err) {
      if (err instanceof Error && /404|not found/i.test(err.message)) return null;
      throw err;
    }
    const v = result.variants.find((x) => x.id === variantId);
    if (!v) return null;
    return {
      id: v.id,
      name: v.name,
      price: v.price,
      currency: "USD",
      inStock: v.in_stock,
    };
  }

  async createOrderDraft(input: CreateOrderDraftInput): Promise<PodOrderResult> {
    const order = await this.request<PrintfulOrder>(
      "POST",
      "/orders?confirm=false",
      {
        external_id: input.externalId,
        recipient: {
          name: input.recipient.name,
          address1: input.recipient.address1,
          address2: input.recipient.address2,
          city: input.recipient.city,
          state_code: input.recipient.stateCode,
          country_code: input.recipient.countryCode,
          zip: input.recipient.zip,
          email: input.recipient.email,
          phone: input.recipient.phone,
        },
        items: input.items.map((item) => ({
          variant_id: item.variantId,
          quantity: item.quantity,
          name: item.name,
          retail_price: item.retailPrice,
          files: [{ url: item.printFileUrl }],
        })),
        packing_slip: input.note ? { message: input.note } : undefined,
      },
    );
    return toResult(order);
  }

  async getOrder(providerOrderId: string): Promise<PodOrderResult> {
    const order = await this.request<PrintfulOrder>(
      "GET",
      `/orders/${providerOrderId}`,
    );
    return toResult(order);
  }

  async confirmOrder(providerOrderId: string): Promise<PodOrderResult> {
    const order = await this.request<PrintfulOrder>(
      "POST",
      `/orders/${providerOrderId}/confirm`,
    );
    return toResult(order);
  }
}

export function createPrintfulProvider(
  config?: PrintfulProviderConfig,
): PrintfulProvider {
  return new PrintfulProvider(config);
}
