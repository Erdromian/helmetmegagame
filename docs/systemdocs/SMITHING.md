# Smithing

This is the canonical tier ladder for weapons and armor. Price a new combat
item off this table, not by feel. If you change a number here, also change
the price-scale comment at the top of the weapons block in `docs/tags.yaml`
and the mention in [`TAGS.md`](TAGS.md) §4a.

Changing `Turns` here also changes what a merchant pays for the finished item —
[`DEPOT.md`](DEPOT.md) §4 derives the Merchant's sell price from this table's
`⬢` and `Turns` columns plus the skill gate, not by feel either.

## 1. Skills

| Slug | Name | pt | Gate |
|---|---|---|---|
| `crafting` | Crafting | 2 | none |
| `smithing` | Smithing I | 5 | none |
| `smithing-skilled` | Smithing II | 5 | `parentTag: smithing` (cumulative, total 10) |
| `smithing-gunpowder` | Smithing (Gunpowder) | 9 | `requiredTag: smithing-skilled`, `mastery` |

A full gunsmith is `smithing` + `smithing-skilled` + `smithing-gunpowder` =
5 + 5 + 9 = **19 pt**.

**Smithing (Gunpowder) is a `mastery` tag** (2026-09-10, `TAGS.md` §4a), so
nobody starts the game a gunsmith — the rung is bought from `/store` with
points earned in play. Its 9 pt sits below the 12–15 mastery band on purpose:
the band prices a capstone that stands alone, and this one already costs 10 pt
of prerequisites before it can be bought at all.

## 2. Tiers

Materials cost (the ⬢ column) was cut ~15% across the ladder as a rebalance
pass, then a further ~5% (2026-09-12, the same pass that trimmed medical and
brewing). Dead Simple's 3 ⬢ and Simple's 6 ⬢ are unchanged — 5% off either
rounds back to itself — every rung above Simple moved again. `pt`, `Turns`,
and every gate are untouched.

| Tier | pt | ⬢ | Turns | Skill gate | Combat gate | Purchasable at start |
|---|---|---|---|---|---|---|
| Dead Simple | 1 | 2 | 0.25 | `crafting` OR `smithing` | none | yes |
| Simple | 2 | 4 | 1 | `smithing` | `melee-basic` / `ranged-basic` | yes |
| Moderate | 5 | 7 | 1 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| High Quality | 9 | 15 | 2 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| Exceptional | 11 | 32 | 3 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| Gunpowder | 9 (Musketoon), 7 (Bore Pistol) | 15 | 2 | `smithing-gunpowder` | `ranged-basic` | no (mastery gate) |

**The `pt` column follows the sell price now** (2026-09-22): a rung's point
price is its counter price at 7 ¢ a point, the rule `TAGS.md` §4a sets for every
Item and Asset — Dead Simple sells for 6 ¢ so it is 1 pt, Simple 16 ¢ so 2,
Moderate 30 ¢ so 5, High Quality 62 ¢ so 9, Plate Armor 76 ¢ so 11. It used to
run 2 / 5 / 7 / 9 / 14, which bought about 3 ¢ of steel a point at the bottom
of the ladder and 7 at the top. A piece worked from an ingot (Rapier, Katana,
Brigandine, 52 ¢) is 7 pt, off the rung's 9 for the same reason its ⬢ column
is. A piece then sits one point either side of its rung for what it does —
the Halberd, Longbow, Battle Axe, Pavise, Brigandine, Breastplate, Bastard
Sword, Lucerne, Zweihander, Bore Pistol, Shortbow and both Spears a point up,
the Sabre a point down — by the rule in `TAGS.md` §4a, which lists them. The
"Buyable gear, point for point" page of `npm run economy:report` is the check.

Bows use `crafting` in place of `smithing` at every tier. The Crossbow does
not — its steel prod and lock are `smithing-skilled` work.

