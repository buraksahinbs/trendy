DROP TABLE "supplier_field_mappings" CASCADE;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "desi" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "supplier_products" ADD COLUMN "normalized_hash" text;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD COLUMN "normalize_issues" jsonb;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD COLUMN "normalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "mapping" jsonb;