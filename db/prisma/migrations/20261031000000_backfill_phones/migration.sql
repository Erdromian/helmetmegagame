-- The thirteen phones, written onto the rooms that already existed when they
-- were authored. See docs/systemdocs/PHONES.md.
--
-- 20261013000200_phones added the Room.phone and Room.payphone columns but put
-- no phone on any wall, and db/lib/importZones.js SKIPS a room that already
-- exists -- the importer is additive and never updates. So `phone:` in
-- docs/zones.yaml reached a fresh `npm run dev:setup` and reached the database
-- with players in it only where a GM typed the name in at /gm/dev/zones. Every
-- other phone room drew no Phone button for anybody. The same gap
-- 20261021000000_vending_machine closed for its own fixture.
--
-- Only where the name is still blank, so a phone a GM has already typed in,
-- renamed or moved is left exactly as they left it. A room a GM deliberately
-- cleared is indistinguishable from one never filled, and gets its phone back;
-- clearing the field at /gm/dev/zones takes it out again.
UPDATE "Room" AS r
SET "phone" = v.phone, "payphone" = v.payphone
FROM (VALUES
  ('town-9-1',             'Sanctuary',     false),
  ('town-9-2',             'Esculap',       false),
  ('fortress-1-2',         'Censor',        false),
  ('fortress-5-3',         'Hand',          false),
  ('fortress-4-6',         'Baron''s Phone', false),
  ('fortress-5-2',         'Meister',       false),
  ('undertown-9-3',        'Exactor',       false),
  ('town-4-6',             'Bishop',        false),
  ('factory-overseer-box', 'Banneret',      false),
  ('undertown-5-1',        'Depot',         true),
  ('town-8-2',             'Residences',    true),
  ('town-7-2',             'Inn',           true),
  ('undertown-8-1',        'Den',           true)
) AS v(slug, phone, payphone)
WHERE r."slug" = v.slug AND r."phone" IS NULL;
