-- A fifth TagVisibility state: FACE, seen only while the subject's face
-- shows. A thing ON the face (Disfigured, Pretty, a missing eye) goes under a
-- hood or mask, and stays under a Disguise Kit's false name — unlike NAMED.
--
-- Its own migration because Postgres will not let a new enum value be USED
-- in the same transaction that added it, and Prisma runs each migration file
-- as one. The next migration moves the face tags onto it.
ALTER TYPE "TagVisibility" ADD VALUE IF NOT EXISTS 'FACE';
