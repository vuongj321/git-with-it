-- Phase 4: AI insights
ALTER TYPE "run_status" ADD VALUE IF NOT EXISTS 'ai_generating';
ALTER TYPE "job_type" ADD VALUE IF NOT EXISTS 'ai';

DO $$
BEGIN
  CREATE TYPE "insight_severity" AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "insight_category" AS ENUM ('debt', 'drift', 'risk', 'refactor', 'hotspot');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "insight_status" AS ENUM ('published', 'failed_validation', 'skipped_no_provider');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "insight_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "repo_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "run_id" uuid REFERENCES "analysis_runs"("id") ON DELETE SET NULL,
  "evidence_hash" text NOT NULL,
  "bundle" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "insight_evidence_repo_hash_uidx"
  ON "insight_evidence" ("repo_id", "evidence_hash");
CREATE INDEX IF NOT EXISTS "insight_evidence_repo_run_idx"
  ON "insight_evidence" ("repo_id", "run_id");

CREATE TABLE IF NOT EXISTS "insight_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "repo_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "run_id" uuid REFERENCES "analysis_runs"("id") ON DELETE SET NULL,
  "candidate_key" text NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "score" double precision NOT NULL DEFAULT 0,
  "from_sha" text NOT NULL,
  "to_sha" text NOT NULL,
  "entity_ids" jsonb DEFAULT '[]'::jsonb,
  "signal_refs" jsonb DEFAULT '[]'::jsonb,
  "evidence_hash" text,
  "status" text NOT NULL DEFAULT 'queued',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "insight_candidates_repo_run_key_uidx"
  ON "insight_candidates" ("repo_id", "run_id", "candidate_key");
CREATE INDEX IF NOT EXISTS "insight_candidates_repo_run_idx"
  ON "insight_candidates" ("repo_id", "run_id");

CREATE TABLE IF NOT EXISTS "insights" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "repo_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "run_id" uuid REFERENCES "analysis_runs"("id") ON DELETE SET NULL,
  "candidate_id" uuid REFERENCES "insight_candidates"("id") ON DELETE SET NULL,
  "evidence_id" uuid REFERENCES "insight_evidence"("id") ON DELETE SET NULL,
  "headline" text NOT NULL,
  "narrative" text NOT NULL,
  "severity" "insight_severity" NOT NULL,
  "category" "insight_category" NOT NULL,
  "entity_ids" jsonb DEFAULT '[]'::jsonb,
  "from_sha" text NOT NULL,
  "to_sha" text NOT NULL,
  "evidence_hash" text NOT NULL,
  "model" text,
  "provider" text,
  "prompt_hash" text,
  "confidence" double precision NOT NULL DEFAULT 0,
  "status" "insight_status" NOT NULL DEFAULT 'published',
  "suggested_actions" jsonb DEFAULT '[]'::jsonb,
  "cited_signals" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "insights_repo_run_hash_uidx"
  ON "insights" ("repo_id", "run_id", "evidence_hash");
CREATE INDEX IF NOT EXISTS "insights_repo_created_idx"
  ON "insights" ("repo_id", "created_at");
CREATE INDEX IF NOT EXISTS "insights_repo_severity_idx"
  ON "insights" ("repo_id", "severity");
