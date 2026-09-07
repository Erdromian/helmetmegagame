# Text change review

Every text change from `Text changes made in code_.txt`, one per entry.
Write **keep** or **remove** on the blank line under each.

Bare `‡` deletions with no other edit are collected in §3 at the bottom.

---

## 1. Documents and role packets

### 1.1 Treasurer Doc

**Old:** You can transfer Resources from any source to any recipient, but you have to be able to reach both ends — stand in the same Location as them. ‡

**New:** You may transfer Resources from any source to any recipient, provided you are in the same Location as both.

Decision:yes

---

### 1.2 Medical Doc — surgical instruments

**Old:** **Surgery needs instruments.** Hold {tag:surgical-equipment}, or stand somewhere a set is already laid out — the Sanctuary's operating theatre has one. Either way it's +1 on every medical Gambit you roll. ‡

**New:** **Surgery needs instruments.** Hold {tag:surgical-equipment}, or stand somewhere a set is already laid out — the Sanctuary's operating theatre has one. Adds a +1 on every medical Gambit you roll.

Decision:jsut delete this line

---

### 1.3 Sanctuary — first paragraph

**Old:** The Sanctuary is perhaps the only part of Ravenheart that hasn't succumbed to feudalism. It's stocked with advanced (roughly modern-day) medical equipment, an absolute treasure of ancient times. There is a set of {tag:surgical-equipment} laid out in the operating theatre, and anyone working in that room has the use of it. ‡

**New:** The Sanctuary remains outside Ravenheart's feudal structure. Its plaster walls are stocked with near-modern medical equipment. There is a set of {tag:surgical-equipment} laid out in the operating theatre that anyone in that room may use.

Decision:yes

---

### 1.4 Sanctuary — third paragraph

**Old:** Traditionally, in part due to the cost of medical procedures, the Esculap only treats people that can pay or people of noble blood. So try not to get hurt — you should only expect to get medical treatment if you can pay for it, unless the Esculap is feeling generous.

**New:** Due to the cost of medical procedures, the Esculap only treats people that can pay or people of noble blood. You should only expect to get medical treatment if you can pay for it.

Decision:yes

---

### 1.5 Teaching Skills Doc

**Old:** Skills can be taught. Find someone standing where you are who holds the skill and the {tag:teaching} tag, and press Learn Skill on your sheet — or they press Teach Skill. Teaching is the teacher's Routine for the turn; learning is your Gambit. Roll a 5 or a 6 and the skill is yours when the turn ends. Someone with {tag:teaching-lecturing} can take up to three students at once. A {tag:teaching-drill-instructor}'s students succeed on a 4 when the skill is a fighting skill. ‡

**New:** Skills can be taught. Find someone who holds the skill and the {tag:teaching} tag, and press Learn Skill on your sheet — or they press Teach Skill. Teaching is Routine for the teacher; learning is a Gambit for the student. The student learns the skill on a 5 or 6. Someone with {tag:teaching-lecturing} can take up to three students at once. A {tag:teaching-drill-instructor}'s students succeed on a 4 when the skill is a fighting skill.

> **Note:** drops "standing where you are". Co-location is the actual gate — without it the doc no longer says the teacher has to be present.

Decision: You can learn skills by pressing the Learn Skill button while being near a teacher, which triggers a gambit. You'll learn it on a 5 or 6.

---

### 1.6 Producing Resources — opening

**Old:** Labor is how Resources are produced, and you need a skill to do it at all. Without one of the tags below, a day of work produces nothing. ‡
>
> Pick **Labor** as the kind of your Move — it isn't adjudicated and it doesn't roll, it simply pays. Choosing it means choosing not to do anything else that turn. Submit no Move at all and you'll Labor automatically. ‡

**New:** Labor is how Resources are produced and requires a tag from below.
>
> Pick **Labor** as your Move, it pays based on the best skill for the location. Labor is your only action for that turn. Labor is the default Move if no other Move is submitted.

Decision:

---

### 1.7 Producing Resources — side-grades paragraph

**Old:** The bottom three need {tag:laboring-skilled} behind them and are side-grades rather than upgrades. Hold as many as you like — laboring always pays the best result you're entitled to where you stand, so there is nothing to switch and nothing to forget. ‡

**New:** The bottom three need {tag:laboring-skilled} behind them and are side-grades. There is no limit on the number of Labor tags a Character may possess. Laboring always pays the best result for where you stand.

Decision:

---

### 1.8 Producing Resources — drift paragraph

**Old:** Those three numbers are what an ordinary spot pays. Real ground is better or worse, and what a place is worth **changes over the course of the game**. Press **Examine** in any Location's channel to see what it yields right now. Hunting swings hardest; farmland is steady until it isn't. ‡

