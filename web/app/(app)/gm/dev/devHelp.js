// The Depot section's tooltips: one line per field, written for a GM who has
// not read DEPOT.md and should not have to. (The Game Config tooltips moved
// into the registry, db/lib/gameConfigFields.js, beside the fields they
// describe.)
export const DEPOT_HELP = {
  accountObols:
    "The station's balance in obols (¢). It belongs to the Depot, not to the Merchant — hand the licence to someone else and the money goes with it. ‡",
  debtObols: "How much of the Company's line is currently drawn, in obols. ‡",
  generatorFuel:
    "Units left in the tank. The generator burns a fixed amount every turn and switches itself off at zero, which stops everything at the Depot. ‡",
  merchantFace:
    "The one name the turret will not fire on. It is written automatically when a character is created on the Merchant role, and this field is the override. It matches the PRESENTED name, so a concealed Merchant is shot by his own gun and anyone wearing his name walks past it. Leave it blank and the turret fires on everyone — and cannot be armed at all. ‡",
  generatorOn: "Whether the generator is running right now. Switching it on with an empty tank does nothing. ‡",
  turretArmed: "Whether the turret is live. It only fires when the generator is also running. ‡",
  fuelMax: "How much the tank holds. Fuel fed in past this is wasted, not banked. ‡",
  fuelBurnPerTurn: "Units burned each turn the generator runs. Tank size divided by this is how many turns a full tank lasts. ‡",
  coalFuel: "Units of fuel one Coal is worth. ‡",
  saltpeterFuel: "Units of fuel one Saltpeter is worth. Deliberately worse than coal — it is the fallback, not the plan. ‡",
  shuttleMaxTurns: "How many turns the shuttle sits on the pad before flying back on its own, loaded or not. ‡",
  shuttleCooldown: "Turns that must pass after it lands before it can be sent back up. ‡",
  creditCapObols: "The ceiling on the Company's credit line, in obols. ‡",
  turretTable:
    "What a burst does to somebody wearing NOTHING. Armour bends this curve rather than replacing it, so tuning here moves every outcome at once — a piece of gear's own protection lives on its tag. Must sum to exactly 1, and the save is refused if it does not. Severities: graze, minor-wound, deep-wound, grievous-wound, dying, dead. ‡",
};
