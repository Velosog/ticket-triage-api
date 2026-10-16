-- Runs once, when the PostgreSQL volume is first initialised.
-- The test suite uses this separate database (its name must end in _test).
CREATE DATABASE ticket_triage_test OWNER triage;
