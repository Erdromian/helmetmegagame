# The backup runner. Deployed to Railway as a cron service in the same project
# as the database, so pg_dump talks to Postgres over the internal network.
#
# The base image pins the client to the SERVER's major version. Railway runs
# ghcr.io/railwayapp-templates/postgres-ssl:18, and pg_dump refuses to dump a
# server newer than itself — so if the database is ever upgraded, this tag has
# to move with it or every backup starts failing.
FROM postgres:18-alpine

RUN apk add --no-cache aws-cli

COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh

CMD ["/usr/local/bin/backup.sh"]
