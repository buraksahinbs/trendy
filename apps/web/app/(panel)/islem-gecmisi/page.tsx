import type { Metadata } from "next";

import { JobsView } from "@/components/jobs/jobs-view";

export const metadata: Metadata = { title: "İşlem Geçmişi" };

export default function JobsPage() {
  return <JobsView />;
}
