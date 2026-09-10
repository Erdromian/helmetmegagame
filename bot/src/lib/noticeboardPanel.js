const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { readBlock } = require("@lifeweb/db/lib/reading");
const { paperDescription } = require("@lifeweb/db/lib/paper");
const { addToStack, dropCharacterTag } = require("@lifeweb/db/lib/tagWrites");
const { expiryFrom } = require("@lifeweb/db/lib/turnFormat");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { sceneLineAt } = require("@lifeweb/db/lib/scene");
const { mintUnownedPaper } = require("@lifeweb/db/lib/paperMint");
const { cleanCustomText } = require("@lifeweb/db/lib/customText");
const { TITLE_MAX, WRITE_MAX } = require("@lifeweb/db/lib/paper");
const {
  BOARD_OPTION_LIMIT,
  boardText,
  destroyNotice,
  hasNoticeboard,
  pinnedLine,
  tornLine,
} = require("@lifeweb/db/lib/noticeboard");
const { ack, respond } = require("./respond");
const { actingCharacter, isGmMember } = require("./interactionGuild");
const { postMessage } = require("@lifeweb/db/lib/discordRest");

// The Noticeboard button on a Location's anchor, and the three things it
// offers. See docs/systemdocs/PAPERWORK.md.
//
// EVERYTHING IS EPHEMERAL except the ambient line a pin raises. A board is
// public, but reading one is not a performance, and an ephemeral panel means
// five people can be at the same board without a wall of bot messages.
//
// THREE SELECTS RATHER THAN BUTTONS PER NOTICE. Discord allows five action rows
// per message, so a Read/Tear pair per paper would overflow the board at three
// notices. Selects have no such cap and read better besides — you pick the
// paper, then the verb is the menu you picked it from.

const READ_PREFIX = "notice:read:";
const TEAR_PREFIX = "notice:tear:";
const PIN_PREFIX = "notice:pin:";
// The GM's two: the button that opens the writing modal, and the modal itself.
const POST_PREFIX = "notice:post:";
const POST_MODAL_PREFIX = "notice:postmodal:";

// Everything the handlers need: who is acting, where the board is, and whether
// they are standing at it.
//
// ONE RULE, and it decides which panel you get:
//
//   an alive character standing here  -> you act as that character
//   otherwise, and you are a GM       -> you act as a GM
//   otherwise                         -> "You're not here."
//
// So a GM who is playing somebody works the board through that body when they
// are at it, and as a GM everywhere else — which also means a GM never meets
// "You're not here." on a board again. `ctx.character` is null in GM mode, and
// every dereference of it below is guarded by `ctx.gm`.
async function boardContext(interaction, locationId) {
  const character = await actingCharacter(interaction, {
    include: { tags: { include: { tag: true } } },
  });
  const [location, openTurn] = await Promise.all([
    prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, indoors: true, attributes: true, discordChannelId: true },
    }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, orderBy: { number: "desc" } }),
  ]);
  if (!location) return { error: "That place is gone." };
  if (!hasNoticeboard(location)) return { error: "There's no board here." };

  // Standing here is the whole permission model for a player. You cannot read a
  // board from three zones away, and you cannot pin to one either.
  const here = Boolean(character && character.locationId === location.id);
  const gm = !here && isGmMember(interaction);
  if (!here && !gm) {
    return { error: "You're not here." };
  }

  const posts = await prisma.noticePost.findMany({
    where: { locationId: location.id },
    orderBy: { expiresTurn: "asc" },
    take: BOARD_OPTION_LIMIT,
    include: { tag: true },
  });

  return {
    location,
    character: here ? character : null,
    gm,
    openTurn,
    posts,
    where: { phase: openTurn?.phase ?? null, indoors: location.indoors ?? true },
  };
}

function selectRow(customId, placeholder, options) {
  if (options.length === 0) return null;
  return {
    type: 1,
    components: [{ type: 3, custom_id: customId, placeholder, options }],
  };
}

async function handleNoticeboardOpen(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error });

  const { location, character, gm, posts, openTurn } = ctx;

  // Written or sealed, and never gated on whether they can read it. Pinning up
  // a letter you cannot read yourself is a perfectly good thing to do with one.
  // A GM holds nothing, so their third row is a button instead of this select:
  // they have no paper to pin, they write the notice on the spot.
  const holding = gm
    ? []
    : character.tags
        .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
        .slice(0, BOARD_OPTION_LIMIT);

  const noticeOptions = posts.map((p) => ({ label: p.tag.name.slice(0, 100), value: p.id }));
  const rows = [
    selectRow(`${READ_PREFIX}${location.id}`, "Read a notice…", noticeOptions),
    selectRow(`${TEAR_PREFIX}${location.id}`, "Tear one down…", noticeOptions),
    gm
      ? {
          type: 1,
          components: [
            { type: 2, style: 2, custom_id: `${POST_PREFIX}${location.id}`, label: "Post a notice" },
          ],
        }
      : selectRow(
          `${PIN_PREFIX}${location.id}`,
          "Pin a paper…",
          holding.map((ct) => ({
            label: ct.tag.name.slice(0, 100),
            value: ct.tagId,
            description: ct.tag.paperKind === "SEALED" ? "Sealed" : undefined,
          })),
        ),
  ].filter(Boolean);

  return respond(interaction, {
    content: boardText(location.name, posts, openTurn?.number ?? 0),
    components: rows,
  });
}

