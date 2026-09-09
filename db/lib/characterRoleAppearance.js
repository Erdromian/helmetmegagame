// The one place a personal character role's name and colour are composed.
// Three writers rename these roles — web/lib/discordGuild.js#ensureCharacterRole
// on every profile save, the Catatonic pass's role updates applied by
// advanceTurn(), and the forced-name reconcile beside it
// (db/lib/characterRoleNames.js) — and all of them must go through here, or one
// landing mid-catatonia quietly strips the "• Catatonic" suffix another wrote.
//
// While a character is Catatonic (AFK — see db/lib/catatonicPass.js), the
// role reads "<bare name> • Catatonic" in one fixed desaturated grey, so the
// member list shows who's absent at a glance.
//
// A role in the catatonic state no longer matches the character-role
// signature (mentionable + hashNameToColor(role.name) — see
// db/scripts/ops/prune-orphan-roles.js). That's safe: the channel doctor and
// the pruner both skip any role a character claims before testing the
// signature.
const { hashNameToColor } = require("./roleColor");

// Non-zero on purpose — 0 means "no colour" to Discord and is the cursed
// role's deliberate pin (CHANNELS.md §3). A flat desaturated grey in the same
// muted register as the roleColor gradient stops (~L32), reading as a lamp
// gone out next to the living roles' cyan-greys and terracottas.
const CATATONIC_ROLE_COLOR = 0x4e5457;

const CATATONIC_ROLE_SUFFIX = " • Catatonic";

// `forcedName` is a held Tag.forcedName — a Disguise Kit row, or Apex Form
// (db/lib/presentedIdentity.js). The role wears it INSTEAD of the bare name,
// so the mention token in a scene reads as the false name the character is
// going by. This reverses what PROXYING.md §6 used to say, and §6 now says why.
//
// The COLOUR follows it too, and that is the load-bearing half. hashNameToColor
// is deterministic, so colouring by the real name while titling by the false
// one would leave a stable per-character swatch sitting beside every disguise
// that character ever wears — a fingerprint that survives the thing meant to
// hide them, which is strictly worse than not renaming at all.
//
// A HOOD is deliberately not here. `/conceal` presents as "Young Woman", which
// is a description rather than a name: a guild full of identical @Young Woman
// tokens is unmentionable in practice, and concealment is already answered by
// the rule that a concealed message relays nothing at all (PROXYING.md §6).
// Only a forced NAME renames the role.
function characterRoleAppearance(bareName, { catatonic = false, forcedName = null } = {}) {
  const shown = forcedName?.trim() || bareName;
  if (catatonic) {
    return { name: `${shown}${CATATONIC_ROLE_SUFFIX}`, color: CATATONIC_ROLE_COLOR };
  }
  return { name: shown, color: hashNameToColor(shown) };
}

module.exports = { characterRoleAppearance, CATATONIC_ROLE_COLOR, CATATONIC_ROLE_SUFFIX };
