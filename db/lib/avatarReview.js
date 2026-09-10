// Which uploaded avatars a GM still has to look at.
//
// A player can upload any image they like as their character's face. The
// upload is capped at 5MB and re-encoded through sharp to a 256×256 WebP,
// which guarantees valid image bytes and strips metadata — and says nothing at
// all about what the picture IS. The Browse control has always carried the
// note "Requires GM approval, run your art by the GM"; this is the half that
// was missing behind it (docs/systemdocs/PORTRAITS.md §1a).
//
// ONLY UPLOADS. The portrait maker never posts pixels — it posts part and
// palette indices that are re-rendered server-side from the committed sprite
// sheets, so the worst a forged request can do there is pick a different nose
// (PORTRAITS.md §4). Putting maker faces in the queue would bury the handful
// of real uploads under a hundred jaws off the artist's own sheets.
//
// `Character.portrait` is what tells the two apart, and it needs no new
// column to do it: the maker stores its selection there, and an upload leaves
// it null.

// A picture is waiting when it is an upload that has been set since the last
// time somebody looked at it. Pure, and the twin of `avatarReviewWhere` below
// — one of them runs in Postgres and the other in a test, and they have to
// agree.
function avatarNeedsReview(character) {
  if (!character) return false;
  // A Bytes column arrives as a Buffer here and as a boolean-ish presence
  // check in a select that asked for nothing else, so this only ever asks
  // whether there is something rather than what it is.
  if (!character.avatarData) return false;
  if (character.portrait) return false;
  if (!character.avatarSetAt) return false;
  if (!character.avatarReviewedAt) return true;
  return new Date(character.avatarSetAt) > new Date(character.avatarReviewedAt);
}

// The same sentence as a Prisma `where`.
//
// Takes the client rather than importing it, the db/lib/dm.js precedent:
// requiring db/index.js back from inside db/lib resolves to a partial exports
// object. `prisma.character.fields` is Prisma's field reference — the one way
// to compare two columns of the SAME row inside the query rather than after
// it.
//
// THE NULL ARM IS NOT OPTIONAL. A comparison never matches a NULL column, and
// neither does a `NOT` — so the `lt` arm alone would silently drop every
// picture nobody has looked at yet, which is precisely the set this queue
// exists to show. That is a mistake this repo has made before, and it is why
// the two arms are spelled out instead of written as one clever clause.
function avatarReviewWhere(prisma) {
  return {
    avatarData: { not: null },
    portrait: null,
    avatarSetAt: { not: null },
    OR: [
      // Never looked at.
      { avatarReviewedAt: null },
      // Looked at, and then changed again.
      { avatarReviewedAt: { lt: prisma.character.fields.avatarSetAt } },
    ],
  };
}

module.exports = { avatarNeedsReview, avatarReviewWhere };
