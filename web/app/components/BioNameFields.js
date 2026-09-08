"use client";

import { AGE_MIN, AGE_MAX, GENDER_LABELS } from "@/lib/characterName";
import InfoIcon from "./InfoIcon";

// The name half of the Bio form on /character. The four fields here are
// READ-ONLY server-rendered inputs — a name is set in the creation wizard
// and `updateCharacterProfile` ignores the name keys outright regardless of
// what this form posts, which (not the greying) is the actual lock. See
// docs/systemdocs/CHARACTERS.md §1b. The one way a name changes after that is
// drinking a Mulligan Potion, and that is clicked on the bottle itself over in
// TagsPanel — this card only ever shows the result. No per-field InfoIcon: CharacterSheet.js already puts one
// summary tooltip on the "Bio" heading; `title` keeps its own since it explains
// a different thing (how to get one, not why it's locked).

export default function BioNameFields({ character }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="field">
        <span className="field-label">Prefix</span>
        <input defaultValue={character.honorific ?? ""} placeholder="(none)" disabled />
      </label>
      <label className="field">
        <span className="field-label">First name</span>
        <input defaultValue={character.firstName ?? ""} disabled />
      </label>
      <label className="field">
        <span className="field-label">Last name</span>
        <input
          defaultValue={character.lastName ?? ""}
          placeholder="No last name"
          disabled
        />
      </label>
      {/* Chosen at creation and fixed for good — unlike age there is no
          unset state, so updateCharacterProfile simply never reads the
          key. Shown so a player can confirm what they picked; it is not
          published anywhere else, and never appears on 🔍 examine. */}
      <label className="field">
        <span className="field-label">Gender</span>
        <input defaultValue={GENDER_LABELS[character.gender] ?? ""} disabled />
      </label>
      {/* Free to set once, then fixed — unlike the title below, which a
          Mulligan Potion rewrites. The disabled input submits nothing,
          and updateCharacterProfile refuses to overwrite a non-null
          age regardless, which is the actual lock. */}
      <label className="field">
        <span className="field-label">Age</span>
        <input
          type="number"
          name="age"
          min={AGE_MIN}
          max={AGE_MAX}
          defaultValue={character.age ?? ""}
          placeholder={`${AGE_MIN}–${AGE_MAX}`}
          disabled={character.age !== null}
        />
      </label>
      {/* Granted by a GM or written by the player with a Mulligan Potion,
          neither of which is this form. Being `disabled` it submits nothing,
          and updateCharacterProfile never reads it — that, not the greying,
          is the lock. */}
      <label className="field">
        <span className="field-label flex items-center gap-1.5">
          Title
          <InfoIcon text="Rendered in quotes between your first and last name." />
        </span>
        <input defaultValue={character.title ?? ""} placeholder="None granted" disabled />
      </label>
    </div>
  );
}
