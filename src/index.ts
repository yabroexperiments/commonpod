/**
 * Public API for the `commonpod` package — provider-agnostic
 * print-on-demand integration. Sibling of `commonpayment` (payments)
 * and `commongenerator` (image generation) in the yabroexperiments
 * portfolio; same design stance: the package is storage-agnostic, the
 * consuming app owns the "which provider" decision and all persistence.
 *
 * Providers:
 *   - "printful" — international POD (FurryBooth English market).
 *   - (planned) an Asia-region provider for a Traditional-Chinese
 *     FurryBooth at hahadoggo.com/booth — candidates from the 2026-05
 *     gogo-gallery POD research: 巨茂 / 理想 / Doabag. Adding one =
 *     new adapter file + ProviderName member; consuming apps switch
 *     via their own settings/env, zero product-code changes.
 *
 * Usage (consuming app):
 *
 * ```ts
 * import { createProvider, isProviderName } from "commonpod";
 *
 * const provider = createProvider("printful"); // app decides the name
 * const draft = await provider.createOrderDraft({
 *   externalId: order.id,
 *   recipient: { name, address1, city, countryCode: "US", zip },
 *   items: [{ variantId: 1320, quantity: 1, printFileUrl: signedUrl }],
 * });
 * // draft.providerOrderId, draft.status === "draft", draft.costs
 * ```
 *
 * Drafts never auto-confirm — confirming (which charges the provider
 * account and starts fulfillment) is an explicit `confirmOrder()` call
 * or a human action in the provider dashboard.
 */

export * from "./types";

export {
  PrintfulProvider,
  createPrintfulProvider,
  type PrintfulProviderConfig,
} from "./printful";

import { createPrintfulProvider } from "./printful";
import type { PodProvider, ProviderName } from "./types";

const VALID_PROVIDERS: readonly ProviderName[] = ["printful"];

/** Type guard for provider names from settings rows / env / URLs. */
export function isProviderName(value: unknown): value is ProviderName {
  return (
    typeof value === "string" &&
    (VALID_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * Instantiate the matching POD adapter by name. Throws on unknown
 * names — surface as a config error rather than silently defaulting.
 */
export function createProvider(name: ProviderName): PodProvider {
  if (name === "printful") return createPrintfulProvider();
  throw new Error(
    `commonpod: unknown provider name "${name as string}". ` +
      `Valid: ${VALID_PROVIDERS.join(", ")}.`,
  );
}