**New:** The Per Turn Ranges are what an ordinary spot pays. What a Location pays **changes over the course of the game**. Press **Examine** in any Location's channel to see what it yields right now. Typically, Hunting is the most variable; Farming is the most steady.

Decision:

---

### 1.9 Producing Resources — tools

**Old:** Tools raise a yield while you carry them — bows and guns for hunting, a Pitchfork or a Plow for farming, a Rod for fishing. Each says so in its own description. ‡

**New:** (identical, ‡ removed)

Decision:

---

### 1.10 Producing Resources — Lifeweb failure

**Old:** If the Lifeweb fails, laboring very nearly stops. ‡

**New:** If the Lifeweb fails, laboring nearly stops.

Decision:

---

### 1.11 Town Starting Packet

**Old:** The Headman received a raven saying he didn't receive the last tax wagon. It was probably ambushed by bandits. The Meister won't be happy about this… prepare to be squeezed for it.‡

**New:** The Headman received a raven saying the fortress didn't receive the last tax wagon. It was probably ambushed by bandits. The Meister won't be happy about this… prepare to be squeezed for it.

Decision:

---

### 1.12 Court Structure Doc

**Old:** The Hand's the voice, the organizer, the executor, the Hand. He outranks everyone except the Baron.

**New:** The Hand's the voice, the organizer, the executor. He outranks everyone except the Baron.

Decision:

---

### 1.13 Merchant Role — the Depot bullet

**Old:** Your Depot sits in the Customs, down inside the Caverns: a hangar door up in the ceiling and a shuttle you call down through it. Your License runs the place. There's a mini-turret that's almost always off, and it does not read papers — it reads faces. It will not fire on yours. It will fire on everyone else's, including your Dockers, and including you if you are wearing somebody else's. ‡

**New:** Your Depot is in Customs, between the forest and the caverns: Your License allows you to call down a shuttle. The mini-turret is keyed to your face, so it'll shoot everyone except you. Be careful not to conceal your face however.

> **Note:** two real changes, not just voice. The geography claim moved ("down inside the Caverns" → "between the forest and the caverns") — check that against `docs/zones.yaml`. And "almost always off" is gone, which is the turret's default state.

Decision:

---

### 1.14 Merchant Role — obols bullet

**Old:** You deal in obols (¢), not ⬢. … You can buy at the Depot's price and sell it at whatever makes sense for profit. ‡ You can also buy things from Ravenheartians…

**New:** (identical, ‡ removed)

Decision:

---

### 1.15 Merchant Role — credit line bullet

**Old:** The Company will advance you up to 75 ¢ against the business. Your licence will be revoked if you fail to pay it. ‡

**New:** The Company will advance you up to 75 ¢ against the business. Your licence will be revoked if you fail to pay it.              - >-

> **Note:** the next bullet's `- >-` marker got pulled onto this line. As written this breaks the YAML — two bullets merge into one. Must be fixed whatever you decide.

Decision:

---

### 1.16 Merchant Role — usury bullet

**Old:** Try your hand at usury. Lend at high rates and call on your Dockers to collect. That's probably the easiest way to make serious bucks.

**New:** You may issue loans, lending at high rates and calling on your Dockers to collect.

Decision:

---

### 1.17 Player Handbook, line 273

**Old:** Come up short and nothing is taken at all — you keep what you have and go hungry anyway.

**New:** If a character does not have 2 ⬢, no resources are taken and the character becomes {tag:hungry}.

> **Note:** switches from second person to third-person rules voice mid-handbook. The rest of the page is "you".

Decision:

---

## 2. UI and action strings

### 2.1 Action registry — `destroy`

**Old:** Throw away something you're holding. It's gone. ‡

**New:** Throw away something you're holding.

Decision:

---

### 2.2 Action registry — `examine`

**Old:** Look someone over without saying a word to them. You see what anyone standing here could see — their face, and whatever they are carrying openly. Somebody concealed stays concealed. Costs nothing, takes no time, and they are never told. ‡

**New:** Look at someone.”,

> **Note:** two problems. The closing quote is a curly `”`, which is a syntax error in JS. And the new line drops every mechanic the old one carried — that concealment survives Examine, that it costs no Move, and that the target is never notified. Those are the questions players actually ask.

Decision:

---

### 2.3 Action registry — `heal`

**Old:** Works on others nearby too. Gated by your Medical skill.

**New:** Heal yourself or another nearby. Gated by your Medical skill.

Decision:

---

### 2.4 Action registry — `free`

**Old:** Cut someone loose. Anyone standing here can do this, including a rescuer.

