import type { Metadata } from "next";

import { OverviewView } from "@/components/dashboard/overview-view";

export const metadata: Metadata = { title: "Genel Bakış" };

export default function OverviewPage() {
  return <OverviewView />;
}
