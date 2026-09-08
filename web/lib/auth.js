import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import Credentials from "next-auth/providers/credentials";
import { NextRequest } from "next/server";
import { isLocalMode } from "@lifeweb/db/lib/localMode";
import { SUPERADMIN_DISCORD_IDS } from "./superadmin";

// Behind Railway's proxy, Next.js builds `request.url` from the container's
// own listener and ignores the Host header, so the /api/auth/* route handler
// would hand Discord a bad OAuth redirect_uri and break sign-in on every
// domain. Rebuild the origin from the forwarded headers before Auth.js sees
// the request. `signIn()`/`signOut()` already read x-forwarded-host and need
// no help. An origin taken from a client-controllable header is an
// open-redirect vector in an OAuth flow, so hosts are allowlisted rather
// than trusted — anything unrecognised falls back to the canonical origin.
// Adding a domain means adding it here AND registering its callback URL in
// the Discord Developer Portal.
export const CANONICAL_ORIGIN = "https://ravenheart.quest";

const ALLOWED_HOSTS = new Set([
  "ravenheart.quest",
  "web-production-38d02.up.railway.app",
]);

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function resolveOrigin(request) {
  // x-forwarded-host can be a comma-separated chain; the first entry is the
  // originating host.
  const forwarded =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const host = forwarded?.split(",")[0].trim();
  if (!host) return CANONICAL_ORIGIN;

  if (LOCAL_HOST.test(host)) {
    return `${request.headers.get("x-forwarded-proto") ?? "http"}://${host}`;
  }
  if (!ALLOWED_HOSTS.has(host)) return CANONICAL_ORIGIN;

  return `${request.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
}

// Mirrors how next-auth itself rewrites a request origin, so method, headers
// and body survive the swap.
function withPublicOrigin(request) {
  const origin = resolveOrigin(request);
  const { href, origin: current } = request.nextUrl;
  if (current === origin) return request;
  return new NextRequest(href.replace(current, origin), request);
}

const nextAuth = NextAuth({
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      // `identify` only. Auth.js defaults to `identify email`, and nothing
      // here ever reads an email — so don't ask players for one.
      authorization: { params: { scope: "identify" } },
    }),
    // Registered only under LOCAL_MODE (db/lib/localMode.js), so there is no
    // "local" provider for signIn("local") to find at all outside dev — the
    // real guard is that this array simply doesn't contain it, same as every
    // other LOCAL_MODE branch answering instead of a real Discord call.
    // Signs in as the first superadmin id (web/lib/superadmin.js) by default,
    // which LOCAL_MODE's own member-lookup stub already treats as holding
    // every local role — one click reaches everything a GM page needs.
    //
    // `playerId` is the other door in (web/app/actions.js#startAsLocalPlayer):
    // a freshly rolled discordUserId for a throwaway character it has already
    // created, so the session comes up already owning a sheet instead of the
    // superadmin id's usual "every GM tool, no character of your own."
    // LOCAL_MODE's role stub still hands every id the same GM-shaped roles —
    // there is no way to be a "real" non-GM locally — but every page that
    // decides player-vs-GM by "does this discordUserId own a living
    // character" (loadFeedViewer chief among them) reads as a player once one
    // exists.
    ...(isLocalMode()
      ? [
          Credentials({
            id: "local",
            name: "Local (dev only)",
            credentials: { playerId: { type: "text" } },
            async authorize(credentials) {
              return { id: credentials?.playerId || SUPERADMIN_DISCORD_IDS[0] };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, profile, user }) {
      // `profile` is Discord's OAuth profile; `user` is what the local
      // Credentials provider's authorize() returned. Never both at once.
      const discordUserId = profile?.id ?? user?.id;
      if (discordUserId) {
        token.discordUserId = discordUserId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.discordUserId) {
        session.discordUserId = token.discordUserId;
      }
      return session;
    },
  },
});

export const { auth, signIn, signOut } = nextAuth;

export const handlers = {
  GET: (request) => nextAuth.handlers.GET(withPublicOrigin(request)),
  POST: (request) => nextAuth.handlers.POST(withPublicOrigin(request)),
};
