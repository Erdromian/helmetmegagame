// Turns docs/systemdocs/infochannel.yaml into the text that lands in #info:
// the YAML load, `generated:` bodies, the directory message, finding the
// channel. No writes live here. Two scripts share it: sync-info-channel.js
// edits what's posted (the one to reach for); rebuild-info-channel.js throws
// the channel away and reposts. See docs/systemdocs/INFOCHANNEL.md.
const fs = require("node:fs");
const yaml = require("js-yaml");
const { getGuildChannels, fetchAllMessages, bulkDeleteMessages } = require("./discordRest");
const { ALL_GROUPS } = require("./roleGroups");
const { docsPath } = require("./repoPaths");

const YAML_PATH = docsPath("systemdocs", "infochannel.yaml");
const ROLES_YAML_PATH = docsPath("roles.yaml");
const DOCS_DIR = docsPath();

// Generator for the Fates thread. Name + intro text only, under the social
// buckets of db/lib/roleGroups.js (imported, not duplicated, so the thread and
// the picker can't disagree). Names NO ZONE on purpose — that would tell
// readers where a seat starts before the game does. A reserved fate wears a ★
// (`whitelist:`), and that is the only mark any fate gets — one name used to
// come back bold as the high-cap go-anywhere seat, but nothing explains that
// to a reader any more, so every fate now reads the same. Reads roles.yaml
// fresh every run, so this thread can never drift from it.
//
// PUBLIC SEATS ONLY. Two things are left out, and neither is a tidiness rule:
//   - the whole ELSEWHERE bucket, which is where the seats nobody has bucketed
//     land — and that is exactly where the Tribunal and the Bastards live;
//   - any seat carrying `examine_visible: false`, the flag that already means
//     "a look does not read this off somebody" (db/lib/examine.js).
// A reader of #info learns the public roles and nothing else. Both filters are
// kept even though they currently name the same seats: the bucket rule is what
// stops a new hidden seat leaking because somebody forgot the flag, and the
// flag rule is what stops one leaking because somebody bucketed it under Court.
// So a fate that should be listed needs a real group AND no opaque flag.

function buildRolesIntroBody() {
  const rolesDoc = yaml.load(fs.readFileSync(ROLES_YAML_PATH, "utf8"));

  const ELSEWHERE = "other";
  const PUBLIC_GROUPS = ALL_GROUPS.filter((group) => group.slug !== ELSEWHERE);
  // bucket slug -> its lines, in authoring order
  const held = new Map(PUBLIC_GROUPS.map((g) => [g.slug, []]));

  // `groups`/`roles` are slug-keyed MAPPINGS in roles.yaml, read the same way by syncRoles.js.
  for (const [groupSlug, roles] of Object.entries(rolesDoc.groups ?? {})) {
    // Elsewhere is never listed. It holds the antagonist seats — the Tribunal,
    // the Bastard and his men — and #info is read by everyone before the game
    // opens. Naming them here told the whole server who was coming. An unknown
    // group lands in Elsewhere too, so it is dropped the same way.
    if (!held.has(groupSlug)) continue;
    for (const role of Object.values(roles ?? {})) {
      if (role?.examine_visible === false) continue;
      const whitelistMark = role.whitelist === true ? " (★)" : "";
      held.get(groupSlug).push(`*${role.name}*${whitelistMark} — ${role.intro}`);
    }
  }

  // A heading is followed straight by its content; blank lines only separate groups.
  return PUBLIC_GROUPS.filter((group) => held.get(group.slug).length > 0)
    .map((group) => `# ${group.name}\n${held.get(group.slug).join("\n")}`)
    .join("\n\n");
}

const GENERATORS = { "roles-intro": buildRolesIntroBody };

function loadInfoDoc() {
  return yaml.load(fs.readFileSync(YAML_PATH, "utf8"));
}

// Hand-authored `body` (if any) followed by generator output — lets a `generated` thread carry a
// static intro paragraph ahead of the auto-built content.
function resolveThreadBody(thread) {
  const parts = [];
  if (thread.body) parts.push(thread.body);
  if (thread.generated) parts.push(GENERATORS[thread.generated]());
  return parts.join("\n\n");
}

// Every thread the YAML names, flattened out of its categories, in order.
function infoThreads(doc) {
  return (doc.categories ?? []).flatMap((category) => category.threads ?? []);
}

async function findInfoChannel() {
  const channels = await getGuildChannels();
  const channel = channels.find((c) => c.type === 0 && c.name?.toLowerCase() === "info");
  if (!channel) throw new Error('No text channel named "info" found in this guild.');
  return channel;
}

// The Handbook link is TEMPORARILY OFF with HANDBOOK_HIDDEN (web/lib/handbook.js),
// which makes /handbook a 404. Put it back when that flag goes.
const LINKS_LINE = "[Website](http://ravenheart.quest/)";

function buildDirectoryMessage(mainMessage, linksByCategory) {
  const sections = linksByCategory.map((category) => {
    const heading = category.name ? `**${category.name}**` : null;
    const lines = category.threadIds.map((id) => `<#${id}>`);
    const body = [category.intro, lines.join("\n")].filter(Boolean).join("\n");
    return [heading, body].filter(Boolean).join("\n");
  });
  return [mainMessage, ...sections, LINKS_LINE].join("\n\n");
}

// startThread's no-starter-message threads make Discord auto-post a "X
// started a thread: Y" system message (type 18) into the parent — swept up
// after everything else is posted so only real content remains.
const THREAD_CREATED_MESSAGE_TYPE = 18;

async function deleteThreadCreatedMessages(channelId) {
  const messages = await fetchAllMessages(channelId);
  const systemMessages = messages.filter((m) => m.type === THREAD_CREATED_MESSAGE_TYPE);
  if (systemMessages.length > 0) await bulkDeleteMessages(channelId, systemMessages.map((m) => m.id));
  console.log(`  cleaned up ${systemMessages.length} "started a thread" system message(s)`);
}

module.exports = {
  DOCS_DIR,
  loadInfoDoc,
  resolveThreadBody,
  infoThreads,
  findInfoChannel,
  buildDirectoryMessage,
  deleteThreadCreatedMessages,
};
