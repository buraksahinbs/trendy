import type { Metadata } from "next";

import { PricingRulesView } from "@/components/pricing/pricing-rules-view";

export const metadata: Metadata = { title: "Fiyat Kuralları" };

export default function PricingRulesPage() {
  return <PricingRulesView />;
}
