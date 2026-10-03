import { prisma, MORTUS_SLUG } from "@lifeweb/db";
import { readGameState } from "@lifeweb/db/lib/gameState";
import { getGmSession, getGuildMember, isPlaytester, isEconomist, onRoster } from "@/lib/discordGuild";
import { loadFeedViewer } from "@/lib/feedAccess";
import { isSuperadmin } from "@/lib/superadmin";
import { railKindSql } from "@/lib/dmThread";

export const PLAYER_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/chat", label: "Chat", icon: "play" },
  { href: "/map", label: "Map", icon: "map" },
  { href: "/memories", label: "Memories", icon: "memories" },
  { href: "/documents", label: "Documents", icon: "documents" },
  { href: "/handbook", label: "Handbook", icon: "help" },
];

// `section` splits the rail into a GM's two hats; NavRail dividers follow the order below.
export const GM_NAV = [
  { href: "/gm/players", label: "Players", icon: "messages", section: "gm" },
  { href: "/gm/turns", label: "Adjudicate", icon: "turns", section: "gm" },
  { href: "/gm/audit", label: "Audit", icon: "audit", section: "gm" },
  { href: "/gm/oracle", label: "Oracle", icon: "oracle", section: "gm" },
  { href: "/gm/economy", label: "Economy", icon: "economy", section: "gm" },
  { href: "/character", label: "Character", icon: "character", section: "player" },
  { href: "/chat", label: "Chat", icon: "play", section: "player" },
  { href: "/map", label: "Map", icon: "map", section: "player" },
  { href: "/memories", label: "Memories", icon: "memories", section: "player" },
  { href: "/documents", label: "Documents", icon: "documents", section: "player" },
  { href: "/handbook", label: "Handbook", icon: "help", section: "player" },
];

// The Economist's own rail — a limited admin subset of GM_NAV, gated on the
// Economist Discord role rather than isGm (web/app/(econ)/layout.js,
// db/lib/roleIds.js). No Turns/Audit/Oracle/Dev/messaging desk: just the
// economy report and the funds-only player lookup, at their own /econ/*
// paths since (econ) can't share a layout chain with (desk) — see that
// layout's header comment.
export const ECONOMIST_NAV = [
  { href: "/econ/economy", label: "Economy", icon: "economy", section: "gm" },
  { href: "/econ/players", label: "Players", icon: "messages", section: "gm" },
  { href: "/character", label: "Character", icon: "character", section: "player" },
  { href: "/chat", label: "Chat", icon: "play", section: "player" },
  { href: "/map", label: "Map", icon: "map", section: "player" },
  { href: "/memories", label: "Memories", icon: "memories", section: "player" },
  { href: "/documents", label: "Documents", icon: "documents", section: "player" },
];

// The Spectator's rail (web/lib/feedAccess.js#loadFeedViewer decides who is
// one): what there is to watch, and the rules it is played by. No Memories —
// those are a character's, and a spectator has none. Character only for one
// who is also on the roster, since that is where they would roll one up.
// Actions is the spectator's alone: what came of every pushed turn
// (web/lib/spectatorActions.js).
export const SPECTATOR_NAV = [
  { href: "/chat", label: "Chat", icon: "play" },
  { href: "/map", label: "Map", icon: "map" },
  { href: "/actions", label: "Actions", icon: "turns" },
  { href: "/documents", label: "Documents", icon: "documents" },
  { href: "/handbook", label: "Handbook", icon: "help" },
];
const SPECTATOR_CHARACTER_ITEM = PLAYER_NAV[0];

const DEV_NAV_ITEM = { href: "/gm/dev", label: "Dev", icon: "dev", section: "gm" };
const LIFEWEB_NAV_ITEM = { href: "/lifeweb", label: "Lifeweb", icon: "lifeweb", section: "player" };
const ARCHIVE_NAV_ITEM = { href: "/archive", label: "Archive", icon: "archive", section: "gm" };

