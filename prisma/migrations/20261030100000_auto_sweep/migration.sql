-- Automatic translation also covers content Shopify sends no webhooks for
-- (pages, blog posts, blogs) and changes whose webhook was missed: the
-- worker periodically looks for resources changed since this time. Set
-- when the merchant turns automatic translation on (so nothing changed
-- before that is picked up), advanced after each complete check, NULL
-- while it is off. A timestamp only, no merchant content. Row-level
-- security, policies and grants of ShopSettings are unchanged; reviewed
-- in docs/SECURITY_MODEL.md §5k.

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "autoSweptAt" TIMESTAMPTZ(3);
