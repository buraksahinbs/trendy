CREATE TABLE "order_webhooks" (
	"tenant_id" bigint PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"trendyol_webhook_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_received_at" timestamp with time zone,
	CONSTRAINT "order_webhooks_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "product_name" text;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "line_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "channel_id" smallint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cargo_tracking_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cargo_provider_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "origin_package_ids" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "order_webhooks" ADD CONSTRAINT "order_webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;