**The ⬢ column was refitted when the wage table went in** (`DEPOT.md` §4). Prices stayed where they
were and the material moved to fit them, so the tiers ask for less than they used to: Dead Simple 3 → 2,
Simple 6 → 4, Moderate 13 → 7, High Quality 25 → 15, Gunpowder 28 → 15 (Bore Pistol 9; the Bomb keeps its 28, since saltpeter is scarce — `DEPOT.md` §4).
The Spear, Dagger and Phrygian Spear take 3 ⬢ and sell for 9. Exceptional was not refitted, since
nothing on the Merchant's list sits there. Recipes the Merchant also stocks sit off the column on
purpose, each fitted to its shelf price: Cudgel 2, Trench Knife 1, Knuckle Duster 1 (a 6 ¢ and a 3 ¢ shelf cannot
land on a rung at any whole ⬢, so they take scrap and the claims table holds them back), Gladiator
Helmet 9, Wooden Leg and Iron Hook 6, Workshop Equipment 15. Recipes that work an input (Rapier,
Katana, Brigandine, Plate Armor, Silver Spear) were fitted the same way.

**Four small pieces of metalwork run under the Simple rung's Turns column.**
The Spear, Dagger and Phrygian Spear are `turnsCost: 0.25` —
a spearhead or a knife is not a day at the anvil — so four of them fit in
one Routine ([`CRAFTING.md`](CRAFTING.md) §2a). Everything else about the
rung (the pt, the skill gate, the forge) is unchanged, and they take 3 ⬢ and sell
at 9 rather than the tier's 16 ([`DEPOT.md`](DEPOT.md) §4): four a Routine
breaks even at the counter, against the Simple rung's own 2 ¢ a Move, and §4's
rule is that quick work is never paid better than the rung above it. They were
thirds selling at 9 until costs became decimals in 9/2026 — the price came
down with the extra unit. The Silver Knife is the odd one out and always was:
1 ⬢ and a silver ingot in, 23 out, and it takes half a Move, two to a Routine, so a
round trip through the Merchant clears about 2 ¢ a Move like the rest of the rung. The Gladius, Mace and Battle Axe stay a
full turn — a sword blade or a flanged head is real forging.

**The two gate columns mean different things and are enforced on different
surfaces.** The Skill gate is what it takes to *make* the item; the Combat
gate is what it takes to *use* it. Character creation and `/store` enforce
the Combat gate (`requiredTag`) — you can't buy a Crossbow at creation
without Ranged I. The **Craft menu enforces the Skill gate, not the
Combat gate** (`db/lib/medicalVision.js#satisfiedSkillIds`,
[`CRAFTING.md`](CRAFTING.md) §2, [`TAGS.md`](TAGS.md) §3b): the picker's "To
make: …" line shows the Skill gate as a requirement, checked server-side, not
just guidance. Nothing checks the Combat gate at craft time, so a smith with
`Smithing II` and no `Melee I` can still forge a sword they
can't swing; a fighter pulling a sword from their clan's armoury still files
the same request with the fiction as their justification — that half of the
honor system stands, it's just the Skill half that's now enforced.

## 2a. Workshop Equipment

**Smithing and building need a forge, where smith's work is unavoidable.** A
recipe requires **Workshop Equipment** in reach — held, sitting in a Room
stash you can get into at your Location, or served by a **COMPLETE** structure
whose `placement.provides` lists `workshop-equipment` (`db/lib/equipmentReach.js`,
the same predicate the private-room threads are synced with) — held kit, room
stash, or standing forge are the three reaches, and a Forge serves everyone
standing at its Location permanently, no hauling and no door. A `DAMAGED`
forge serves nobody — the same `COMPLETE`-only reading `structureTools` uses
for mining tools (`MINING.md` §4). All of this applies when the recipe
names a `smithing-*` or `builder-*` skill **and does not offer `crafting`**. A
recipe whose type carries `placement.fieldwork: true` — a light field
structure — skips the workshop rule entirely.

That second half matters, and **this paragraph used to get it wrong**. It said
every Dead Simple recipe listed `skills: [crafting, smithing]`, so none of them
needed a forge. The rung was written that way meaning "either skill", but
`requirementSkills` is an AND, so it demanded both — and it was split by
material to fix that. Nothing in the catalog lists the pair now. A sling or a
club lists `skills: [crafting]` and stays something you whittle; the five metal
Dead Simple recipes (work knife, hatchet, cudgel, pitchfork, armored gloves)
list `skills: [smithing]` and went behind a forge for the first time as a side
effect of the split. What is gated, then, is every Simple rung and up, those
five, plus the Cart.

