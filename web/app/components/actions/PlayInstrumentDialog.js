"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { songsFor } from "@lifeweb/db/lib/instrumentSongs";
import Modal from "../Modal";
import FormError from "../FormError";
import VolumeSlider from "../VolumeSlider";
import { SortHeader, TableScroll, useTableState } from "../DataTable";
import { noteOwnPerformance } from "../performanceStore";
import { useActionPools } from "./poolsContext";
import useSubmit from "./useSubmit";
import {
  startPerformanceRequest,
  setPerformanceVolumeRequest,
  stopPerformanceRequest,
} from "@/app/(app)/character/requestActions";

// The Play Instrument panel (docs/systemdocs/SOUND.md, "Performances"). Pick a song and it
// starts at once for everyone standing in your Location; the slider is how loud you play,
// remembered per character in this browser; Stop ends it. An instrument picker appears
// only with two or more on the rack — with one there is nothing to choose.
//
// Every click goes to the server, which checks the rack, the song and your hands again.

const VOLUME_KEY = (characterId) => `bascinet:perform-volume:${characterId ?? "self"}`;
const volumeListeners = new Set();
const SEARCH_FIELDS = [(row) => row.name];
const NONE = [];

function readVolume(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw == null ? 1 : Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
  } catch {
    return 1;
  }
}

function subscribeVolume(cb) {
  volumeListeners.add(cb);
  return () => volumeListeners.delete(cb);
}

function writeVolume(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // A private window: the slider still works for this song, it is just not remembered.
  }
  for (const cb of [...volumeListeners]) cb();
}

function formatLength(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function PlayInstrumentDialog({ onClose }) {
  const pools = useActionPools();
  const instruments = pools.playInstruments ?? NONE;
  const volumeKey = VOLUME_KEY(pools.selfId);
  const stored = useSyncExternalStore(subscribeVolume, () => readVolume(volumeKey), () => 1);
  const [picked, setPicked] = useState(instruments[0]?.slug ?? "");
  const { submit, busy, error } = useSubmit();
  const volumeTimer = useRef(null);

  const instrument = instruments.some((i) => i.slug === picked) ? picked : (instruments[0]?.slug ?? "");
  const nameOf = useMemo(() => new Map(instruments.map((i) => [i.slug, i.name])), [instruments]);
  const rows = useMemo(
    () =>
      songsFor(instrument ? [instrument] : []).map((song) => ({
        ...song,
        instrumentName: nameOf.get(song.instrument) ?? song.instrument,
      })),
    [instrument, nameOf],
  );
  const table = useTableState({
    rows,
    searchFields: SEARCH_FIELDS,
    filterDefs: [],
    initialSort: { key: "name", dir: "asc" },
    pageSize: 200,
  });

  function start(song) {
    submit(
      () => startPerformanceRequest({ instrumentSlug: song.instrument, songKey: song.key, volume: stored }),
      (res) => noteOwnPerformance(res.performance),
    );
  }

  function stop() {
    submit(() => stopPerformanceRequest(), () => noteOwnPerformance(null));
  }

  // Remembered at once; sent to the room a beat after the slider settles, so a drag is one
  // write rather than forty. The server only touches a song that is still playing.
  function changeVolume(value) {
    writeVolume(volumeKey, value);
    if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(() => {
      setPerformanceVolumeRequest({ volume: value }).catch(() => {});
    }, 300);
  }

  return (
    <Modal open title="Play Instrument" onClose={() => !busy && onClose?.()} width="wide">
      <div className="flex flex-col gap-3">
        {instruments.length >= 2 && (
          <label className="field">
            <span className="field-label">Instrument</span>
            <select value={instrument} onChange={(e) => setPicked(e.target.value)} disabled={busy}>
              {instruments.map((i) => (
                <option key={i.slug} value={i.slug}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
          <TableScroll>
            <thead>
              <tr>
                <SortHeader label="Name" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Length" sortKey="seconds" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Instrument" sortKey="instrumentName" sort={table.sort} onSort={table.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {table.pageRows.map((song) => (
                <tr key={`${song.instrument}:${song.key}`}>
                  <td>
                    <button type="button" className="btn-quiet" disabled={busy} onClick={() => start(song)}>
                      {song.name}
                    </button>
                  </td>
                  <td className="mono">{formatLength(song.seconds)}</td>
                  <td className="text-muted">{song.instrumentName}</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        </div>

        <VolumeSlider id="instrument-volume" value={stored} onChange={changeVolume} />

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={stop}>
            Stop
          </button>
        </div>
      </div>
    </Modal>
  );
}
