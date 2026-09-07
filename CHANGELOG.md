# Changelog

Every push, newest first, in plain language for the GM team. Written by
`npm run push` and mirrored to Discord — see CLAUDE.md.
`✚` new, `−` gone, `✎` changed.

Entries below predate this format and list files instead.

## 2026-09-07 · Merge PR #23: the crafting pass — real recipes, the Move economy, custom craftables, and the recipe book

✚ Recipes are enforced: every ingredient in the brewing, smithing and cooking tables is spent when the work starts  
✚ A turn's craft Routine is a budget: small crafts share one Move in fractions, and one Routine no longer buys 99 of anything  
✚ Custom craftables: badge, hat, painting and a cook's meals can be made as your own for +1 ⬢, and the wayside shrine takes an inscription  
✚ A Recipes tab on /documents, and a read-only /gm/crafts desk  
✎ Prices moved: white-honey 6, succubus 8, grenade is now Crude Grenade under Smithing, bomb needs black powder, moonshine spends a Godflesh  
✚ Art Supplies at the Depot; four new forageables (nightshade, raven's eye, poppy pods, coca leaves) that nothing drops yet — GM grant for now

## 2026-09-07 · A hidden fear dial under every character, and the phobias that sharpen it

✎ Every character now carries a hidden fear dial. Nights in the wilderness or the caves, wounds, hunger, a bad Caving Die, being bound or crucified and a death nearby all raise it; a roof, the Inn, the Keep or the Sanctuary, a drink, a lavish meal, tea, a smoke, a musician's playing, a confession and a fulfilled Desire lower it.  
✚ Five status tags show where the dial sits: Uncomfortable, Stressed, Anxious, Afraid (−1 to Gambits) and Panic (−2). A player gets one plain DM when the band changes.  
✚ A Fear intensity knob on /gm/dev, and the dial itself shown and editable on each character's Dev Panel.  
✎ Phobias are multipliers now: Claustrophobia doubles cave fear, Agoraphobia (new) the wilderness, Hemophobia (new) wounds, Teratophobia triples a bad Caving Die, Pyrophobia triples burns. Acrophobia is gone.  
✎ Brave costs 5 and halves all fear. Rough Camper halves the outdoors and the caves; Outsider and Spelunker (new, 1 pt each, behind Rough Camper) cancel one of the two. Pale halves the caves.  
− Disappointed. A noble who ends the turn without a fine or lavish meal takes fear instead, and the Merchant is Nobility now too.  
✎ Fine meals no longer calm anyone; lavish meals do.  
✚ Rough Camper on both Brigands, the Tribune, the Ordinator, the Fisherman, the Mercenary, the hunter kit, the Demoness and the Judge; Outsider on the Brigands, the Tribune, the Ordinator and the Judge; Brave on the Ordinator and the Judge; Spelunker on the Mercenary.  
✚ Wilderness and Haven markers on Locations, which Examine prints.  
✎ Also riding along from other sessions: the 71 lb carry cap, the Underquarter basements and sewer, and a fix to who may work a room's door.

## 2026-09-07 · The Play page shows your turn, your Move, your state and your Desires

✚ A turn card in the right column: the phase, when Moves close, and the Move you filed with an Edit button until the lock  
✚ A status strip: ⬢, carry, and every Status or Health tag you carry  
✚ Your Desire slots with Claim, the same as the sheet  
✚ A Yesterday block with what last turn's close told you  
✎ You may change a Move's kind once a turn; the die is never re-rolled by editing the text

## 2026-09-07 · A Move filed from the Play page now counts

✎ Filing your Move on the web left it half-made: never rolled, never applied, and it blocked filing again. It is confirmed the same way the Discord console does it now

## 2026-09-07 · The Play page is usable: a real right column, travel as nodes, no more blinking

✎ Your own line no longer changes text or loses its face a second after you send it  
✎ Unread dots clear when you open a place, and a NEW line marks where you left off  
✎ Slowmode is a countdown beside the box, not a failed send  
✚ A place card with the Location and Zone descriptions, always visible  
✚ Everyone standing here, hoods included, each with a look-at eye  
✚ Storage and fixtures shown only for the room you have open, so the Intercom is only in the Council Room  
✚ Travel is a grid of square nodes with the cost on each, tinted for a zone crossing  
✚ Look at and Photograph on other people's lines; a GM can remove a line  
− Who's here?, Secret rooms?, Examine and the travel dropdown  
✎ Summary is the first place in the column

## 2026-09-07 · Eight new tags, and the combat lines all read the same way

✚ Four new fighting specialisations: throwing weapons, sniping, reckless attack and monster hunting  
✚ Drunken Master, which needs Alcoholic and pays off while you are Tipsy  
✚ Subtle: the room no longer notices that you are whispering  
✚ Steady for deliberate hands, and Dense for a slower head  
✎ Every combat tag now names its own tree — melee, ranged, or genuinely both — and shifts tiers in the same words  
✎ The crossbow's skill line was garbled, and claimed the wrong tree

## 2026-09-07 · A copy pass over the player-facing text

✎ A reviewer's rewrite of the player documents, the handbook, the Depot and Faction pages and the action tooltips, with the grammar and punctuation tidied on the way in  
− The ‡ draft marks from every line that reviewer read: the handbook, twelve documents, the Depot and Faction pages, the action list, the offers and dialogs, and the world's ambient lines  
✎ Laboring, Teaching, the Sanctuary, the Treasurer's brief and the Merchant's brief all read shorter now

## 2026-09-07 · The Depot opens again

− Fixed: the Merchant's Depot page loaded to an error reference for everyone

## 2026-09-07 · The Baroness carries her own key

✚ A Baroness's Key. It opens the Baron's Chambers and nothing else  
✎ The Baroness starts with her own key instead of the Baron's whole ring

## 2026-09-07 · The Play page opens for a living character again

✎ Opening /play with a living character crashed the page since the right column arrived. The people column and the place buttons were handed a character without their tags.

## 2026-09-07 · A role handed out in Discord reaches the lobby within a minute

✎ The lobby and the character wizard re-read your Discord roles at most a minute old, so a Playtest or Player role granted mid-session shows up on the next reload instead of five minutes later  
✎ Ready up, Skip, and Confirm always check your current roles, so a fresh role is never refused as "not on the roster"

## 2026-09-07 · Typing, speech, mentions, the wipe, and a Scene tab for the GMs

✚ "Cersei is typing…" on the Play page, under the character's presented name, whether they type on Discord or on the web.  
✚ Discord-style text on the Play page: spoilers, subtext lines, and anything said inside quotation marks is tinted as speech.  
✚ Type @ to mention someone standing with you; the mention renders as their chip on both faces and rings a quiet chime for them on the web, which they can mute.  
✎ The Dawn wipe clears the Play page's feeds at the same instant it clears the Discord channels; the archive keeps everything.  
✚ The player desk's inspector has a Scene tab: a live, read-only view of where a character stands and the rooms around them.

## 2026-09-06 · Play from the web: a switch that takes your Discord account out of every channel

✚ A switch on your Bio, "Play from the web". Turn it on and your Discord account leaves every Location channel, Room thread, Conversation and the turns console, and your nickname is cleared, so nobody in the guild can tell which account is your character. You play from the Play page; DMs still reach you. Turn it off and everything comes back. Switching cools for two hours.  
✎ Every pass that puts an account back into a channel, from a move to the nightly channel doctor to a key changing hands, now knows to leave a web-only player out.  
✎ Fixes a fault from earlier today: the record of who is in a Conversation was missing from the deployed schema, which broke the Play page for players.

## 2026-09-06 · The world writes itself down

✎ Everything the world says into a channel is now a line in the Play page's feeds too: arrivals through a gate, smells, sounds and the bell, turret bursts, the PA, noticeboard pins and tears, whispering heard from a Room, the staged public declarations, and the turn opening in every zone.  
✎ The archive's Speech view keeps those scene lines out of the transcript, where the day dividers already fold them.

## 2026-09-06 · The Play page grows its right column: people, the place, and you

✚ Who is standing with you, with the same Look at, Heal, Transfer, Loot, Bind, Free, Harm and Move Player dialogs the sheet has, one tap from their name.  
✚ Every button the Discord anchor carries is on the Play page too: Travel with drag-along and Turn back, Examine the place, Storage, the Noticeboard, Converse, the Bell, the PA, the turret, gates and keyed doors.  
✚ Move, a Report to the GMs box, and a Waiting-on-you list of offers, threat seats, letters and lobby seats you can accept or decline from the web.  
✎ Gates, keyed doors, Move and Who's here now run one implementation for both faces.

## 2026-09-06 · Weather is gone, and every turn opens on a new photograph

− The weather system: no more clear/fog/rain/storm, no roll, and no sentence about it on the turn announcement. It gated nothing.  
− The GM's "set next turn's weather" control on the Dev Panel. The note box beside it stays.  
✚ Eight new turn photographs, four for Dawn and four for Dusk, graded to sit together as one set. One is picked when the turn opens.  
✎ A turn never repeats the picture the last turn of the same half of the day used, so no two mornings running look the same.  
✎ The picture is remembered on the turn, so a bot restart reposts the same one instead of quietly swapping it mid-turn.  
✎ Changing a turn's phase by hand on the Dev Panel now picks a fresh picture for it, which doubles as a way to re-roll one you dislike.

## 2026-09-06 · Weights back up, made real, and the carry cap down to 84 lb

✎ The 30% weight cut was an accident and is undone: everything is back on the old scale  
✎ Then a realism pass, item by item: a dagger is 1 lb, a longsword 3, a halberd 6, a war hammer 5, a crossbow 8, a knight's helm 6, a cigarette nothing  
✎ Heavy things stayed heavy: plate 55 lb, cataphract 65, a flamethrower 40, a Graga corpse 75, a Squeeze cube 17  
✎ The base carry cap is 84 lb, down from 120. A knight in full plate with sword, dagger and shield has about fifteen pounds spare  
✎ A refugee cannot carry a shift's Squeeze any more, and a Horse and Cart clears about four turns of Factory output in one trip rather than five

## 2026-09-06 · Rooms have no slowmode, and a wipe waits for Discord

✎ Room threads and Conversations carry no slowmode after all; the five minutes stays on the zone summary alone. The earlier note saying Rooms got 30 seconds was wrong and is undone here.  
✎ A Restart Game no longer loses its Room threads and anchors: creating a thread now waits out Discord's minute-long rate limit instead of giving up at 30 seconds, which is what emptied every Location channel twice today.

## 2026-09-06 · Every place on the Play page, and Location channels go quiet

✚ The Play page now shows every place you can hear: the Location, its Rooms (the private ones you hold a key or an invitation to), your Conversations, and the zone Summary, each with an unread dot. Three columns on a desk, tabs on a phone.  
✎ Location channels are scenery now, not speech. Nobody can type in one; talk happens in the Room threads, which carry a 30-second slowmode, and in the zone summary.  
✎ Who is in a Conversation is a record the game keeps, and the Discord thread follows it, so a player can be let into one without ever seeing the thread.  
✎ Moving, gaining a key or being let into a room updates your open Play tabs on the spot.

## 2026-09-06 · Everything weighs about 30% less

✎ Every item in the catalog is roughly 30% lighter; the carry cap stays at 120 lb  
✎ The weight bands are now 0 / 0.3 / 1.5 / 3.5 / 8 / 20 / 40 / 70  
✎ A Squeeze cube is 12 lb, so a refugee can now walk a full shift's output out of the Factory

## 2026-09-06 · Spectators only watch while the game is on

✎ The Spectator role sees the channels only while the game is Running or Ended; in Closed or Lobby it is denied view, so testing before launch pings nobody who came to watch  
✎ Every phase change re-checks it, and the channel doctor's cheap pass repairs any channel that drifted

## 2026-09-06 · Loot the room you're in, a sheet that keeps itself current, and a bomb that says it's armed

✎ The Loot button now lists the rooms here beside the people. Picking a room takes from its stash, the same way Transfer's From-the-room already did.  
✎ The character page refreshes itself when something on your sheet or in your Location changes, so a move made from Discord no longer leaves the old rooms in the pickers until a reload. It checks a small fingerprint every ten seconds and only reloads the page when that moves.  
✎ The Nuclear Device tag reads "armed · 2t" while the countdown is running, and its tooltip says which turn it fires on.

## 2026-09-06 · One write path, and messages you can take back

✎ Everything a character says now goes through one path on both faces, so a Stupid character babbles on the web exactly as on Discord, and the speech gate, the length cap and the autocorrect are decided once.  
✚ Edit and delete your own message on the Play page, for five minutes after you say it. The Discord ✏️ and ❌ reactions follow the same five-minute rule.  
✎ A message edited or deleted on either face changes on the other within a second, and a bot restart no longer makes older messages inert to reactions.

## 2026-09-06 · The web app's icons are now Lucide

✎ Every icon on the site is redrawn from the Lucide set at the same thin weight, so the rail, the action grid and the GM buttons all match  
✎ Six game-specific glyphs (the Tower, the ankh, the cleaver, the two headstones, the wax seal) stay hand-drawn

## 2026-09-06 · The web can speak: a live Play page

✚ A Play page on the web, right under Character: the channel of the Location you stand in, live, with a box to speak into it. What you type appears at once and reaches everyone else within a blink.  
✎ Every message a character says is now written down with where it was said, so the web page and Discord read one record.  
✚ A line typed on the web is posted into the Location's Discord channel by the bot within a second, and a bot restart never loses one.

## 2026-09-06 · The Deaf tag is gone, and the trade kits are one-per-character

− The Deaf tag. Hard of Hearing no longer conflicts with it, and the intercom no longer refuses anyone for it  
✎ The three Commoner kits conflict with each other, and so do the ten Courtier kits, so a character picks one trade at creation  
✎ Six retired tags pruned from the database: Deaf, Empathetic, Kennelmaster, Navigating, Compromising Letters, Peerless Beauty

## 2026-09-06 · Four community fixes, merged from Erdromian's and kezzawozza's pull requests

✎ A bare cart is now refused at an on-foot threshold, the same way a horse is  
✎ The Dev Panel's Kill, Spend turn, Restore turn and Transfer ⬢ dialogs have their reason box back, so Transfer ⬢ works again  
✎ Faction invites and applications have their note field back, so the 'We said' column finally shows something  
− Eating a Gunpowder Grenade

## 2026-09-06 · A Playtest role, and a leaner lobby

✚ A Playtest Discord role, handed to every Contributor: it skips the lobby and creates a character in any phase, like a GM, and counts as on the roster without the Player role  
✎ The lobby is two columns now — roles on the left, the Ready card, the fallback dropdown and the antagonist boxes on the right — with every explainer and tooltip gone  
− Starting areas from the lobby's role rows

## 2026-09-06 · The handbook and the GM docs know about the lobby

✎ The player handbook explains readying up, the roll, the deadline DM, and joining by hand after the start  
✚ LOBBY.md, the GM-side reference for phases, the roll, the creation window, End Game and what a restart keeps; the launch runbook now ends with Open lobby instead of a switch  
✎ THREATS.md says how a seat's forbidden tags work and what Assign refunds; ARCHIVE.md describes the game picker and the folded transcript

## 2026-09-06 · The archive, remade, with every past game in it

✚ A game picker on /archive: past games are readable by anyone signed in, with their reveal at the top; the current one still opens when the game ends  
✎ The transcript is a dense day-by-day read now: sticky Day · Dawn · Rain headers, a line per place, one line per thing said at the small size, no avatars  
✎ Arrivals, deaths, moves and desires fold into one muted line per run that opens on a click; the Show switch picks Speech or Everything  
✎ Zone and character filters come from the game's own rows, so a past game filters by who and where it actually had

## 2026-09-06 · Ending the game, and games that outlive the wipe

✚ The bomb going off ends the game: the clock stops, the archive opens, and the reveal follows the fireball into #turns  
✚ End Game writes a reveal — your closing note, how long it lasted, who was who with antagonist seats named and the dead marked — and posts it to #turns  
✎ Restart Game keeps the transcript now: every game is numbered and its archive stays readable; the game picker lands with the archive remake  
✎ Close lobby freezes it: Preview and Start work on a closed lobby, so nobody can ready up under a preview  
✎ An assignment DM that failed to send goes out again on the next sweep, and the reminder carries the link  
✎ From review: a rolled seat is spent by any character its player makes, spawn-only seats can't be hand-set, and the lobby's ready count refreshes itself

## 2026-09-06 · Start Game rolls the lobby into seats

✚ Preview on the Game section shows who would get what and warns about leader seats nobody wants; hand-set any row, re-roll for a fresh seed, and Start commits exactly that table  
✚ Everyone assigned gets a DM with their seat, a link to build the character, a Discord-clock deadline and a Decline button; the seat is theirs for the creation window  
✚ A reminder six hours before the window closes; past it the seat is released and late join can take it  
✎ The wizard opens on the Tags step with the role fixed for an assigned player  
✎ Every seat count now includes seats held by lobby assignments, so late join and spawns can't double-book one

## 2026-09-06 · The turret tells armour apart again

✎ A burst is far deadlier to the unarmoured and far kinder to the well-armoured  
✚ Everyone now has a flat one-in-ten chance to dodge a burst outright, armour or none  
✎ Light Infantry Armour turns a little less

## 2026-09-06 · A lobby to ready up in before the game starts

✚ While the game is gathering, /character is the lobby: set Off, Low, Med or High on every role (one High at a time), say what happens if nothing fits, tick antagonist boxes, and press Ready. It saves as you go and remembers you next game  
✚ The Game section on the Dev Panel lists who readied and what they asked for  
✚ Gamemasters get a Skip to character creation button in the lobby, for testing  
✎ Character creation is open while the game is Running or Ended; Ended stops only the clock

## 2026-09-06 · Giant, Strong and Pack Mule no longer stack

✎ Giant, Strong and Pack Mule now conflict with each other, so a build can hold only one of the three carry bodies

## 2026-09-06 · Twelve antagonist boxes, two of them the Thanati

✚ Cultist and Cultist Leader are real seats now: they grant the Thanati belief, the leader wears a mark on top, and a GM can Assign or Spawn them  
✎ The Succubus box is the Demoness seat under its own name, so the 18+ nature is plain; the Bastard, Cultist Leader, Succubus and Tribunal Ordinator boxes need the Whitelist role  
− Aberrant Emissary, False Chaplain, Neomorph, Phrygian Count, Tribunal Operations and Warlock from the opt-in list; Skinless and Windlander join it  
✎ Assigning a seat now refunds any tag it forbids that cost points, keeps drawbacks, and drops a second Belief; the DM says what went  
✎ The Assignments table shows lobby opt-ins for players without a character yet, and a WL column

## 2026-09-06 · The game has phases now: Closed, Lobby, Running, Ended

✚ A Game section on the Dev Panel with Open lobby, Start game, End game and Resume  
✎ Turns only advance while the game is Running, from the nightly cron and from End turn alike  
✎ Restart Game no longer resets the Configuration knobs; they carry over between games  
− The Open to players switch; a Running game is what opens character creation  
✎ Ending the game opens the archive to players  
✎ The Configuration section is grouped, every knob has a tooltip, and the noticeboard lifespan is finally editable

## 2026-09-06 · The marshes fish less, the Village fishes more

✎ The five open Marshes fish at 1.0 instead of 1.3
✎ The marsh Village fishes at 1.3 instead of 1.5 — still the best water in the game
✎ Corrected the Laboring doc's yield table, which had drifted off the map


## 2026-09-06 · Farming pays 9% more

✎ Laboring (Farming) now pays 15–21 ⬢ instead of 14–19


## 2026-09-06 · Travel that costs your Move takes a day

✎ A zone crossing that spends your Move now lands NEXT turn: you keep standing where you are until the day turns, so the new zone's channels no longer open the moment you press Confirm  
✎ Free zone crossings and walks inside a zone are unchanged — still instant  
✚ A Turn back button for anyone already on the road. It only clears the destination; the Move is spent either way  
✚ A book on the shelf in the Successor's Chamber

## 2026-09-06 · Ten equip slots, and the Merchant can crate his own goods

✎ Everyone has 10 equipment slots instead of 6. The one-helmet, one-cuirass, one-shield rule is unchanged  
✚ Packaging Equipment in the Company's silo in the Cargo Bay, so the Merchant no longer walks to the Factory to pack a crate

## 2026-09-06 · Tag chips say what a thing weighs

✎ A tag's hover panel now says what it weighs, and a stack says both the each and the total  
✎ Nothing weightless shows a line: a skill, a horse, a graft in your neck

## 2026-09-06 · Avatars all sit on the same dark stone now

✎ The helm avatars and the built portraits were still lighter than the letter plaques. They all share one ground again, and there is no green left in any of them

## 2026-09-06 · The Censor can read

✚ The Censor starts Literate, like every other Court seat

## 2026-09-06 · Depressed only fights the tags that touch Desires

✎ Lazy, Insomniac, Guilt Ridden, Torturer and the four phobias can sit alongside Depressed again. None of them touches the Desire system, so there was nothing for them to argue with.  
✎ Nobility and Eunuch do lock Desires, so those two now conflict where they did not before.  
✎ The test is simply whether a Personality tag locks or opens Desires at all, rather than a hand-picked list.

## 2026-09-06 · Storage and the noticeboards check the character who pressed the button

✎ Clicking Storage in a room, or opening a noticeboard, checked where somebody else was standing. Almost everyone was told "You're not here" in a room they were plainly in  
✎ Tearing a notice down would have put the paper in that other character's hands, and pinning one would have taken it out of their pack. Nothing had been pinned yet, so nobody lost anything

## 2026-09-06 · Desire names are plain prose, and thresholds read in both currencies

✎ Desire names no longer link tags — Sake and Ravenheart Red were chips while alcohol and moonshine beside them were plain text, so the picker looked half-finished  
✎ Gambling wins and Resources thresholds now read in both currencies: Win 5 ⬢/¢, Have 100 ⬢/¢, and so on  
✎ Kill someone you hate is 4pt  
✎ Save someone's life is repeatable on a 5-turn cooldown; saving a faction leader's life is the once-a-life one. They were the wrong way round  
✎ Kiss someone and Gain a lover both get a 4-turn cooldown  
✚ Get married, once a life — it replaces Gain a lover you should not have, which is retired  
✎ Confess your sins is now Successfully confess something

## 2026-09-06 · Depression crowds out everything else about you

✎ Depressed can no longer be combined with almost any other Personality tag, on top of the Addictions it already ruled out. A depressed character is depressed first and everything else second.  
✎ The six that still sit beside it are Nobility, Eunuch, Debtor, Poor Swimmer, Motion Sickness and Lightweight, none of which is really a disposition.  
✎ Depressed now gives back 8 points instead of 6, which is what the design notes always said it should be.

## 2026-09-06 · Pushing an update deploys the whole site again

✎ Every push now rebuilds both the website and the bot. Half the updates were quietly not deploying at all, which is why the site kept showing yesterday's behaviour until someone redeployed by hand  
✎ Database changes are applied automatically just before an update goes live, so a page can no longer break with a bare error code because a column was missing

## 2026-09-06 · Let a Depot Keycard work the machinery, not the money

✚ A Depot Keycard now calls the shuttle down, loads it, sends it back up, and feeds and starts the generator  
✎ The keycard still spends nothing — ordering, the ATM, the credit line, the obol counter and the turret stay on the Merchant's Licence  
✎ Only the Licence can shut the generator down, because the lights going out take the turret with them  
✎ The Feed button used to be greyed out by the very outage it existed to fix, so a dead generator was unrecoverable from the console  
✎ Working the Depot console is an ACT now — an incapacitated Merchant could order, bank and refuel from the floor

## 2026-09-06 · The whitelist points at a role that exists

✚ The Whitelist role works again — it was pointing at a role deleted in the pre-launch cleanup, so all 24 whitelisted players were locked out of every whitelisted seat with no error shown  
− - almost certainly deleted by the pre-launch cleanup and remade with a new snowflake. isLeaderWhitelisted is a plain roles.includes(), so it returned false for everybody: all 24 holders of the real @Whitelist role were locked out of every whitelisted seat, greyed with no error anywhere. The gate fails closed on purpose, which is exactly why it was silent.

## 2026-09-06 · Playtest mode is gone

− The playtest lever on the dev panel. Both of its lists were empty, so it never locked anything

## 2026-09-06 · The web app is back up

✎ A half-landed change had left the site querying two database columns that no longer existed, which took every page down. The structural-edge system is now properly gone

## 2026-09-06 · The zone picker answers on the click

✎ The Zones control now responds to a click straight away, instead of freezing for about twenty seconds  
✚ A picked zone turns orange, so you can tell at a glance which ones you have  
✎ Your GM: <Zone> Discord roles now catch up a second or two after the click, rather than holding it up

## 2026-09-06 · The bot is back up, and appearance has more room

✎ The bot had been crashing on boot since the phobia pass shipped half-committed; the missing pieces are in  
✚ Character appearance now takes 400 characters instead of 300

## 2026-09-06 · The Fisherman starts skilled at Laboring


## 2026-09-06 · The turn header is a dated subtext line


## 2026-09-06 · Knighthood is back on the picker, for a single point

✎ Knighted is purchasable again at character creation, at 1 ⬢. It stays out of the mid-game store — once play starts, knighting is the Baron's to do

## 2026-09-06 · Ten Courtier kits, and knighthood is no longer for sale

✚ Ten Courtier starting kits — Herald, Seasoned Knight, Tutor, Chaplain, Carouser, Manor Lord, Debutante, Court Physician, Court Artist and Master Engineer. Each is a crate a Courtier buys at creation and unpacks in play, priced well under what it holds  
− Knighted is off the tag picker. It is free now, and comes from the Seasoned Knight kit or a GM's hand  
✚ A hostage bag in the Order Chambers, and two hoods in the Ravine Camp  
✚ Both Brigands start with a Plebeian Hood

## 2026-09-06 · Role charters: the contributor's pass

✎ The Baron, Baroness, Hand and Meister open with new intros; the Baron keeps his intercom and the yard turret  
✎ Forty-odd charter paragraphs reworded across the Court, the Cerberon, the Church, the Sanctuary, the Town, the Company and the Brigands  
✎ Every Watchmen mention now says Cerberi  
− The zone situations (stale opening-state blurbs on every zone)  
− The You-can-crucify line on the Inquisitor, Practicus and Preacher, now that crucifixion is a structure  
✎ The Bishop is untouched

## 2026-09-06 · The Cross structure is called Crucifix

✎ Tag names have to be unique and a Cross item already exists, so the structure that crucifies people is named Crucifix. Players still read it as the cross in every line about it.

## 2026-09-06 · The new Cross structure syncs again

✎ Its slug (crucifix) differs from its name on purpose, because a Cross item already exists; the tag sync now knows that.

## 2026-09-06 · Crosses, crucifixion, and a leaner structure catalog

✚ A Fundamentalist standing at a finished Cross can Crucify anyone standing there, from the People here actions. No consent and no Move spent. The victim can still speak but do nothing else, becomes Dying at the close of the turn, and dies at the close of the next.  
✚ Cross: a new structure, 6 ⬢ and one turn, no skill needed. The Square and the Crossroads each start with one standing.  
✚ Watchtower: an elevated tower with a defence note, 20 ⬢ and two turns with Builder (Skilled).  
− Library, Jailhouse and Bridge are gone from the structure catalog.  
− The structural-edge machinery (a Bridge holding a crossing open, a Palisade holding a gate shut) is gone entirely. No edge on the map ever used it.  
✎ Forge is 15 ⬢ and two turns now (was 30 and four). Palisade takes four turns (was six). Battering Ram takes two (was three).  
✚ Two Desires: Build a Wayside Shrine (2 points, any belief but Atheist, six-turn cooldown) and Crucify a heretic (2 points, Fundamentalists).  
✚ The Undercroft has a Vault behind the Baron's key, holding 14 ⬢, 15 obols and a painting.  
✎ The Inquisitor, Practicus and Preacher role text now says they can crucify people once they build a cross.  
✎ A character who can't act (Bound, Dying, Crucified, out cold) can no longer lock in a Move from the Discord modal. Labor was already refused there; Routines and Gambits used to go through.  
✎ A Location in the zones master can now list structures that were always standing there, and the zone sync raises them.

## 2026-09-06 · Phobias, a Debtor, and a dozen new personality drawbacks

✚ Four phobias. Claustrophobia keeps you Afraid the whole time you are in the caves; Acrophobia makes you Afraid anywhere in the Black Hills and Panic at the Mountain; Pyrophobia and Teratophobia are for the GM to call  
✚ Guilt Ridden can't confess and now and then wakes Exhausted; Insomniac wakes Exhausted about one dawn in five  
✚ Lazy earns a quarter less from every day's labor, and the range on the sheet shows it; a chaplain can confess it away  
✚ Lightweight's first drink lands them Wasted, the next one Unconscious. Iron Liver now takes two drinks per rung after the first  
✚ Motion Sickness can't ride a horse or a boat, and vomits if somebody drags them across a zone on one  
✚ Poor Swimmer, and Debtor: 20 obols in hand, 40 owed, with three DEBTOR notices up at Customs the moment they arrive  
✎ Afraid now lasts one turn instead of two  
✎ You may take up to 6 drawbacks, claiming back up to 13 points

## 2026-09-06 · The bell carries by distance now, and there is a trumpet

✎ The church bell now carries by distance instead of to a fixed list of zones — loud around the Cathedral, faint out at the edges, and silent underground  
✚ A Trumpet. Carry one and a Sound Trumpet button appears on your Character page; it does what the bell does at three-quarters the range, from wherever you are standing  
✎ Both wait half an hour between soundings  
✎ Every noise the world makes now opens 'You hear' — the turret, the gatehouse rotor, the depot generator and shuttle, and whispering all say it the way a shout already did

## 2026-09-06 · The Teaching tree is a Skill now, and nobody can be taught to teach

✎ Teaching, Lecturing and Drill Instructor now sit on the Skills tab of the store instead of under General  
✎ None of the three can be taught: you can't learn Teaching from a teacher  
✎ Drill Instructor is still for the Cerberi and the Censor only

## 2026-09-06 · Selling to the Merchant pays 60% now, not a quarter

✎ Selling something to the Merchant now pays 60% of its shelf price, up from the ~44% it was before — stocking goods and trading them on is worth doing  
✎ Seven craftable or brewable wares keep a wage floor, so 60% never cuts what a maker earns

## 2026-09-06 · The Merchant stops being a laundry, and sells energy shields

✎ Depot prices are down about 18% across the board  
✎ Selling something back to the Merchant now pays a quarter of its price, not nearly half — buying a rifle and reselling it is no longer a living  
✚ Energy Shields are on the Merchant's shelf at 145 obols, the best protection against a turret that money can buy  
− The Fortress Starting Packet  
✎ Rewrites: combat, the Pusher, Ravenheart's economy, Post-Christianity, concealing, the Sanctuary

## 2026-09-06 · Trial Gamemaster is a Gamemaster in everything but name

✚ A Trial Gamemaster role that grants exactly what Gamemaster does — every /gm page, every GM channel, and the /gm and /dm commands  
✎ The Gamemasters roster now says which seat somebody holds: Gamemaster, Trial GM, or Master  
✚ Two more superadmins

## 2026-09-06 · A pass over the tag catalog: fighting skills, mountaineering, and softer drawbacks

✎ Melee (Clubs) and Shield Wall come down to 8, Duelist to 9, and Guerrilla to 5 — the fighting specialisations were priced past what most builds could reach  
✎ Mountaineering costs 2 instead of 3, and the Ravine and the Outcrop now open to it rather than to Caving — climbing had one room to Caving's three  
✎ Caving goes up to 4  
✎ Depressed, Deaf, Tremor, Arthritis, Night Blind and Migraine all refund fewer points; Glass Jaw refunds one more  
✎ Pretty and Beautiful cost 3 each and can only be bought at creation  
✎ Soft Hands no longer forbids the Laboring skills — the half-⬢ penalty is the whole tag  
✎ Clumsy and Stealth now refuse each other  
✎ Craven only locks Desires about bravery now, not violence and adventure as well  
− Insomniac

## 2026-09-05 · Avatars sit on a plate that falls into shade

✎ Every avatar background now darkens toward the bottom, so a face, a helm and a letter plaque all read as lit from above instead of pasted onto a flat slab  
✎ Concealed-identity helms are noticeably bigger — they fill their frame the way a portrait does instead of floating in the middle of it

## 2026-09-05 · A fisherman lives out in the marsh village

✚ A new Fisherman fate: one seat, easy, starting alone in the marsh Village with a rod, a boat and the key to his hut  
✚ The Old Hut, a locked room out past the village with two obols and a pet rat in it  
✎ The Banneret and the Geschef are both told there is a fisherman up north and obols in the office to pay him with  
✎ Fast Metabolism is now called Big Appetite, and the Geschef starts with one  
✎ The Banneret and the Geschef count as Ravenhearters after all  
✚ A cigarette in the overseer box  
✎ The Fates thread in #info now groups fates the way the site does, and no longer says which zone anyone starts in  
✚ A quieter way to push #info: it edits what is already there instead of reposting, so nobody gets pinged for a typo fix

## 2026-09-05 · Drinking has a ladder, and the tags that say you can't now stop you

✚ Drinking while Tipsy makes you Wasted; drinking while Wasted puts you Unconscious on the floor  
✚ Wasted and Unconscious both wear off into a Hangover  
✚ Unconscious counts as helpless: you can be looted, dragged and tied up where you fell  
✎ A GM granting the same tag twice still does nothing — only drinking climbs  
✚ Bound, Paralyzed, Unconscious, Dying, Catatonic and mid-Seizure can no longer walk out of a room, hand over a purse, butcher, buy, write or work  
✚ Mute finally does something: it stops you speaking, and nothing else  
✎ Bound deliberately still lets you shout — a hostage can call for help  
✚ Deaf can't work the Council Room intercom  
✎ Stupid now garbles ordinary channel chat, which it never actually did before  

## 2026-09-05 · The Depot's horse comes down to 110

✎ A Horse at the Depot now costs 110 ⬢ and sells back at 48 ⬢, down from 120 and 53.

## 2026-09-05 · The Merchant sells horses, and a builder can make a boat

✚ The Depot now stocks a Horse at 120 ⬢, sells one back at 53 ⬢. Mid-game he is the only horse in Ravenheart, and the price says so.  
✚ A Skilled Builder can now make a Fishing Boat: 40 ⬢ and one turn, same bench as the Cart.

## 2026-09-05 · Desires that cost nothing now cost a wait

− Six Desires that were impossible or paid for a single click: See the Windlands, Stay 2 turns in the Aberrant Pits, Experience something exciting, Perform a charitable act (the ungated one), Convert someone to the Old Ways, and Convince someone to skip mass  
✎ Every consumable — drinks, smokes, drugs, meals — now waits 3 turns before it pays again, so trying something new beats repeating the same cigarette  
✎ The one-line social Desires (a hug, a story, an insult, a chastisement) all settle at 3 turns, down from 5  
✎ Winning a game of chance now needs something actually staked  
✎ Saving a life, and a migrant being let through the Town gates, are once ever  
✎ Buying from the Merchant waits 5 turns, seeing a monster 4, torture 6  
✎ Converting someone to your religion drops to tier 3, and is now the only Desire covering conversion  
✎ The Demoness can humiliate somebody privately or publicly — two Desires, not one act paying twice  
✎ The Windlands are gone from the game's text. #info was still telling players it was one of three surface zones; it now names the five we have, and the two cave levels

## 2026-09-05 · Changelog notes stop getting cut off mid-sentence

✎ A note written as a wrapped bullet in a commit message used to lose everything after its first line break, so entries reached Discord as half-sentences ending in 'which may'. The whole bullet is posted now

## 2026-09-05 · A tag now says which Desires it unlocks

✚ Hover any tag and it now lists the Desires it unlocks, with what each one pays. 66 tags gate a Desire and not one of them said so — a player deciding whether to buy Cruel had no way to learn it opens seven goals
✚ The same list on the point-buy screen and in the Tag Catalog, so it's there at the moment you're actually spending points
✎ A Desire that needs more than the one tag says so quietly — "with Butcher", or "+ role". A tag that opens something on its own says nothing extra, because it doesn't need to
✎ Only what a tag OPENS is listed. Nothing about what it shuts — Addictions and forbidden-tag gates stay out, so the list never has to be read twice
✎ Confess your sins is now open to any Post-Christian. It's the ordinary practice of the faith, not an advanced one
✎ Fundamentalist and Pilgrim used to announce their Desires in their own descriptions. They don't have to any more

## 2026-09-05 · Scrap armour is scrap again

− Salvage Plate protects a lot less: it now sits just above padded armour and below a mail shirt, which is what scrap metal strapped to your chest is worth

## 2026-09-05 · Spare hatchets at the Godard Factory

✚ Three hatchets scattered around the Factory, which had none — one in the Logistics Room, one on the Main Floor, one in the Pub  
✎ A hatchet is the Refugee's whole job (Godflesh needs one equipped), there is no forge in the Marshes, and the crafting change earlier today put the hatchet recipe behind a forge — so a Refugee who lost theirs had no way to replace it in their own zone  
✎ Not in the Spillway, which destroys what lands in it, and not in the Overseer Box, which is the Banneret's


## 2026-09-05 · Armour is a number on the gear now, and the turrets are lethal

✚ Every piece of armour, headgear and shield carries a Melee and a Ballistic rating, shown as a word — None, Meager, Sufficient, Good, Strong, Overkill  
✎ The turrets used to read a hardcoded list of seven body armours, so every helmet, shield and the spacesuit counted for nothing; a helmet now protects you  
✎ Being shot unarmoured is properly dangerous: two fifths dying or dead, two fifths badly hurt, one fifth walking away. The best kit in the game still buries one wearer in twenty  
✚ A turret firing now shouts RRATATAT into its own Location and echoes it across every other Location in the zone, on every burst, once per burst  
✚ The turret DM names the wound you took instead of leaving you to go and look it up  
✎ Adding someone to a private room or a conversation no longer leaves an 'added X to the thread' line in the middle of the scene  
✎ Equipping something no longer freezes the sheet for five seconds — the Discord work moved off the click, and it stopped calling about rooms nobody is standing in  
✎ /conceal under a forced mask said 'take it off first', which read as the mask breaking concealment when it was granting it. It now says you are already hidden, and names the piece  
✎ Helm avatars are bigger and fade into their plate the way portraits do

## 2026-09-05 · The Caving document is in Bascinet's words now

✎ A new player-facing Caving brief: what the caves and the depths are, that moving is what triggers an encounter, that sitting still is safer, and that dangerous ones get settled at the end of the turn  
✎ It names the three things you can do down there — roll encounters, spend a Gambit hunting or scavenging or searching a room, and take on a Quest  
✎ Dropped from the old draft: the note that Customs never rolls, and the reminder that changing level costs a turn

## 2026-09-05 · The Caving document is in Bascinet's words now

✎ A new player-facing Caving brief: what the caves and the depths are, that moving is what triggers an encounter, that sitting still is safer, and that dangerous ones get settled at the end of the turn  
✎ It names the three things you can do down there — roll encounters, spend a Gambit hunting or scavenging or searching a room, and take on a Quest  
✎ Dropped from the old draft: the note that Customs never rolls, and the reminder that changing level costs a turn

## 2026-09-05 · Your role's charter opens with its own line now, and the Inquisition gets its tools

✎ Every starting role document now opens on the role's intro sentence, in italics — it used to show only in the creation picker and never again  
− Nine roles had that sentence copied into the document by hand; those copies are gone  
✚ Torturer, a 2 pt tag the Inquisitor starts with. Won't sit alongside Charitable, Pacifist, Saint or Eusoch  
✚ Barbed Net — takes Crafting and Fundamentalist both to make one, so only the Order can  
✚ The Truncheon, carried by the Censor, the Cerberi and the Practicii. Nobody can make another  
✚ Tear gas, a mace, a padded cap and a crossbow in the Order Chambers; truncheons in the Armory; pitchforks and a work knife out in the fields  
✎ The farming bonus moved off the Hatchet onto the Pitchfork, where a farmer would look for it  
✎ The Dead Simple crafting rung asked for BOTH Crafting and Smithing, not either — so the entry tier was harder to reach than the one above it. It now splits by material: wood and cord take Crafting, metal takes Smithing at a forge  
✎ The Smithing paper was missing thirteen things you can make; the Fine Meal, the Lavish Meal and Moonshine were missing from theirs. All fixed, and `npm run db:audit-craft-docs` now catches the next one  

## 2026-09-05 · Verify pass: five real holes in the camera, the shout and the die

✎ A GM's staged "Relocate to" into the Depths rolled no Caving Die at all. The old turn-start sweep used to catch those people; it rolls properly now
✎ A shout named the secret crawl it came through. It still carries through one — that part is the rule — but it no longer says which way, when the way is one nobody is supposed to know about
✎ A photograph carried the photographer's medical training, so a surgeon could photograph their own diagnosis and hand the print to somebody who couldn't have made it. The camera sees what a camera sees now
✎ A photograph unmasked a hood that had since come off, filing the print under a real name nobody in the room ever heard. It records the face the room actually saw
✎ Photos were free and unlimited. One shot per message per photographer now — the camera is still reusable, but photographing the same moment twice is the same photo
✎ The Caving desk showed only the zone, so a GM saw several identical rows for one character with no way to tell which tunnel each happened in. It names the place
✎ Shouting from inside a room put the shout everywhere except that room


## 2026-09-05 · Every room id says where it is

✎ Room ids are now always <location-stem>-<room>: keep-throne-room, inn-cellar, customs-watchtower. 98 of the 127 rooms were renamed  
✎ Nothing a player sees changed. Display names are untouched, so there are still four rooms called Watchtower and two called Road  
✎ The rule is written down in the zones.yaml header and CHANNELS.md, and it replaces the three comments that used to explain which id was already taken

## 2026-09-05 · Cameras take photos, /shout carries, and the caves only bite when you walk

✚ The Instant Camera works. React 📸 or 📷 to somebody's message and you get a Photo of them, frozen exactly as they looked right then — a real object you can hand over, stash, or have stolen. The camera is reusable; consuming one instead prints a photo of nothing.
✚ /shout, which carries four places out across the map. It muffles as it goes — clear next door, half static two places off, unintelligible at the edge — and tells hearers only which direction it came from, never who shouted.
✎ The Caving Die no longer rolls at turn start, so camping underground is free. It rolls when you walk into somewhere new down there, once per place per day, going deeper and turning back alike. Customs is now completely safe.

## 2026-09-05 · Six more books on the shelves

✚ Five new books in the Keep's Library: a pet rat manual, a volume of magical regulations, a very short story about a sword, the prophecies of Sir Thomast, and a strategy primer about legs  
✚ A cookery book in the Cathedral Pantry

## 2026-09-05 · The Road and the Manors are places now

✚ A Shrine to a forgotten saint on the road up, and a Ledge below it only the sure-footed can climb down to
✚ The Manors open: a Manor, a Cellar and a walled Garden, all three behind the Manor Key, which until now opened nothing
✚ A Ravenheart Red, an instrument and a sabre in the Manor; four obols and a cave fungus in the cellar
✎ The Road and the Manors both read the way Bascinet wrote them

## 2026-09-05 · More mercenaries and more brigands

✎ Mercenary and Brigand are both a bit likelier to come up when someone rolls for a role — weight 3 each, up from 2

## 2026-09-05 · The Practicus starts with a gas mask

✚ A Gas Mask in the Practicus's starting kit

## 2026-09-05 · Fixes from the Fortress review

✎ Squires start with a Cerberus Key, so they can get into the garrison they live in — the Barracks, the Mess Hall, the Training Yard and the Kennels were all shut to them  
− The Mess Hall's door. It's the Cerberon's silo, and a locked silo hands its key to everyone who accepts an invitation — which would have made a Cerberon invite a dispenser for the key that works every gate in the game  
✎ Binding a book now counts your paper under a lock, so two quick clicks can't turn ten sheets into two books  
✎ A shut gate now tells you where the winch is, and the Bind a Book button says how many sheets short you are  
✚ A bird and a noticeboard now refuse a book by name rather than by accident

## 2026-09-05 · Nine more books on the shelves, and the sewer is filthier

✚ Eight books in the Keep's Library: three baking guides by Madam Molley, three short pieces, and two chapters of a novel  
✚ A third chapter of that novel washed up at the Rockside Washup, for whoever has a boat  
✚ Six lots of feces in the Underquarter sewers

## 2026-09-05 · A real crate washed up in the river

✎ The crate in the Rockside Washup now holds 2 coal and a Squeeze cube, and its side reads like a real shuttle manifest instead of the old coffee-and-knives flavour

## 2026-09-05 · The Fortress is a real place, and books exist

✚ The Lifeweb is somewhere you can walk into: an outside, the chair room behind the Mortii's key, and their shacks against the wall  
✚ The Servant Wing has quarters, a kitchen, a workshop and latrines — anything dropped down the latrines is gone for good, like the Spillway  
✚ The Keep's Noble Chambers are three rooms now, one each for the Baron, the Heir and the Successor, and the Baron's key opens all three  
✚ A Meister's office, a Hand's office with a wax stamp of his own, a terrace, a nook behind the Great Hall's painting, and the pit under the throne room  
✚ The Garrison has a front counter anyone can walk up to, and everything past it needs a Cerberus key; an oubliette, and two hounds in the kennels  
✚ Books: bind ten sheets of paper into one and write it in a single pass, or tear one up to get the paper back. Five are on the shelves already  
✚ A Desire for a Scholastic to write one  
✎ The winch for every gate in the game is in its watchtower now, not out on the road — and the fortress gate finally has a watchtower  
✎ The Baron's Key is just the Baron's Key, and there are keys now for the Hand, the Meister, the Censor, the Heir, the Successor and the Mortii  
✎ The Hand no longer carries a Cerberus key  
✎ The Reliquary Chapel is open to anyone; the Silver Cross is behind its own door off it, and the Merchant would pay 300 obols for it

## 2026-09-05 · Saints are pacifists, and the Judge is off the tag catalog

− Saint now says outright that you cannot fight, not even in self-defense  
− The Judge's seat tag no longer shows up in the player Tag Catalog

## 2026-09-05 · The Town has doors, and the Cathedral has a bell

✚ The Old Cock Inn is a real building: a street, a bar, a second floor, a balcony, a kitchen, and three rooms to rent  
✚ A Sound Bell button in the Cathedral's Bell Tower, heard in the Town, the Fortress, the Forest and the Marshes, once every five minutes  
✚ Both town gates are now gatehouses with a watchtower each, and both can be opened and shut like the fortress gate — by a Cerberus, the Censor, the Baron, the Hand or the Headman  
✚ A Vestry and a Hall in the Cathedral; Sewers, an Organ Shop, the Pusher's Room and the Alleyways in the Underquarter; a storeroom behind the Smithery  
✚ Cigarettes at the Merchant, twice the price of tea, and a Desire for smoking one  
✎ The Scriptorium, the Pantry, the Warehouse, Esculap's Office and the Operating Theater are all behind keys now  
✎ The Cellar Key is the Inn Key, and opens the kitchen too  
− The Hole. The Square and the Inn now meet directly

## 2026-09-05 · Deleting a character is fast now

✎ Deleting a character took over half a minute and now takes about a second. The same wait was on every death  
✚ A whitelisted role wears a dotted border and says "Whitelisted" on its card at character creation  
✚ The star is back beside a Leader role's name in the creation picker  
✎ A role's difficulty reads Easy, Normal and Hard instead of lowercase

## 2026-09-05 · Everyone starts where they actually belong

✎ All 40 roles now name their own starting Location instead of falling through to a default. The default was the first place in the zone alphabetically, which put the whole Court in the Gatehouse, the Church in the Square and the Cerberon nowhere near the barracks  
✎ The Baron, his family and the courtiers wake up in the Keep; the Servant in the Servant Wing; the Censor, Incarn, Cerberi and Squires in the Garrison  
✎ The Church and the Order start in the Cathedral, the Sanctuary in the Sanctuary, the Innkeeper and staff in the Inn  
✎ The Bum, the Pusher and the Mortus start in the Underquarter  
✎ The Merchant, the Docker and the Mercenary start at the cave mouth; a Migrant starts two hops in, at the Stairhead

## 2026-09-05 · Confession works, and the Cathedral has something to make

✚ A Confess button. Take one of your addictions to a chaplain standing with you: it's your Gambit, their Routine, and a 5 or 6 gets it off you  
✚ The chaplain is never told what the confession is about — not in the DM asking them, not on their own Move, not when it's over. Only the penitent and the GMs ever see it  
✚ Blessing, a 5-point skill only the Church can buy, and Holy Water: one turn and 1 ⬢ a bottle  
✎ New briefs for the Bishop and the Chaplain. The old ones promised a confession mechanic that didn't exist  
✚ The Bishop starts able to make Holy Water, and both of them can teach  
✎ Sixteen tags are now marked psychological and can be confessed — the addictions, the compulsions, and a few habits. Not blindness or muteness, which share a group with them  
✎ Superstitious is off every role that started with it. The Inquisitor, Practicus and Preacher start Fundamentalist instead  
✎ Stutter is a 1-point drawback now, not 2  
− Disgraced and Bad Liar are gone from the game  
✎ The Bishop can want a confession now; that goal was locked to the Chaplain role  
✚ Three goals: sprinkle holy water on the unholy, crucify someone, and get the Baron to praise God in the cathedral

## 2026-09-05 · The cave mouth is one place, and Examine reads like a table

✎ Customs and the Depot are one place at the cave mouth — the customs yard, the storefront, the landing pad, the watchtower, the merchant's office and the cargo bay all under one roof. They used to be two Locations with no way to walk between them  
✚ A gate into the caves that can be shut, worked by the Cerberon, the Censor, the Baron, the Hand, or anyone holding a Cerberus Key  
✚ The Cerberus Key: starting kit for the Baron, the Hand, the Censor, the Incarn and every Cerberus, three spares in the Censor's Office. It opens the watchtower and works the Keep's portcullis  
✎ Examine now reads as a table — every line is a bolded topic and one short sentence, the shape the labor readout already had. Standing outdoors says so, where it used to say nothing at all  
✚ The Landing Pad's own description says whether the shuttle is sitting on it, and changes when it leaves  
✚ A Large Dock on the West Riverbank, and the hunting there is a little better for it  
− The Depot's back track through the sparse field. The road from the Crossroads is the way in

## 2026-09-04 · A GM can send anyone a letter, and the picker reads as seven groups

✚ A Send a Letter button on the Dev Panel: a bird arrives carrying a letter from whoever you say it is from — the God-King, a dead man, nobody at all  
✚ A letter can go out sealed with a mark you invent on the spot, and it reads as a seal to everyone until somebody breaks it  
✚ The reply comes back on that player's conversation on the Players desk, drawn as paper rather than as chat  
✎ Character creation now groups roles as Court, Clergy, Cerberon, Saviors, Business, Soil and Outsiders, with the faction printed on each card  
✎ The Refugee's brief now says what the job actually is

## 2026-09-04 · Minstrels can actually play something now

✚ An Instrument tag, 1 point, granted free with the Minstrel role  
✚ /play, which puts a line into the room you are standing in  
✎ The room hears it full size; the street outside only overhears it, small

## 2026-09-04 · The Forest is a real place now, and Farms moved into it

✚ Every Forest location has its rooms: 22 of them, from the Headwaters cave to the Beaver Dam, with their locked doors and their loot  
✚ The Farms are in the Forest now, with three rooms — Fields, the Village Green, and the Old Church. Getting there from the woods no longer costs a Move  
✎ Fishing pays better in the marsh: 1.3 everywhere, 1.5 at the fishing village  
✎ The Hills Camp tag is now Ravine Camp, and says which ravine it means  
✎ Caving costs 3 points instead of 5, and its description says what it actually does  
✚ The Overseer Box starts with 8 ⬢ and the Logistics Room with 2 ⬢  
✚ The Headman starts with the sewer key  
✚ Refugees start with 2 ⬢ instead of 1, and Migrants get 10 more points to build with  
✎ Three broken ways through the Forest that would have refused to open at all: the climb to the mountain, the crawl to the caves, and a road that led back to itself

## 2026-09-04 · The gun in the fortress yard works now

✚ The triple-barrelled turret on the rotor in the Gatehouse yard can be turned on. It has been described as "off" in the Baron's charter since before anything could switch it  
✚ A red Toggle Turret button in the Censor's Office. You have to be standing in the office to use it, and you have to type ARM or DISARM into the confirm — Discord has no confirm dialog, and a misclick here should not be able to shoot the Keep  
✎ It spares nobody. Unlike the Merchant's turret it reads no faces and checks no keycards: armed, it fires on whoever is in the yard, the Censor included. Armour still decides how badly, so the Cerberon's mail is worth wearing  
✎ Arming or disarming it says one line into the Gatehouse. That is the only warning anyone crossing the yard gets  
✎ It fires on entry and again at the end of every turn, the same two triggers the Merchant's gun uses

## 2026-09-04 · The Tag Catalog opens on /documents, and the building system lands

✚ A Tags tab on /documents — the whole tag catalog, searchable, each card showing what a tag costs and what it asks for  
✎ Every tag now says who may read its card: public, GMs plus whoever it already concerns, or nobody at all  
✚ Building: structures raised over several turns by a crew, standing in a Location and lending their kit to whoever works there  
✚ Fourteen things to build — a forge, a palisade, a bridge, a library, a gallows, a jailhouse, a lazarette, a trebuchet and more  
✚ A structure can hold a crossing open: a ford or a gateway nobody can open by hand until somebody builds it  
✚ A rulings desk on /gm/turns for the calls building throws up, and a /gm/structures page listing everything standing  
✎ Structures pay into Laboring, so a good workshop makes the work behind it better

## 2026-09-04 · The Watch is now the Cerberon

✎ The Watch is the Cerberon, the Captain is the Censor, and a Watchman is a Cerberus. The radio channel, the radio tags, the wax stamp, the office and the handbook page all moved with them  
✚ The Censor starts with a helmet, a shield, Melee (Shield Wall), Ranged (Basic) and the Cerberon radio system, and drops the bottle — Alcoholic is gone from the seat  
✚ Every Cerberus, and the Incarn, now start with Melee (Shield Wall). The Squire does not  
✚ Three Radio Bracelets waiting in the armory, so the Censor can equip new hires without buying any  
✚ A Merchant's Office in the Depot, behind the Merchant's Licence. A desk, filing cabinets, and a big red button  
− The Watch Badge. The gate now recognizes the Cerberon itself, plus Knighted, instead of a badge anyone could pocket  
✎ The Depot's lock moved off the Landing Pad and onto the Cargo Bay — the pad is a hole in the roof, the goods are worth a door  
✎ The Depot terminal only opens while you are standing at the Depot. Every button on it already refused from anywhere else; now the page does too  
✎ The Censor's office is described again, and the turret switch is on the wall where the documents say it is

## 2026-09-04 · The Commoner and her kits, the Arbiter, and four seats retired

✎ The Peasant is now the Commoner, and starts skilled at labor and nothing else — no default farm, no shack  
✚ Three Commoner kits at creation, each one crate you unpack when you like: Fisherman (1 pt, a boat and the fishing skill), Farmer (0 pt, a work knife and the farming skill), Hunter (2 pt, the hunting skill and Forester)  
✚ The Fishing Boat: one extra free zone crossing a turn, but only between the Forest, the Black Hills and the Marshes, plus +1 to fishing labor. It can't be out at the same time as a horse or a cart, and it waits at the door indoors  
✚ The Arbiter, a new Court seat standing in the Keep — the God-King's man in Ravenheart, behind the whitelist, starting with a sabre, a Major's Insignia and 4 obols  
✚ A God-King document explaining who Enoch II is and why the Arbiter is here. Every Court seat gets it, plus the Captain, the Merchant and the Banneret  
✚ The Meister now needs the whitelist too  
− The Diplomat. The seat is retired and its material is filed away rather than deleted, so it can come back whole. Three of its Desires are now the Arbiter's and one is the Scholastic's  
− The Herald and the Outsider. Their two woods Desires now ask for Forester, so a Commoner with the Hunter kit can reach them, and "Deliver an important message" now asks only that you can read  
− The Manor, House and Shack tags. A Manor Key replaces the Manor  
✎ Everyone in the Fortress now starts Post-Christian — the Baron's family, the Incarn, the Captain, the Watchmen and the Squire. That spends their one belief slot, so those seats can no longer pick Atheist or an Old Ways at creation without dropping it first  
✎ The Brigands are their own group now, in the Black Hills where they already camped, instead of sitting under the Town  
✎ Bum 5 → 4 seats per 100 players, Inn Staff 3 → 2, Watchman 7 → 6

## 2026-09-04 · The Leader Whitelist is now just a whitelist

✎ Whitelisting a role no longer means making its holder a faction Leader. The two are separate settings now, so a seat can be gated without leading anything — the Hand is the first one
− The star on gated role cards. A card you can't pick is greyed and says "Whitelist only" on hover instead, which the silent grey never did
✚ The Hand now needs the whitelist. Every seat that needed it before still does

## 2026-09-04 · The point-buy meter stops tripping the contrast gate

✎ No player-visible change — the meter is the colour it always was

## 2026-09-04 · One ruined face per character, and Scarred is no longer a build choice

✎ Ugly and Disfigured now conflict with each other, as both already did with Leper  
− Scarred can no longer be bought at creation

## 2026-09-04 · Two fixes on the Threats tables and the character sheet

✎ The Threats tables now use the full width instead of half the screen  
✎ Fixed a crash on /character — the profile picture field threw as soon as the page rendered

## 2026-09-04 · Leper cannot be stacked with the other ugliness

✎ Leper now conflicts with Ugly, Disfigured, Pretty and Beautiful

## 2026-09-04 · A helmet is a face: concealment now takes something over yours

✎ /conceal needs concealing headgear equipped — a bare face can no longer go unnamed  
✚ Seventeen helmets, hoods and masks, each with its own face for the room to see  
✚ Some conceal by force: a sack or a plague mask gives the wearer no say, and a turn summary honours it too  
✚ Headgear and body armor now sit in layers 1-4, so a coif goes under a helm but two helms do not go together  
✚ One shield at a time  
✚ Bound characters can no longer equip, unequip, craft or destroy — a hostage cannot take the bag off  
✚ A Leper trait, and a Leper's Hood that costs nothing if you have it  
✚ The Merchant stocks a Rat Mask; the Armory trades two Simple Helms for four Cerberus Helmets  
− The Ridiculous Hat

## 2026-09-04 · The drawback cap lands on 5 tags and 12 points

✎ A character may take 5 drawbacks claiming back 12 points, not 4 and 14

## 2026-09-04 · Four drawbacks, worth 14 points, and a Fast Metabolism

✎ A character may now take 4 drawbacks claiming back 14 points, was 6 and 12  
✚ Fast Metabolism, a -6 drawback: you eat 2 ⬢ a turn instead of 1

## 2026-09-04 · A courtier has one wax seal, not six

✎ At most one personal wax seal per courtier, at creation and in the store

## 2026-09-04 · Paperwork: paper you can write on, seal, post and tear down

✚ Write and Seal Letter on the Actions grid, for anyone with their letters  
✚ Noticeboards at the Square, the Gatehouse, the Garrison, the Factory and the Depot — pin a paper, read one, or tear it down  
✚ Paper at the Depot for 1 obol, the cheapest thing on his shelf  
✚ Six courtier wax seals, and eight office stamps each starting in the room its seat works out of  
✚ The Merchant's stamp bears his own initials, taken when he is created  
− The glyph cipher and the Read button, which paper replaces outright  
✎ The Bird carries a letter you are holding instead of typed text, and a wrong guess brings it back rather than eating it  
✎ An illiterate or blind character can now carry a letter they cannot read, and hand it to somebody who can  
✎ A Restart Game now clears crates, headstones and paper instead of leaving them in the catalog forever

## 2026-09-04 · Equipped slots stay full width instead of shrinking to the tag


## 2026-09-04 · The Spillway no longer eats a shift by accident


## 2026-09-04 · The Depot's turret learns the Merchant's face when he is created

✚ The Depot's turret now knows the Merchant's face the moment he is made, so he can arm it himself  
✎ A GM setting the face by hand is the override now, not the only way

## 2026-09-04 · The Merchant starts with 20 obols, not 30

✎ The Merchant starts with 20 ¢ instead of 30, so his first order leans harder on the Company's line  
✎ The cast starts with 80 ¢ between them rather than 90; nobody else's purse changed

## 2026-09-04 · Adds the Godard Factory, the Banneret, and the Squeeze production chain


## 2026-09-04 · An obol is one Resource, so the Merchant can sell you a cup of tea

✎ An obol is now worth one Resource instead of five, so the Depot can price a cup of tea  
✎ Everything cheap is buyable and sellable again — 32 wares used to sell back for nothing at all  
✎ Starting money and the Company's line went up five times to match, so nobody is poorer  
− The Resources/obols toggle on the console; there is nothing left for it to switch between  
− The ⬢-per-obol field on the Dev Panel

## 2026-09-04 · The Black Hills hunt evenly, and the Forest fishes better

✎ Hunting is the same everywhere in the Black Hills now, at 1.0. It was 0.8 across most of the zone with two richer spots; those are gone  
✎ Fishing in the Forest went from 0.7 to 0.9 at all six waterside places

## 2026-09-04 · Five more guns and blades on the Merchant's counter

✚ The Merchant now imports a CTT4&3 Rifle, a Kpfw-6 Avtomat, an Adamantium Sword, a Silver Sword and a BB Pistol  
The two rifles and the Adamantium Sword ship sealed, so nobody reads the crate on the landing pad before the right person opens it

## 2026-09-04 · The Depot can show its prices in obols

✚ A ⬢/¢ toggle beside the balance in the Depot cockpit, remembered per browser. Order, Price List and Hold all follow it  
✎ Obol prices on a row are exact — an 8 ⬢ ware reads 1.6 ¢ — because the counter converts on the total, not line by line. The order total, the Hold payout and the balance stay in whole obols either way  
✎ The Merchant now starts with 6 ¢ instead of 20, about 30 ⬢, and the Company will only advance him 15 ¢ instead of 60  
✚ Silencer, a 90 ⬢ Depot import the Merchant starts holding. Equip to muffle your shots

## 2026-09-04 · Laboring pays about 7% less

✎ The production coefficient drops from 1 to 0.93, in the default and in the live game  
✎ Hunting is 0-17 now, Farming 11-15, Fishing 7-13 at a full-strength location  
✎ Basic laboring is untouched on purpose — it is the floor of the economy — and Skilled's 1-4 is too coarse to move 7%

## 2026-09-04 · A dead faction Leader hands the seat on, and a founded faction survives a sync

✚ A Leader who dies gives up the seat; it passes on, skipping anyone Catatonic  
✚ db:sync-roles no longer deletes a faction a player founded once it empties  
✚ A Restart Game wipe clears silos and the factions players founded  
✎ A locked silo no longer shows its ⬢ to somebody who cannot open it  
✎ You can hand goods into a locked silo while standing at its door, not just from across the zone  
✎ Accepting an invitation hands over the silo keys; the invitee can no longer pick which  
✎ A silo has to be in the faction's own zone, and the pickers only offer those rooms  
✎ Faction rosters and member counts no longer include the dead  
✎ Two factions can no longer share a name  
✎ Anyone can found a faction from inside one, without leaving first  
✎ The faction directory is searchable and paged  
✎ Nobody is an officer of Unaffiliated, and its Leader cannot drag anybody  
✎ Hills Camp can't be destroyed — it was untradeable, so it was unrecoverable  
− Two application columns nothing read; the audit log already carried both facts

## 2026-09-04 · Factions secede, apply, and keep their silo in a room

✚ Leave a faction, apply to another, invite somebody, accept or decline  
✚ A Leader can secede from a parent faction, or rename their own  
✚ Anyone can found a new faction and become its Leader  
✚ A faction's silo is a Room now, storing tags and goods like any other stash  
✚ Deposit into your silo from anywhere in its zone; withdraw only in the room  
✚ A locked silo still takes deposits, and says it is one-way before you commit  
✚ /faction is a tabbed console; players with no faction get a directory  
✚ /gm/dev/factions gains a silo picker, a member mover and a pending list  
✚ Nine storerooms, the Armory restocked, a Baron's Study and a Ravine Camp  
✚ Six keys, a Keys tag group, and a Location group for the Brigands' camp  
✎ Brigands start in the Ravine now, not the town  
✎ Nothing branches on a faction's name any more, only its slug

## 2026-09-04 · Soft Hands has never done a day's labor, and cannot be taught otherwise

Soft Hands can no longer be held with any Laboring skill  
A lesson can no longer teach past a tag conflict, which was the way round every conflict pair in the catalog and not just this one

## 2026-09-04 · The #info rebuild works again

✎ The command that rebuilds #info from its master file had been broken since the scripts were reorganised; it looked for a docs folder that isn't there, and then choked on the roles list. #info is rebuilt and carries the new turn cadence

## 2026-09-04 · Turns are a day long now

✎ A turn is a whole real day and ends at midnight CT, instead of the two 12-hour turns a day it used to be. Dawn and Dusk still alternate, so an in-game day is two turns and takes two real days  
✎ Everything measured in turns — hunger, the Catatonic clock, corpse rot, crafting, Depot fuel, Desire locks — now takes twice as long in real time  
✎ Moves are due at 9 PM CT, and the #turns message says so in everyone's own timezone  
− The ghost wind reaction. A dead player has no voice; their unburied body is what tells the room, and it now does so every 4-10 hours instead of every 2-5  
✎ The game runs 30 real days, reaching in-game Day 15

## 2026-09-04 · The Merchant's own till, and seven things the Depot got wrong

✚ A ⬢ counter at the Depot: Resources to obols and back at one flat rate with  
− The shuttle no longer converts loose ⬢ — one rate, one place  
✎ An unopened crate sent back up is worth what is inside it, instead of nothing  
✎ You can only order one of anything you can only carry one of, instead of  
✎ Opening a crate records what actually landed, not what the crate claimed  
✎ Undoing an order that already flew down is refused instead of refunding the  
✎ A shuttle called between turns no longer parks itself forever  
✎ The generator's death can actually be heard — the line was wired to the  
✎ The shuttle landing and departing are announced, which they never were  
✎ Arming the turret with no face on file is refused, not warned about: the cure  
✎ Undoing a refuel no longer mints back the fuel already burned  
✎ Tooltips and GM help text carry their ‡

## 2026-09-04 · The Merchant runs a station now, not a shop

✚ Obols (¢), a weightless coin worth 5 ⬢ at the Depot and nothing anywhere else  
✚ The account belongs to the station, not the Merchant — the licence carries it  
✚ Order into a manifest, call the shuttle, goods land as crates on a landing pad  
✚ Crates print their own manifest; dangerous wares ship SEALED behind a keycard  
✚ A generator that burns coal every turn and takes the Depot down when it empties  
✚ An indoor turret that reads faces, not papers — armour moves the whole table  
✚ A cockpit console with six tabs, a full price list, and a ledger  
✚ A Depot section on the Dev Panel for every number above  
− Character.depotDebt; the line lives on the station now

## 2026-09-04 · Mime's Vow, and a tag can be whitelisted to one seat

Vow of Silence is renamed Mime's Vow, and only a Minstrel can take it  
Tags can be whitelisted to a seat, not just blacklisted away from one, so a role-only tag no longer means listing the other 38 roles

## 2026-09-04 · The intercom is loud now, and it lands in the transcript

✎ The PA is no longer small grey subtext. Everything else the world says is scenery and sits under the conversation, but a loudspeaker is the opposite of scenery — and it pings everyone, so delivering it in the quietest text Discord renders was backwards  
✚ Announcements are recorded in the archive. They were the one kind of public talk missing from it  
✎ An announcement ending in ! or ? keeps its own punctuation instead of picking up a stray full stop

## 2026-09-04 · Vow of Silence is a Minstrel's, and nobody else's

Vow of Silence can only be taken by a Minstrel now  
Tags can be whitelisted to a seat, not just blacklisted away from one, so a role-only tag no longer means listing the other 38 roles

## 2026-09-04 · Nearsighted tells you to go and get spectacles

Nearsighted's description now points at Spectacles, since the tag is what unlocks Look at again

## 2026-09-03 · A body decides what it can carry, and bad eyes cannot look anyone over

Carry caps now ADD their bonuses instead of multiplying them, so a frail body costs everyone the same pounds whether or not they happen to be pulling a cart  
Giant, the priciest tag in the game, finally buys carry: +0.75, the biggest body bonus there is  
Frail, Old, Fat, Dwarf, the maimings and a dozen wounds all take a small bite out of what you can haul, floored at a quarter of the base so nobody is stuck permanently overburdened  
✚ Pack Mouse, the mirror of Pack Mule: narrow shoulders, -0.5, and 4 points back  
Strong now matches Pack Mule's carry instead of a fifth of it, having cost more and done less  
A crippled or missing leg costs you your free zone crossing, unless a horse is doing the walking. A peg leg still walks  
✚ Sun Sensitivity, a new drawback, and the first code Nearsighted and Spectacles have ever had: both now block Look at, and a greyed button says why on hover  
Twelve pairs of contradictory tags can no longer be bought together, Mute and Vow of Silence and Blind and Eagle Eyes among them

## 2026-09-03 · Drawbacks now run out two ways, not one

✚ A second limit at character creation: your drawbacks can claim back at most 12 points between them, on top of the cap on how many you may take  
✎ The cap on how many rises from 5 to 6. You stop at whichever limit you reach first  
✎ Before this, five drawbacks were five drawbacks whether they were worth 5 points or 43, so the only sensible play was to stack the worst afflictions in the book. A build could reach 55 points; it now tops out at 24  
✎ The creation screen grows a second budget bar showing what you have claimed back, with the tag count under it. Each goes red on its own, so you can see which limit stopped you  
✎ Both numbers are editable on the dev panel, and neither applies in the store — the limits belong to character creation and stop existing once play starts

## 2026-09-03 · Nobody can escalate the intercom to @everyone

✎ The PA's own @here still pings everyone in the zone. A typed @everyone, @here or role mention inside the announcement itself is now inert

## 2026-09-03 · The Baron can wave somebody into his office, and the intercom is a button again

✚ /add and /remove now work in a private room, not only in conversations — anyone already inside can let in somebody standing in the same place  
✎ A guest stays until they leave; walking out of the location shuts the door behind them, and coming back needs a fresh invite  
✎ A guest gets the whole room, not just the thread: the stash, the Transfer dialog, anything set up in there  
✎ /remove refuses somebody holding the room's key, and says to take the key instead  
✚ An Intercom button on the Council Room's table. It announces into every zone above ground except the Black Hills, and pings everyone there  
− The #intercom channel and the Intercom tag. Standing at that table is now the whole gate  
✎ Lines the world says — a gate crossing, the smell of death, whispering overheard, goods moved around a stash — are all small grey subtext now, so they stop competing with what players are writing

## 2026-09-03 · Mute and Stutter cannot be picked together, nor Dwarf and Giant

Mute now conflicts with Stutter, the way Deaf conflicts with Hard of Hearing  
Dwarf and Giant now block each other in the character creator

## 2026-09-03 · You can look someone over without saying a word to them

✚ A Look at button on the character sheet. Pick anybody standing where you are and see what a bystander could see: their face, their open injuries, whatever they are carrying openly  
✎ A concealed person stays concealed. You get the same impoverished read the magnifying-glass reaction gives, so a hood is still worth wearing  
✎ The magnifying-glass reaction only ever worked on somebody who had already spoken, which meant a guard could not size up a silent traveller without starting a conversation first. It still works, and both now show exactly the same thing  
✎ A medic still sees what their training lets them see, and a faction officer still sees a member's resources. Same rules as before, in one place now

## 2026-09-03 · A key weighs nothing: 0 becomes a real rung on the weight ladder

✎ Keys, letters, badges, spectacles and coins weigh nothing now instead of half a pound each — 0 is a real rung on the weight ladder

## 2026-09-03 · Devoted Follower needs somebody to follow

✚ Night Blind and Blind can no longer be taken together — curing Blind already leaves you Night Blind  
✚ Devoted Follower is closed to Migrants, Mercenaries, Bums, Outsiders and Pushers — nobody to be devoted to  
✎ Sewer Key weighs half a pound, like every other key

## 2026-09-03 · Hard of Hearing is worth less, and rules out Deaf

✎ Hard of Hearing gives 4 points instead of 5  
✚ Hard of Hearing and Deaf can no longer be taken together — one ear or none, not both

## 2026-09-03 · Tag stacking: set the count, and tag edits save on the spot

✎ The Dev Panel's Holds row now has a stepper showing how many they hold — type the number you want. Taking a stack of seven meals down to three is one gesture, not four clicks of Take one  
✎ Tag changes on a character's dev panel save the moment you make them, like Kill and Revive already did. No more staging a tag and hunting for Apply  
✚ Heal all, Feed and Inflict a wound now fire straight away and say what they did, instead of quietly staging  
✎ Removing a wound that leaves an aftermath behind still asks first, since putting the wound back will not clear it  
✎ One quantity control everywhere — craft, destroy, transfer, loot, the depot and both GM desks — with plus and minus buttons instead of nine slightly different boxes

## 2026-09-03 · Walking into an inn no longer empties your cart onto its floor

✎ Carrying is measured in pounds now, not item count. Every item has a weight; a horse, a cart, a house and anything grafted into you weigh nothing  
✚ Past 1.5× your cap goods simply can't be yours: a hand-over is refused, and a harvest or a cave haul that big drops around you  
✎ Overburdened no longer walls you in. It costs you your free zone moves, so you can still cross — you just spend your Move  
✚ Everyone gets one free zone crossing a turn; an equipped mount adds another, and it now works both halves of the day  
✎ Carts and horses must be equipped to do anything, and are left at the door of the Cathedral, Sanctuary, Inn, Keep, Undercroft and Factory  
✚ Workshop Equipment: a heavy craftable that smithing and building now require, held or set up where you stand. The old Workshop asset is gone  
✎ Surgical Equipment is +1 on any medical Gambit, and there is a real set in the Sanctuary's operating theatre  
✚ A medic can attempt any cure, including above their skill. It becomes a Gambit: it spends your Move and a bad roll can leave the patient worse  
✚ Routine treatment is rationed 2/3/4 a turn by medical tier. First aid is free and never counts  
✎ The Plow is an asset, so it stops weighing on a farmer's back

## 2026-09-03 · Every location can be examined, not just worked

✎ The Labor? button on every location channel is now Examine. It still says what the ground yields here, and now also what the place itself is and whether the ways out of it stand open or closed  
✚ Locations can carry attributes — facts about a place, written into zones.yaml, that Examine turns into a sentence. The Merchant's Depot is the first one to wear one

## 2026-09-03 · The changelog speaks plain language, and can be told to stay quiet

✎ Changelog entries now say what changed in the game instead of listing files  
✚ A --hidden switch on a push: nothing is written and nothing is posted  
✎ Lore and antagonist work is held back from the changelog by default

## 2026-09-03 · Weapons don't stack: you hunt with one bow, not the whole rack

```
✎ db/lib/autoLaborPass.js
✎ db/lib/laborAccess.js
✎ docs/handbook.md
✎ docs/systemdocs/LABORING.md
```

## 2026-09-03 · Changelog: every push leaves a line here and in Discord

```
+ CHANGELOG.md
+ scripts/changelog/log.js
✎ CLAUDE.md
✎ package.json
```