**New:** Cut someone loose.

> **Note:** "anyone standing here can do this" is the rule, not flavour — it's the only place that says a third party can free a bound character.

Decision:

---

### 2.5 Action registry — `butcher`

**Old:** Cut up a body — one you're carrying, or one lying in a room you can get into here — for what's inside it. Costs nothing and takes no time, and the body is gone afterwards. It does not free their soul. ‡

**New:** Cut up the body of someone you're carrying, or one lying in a room you can get into from here. Costs nothing, takes no time, and the body is gone afterwards. It does not free their soul.

Decision:

---

### 2.6 Action registry — `write`

**Old:** Put words on a sheet of paper. You can always write more on a paper you're holding; you can never take anything back off it. ‡

**New:** Put words on a sheet of paper, more can be added later but not taken away.

Decision:

---

### 2.7 Action registry — `seal`

**Old:** Close a letter with wax so nobody can read it without breaking the seal — and so everyone can see whose wax it was. The stamp is not used up. ‡

**New:** Close a letter with your wax seal. The stamp isn't used up.

> **Note:** drops both effects of a seal — that it hides the contents and that it identifies the sealer. That's the whole point of the action.

Decision:

---

### 2.8 Action registry — `bindbook`

**Old:** Bind ten blank sheets into a book and write it in one pass. What goes in is what it says — a bound book can never be added to. ‡

**New:** Bind ten blank sheets into a book and write it in one pass. A bound book can never be added to.

Decision:

---

### 2.9 DepotBankTab — counter blurb

**Old:** Coins out of the account, or coins back into it. An obol is worth one ⬢, and only at this counter — anywhere else it is a coin somebody has to agree to take. ‡

**New:** Take obols out of your account, or add obols back into it.

> **Note:** loses the rule that 1 obol = 1 ⬢ only at this counter. Elsewhere an obol is worth whatever someone will accept, which is the merchant economy's core premise.

Decision:

---

### 2.10 DepotBankTab — withdraw tooltip

**Old:** `<Tooltip text="Takes obols out of the account as physical coins you can carry, spend, lend, or lose.">`

**New:** `<Tooltip text="Takes obols out of the account that you can carry.>`

> **Note:** the closing `"` is missing. Broken JSX as written.

Decision:

---

### 2.11 DepotBankTab — float paragraph

**Old:** Your own float, both ways, with no spread. One obol is one ⬢ whichever way it goes — you do not charge yourself a margin to use your own till. What this counter really does is make the number on your sheet into coins you can hand over, and back again. ‡

**New:** The company provided exchange, linked to the license. It allows you to trade resources for obols or obols for resources at a 1:1 rate.

Decision:

---

### 2.12 DepotHoldTab — empty pad

**Old:** The pad is empty of anything that flies. What is stacked on it stays where it is. ‡

**New:** The shuttle isn't on the pad. Crates stacked on the pad will remain there.

Decision:

---

### 2.13 DepotHoldTab — crates

**Old:** A crate has to be opened before anything inside it is yours. A sealed one wants a Depot Keycard.

**New:** A crate must be opened with a depot card.

> **Note:** the old text said only *sealed* crates need a keycard. The new one says all of them. Check which is true before shipping.

Decision:

---

### 2.14 DepotHoldTab — shuttle departure

**Old:** Everything on the pad goes with it, and {payout} ¢ lands in the account. This is the only way Resources become obols.

**New:** Everything on the pad goes with it, and {payout} ¢ lands in the account.

> **Note:** "the only way Resources become obols" is a hard economic rule and this is the only place it's stated to the merchant.

Decision:

---

### 2.15 DepotPriceListTab

**Old:** Everything the Depot has a price for, in either direction. An obol is one ⬢, so these are both what the station settles at and what the thing is worth. What you charge Ravenheart is between you and Ravenheart. ‡

**New:** Everything in the Depot has a price. An obol is one ⬢, so these are both what the station settles at and what the thing is worth. What you charge Ravenheart is up to you.

Decision:

---

### 2.16 DepotStationTab — arming the turret

**Old:** …It reads faces, not papers: concealing yourself makes you a target, and a keycard will not save a Docker. People will be shot on the way in and again at the end of every turn. ‡

**New:** …Concealing yourself makes you a target, and a keycard will not save a Docker. People will be shot on the way in and again at the end of every turn.

Decision:

---

### 2.17 DepotStationTab — generator

**Old:** It burns {depot.fuelBurnPerTurn} units a turn while it runs. With it out, nothing at the Depot works — no ordering, no shuttle, no ATM, no turret. ‡

