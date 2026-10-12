-- Drop billing/quotas tables and enums.

DROP TABLE IF EXISTS "usage_counters";
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "plans";

DROP TYPE IF EXISTS "subscription_status";
DROP TYPE IF EXISTS "plan_tier";
