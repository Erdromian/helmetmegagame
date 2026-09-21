const yaml = require("js-yaml"), fs = require("fs");
const d = yaml.load(fs.readFileSync("docs/roles.yaml", "utf8"));
const L = [];
let n = 0;
for (const z of d.zones || []) {
  for (const [fslug, f] of Object.entries(z.factions || {})) {
    for (const [rslug, r] of Object.entries(f.roles || {})) {
      n++;
      L.push("=".repeat(70));
      L.push(`${r.name || rslug}  —  ${f.name || fslug}  (${z.name})`);
      L.push("=".repeat(70));
      L.push("");
      if (r.intro) { L.push("INTRO"); L.push(r.intro); L.push(""); }
      if (r.description && r.description.length) {
        L.push("DESCRIPTION");
        for (const b of r.description) L.push("- " + b);
        L.push("");
      }
    }
  }
}
fs.writeFileSync("roles-text.txt", L.join("\n") + "\n");
console.log(n + " roles");
