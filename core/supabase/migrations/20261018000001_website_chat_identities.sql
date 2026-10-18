-- Zarghoon AI — website chat identities.
--
-- Adds 'website_account': the id of a signed-in Zarghoon website account
-- (verified by the website's authentication). This is distinct from
-- 'website_visitor', which identifies an anonymous browser session by the
-- SHA-256 hash of its chat session token (the raw token is never stored).

alter table customer_identities drop constraint customer_identities_identity_type_check;
alter table customer_identities add constraint customer_identities_identity_type_check
  check (identity_type in ('website_visitor', 'website_account', 'instagram', 'facebook', 'tiktok', 'google', 'other'));
