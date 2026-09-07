import "server-only";
import { prisma } from "@lifeweb/db";
import {
  evaluateDesireCatalog,
  slotStates,
  describeDesireLocks,
  bottomSlotAddiction,
  unlockedBy,
} from "@lifeweb/db/lib/desireGates";
import { desireFamilies, desireFamilyGroups } from "@lifeweb/db/lib/desireFamilies";
import { canRead } from "@lifeweb/db/lib/reading";
import {
  PAPER_SLUG,
  BOOK_SHEETS,
  isBook,
  isSeal,
  sealLabel,
} from "@lifeweb/db/lib/paper";
import {
  canSendBird as holdsBirdAndLetters,
  birdZones as birdZonesOf,
} from "@lifeweb/db/lib/bird";
import { describeTurn } from "@/lib/turnFormat";
import {
  projectDesireTemplateForGates,
  loadRoleBySlugForTemplates,
  computeHiddenDesireTagIds,
} from "@/lib/desireProjection";

// Everything a surface needs to draw a character's OWN state, the way
// web/lib/peoplePools.js does for the people standing near them. It lived
// inside web/app/(app)/character/page.js while the sheet was the only place
// that drew it; the Hall's YOU column is the second.
//
// Every gate is evaluated HERE, server-side. The client never runs the gate
// logic and never receives a hidden template.
//
// `character` needs { id, tags: [{ tagId, tag }], role: { slug } }.
//
// `withCatalog: false` is the Hall's ask: the picker is closed on almost
// every page load, and the evaluated catalog is ~271 templates. The slot half
// — which slots are open, what was last claimed in each — costs one query, so
// that is what the first paint carries. The Hall fetches the other half
// through a server action the first time somebody opens the picker.
export async function loadDesireView(character, { openTurn, gameConfig, withCatalog = true } = {}) {
  const desireSlots = gameConfig?.desireSlots ?? 2;
  const desireSlotLockTurns = gameConfig?.desireSlotLockTurns ?? 2;
  const heldTags = (character.tags ?? []).map((ct) => ct.tag);
  const heldDesireTagIds = new Set((character.tags ?? []).map((ct) => ct.tagId));
  const openTurnNumber = openTurn?.number ?? 0;

  // ALL statuses — the gate evaluator needs the whole history.
  const history = await prisma.desire.findMany({
    where: { characterId: character.id },
    select: {
      id: true,
      templateId: true,
      slotIndex: true,
      status: true,
      text: true,
      points: true,
      setTurnNumber: true,
      endedTurnNumber: true,
      template: { select: { tier: true, cooldownTurns: true, onceEver: true } },
    },
  });

  const view = {
    desiresEnabled: gameConfig?.desiresEnabled ?? true,
    desireSlots,
    desireSlotLockTurns,
    slotStates: slotStates({
      history,
      openTurnNumber,
      desireSlots,
      lockTurns: desireSlotLockTurns,
    }),
    lockNotes: describeDesireLocks(heldTags, new Map(desireFamilies().map((f) => [f.key, f.name]))),
    addiction: bottomSlotAddiction(heldTags),
    families: desireFamilies(),
    familyGroups: desireFamilyGroups(),
    catalog: [],
  };
  if (!withCatalog) return view;

  const templateRows = await prisma.desireTemplate.findMany({
    where: { retired: false },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      tier: true,
      families: true,
      onceEver: true,
      cooldownTurns: true,
      retired: true,
      requiresAnyOf: true,
      requiresAnyRoleSlugs: true,
      requiresNotRoleSlugs: true,
      requiresAnyTags: { select: { id: true, name: true } },
      requiresAllTags: { select: { id: true, name: true } },
      requiresNotTags: { select: { id: true, name: true } },
    },
  });

  const hiddenTagIds = await computeHiddenDesireTagIds(prisma, heldDesireTagIds);
  const roleBySlug = await loadRoleBySlugForTemplates(prisma, templateRows);
  const projected = templateRows.map((t) => projectDesireTemplateForGates(roleBySlug, t));
  const { visible } = evaluateDesireCatalog({
    templates: projected,
    heldTags,
    hiddenTagIds,
    roleSlug: character.role?.slug ?? null,
    history,
    openTurnNumber,
    desireSlots,
  });

  // The `hidden` half (db/lib/desireGates.js) never reaches this variable.
  // A "locked" entry (unmet requires, or a family a held tag shuts) is
  // dropped here too. Cooldown/once-ever-done rows stay, since those are
  // claimed already, just not claimable right now.
  view.catalog = visible
    .filter(({ state }) => state !== "locked")
    .map(({ template, state, availableFromTurn, slotLocks }) => ({
      slug: template.slug,
      name: template.name,
      description: template.description,
      tier: template.tier,
      families: template.families,
      state,
      availableFromTurn,
      slotLocks,
      cooldownTurns: template.cooldownTurns ?? template.tier,
      onceEver: Boolean(template.onceEver),
      unlockedBy: unlockedBy(template, {
        heldTagIds: heldDesireTagIds,
        roleSlug: character.role?.slug ?? null,
      }),
    }));
  return view;
}

