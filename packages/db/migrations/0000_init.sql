CREATE TYPE "public"."batch_status" AS ENUM('pending', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."batch_type" AS ENUM('create', 'update', 'price_inventory');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'success', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('unknown', 'pending', 'approved', 'rejected', 'locked', 'archived');--> statement-breakpoint
CREATE TYPE "public"."listing_tier" AS ENUM('50k', '75k', '150k', '500k', 'unlimited');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."price_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."pricing_scope" AS ENUM('brand', 'category', 'supplier', 'general');--> statement-breakpoint
CREATE TYPE "public"."trendyol_env" AS ENUM('stage', 'prod');--> statement-breakpoint
CREATE TABLE "channel_listings" (
	"variant_id" bigint PRIMARY KEY NOT NULL,
	"tenant_id" bigint NOT NULL,
	"ty_status" "listing_status" DEFAULT 'unknown' NOT NULL,
	"last_sent_price" integer,
	"last_sent_list_price" integer,
	"last_sent_stock" integer,
	"last_sent_at" timestamp with time zone,
	"reject_reasons" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"job_type" text NOT NULL,
	"status" "job_status" NOT NULL,
	"summary" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"order_id" bigint NOT NULL,
	"line_id" text NOT NULL,
	"barcode" text,
	"stock_code" text,
	"quantity" integer NOT NULL,
	"line_unit_price" integer,
	"commission_rate" numeric(6, 2),
	"vat_rate" smallint
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"shipment_package_id" text NOT NULL,
	"order_number" text NOT NULL,
	"status" text NOT NULL,
	"package_total_price" integer,
	"last_modified_at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_reviews" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"variant_id" bigint NOT NULL,
	"old_price" integer,
	"new_price" integer NOT NULL,
	"new_list_price" integer NOT NULL,
	"change_rate" numeric(8, 4) NOT NULL,
	"rule_id" bigint,
	"status" "price_review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" bigint
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pricing_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"scope" "pricing_scope" NOT NULL,
	"scope_key" text,
	"multiplier" numeric(8, 4) NOT NULL,
	"add_fixed" integer DEFAULT 0 NOT NULL,
	"rounding" jsonb DEFAULT '{"kind":"none"}'::jsonb NOT NULL,
	"min_margin_rate" numeric(6, 4),
	"commission_rate" numeric(6, 4),
	"min_price" integer,
	"max_price" integer,
	"list_price_rule" jsonb DEFAULT '{"kind":"same"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"supplier_id" bigint,
	"product_main_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"brand_name" text,
	"source_category" text,
	"brand_id_ty" integer,
	"category_id_ty" integer,
	"origin" text,
	"vat_rate" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_field_mappings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_field_mappings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"target_field" text NOT NULL,
	"source_path" text,
	"constant_value" text,
	"transform" jsonb
);
--> statement-breakpoint
CREATE TABLE "supplier_products" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"external_id" text NOT NULL,
	"raw" jsonb NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"missing_since" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "suppliers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"name" text NOT NULL,
	"feed_url" text NOT NULL,
	"auth_enc" text,
	"encoding" text,
	"item_path" text,
	"schedule_cron" text DEFAULT '*/30 * * * *' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sync_paused" boolean DEFAULT false NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_fetched_at" timestamp with time zone,
	"last_item_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"tenant_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"last_synced_until" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_cursors_tenant_id_kind_pk" PRIMARY KEY("tenant_id","kind")
);
--> statement-breakpoint
CREATE TABLE "tenant_members" (
	"tenant_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_members_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tenants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"listing_limit_tier" "listing_tier" DEFAULT '50k' NOT NULL,
	"sync_paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trendyol_credentials" (
	"tenant_id" bigint NOT NULL,
	"env" "trendyol_env" NOT NULL,
	"seller_id" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"api_secret_enc" text NOT NULL,
	"verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trendyol_credentials_tenant_id_env_pk" PRIMARY KEY("tenant_id","env")
);
--> statement-breakpoint
CREATE TABLE "ty_batches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ty_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"type" "batch_type" NOT NULL,
	"batch_request_id" text NOT NULL,
	"item_count" integer NOT NULL,
	"status" "batch_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "variants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"supplier_product_id" bigint,
	"barcode" text NOT NULL,
	"stock_code" text,
	"cost_price" integer,
	"currency" char(3) DEFAULT 'TRY' NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_logs" ADD CONSTRAINT "job_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_reviews" ADD CONSTRAINT "price_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_reviews" ADD CONSTRAINT "price_reviews_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_reviews" ADD CONSTRAINT "price_reviews_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_field_mappings" ADD CONSTRAINT "supplier_field_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_field_mappings" ADD CONSTRAINT "supplier_field_mappings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trendyol_credentials" ADD CONSTRAINT "trendyol_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ty_batches" ADD CONSTRAINT "ty_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_supplier_product_id_supplier_products_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."supplier_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_listings_tenant_id_ty_status_index" ON "channel_listings" USING btree ("tenant_id","ty_status");--> statement-breakpoint
CREATE INDEX "job_logs_tenant_id_started_at_index" ON "job_logs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_order_id_line_id_index" ON "order_lines" USING btree ("order_id","line_id");--> statement-breakpoint
CREATE INDEX "order_lines_tenant_id_barcode_index" ON "order_lines" USING btree ("tenant_id","barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_id_shipment_package_id_index" ON "orders" USING btree ("tenant_id","shipment_package_id");--> statement-breakpoint
CREATE INDEX "orders_tenant_id_last_modified_at_index" ON "orders" USING btree ("tenant_id","last_modified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_reviews_pending_uq" ON "price_reviews" USING btree ("variant_id") WHERE "price_reviews"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "price_reviews_tenant_id_status_index" ON "price_reviews" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_rules_scope_uq" ON "pricing_rules" USING btree ("tenant_id","scope","scope_key") WHERE "pricing_rules"."scope_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_rules_general_uq" ON "pricing_rules" USING btree ("tenant_id") WHERE "pricing_rules"."scope" = 'general';--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_id_product_main_id_index" ON "products" USING btree ("tenant_id","product_main_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_field_mappings_supplier_id_target_field_index" ON "supplier_field_mappings" USING btree ("supplier_id","target_field");--> statement-breakpoint
CREATE INDEX "supplier_field_mappings_tenant_id_index" ON "supplier_field_mappings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_products_supplier_id_external_id_index" ON "supplier_products" USING btree ("supplier_id","external_id");--> statement-breakpoint
CREATE INDEX "supplier_products_tenant_id_index" ON "supplier_products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_id_index" ON "suppliers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_members_user_id_index" ON "tenant_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ty_batches_tenant_id_batch_request_id_index" ON "ty_batches" USING btree ("tenant_id","batch_request_id");--> statement-breakpoint
CREATE INDEX "ty_batches_status_sent_at_index" ON "ty_batches" USING btree ("status","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "variants_tenant_id_barcode_index" ON "variants" USING btree ("tenant_id","barcode");--> statement-breakpoint
CREATE INDEX "variants_product_id_index" ON "variants" USING btree ("product_id");