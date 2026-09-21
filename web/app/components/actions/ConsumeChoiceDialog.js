"use client";

import { useState } from "react";
import ChipPicker from "../ChipPicker";
import TagIcon from "../TagIcon";
import ActionDialog from "./ActionDialog";
import useSubmit from "./useSubmit";
import { noticeLine } from "./noticeLines";
import { useTags } from "../TagsProvider";
import { consumeTagRequest } from "@/app/(app)/character/requestActions";

// A consumable whose catalog row carries `consumeChoice` — the Instrument Kit — asks
// which one before it is spent (docs/systemdocs/SOUND.md, "Performances"). Each option
// shows its own sprite and name, read off the tag catalog already on the page. The
// server checks the pick against the same list; this is only the asking.
export default function ConsumeChoiceDialog({ tag, mode = "consume", onDone, onClose }) {
  const { tagsBySlug } = useTags();
  const [choice, setChoice] = useState("");
  const { submit, busy, error } = useSubmit();

  const options = (tag?.consumeChoice ?? []).map((slug) => {
    const option = tagsBySlug.get(slug) ?? { slug, name: slug };
    return {
      id: slug,
      label: (
        <>
          <TagIcon tag={option} />
          {option.name}
        </>
      ),
    };
  });

  return (
    <ActionDialog
      title="What instrument do you want?"
      submitLabel="Consume"
      busy={busy}
      error={error}
      canSubmit={Boolean(choice)}
      onClose={onClose}
      onSubmit={() =>
        submit(
          () => consumeTagRequest({ tagId: tag.id, choice }),
          (res) => onDone?.(noticeLine(mode, res, { name: tag.name })),
        )
      }
    >
      <ChipPicker options={options} value={choice} onChange={setChoice} />
    </ActionDialog>
  );
}
