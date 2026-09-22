-- Existing email addresses have not been verified. Only successful challenges
-- set this timestamp; never backfill historical accounts as verified.
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
