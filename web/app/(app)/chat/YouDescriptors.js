// The descriptors in the /chat you-frame (the Soilery Rework doc): one row
// each, the word in its tone and the doc's own line underneath. They are
// plain words built on the server (web/lib/descriptors.js), never a number.
// Shared by the you-plate (next/YouPlate.js) and the old aside (ChatAside.js).
export default function YouDescriptors({ descriptors = [] }) {
  return descriptors.map((d) => (
    <div className="kv you-descriptor" key={d.key} title={d.line}>
      <dt>{d.label}</dt>
      <dd data-tone={d.tone ?? undefined}>{d.word}</dd>
    </div>
  ));
}
