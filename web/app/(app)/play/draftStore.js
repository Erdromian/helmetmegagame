"use client";

// What has been typed into the composer and not sent, per place, for the life
// of the tab. Feed.js is keyed on the open place now — switching rooms
// remounts it, so nothing typed in one can be sent into another by mistake —
// and this is what lets the words survive the switch: they are put back the
// next time that place is opened, the way Discord keeps a draft per channel.
//
// Module state on purpose, no listeners: Feed reads it in a state initializer
// on mount and writes it from an effect as the draft changes. Nobody else
// ever needs telling.

const drafts = new Map();

export function readDraft(placeKey) {
  return (placeKey && drafts.get(placeKey)) || "";
}

export function writeDraft(placeKey, text) {
  if (!placeKey) return;
  if (text) drafts.set(placeKey, text);
  else drafts.delete(placeKey);
}
