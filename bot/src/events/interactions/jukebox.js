// The Den's jukebox on Discord (docs/systemdocs/SOUND.md, "The Den's jukebox"). The Bar's
// starter post carries a Jukebox button; it answers with a song picker, and a pick puts the
// song on (or turns the box off). Every rule, every refusal and the line the Bar reads are
// in db/lib/jukebox.js, so this face and Chat's cannot drift. Discord plays no sound: the
// music itself is heard on the web.
const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { setJukebox } = require("@lifeweb/db/lib/jukebox");
const { JUKEBOX_ROOM_SLUG, JUKEBOX_TEXT } = require("@lifeweb/db/lib/jukeboxText");
const { JUKEBOX_SONGS, jukeboxSongByKey, jukeboxSongLabel } = require("@lifeweb/db/lib/jukeboxSongs");
const { ack, respond, scheduleDismiss } = require("../../lib/respond");

// Starts with the open prefix ("room:jukebox:"), so the router tests it first.
const JUKEBOX_PICK_PREFIX = "room:jukebox:pick:";
// The picker's "Turn it off" row. Not a song key, and never can be one.
const OFF_VALUE = "off";

// Discord caps an option's label at 100 characters.
function optionLabel(text) {
  return text.length > 100 ? `${text.slice(0, 99)}…` : text;
}

async function handleJukeboxOpen(interaction, roomId) {
  await ack(interaction);
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { slug: true, jukeboxSongKey: true },
  });
  if (room?.slug !== JUKEBOX_ROOM_SLUG) {
    await respond(interaction, JUKEBOX_TEXT.noJukebox);
    return;
  }
  const playing = room.jukeboxSongKey ? jukeboxSongByKey(room.jukeboxSongKey) : null;
  const options = JUKEBOX_SONGS.filter((song) => song.key !== playing?.key).map((song) => ({
    label: optionLabel(jukeboxSongLabel(song)),
    value: song.key,
  }));
  if (playing) options.push({ label: JUKEBOX_TEXT.turnOff, value: OFF_VALUE });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${JUKEBOX_PICK_PREFIX}${roomId}`)
    .setPlaceholder(JUKEBOX_TEXT.pickPlaceholder)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  const now = playing ? JUKEBOX_TEXT.nowPlaying(jukeboxSongLabel(playing)) : JUKEBOX_TEXT.silent;
  await respond(interaction, {
    content: `${now}\n-# ${JUKEBOX_TEXT.pickPrompt}`,
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function handleJukeboxPick(interaction) {
  await ack(interaction);
  const roomId = interaction.customId.slice(JUKEBOX_PICK_PREFIX.length);
  const picked = interaction.values?.[0] ?? null;
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } }).catch(() => null);
  const result = await setJukebox(prisma, interaction.user.id, {
    roomId,
    songKey: picked && picked !== OFF_VALUE ? picked : null,
    turn,
  });
  await respond(interaction, { content: result.ok ? result.line : result.error, components: [] });
  if (result.ok) scheduleDismiss(interaction);
}

module.exports = { JUKEBOX_PICK_PREFIX, handleJukeboxOpen, handleJukeboxPick };
