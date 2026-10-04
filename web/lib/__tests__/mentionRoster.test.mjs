// The @ list across a multi-locational room (web/lib/mentionRoster.js, MAP.md §2d).
//
// Players at the Square couldn't tag the person on the Town Gatehouse side of the Gatehouse
// Window, though both are in the room and hear every line of it. The list now names a room's
// far side while you type in that room, and nowhere else.

import assert from "node:assert/strict";
import test from "node:test";

import { mentionRosterFor } from "../mentionRoster.js";

const roster = [{ id: "c-ada", name: "Ada", updatedAt: 1, avatarPath: null }];

const people = {
  named: [],
  concealed: [{ alias: "a young man", lookRef: "tok" }],
  rooms: [
    {
      roomId: "window",
      roomName: "Gatehouse Window",
      locationId: "l-gatehouse",
      locationName: "Town Gatehouse",
      named: [
        { characterId: "c-bram", name: "Bram", avatarVersion: 7, avatarPath: "/a/bram.png" },
        { characterId: "c-ada", name: "Ada", avatarVersion: 1, avatarPath: null },
      ],
      concealed: [{ alias: "a hooded figure", lookRef: "hood-1" }],
    },
    {
      roomId: "meistery",
      roomName: "Meistery Window",
      locationId: "l-tower",
      locationName: "Tower",
      named: [{ characterId: "c-cass", name: "Cass", avatarVersion: 3, avatarPath: null }],
      concealed: [],
    },
  ],
};

test("inside the room, the far side is offered too", () => {
  const out = mentionRosterFor(roster, people, "room:window");
  assert.deepEqual(
    out.map((p) => p.id),
    ["c-ada", "c-bram"],
  );
  assert.deepEqual(out[1], { id: "c-bram", name: "Bram", updatedAt: 7, avatarPath: "/a/bram.png" });
});

test("only that room's far side, not another room's", () => {
  const out = mentionRosterFor(roster, people, "room:meistery");
  assert.deepEqual(
    out.map((p) => p.id),
    ["c-ada", "c-cass"],
  );
});

test("in the street, or any other place, the list is unchanged", () => {
  assert.equal(mentionRosterFor(roster, people, "loc:l-square"), roster);
  assert.equal(mentionRosterFor(roster, people, "conv:abc"), roster);
  assert.equal(mentionRosterFor(roster, people, null), roster);
});

test("nobody twice, and never yourself", () => {
  const withSelf = {
    rooms: [{ roomId: "window", named: [{ characterId: "c-me", name: "Me", self: true }, { characterId: "c-ada", name: "Ada" }] }],
  };
  assert.equal(mentionRosterFor(roster, withSelf, "room:window"), roster);
});

test("hoods and strangers are never offered", () => {
  const out = mentionRosterFor(roster, people, "room:window");
  assert.ok(out.every((p) => typeof p.id === "string" && p.id.startsWith("c-")));
  assert.ok(!out.some((p) => p.name === "a hooded figure" || p.id === "hood-1"));
});

test("no people loaded yet: the roster alone", () => {
  assert.equal(mentionRosterFor(roster, null, "room:window"), roster);
  assert.deepEqual(mentionRosterFor(undefined, undefined, "room:window"), []);
});
