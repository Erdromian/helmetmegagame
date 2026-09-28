// The economy report, mirrored for the Economist role. The (econ) layout has
// already checked isGm/isEconomist/isSuperadmin (web/app/(econ)/layout.js),
// so there's no gate here. Same page as /gm/economy — a separate file rather
// than a shared route because the (desk) and (econ) route groups can't share a
// layout chain (see (econ)/layout.js's header comment), so both mount
// web/app/components/EconomyReport.js.

import EconomyReport from "@/app/components/EconomyReport";

export const metadata = {
  title: "Economy",
  description: "The Bascinet economy report",
  robots: { index: false, follow: false },
};

export default function EconEconomyPage() {
  return <EconomyReport />;
}
