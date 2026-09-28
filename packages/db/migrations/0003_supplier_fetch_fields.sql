ALTER TABLE "suppliers" ADD COLUMN "external_id_path" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "last_attempt_at" timestamp with time zone;