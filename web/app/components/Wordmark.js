// The game's name, drawn the one way it is ever drawn: blackletter, an accent rule under
// it, and a quiet line of small caps below that.
//
// Extracted from HomeScreen.js when the closed door started wearing it too. Two copies
// would have drifted, and this is the first thing anybody sees of Bascinet.
export default function Wordmark({ note = null }) {
  return (
    <div className="flex flex-col items-center">
      <h1 className="wordmark text-5xl tracking-widest sm:text-6xl">Bascinet</h1>
      <div className="wordmark-rule my-3" />
      {note && <p className="text-sm tracking-[0.2em] uppercase text-muted">{note}</p>}
    </div>
  );
}