The rule is read off the recipe's own skills rather than a per-tag flag, so a
new sword is gated the moment it names a smithing skill and nobody has to
remember a second field. `needsWorkshop()` in `web/lib/tagRequests.js` is the
one copy, shared by the Craft dialog and `craftRequestImpl`.

`workshop-equipment` is itself a **High Quality** craftable — 9 pt, 15 ⬢, 2
turns, `smithing-skilled` — and **Immense (100 lb)**, so it is a real decision
to move one. It is the one recipe **exempt from its own gate**, and has to be:
gating it would mean nobody could ever build the first forge. You raise that
one in the open, and it is what lets you do the finer work after.

It replaced the old `workshop` **Asset**, which was 2 pt, creation-only, and
gated nothing — its own description admitted "You don't need this to craft".

Crafting is always filed as a Routine now, never a Gambit — the Craft button
(the old Add Tag) enforces a recipe's skills server-side, and Dead Simple
recipes bill their quarter of a Move the same as any other 0.25-turn rung
(`CRAFTING.md`).

A 0-turn recipe may also set **`requirement.perTurn`**, its own RATION —
there is no shared pool behind it any more, so this is the only free
allowance a `turnsCost: 0` recipe gets (bone-mask at 1). Work is never
written there: a recipe cheaper than a whole turn
authors a decimal `turnsCost` on a quarter, and `quantity × work` against the
Move is the only quantity limit a Move-costing recipe has
([`CRAFTING.md`](CRAFTING.md) §2–§2a). A plain `turnsCost: 1` rung — every
tiered weapon but the four 0.25-turn small pieces in §2 — makes one per
Routine by that arithmetic.

**Dead Simple costs a quarter of a Move now, not nothing.** It changed in
9/2026 (`DEPOT.md` §4): it used to be `turnsCost: 0` with a shared 4-a-turn
free ration, which meant four saleable things a day riding free on top of an
untouched labour day. It is `turnsCost: 0.25` now, ordinary `CRAFTING.md` §2a
Move math, and nothing more — four fill a Routine exactly, the same as any
other 0.25-turn rung. The shared pool (`DEAD_SIMPLE_PER_TURN`) is gone from
`web/lib/tagRequests.js` and does not come back; `craftAllowance()`
(`web/lib/requests.js`) now only honours a recipe's own `perTurn`, and Dead
Simple names none. Its flat markup is unchanged at **+3 ¢** — cutting it as well
was nerfing one rung twice for one problem (`DEPOT.md` §4).

**Not every Dead Simple smith recipe is a weapon.** `branding-iron` gates on
`skills: [smithing]` the same as Work Knife and Hatchet, but it's a standing
kit rather than a Recipes-tab rung — no `group`, `pointCost: 0`, same shape as
Torturing Equipment (§5 note in `TORTURE.md`) — so it doesn't appear in the
weapon table below. See `TORTURE.md` §8 for what it does once crafted.

**Past four a turn, the Move is simply gone.** Dead Simple has no allowance
of its own to overflow past any more — at 0.25 of the Routine each, four of
them already spend the whole thing, the same as any other 0.25-turn rung
(`CRAFTING.md` §2a), and a fifth is refused for the ordinary reason: no Move
left. Filing one also locks that Routine to the recipe's family of work, so a
smith who spends the day on knives cannot also file a sling or a Simple sword.
A recipe that still carries its own `perTurn` (bone-mask's 1, `bliss`'s 2) is
a different case — those stay `turnsCost: 0` and keep the old overflow rule,
where a unit past the ration bills `1/perTurn` of the Move instead of being
refused outright. [`CRAFTING.md`](CRAFTING.md) §2a is the full rule.

The Skill gate itself (a recipe's `requirementSkills`) is an **AND list and is
enforced** — see [`TAGS.md`](TAGS.md) §3b. The rung splits by material:
`crafting` for the wood-and-cord items, `smithing` for the metal ones, which
puts the metal half behind a forge.

Every combat item is `purchasable: true, purchasableAfterStart: false` — buy
at creation or have someone craft one in play. Found-only items
(`purchasable: false`) sit outside the ladder — a craftable gated behind a
hidden-category skill (§3a of `TAGS.md`, or a future one like it) works the
same way: it's priced on its own terms, not a rung of this table. The Cult
of Bacchus's `smithing-bacchus` craftables (Nailgun, Armor Robes, Nails of
Life) used to be the example; they're archived in
`docs/archive/bacchus.yaml`.

