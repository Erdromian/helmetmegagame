import { avatarResponse } from "@/lib/avatarResponse";

// Serves a character's profile picture: their uploaded one if they have set
// one, otherwise the letter plaque for the first letter of their FIRST name
// (never the honorific or the GM-granted title).
//
// The default is resolved here, at read time, from the live row — which is
// why renaming a character updates their avatar with no job, no hook and no
// stored bytes. An uploaded avatarData always wins, so this never overwrites
// a picture someone chose. The reading itself is web/lib/avatarResponse.js,
// shared with the two stranger routes beside this one (here/, line/).
export async function GET(_request, { params }) {
  const { characterId } = await params;
  // Safe despite being derived from a mutable row: every caller appends
  // ?v=<updatedAt ms>, which any character write bumps.
  return avatarResponse(characterId, { cacheControl: "public, max-age=31536000, immutable" });
}
