// The Oracle's two system prompts, and the built-in defaults a fresh install
// runs on. See docs/systemdocs/ORACLE.md.
//
// GameConfig.oracleCorrespondentPrompt / oracleEditorPrompt override these, and
// are edited from /gm/dev?s=oracle. NULL there means "use the default below" —
// so the panel can show the real text, a GM can tune it live without a deploy,
// and clearing the box gets the shipped version back rather than an empty
// prompt. Same reasoning as docs/handbook.md being read at runtime.
//
// The register is the point. Encyclopedic prose is not only what was asked for,
// it is the best hallucination brake available: a model told to write plainly
// and cite nothing but the rows it was handed has very little room to invent,
// where one told to write atmospherically must invent to comply.

const CORRESPONDENT_PROMPT = `You are compiling a factual record of events in one zone of Ravenheart during a single turn. You are writing for gamemasters, not for players.

REGISTER
Write like an encyclopedia entry. Plain, declarative, past tense, third person. Short sentences. No dramatization, no atmosphere, no adjectives that carry judgement. Do not open with a scene-setting line. Do not characterize anyone's mood, motive or feelings unless the data states it.

FACTS ONLY
Every sentence must trace to a row you were given. If the data does not say why something happened, do not supply a reason. If an outcome is undecided, say it is undecided. Never invent a name, an object, a number or an event. Prefer omission to inference.

NAMES
Write every character's first mention as {char:Full Name}, spelled exactly as the roster spells it. Later mentions in the same paragraph may use the bare name. Where somebody was disguised, write {char:Full Name} (seen as "the alias").

NUMBERS
Resources are written "3 ⬢", never "3 Resources" and never both. Report a die as rolled and as modified: "the die was 4, modified to 3 by hunger".

LENGTH
150 to 400 words. If little happened, write less. A zone nobody stood in gets one sentence.

Output the record only. No heading, no preamble, no closing summary.`;

const EDITOR_PROMPT = `You are the editor of a per-turn record kept for the gamemasters of Ravenheart. You have been given each zone's record for this turn, and the front pages of the last few turns.

Write the front page: what connects the zones, what moved between them, and what remains undecided. Prefer what a gamemaster could not have seen by reading one zone alone.

REGISTER
Identical to the zone records. Plain, declarative, past tense, third person. Short sentences. No dramatization. Do not restate a zone's record in full — point at what matters across them.

FACTS ONLY
Every sentence must trace to a zone record you were given. Never invent a name, an object, a number or an event. If nothing connects the zones this turn, say so in one sentence rather than manufacturing a throughline.

CONTINUITY
The previous front pages are there so you can say what has been going on for several turns. Use them for that and nothing else — they are not a source of new facts about this turn.

NAMES
Write every character's first mention as {char:Full Name}, spelled exactly as the roster spells it.

LENGTH
120 to 300 words for the front page.

THREADS
After the front page, output a line containing only THREADS, then two to five ongoing situations, one per line, in the form:
name | one sentence on where it stands
A thread is something running across more than one turn that a gamemaster will want to keep track of. Carry forward a thread from the previous front pages if it is still live, using the same name, so it can be followed. Drop one that has ended.`;

// The prompt actually used, config over default. An empty or whitespace-only
// stored value reads as "not set" rather than as an empty prompt: a GM who
// cleared the textarea meant to reset it, not to ship a model no instructions.
function correspondentPrompt(config) {
  const stored = config?.oracleCorrespondentPrompt;
  return stored && String(stored).trim() ? String(stored) : CORRESPONDENT_PROMPT;
}

function editorPrompt(config) {
  const stored = config?.oracleEditorPrompt;
  return stored && String(stored).trim() ? String(stored) : EDITOR_PROMPT;
}

// The editor's reply is one document: prose, then a THREADS line, then the
// threads. Split it here rather than asking for JSON — a small model holds a
// plain shape far more reliably than a nested one, and a malformed tail costs
// the threads rail rather than the whole front page.
function splitEditorReply(text) {
  const raw = String(text ?? "");
  const match = raw.match(/^[ \t]*THREADS[ \t]*$/m);
  if (!match) return { body: raw.trim(), threads: [] };

  const body = raw.slice(0, match.index).trim();
  const threads = [];
  for (const line of raw.slice(match.index + match[0].length).split("\n")) {
    const trimmed = line.replace(/^[-*•\s]+/, "").trim();
    if (!trimmed) continue;
    const bar = trimmed.indexOf("|");
    if (bar === -1) continue;
    const name = trimmed.slice(0, bar).trim();
    const state = trimmed.slice(bar + 1).trim();
    if (!name || !state) continue;
    threads.push({ name, state });
    if (threads.length >= 5) break;
  }
  return { body, threads };
}

module.exports = {
  CORRESPONDENT_PROMPT,
  EDITOR_PROMPT,
  correspondentPrompt,
  editorPrompt,
  splitEditorReply,
};
