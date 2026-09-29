import { cache } from "react";
import { prisma, computeRate, formatRate } from "@lifeweb/db";
import { carryCaps, carryBonusLine, MULT_SCALE } from "@lifeweb/db/lib/carry";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { documentSource, isWritten, readerFromCharacter } from "@/lib/documentAccess";
import { toDocumentPreviewText } from "@/lib/documentPreview";
import { redactWithheldRecipes } from "@/lib/recipeCatalog";
import { getHandbookBody } from "@/lib/handbook";
import { withoutSecrets } from "@/lib/secretTags";
import { TOKEN_SOURCE } from "@/app/components/richTokens";
import {
  CHIP_ROW_SELECT,
  CHIP_VIEWER_SELECT,
  chipContextFor,
  composeChipTag,
} from "@/lib/tagChipRows";

// The three datasets behind the {tag:…} / {resource:…} / {document:…} inline reference syntax.
// The root layout calls these un-awaited and streams the promises into client providers.

// Re-exported from tagChipRows.js since a dozen callers already import them from here.
export {
  DESIRE_UNLOCK_SELECT,
  TAG_CHIP_FIELDS,
  APPRAISAL_SELECT,
  // The pair a TagChip surface wants. TAG_CHIP_FIELDS above is the narrow half
  // and draws a paper tag blank — see tagChipRows.js's header.
  chipSelect,
  composeChipTag,
  toChipRow,
  chipContextFor,
  GM_CHIP_CTX,
  stripEmptyUnlocks,
  stripWeightless,
  cookedTasteOnly,
} from "@/lib/tagChipRows";

// Every document row, once per request: getVisibleTags reads their words for
// {tag:…} tokens and getDocumentIndex lists them, and the root layout calls both.
const allDocuments = cache(() => prisma.document.findMany({ orderBy: { sortOrder: "asc" } }));

// The tags named by a {tag:…} token in these texts, as ids or slugs — the token
// takes either (RichText.js#TagToken).
function tokenTagKeys(texts) {
  const keys = new Set();
  for (const text of texts) {
    for (const [, kind, payload] of String(text ?? "").matchAll(new RegExp(TOKEN_SOURCE, "g"))) {
      if (kind === "tag") keys.add(payload.trim());
    }
  }
  return keys;
}

// The app-wide tag list behind every {tag:…} chip, streamed into TagsProvider by
// the root layout on EVERY page — signed in or not, a 404 included. So what it
// withholds is withheld from the whole internet, and what it sends is readable
// by anybody who opens DevTools. It used to withhold only group-gated rows,
// which left every other SECRET tag in it: the Judge, Demoness, Vampire and
// Thanati seat tags, every vampire status, the Tribunal's and the cult's gear,
// and the Desires those tags open (TAGS.md §3a).
//
// A player now gets a SECRET row only when they hold it, hold the gate that
// opens it (web/lib/secretTags.js), or can read a paper that names it: a
// document they can open or the description of a tag they hold. The last is
// what keeps a cultist's own papers drawing their chips. A GM's list is
// unchanged. Session-dependent, so it must never be cached across callers.
export async function getVisibleTags() {
  const { session, isGm } = await getGmSession();
  const character = session?.discordUserId
    ? await prisma.character.findFirst({
        where: { discordUserId: session.discordUserId, status: "ALIVE" },
        select: {
          ...CHIP_VIEWER_SELECT,
          // readerFromCharacter's half: which documents this reader can open.
          tags: { select: { tagId: true, equipped: true, tag: { select: { slug: true, name: true } } } },
          role: { select: { slug: true, name: true, docElements: true } },
        },
      })
    : null;

  const ctx = await chipContextFor(character);
  const held = ctx.heldIds;

  // Runtime-minted rows (paper, sealed letters, crates, headstones) are unbounded game state, so a
  // caller sees only the ones they hold. Sequential, since the held ids are the filter.
  const [tags, documents] = await Promise.all([
    prisma.tag.findMany({
      where: { OR: [{ ephemeral: false }, { id: { in: [...held] } }] },
      // `custom` tells a catalog row from one minted at runtime; dropped before it crosses.
      select: { ...CHIP_ROW_SELECT, custom: true },
    }),
    isGm ? [] : allDocuments(),
  ]);

  // Rows named where this reader can already read the name.
  const reader = readerFromCharacter(character);
  const named = isGm
    ? new Set()
    : tokenTagKeys([
        getHandbookBody(),
        ...documents
          .filter((d) => isWritten(d) && documentSource(d, { character: reader, isGm: false, isMasterGm: false }))
          .map((d) => d.description),
        // Catalog rows only (`custom: false`, authored in docs/tags.yaml). A minted row's words can be a
        // player's — a crate's label, a corpse named after a character — and a player who could write
        // {tag:demoness} onto something they carry would be handed the row.
        ...tags.filter((t) => held.has(t.id) && !t.custom).map((t) => t.description),
      ]);
  const allowed = [...held, ...tags.filter((t) => named.has(t.id) || named.has(t.slug)).map((t) => t.id)];
  const allowedSet = new Set(allowed);

  const ungated = tags.filter(
    (tag) => !tag.group?.requiredTagId || held.has(tag.group.requiredTagId) || allowedSet.has(tag.id),
  );
  const secretIds = new Set(tags.filter((t) => t.catalogVisibility === "SECRET").map((t) => t.id));
  const shipped = isGm ? ungated : withoutSecrets(ungated, secretIds, allowed);
  const shippedSlugs = new Set(shipped.map((t) => t.slug));

  // A recipe line must not print an ingredient this viewer has no path to (web/lib/recipeCatalog.js).
  const readableSlugs = new Set(
    tags
      .filter((t) => t.catalogVisibility === "ALL" || held.has(t.id))
      .map((t) => t.slug),
  );
  return redactWithheldRecipes(
    shipped.map(({ custom, ...tag }) => composeChipTag(withoutHiddenUnlocks(tag, shippedSlugs), ctx)),
    { visibleSlugs: readableSlugs },
  );
}

