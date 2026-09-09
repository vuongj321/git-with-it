ALTER TYPE "public"."run_status" ADD VALUE IF NOT EXISTS 'enumerating';--> statement-breakpoint
ALTER TYPE "public"."run_status" ADD VALUE IF NOT EXISTS 'evolving';--> statement-breakpoint
ALTER TYPE "public"."run_status" ADD VALUE IF NOT EXISTS 'evolution_ready';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE IF NOT EXISTS 'enumerate_sample';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE IF NOT EXISTS 'parse_commit';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE IF NOT EXISTS 'graph_write_delta';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE IF NOT EXISTS 'checkpoint';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE IF NOT EXISTS 'evolve';--> statement-breakpoint
CREATE TYPE "public"."evolution_event_type" AS ENUM('dependency_added', 'dependency_removed', 'cycle_introduced', 'cycle_resolved', 'module_added', 'module_removed', 'rename_detected', 'coupling_spike');--> statement-breakpoint
CREATE TYPE "public"."evolution_severity" AS ENUM('info', 'low', 'medium', 'high');--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN IF NOT EXISTS "sample_shas" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN IF NOT EXISTS "commits_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN IF NOT EXISTS "commits_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN IF NOT EXISTS "sample_config" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "rename_of" uuid;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"parent_shas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"authored_at" timestamp with time zone,
	"message" text,
	"topo_index" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commit_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"topo_index" bigint NOT NULL,
	"reason" text DEFAULT 'window' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_renames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"from_sha" text NOT NULL,
	"to_sha" text NOT NULL,
	"from_fqn" text NOT NULL,
	"to_fqn" text NOT NULL,
	"from_path" text,
	"to_path" text,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'git_rename' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "graph_deltas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"run_id" uuid,
	"from_sha" text NOT NULL,
	"to_sha" text NOT NULL,
	"from_topo" bigint NOT NULL,
	"to_topo" bigint NOT NULL,
	"artifact_uri" text NOT NULL,
	"nodes_added" integer DEFAULT 0 NOT NULL,
	"nodes_removed" integer DEFAULT 0 NOT NULL,
	"edges_added" integer DEFAULT 0 NOT NULL,
	"edges_removed" integer DEFAULT 0 NOT NULL,
	"is_checkpoint" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evolution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"run_id" uuid,
	"from_sha" text NOT NULL,
	"to_sha" text NOT NULL,
	"authored_at" timestamp with time zone,
	"type" "evolution_event_type" NOT NULL,
	"severity" "evolution_severity" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"entity_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commits" ADD CONSTRAINT "commits_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commit_samples" ADD CONSTRAINT "commit_samples_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commit_samples" ADD CONSTRAINT "commit_samples_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_renames" ADD CONSTRAINT "entity_renames_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_renames" ADD CONSTRAINT "entity_renames_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_deltas" ADD CONSTRAINT "graph_deltas_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_deltas" ADD CONSTRAINT "graph_deltas_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evolution_events" ADD CONSTRAINT "evolution_events_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evolution_events" ADD CONSTRAINT "evolution_events_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commits_repo_sha_uidx" ON "commits" USING btree ("repo_id","sha");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commits_repo_topo_idx" ON "commits" USING btree ("repo_id","topo_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commits_repo_authored_idx" ON "commits" USING btree ("repo_id","authored_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commit_samples_run_sha_uidx" ON "commit_samples" USING btree ("run_id","sha");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commit_samples_repo_run_idx" ON "commit_samples" USING btree ("repo_id","run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_renames_repo_sha_idx" ON "entity_renames" USING btree ("repo_id","to_sha");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "graph_deltas_repo_from_to_uidx" ON "graph_deltas" USING btree ("repo_id","from_sha","to_sha");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_deltas_repo_topo_idx" ON "graph_deltas" USING btree ("repo_id","to_topo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_events_repo_type_idx" ON "evolution_events" USING btree ("repo_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_events_repo_shas_idx" ON "evolution_events" USING btree ("repo_id","from_sha","to_sha");
