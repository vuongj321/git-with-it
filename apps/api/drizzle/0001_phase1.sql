ALTER TYPE "public"."run_status" ADD VALUE IF NOT EXISTS 'parsing';--> statement-breakpoint
ALTER TYPE "public"."run_status" ADD VALUE IF NOT EXISTS 'graph_writing';--> statement-breakpoint
ALTER TYPE "public"."run_status" ADD VALUE IF NOT EXISTS 'graph_ready';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE IF NOT EXISTS 'parse';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE IF NOT EXISTS 'graph_write';--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('package', 'file', 'class', 'interface', 'function', 'method', 'variable');--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN IF NOT EXISTS "analyzer_version" text;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN IF NOT EXISTS "commit_sha" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"repo_id" uuid NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"fqn" text NOT NULL,
	"language" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"first_seen_sha" text,
	"last_seen_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_appearances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"path" text NOT NULL,
	"content_hash" text,
	"blob_oid" text,
	"loc" integer,
	"start_line" integer,
	"end_line" integer,
	"analyzer_version" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_appearances" ADD CONSTRAINT "entity_appearances_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_appearances" ADD CONSTRAINT "entity_appearances_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entities_repo_kind_fqn_uidx" ON "entities" USING btree ("repo_id","kind","fqn");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_repo_fqn_idx" ON "entities" USING btree ("repo_id","fqn");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_appearances_entity_sha_path_uidx" ON "entity_appearances" USING btree ("entity_id","commit_sha","path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_appearances_repo_sha_idx" ON "entity_appearances" USING btree ("repo_id","commit_sha");