## 3. Weapons

**Eleven of the weapons below are `customizable:`** — the plain ones. Cudgel,
Work Knife, Dagger, Spear, Gladius, Mace, Battle Axe, Halberd, Broadsword,
War Hammer, Bastard Sword. +1 ⬢ lets the smith stamp their own name and
words on the piece, the same door as the Badge and Hat (`CRAFTING.md` §4a),
and it takes **Smithing II** to open — whatever tier the piece itself
is, so a basic smith forges a plain dagger and cannot sign it.

Nothing else on this ladder carries the flag. The named and exotic pieces are
somebody else's design already (Katana, Lucerne, Phrygian Spear, the silver
pair), the bows and the sling are `crafting` work rather than smith work, the
guns and the Bomb are Gunpowder, and the Pitchfork is a farm tool. Trench
Knife has a harder reason: its torture bonus is keyed to the held tag's exact
slug, which a mint never matches (`CRAFTING.md` §4a on `customOfSlug`).

| Weapon | Tier | Notes |
|---|---|---|
| Cudgel | Dead Simple | `smithing` |
| Work Knife | Dead Simple | `smithing` |
| Hatchet | Dead Simple | `smithing` |
| Truncheon | — | Not craftable at all, by design. Cerberi and Order issue. |
| Sling | Dead Simple | `crafting` |
| Quarterstaff | Dead Simple | `crafting` |
| Pitchfork | Dead Simple | `smithing` |
| Shortbow | Dead Simple | `crafting` |
| Spear | Simple | 0.25 turns — four to a Routine (§2) |
| Dagger | Simple | 0.25 turns — four to a Routine (§2) |
| Silver Knife | Simple | 0.5 turns — two to a Routine (§2). Spends one `silver` — its 6 ⬢ total is unchanged, the resourceCost is just 1 ⬢ of it now (2026-09-09). |
| Gladius | Simple | |
| Phrygian Spear | Simple | 0.25 turns — four to a Routine (§2) |
| Javelin | Simple | `ranged-basic` — it is thrown, not held. |
| Longbow | Simple | `crafting` |
| Mace | Simple | |
| Battle Axe | Simple | |
| Knuckle Duster | Moderate | `visible: worn` — pocketable. The creation pick is a pair at 1 pt (`knuckle-dusters-pair`), since the Merchant stocks one at 3 ¢ and a single is under the floor. That shelf price sits under a 7 ⬢ recipe, which is its own open question. |
| Halberd | Moderate | Renamed from Bardiche in the Combat Update; the slug moved with it. |
| Broadsword | Moderate | |
| War Hammer | Moderate | |
| Bastard Sword | High Quality | |
| Rapier | High Quality | Spends one `iron`. 1 turn / 12 ⬢ now, not the tier's 2 / 25 — the other turn moved into the ingot's own recipe, and 8 ⬢ comes off for the ingot (2026-09-09, repriced 2026-09-10; materials cut a further ~5% 2026-09-12). |
| Sabre | High Quality | |
| Katana | High Quality | Spends one `iron`. 1 turn / 12 ⬢ now, not the tier's 2 / 25 — same move as Rapier (2026-09-09, repriced 2026-09-10; materials cut a further ~5% 2026-09-12). |
| Silver Spear | High Quality | Spends one `silver` — its resourceCost is 8 ⬢ now (`DEPOT.md` §4 fits it to the wage table) (2026-09-09; materials cut a further ~5% 2026-09-12). |
| Lucerne | High Quality | |
| Zweihander | High Quality | |
| Crossbow | High Quality | |
| Musketoon | Gunpowder | Priced at 18 pt, not the tier's 14 — a pre-existing outlier, not introduced by the Combat Update. |
| Bore Pistol | Gunpowder | Materials cost 18 ⬢, not the tier's 28 — a pre-existing outlier, not introduced by the Combat Update. Priced accordingly in `DEPOT.md` §4. |
| Bomb | Gunpowder | `purchasable: false` (craft-only). Spends one `black-powder` per unit on top of its 28 ⬢ — the one ladder recipe with an ingredient. |

