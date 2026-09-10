// The Oracle's one outbound call. See docs/systemdocs/ORACLE.md.
//
// OpenAI-shaped chat completions, which is what OpenRouter speaks and what
// almost every other provider offers a compatible endpoint for. `baseUrl` is
// configured rather than hardcoded, so pointing at a different provider — or a
// proxy, or a local model — is a settings change and not a deploy.
//
// Deliberately NOT db/lib/discordRest.js's treatment. That module carries a
// persisted circuit breaker, bounded 429 retries and metrics counters, because
// Discord is on the hot path of every request the game serves. This runs seven
// times a day. A breaker for a job that fires thirty times a game would be more
// state to get wrong than it could ever save, so: a timeout, one retry, and an
// honest error otherwise. The caller (db/lib/oracleCutoff.js) logs and swallows
// per zone, and the pages already written are what make a retry cheap — that is
// where the real durability lives.

// How long to WAIT, which is not the same question as how long a page is
// allowed to be. The cap below is a ceiling on length; this is a ceiling on
// patience. It has to be the looser of the two, or the cap is unreachable and
// every long page dies as a timeout instead of arriving.
//
// Five minutes covers a page at the caps in oracle.js even on a provider
// generating at three tokens a second, which is what nano-gpt was measured
// doing. Seven calls plus one retry each still fits inside the three-hour
// window the run has to itself, and the bot's minute tick already refuses to
// start a second run while one is in flight (bot/src/events/ready.js).
const DEFAULT_TIMEOUT_MS = 300_000;

class OracleError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = "OracleError";
    this.status = status;
    this.retryable = retryable;
  }
}

// A 4xx that is not 429 is a bad key, a bad model name or a malformed request.
// Retrying any of those just spends the same money twice and delays the honest
// error, so only 429 and 5xx come back.
function retryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

async function once({ baseUrl, apiKey, model, system, user, timeoutMs, maxTokens }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (err) {
    // An abort and a dropped connection are both worth one more go.
    const aborted = err?.name === "AbortError";
    throw new OracleError(aborted ? `Timed out after ${timeoutMs}ms` : `Network error: ${err?.message ?? err}`, {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Read the body for the message, but never let a huge error page become the
    // thrown string — and never echo it somewhere a key could be reflected back.
    const detail = await response.text().catch(() => "");
    throw new OracleError(`HTTP ${response.status}: ${detail.slice(0, 300)}`, {
      status: response.status,
      retryable: retryableStatus(response.status),
    });
  }

  const json = await response.json().catch(() => null);
  const choice = json?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    // A 200 with no content is a provider problem, not a prompt problem, and it
    // is the shape an overloaded gateway most often returns.
    throw new OracleError("The provider returned no text.", { retryable: true });
  }

  return {
    text: text.trim(),
    // A model that ran into max_tokens stops mid-sentence and says so HERE, in
    // a field nothing used to read. The body it returns is a well-formed string
    // of the right shape, so without this a cut-off page is indistinguishable
    // from a finished one all the way to the desk. complete() decides what that
    // means; this only reports it.
    truncated: choice?.finish_reason === "length",
    inputTokens: Number(json?.usage?.prompt_tokens) || null,
    outputTokens: Number(json?.usage?.completion_tokens) || null,
  };
}

// One completion. Throws OracleError; the caller decides what a failure means.
//
// `config` is a GameConfig row — the API key never travels any other way, so
// there is exactly one place in the codebase that reads it.
async function complete(config, {
  system,
  user,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxTokens = 2048,
  allowTruncated = false,
}) {
  const apiKey = config?.oracleApiKey;
  if (!apiKey) throw new OracleError("No API key is set for the Oracle.");
  if (!config?.oracleModel) throw new OracleError("No model is set for the Oracle.");

  const args = {
    baseUrl: config.oracleBaseUrl,
    apiKey,
    model: config.oracleModel,
    system,
    user,
    timeoutMs,
    maxTokens,
  };

  try {
    const result = await once(args);
    // A page cut off at the cap is the one failure that arrives looking like a
    // success: it is stored as an ordinary page, read as a complete account of
    // the turn, and fed to the next three turns' writers as fact. So it is an
    // error, and NOT a retryable one — the same request produces the same
    // truncation and only spends the money twice, which is the reasoning
    // retryableStatus() already applies to a 400.
    //
    // With the caps in oracle.js at roughly three times the length the prompts
    // ask for, hitting this means the model ignored its instructions by a wide
    // margin, and the text would have been worth little anyway.
    if (result.truncated && !allowTruncated) {
      throw new OracleError(`The model stopped at the ${maxTokens}-token cap, mid-page.`);
    }
    return result;
  } catch (err) {
    if (!(err instanceof OracleError) || !err.retryable) throw err;
    // One retry, after a pause long enough to outlast a brief rate limit. There
    // is no schedule beyond this: a provider still failing on the second try is
    // a provider the turn should stop waiting for.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return once(args);
  }
}

// The panel's Test connection button. Deliberately tiny — a handful of tokens
// proves the key, the base URL and the model name all at once, which is the
// whole question a GM is asking before they trust it with a turn.
async function testConnection(config) {
  const started = Date.now();
  try {
    const res = await complete(config, {
      system: "Reply with the single word OK.",
      user: "Reply with the single word OK.",
      timeoutMs: 30_000,
      maxTokens: 16,
      // Sixteen tokens is a budget for one word, so a chatty model runs past it
      // every time. That is fine here: the question this button asks is whether
      // the key, the URL and the model name work, and a reply of any length has
      // already answered it.
      allowTruncated: true,
    });
    return { ok: true, ms: Date.now() - started, reply: res.text.slice(0, 40) };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err?.message ?? String(err) };
  }
}

module.exports = { complete, testConnection, OracleError, DEFAULT_TIMEOUT_MS };
