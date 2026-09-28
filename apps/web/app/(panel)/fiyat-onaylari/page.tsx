import type { Metadata } from "next";
import { Suspense } from "react";

import { PriceReviewsView } from "@/components/reviews/price-reviews-view";

export const metadata: Metadata = { title: "Fiyat Onayları" };

export default function PriceReviewsPage() {
  return (
    <Suspense>
      <PriceReviewsView />
    </Suspense>
  );
}
