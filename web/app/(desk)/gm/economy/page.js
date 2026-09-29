// The economy report, GM-only. The (desk) layout has already checked isGm
// (web/app/(desk)/layout.js), so there's no gate here — a layout gate is
// presentation. The page itself, the frame and the share bar are
// web/app/components/EconomyReport.js, shared with the Economist role's twin
// at /econ/economy; the share bar's actions carry their own gate
// (web/app/economyShareActions.js).

import EconomyReport from "@/app/components/EconomyReport";

export const metadata = {
  title: "Economy",
  description: "The Bascinet economy report",
  robots: { index: false, follow: false },
};

export default function EconomyPage() {
  return <EconomyReport />;
}
