import { redirect } from "next/navigation";
import {
  prisma,
  MORTUS_SLUG,
  LIFEWEB_ATTRIBUTE,
  hasAttribute,
  LIFEWEB_SPUTTER_THRESHOLD,
  DONATE_BLOOD_BY_TAG,
  bloodValueForTags,
} from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { rosterHere, pickerKey, pickerName } from "@/lib/peopleHere";
import LifewebDonateBloodPanel from "../../components/LifewebDonateBloodPanel";
import LifewebFeedPersonButton from "../../components/LifewebFeedPersonButton";
import LifewebRequestButtons from "../../components/LifewebRequestButtons";
import PageShell from "@/app/components/PageShell";

function bloodBand(blood) {
  if (blood <= 0) return { label: "Dry", color: "var(--accent-text)" };
  if (blood <= LIFEWEB_SPUTTER_THRESHOLD) return { label: "Sputtering", color: "var(--accent-text)" };
  if (blood <= 60) return { label: "Thinning", color: "var(--text)" };
  return { label: "Full", color: "var(--positive)" };
}

// The only tags that change what a donation is worth; everything else on a
// character's sheet is irrelevant to this page.
const BLOOD_TIER_SLUGS = DONATE_BLOOD_BY_TAG.map((t) => t.slug);
const BLOOD_TIER_TAGS = {
  where: { tag: { slug: { in: BLOOD_TIER_SLUGS } } },
  select: { tag: { select: { slug: true } } },
};

// Who a Mortus may bleed or feed: themselves, and the ordinary roster of the
// place they stand in (web/lib/peopleHere.js) — the same two halves every other
// body verb offers. A hood, or a face they have never met, comes as a
// "hood:<token>" key under what they look like. It used to be every living
// character in the Fortress zone, by real name and id, masks included.
//
// `worth` is priced here, and only for somebody the Mortus can name: Nobility
// and Courtier blood are worth more, so a price beside a hood would tell them
// the rank under it. The server re-prices on the click either way.
async function mortusTargets(character) {
  const { named, hooded } = await rosterHere(character, {
    select: { id: true, name: true, tags: BLOOD_TIER_TAGS },
  });
  const own = await prisma.characterTag.findMany({ where: { characterId: character.id, ...BLOOD_TIER_TAGS } });
  return [
    { key: `character:${character.id}`, name: character.name, worth: bloodValueForTags(own) },
    ...named.map((row) => ({ key: pickerKey(row), name: pickerName(row), worth: bloodValueForTags(row.tags) })),
    ...hooded.map((row) => ({ key: pickerKey(row), name: pickerName(row), worth: null })),
  ];
}

export default async function LifewebPage() {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");

  // Superadmin, not GM. This page is a Mortus surface: how much Blood is in
  // the Tower is a secret the Mortii keep, and every other GM gets the same
  // vague omen line in the turn announcement that the players do. A superadmin
  // still reads it, and still gets the panel below, because that is host
  // access rather than game permission — the same split /gm/dev sits on.
  const superadmin = isSuperadmin(session.discordUserId);

  // A superadmin reaches the page without a Mortus character; only a Mortus
  // gets the player-facing Request buttons, since the server action re-checks
  // the tag. The whole row, since the roster below reads the viewer the way
  // whosHere does.
  const mortusCharacter = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE", tags: { some: { tag: { slug: MORTUS_SLUG } } } },
    include: { location: { select: { attributes: true } } },
  });
  if (!mortusCharacter && !superadmin) redirect("/character");

  // Standing at the Web itself — the Location carrying the `lifeweb`
  // attribute (docs/zones.yaml), not anywhere in a zone. It used to be the
  // Fortress zone, which kept every button grey once the Web moved down into
  // the Undertown.
  const atLifeweb = hasAttribute(mortusCharacter?.location, LIFEWEB_ATTRIBUTE);
  const [state, aliveCharacters, targets] = await Promise.all([
    // findUnique, not upsert: this is a page render, and the row is created by
    // the bot on ready and by every write path that touches it. Upserting here
    // made a read-only page take a write lock on the game's hottest row on
    // every single load.
    prisma.gameState.findUnique({ where: { id: 1 }, select: { lifewebBlood: true } }),
    // The superadmin's GM panel: every living character, by name — host
    // access, not a player's view. Tags come down so the dialog can price a
    // target (Nobility 40 / Courtier 30 / 20) without a round trip; only the
    // two that set a price, and only their slugs.
    superadmin
      ? prisma.character.findMany({
          where: { status: "ALIVE" },
          orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
          select: { id: true, name: true, firstName: true, lastName: true, tags: BLOOD_TIER_TAGS },
        })
      : [],
    mortusCharacter && atLifeweb ? mortusTargets(mortusCharacter) : [],
  ]);

  const blood = state?.lifewebBlood ?? 0;
  const band = bloodBand(blood);

  return (
    <PageShell width="narrow">

      <section className="panel p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="section-title" style={{ color: band.color }}>{band.label}</h2>
          <span className="text-sm text-muted">{blood} / 100</span>
        </div>

        <div
          className="mt-3"
          style={{
            height: "10px",
            borderRadius: "999px",
            background: "var(--field-bg)",
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          <div style={{ height: "100%", width: `${blood}%`, background: band.color }} />
        </div>
      </section>

      {mortusCharacter && (
        <section className="panel p-5">
          <h2 className="panel-header">Tend the Web</h2>
          <LifewebRequestButtons targets={targets} disabled={!atLifeweb} />
          <p className="mt-3 text-xs text-muted">
            {atLifeweb
              ? "These actions take effect immediately, but are reviewed by a GM later."
              : "The Web is in the Undertown. You can watch it from here, but you have to be standing at the Lifeweb to tend it."}
          </p>
        </section>
      )}

      {superadmin && (
        <section className="panel p-5">
          <h2 className="panel-header">GM Panel</h2>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold">Donate blood</h3>
            {aliveCharacters.length === 0 ? (
              <p className="text-sm text-muted">No living characters.</p>
            ) : (
              <LifewebDonateBloodPanel characters={aliveCharacters} />
            )}
          </div>

          <div className="mt-5 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-sm font-bold">Feed person</h3>
            <LifewebFeedPersonButton />
          </div>
        </section>
      )}
    </PageShell>
  );
}
