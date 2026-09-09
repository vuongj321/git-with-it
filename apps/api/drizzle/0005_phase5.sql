-- Phase 5: quotas/billing, feature flags, insight dismiss, GitHub App

DO $$
BEGIN
  CREATE TYPE "plan_tier" AS ENUM ('free', 'team', 'enterprise');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "subscription_status" AS ENUM ('active', 'past_due', 'canceled', 'trialing');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tier" "plan_tier" NOT NULL UNIQUE,
  "name" text NOT NULL,
  "max_repos" integer NOT NULL DEFAULT 3,
  "max_parse_minutes_month" integer NOT NULL DEFAULT 60,
  "max_ai_calls_month" integer NOT NULL DEFAULT 20,
  "stripe_price_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "plan_id" uuid NOT NULL REFERENCES "plans"("id"),
  "status" "subscription_status" NOT NULL DEFAULT 'active',
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "current_period_end" timestamp with time zone,
  "grace_until" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_org_uidx" ON "subscriptions" ("org_id");

CREATE TABLE IF NOT EXISTS "usage_counters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "period_ym" text NOT NULL,
  "repos" integer NOT NULL DEFAULT 0,
  "parse_minutes" integer NOT NULL DEFAULT 0,
  "ai_calls" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "usage_counters_org_period_uidx"
  ON "usage_counters" ("org_id", "period_ym");

-- Per-org / per-repo feature flags (SCIP, Temporal cutover hints, etc.)
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "features" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "features" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "repositories" ADD COLUMN IF NOT EXISTS "precision_mode" text NOT NULL DEFAULT 'structural';

-- Insight dismiss / snooze + feedback
ALTER TABLE "insights" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp with time zone;
ALTER TABLE "insights" ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp with time zone;
ALTER TABLE "insights" ADD COLUMN IF NOT EXISTS "feedback" text;
ALTER TABLE "insights" ADD COLUMN IF NOT EXISTS "feedback_note" text;

-- GitHub App installs (thin)
CREATE TABLE IF NOT EXISTS "github_app_installs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "installation_id" bigint NOT NULL,
  "account_login" text,
  "account_id" bigint,
  "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "suspended" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "github_app_installs_installation_uidx"
  ON "github_app_installs" ("installation_id");
CREATE INDEX IF NOT EXISTS "github_app_installs_org_idx"
  ON "github_app_installs" ("org_id");

CREATE TABLE IF NOT EXISTS "github_repo_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "repo_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "install_id" uuid NOT NULL REFERENCES "github_app_installs"("id") ON DELETE CASCADE,
  "github_repo_id" bigint NOT NULL,
  "full_name" text NOT NULL,
  "default_branch" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "github_repo_links_repo_uidx" ON "github_repo_links" ("repo_id");
CREATE UNIQUE INDEX IF NOT EXISTS "github_repo_links_gh_repo_uidx" ON "github_repo_links" ("github_repo_id");

-- Seed default plans
INSERT INTO "plans" ("tier", "name", "max_repos", "max_parse_minutes_month", "max_ai_calls_month")
VALUES
  ('free', 'Free', 3, 60, 20),
  ('team', 'Team', 25, 600, 500),
  ('enterprise', 'Enterprise', 1000, 100000, 100000)
ON CONFLICT ("tier") DO NOTHING;
