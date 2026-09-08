# Backups

Game one's database died on day 10 to one bad command, with no backup anywhere.
This is what stands between that and a second time.

There are two layers, and they fail in different ways on purpose. The first
rewinds the clock; the second survives losing Railway.

## 1. Point-in-time recovery — the one that matters

Railway's Postgres runs continuous WAL archiving into a bucket it manages
(`Postgres-PITR`). Every committed transaction is shipped, so recovery is not
"restore last night", it is **restore to any second**.

```
railway postgres pitr status  --service Postgres
railway postgres pitr restore --service Postgres --at 2026-09-08T04:30:00Z
railway postgres pitr restore --service Postgres --at 30m     # relative also works
```

The thing to understand before you need it: **`restore` builds a NEW service.**
It does not overwrite the live database. You get `Postgres-restored-<date>`
alongside the real one, you look inside it, and only then do you decide to move
`DATABASE_URL` over. That is the right shape for a panic — nothing is destroyed
by attempting a recovery, so it is safe to try one while unsure.

So the recovery from a bad command is: note roughly when it ran, restore to a
minute before it, inspect, cut over.

### What is NOT available

On the Hobby plan the workspace's `subscriptionPlanLimit` reports
`volumes.maxBackupsCount: 0`. Every *snapshot* endpoint refuses with
`Not Authorized` or `OAUTH_INSUFFICIENT_GRANT` no matter which token is held:

- `railway postgres pitr backup create` — on-demand snapshots
- `railway postgres pitr schedule set` — the daily/weekly/monthly schedule
- the whole `volumeInstanceBackup*` GraphQL family

This is a **plan cap, not a permission problem**, and no token fixes it. Chasing
it with a better token is a dead end — that mistake already cost one session.
Upgrading Hobby → Pro ($5 → $20/month) turns all of the above on. Continuous
PITR, which is the part that actually saves you, works without it.

## 2. Nightly dumps — the one that survives Railway

PITR lives inside the Railway project. If the project or the volume is deleted,
its archive goes with it. So a second copy is written in a portable format.

`ops/backup/` is a small image deployed as a Railway **cron service** in the same
project. Once a night it runs `pg_dump`, checks the dump is readable, uploads it
to the `bascinet-backups` bucket, and drops all but the newest 30.

The dump is `pg_dump --format=custom`, which any Postgres can load — it does not
need Railway, this repo, or the same schema version.

```
npm run db:backups     # what is in the bucket, and how old the newest is
npm run db:backup      # run one now, out of band
```

The service is `backup` (id `2dff69fb-7aad-449a-962f-dd02bccd3bc4`), root
directory `/ops/backup`, schedule `0 4 * * *`, restart policy NEVER, watching
only `ops/backup/**` so ordinary pushes don't rebuild it.

**Railway will not run a cron service on demand.** Deploying one only schedules
it, and setting the schedule to a minute from now rolls over to *tomorrow* —
both were tried. The one lever that works is that a service with no schedule
runs as soon as it deploys, so `npm run db:backup` clears the schedule, deploys,
waits, and puts the schedule back on an EXIT trap. If that script is ever
interrupted in a way that skips the trap, check the schedule is still set.

`npm run db:backups` **exits non-zero if the newest dump is over 36 hours old.**
That is the whole point of it. The way a backup system fails is not loudly; it
is by going quiet months before anyone looks.

### Why the dump is verified before it is uploaded

`backup.sh` runs `pg_restore --list` on every dump and refuses to upload one
with no restorable entries. A truncated dump is the same size-ish and the same
filename as a good one, and you find out which it was on the worst possible day.

### The version pin

`ops/backup/Dockerfile` is `FROM postgres:18-alpine` because Railway runs
`ghcr.io/railwayapp-templates/postgres-ssl:18`. `pg_dump` refuses to dump a
server newer than itself, so **if Postgres is ever upgraded, that tag moves with
it** or every backup starts failing.

## Restoring a dump

`ops/backup/restore.sh` ships in the same image as `backup.sh` — same
`pg_restore` version, same credentials, same network — so the restore path is
never a machine you have to set up mid-incident. Run it on the backup service:

```
restore.sh --list                    # what is in the bucket
restore.sh bascinet-2026-09-08T040000Z.dump   # into DATABASE_URL
```

It refuses a Railway target unless `FORCE_PROD=1`, because recovery is when you
are most likely to be tired and pasting fast.

To pull a dump down to your own machine instead — no Postgres tooling required,
`scripts/db/bucket.py` signs its own S3 requests:

```
python3 scripts/db/bucket.py get bascinet-2026-09-08T040000Z.dump
```

Loading it locally does need a real `pg_restore` (`brew install libpq`).

## Where migrations fit

`./migrate.sh` calls `npm run db:backup` before `prisma migrate deploy`, so a
production migration is always preceded by a fresh dump. `npm run deploy` goes
through `migrate.sh`, so that path is covered too.

Note that PITR covers this case better than the dump does: if a migration eats a
column, the fix is to restore to the minute before the migration ran, not to
find last night's dump.

## Credentials

| Name | What it is | Used by |
|---|---|---|
| `RAILWAY_TOKEN` | **project** token | `railway redeploy`, `npm run db:backup` |
| `RAILWAY_API_TOKEN` | **account** token (railway.com/account/tokens) | reading the backup API |
| `S3_*` / `AWS_*` | the `bascinet-backups` bucket's S3 credentials | the cron service, `bucket.py` |

The two Railway tokens are not interchangeable and each fails in a way that
looks like the other's problem. A project token cannot read the backup API; an
account token cannot redeploy.

## If you are reading this during an incident

1. Don't run anything else against the database yet.
2. `railway postgres pitr restore --service Postgres --at <a minute before it broke>`
3. That makes a new service. Look in it. The live database is untouched.
4. Cut `DATABASE_URL` over only once you have seen the data is right.