async function handleNoticeRead(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error });

  const post = ctx.posts.find((p) => p.id === interaction.values?.[0]);
  if (!post) return respond(interaction, { content: "It's gone." });

  // The same predicate the tag chip uses, and the same sentence — a blind
  // reader and an illiterate one get identical refusals, so neither the reader
  // nor anyone watching learns which it was.
  //
  // A GM skips the gate entirely, wax seal included. They hold no tags, so
  // readBlock would call them illiterate and refuse every notice on every
  // board — the panel would open onto nothing it could ever show them.
  const text = ctx.gm
    ? (post.tag.paperText ?? "").trim()
    : paperDescription(post.tag, { tags: ctx.character.tags, ...ctx.where });
  const blocked = ctx.gm ? null : readBlock(ctx.character.tags, ctx.where);
  if (ctx.gm) {
    return respond(interaction, { content: text ? `\`\`\`\n${text}\n\`\`\`` : "It's blank." });
  }

  // A code block, because a notice is a thing with edges — and because it
  // stops anything written on it rendering as Discord markup or pinging
  // somebody. Nobody is told it was read.
  const content = blocked || post.tag.paperKind === "SEALED" ? text : `\`\`\`\n${text}\n\`\`\``;
  return respond(interaction, { content });
}

async function handleNoticeTear(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error });

  const post = ctx.posts.find((p) => p.id === interaction.values?.[0]);
  if (!post) return respond(interaction, { content: "It's gone." });

  // The delete IS the claim, so two people tearing at the same paper cannot
  // both walk away with it — the same shape every other race here uses.
  //
  // A GM has no hands to take it into, so the paper goes with the post, which
  // is what happens to a notice that blows away on its own clock anyway.
  const claimed = ctx.gm
    ? await destroyNotice(prisma, post)
    : await prisma.noticePost.deleteMany({ where: { id: post.id } });
  if (claimed.count === 0) {
    return respond(interaction, { content: "Somebody got there first." });
  }
  if (!ctx.gm) await addToStack(prisma, ctx.character.id, post.tagId, 1, {});

  if (ctx.location.discordChannelId) {
    // Catch-logged: an unreachable channel must never undo a tear that has
    // already committed (ARCHITECTURE.md §5).
    await postMessage(ctx.location.discordChannelId, ambientLine(tornLine(post.tag.name))).catch(() => { });
  }
  // Beside the post, so Chat sees the board change too.
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: tornLine(post.tag.name) });
  return respond(interaction, { content: `You take ${post.tag.name} down.` });
}

async function handleNoticePin(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error });
  if (!ctx.openTurn) return respond(interaction, { content: "Nothing is happening yet." });

  // A GM is never offered this select, but a customId is a string anybody can
  // send back — and ctx.character is null in GM mode.
  if (ctx.gm) return respond(interaction, { content: "You aren't holding that." });

  const tagId = interaction.values?.[0];
  const held = ctx.character.tags.find((ct) => ct.tagId === tagId);
  // The same two kinds the picker above offers. "has a paperKind" is not the
  // check: a spent envelope and a bound book both have one, and neither goes
  // up on a wall.
  if (!held || (held.tag.paperKind !== "PAPER" && held.tag.paperKind !== "SEALED")) {
    return respond(interaction, { content: "You aren't holding that." });
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { noticeExpiryTurns: true },
  });
  // N turns means N turns, counting the one it went up in — the same
  // arithmetic every other clock in the game uses (db/lib/turnFormat.js).
  const expiresTurn = expiryFrom(ctx.openTurn.number, config?.noticeExpiryTurns ?? 10);

  try {
    await prisma.$transaction(async (tx) => {
      // NoticePost.tagId is @unique: a paper is on a board or in somebody's
      // hands, never both. Creating first means a paper already pinned
      // somewhere else fails here rather than being silently taken off a
      // sheet and lost.
      await tx.noticePost.create({
        data: {
          locationId: ctx.location.id,
          tagId: held.tagId,
          postedById: ctx.character.id,
          postedTurn: ctx.openTurn.number,
          expiresTurn,
        },
      });
      await dropCharacterTag(tx, ctx.character.id, held.tagId, 1);
    });
  } catch (err) {
    if (err?.code === "P2002") {
      return respond(interaction, { content: "That one is already up somewhere." });
    }
    throw err;
  }

  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(held.tag.name))).catch(() => { });
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: pinnedLine(held.tag.name) });
  return respond(interaction, {
    content: `You put ${held.tag.name} up. Anyone here can read it, or take it down.`,
  });
}