**New:** It burns {depot.fuelBurnPerTurn} units a turn while it runs. With it out, nothing at the Depot works.

Decision:

---

### 2.18 FactionConsole — silo blurb

**Old:** {faction.name} banks nowhere. A silo is just a room somebody picked — everything in it stays where it is if you pick another one. ‡

**New:** A place where {faction.name} stores its resources.

Decision:

---

### 2.19 FactionConsole — moving the silo

**Old:** `"This moves nothing. Whatever is in the old room stays in the old room — somebody has to carry it. ‡",`

**New:** `“This does not move ⬢, anything in the old silo will need to be carried by someone.”,`

> **Note:** curly quotes `“ ”` used as the JS string delimiters. Syntax error as written.

Decision:

---

### 2.20 FactionConsole — locking a room

**Old:** A locked room still takes deposits from anyone in the faction. Only people holding its key can open it again, so pick one deliberately. ‡

**New:** A locked Silo still takes deposits from anyone in the faction. Only people holding its key can open it again.

Decision:

---

### 2.21 FactionConsole — disowning

**Old:** `${faction.name} stops answering to them. Nobody moves, nothing is lost, and their Leader will be told. ‡`

**New:** `${faction.name} stops answering to them. Their Leader will be told.`

Decision:

---

### 2.22 FactionConsole — leaving to found a faction

**Old:** You leave {faction.name} and become the new faction's Leader. It starts with nobody else in it, no silo and no standing. ‡

**New:** You leave {faction.name} and become the new faction's Leader.

Decision:

---

### 2.23 FactionConsole — applying

**Old:** Their Leader and Treasurer get a DM. Say something worth reading — they can turn you down. ‡

**New:** Their Leader and Treasurer get a DM about your application.

Decision:

---

### 2.24 FactionConsole — founding

**Old:** You become its Leader. It starts with nobody else in it, no silo and no standing — all of which are yours to arrange. ‡

**New:** You become its Leader.

Decision:

---

### 2.25 RequestActionsProvider — Destroy

**Old:** Gone for good, and nothing is refunded. A wound isn't destroyed — that's Heal.

**New:** Items are destroyed, and nothing is refunded. A wound can't be destroyed, only healed.

Decision:

---

### 2.26 RequestActionsProvider — Learn / Teach offers

**Old:** They get a DM and have to accept. Once they do, learning is your Gambit for the turn — a 5 or 6 and the skill is yours when the turn ends. ‡ / …teaching is your Routine for the turn. With Lecturing you can take up to three students on it. ‡

**New:** They get a DM and have to accept. Once they do, learning is your Gambit for the turn, with a 5 or 6 learning the skill. / …teaching is your Routine for the turn. With Lecturing you can take up to three students at once.

Decision:

---

### 2.27 RequestActionsProvider — Move already spent

**Old:** You've already used your Move this turn, so this will have to wait. ‡

**New:** You've already used your Move this turn.

Decision:

---

### 2.28 RequestActionsProvider — Gambit heal warning

**Old:** This is past what you can do as a matter of routine, so it's a Gambit: it spends your Move, a die is rolled, and a bad roll can leave them worse off. You'll both know at the end of the turn. ‡

**New:** This is beyond routine, so it counts as a Gambit. It uses your Move, a die is rolled, and a poor result can leave them worse off. You'll both know the outcome at the end of the turn.

Decision:

---

### 2.29 RequestActionsProvider — first aid

**Old:** ` First aid — costs you no part of your day.`

**New:** `First aid doesn't cost a move`

> **Note:** lost its leading space and its full stop, and it's appended to a sentence — check it doesn't run into the preceding text.

Decision:

---

### 2.30 RequestActionsProvider — carrying someone

**Old:** You can move someone you lead, someone you've bound, or a body — anyone standing where you are. It does not spend their turn, and it does not move you, so go there yourself afterwards.

**New:** You can move someone you lead, have bound, or a body. It doesn't spend their move, nor does it move you.

> **Note:** drops "anyone standing where you are" (the co-location gate) and the nudge that you have to travel there yourself.

Decision:

---

### 2.31 RequestActionsProvider — caving roll

**Old:** Rolls 1d6, and you'll be told what it came up. A 6 pays an extra. A 1 means it had hold of you first — Armored Gloves are the difference between a cut and a hand. ‡

**New:** Rolls 1d6, and you'll be told what it came up. A 6 pays an extra, while a 1 means it grabbed hold of you first. Armored Gloves can protect your hands.

Decision:

---

### 2.32 RequestActionsProvider — binding a book

**Old:** Ten blank sheets go into it, and it is finished the moment you bind it — a bound book can never be written in again. Tear it up and you get the ten sheets back. ‡

