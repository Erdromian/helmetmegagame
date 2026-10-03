// The words for a GM presentation (./gmPresentation.js): how a hood, a disguise or a public name reads
// on a desk, in a Discord dossier or an audit line. ZERO REQUIRES, EVER: GM client components import it,
// and one require of the barrel here would drag PrismaClient into the browser bundle (the dmPolicy.js
// rule). Every function takes a presentation as gmPresentation.js shapes it, or null for a bare face.

function withArticle(word) {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

function jobText(job) {
  return job?.name ? ` (${job.name})` : "";
}

// One line of plain text: "disguised as Sir Aldric Vask (Steward)", "hooded: a young man, under a Plague
// Mask; disguised as Sir Aldric Vask beneath it". "own face" for nobody hiding anything.
function lookText(p) {
  if (!p?.kind) return "own face";
  const under = p.item ? `, under ${withArticle(p.item)}` : "";
  switch (p.kind) {
    case "disguise":
      return `disguised as ${p.shownAs}${jobText(p.job)}`;
    case "forced":
      return `goes by ${p.shownAs}`;
    case "deathmask":
      return `masked in death: ${p.shownAs}${under}`;
    case "hood":
      return `hooded: ${p.shownAs}${under}${p.under ? `; disguised as ${p.under}${jobText(p.underJob)} beneath it` : ""}`;
    default:
      return "own face";
  }
}

// The one word a crowded row has room for: a queue row, a member strip.
function lookWord(p) {
  switch (p?.kind) {
    case "disguise":
      return "disguised";
    case "forced":
      return "public name";
    case "deathmask":
      return "masked";
    case "hood":
      return p.under ? "hooded, disguised" : "hooded";
    default:
      return null;
  }
}

// Whether two looks are the same look. A GM is only told "now: …" when it changed.
function sameLook(a, b) {
  if (!a?.kind && !b?.kind) return true;
  if (!a?.kind || !b?.kind) return false;
  return a.kind === b.kind && (a.shownAs ?? null) === (b.shownAs ?? null) && (a.under ?? null) === (b.under ?? null);
}

// What an archived line's alias was, from what the line froze (db/lib/archive.js#lineLookKind): "hooded",
// "in disguise", or "public name" (Apex Form's Beast). Null for a line said under their own name.
const LINE_KIND_WORDS = { hood: "hooded", disguise: "in disguise", forced: "public name" };

function lineKindWord(kind) {
  return LINE_KIND_WORDS[kind] ?? null;
}

module.exports = { lookText, lookWord, sameLook, lineKindWord };