**Off-tier recipes with ingredients.** Three smaller recipes sit under their
own prices, each spending an ingredient (`requirement.items`, enforced and
consumed like any brew's):

| Recipe | Skill | ⬢ | Turns | Spends |
|---|---|---|---|---|
| `black-powder` | `smithing-gunpowder` | 3 | 1 | `saltpeter` (raw, mined) |
| `gunpowder-grenade` (**Crude Grenade**) | `smithing-skilled` | 6 | 1 | `saltpeter` (raw, mined) |
| `iron` | `smithing` | 0 | 0.25 | `hematite` (mined) |
| `copper` | `smithing` | 0 | 0.25 | `malachite` (mined) |
| `nickel` | `smithing` | 0 | 0.25 | `garnierite` (mined) |

The grenade came over from Brewing II on 2026-09-05 — a powder device
out of a still was always odd — and its group moved to `items-weapons` with
it, the Smithing-family group the Recipes tab renders by.
Renamed **Crude Grenade** and dropped to Smithing II on 2026-09-06
(Chris): it packs raw saltpeter, not powder, so the Gunpowder rung keeps only
the true powder-work — `black-powder`, the Bomb, the guns. The slug stays
`gunpowder-grenade`. `black-powder` is the refining step between mined
saltpeter and the Bomb; its numbers (3 ⬢, sells 21) are drafted, not signed
off.

**The three smelts** replaced `{tag:steel}` on 2026-09-18, when `coal` and
`steel` both left the game with the Prospecting rework (`MINING.md`). `iron`
took steel's slot at steel's prices (8 back, 13 off the shelf), so a smith with
no prospector to hand can still buy one off the Merchant. Those prices stay: the
ore is the bottleneck, and the shelf price keeps buying an ingot to crack it for ⬢
from paying (`DEPOT.md` §4). `copper` and `nickel` are the same recipe over a different ore and
feed Trinkets rather than gear.

They cost **0 ⬢**, not steel's 4: the ore IS the cost now, and an ore is
something somebody spent a day underground for. Gated at plain `smithing`
rather than `smithing-skilled` on purpose: smelting ore into a usable ingot is
basic forge work, and it is only the four recipes that SPEND one — `katana`,
`rapier`, `brigandine`, `plate-armor` — that need the higher skill to shape it
into something fine.

They run under the Simple rung's Turns column (§1): `turnsCost: 0.25`, four
ingots to a Routine, for the same reason the Spear and the Silver Knife run
there — an ingot is not a day at the anvil. Each of the four recipes that spend
one gave up a full turn of its own (the smelting the smith no longer does
inside them) and 8 ⬢, the ingot's value — so a smith who smelts his own pays
the ladder's ⬢ exactly, and a quarter of a turn on top. **This
undercuts the ladder's Turns column on purpose:** High Quality ingot gear is
a 1.25-turn job now rather than 2, Plate 2.25 rather than 3. See the Weapons and
Armor tables above. `{tag:silver}` got the same
`Prospecting`-sourced treatment the same day, but stays a raw material with
no recipe of its own — silver needs no smelting, so there was nothing to
split out of `silver-knife`/`silver-spear` beyond the ingredient itself.

Off the ladder — no recipe, no smithing gate:

| Weapon | pt | Notes |
|---|---|---|
| Sword Cane | 4 | Sold complete at 24 ¢, which says 3; a point up for being a sword nobody sees. `visible: worn` — it reads as a cane until it's drawn. |
| Neoclassic R&W10 | 14 | Bought at creation only — not craftable. Requires `ranged-basic`. 150 ¢ at the Depot would price it at 21 by the 7 ¢ rule; it is held at the scale's 14-point ceiling instead (`TAGS.md` §4a). |
| Cracked Bone Club | 0 | Found only. |
| Neoclassic Duelista | 0 | Found only. |
| Disabler | 0 | Cerberon-issued. |

## 4. Armor

Every piece below is `customizable:` (2026-09-09) — the same +1 ⬢ and the
same **Smithing II** rung as the eleven weapons in §3, including the
pieces that are `crafting` work to make. Armor is where a maker's mark is
most worth having, so the whole table gets it rather than a chosen few.

It needed one more change first: armor was never `stackable`, which
`validateCustomizable` requires (`CRAFTING.md` §4a), because one Breastplate
ever was the entire enforcement of "you already have that tag." Bascinet's
call: it's fine for a character to carry more than one, so every recipe here
is now `stackable: true` too. Nothing else about the equip rig needed to
change — a stackable, layered, equippable tag already worked (the Hat proved
it), so a second Breastplate just contests the first one's BODY/3 layer
exactly like a second Hat would (`db/lib/equipSlots.js`). Armored Gloves
(§2a) got the same treatment even though it isn't in the table below — and
it is one of the pieces `db/lib/godflesh.js` reads back by slug, so a signed
pair still counts at the Spillway (`CRAFTING.md` §4a).

| Armor | Tier | Notes |
|---|---|---|
| Padded Armor | Dead Simple | `crafting` |
| Padded Cap | Dead Simple | `crafting` |
| Buckler | Dead Simple | |
| Simple Helm | Simple | |
| Mail Coif | Simple | |
| Shield | Simple | `crafting` |
| Pavise | Simple | `crafting`. Sells at the Moderate rung's 30 ¢ and costs 5 pt since 2026-09-23, off its rung on purpose; 9 ⬢ so a crafter clears the `crafting` rung's 2 ¢ a Move, not a skilled smith's (`DEPOT.md` §4) — see §4a. |
| Mail Shirt | Moderate | |
| Gladiator Helmet | Moderate | Also on the Merchant's shelf at 45 ⬢ (`DEPOT.md`). Optional conceal. |
| Knight's Helmet | High Quality | Force conceal — a closed helm is not a face (`PROXYING.md` §5). |
| Censor's Helmet | High Quality | Force conceal |
| Brigandine | High Quality | `visible: worn` — plates inside a coat, so it shows only while worn. Spends one `iron`. 1 turn / 12 ⬢ now, not the tier's 2 / 25 (2026-09-09, repriced 2026-09-10; materials cut a further ~5% 2026-09-12). |
| Breastplate | High Quality | |
| Plate Armor | Exceptional | Spends one `iron`. 2 turns / 25 ⬢ now, not the tier's 3 / 32 (2026-09-09, repriced 2026-09-10; materials cut a further ~5% 2026-09-12). |

Off the ladder:

| Armor | pt | Notes |
|---|---|---|
| Salvage Plate | 2 | No skill gate. |
| Energy Shield | 0 | Not smith work at all — Merchant stock at 145 ⬢, or the rarest rung of cave loot. |

Off the ladder in the other direction: **Trinket**, `smithing`-gated and a
whole Move like everything above, but priced by a die roll rather than a
row in either table — see [`TRINKETS.md`](TRINKETS.md).

### 4a. The armour numbers

Every piece above carries two fractions, `melee:` and `ballistic:`, and the
rule since the 2026-09-23 rebalance is that **every piece a player can pick,
buy or make has a use case** — it is the cheapest or lightest in its slot, it
carries a perk (concealment, a mining bonus, hiding under a coat), or it is
the best in its slot on one axis or on the average of both. The check is the
"Armour, piece against piece" table on the equipment page of
`npm run economy:report`: it flags a piece that is an exact twin of another,
one that is dominated inside its slot, one outpriced by a piece at half the
points, and one that is heavy for the step it buys. `db/test/economyArmor.test.js`
fails when a piece a player can come by is a twin or dominated, so a catalog
edit cannot quietly put one back.

What each piece is for, as the numbers now stand (melee / ballistic, lb):

| Slot | Piece | pt | Numbers | Why you would take it |
|---|---|---|---|---|
| Head | Padded Cap | 1 | 0.22 / 0.04, 1 lb | Lightest and cheapest; no forge |
| Head | Mail Coif | 2 | 0.30 / 0.06, 2 lb | The light 2-pt helm; hood conceals |
| Head | Simple Helm | 2 | 0.33 / 0.09, 4 lb | The 2-pt helm that leans melee; conceals |
| Head | Infantry Helmet | 2 | 0.28 / 0.15, 5 lb | The 2-pt helm that leans ballistic; conceals |
| Head | Mining Helmet | 3 | 0.31 / 0.09, 4 lb | +1 ⬢ a Prospecting press |
| Head | Gladiator Helmet | 7 | 0.35 / 0.25, 6 lb | Ballistic without a forced hood; on the shelf |
| Head | Knight's Helmet | 9 | 0.48 / 0.20, 6 lb | The lighter closed helm, better against a bullet |
| Head | Bascinet | 9 | 0.54 / 0.16, 8 lb | The best forged helm against a blade |
| Head | Censor's Helmet | 9 | 0.44 / 0.31, 7 lb | The best forged helm against a bullet |
| Body, mail | Padded Armor | 1 | 0.26 / 0.04, 8 lb | Lightest and cheapest; under a coat |
| Body, mail | Mail Shirt | 5 | 0.42 / 0.09, 20 lb | The mid rung, 5 lb lighter than Brigandine |
| Body, mail | Brigandine | 8 | 0.50 / 0.18, 25 lb | Best in the layer, and it hides under a coat |
| Body, over | Salvage Plate | 2 | 0.31 / 0.09, 16 lb | No skill at all |
| Body, over | Graga-Hide Cloak | 3 | 0.24 / 0.12, 8 lb | Lightest in the layer; reads as a garment |
| Body, over | Breastplate | 10 | 0.55 / 0.18, 20 lb | The best protection a pound |
| Body, over | Plate Armor | 11 | 0.68 / 0.26, 42 lb | The best forged piece outright; still Massive |
| Held | Buckler | 1 | 0.22 / 0.04, 3 lb | Lightest and cheapest |
| Held | Shield | 2 | 0.35 / 0.13, 10 lb | The shield wall bonus |
| Held | Pavise | 5 | 0.44 / 0.24, 25 lb | Best held piece a crafter can make; cover |
| Accessory | Armored Gloves | 2 | 0.13 / 0.04, 2 lb | The Godflesh gloves; the armour is a bonus |

What moved, and why:

- **Plate Armor** was 0.62 / 0.22 at 55 lb: one point over the Breastplate
  and 35 lb heavier for a step of 0.07, and a Breastplate over a Mail Shirt
  beat it on both axes at 45 lb. It is 0.68 / 0.26 at 42 lb now — the best
  single forged piece by a clear margin, still in `CARRY.md`'s Massive band,
  and Plate over a Brigandine is 67 lb, which is most of a 71 lb carry cap
  before a weapon.
- **Mail Coif** was an exact copy of the Padded Cap's numbers at twice the
  points and four times the weight, and the Simple Helm's price with less
  protection. It is the light helm now: 2 lb.
- **Knight's Helmet** at 9 pt bought 0.13 more melee than a 2-pt Simple Helm
  and a forced hood. It is 0.48 / 0.20 now, and the **Bascinet**, which
  matched it exactly, is the heavy one at 0.54 / 0.16 and 8 lb.
- **Infantry Helmet** matched the Simple Helm exactly. It leans ballistic
  now (0.28 / 0.15, 5 lb) where the Simple Helm leans melee (0.33 / 0.09).
- **Pavise** at 3 pt turned aside as much as a 9-pt helm. It keeps its
  protection (0.44 / 0.24) and costs Moderate money instead: 5 pt and a 30 ¢
  sale. The recipe takes 9 ⬢ rather than Moderate's 7, so a crafter still
  clears the `crafting` rung's 2 ¢ a Move (`DEPOT.md` §4's wage discipline)
  instead of a skilled smith's 8.
- **Mail Shirt** weighed the same 25 lb as the Brigandine it sits under. It
  is 20 lb and 0.42 melee now; the Brigandine picked up 0.02 ballistic.
- **Salvage Plate** is 16 lb, from 20, for numbers a 4 lb helm matched.
- **Graga-Hide Cloak** claimed to take a blow "better than any coat has a
  right to" at 0.18, under a 1-pt Padded Cap. It is 0.24 / 0.12 now.
- **Heavy Infantry Armor** was 0.55 / 0.70 against Light's 0.38 / 0.66: twice
  the price and 18 lb more for two points of turret survival. It is 0.58 /
  0.76 now, 58% left neither dying nor dead against Light's 52%
  (`DEPOT.md` §0i).

Role kit and loot (the Cataphract, the Soulbreaker Helm, the Tribunal and
Cerberus helmets, the Spacesuit, the Thanati Mask, the Bastard's Helmet) are
outside the rule: nobody chooses them against the ladder, and the Tribunal
Helmet and its Ordinator variant are meant to match.