// Streamed separately (Suspense boundary in AppRail) — the live Discord role check and the
// Mortus-tag lookup never block a navigation's paint.
async function loadUnreadConversationCount(discordUserId) {
  // railKindSql is not optional: without it the badge counts rows the desk it points at does not.
  const rows = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT dm."discordUserId")::int AS "count"
    FROM "DirectMessage" dm
    LEFT JOIN "ConversationRead" cr
      ON cr."playerDiscordUserId" = dm."discordUserId"
      AND cr."gmDiscordUserId" = ${discordUserId}
    WHERE dm."direction" = 'INBOUND'
      AND dm."createdAt" > COALESCE(cr."lastReadAt", to_timestamp(0))
      AND ${railKindSql("dm")}
  `;
  return rows[0]?.count ?? 0;
}

// A shut game is a door, not a world: there is no Map to read, no Depot to
// stand in, and no Lifeweb to look at, so the rail offers none of them. What
// is left is the five things that still mean something before the game opens
// — your sheet, the documents, a line to the GMs, your memories and the rules.
// The build crew keep the full rail, because a closed game is exactly when
// they are working on it. See docs/systemdocs/LOBBY.md §1.
const CLOSED_NAV_HREFS = new Set(["/character", "/chat", "/memories", "/documents", "/handbook"]);

export async function loadNavItems(discordUserId) {
  const [{ isGm: gm }, member, hasMortusTag, gameConfig, state, viewer] =
    await Promise.all([
      getGmSession(),
      // Cached with in-flight dedup (web/lib/discordGuild.js), and getGmSession above
      // already asked for it, so this is the same answer rather than a second call.
      getGuildMember(discordUserId),
      prisma.characterTag.findFirst({
        where: { character: { discordUserId, status: "ALIVE" }, tag: { slug: MORTUS_SLUG } },
      }),
      // Chat switch (CHAT.md §5). Presentation here; /chat enforces it.
      prisma.gameConfig.findUnique({
        where: { id: 1 },
        select: { playPanelEnabled: true, oraclePlaytest: true },
      }),
      readGameState(prisma, { phase: true }),
      // cache()d per request, and the header has usually asked already.
      loadFeedViewer(),
    ]);
  const superadmin = isSuperadmin(discordUserId);
  // The Lifeweb item follows the Mortus tag, not the GM role — a superadmin keeps it, host access
  // rather than game permission, the way /gm/dev works.
  const hasMortus = !!hasMortusTag || superadmin;

  const unreadCount = gm ? await loadUnreadConversationCount(discordUserId) : 0;
  const playEnabled = gameConfig?.playPanelEnabled ?? true;
  const oracleHidden = (gameConfig?.oraclePlaytest ?? false) && !superadmin;
  // Who keeps the full rail while the game is shut. NOT onRoster(): that counts an
  // ordinary approved player, who is exactly the person the narrow rail is for. The
  // build crew is the GMs, the superadmins, the playtesters and the Economists
  // (db/lib/roleIds.js), because a closed game is when they are working on it.
  const econOnly = !gm && isEconomist(member);
  const crew = gm || superadmin || isPlaytester(member) || econOnly;
  const narrowed = state?.phase === "CLOSED" && !crew;
  // Only ever while the game is on, so `narrowed` never meets it.
  const spectatorNav = viewer?.spectator && !econOnly
    ? onRoster(member) ? [SPECTATOR_CHARACTER_ITEM, ...SPECTATOR_NAV] : SPECTATOR_NAV
    : null;
  const baseNav = (gm ? GM_NAV : econOnly ? ECONOMIST_NAV : spectatorNav ?? PLAYER_NAV)
    .filter((item) => playEnabled || item.href !== "/chat")
    .filter((item) => !oracleHidden || item.href !== "/gm/oracle")
    .filter((item) => !narrowed || CLOSED_NAV_HREFS.has(item.href))
    .map((item) =>
      item.href === "/gm/players" && unreadCount > 0 ? { ...item, badge: unreadCount } : item,
    );
  // Archive first, then Lifeweb: the bar starts a new group wherever `section`
  // changes, so the order here is what decides the grouping. (The Depot's page
  // went with the Depot Overhaul, and the Treasury's with the Meister's Terminal:
  // both are fixtures you stand at now.)
  const withArchive = gm ? [...baseNav, ARCHIVE_NAV_ITEM] : baseNav;
  const withLifeweb = hasMortus ? [...withArchive, LIFEWEB_NAV_ITEM] : withArchive;
  if (!superadmin) return withLifeweb;
  const lastGm = withLifeweb.findLastIndex((item) => item.section === "gm");
  return [...withLifeweb.slice(0, lastGm + 1), DEV_NAV_ITEM, ...withLifeweb.slice(lastGm + 1)];
}
