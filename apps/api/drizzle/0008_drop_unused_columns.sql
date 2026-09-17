-- Remove columns for features that were never wired up:
--   * repositories.precision_mode  (SCIP precision tier; parser is structural/tree-sitter only)
--   * plans.stripe_price_id + subscriptions.stripe_* (no payment provider is wired)

ALTER TABLE "repositories" DROP COLUMN IF EXISTS "precision_mode";

ALTER TABLE "plans" DROP COLUMN IF EXISTS "stripe_price_id";

ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "stripe_customer_id",
  DROP COLUMN IF EXISTS "stripe_subscription_id";
