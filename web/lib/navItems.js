import { prisma, MORTUS_SLUG } from "@lifeweb/db";
import { canReadDepot, canReadTreasury } from "@lifeweb/db/lib/depotCounter";
import { readGameState } from "@lifeweb/db/lib/gameState";
import { getGmSession, getGuildMember, isPlaytester } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { railKindSql } from "@/lib/dmThread";

export const PLAYER_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/chat", label: "Chat", icon: "play" },
  { href: "/map", label: "Map", icon: "map" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/documents", label: "Documents", icon: "documents" },
  // TEMPORARILY OFF with HANDBOOK_HIDDEN in web/lib/handbook.js — a rail item
  // pointing at a page that answers 404 is worse than no rail item.
  // { href: "/handbook", label: "Handbook", icon: "help" },
];

// `section` splits the rail into a GM's two hats; NavRail dividers follow the order below.
export const GM_NAV = [
  { href: "/gm/players", label: "Players", icon: "messages", section: "gm" },
  { href: "/gm/turns", label: "Adjudicate", icon: "turns", section: "gm" },
  { href: "/gm/audit", label: "Audit", icon: "audit", section: "gm" },
  { href: "/gm/oracle", label: "Oracle", icon: "oracle", section: "gm" },
  { href: "/character", label: "Character", icon: "character", section: "player" },
  { href: "/chat", label: "Chat", icon: "play", section: "player" },
  { href: "/map", label: "Map", icon: "map", section: "player" },
  { href: "/notes", label: "Notes", icon: "notes", section: "player" },
  { href: "/documents", label: "Documents", icon: "documents", section: "player" },
  // TEMPORARILY OFF — see PLAYER_NAV above.
  // { href: "/handbook", label: "Handbook", icon: "help", section: "player" },
];

const DEV_NAV_ITEM = { href: "/gm/dev", label: "Dev", icon: "dev", section: "gm" };
const LIFEWEB_NAV_ITEM = { href: "/lifeweb", label: "Lifeweb", icon: "lifeweb", section: "player" };
const ARCHIVE_NAV_ITEM = { href: "/archive", label: "Archive", icon: "archive", section: "gm" };
// PLACE OR KEY, the same predicate the page gates on (db/lib/depotCounter.js),
// so the rail can never offer an item that redirects. You get it standing in the
// Depot, or carrying a manifest key — the Merchant's Licence or a Silver Chip —
// which reads the shelf from anywhere. Every GM keeps it, wherever they stand.
// See docs/systemdocs/DEPOT.md §0b.
const DEPOT_NAV_ITEM = { href: "/depot", label: "Depot", icon: "store", section: "player" };
// The Meister's terminal over the town's accounts. Follows PLACE AND KEY, the
// same predicate the page itself gates on (db/lib/depotCounter.js), so the rail
// can never offer an item that redirects. It comes and goes as its holder walks
// in and out of the Keep, which is the cost of a terminal being a thing on a
// desk. See docs/systemdocs/DEPOT.md §0h.
const TREASURY_NAV_ITEM = { href: "/treasury", label: "Treasury", icon: "store", section: "player" };

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
// — your sheet, the documents, a line to the GMs, your notes and the rules.
// The build crew keep the full rail, because a closed game is exactly when
// they are working on it. See docs/systemdocs/LOBBY.md §1.
// "/handbook" is TEMPORARILY OUT of this set too — see handbook.js. It is a
// filter over the rails above, so with the entries commented out it would
// match nothing anyway; it is listed here only so the restore is one grep.
const CLOSED_NAV_HREFS = new Set(["/character", "/chat", "/notes", "/documents"]);

export async function loadNavItems(discordUserId) {
  const [{ isGm: gm }, member, hasMortusTag, treasuryGate, gameConfig, state, depotGate] =
    await Promise.all([
      getGmSession(),
      // Cached with in-flight dedup (web/lib/discordGuild.js), and getGmSession above
      // already asked for it, so this is the same answer rather than a second call.
      getGuildMember(discordUserId),
      prisma.characterTag.findFirst({
        where: { character: { discordUserId, status: "ALIVE" }, tag: { slug: MORTUS_SLUG } },
      }),
      canReadTreasury(prisma, discordUserId),
      // Chat switch (CHAT.md §5). Presentation here; /chat enforces it.
      prisma.gameConfig.findUnique({
        where: { id: 1 },
        select: { playPanelEnabled: true, oraclePlaytest: true },
      }),
      readGameState(prisma, { phase: true }),
      canReadDepot(prisma, discordUserId),
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
  // build crew is the GMs, the superadmins and the playtesters (db/lib/roleIds.js),
  // because a closed game is when they are working on it.
  const crew = gm || superadmin || isPlaytester(member);
  const narrowed = state?.phase === "CLOSED" && !crew;
  const baseNav = (gm ? GM_NAV : PLAYER_NAV)
    .filter((item) => playEnabled || item.href !== "/chat")
    .filter((item) => !oracleHidden || item.href !== "/gm/oracle")
    .filter((item) => !narrowed || CLOSED_NAV_HREFS.has(item.href))
    .map((item) =>
      item.href === "/gm/players" && unreadCount > 0 ? { ...item, badge: unreadCount } : item,
    );
  // Archive first, then Lifeweb: the bar starts a new group wherever `section`
  // changes, so the order here is what decides the grouping. Lifeweb sits with
  // the Depot and the Treasury — the three places a character goes to look at
  // what is held rather than to act — instead of trailing the ordinary pages.
  const withArchive = gm ? [...baseNav, ARCHIVE_NAV_ITEM] : baseNav;
  const withLifeweb = hasMortus ? [...withArchive, LIFEWEB_NAV_ITEM] : withArchive;
  // These three are appended rather than filtered out of a list, so the closed-game
  // narrowing has to be asked again here or they walk straight past it.
  const withDepot =
    !narrowed && (depotGate.ok || gm) ? [...withLifeweb, DEPOT_NAV_ITEM] : withLifeweb;
  const withTreasury =
    !narrowed && (treasuryGate.ok || superadmin) ? [...withDepot, TREASURY_NAV_ITEM] : withDepot;
  if (!superadmin) return withTreasury;
  const lastGm = withTreasury.findLastIndex((item) => item.section === "gm");
  return [...withTreasury.slice(0, lastGm + 1), DEV_NAV_ITEM, ...withTreasury.slice(lastGm + 1)];
}
