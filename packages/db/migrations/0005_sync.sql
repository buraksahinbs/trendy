ALTER TYPE "public"."listing_status" ADD VALUE 'blacklisted';--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "ty_content_id" bigint;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "ty_on_sale" boolean;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "lock_reason" text;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "ty_price" integer;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "ty_list_price" integer;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "ty_stock" integer;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "ty_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "last_batch_request_id" text;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sync_env" "trendyol_env" DEFAULT 'prod' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "safety_stock" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "max_auto_change_rate" numeric(5, 4) DEFAULT 0.3 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "fx_rates" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;