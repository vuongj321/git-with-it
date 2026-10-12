-- Drop columns: repositories.precision_mode, plans.stripe_price_id,
-- subscriptions.stripe_customer_id, subscriptions.stripe_subscription_id.

ALTER TABLE "repositories" DROP COLUMN IF EXISTS "precision_mode";

ALTER TABLE "plans" DROP COLUMN IF EXISTS "stripe_price_id";

ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "stripe_customer_id",
  DROP COLUMN IF EXISTS "stripe_subscription_id";