**New:** Ten blank sheets go into it, and it is finished the moment you bind it, you may not add to it after binding. Tear it up and you get the ten sheets back.

Decision:

---

### 2.33 RequestActionsProvider — sealing

**Old:** Nobody can read it without breaking the seal, and everybody can see whose wax it was. The stamp is not used up. ‡

**New:** Nobody can read it without breaking the seal, and everybody can see whose wax it was. The stamp isn't used up.

Decision:

---

### 2.34 RequestActionsProvider — writing preview

**Old:** Anyone who can read it will read exactly this.

**New:** Anyone who can read it will read this.

Decision:

---

### 2.35 RequestActionsProvider — no paper

**Old:** You have no paper. The Depot sells it, cheaper than anything else there. ‡

**New:** You have no paper. The Depot sells it.

Decision:

---

### 2.36 StatusPanel — pending offers

**Old:** `${o.otherName} wants to bind you — answer in your DMs. ‡` / `${o.otherName} offered a lesson… — answer in your DMs. ‡`

**New:** `${o.otherName} wants to bind you, answer in your DMs.` / `${o.otherName} offered a lesson…, answer in your DMs.`

Decision:

---

### 2.37 TagFieldset — Healable

**Old:** Healable (a cure exists — Heal lists it) ‡

**New:** Healable

Decision:

---

### 2.38 TransferDialog

**Old:** This will go in, and you will not be able to take it back out.

**New:** This will go in, and you won't be able to take it back out.

Decision:

---

### 2.39 Actions — blocked by a condition

**Old:** You can't do that right now — you're ${blocker.name}.

**New:** You can't do that right now, you're ${blocker.name}.

Decision:

---

### 2.40 Actions — landing pad missing

**Old:** The landing pad isn't in the database yet – a GM needs to run the zone sync.

**New:** The landing pad isn't in the database yet, a GM needs to run the zone sync.

Decision:

---

### 2.41 Actions — one-per-character ware

**Old:** The station will not ship more than one ${tag.name} — you can only ever carry one.

**New:** The station will not ship more than one ${tag.name}.

Decision:

---

### 2.42 Actions — obol missing from catalog

**Old:** The obol isn't in the catalog yet — a GM needs to run the tag sync.

**New:** The obol isn't in the catalog yet, a GM needs to run the tag sync.

Decision:

---

### 2.43 Actions — duplicate faction application

**Old:** `${faction.name} has already invited you — answer that instead.` / "You've already asked them. ‡"

**New:** `${faction.name} has already invited you, answer that instead.` / "You've already asked them."

Decision:

---

### 2.44 Actions — unnamed seal

**Old:** A seal needs a name – it goes in the letter's title.

**New:** Name the seal, it will go into the letter's title.

Decision:

---

### 2.45 GatehouseTurret — hit and kill lines

**Old:** hit: "The gun on the rotor swings, finds you, and fires. It does not check who you are first." / dead: "The gun on the rotor swings, finds you, and fires. It does not check who you are first, and it does not stop."

**New:** hit: "The gun on the rotor swings, finds you, and fires." / dead: "The gun on the rotor swings, finds you, fires, and it does not stop."

Decision:

---

## 3. ‡-only removals (no other edit)

Courtier Doc · Church Doc · Respawning Doc · Smithing Doc (all) · Caving Monsters ·
Baron Role · Minstrel Role · Player Handbook (all listed lines) · Craft Tool tip ·
Action Registry (all remaining) · Avatar Field file · DepotBankTab · DepotConsole ·
DepotHoldTab · DepotLedgerTab · DepotOrdersTab · DepotStationTab · Desire Unlocks ·
ExamineDialog · FactionConsole · PartySelect · PointBuy · QuantityFields ·
RequestActionsProvider · TagDetailSheet · TagFieldset · TransferDialog · ActionBar ·
Actions · Bird · BirdReply · Bind · Ambient line · Carry · CharacterWrite · Commands ·
Confessions · ConfessionsPass · ConverseModal · CorpseMint · CorpseRotPass ·
CreateCharacterWizard · DawnAfflictionPass · depotPass · equipActions · ExamineActions ·
ExamineVision · FactionsTable · GatehouseTurret · Godflesh · Headstone · Identity tab ·
Indoors · infochannel.yaml

Decision (all):

---

## 4. Left untouched by the editor

- **Desires** — they thought it might be classified as a tag.
- **effectComposer** — didn't know what it did.
- **Guards** — unsure what it did.
- **interactionCreate** — unsure, but says it only needs the ‡ deleted.
- **equipSlots** — listed with no note.

Decision (sweep these yourself?):
