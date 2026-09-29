# Migrations

`001_init.sql` is the schema. It is plain SQL on purpose: the same file must run
against a hosted Postgres and against PGlite, which is a real Postgres compiled
to WebAssembly and is what the tests use, so the tests exercise the actual
schema rather than a mock of it.

The chain is the source of truth for who owns a name. This database is an index
and a cache, so a lost row costs a re-read, not a name.