// ---- Letters, seals, books and the Bird ------------------------------------
//
// Everything the paperwork dialogs need (docs/systemdocs/PAPERWORK.md, §Bird),
// as the exact props RequestActionsProvider takes. It was written inline in
// web/app/(app)/character/page.js while the sheet was the only surface that
// opened those dialogs; the Hall's composer is the second, and a second copy
// of these gates would be a second answer to "can this character write".
//
// `character` needs { id, tags: [{ tagId, quantity, tag }], location:
// { indoors }, birdTurnId }.
//
// The TEXT of a paper never comes back from here — only an excerpt, and only
// for a reader. The dialogs fetch the whole thing on demand
// (character/paperActions.js#readMyPaper), so an unreadable sheet is never
// sitting in a client payload waiting to be read out of the page source.
export async function loadLettersView(character, { openTurn = null } = {}) {
  const tags = character.tags ?? [];
  const hasBird = holdsBirdAndLetters(tags);
  // Letters AND eyes — the same predicate the tag chips, the noticeboard and
  // paperActions.js all use, so the button, the chip and the server's refusal
  // can never disagree.
  const canReadNow = canRead(tags, {
    phase: openTurn?.phase ?? null,
    indoors: character.location?.indoors ?? true,
  });
  // Something to write ON: a blank sheet, or a note already started. A sealed
  // letter does not count — you would have to break the seal first.
  const writables = tags.filter(
    (ct) => ct.tag.slug === PAPER_SLUG || ct.tag.paperKind === "PAPER",
  );
  const canWrite = canReadNow && writables.length > 0;
  // Wax stamps in hand, and letters worth closing.
  const seals = tags.filter((ct) => isSeal(ct.tag));
  const hasSeal = seals.length > 0;
  const sealables = tags.filter(
    (ct) => ct.tag.paperKind === "PAPER" && (ct.tag.paperText ?? "").trim(),
  );
  const canSeal = hasSeal && sealables.length > 0;

  // Binding needs letters as well, because you write the whole thing in one
  // pass.
  const blankStock = tags.find((ct) => ct.tag.slug === PAPER_SLUG);
  const sheetsHeld = blankStock?.quantity ?? 0;
  const canBindBook = canReadNow && sheetsHeld >= BOOK_SHEETS;
  // Why the button is dead, so a player reads it off the tooltip instead of
  // writing a whole book into the box and finding out at the submit.
  const bindBlocked = canBindBook
    ? null
    : `You have ${sheetsHeld} of the ${BOOK_SHEETS} blank sheets a book takes. ‡`;
  const books = tags.filter((ct) => isBook(ct.tag));

  const paperOptions = writables.map((ct) => ({
    tagId: ct.tagId,
    name: ct.tag.name,
    blank: ct.tag.slug === PAPER_SLUG,
    quantity: ct.quantity,
    // Enough to tell two notes apart in a dropdown, and only for a reader.
    excerpt:
      canReadNow && ct.tag.paperKind === "PAPER"
        ? (ct.tag.paperText ?? "").trim().slice(0, 60)
        : null,
  }));
  // Everything a bird could carry. Sealed letters included — a courier does
  // not have to be able to read what they are carrying, which is rather the
  // use of an illiterate one.
  const letterOptions = tags
    .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
    .map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      excerpt:
        canReadNow && ct.tag.paperKind === "PAPER"
          ? (ct.tag.paperText ?? "").trim().slice(0, 60)
          : null,
    }));
  // Books in hand, for the Tear Up picker. No excerpt: a book's NAME is its
  // title and already says which one it is, unlike a note's waybill code.
  const bookOptions = books.map((ct) => ({ tagId: ct.tagId, name: ct.tag.name }));
  const sealOptions = {
    stamps: seals.map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      label: sealLabel(ct.tag),
    })),
    letters: sealables.map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      excerpt: canReadNow ? (ct.tag.paperText ?? "").trim().slice(0, 60) : null,
    })),
  };

  // Compared against the in-game DAY (birdTurnId stores the day), not the
  // turn. Advisory only — the server's conditional claim is the real gate.
  const birdSentToday =
    Boolean(openTurn) && character.birdTurnId === String(describeTurn(openTurn).day);

  // Recipient list is EVERY character regardless of status; a letter to a dead
  // name never arrives. Only fetched for someone who holds a bird.
  const birdTargets = hasBird
    ? await prisma.character.findMany({
        where: { id: { not: character.id } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  // Everywhere standable except the two deep cave levels (birdZones()).
  const birdZones = hasBird
    ? birdZonesOf(
        await prisma.zone.findMany({
          select: { id: true, name: true, slug: true, kind: true },
          orderBy: { sortOrder: "asc" },
        }),
      ).map((z) => ({ id: z.id, name: z.name }))
    : [];

  return {
    hasBird,
    canRead: canReadNow,
    canWrite,
    hasSeal,
    canSeal,
    paperOptions,
    letterOptions,
    sealOptions,
    canBindBook,
    bindBlocked,
    bookOptions,
    birdSentToday,
    birdTargets,
    birdZones,
  };
}
