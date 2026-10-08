# Form Builder API

## Database connection

The API reads `DATABASE_URL` and `DIRECT_URL` from the workspace-level `.env`
file. Use Supabase's transaction-mode pooler URL for `DATABASE_URL` and its
session-mode pooler URL for `DIRECT_URL`. Percent-encode reserved characters in
the database password when placing it in either URL.

If the local runtime does not trust the Supabase PostgreSQL certificate chain,
download the project's CA certificate from **Supabase Dashboard → Database →
Settings → SSL Configuration**, save it in this API directory, and set:

```env
DATABASE_CA_CERT_PATH=./prod-ca-2021.crt
```

When this variable is set, the runtime client and Prisma CLI use
`sslmode=verify-full` with that CA file. Certificate and hostname verification
remain enabled; do not use an insecure certificate-validation bypass.

The tables live in their own Postgres schema so other projects that share the
Supabase database (and run `prisma db push` against `public`) cannot drop them.
Add the schema name to both URLs:

```env
DATABASE_URL="...:6543/postgres?pgbouncer=true&schema=formbuilder"
DIRECT_URL="...:5432/postgres?schema=formbuilder"
```

## Accounts

Form builders sign in with email and password. Set a random secret of at least
32 characters in the workspace-level `.env`; the API refuses to start without it:

```env
JWT_SECRET="<random string>"
```

Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
Changing it signs everyone out. The first account to register takes ownership
of any forms created before accounts existed.

## Migrations

Apply migrations with `node scripts/apply-migrations.js`. It creates the schema
if needed and records applied migrations in that schema's `_prisma_migrations`.

Start the API from this directory with `npm run dev`.
