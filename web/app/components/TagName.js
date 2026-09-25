// A tag's name as text, with the one decoration the name itself cannot carry:
// a Lavish meal is drawn in italics (the Soilery Rework doc; COOKING.md). Its
// "*Caviar*" asterisks are part of the name and stay; the slant is this.
// Everywhere a chip or a tooltip draws a name goes through here.
import { isLavish } from "@lifeweb/db/lib/meals";

export default function TagName({ tag }) {
  if (!tag) return null;
  return isLavish(tag) ? <em>{tag.name}</em> : tag.name;
}
