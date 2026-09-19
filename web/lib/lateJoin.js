// Shim so the Dev Panel's Late joins table and the Bastard's Call
// reinforcements dialog (both client components) avoid importing @lifeweb/db's
// barrel. Named rather than `export *`: the target is CommonJS, so a star
// re-export warns on every build. Same posture as web/lib/threats.js.
//
// Only the pure half is re-exported — loadLateJoinRoles and the two writers
// take a `prisma` and belong on the server.
export {
  LATE_JOIN_ROLE_SLUGS,
  LATE_JOIN_GROUP,
  isLateJoinRoleSlug,
  REINFORCEMENTS,
  MAX_REINFORCEMENTS_PER_CALL,
  reinforcementFor,
  BASTARD_TAG_SLUG,
  DEEP_BEAST_HORN_SLUG,
} from "@lifeweb/db/lib/lateJoin";