// A GM writing a fresh notice. showModal IS the acknowledgement, so it has to
// be the first thing that happens here — no ack(), and a deferred interaction
// can no longer open one.
//
// That means the board cannot be loaded before the modal opens. Nothing is
// lost: permission is decided at SUBMIT, the way the Intercom's modal decides
// it, and a modal that opened onto a board somebody has since torn bare is
// answered honestly when it comes back.
async function handleNoticePost(interaction, locationId) {
  if (!isGmMember(interaction)) {
    return respond(interaction, { content: "You're not here." });
  }
  const modal = new ModalBuilder()
    .setCustomId(`${POST_MODAL_PREFIX}${locationId}`)
    .setTitle("Post a notice")
    .addLabelComponents(
      new LabelBuilder().setLabel("Title").setTextInputComponent(
        new TextInputBuilder()
          .setCustomId("notice:title")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(TITLE_MAX)
          .setRequired(false),
      ),
      new LabelBuilder().setLabel("Body").setTextInputComponent(
        new TextInputBuilder()
          .setCustomId("notice:body")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(WRITE_MAX)
          .setRequired(true),
      ),
    );
  return interaction.showModal(modal).catch((err) => {
    console.error("Failed to open the notice modal:", err);
  });
}

async function handleNoticePostSubmit(interaction, locationId) {
  await ack(interaction, { ephemeral: true });
  // The whole gate again, at submit: the GM role, the board, and the turn. A
  // modal outlives everything it was opened against.
  const ctx = await boardContext(interaction, locationId);
  if (ctx.error) return respond(interaction, { content: ctx.error });
  if (!ctx.gm) return respond(interaction, { content: "You're not here." });
  if (!ctx.openTurn) return respond(interaction, { content: "Nothing is happening yet." });

  // The title is CLEANED and the body is only trimmed — exactly what the
  // player's own Write does (web/app/(app)/character/paperActions.js). A name
  // is interpolated raw into bot messages, so an "@" in one is a mention
  // waiting to happen; a body is only ever shown inside a code block or
  // through PaperSheet, and it keeps its line breaks because a proclamation
  // signed on its own line should stay that way.
  const title = cleanCustomText(interaction.fields.getTextInputValue("notice:title"), TITLE_MAX) || null;
  const body = (interaction.fields.getTextInputValue("notice:body") ?? "").trim().slice(0, WRITE_MAX);
  if (!body) return respond(interaction, { content: "Write something first." });

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { noticeExpiryTurns: true },
  });
  const expiresTurn = expiryFrom(ctx.openTurn.number, config?.noticeExpiryTurns ?? 10);

  // MINTED OUTSIDE A TRANSACTION. createWithRetry re-rolls the slug on a
  // unique collision, and Postgres aborts the whole transaction on the first
  // failed statement (25P02) — so a retry inside one throws instead of
  // retrying. db/lib/paperMint.js spells the trap out.
  //
  // paperAuthor is the GM's Discord id and nothing renders it anywhere. It is
  // there for the audit trail only: a notice is anonymous on the board, which
  // is the point of a public board, so nothing about this must reach a reader.
  const paper = await mintUnownedPaper(
    prisma,
    `gm-notice-${locationId}`,
    interaction.user.id,
    body,
    title,
  );

  try {
    await prisma.noticePost.create({
      data: {
        locationId: ctx.location.id,
        tagId: paper.id,
        // Nobody pinned it. The column is nullable for its own reason — a
        // notice outlives the person who put it up — and this is the same
        // shape a Wanted poster already lands in.
        postedById: null,
        postedTurn: ctx.openTurn.number,
        expiresTurn,
      },
    });
  } catch (err) {
    // The paper exists and the board rejected it, so it would be an orphan
    // nothing can ever reach. Take it back out.
    await prisma.tag.deleteMany({ where: { id: paper.id, ephemeral: true } }).catch(() => {});
    if (err?.code === "P2002") {
      return respond(interaction, { content: "That one is already up somewhere." });
    }
    throw err;
  }

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "gm_post_notice",
        details: {
          locationId: ctx.location.id,
          locationName: ctx.location.name,
          tagId: paper.id,
          tagName: paper.name,
          face: "discord",
        },
      },
    })
    .catch((err) => console.error("Notice audit log failed:", err));

  // THE SAME LINE A PLAYER'S PIN RAISES. It names the paper and never the
  // person, so nobody reading the room can tell a GM's notice from anyone
  // else's — which is the whole reason the line was written that way.
  if (ctx.location.discordChannelId) {
    await postMessage(ctx.location.discordChannelId, ambientLine(pinnedLine(paper.name))).catch(() => {});
  }
  await sceneLineAt(prisma, { locationId: ctx.location.id, text: pinnedLine(paper.name) });
  return respond(interaction, {
    content: `You put ${paper.name} up. Anyone here can read it, or take it down.`,
  });
}

module.exports = {
  READ_PREFIX,
  TEAR_PREFIX,
  PIN_PREFIX,
  POST_PREFIX,
  POST_MODAL_PREFIX,
  handleNoticeboardOpen,
  handleNoticeRead,
  handleNoticeTear,
  handleNoticePin,
  handleNoticePost,
  handleNoticePostSubmit,
};