// A Desire that needs ALL of several tags is listed under each of them, so a
// public tag's list could name a Desire whose other half is a withheld secret.
// None does today; this keeps it that way.
function withoutHiddenUnlocks(tag, shippedSlugs) {
  if (!tag.desireAllRequiredBy?.length) return tag;
  return {
    ...tag,
    desireAllRequiredBy: tag.desireAllRequiredBy.filter((d) =>
      (d.requiresAllTags ?? []).every((t) => shippedSlugs.has(t.slug)),
    ),
  };
}



// Must be computed per-request — productionCoefficient is a live dial on /gm/dev.
export async function getProductionRates() {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const coefficient = config?.productionCoefficient ?? 1;

  // One rate, so the payload a {resource:...} bubble carries is a bare name.
  const mining = computeRate(coefficient);
  const rates = { mining: { ...mining, display: formatRate(mining) } };

  return { coefficient, rates };
}

// Pre-formatted per tag from the live caps so the client never imports @lifeweb/db.
export async function getCarryReference() {
  const [config, tags] = await Promise.all([
    // One cap now. The ⬢ cap was deleted with the columns behind it — ⬢ weigh
    // a pound each and push against the pound cap beside the gear (CARRY.md).
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { carryWeightLbs: true } }),
    prisma.tag.findMany({
      where: { carryBonus: { not: null } },
      select: { slug: true, carryBonus: true },
    }),
  ]);
  const lines = Object.fromEntries(tags.map((t) => [t.slug, carryBonusLine(config, t.carryBonus)]));
  return { base: carryCaps(config, MULT_SCALE), lines };
}

const EXCERPT_CHARS = 160;

function excerptOf(description) {
  const flat = toDocumentPreviewText(description).replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  return `${flat.slice(0, flat.lastIndexOf(" ", EXCERPT_CHARS))}…`;
}

// `name` ships for every written document, `source`/`excerpt` only when the reader may read it.
// Session-dependent — must never be cached across callers.
export async function getDocumentIndex() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) return [];

  const [documents, characterRow] = await Promise.all([
    allDocuments(),
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      include: {
        role: true,
        tags: { include: { tag: { select: { slug: true, name: true } } } },
      },
    }),
  ]);

  const character = readerFromCharacter(characterRow);
  const isMasterGm = isGm && isSuperadmin(session.discordUserId);

  return documents.filter(isWritten).map((d) => {
    const source = documentSource(d, { character, isGm, isMasterGm });
    return {
      key: d.key,
      name: d.name,
      accessible: source !== null,
      source,
      excerpt: source ? excerptOf(d.description) : null,
    };
  });
}
