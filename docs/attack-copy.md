# Attack — every line a player sees

**Reviewed.** The marks below are stripped everywhere Bascinet signed off —
sections 1–7 and 9. Section 8, the handbook, was left alone on request and
still carries its marks; it wasn't part of this pass.

A working file. Edit the text **inside the indented blocks**, leave the headings
and the notes alone, hand it back and I'll put the edits into the source.

Three things to know before you start:

- **`‡` means I drafted it.** Leave the mark where it is — I'll drop it when I
  apply your wording. If you rewrite a line, it stays marked until you say
  otherwise.
- **`(yours)` means you dictated it** and it carries no mark. In here only so
  nothing looks missing.
- **`{name}` is filled in at send time**, and it is already the face the room
  saw — a hooded stranger reads as "a young man", never as their real name.

One rule worth remembering while you rewrite: a string of **four words or
fewer** carries no `‡`. Grow a short line past four words and it needs one.

---

## 1 · The button

The verb in the Others row of the sheet's strip.

    Attack

The sentence under it, and the tooltip on the strip. **(yours)**

    Attack someone, forcing them to stay in place until the turn ends and the combat is adjudicated. Attacking is permanent for the turn—you can, however, cancel it.

---

## 2 · The dialog

Title.

    Attack

The picker's question, over the row of people standing here.

    Who are you attacking?

The confirm, after they pick somebody. Three parts: title, body, button.

    Attack {name}?

    Neither of you can move until the turn ends.

    Attack them

Nobody here to attack, and no fights in progress.

    There’s nobody here to attack.

The heading over the list of fights they are already in.

    You are fighting

The button on each of those rows.

    Break off

---

## 3 · Refusals

The strength gate. Pressed on somebody more than two fighting bands above
them. **(yours)**

    This opponent is too strong to attack.

Pressed Attack with nobody picked.

    Pick somebody to attack.

Picked themselves.

    You can't attack yourself.

Already attacked this person this turn — including if they broke it off.

    You're already fighting them.

Pressed Break off on somebody they aren't fighting.

    You aren't fighting them.

Bound, dying, catatonic, crucified. `{state}` is the tag's own name.

    You can't attack anybody — you're {state}.

Between turns.

    There's no turn open right now.

Target walked off between the page loading and the press. This is the shared
line every people-picker on the sheet uses — changing it changes all of them.

    {name} isn't here.

---

## 4 · On the sheet, after

Under the verb strip, once the attack lands.

    You attack {name}.

Once they break off.

    You break off from {name}.

A fallback that only shows if the server answers without a line of its own.
Nearly never seen.

    You attack.

---

## 5 · DMs

**To the target**, the moment they are attacked. No button. Files as a
notice, so it does not sit in the GM inbox as mail.

    {attacker} attacked you. You can't move until the end of the turn. Make a Gambit declaring your intent!

**To the attacker**, carrying a **Cancel attack** button.

    You attacked {name}. Neither of you can move until the turn ends.

**To the ambusher** when their Intercept fires — same button. The old line was
yours; I added the second sentence, because an ambush holds the ambusher now
too.

    You successfully ambushed {name}. Neither of you can move until the turn ends.

**To the target** when the attacker breaks off. Unattributed on purpose — they
know perfectly well who it was.

    The fight is off. You can move again.

**Back to the attacker** when they press the DM button.

    You break off from {name}.

The button's own label, on Discord and on the web.

    Cancel attack

---

## 6 · Being held

These four are what somebody reads **everywhere movement is refused** — under
every shut way on `/map`, the banner over the `/chat` travel panel, the bot's
travel picker, and the Stepstone. Short, and read often.

The person who was attacked.

    Somebody attacked you. You can't move until the end of the turn.

The person who started it. They need a different sentence — telling them they
were attacked is a lie.

    You're in a fight. You can't move until the end of the turn.

The two older intercept lines, unchanged, here for tone. `{n}` counts down.

    Somebody intercepted you. You can't move for another {n}s.

    Somebody ambushed you. You can't move until the end of the turn.

---

## 7 · Ambush

The Ambush sentence in the Intercept dialog, as you rewrote it. **(yours)**

    You attack whoever enters the location. Neither of you can move until the end of the turn. Make sure to declare a Gambit with your intention.

Safe, unchanged, for contrast. **(yours)**

    Freezes them for two minutes and sends them the message.

What the victim of an ambush is told on arrival. Unchanged. **(yours)**

    You were stopped on the road. It's an ambush! You can't move until the end of the turn. Make a Gambit declaring your intent!

---

## 8 · The handbook

Five paragraphs, under **Attacking Somebody**. They render on `/handbook` and
on the Player Handbook card in `/documents`.

    Press **Attack** on somebody standing with you and neither of you goes anywhere. You are both held where you are until the turn ends and a Gamemaster reads what you each filed — so nobody starts a fight and then wanders off to have a nice afternoon. Make a Gambit declaring what you are actually trying to do. ‡

    It costs nothing. The Gambit is what costs your Move. ‡

    You can **break it off** at any point before the turn ends, from the Attack panel or from the button on your own DM, and that frees you both. But you only get one attack on a given person per turn, so breaking off is the end of it for today. ‡

    Some people are simply out of your league, and the button will say so rather than let you freeze somebody far above you for a whole day. It will not tell you how far above you they are, or anything at all about the people it lets you attack. ‡

    An **ambush** is the same thing sprung from cover: set an Intercept to Ambush, and whoever walks into it is attacked the moment they arrive — you included, since you are in the fight too. ‡

---

## 9 · GM-facing

Not player-facing — skip this if you like. It is the only other prose in the
change, and GM surfaces carry the mark too.

The new tab on `/gm/turns`, beside Moves / Caving / History. Keyboard `o`.

    Other

Its Kind filter.

    Attack
    Ambush
    Intercept

Its Status filter. "Holding" is a fight still on, "Called off" is one somebody
broke off, "Stopped" is a two-minute Safe intercept.

    Holding
    Called off
    Stopped

Its search box placeholder.

    name, target, @handle, zone:…

Nothing to show.

    Nobody is being held.
