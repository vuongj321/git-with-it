-- Personal workspaces + team org email invites

DO $$ BEGIN
  CREATE TYPE "org_kind" AS ENUM ('personal', 'team');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "invite_status" AS ENUM ('pending', 'accepted', 'revoked', 'expired');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "kind" "org_kind" NOT NULL DEFAULT 'team';

CREATE TABLE IF NOT EXISTS "org_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" "membership_role" NOT NULL DEFAULT 'member',
  "token" text NOT NULL,
  "invited_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" "invite_status" NOT NULL DEFAULT 'pending',
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "accepted_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_invites_token_uidx" ON "org_invites" ("token");
CREATE INDEX IF NOT EXISTS "org_invites_org_idx" ON "org_invites" ("org_id");
CREATE INDEX IF NOT EXISTS "org_invites_email_idx" ON "org_invites" ("email");
