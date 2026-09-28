ALTER TABLE "orders" ADD COLUMN "pii_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "order_pii_retention_days" integer DEFAULT 180 NOT NULL;