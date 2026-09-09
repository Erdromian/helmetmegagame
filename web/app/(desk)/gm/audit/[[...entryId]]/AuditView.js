"use client";

import PageShell from "@/app/components/PageShell";
import AuditDesk from "../AuditDesk";

// What the page draws, from the one object page.js#FreshAudit produces — the
// stored copy first, the fresh one when it lands (web/lib/snapshot). The
// props are exactly what <AuditDesk> always took.
export default function AuditView(props) {
  return (
      <AuditDesk {...props} />
  );
}
