-- Phase 5b: outbound webhook endpoints for insight.created etc.

CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "secret" text,
  "events" jsonb NOT NULL DEFAULT '["insight.created"]'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "webhook_endpoints_org_idx" ON "webhook_endpoints" ("org_id");
