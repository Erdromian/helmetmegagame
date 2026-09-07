"use client";

// The Thanati's rites, read-only (docs/systemdocs/THANATI.md): this game's
// Words of the Circle, and every attempt in flight or lately finished. No
// buttons by Bascinet's ruling — a GM who has to unstick a rite does it from
// the character panel. Everything arrives flat from the page, so this file
// imports nothing from db/lib.
import EmptyState from "@/app/components/EmptyState";

const STATUS_TONE = {
  OPEN: "text-muted",
  READY: "",
  FIRED: "",
  EXPIRED: "text-muted",
  CANCELLED: "text-muted",
};

export default function RitesPanel({ words, attempts }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="section-title">Rites</h3>
      <div className="desk-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Rite</th>
              <th>Minimum</th>
              <th>Word of the Circle</th>
            </tr>
          </thead>
          <tbody>
            {words.map((w) => (
              <tr key={w.key}>
                <td>{w.name}</td>
                <td className="mono">{w.minChanters}</td>
                <td>
                  <span className="chip word-chip">{w.phrase}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="desk-card">
        {attempts.length === 0 ? (
          <EmptyState>No attempts.</EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Rite</th>
                <th>Room</th>
                <th>Status</th>
                <th>Chanters</th>
                <th>Opened</th>
                <th>Fires</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td>{a.riteName}</td>
                  <td>{a.roomName}</td>
                  <td className={`mono ${STATUS_TONE[a.status] ?? ""}`}>{a.status}</td>
                  <td>
                    <span className="mono">{a.chanters.length}</span>
                    {a.chanters.length > 0 ? <span className="text-muted"> · {a.chanters.join(", ")}</span> : null}
                  </td>
                  <td className="mono">{a.openedAt}</td>
                  <td className="mono">{a.firesAt ?? a.firedAt ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
