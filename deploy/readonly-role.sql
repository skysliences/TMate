-- This legacy template intentionally refuses execution. Read all values from
-- your own .env with scripts/create-readonly-role.py; see docs/deployment.md.
-- Existing readers: add --grant-updates for SELECT on public.updates only.
DO $$ BEGIN
  RAISE EXCEPTION 'Use scripts/create-readonly-role.py with your own configuration; see docs/deployment.md';
END $$;
